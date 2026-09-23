// Shared plumbing for the SPOT concurrency harness (scripts/sim).
//
// Everything here is infrastructure: env loading, one Supabase client per
// virtual actor, a barrier so a phase really starts for every actor at the same
// instant, a PASS/FAIL/UNREACHABLE recorder that never throws, and the account
// deletion every actor runs on itself at the end.
//
// The one app call that lives in this file is `cleanup()` — it is the app's own
// «Hesabı sil» path, so it carries the same `// app:` anchors as actions.mjs.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SIM_DIR = resolve(ROOT, 'scripts', 'sim');

// ------------------------------------------------------------------ env ----

/**
 * Read ONLY the two public values from D:\spot\.env.
 *
 * Deliberately not `process.env`: a shell that happens to export a service-role
 * key must never be able to leak it into a run. The file is parsed by hand so no
 * dotenv dependency is needed, and anything that is not the publishable key is
 * refused before a client is ever built.
 */
export function loadEnv(file = resolve(ROOT, '.env')) {
  if (!existsSync(file)) throw new Error(`.env not found at ${file}`);
  const vars = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key !== 'EXPO_PUBLIC_SUPABASE_URL' && key !== 'EXPO_PUBLIC_SUPABASE_ANON_KEY') continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  const url = vars.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = vars.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing in .env');
  assertPublicKey(anonKey);
  return { url, anonKey };
}

/** Refuse anything that is not the app's public key. The harness is only
 *  honest if it has exactly the power the APK has — no more. */
export function assertPublicKey(key) {
  if (/^sb_secret_/i.test(key)) throw new Error('refusing to run: .env holds a SECRET key (sb_secret_*)');
  if (key.startsWith('sb_publishable_')) return 'publishable';
  const parts = key.split('.');
  if (parts.length === 3) {
    let role = null;
    try {
      role = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role ?? null;
    } catch {
      role = null;
    }
    if (role === 'anon') return 'legacy-anon';
    throw new Error(`refusing to run: the key in .env is a JWT with role «${role}», not «anon»`);
  }
  throw new Error('refusing to run: the key in .env is neither sb_publishable_* nor an anon JWT');
}

// --------------------------------------------------------------- timing ----

export const now = () => performance.now();
export const round = (ms) => Math.round(ms * 10) / 10;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` and return its result together with how long it took. */
export async function timed(fn) {
  const t0 = now();
  const result = await fn();
  return { result, ms: round(now() - t0) };
}

// --------------------------------------------------------------- errors ----

/** A PostgREST / GoTrue / thrown error reduced to plain JSON for the report. */
export function errInfo(e) {
  if (!e) return null;
  if (typeof e === 'string') return { message: e };
  return {
    message: String(e.message ?? e.error_description ?? e.msg ?? e),
    code: e.code ?? null,
    status: e.status ?? null,
    details: e.details ?? null,
    hint: e.hint ?? null,
    name: e.name ?? null,
  };
}

/** Every action returns this shape and never throws on an expected refusal:
 *  the scenario, not the action, decides whether a refusal is a bug. */
export const ok = (rows = null, extra = {}) => ({ ok: true, rows, error: null, ...extra });
export const fail = (error, extra = {}) => ({ ok: false, rows: null, error: errInfo(error), ...extra });

// ------------------------------------------------------------- recorder ----

let active = null;

/** Collects checks, steps and events, prints them as they happen, and becomes
 *  last-report.json at the end. */
export class Recorder {
  constructor(meta) {
    this.meta = meta;
    this.t0 = now();
    this.startedAt = new Date().toISOString();
    this.phases = [];
    this.checks = [];
    this.events = [];
    this.leftovers = [];
    // Rows delete_my_account() removes but the public key cannot re-read (unlisted gyms).
    this.expectedDeleted = null;
    this.cur = null;
    this.quiet = false;
  }

  startPhase(name, title) {
    const p = { name, title, startedAt: new Date().toISOString(), ms: null, steps: [], checks: [], skipped: null };
    this.phases.push(p);
    this.cur = p;
    this.phaseT0 = now();
    if (!this.quiet) console.log(`\n== ${name} — ${title}`);
    return p;
  }

  /** Ends the current phase — only if it is still `name` (a Ctrl+C may have
   *  replaced the interrupted phase with the cleanup phase meanwhile). */
  endPhase(name) {
    if (!this.cur || (name && this.cur.name !== name)) return;
    this.cur.ms = round(now() - this.phaseT0);
    if (!this.quiet) console.log(`   (${this.cur.ms} ms)`);
    this.cur = null;
  }

  step(s) {
    if (this.cur) this.cur.steps.push(s);
    if (!this.quiet) {
      const bad = s.calls.filter((c) => !c.ok).length;
      const w = s.write;
      const writes = w
        ? `; writes: ${w.reached}/${w.aligned} left within ${w.spreadMs ?? '—'} ms${w.overlapMs == null ? '' : w.overlapMs > 0 ? `, all in flight together for ${w.overlapMs} ms` : ', never all in flight together'}`
        : '';
      console.log(`   · ${s.label}: ${s.calls.length} call(s) released together, start spread ${s.spreadMs} ms${writes}, took ${s.ms} ms${bad ? `, ${bad} refused/failed` : ''}`);
    }
  }

  record(status, id, message, details) {
    const c = { phase: this.cur?.name ?? null, status, id, message, details: details ?? null };
    this.checks.push(c);
    if (this.cur) this.cur.checks.push(c);
    if (!this.quiet) console.log(`   ${status.padEnd(11)} ${id} — ${message}`);
    return c;
  }

  event(actor, event, data) {
    this.events.push({ t: round(now() - this.t0), actor, event, data: data ?? null });
  }

  leftover(kind, detail) {
    this.leftovers.push({ kind, ...detail });
  }

  totals() {
    const t = { PASS: 0, FAIL: 0, UNREACHABLE: 0, INFO: 0 };
    for (const c of this.checks) t[c.status] = (t[c.status] ?? 0) + 1;
    return t;
  }

  toJSON() {
    return {
      meta: this.meta,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      totalMs: round(now() - this.t0),
      totals: this.totals(),
      phases: this.phases,
      leftovers: this.leftovers,
      expectedDeleted: this.expectedDeleted,
      checks: this.checks,
      events: this.events,
    };
  }
}

export function setRecorder(rec) {
  active = rec;
}

/** PASS when `cond` holds, FAIL otherwise. Never throws — a failed check is a
 *  finding to report, not a reason to stop every other actor. */
export function expect(cond, id, message, details) {
  active?.record(cond ? 'PASS' : 'FAIL', id, message, details);
  return !!cond;
}

/** A flow a live run cannot reach honestly (e.g. it needs three check-ins on
 *  three gym-days — the day turns at 04:00 Baku). Reported, never faked with
 *  privileged SQL. */
export function unreachable(id, reason, details) {
  active?.record('UNREACHABLE', id, reason, details);
}

export function info(id, message, details) {
  active?.record('INFO', id, message, details);
}

export function writeReport(path, rec, extra = {}) {
  const body = { ...rec.toJSON(), ...extra };
  writeFileSync(path, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return path;
}

// -------------------------------------------------------------- barrier ----

/** N parties arrive; nobody proceeds until the last one has. */
export class Barrier {
  constructor(parties) {
    this.parties = parties;
    this.arrived = 0;
    this.releasedAt = null;
    this.promise = new Promise((resolveFn) => {
      this.release = resolveFn;
    });
    if (parties <= 0) this.release();
  }

  wait() {
    this.arrived += 1;
    if (this.arrived === this.parties) {
      this.releasedAt = now();
      this.release();
    }
    return this.promise;
  }
}

/**
 * Ctrl+C / SIGTERM / a crash sets `aborted`: from then on no NEW concurrent step
 * starts, so the phase in flight winds down at its next step instead of running
 * to its end while cleanup deletes the accounts under it. Cleanup itself sets
 * `cleaning`, because it has to use `together()` to delete everybody.
 */
export const abortState = { aborted: false, cleaning: false };

/** Thrown by `together()` after an abort; the phase wrapper swallows it. */
export class SimAbort extends Error {
  constructor(label) {
    super(`aborted before «${label}»`);
    this.name = 'SimAbort';
  }
}

/**
 * Run several actors' actions so they START at the same instant.
 *
 * Each task may have a `prep` (the reads a screen does when it opens) that runs
 * before the barrier, then its `fn` runs the moment every task has arrived. The
 * start-time spread is recorded, so the report shows the calls really did go
 * out together rather than one after another.
 *
 * Starting together is not writing together: most actions read first
 * (auth.getUser, the caller's profile row) and write last, and the jitter of
 * those round trips staggers the writes by tens of ms, while a trigger's
 * transaction lasts a few. A task with `alignWrite: true` therefore gets a
 * second hook, `fn(prep, sync)`: the action calls `await sync()` after its own
 * reads, right before its write, and no aligned write leaves until every
 * aligned task is there. A task that ends before its write (a failed read)
 * counts as arrived, so it never holds the others. The step then carries
 * `write`: how many writes left, their spread, and how long all of them were
 * in flight at once (client side — the database's side is the scenario's to
 * judge, e.g. from created_at = now()).
 */
export async function together(label, tasks) {
  if (abortState.aborted && !abortState.cleaning) throw new SimAbort(label);
  const barrier = new Barrier(tasks.length);
  const aligned = tasks.filter((t) => t.alignWrite).length;
  const writeBarrier = new Barrier(aligned);
  const starts = new Array(tasks.length).fill(0);
  const writeAt = new Array(tasks.length).fill(null);
  const ends = new Array(tasks.length).fill(0);
  const t0 = now();
  const results = await Promise.all(
    tasks.map(async (task, i) => {
      let prep;
      if (task.prep) {
        try {
          prep = await task.prep();
        } catch (e) {
          prep = { prepError: errInfo(e) };
        }
      }
      await barrier.wait();
      starts[i] = now();
      // A task without alignWrite never touches the write barrier: sync() is a no-op.
      let atWrite = !task.alignWrite;
      const sync = async () => {
        if (atWrite) return;
        atWrite = true;
        await writeBarrier.wait();
        writeAt[i] = now();
      };
      let r;
      try {
        r = await task.fn(prep, sync);
      } catch (e) {
        r = fail(e, { threw: true });
      } finally {
        if (!atWrite) {
          atWrite = true;
          writeBarrier.wait();
        }
      }
      ends[i] = now();
      return {
        ...(r ?? { ok: false, error: { message: 'no result' } }),
        actor: task.actor?.key ?? null,
        label: task.label ?? task.actor?.key ?? `task${i}`,
        ms: round(ends[i] - starts[i]),
        writeMs: writeAt[i] == null ? null : round(ends[i] - writeAt[i]),
      };
    })
  );
  const spreadMs = tasks.length ? round(Math.max(...starts) - Math.min(...starts)) : 0;
  const w = writeAt.flatMap((at, i) => (at == null ? [] : [{ at, end: ends[i] }]));
  const write = aligned
    ? {
        aligned,
        reached: w.length,
        spreadMs: w.length ? round(Math.max(...w.map((x) => x.at)) - Math.min(...w.map((x) => x.at))) : null,
        // > 0: every write had left before the first answer came back.
        overlapMs: w.length > 1 ? round(Math.min(...w.map((x) => x.end)) - Math.max(...w.map((x) => x.at))) : null,
        slowestMs: w.length ? round(Math.max(...w.map((x) => x.end - x.at))) : null,
      }
    : null;
  const step = {
    label,
    spreadMs,
    ...(write ? { write } : {}),
    ms: round(now() - t0),
    calls: results.map((r) => ({ actor: r.actor, label: r.label, ok: !!r.ok, ms: r.ms, writeMs: r.writeMs, error: r.error?.message ?? null })),
  };
  active?.step(step);
  return { results, spreadMs, step };
}

// --------------------------------------------------------------- actors ----

const ROLE_LETTER = { user: 'u', trainer: 't', gym: 'g' };

/** Minutes since midnight in Baku (UTC+4, no DST) — the clock both the gym-day
 *  (turns at 04:00) and the owner panel's «bu gün» (turns at 00:00) run on. */
export function bakuMinutes(ms = Date.now()) {
  return Math.floor(ms / 60000 + 240) % 1440;
}

/** The @ad rule, mirrored so a generated handle can never be one the database
 *  refuses for its shape rather than for the race we are testing. */
// mirrors: src/lib/api.ts:176
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** A fresh install's store (the app's `emptyProfile` and privacy defaults). */
// mirrors: src/store/appStore.ts:176-201
export function emptyStore() {
  return {
    profile: {
      name: '',
      username: null,
      gender: '',
      age: null,
      homeGymId: null,
      goals: [],
      level: '',
      types: [],
      days: [],
      timeSlot: '',
      bio: '',
      role: 'user',
      specialty: '',
      priceFrom: null,
    },
    // mirrors: src/store/appStore.ts:230
    visibility: 'match-only',
    showInGymList: true,
    lastSaveError: null,
  };
}

/** A fresh install's device database (useDb) — only the partner-request map,
 *  the one part of it the social phase reads and writes. */
// mirrors: src/store/db.ts:389
export function emptyDb() {
  return { matches: {} };
}

/** Hard ceiling on one HTTP round trip. Without it a hung request would hold a
 *  barrier — and every other actor behind it — for ever. Infrastructure only:
 *  the request itself is untouched. */
function timeoutFetch(input, init = {}) {
  return fetch(input, init.signal ? init : { ...init, signal: AbortSignal.timeout(20000) });
}

/** A client that refuses to exist: used by --dry, which must not touch the network. */
function dryClient(key) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`[dry] actor ${key} tried to use the Supabase client (.${String(prop)}) — --dry makes no network calls`);
      },
    }
  );
}

/**
 * One virtual person: their own anonymous session, their own «phone» store.
 *
 * `persistSession: false` makes auth-js keep the session in a per-client
 * in-memory object (GoTrueClient: `this.memoryStorage = {}`), so ten actors in
 * one process can never read each other's tokens, and nothing lands on disk.
 */
export function makeActor(role, idx, runId, { env = null, recorder = null, dry = false } = {}) {
  const letter = ROLE_LETTER[role];
  if (!letter) throw new Error(`unknown role ${role}`);
  const key = `${letter}${idx}`;
  const username = `sim_${runId}_${key}`;
  if (!USERNAME_RE.test(username)) throw new Error(`generated @${username} does not fit ${USERNAME_RE}`);
  const client = dry
    ? dryClient(key)
    : createClient(env.url, env.anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: `sb-sim-${runId}-${key}`,
        },
        global: { fetch: timeoutFetch },
      });
  return {
    role,
    idx,
    key,
    // «TEST » first, so any screen that shows this person says what it is.
    name: `TEST ${key} ${runId}`,
    username,
    client,
    userId: null,
    profileId: null,
    ready: false,
    deleted: false,
    store: emptyStore(),
    db: emptyDb(),
    log(event, data) {
      recorder?.event(key, event, data);
    },
  };
}

// -------------------------------------------------------------- cleanup ----

/**
 * The actor deletes ITSELF, exactly as «Hesabı sil» does (Profil → Məxfilik).
 *
 * Mirrors deleteMyAccount(): files first (my_storage_objects + storage.remove),
 * then delete_my_account(), then sign out. privacy.tsx:162 also unregisters the
 * device's push token first; a virtual actor never registered one, so there is
 * nothing to unregister.
 */
export async function cleanup(a) {
  if (!a?.client || a.deleted || !a.userId) return ok(null, { skipped: true });
  try {
    // app: src/lib/api.ts:1323
    const { data: who, error: whoErr } = await a.client.auth.getUser();
    if (whoErr || !who?.user?.id) return fail(whoErr ?? new Error('not-signed-in'), { step: 'getUser' });

    // app: src/lib/api.ts:1338
    const { data: files, error: listErr } = await a.client.rpc('my_storage_objects');
    if (listErr) return fail(listErr, { step: 'my_storage_objects' });

    const byBucket = new Map();
    for (const f of files ?? []) {
      const arr = byBucket.get(f.bucket_id) ?? [];
      arr.push(f.name);
      byBucket.set(f.bucket_id, arr);
    }
    for (const [bucket, names] of byBucket) {
      // app: src/lib/api.ts:1348
      const { error: rmErr } = await a.client.storage.from(bucket).remove(names);
      if (rmErr) return fail(rmErr, { step: 'storage.remove', bucket });
    }

    // app: src/lib/api.ts:1355
    const { error } = await a.client.rpc('delete_my_account');
    if (error) return fail(error, { step: 'delete_my_account' });
    a.deleted = true;
    a.log('deleted', { userId: a.userId, profileId: a.profileId });

    // app: src/lib/api.ts:1358
    await a.client.auth.signOut().catch(() => {});
    return ok(null, { files: (files ?? []).length });
  } catch (e) {
    return fail(e, { step: 'threw' });
  }
}

// ---------------------------------------------------- anchor validation ----

/**
 * --dry's fidelity check. Every `// app: <file>:<line>` comment must point at a
 * real line of the app, and when the harness call right under it names a table,
 * an RPC or an auth method, that same name must appear at the app line (±a few
 * lines). A stale anchor — the app moved on, the harness did not — fails the
 * dry run instead of silently testing something the app no longer does.
 */
export function validateAnchors(files) {
  const out = { anchors: 0, verified: 0, structural: 0, mirrors: 0, errors: [] };
  const cache = new Map();
  const appLines = (rel) => {
    if (!cache.has(rel)) {
      const abs = resolve(ROOT, rel);
      cache.set(rel, existsSync(abs) ? readFileSync(abs, 'utf8').split(/\r?\n/) : null);
    }
    return cache.get(rel);
  };
  const TOKEN = [
    [/\.rpc\(\s*'([^']+)'/, (m) => m[1]],
    [/\.storage\.from\(/, () => 'storage'],
    [/\.from\(\s*'([^']+)'\s*\)/, (m) => m[1]],
    [/\.auth\.(\w+)\(/, (m) => m[1]],
    [/\.channel\(/, () => 'channel'],
  ];

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = line.match(/\/\/ (app|mirrors): (\S+?):(\d+)(?:-(\d+))?\s*$/);
      if (!m) return;
      const [, kind, rel, fromS, toS] = m;
      const from = Number(fromS);
      const to = toS ? Number(toS) : from;
      const where = `${file.replace(ROOT, '').replace(/^[\\/]/, '')}:${i + 1}`;
      const src = appLines(rel);
      if (kind === 'mirrors') out.mirrors += 1;
      else out.anchors += 1;
      if (!src) {
        out.errors.push(`${where}: ${rel} does not exist`);
        return;
      }
      if (from < 1 || to > src.length || to < from) {
        out.errors.push(`${where}: ${rel}:${fromS}${toS ? '-' + toS : ''} is outside the file (${src.length} lines)`);
        return;
      }
      if (kind === 'mirrors') return;

      // The harness statement this anchor labels: the first code line below it,
      // plus its continuation (a `.chain()` on the next line, or the body of an
      // open `(`, `[`, `{` or a trailing comma) — never the statement after it,
      // or a structural anchor would borrow the next call's table name.
      const stmt = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j].trim();
        if (l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*')) break;
        j += 1;
      }
      for (; j < lines.length && stmt.length < 6; j++) {
        const l = lines[j].trim();
        if (l.startsWith('//')) continue;
        const prev = stmt[stmt.length - 1];
        if (stmt.length && !(l.startsWith('.') || /[([{,]$/.test(prev) || /(=|=>|await|client)$/.test(prev))) break;
        stmt.push(l);
      }
      let token = null;
      for (const l of stmt) {
        for (const [re, pick] of TOKEN) {
          const tm = l.match(re);
          if (tm) {
            token = pick(tm);
            break;
          }
        }
        if (token) break;
      }
      if (!token) {
        out.structural += 1;
        return;
      }
      const window = src.slice(Math.max(0, from - 3), Math.min(src.length, to + 6)).join('\n');
      if (window.includes(token)) out.verified += 1;
      else out.errors.push(`${where}: harness calls «${token}» but ${rel}:${from} does not mention it`);
    });
  }
  return out;
}
