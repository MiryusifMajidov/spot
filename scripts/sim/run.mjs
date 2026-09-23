#!/usr/bin/env node
// SPOT concurrency harness: 10 virtual actors (5 users, 3 trainers, 2 gym
// owners) use the LIVE backend at the same instant, each sending exactly the
// requests the app sends, to find what breaks only when people act together.
// The owner's real phone can join as an 11th participant (optional flags).
//
//   node scripts/sim/run.mjs --dry                 plan + wiring check, zero network
//   node scripts/sim/run.mjs                       full live run, cleans up after itself
//   node scripts/sim/run.mjs --only daypass        setup + that phase (+ its deps) + cleanup
//   node scripts/sim/run.mjs --phone-trainer <id> --phone-gym <gymId> --phone-code <code> --phone-wait 60
//
// Safety rules (scripts/sim/README.md): public key only; every actor is an
// anonymous session named «TEST …» / @sim_<runId>_…; nothing of a real person
// is read or written, except the owner's own test account (@yghh) through its
// public trainer listing and its gym's check-in code; every actor deletes
// itself through delete_my_account() at the end, on error and on Ctrl+C.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as act from './actions.mjs';
import {
  ROOT,
  SIM_DIR,
  Recorder,
  USERNAME_RE,
  abortState,
  bakuMinutes,
  errInfo,
  expect,
  info,
  loadEnv,
  makeActor,
  round,
  setRecorder,
  sleep,
  together,
  unreachable,
  validateAnchors,
  writeReport,
} from './lib.mjs';

const REPORT_PATH = resolve(SIM_DIR, 'last-report.json');
const ALL_ACTORS = ['u1', 'u2', 'u3', 'u4', 'u5', 't1', 't2', 't3', 'g1', 'g2'];
const ROLE_OF = { u: 'user', t: 'trainer', g: 'gym' };
// Central Baku: Fountain Square and the Nizami metro area.
const COORDS = { g1: { lat: 40.3717, lng: 49.8379 }, g2: { lat: 40.3794, lng: 49.8303 } };

// ------------------------------------------------------------------ CLI ----

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    [
      'usage: node scripts/sim/run.mjs [--dry] [--keep] [--only <phase>]',
      '                                [--phone-trainer <trainerId>] [--phone-gym <gymId> --phone-code <gymCheckinCode>]',
      '                                [--phone-username <handle>] [--phone-owner-profile <profileUuid>] [--phone-wait <seconds>]',
      '',
      `phases: ${PHASES.map((p) => p.name).join(', ')}`,
    ].join('\n')
  );
  process.exit(2);
}

function parseArgs(argv) {
  const o = { dry: false, keep: false, only: null, phoneTrainer: null, phoneGym: null, phoneCode: null, phoneUsername: 'yghh', phoneOwnerProfile: null, phoneWait: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) usage(`${a} needs a value`);
      return v;
    };
    if (a === '--dry') o.dry = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '--only') o.only = val();
    else if (a === '--phone-trainer') o.phoneTrainer = val();
    else if (a === '--phone-gym') o.phoneGym = val();
    else if (a === '--phone-code') o.phoneCode = val();
    else if (a === '--phone-username') o.phoneUsername = val().replace(/^@/, '');
    else if (a === '--phone-owner-profile') o.phoneOwnerProfile = val().toLowerCase();
    else if (a === '--phone-wait') o.phoneWait = Number(val());
    else if (a === '--help' || a === '-h') usage();
    else usage(`unknown flag ${a}`);
  }
  if (o.only && !PHASE_BY_NAME[o.only]) usage(`unknown phase «${o.only}»`);
  // The social phase does not run under --keep (its TEST post would stay public
  // in the İcma feed; only delete_my_account removes it), so this pair would run nothing.
  if (o.keep && o.only === 'social') usage('--keep cannot be combined with --only social: the TEST post is public in the İcma feed and only goes when u1 deletes its account — the app has no delete-post path');
  if (o.phoneTrainer && !/^[A-Za-z0-9_-]{3,64}$/.test(o.phoneTrainer)) usage('--phone-trainer must be a trainer id');
  if (o.phoneCode && !/^[A-Za-z0-9]{4,32}$/.test(o.phoneCode)) usage('--phone-code must be the gym check-in code (letters/digits)');
  // A door code cannot be checked before it is used (only the gym's owner can
  // read gym_checkin_codes), so the gym it must open is required: its owner is
  // proven first, and the first check-in's gym_id is compared with it.
  if (o.phoneCode && !o.phoneGym) usage('--phone-code needs --phone-gym <gymId>: the gym the code must open, so its owner can be checked first');
  if (o.phoneGym && !o.phoneCode) usage('--phone-gym is only used together with --phone-code');
  if (o.phoneGym && !/^[A-Za-z0-9_-]{2,64}$/.test(o.phoneGym)) usage('--phone-gym must be a gym id');
  if (o.phoneOwnerProfile && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(o.phoneOwnerProfile)) usage('--phone-owner-profile must be a profile uuid');
  if (!Number.isFinite(o.phoneWait) || o.phoneWait < 0 || o.phoneWait > 600) usage('--phone-wait must be 0…600 seconds');
  return o;
}

// --------------------------------------------------------------- helpers ----

const short = (id) => (id ? String(id).slice(0, 8) : '—');
const msgOf = (r) => r?.error?.message ?? 'unknown error';
const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => null)]);

async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return true;
    await sleep(100);
  }
  return cond();
}

/** Actors a phase needs, checked before it starts. A phase whose actors did
 *  not survive setup is reported UNREACHABLE rather than half-run. */
function need(ctx, phase, keys, extra = {}) {
  const missing = keys.filter((k) => {
    const a = ctx.actors.get(k);
    if (!a?.ready) return true;
    if (a.role === 'trainer' && extra.trainer !== false && !a.trainerId) return true;
    // A gym actor always needs its gym; the door code only where the phase
    // scans it (`gym: false` — e.g. day passes never touch gym_checkin_codes).
    if (a.role === 'gym' && !a.gymId) return true;
    if (a.role === 'gym' && extra.gym !== false && !ctx.state.gyms[k]?.code) return true;
    return false;
  });
  if (missing.length) {
    unreachable(`${phase}.actors`, `phase skipped: ${missing.join(', ')} did not finish setup`);
    return false;
  }
  return true;
}

const A = (ctx, k) => ctx.actors.get(k);

/**
 * Is this listing the owner's own test account? Checked by @handle when the
 * owner's profile is readable, and by profile uuid when one is known
 * (--phone-owner-profile, or the owner id a verified trainer listing gave).
 * Every known signal must agree and at least one must be known — a hidden
 * profile alone is never taken as a yes.
 */
function ownerMatches(ctx, probe, knownOwnerId = null) {
  const want = ctx.opts.phoneUsername.toLowerCase();
  const byName = probe.ownerUsername != null ? probe.ownerUsername.toLowerCase() === want : null;
  const refId = ctx.opts.phoneOwnerProfile ?? knownOwnerId;
  const byId = refId ? probe.ownerProfileId === refId : null;
  return byName !== false && byId !== false && (byName === true || byId === true);
}

function ownerProblem(ctx, probe) {
  if (!probe.ok) return msgOf(probe);
  if (!probe.ownerProfileId) return 'it has no owner';
  if (probe.ownerUnreadable) {
    return `owner profile not visible to members (show_in_gym_list off?)${ctx.opts.phoneOwnerProfile ? ' and its owner id is not --phone-owner-profile' : ' — pass --phone-owner-profile <uuid> to check it by owner id'}`;
  }
  if (String(probe.ownerUsername).toLowerCase() === ctx.opts.phoneUsername.toLowerCase()) {
    return `the handle matches, but its owner id ${probe.ownerProfileId} is not the expected profile`;
  }
  return `it belongs to @${probe.ownerUsername}`;
}

/** The TEST coaches switch «Kəşfdə görün» off (idempotent). A public TEST
 *  listing is a trap for a real person: whatever they send it is
 *  cascade-deleted when the TEST account deletes itself. */
async function unlistTrainers(ctx, label, keys = null) {
  const coaches = [...ctx.actors.values()].filter((a) => a.trainerId && !a.deleted && a.userId && (!keys || keys.includes(a.key)));
  if (!coaches.length) return [];
  const s = await together(label, coaches.map((a) => ({ actor: a, fn: () => act.unlistMe(a) })));
  return s.results;
}

// ============================================================== phases ====

async function phaseSetup(ctx) {
  const all = [...ctx.actors.values()];

  // 1 — ten phones open SPOT for the first time at the same instant.
  const s1 = await together(
    'first launch: anonymous session + bootstrap reads',
    all.map((a) => ({ actor: a, fn: () => act.bootstrap(a) }))
  );
  for (const r of s1.results) {
    const a = A(ctx, r.actor);
    if (a.profileId) ctx.simIds.add(a.profileId);
    expect(r.ok && !!a.userId, `setup.session.${a.key}`, r.ok ? `anonymous session ${short(a.userId)}` : `no session: ${msgOf(r)}`, r.ok ? { triggerProfile: r.triggerProfileName } : r.error);
  }
  const uids = all.map((a) => a.userId).filter(Boolean);
  expect(new Set(uids).size === uids.length, 'setup.sessions-distinct', `${uids.length} sessions, ${new Set(uids).size} distinct auth users`);

  // 2 — everybody registers (name + @ad + age) at the same instant.
  const withSession = all.filter((a) => a.userId);
  const s2 = await together(
    'registration: name + @username + age (onboarding/profile.tsx)',
    withSession.map((a) => ({ actor: a, fn: () => act.register(a, { name: a.name, username: a.username, age: 20 + a.idx }) }))
  );
  for (const r of s2.results) {
    const a = A(ctx, r.actor);
    if (a.profileId) ctx.simIds.add(a.profileId);
    a.ready = !!(r.ok && a.profileId);
    expect(a.ready, `setup.register.${a.key}`, a.ready ? `@${a.username} saved (profile ${short(a.profileId)})` : `registration failed (${r.path ?? 'error'}): ${msgOf(r)}`, r.ok ? null : r.error);
  }
  const ready = all.filter((a) => a.ready);
  const back = await together(
    'registration read-back (what the next launch loads)',
    ready.map((a) => ({ actor: a, fn: () => act.getMyProfile(a) }))
  );
  for (const r of back.results) {
    const a = A(ctx, r.actor);
    const p = r.profile;
    expect(!!p && p.username === a.username && p.name === a.name, `setup.readback.${a.key}`, p ? `server holds «${p.name}» @${p.username}` : `profile not readable: ${msgOf(r)}`);
  }

  // 3 — the owner's phone, if involved: prove the listing is theirs BEFORE any request goes to it.
  const guard = ready.find((a) => a.role === 'user');
  const noGuard = { ok: false, error: { message: 'no registered user to check with' } };
  if (ctx.opts.phoneTrainer) {
    const g = guard ? await act.probePhoneTrainer(guard, ctx.opts.phoneTrainer) : noGuard;
    const okOwner = g.ok && g.listed && ownerMatches(ctx, g);
    ctx.phone.trainerOk = okOwner;
    ctx.phone.ownerProfileId = okOwner ? g.ownerProfileId : null;
    expect(
      okOwner,
      'setup.phone-trainer-guard',
      okOwner
        ? `phone trainer ${short(ctx.opts.phoneTrainer)} is the public listing of @${ctx.opts.phoneUsername} — requests may go to it`
        : `phone trainer NOT used: ${g.ok && !g.listed ? 'the listing is not public' : ownerProblem(ctx, g)}; expected @${ctx.opts.phoneUsername}`
    );
  }
  // The phone's gym: its owner is proven before the code is ever used.
  if (ctx.opts.phoneCode) {
    const g = guard ? await act.probePhoneGym(guard, ctx.opts.phoneGym) : noGuard;
    const okOwner = g.ok && ownerMatches(ctx, g, ctx.phone.ownerProfileId);
    ctx.phone.gymOk = okOwner;
    expect(
      okOwner,
      'setup.phone-gym-guard',
      okOwner
        ? `phone gym ${ctx.opts.phoneGym} belongs to @${ctx.opts.phoneUsername} — its code may be used (one check-in first, then its gym is compared)`
        : `phone gym NOT used, no check-in sent with the code: ${ownerProblem(ctx, g)}; expected @${ctx.opts.phoneUsername}`
    );
  }

  // 4 — three coaches publish their listing at the same instant.
  const trainers = ready.filter((a) => a.role === 'trainer');
  if (trainers.length) {
    const s3 = await together(
      'become trainer (become-trainer.tsx publishTrainer)',
      trainers.map((a) => ({
        actor: a,
        fn: () => act.becomeTrainer(a, { specialty: 'TEST ixtisas', bio: `TEST — simulyasiya müəllimi (run ${ctx.runId}), sonda silinir`, priceFrom: 10 }),
      }))
    );
    for (const r of s3.results) {
      const a = A(ctx, r.actor);
      expect(r.ok && !!a.trainerId, `setup.trainer.${a.key}`, r.ok ? `listing ${short(a.trainerId)} written, verification ${r.verificationQueued ? 'queued' : 'already queued'}` : `publishTrainer failed: ${msgOf(r)}`, r.ok ? null : r.error);
      if (r.ok) expect(r.listedLanded === true, `setup.trainer-listed-write.${a.key}`, r.listedLanded ? 'the listed:true update after the insert came back with its row' : 'the listed:true update returned no row — the listing stays hidden while the screen says «yaradıldı»');
    }
    const s3b = await together(
      'trainer listing read-back (panel switch + public page)',
      trainers.filter((a) => a.trainerId).map((a) => ({
        actor: a,
        fn: async () => {
          const l = await act.getMyListing(a);
          const p = await act.openTrainerPage(a, a.trainerId);
          return { ok: l.ok && p.ok, error: l.error ?? p.error, listing: l.listing, page: p.trainer };
        },
      }))
    );
    for (const r of s3b.results) {
      const a = A(ctx, r.actor);
      expect(r.listing?.listed === true, `setup.trainer-public.${a.key}`, r.listing?.listed ? 'the app\'s publish landed (listed=true)' : `listing not public: ${JSON.stringify(r.listing)}`);
      expect(r.page?.verify_status === 'pending', `setup.trainer-verification.${a.key}`, `verify_status = ${r.page?.verify_status ?? '—'} (the verification row should move it to pending)`);
    }
    // Publishing is proven — now take the TEST coaches out of Kəşf at once, so no
    // real person can find one and lose what they send it to the cascade.
    const off = await unlistTrainers(ctx, 'TEST coaches switch «Kəşfdə görün» off (setMyListed(false))');
    for (const r of off) {
      expect(r.ok && r.listed === false, `setup.trainer-unlisted.${r.actor}`, r.ok ? 'listing hidden again (listed=false came back): public for a few seconds only' : `could NOT unlist: ${msgOf(r)} — the TEST listing stays in Kəşf until cleanup`);
    }
  }

  // 5 — two owners register their gyms at the same instant.
  const owners = ready.filter((a) => a.role === 'gym');
  if (owners.length) {
    const gymInput = (a) => ({
      name: `TEST ${a.key} zal ${ctx.runId}`,
      district: 'TEST Səbail',
      hours: '24 saat',
      priceMonth: 0,
      dayPass: 0,
      amenities: [],
      ...COORDS[a.key],
    });
    const s4 = await together(
      'create gym (create-gym.tsx: createGym + pin)',
      owners.map((a) => ({ actor: a, fn: () => act.createGym(a, gymInput(a)) }))
    );
    const collided = s4.results.filter((r) => r.idCollision);
    expect(
      collided.length === 0,
      'setup.gym-id-unique',
      collided.length
        ? `${collided.length} owner(s) got «duplicate key gyms_pkey»: gym ids are usr-<Date.now() in base36>, so two owners pressing «yarat» in the same millisecond collide and the app says «bağlantını yoxla»`
        : `ids ${s4.results.map((r) => r.gymId).join(', ')} distinct`,
      collided.length ? collided.map((r) => ({ actor: r.actor, id: r.gymId, error: r.error })) : null
    );
    for (const r of s4.results) {
      const a = A(ctx, r.actor);
      let res = r;
      if (!r.ok && r.idCollision) {
        // What the person would do: read the toast and press the button again —
        // a human beat later, so the millisecond clock has moved on.
        await sleep(400);
        res = await act.createGym(a, gymInput(a));
        expect(res.ok, `setup.gym-retry.${a.key}`, res.ok ? `second press created ${res.gymId}` : `second press failed too: ${msgOf(res)}`);
      }
      expect(res.ok && !!a.gymId, `setup.gym.${a.key}`, res.ok ? `gym ${a.gymId} created, pin ${res.locSaved ? 'saved' : 'NOT saved'}` : `createGym failed: ${msgOf(res)}`, res.ok ? null : res.error);
      if (res.ok) expect(res.locSaved, `setup.gym-pin.${a.key}`, res.locSaved ? 'lat/lng update returned its row' : `pin not saved: ${res.locError?.message ?? 'zero rows'}`);
    }
    const panel = await together(
      'gym panel opens (useMyGym → fetchMyGym)',
      owners.filter((a) => a.gymId).map((a) => ({ actor: a, fn: () => act.fetchMyGym(a) }))
    );
    for (const r of panel.results) {
      const a = A(ctx, r.actor);
      expect(r.gym?.id === a.gymId, `setup.gym-panel.${a.key}`, r.gym ? `panel resolves ${r.gym.id}` : `panel finds no gym: ${msgOf(r)}`);
      if (r.gym) info(`setup.gym-unlisted.${a.key}`, `listed=${r.gym.listed}: an app-created gym is hidden from everyone but its owner until an admin publishes it`);
    }
    const qr = await together(
      'check-in code: open «Zal kodu», press «Kod yarat»',
      owners.filter((a) => a.gymId).map((a) => ({
        actor: a,
        prep: () => act.openQrScreen(a, a.gymId),
        fn: async (prep) => {
          const r = await act.rotateCheckinCode(a, a.gymId);
          return { ...r, before: prep?.state ?? null };
        },
      }))
    );
    for (const r of qr.results) {
      const a = A(ctx, r.actor);
      if (r.ok) ctx.state.gyms[a.key] = { id: a.gymId, code: r.code };
      expect(r.ok && !!r.code, `setup.gym-code.${a.key}`, r.ok ? `QR screen was «${r.before}», code created` : `no code: ${msgOf(r)}`);
    }
  }
}

async function phaseRaceUsername(ctx) {
  if (!need(ctx, 'race-username', ['u4', 'u5'])) return;
  const u4 = A(ctx, 'u4');
  const u5 = A(ctx, 'u5');
  const handle = `sim_${ctx.runId}_race`;
  if (!USERNAME_RE.test(handle)) throw new Error(`bad race handle ${handle}`);
  const olds = { u4: u4.username, u5: u5.username };

  const race = await together(
    `u4 and u5 save @${handle} at the same instant (Profil → Redaktə)`,
    [u4, u5].map((a) => ({ actor: a, fn: () => act.changeUsername(a, handle) }))
  );
  // saveProfile() answers 'local' when the request never reached the server
  // (timeout / failed to fetch — including the harness's own 20 s abort). That
  // is not a win: the handle is only on that phone. Counted apart, so an unsent
  // save can neither fake a second winner nor pass as a told-taken loser.
  const winners = race.results.filter((r) => r.ok && r.result === 'saved');
  const unsent = race.results.filter((r) => r.ok && r.result !== 'saved');
  const losers = race.results.filter((r) => !r.ok);
  const detail = race.results.map((r) => ({ actor: r.actor, ok: r.ok, result: r.result ?? null, path: r.path ?? null, error: r.error }));
  for (const u of unsent) {
    info(`race-username.not-sent.${u.actor}`, `save never reached the server (${u.result}) — the phone keeps @${handle} and says «Yadda saxlanıldı — hələlik yalnız bu cihazda»`);
  }
  if (unsent.length) {
    expect(winners.length <= 1, 'race-username.exactly-one-wins', `${winners.length} saved, ${unsent.length} not sent (unreachable) — the race is inconclusive, but there must never be two winners`, detail);
  } else {
    expect(winners.length === 1, 'race-username.exactly-one-wins', `${winners.length} of 2 saved the handle`, detail);
  }
  for (const l of losers) {
    expect(
      l.taken || l.conflict,
      `race-username.loser-told-taken.${l.actor}`,
      l.taken
        ? 'loser was stopped by the username_taken pre-check → «Bu istifadəçi adı tutulub»'
        : l.conflict
          ? 'loser got the unique violation (23505) → isUsernameConflict → «Bu istifadəçi adı tutulub»'
          : `loser got something else — the app would say «internet bağlantını yoxla»: ${msgOf(l)}`,
      { path: l.path, error: l.error }
    );
  }
  if (winners.length === 1) {
    info('race-username.path', `the race was decided by the ${losers[0]?.path === 'precheck' ? 'pre-check (the winner had already committed)' : 'unique index (both pre-checks said «free»)'}`);
  }
  const reads = await together(
    'both re-read their profile',
    [u4, u5].map((a) => ({ actor: a, fn: () => act.getMyProfile(a) }))
  );
  for (const r of reads.results) {
    const a = A(ctx, r.actor);
    const won = winners.some((w) => w.actor === a.key);
    if (unsent.some((u) => u.actor === a.key)) {
      // Whether an unsent save landed after all (a response lost, not the
      // request) is unknown — report what the server holds, judge nothing.
      info(`race-username.server-state.${a.key}`, `save was not confirmed; server holds @${r.profile?.username ?? '—'}`);
      expect(a.store.profile.username === handle, `race-username.phone-state.${a.key}`, `phone shows @${a.store.profile.username} (an unsent save stays on the phone)`);
      if (r.profile?.username === handle) a.username = handle;
      continue;
    }
    const want = won ? handle : olds[a.key];
    expect(r.profile?.username === want, `race-username.server-state.${a.key}`, `server @${r.profile?.username ?? '—'} (expected @${want})`);
    expect(a.store.profile.username === want, `race-username.phone-state.${a.key}`, `phone shows @${a.store.profile.username} (the screen puts the old handle back on refusal)`);
    if (won) a.username = handle;
  }
  // username_taken() leaves the caller's own row out, so ask as somebody who does not hold it.
  const asker = A(ctx, 'u1')?.ready ? A(ctx, 'u1') : A(ctx, losers[0]?.actor) ?? u4;
  const check = await act.usernameTaken(asker, handle);
  if (winners.length) expect(check.ok && check.taken === true, 'race-username.now-taken', `username_taken(@${handle}) answers ${check.taken}`);
  else info('race-username.now-taken', `no confirmed winner; username_taken(@${handle}) answers ${check.taken ?? msgOf(check)}`);
}

async function phaseRaceRequests(ctx) {
  const userKeys = ['u1', 'u2', 'u3', 'u4', 'u5'];
  if (!need(ctx, 'race-requests', [...userKeys, 't1'])) return;
  const t1 = A(ctx, 't1');
  const users = userKeys.map((k) => A(ctx, k));
  const note = `TEST sorğu ${ctx.runId}`;
  const preferred = `Bu gün ${new Date().getDate()} · 19:00`;
  const phoneId = ctx.phone.trainerOk ? ctx.opts.phoneTrainer : null;

  const tasks = users.map((u) => ({
    actor: u,
    label: `${u.key}→t1`,
    prep: () => act.openReserveScreen(u, t1.trainerId),
    fn: () => act.requestTrainer(u, t1.trainerId, note, preferred),
  }));
  tasks.push({ actor: users[0], label: 'u1→t1 (double tap)', fn: () => act.requestTrainer(users[0], t1.trainerId, note, preferred) });
  if (phoneId) {
    for (const u of users) {
      tasks.push({ actor: u, label: `${u.key}→phone`, fn: () => act.requestTrainer(u, phoneId, `TEST SPOT simulyasiya ${ctx.runId} — avtomatik silinəcək`, preferred) });
    }
  }
  const race = await together(`5 users send t1 a request at the same instant${phoneId ? ' (and the phone trainer)' : ''}`, tasks);
  const byLabel = new Map(race.results.map((r) => [r.label, r]));
  for (const u of users) {
    const r = byLabel.get(`${u.key}→t1`);
    expect(r.ok, `race-requests.sent.${u.key}`, r.ok ? `request ${short(r.requestId)} written` : `refused: ${msgOf(r)}`, r.ok ? null : r.error);
  }
  const dbl = byLabel.get('u1→t1 (double tap)');
  const first = byLabel.get('u1→t1');
  expect(dbl.ok && first.ok && dbl.requestId === first.requestId, 'race-requests.double-tap-one-row', dbl.ok ? `double tap landed on the same row (${short(dbl.requestId)} / ${short(first.requestId)})` : `double tap refused: ${msgOf(dbl)}`);
  if (phoneId) {
    for (const u of users) {
      const r = byLabel.get(`${u.key}→phone`);
      ctx.phone.requests += r.ok ? 1 : 0;
      expect(r.ok, `race-requests.phone.${u.key}`, r.ok ? 'request reached the phone trainer' : `refused: ${msgOf(r)}`);
    }
  }

  const reads = await together(
    'each user re-reads their request (reserve screen)',
    users.map((u) => ({ actor: u, fn: () => act.getMyRequestTo(u, t1.trainerId) }))
  );
  for (const r of reads.results) {
    expect(r.request?.status === 'pending', `race-requests.user-sees-pending.${r.actor}`, `status ${r.request?.status ?? '—'}`);
  }

  const s = await act.getMyStudents(t1, ctx.simIds);
  const pendingIds = (s.pending ?? []).map((p) => p.profileId);
  const dupes = pendingIds.length - new Set(pendingIds).size;
  const lost = users.filter((u) => !pendingIds.includes(u.profileId)).map((u) => u.key);
  expect(
    s.ok && dupes === 0 && lost.length === 0 && pendingIds.length === users.length,
    'race-requests.t1-sees-exactly',
    s.ok ? `t1's «Şagirdlər» shows ${pendingIds.length} pending (expected ${users.length}), ${dupes} duplicate(s), lost: ${lost.join(', ') || 'none'}` : `t1 could not load students: ${msgOf(s)}`
  );
  expect((s.active ?? []).length === 0, 'race-requests.none-active-yet', `${(s.active ?? []).length} active`);
  if (s.foreign) info('race-requests.foreign', `${s.foreign} request(s) from real people to TEST t1 were counted and ignored (never read)`);
  ctx.state.requestIds = Object.fromEntries((s.pending ?? []).map((p) => [p.profileId, p.requestId]));

  const page = await act.openTrainerPage(users[0], t1.trainerId);
  expect(page.trainer?.clients === 0, 'race-requests.public-clients-0', `public listing says clients=${page.trainer?.clients ?? '—'}`);

  for (const k of ['t2', 't3']) {
    const t = A(ctx, k);
    if (!t?.trainerId) continue;
    const other = await act.getMyStudents(t, ctx.simIds);
    expect(other.ok && !(other.pending ?? []).length && !(other.active ?? []).length, `race-requests.no-cross-trainer-leak.${k}`, `${k} sees ${(other.pending ?? []).length} pending / ${(other.active ?? []).length} active (t1's requests must not appear)`);
  }

  if (phoneId) {
    const pr = await together('each user re-reads the request to the phone trainer', users.map((u) => ({ actor: u, fn: () => act.getMyRequestTo(u, phoneId) })));
    for (const r of pr.results) info(`race-requests.phone-status.${r.actor}`, `request to the phone trainer: ${r.request?.status ?? msgOf(r)}`);
  }
}

async function phaseDecide(ctx) {
  const userKeys = ['u1', 'u2', 'u3', 'u4', 'u5'];
  if (!need(ctx, 'decide-concurrently', [...userKeys, 't1'])) return;
  const t1 = A(ctx, 't1');
  const [u1, u2, u3, u4, u5] = userKeys.map((k) => A(ctx, k));

  // The trainer opens «Şagirdlər»; the ids on screen are what the buttons send.
  const panel = await act.getMyStudents(t1, ctx.simIds);
  const idOf = (u) => (panel.pending ?? []).find((p) => p.profileId === u.profileId)?.requestId ?? null;
  const decisions = [
    [u1, true],
    [u2, true],
    [u3, true],
    [u4, false],
  ];
  const missing = decisions.filter(([u]) => !idOf(u)).map(([u]) => u.key);
  if (missing.length) {
    expect(false, 'decide-concurrently.requests-visible', `t1's panel has no pending request from ${missing.join(', ')}`);
    return;
  }
  const step = await together(
    't1 accepts u1, u2, u3 and declines u4 at the same instant',
    decisions.map(([u, acc]) => ({ actor: t1, label: `${acc ? 'accept' : 'decline'} ${u.key}`, fn: () => act.decideTrainerRequest(t1, idOf(u), acc) }))
  );
  for (const r of step.results) expect(r.ok, `decide-concurrently.${r.label.replace(' ', '-')}`, r.ok ? 'row came back (decision landed)' : `refused: ${msgOf(r)}`);

  const want = { u1: 'accepted', u2: 'accepted', u3: 'accepted', u4: 'declined', u5: 'pending' };
  const reads = await together(
    'every user re-reads their own request',
    [u1, u2, u3, u4, u5].map((u) => ({ actor: u, fn: () => act.getMyRequestTo(u, t1.trainerId) }))
  );
  for (const r of reads.results) {
    const st = r.request?.status;
    const decided = want[r.actor] !== 'pending';
    expect(st === want[r.actor] && (!decided || !!r.request?.decided_at), `decide-concurrently.user-state.${r.actor}`, `${r.actor} sees «${st ?? '—'}» (expected «${want[r.actor]}»)${decided ? `, decided_at ${r.request?.decided_at ? 'stamped' : 'MISSING'}` : ''}`);
  }

  const after = await act.getMyStudents(t1, ctx.simIds);
  const pend = (after.pending ?? []).map((p) => p.profileId);
  const actv = (after.active ?? []).map((p) => p.profileId);
  expect(pend.length === 1 && pend[0] === u5.profileId, 'decide-concurrently.t1-pending', `t1 pending: ${pend.length} (expected 1: u5)`);
  expect(actv.length === 3 && [u1, u2, u3].every((u) => actv.includes(u.profileId)), 'decide-concurrently.t1-active', `t1 active: ${actv.length} (expected 3: u1, u2, u3)`);
  ctx.state.active = Object.fromEntries((after.active ?? []).map((s) => [s.profileId, s.requestId]));

  const page = await act.openTrainerPage(u5, t1.trainerId);
  const clients = page.trainer?.clients;
  expect(
    clients === actv.length,
    'decide-concurrently.public-clients',
    clients === actv.length
      ? `public listing says clients=${clients}, matching the ${actv.length} accepted`
      : `public listing says clients=${clients} but ${actv.length} are accepted — refresh_trainer_clients() recounts inside each concurrent transaction and one recount overwrote another`,
    { clients, accepted: actv.length }
  );

  // A declined student tries to overturn the decision herself.
  const self = await act.probeWrite(u4, (c) => c.from('trainer_requests').update({ status: 'accepted' }).eq('id', idOf(u4)).select('id'));
  expect(self.count === 0, 'decide-concurrently.student-cannot-self-accept', self.count === 0 ? `refused (${self.error?.message ?? 'zero rows'})` : 'u4 ACCEPTED HER OWN declined request');

  // An ACCEPTED student sends the request again through the app's own
  // requestTrainer. The reserve screen hides the form once a request is
  // accepted — but when its request read failed it shows the form over an
  // accepted row (reserve/[id].tsx:58-64), and the upsert lands on that row.
  // trainer_requests_guard lets the student set 'pending' from ANY status.
  const again = await act.requestTrainer(u3, t1.trainerId, `TEST sorğu ${ctx.runId}`, `Bu gün ${new Date().getDate()} · 19:00`);
  const u3now = await act.getMyRequestTo(u3, t1.trainerId);
  const reset = await act.getMyStudents(t1, ctx.simIds);
  const actNow = (reset.active ?? []).length;
  const wasReset = u3now.request?.status === 'pending';
  expect(
    !wasReset,
    'decide-concurrently.accepted-cannot-reset',
    wasReset
      ? `u3's ACCEPTED request went back to «pending» through requestTrainer's upsert (the guard allows pending from any status): decided_at ${u3now.request?.decided_at ? 'kept' : 'cleared'}, t1's active ${actv.length} → ${actNow}, and t1 is not told`
      : `the re-send did not reopen it (${again.ok ? `status stays «${u3now.request?.status ?? '—'}»` : msgOf(again)})`,
    { sendOk: again.ok, status: u3now.request?.status ?? null, activeBefore: actv.length, activeAfter: actNow }
  );
  if (wasReset) {
    // Put the arrangement back so the later phases start from the state they expect.
    const re = await act.decideTrainerRequest(t1, idOf(u3), true);
    expect(re.ok, 'decide-concurrently.re-accept-u3', re.ok ? 't1 accepted u3 again' : `re-accept failed: ${msgOf(re)}`);
  }
  const final = await act.getMyStudents(t1, ctx.simIds);
  ctx.state.active = Object.fromEntries((final.active ?? []).map((s) => [s.profileId, s.requestId]));
}

async function phaseProgramChat(ctx) {
  if (!need(ctx, 'program-chat', ['t1', 'u1', 'u2'])) return;
  const t1 = A(ctx, 't1');
  const u1 = A(ctx, 'u1');
  const u2 = A(ctx, 'u2');

  // 1 — the program: the app only lets a trainer assign one of THEIR programs,
  //     so the coaches write one with the builder first (workout/create.tsx).
  //     All three press «Yadda saxla» at once: the device mints the id from a
  //     millisecond clock (mine-<Date.now() base36>, synchronously, before any
  //     await), the same bug class as the gym ids in setup.
  const programInput = (t) => ({
    title: `TEST proqram ${t.key} ${ctx.runId}`,
    desc: 'TEST — simulyasiya, sonda silinir',
    days: [
      {
        key: 'd1',
        title: 'Gün 1',
        focus: '',
        items: [{ key: 'i1', exerciseId: 'bench', name: 'Ştanqla bench press', muscle: 'Sinə', sets: 3, mode: 'reps', value: '8-10', videoUrl: null }],
      },
    ],
  });
  const coaches = ['t1', 't2', 't3'].map((k) => A(ctx, k)).filter((t) => t?.ready && t.trainerId);
  const saves = await together(
    `${coaches.map((t) => t.key).join(', ')} save a program at the same instant (builder «Yadda saxla»)`,
    coaches.map((t) => ({ actor: t, fn: () => act.createProgram(t, programInput(t)) }))
  );
  for (const r of saves.results) if (r.id) ctx.state.programs.push({ actor: r.actor, id: r.id, result: r.result ?? null });
  const byActor = new Map(saves.results.map((r) => [r.actor, r]));
  const ids = saves.results.map((r) => r.id).filter(Boolean);
  const collided = saves.results.filter((r) => !r.ok && r.error?.code === '23505');
  expect(
    collided.length === 0 && new Set(ids).size === ids.length && saves.results.every((r) => r.ok && r.result === 'saved'),
    'program-chat.program-ids-unique',
    collided.length
      ? `${collided.map((r) => `${r.actor}'s ${r.id}`).join(', ')} hit «duplicate key» (23505): saveProgram keeps it «local» under an id whose SERVER row is another coach's — assigning it links the student to that other program, and openProgram(id) opens a program this coach does not own`
      : `ids ${ids.join(', ')} distinct, all saved`,
    saves.results.map((r) => ({ actor: r.actor, id: r.id ?? null, result: r.result ?? null, error: r.error }))
  );

  const t1Save = byActor.get('t1');
  const t1Title = programInput(t1).title;
  // The id t1's phone holds: saved, or kept «local» after a 23505 — the app still
  // lists it in myPrograms and the assign screen offers it (student/[id].tsx:103-108).
  const t1ProgId = t1Save && (t1Save.ok || (t1Save.result === 'local' && t1Save.error?.code === '23505')) ? t1Save.id : null;
  expect(t1Save?.ok && t1Save.result === 'saved', 'program-chat.program-saved', t1Save?.ok ? `t1's program ${t1Save.id} on the server` : `t1's builder save ended «${t1Save?.result ?? '—'}»: ${msgOf(t1Save)}`);
  if (t1ProgId) {
    ctx.state.programId = t1ProgId;
    const panel = await act.getMyStudents(t1, ctx.simIds);
    const student = (panel.active ?? []).find((s) => s.profileId === u1.profileId);
    expect(!!student, 'program-chat.u1-in-active-list', student ? 'u1 is in t1\'s active students' : 'u1 is not an active student — the assign screen cannot open');
    if (student) {
      const asg = await act.assignStudentProgram(t1, { studentId: u1.profileId, programId: t1ProgId, title: t1Title, note: 'TEST qeyd' });
      expect(asg.ok, 'program-chat.assigned', asg.ok ? 'student_programs row came back' : `refused: ${msgOf(asg)}`);
      const [mine, other] = await Promise.all([act.getMyAssignedProgram(u1), act.getMyAssignedProgram(u2)]);
      const m = mine.assigned;
      expect(
        !!m && m.programId === t1ProgId && m.title === t1Title && m.trainerId === t1.trainerId && m.trainerName === t1.name,
        'program-chat.u1-reads-assignment',
        m ? `u1's Məşq card: «${m.title}» by «${m.trainerName}», program ${m.programId}` : `u1 sees no assignment: ${msgOf(mine)}`
      );
      expect(other.ok && !other.assigned, 'program-chat.u2-has-none', other.assigned ? `u2 sees an assignment: «${other.assigned.title}»` : 'u2 sees no assignment');
      const page = await act.openProgram(u1, t1ProgId);
      const owner = page.program?.owner_id ?? null;
      const ownerKey = [...ctx.actors.values()].find((a) => a.profileId && a.profileId === owner)?.key ?? (owner ? 'someone outside this run' : 'nobody');
      expect(
        page.program?.id === t1ProgId && owner === t1.profileId,
        'program-chat.u1-opens-t1s-program',
        !page.program
          ? `program not readable: ${msgOf(page)}`
          : owner === t1.profileId
            ? 'the program page opens for the student, and it is t1\'s'
            : `u1 opened program ${t1ProgId}, but its author is ${ownerKey}, not t1 — the id collision linked the student to another coach's program`
      );
    }
  } else {
    unreachable('program-chat.assign', `t1 holds no program id the app would assign (save ended «${t1Save?.result ?? '—'}» without a 23505): a program that never reached the server cannot be opened by the student`);
  }

  // 2 — both sides send their FIRST message at the same instant.
  const texts = { t1: `TEST salam, u1 (${ctx.runId})`, u1: `TEST salam, müəllim (${ctx.runId})` };
  const chat = await together('first message from both sides at the same instant (chat/[id].tsx)', [
    { actor: t1, label: 't1→u1', prep: () => act.openChatScreen(t1, u1.profileId), fn: (p) => act.sendChatMessage(t1, u1.profileId, p?.threadId ?? null, texts.t1) },
    { actor: u1, label: 'u1→t1', prep: () => act.openChatScreen(u1, t1.profileId), fn: (p) => act.sendChatMessage(u1, t1.profileId, p?.threadId ?? null, texts.u1) },
  ]);
  const failed = chat.results.filter((r) => !r.ok);
  // What the person reads, not the internal code. open_thread does
  // SELECT-then-INSERT with no ON CONFLICT, so the loser of two simultaneous
  // opens gets 23505 on chat_threads_pair — and refusalOf() maps any
  // «violates» to 'sanctioned'.
  const seen = (f) => {
    const text = act.chatRefusalText(f.refusal);
    const lostOpen = f.error?.code === '23505' && /chat_threads_pair/.test(f.error?.message ?? '');
    return lostOpen
      ? `${f.label}: concurrent open_thread lost the unique race (23505 chat_threads_pair); the app mislabels it as a sanction and shows «${text}»`
      : `${f.label}: ${msgOf(f)} — the screen shows «${text}»`;
  };
  expect(
    failed.length === 0,
    'program-chat.first-message-race',
    failed.length ? failed.map(seen).join('; ') : 'both first messages were delivered',
    failed.length ? failed.map((f) => ({ label: f.label, refusal: f.refusal, shown: act.chatRefusalText(f.refusal), error: f.error })) : null
  );
  let sent = chat.results.filter((r) => r.ok).length;
  const side = Object.fromEntries(chat.results.map((r) => [r.actor, r.ok ? r.threadId : null]));
  for (const f of failed) {
    // The screen still holds no thread id, so pressing «Göndər» again opens it again.
    const a = A(ctx, f.actor);
    const other = a.key === 't1' ? u1.profileId : t1.profileId;
    const retry = await act.sendChatMessage(a, other, null, texts[a.key]);
    expect(retry.ok, `program-chat.retry.${a.key}`, retry.ok ? 'pressing «Göndər» again worked' : `second press failed too: ${seen({ ...retry, label: a.key })}`);
    if (retry.ok) {
      sent += 1;
      side[a.key] = retry.threadId;
    }
  }
  // Also when one side needed the retry: both must end up in the same thread.
  if (side.t1 && side.u1) expect(side.t1 === side.u1, 'program-chat.one-thread', side.t1 === side.u1 ? 'one thread for the pair' : `TWO threads: ${side.t1} / ${side.u1}`);
  const threadId = side.t1 ?? side.u1 ?? chat.results.map((r) => r.threadId).find(Boolean) ?? null;
  if (!threadId) {
    unreachable('program-chat.thread', 'no thread was opened — the rest of the chat checks cannot run');
    return;
  }
  ctx.state.threadId = threadId;

  // 3 — live delivery: u1 has the chat open; u2 subscribes to the same thread id as an eavesdropper.
  const got = { u1: [], u2: [] };
  const subU1 = act.subscribeToThread(u1, threadId, (m) => got.u1.push(m));
  const subU2 = act.subscribeToThread(u2, threadId, (m) => got.u2.push(m));
  const [st1, st2] = await Promise.all([withTimeout(subU1.subscribed, 10000), withTimeout(subU2.subscribed, 10000)]);
  // SUBSCRIBED comes a moment before the server streams changes; a message sent
  // in that moment is covered by the app's re-read on ready (chat.ts), not by
  // realtime. Wait it out so this check measures the live feed itself.
  await sleep(1500);
  const second = await act.sendChatMessage(t1, u1.profileId, threadId, `TEST ikinci mesaj (${ctx.runId})`);
  expect(second.ok, 'program-chat.second-message', second.ok ? 't1\'s second message passed the one-until-reply gate (u1 had answered)' : `refused: ${msgOf(second)}`);
  if (second.ok) sent += 1;
  if (st1?.status === 'SUBSCRIBED' && second.ok) {
    const arrived = await waitFor(() => got.u1.some((m) => m.id === second.message.id), 8000);
    expect(arrived, 'program-chat.realtime-delivers', arrived ? 'u1\'s open chat received the message live' : 'u1\'s open chat never received it within 8 s');
  } else {
    unreachable('program-chat.realtime-delivers', `u1's realtime channel ended as «${st1?.status ?? 'no answer in 10 s'}»${st1?.error ? `: ${st1.error.message}` : ''}`);
  }
  if (st2?.status === 'SUBSCRIBED') {
    await sleep(1500);
    expect(got.u2.length === 0, 'program-chat.realtime-private', got.u2.length ? `u2 RECEIVED ${got.u2.length} message(s) of the t1–u1 thread live` : 'u2 subscribed to the thread id and received nothing');
  } else {
    info('program-chat.realtime-private', `u2's channel ended as «${st2?.status ?? 'no answer'}» — nothing could be delivered to it`);
  }
  await Promise.all([subU1.unsubscribe(), subU2.unsubscribe()]);

  // 4 — u1 reads the whole thread and marks it read.
  const msgs = await act.getMessages(u1, threadId);
  const senders = new Set((msgs.rows ?? []).map((m) => m.senderId));
  expect(
    msgs.ok && msgs.rows.length === sent && senders.has(t1.profileId) && senders.has(u1.profileId),
    'program-chat.u1-reads-all',
    msgs.ok ? `u1 reads ${msgs.rows.length} message(s) (${sent} were delivered), from ${senders.size} sender(s)` : `read failed: ${msgOf(msgs)}`
  );
  const rd = await act.markThreadRead(u1, threadId);
  expect(rd.ok, 'program-chat.mark-read', rd.ok ? 'marked read' : `failed: ${msgOf(rd)}`);

  // 5 — u2 (another student of the same trainer) must see none of it.
  const p1 = await act.getMessages(u2, threadId);
  expect(!p1.ok || p1.rows.length === 0, 'program-chat.u2-cannot-read-messages', p1.ok ? `${p1.rows.length} row(s) visible` : `refused (${msgOf(p1)})`);
  const p2 = await act.probeRead(u2, (c) => c.from('chat_threads').select('id').eq('id', threadId));
  expect(p2.count === 0, 'program-chat.u2-cannot-see-thread', `${p2.count} row(s) visible`);
  const p3 = await act.sendMessage(u2, threadId, 'TEST intrusion');
  expect(!p3.ok, 'program-chat.u2-cannot-post', p3.ok ? 'u2 WROTE INTO the t1–u1 thread' : `refused (${msgOf(p3)}; the chat screen would label it «${p3.refusal}»)`);
  const p4 = await act.getMyThreads(u2, ctx.simIds);
  expect(p4.ok && !(p4.threads ?? []).some((t) => t.threadId === threadId), 'program-chat.u2-inbox-clean', p4.ok ? `u2's inbox has ${(p4.threads ?? []).length} thread(s), none of them t1–u1` : `inbox failed: ${msgOf(p4)}`);
  const p5 = await act.openThread(u2, u1.profileId);
  expect(!p5.ok && p5.refusal === 'no_relationship', 'program-chat.u2-cannot-open-u1', p5.ok ? 'u2 OPENED a thread with u1 (no relationship)' : `refused: ${p5.refusal}`);

  // 6 — «one message until the other side replies» under a race. messages_gate
  //     counts the sender's earlier rows without a lock, so two first messages
  //     sent at the same instant can both see 0. On the phone only the chat
  //     screen's local `sending` flag stands in the way — a second device or a
  //     direct call does not have it.
  const u3 = A(ctx, 'u3');
  if (u3?.ready && ctx.state.active?.[u3.profileId]) {
    const open = await act.openThread(u3, t1.profileId);
    if (!open.ok) {
      expect(false, 'program-chat.gate-thread', `u3 (accepted) could not open a thread with t1: ${seen({ ...open, label: 'u3→t1' })}`);
    } else {
      const two = await together(
        'u3 sends two first messages to t1 at the same instant (one-until-reply gate)',
        [1, 2].map((i) => ({ actor: u3, label: `u3 message #${i}`, fn: () => act.sendMessage(u3, open.threadId, `TEST ilk mesaj ${i} (${ctx.runId})`) }))
      );
      const landed = two.results.filter((r) => r.ok).length;
      const gated = two.results.filter((r) => !r.ok && r.refusal === 'wait_for_reply').length;
      expect(
        landed === 1 && gated === 1,
        'program-chat.one-until-reply-under-race',
        landed === 2
          ? 'BOTH first messages landed: messages_gate counts earlier rows without a lock, so simultaneous sends each see none — the anti-spam rule holds only one tap at a time'
          : `${landed} landed, ${gated} refused with wait_for_reply${two.results.some((r) => !r.ok && r.refusal !== 'wait_for_reply') ? ` (other: ${two.results.filter((r) => !r.ok && r.refusal !== 'wait_for_reply').map((r) => msgOf(r)).join('; ')})` : ''}`,
        two.results.map((r) => ({ label: r.label, ok: r.ok, refusal: r.refusal ?? null, error: r.error?.message ?? null }))
      );
    }
  } else {
    unreachable('program-chat.one-until-reply-under-race', 'needs u3 as an accepted student of t1 (decide-concurrently did not leave it so)');
  }
}

async function phaseCheckins(ctx) {
  const userKeys = ['u1', 'u2', 'u3', 'u4', 'u5'];
  if (!need(ctx, 'checkins-vs-rotate', [...userKeys, 'g1'])) return;
  // The gym-day turns at 04:00 Baku (check_ins.gym_day) and the owner panel's
  // «bu gün» at 00:00 Baku (getGymOccupancy). A run straddling either edge
  // would flake the daily cap or the occupancy count, so it is not run there.
  const m = bakuMinutes();
  const edge = [0, 240].find((e) => Math.min(Math.abs(m - e), 1440 - Math.abs(m - e)) < 5);
  if (edge !== undefined) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    unreachable('checkins-vs-rotate.clock', `Baku time is ${hhmm}, within 5 minutes of ${edge ? '04:00 (the gym-day turns)' : '00:00 (the panel\'s «bu gün» turns)'} — the counts would flake; phase not run, re-run a few minutes later`);
    return;
  }
  const g1 = A(ctx, 'g1');
  const users = userKeys.map((k) => A(ctx, k));
  const gymId = g1.gymId;
  const code0 = ctx.state.gyms.g1.code;
  const phoneCode = ctx.phone.gymOk ? ctx.opts.phoneCode : null;
  // One check-in per person per gym-day at ANY gym (check_ins_one_per_gym_day),
  // so the people who go to the phone's gym cannot also check in at g1.
  const atG1 = phoneCode ? users.slice(0, 3) : users;
  const atPhone = phoneCode ? users.slice(3) : [];

  const tasks = [
    ...atG1.map((u) => ({ actor: u, label: `${u.key} scans g1`, fn: () => act.checkInWithCode(u, code0) })),
    { actor: g1, label: 'g1 rotates', prep: () => act.openQrScreen(g1, gymId), fn: () => act.rotateCheckinCode(g1, gymId) },
  ];
  const race = await together(`${atG1.length} check-ins at g1 while g1 rotates its code`, tasks);
  const rot = race.results.find((r) => r.label === 'g1 rotates');
  expect(rot.ok && !!rot.code && rot.code !== code0, 'checkins-vs-rotate.rotated', rot.ok ? 'new code issued' : `rotation failed: ${msgOf(rot)}`);
  const code1 = rot.ok ? rot.code : code0;

  const g1Results = race.results.filter((r) => r.label.endsWith('scans g1'));
  const landed = new Set(g1Results.filter((r) => r.ok).map((r) => r.actor));
  const odd = g1Results.filter((r) => !r.ok && r.refusal !== 'checkin_bad_code');
  expect(odd.length === 0, 'checkins-vs-rotate.two-outcomes-only', odd.length ? `unexpected refusal(s): ${odd.map((r) => `${r.actor}: ${r.refusal} ${msgOf(r)}`).join('; ')}` : 'every scan either landed or met the new code (checkin_bad_code)');
  const wrongGym = g1Results.filter((r) => r.ok && r.gymId !== gymId);
  expect(wrongGym.length === 0, 'checkins-vs-rotate.right-gym', wrongGym.length ? `${wrongGym.length} check-in(s) landed at another gym` : 'every success names g1');
  info('checkins-vs-rotate.race-outcome', `${landed.size} scan(s) landed before the rotation, ${g1Results.length - landed.size} met the new code`);

  if (rot.ok) {
    const dead = await act.checkInWithCode(users[0], code0);
    expect(!dead.ok && dead.refusal === 'checkin_bad_code', 'checkins-vs-rotate.old-code-dead', dead.ok ? 'the OLD code still checked somebody in' : `old code refused: ${dead.refusal}`);
  }
  const bounced = atG1.filter((u) => !landed.has(u.key));
  if (bounced.length) {
    const retry = await together('the bounced ones scan the new sign', bounced.map((u) => ({ actor: u, fn: () => act.checkInWithCode(u, code1) })));
    for (const r of retry.results) {
      expect(r.ok, `checkins-vs-rotate.new-code-works.${r.actor}`, r.ok ? 'checked in with the new code' : `refused: ${r.refusal} ${msgOf(r)}`);
      if (r.ok) landed.add(r.actor);
    }
  }
  const someoneIn = atG1.find((u) => landed.has(u.key));
  if (someoneIn) {
    const again = await act.checkInWithCode(someoneIn, code1);
    expect(!again.ok && again.refusal === 'checkin_already_today', 'checkins-vs-rotate.daily-cap', again.ok ? 'a SECOND check-in the same gym-day was accepted (the day turns at 04:00 Baku)' : `second scan refused: ${again.refusal}`);
  }
  const qr = await act.openQrScreen(g1, gymId);
  expect(qr.code === code1, 'checkins-vs-rotate.qr-shows-new-code', qr.code === code1 ? '«Zal kodu» shows the new code' : `QR screen shows ${qr.code ?? qr.state}`);
  ctx.state.gyms.g1.code = code1;
  ctx.state.landedAtG1 = [...landed];

  const dash = await act.gymDashboard(g1, gymId);
  const occ = dash.occupancy;
  expect(
    !!occ && occ.today === landed.size && occ.now === landed.size,
    'checkins-vs-rotate.occupancy-matches',
    occ ? `panel: İNDİ ZALDA ${occ.now}, bu gün ${occ.today} — ${landed.size} check-in(s) really landed` : `occupancy failed: ${dash.error?.message}`
  );
  expect(Array.isArray(dash.roster) && dash.roster.length === 0, 'checkins-vs-rotate.roster-home-members', `roster (home-gym members) = ${dash.roster?.length ?? dash.error?.message}; nobody's home gym is g1`);
  unreachable(
    'checkins-vs-rotate.roster-here-now',
    "the roster lists people whose HOME gym is g1; Profil → Redaktə offers listed gyms only and an app-created gym is unlisted (schema41), so no virtual user can pick g1 — the roster's «indi zalda» flag cannot be exercised honestly"
  );

  // The phone's gym: outside the g1 race, one person at a time. The first
  // check-in's gym_id is compared with the verified --phone-gym BEFORE the
  // second is sent — a wrong code puts at most one TEST check-in into somebody
  // else's gym (and it goes with that actor's account at cleanup).
  if (atPhone.length) {
    const [first, ...rest] = atPhone;
    const r1 = await act.checkInWithCode(first, phoneCode);
    const right = r1.ok && r1.gymId === ctx.opts.phoneGym;
    expect(
      !r1.ok || right,
      'checkins-vs-rotate.phone-gym-guard',
      !r1.ok
        ? `${first.key}'s check-in with the phone code was refused (${r1.refusal}) — the others are not sent`
        : right
          ? `${first.key} checked in at «${r1.gymName}», the verified phone gym`
          : `the phone code opened ANOTHER gym than --phone-gym — nobody else is sent; ${first.key}'s check-in goes with its account at cleanup`
    );
    if (r1.ok && right) ctx.phone.checkins += 1;
    if (!r1.ok) info(`checkins-vs-rotate.phone.${first.key}`, `refused: ${r1.refusal} ${msgOf(r1)}`);
    if (right) {
      for (const u of rest) {
        const r = await act.checkInWithCode(u, phoneCode);
        const same = r.ok && r.gymId === ctx.opts.phoneGym;
        if (same) ctx.phone.checkins += 1;
        info(`checkins-vs-rotate.phone.${u.key}`, r.ok ? (same ? `checked in at «${r.gymName}»` : 'landed at a different gym than the first one') : `refused: ${r.refusal} ${msgOf(r)}`);
        if (r.ok && !same) break;
      }
    }
  }
}

async function phaseDaypass(ctx) {
  // No door code needed: the day-pass flow never touches gym_checkin_codes.
  if (!need(ctx, 'daypass', ['g2', 'u2', 'u3', 'u4'], { gym: false })) return;
  const g2 = A(ctx, 'g2');
  const [u2, u3, u4] = ['u2', 'u3', 'u4'].map((k) => A(ctx, k));
  const gymId = g2.gymId;

  // 1 — the owner sets a day-pass price on «Zal profili».
  const loaded = await act.fetchMyGym(g2);
  if (!loaded.gym) {
    expect(false, 'daypass.panel', `g2's panel does not load: ${msgOf(loaded)}`);
    return;
  }
  const e1 = await act.editGym(g2, loaded.gym, { dayPass: 7 });
  expect(e1.ok && e1.extrasSaved, 'daypass.price-saved', e1.ok ? 'day_pass = 7 saved (row came back)' : `save failed: ${msgOf(e1)}`);

  // 2 — a member opens the gym page and takes a pass.
  const page = await act.openGymPage(u2, gymId);
  if (!page.gym) {
    unreachable(
      'daypass.ui-path',
      'u2 cannot open the TEST gym page: an app-created gym is unlisted (gyms_read), so «Day-pass al» is unreachable in the UI. The checks below call create_day_pass — the exact RPC that button sends — directly.'
    );
  }
  const before = await act.getMyDayPass(u2, gymId);
  expect(before.ok && !before.pass, 'daypass.none-before', before.ok ? 'no live pass yet' : `read failed: ${msgOf(before)}`);
  const p2 = await act.createDayPass(u2, gymId);
  expect(p2.ok && p2.pass.price === 7 && !p2.pass.reused, 'daypass.u2-created', p2.ok ? `pass ${p2.pass.code}, price ${p2.pass.price}, reused=${p2.pass.reused}` : `refused: ${msgOf(p2)}`);
  if (p2.ok) {
    ctx.state.dayPassCode = p2.pass.code;
    ctx.state.dayPasses += 1;
    if (!page.gym) info('daypass.unlisted-gym-issues-passes', 'create_day_pass issued a pass for an UNLISTED gym — the RPC does not look at gyms.listed');
  }

  // 3 — the owner switches day passes (and the member tab) off while u4 presses «Day-pass al».
  const fresh = (await act.fetchMyGym(g2)).gym ?? loaded.gym;
  const race = await together('g2 switches day-pass off while u4 asks for one', [
    { actor: g2, label: 'g2 switches off', fn: () => act.editGym(g2, fresh, { allowDayPass: false, showMembers: false }) },
    { actor: u4, label: 'u4 create_day_pass', fn: () => act.createDayPass(u4, gymId) },
  ]);
  const [off, u4r] = race.results;
  expect(off.ok && off.extrasSaved, 'daypass.switches-saved', off.ok ? (off.extrasSaved ? 'allow_day_pass=false, show_members=false saved' : `core saved but the switches were NOT (${off.extrasError?.message ?? 'zero rows'})`) : `save failed: ${msgOf(off)}`);
  expect(u4r.ok || u4r.error?.message === 'day_pass_off', 'daypass.race-consistent', u4r.ok ? `u4 got pass ${u4r.pass.code} (the request won the race)` : u4r.error?.message === 'day_pass_off' ? 'u4 was refused with day_pass_off (the switch won the race)' : `u4 got neither: ${msgOf(u4r)}`);
  if (u4r.ok) ctx.state.dayPasses += 1;

  // 4 — strictly after the switch.
  const u3r = await act.createDayPass(u3, gymId);
  expect(!u3r.ok && u3r.error?.message === 'day_pass_off', 'daypass.off-refuses-new', u3r.ok ? `u3 GOT a pass (${u3r.pass.code}) after the owner switched passes off` : `u3 refused: ${msgOf(u3r)}`);
  if (u3r.ok) ctx.state.dayPasses += 1;
  if (p2.ok) {
    const still = await act.getMyDayPass(u2, gymId);
    expect(still.pass?.code === p2.pass.code, 'daypass.existing-pass-kept', still.pass ? `u2 still holds ${still.pass.code}` : `u2's pass is gone: ${msgOf(still)}`);
    const again = await act.createDayPass(u2, gymId);
    expect(again.ok && again.pass.reused && again.pass.code === p2.pass.code, 'daypass.reused-while-off', again.ok ? `pressing again returns the same pass (reused=${again.pass.reused})` : `refused: ${msgOf(again)}`);
    const chk = await act.checkDayPass(g2, p2.pass.code);
    expect(chk.check?.state === 'valid', 'daypass.reception-valid', `reception «Yoxla»: ${chk.check?.state ?? msgOf(chk)}`);
    const g1 = A(ctx, 'g1');
    if (g1?.ready && g1.gymId) {
      const x = await act.checkDayPass(g1, p2.pass.code);
      expect(x.check?.state === 'not_found', 'daypass.other-gym-cannot-lookup', `g1 looking up g2's pass: ${x.check?.state ?? msgOf(x)}`);
    }
  }
  if (u4r.ok) {
    const chk4 = await act.checkDayPass(g2, u4r.pass.code);
    expect(chk4.check?.state === 'valid', 'daypass.race-pass-valid', `u4's race pass at reception: ${chk4.check?.state ?? msgOf(chk4)}`);
  }

  // 5 — what the owner's panel shows now.
  const after = await act.fetchMyGym(g2);
  expect(after.gym?.allowDayPass === false && after.gym?.showMembers === false, 'daypass.switches-read-back', `panel reads allow_day_pass=${after.gym?.allowDayPass}, show_members=${after.gym?.showMembers}`);
  const dash = await act.gymDashboard(g2, gymId);
  const issued = ctx.state.dayPasses;
  expect(dash.dayPasses?.live === issued, 'daypass.panel-live-count', `panel: ${dash.dayPasses?.live ?? dash.error?.message} live pass(es), ${issued} issued`);
}

async function phasePrivacy(ctx) {
  if (!need(ctx, 'privacy', ['g1', 'u1', 'u5', 't1'])) return;
  const g1 = A(ctx, 'g1');
  const u1 = A(ctx, 'u1');
  const u5 = A(ctx, 'u5');
  const t1 = A(ctx, 't1');
  const u2 = A(ctx, 'u2');

  // u1's private training data, written the way a finished session writes it.
  const w = await act.finishWorkout(u1, { title: 'TEST məşq', durationSec: 1800, volumeKg: 2400, setsDone: 12, prs: [{ lift: 'Bench', value: 60 }] });
  expect(w.ok, 'privacy.u1-workout-logged', w.ok ? 'workout + PR written' : `failed: ${msgOf(w)}`);
  const control = await act.probeRead(u1, (c) => c.from('workouts').select('id').eq('profile_id', u1.profileId));
  expect(control.count >= 1, 'privacy.control-owner-reads', `u1 reads ${control.count} own workout row(s) — so a 0 below is RLS, not an empty table`);

  const threadId = ctx.state.threadId;
  const probes = [
    ['workouts', (c) => c.from('workouts').select('id').eq('profile_id', u1.profileId)],
    ['prs', (c) => c.from('prs').select('id').eq('profile_id', u1.profileId)],
    ['progress', (c) => c.from('progress').select('id').eq('profile_id', u1.profileId)],
    ['chat-threads', (c) => c.from('chat_threads').select('id').or(`a_profile.eq.${u1.profileId},b_profile.eq.${u1.profileId}`)],
    ...(threadId ? [['messages', (c) => c.from('messages').select('id').eq('thread_id', threadId)]] : []),
    ['student-programs', (c) => c.from('student_programs').select('id').eq('student_id', u1.profileId)],
    ['trainer-requests', (c) => c.from('trainer_requests').select('id').eq('from_profile', u1.profileId)],
    ['notifications', (c) => c.from('notifications').select('id').eq('profile_id', u1.profileId)],
    ['push-tokens', (c) => c.from('push_tokens').select('profile_id').eq('profile_id', u1.profileId)],
    ...(u2?.userId ? [['day-passes-of-u2', (c) => c.from('day_passes').select('id').eq('user_id', u2.userId)]] : []),
  ];
  const results = await together(
    'g1 (the gym u1 checked in at) reads u1\'s private data',
    probes.map(([label, build]) => ({ actor: g1, label, fn: () => act.probeRead(g1, build) }))
  );
  for (const r of results.results) {
    expect(r.count === 0, `privacy.g1-${r.label}`, r.refused ? `refused (${msgOf(r)})` : `${r.count} row(s) visible`);
  }
  info('privacy.progress-photos', 'the schema has no progress-photo table; `progress` holds bodyweight and has no app writer left, so its probe proves the policy on an empty set only');
  const byDesign = await act.probeRead(g1, (c) => c.from('check_ins').select('id').eq('profile_id', u1.profileId));
  info('privacy.g1-sees-checkins-at-own-gym', `g1 sees ${byDesign.count} check-in(s) of u1 — by design (check_ins_read: the owner sees check-ins at their gym)`);

  const r5 = await act.probeRead(u5, (c) => c.from('trainer_requests').select('id,from_profile').eq('trainer_id', t1.trainerId));
  const others = (r5.rows ?? []).filter((r) => r.from_profile !== u5.profileId);
  expect(others.length === 0, 'privacy.u5-cannot-read-others-requests', `u5 sees ${others.length} request(s) of other students to t1 (own: ${(r5.rows ?? []).length - others.length})`);
  const r5b = await act.probeRead(u5, (c) => c.from('student_programs').select('id').eq('trainer_id', t1.trainerId));
  expect(r5b.count === 0, 'privacy.u5-cannot-read-assignments', `u5 sees ${r5b.count} of t1's program assignments`);

  // u1 tries the owner's «Zal profili → Yadda saxla» on somebody else's gym.
  const fakeForm = { id: g1.gymId, name: 'TEST HACKED', district: '', hours: '24 saat', about: '', priceMonth: 0, dayPass: 0, amenities: [], allowDayPass: true, showMembers: true };
  const hack = await act.editGym(u1, fakeForm, {});
  expect(!hack.ok && hack.error?.message === 'gym-not-saved', 'privacy.u1-cannot-edit-g1', hack.ok ? 'u1 EDITED g1' : `refused (${msgOf(hack)})`);
  // listed:false on purpose: t1 is already unlisted, so even a broken policy
  // could not make a TEST listing public through this probe.
  const unlist = await act.probeWrite(u1, (c) => c.from('trainers').update({ listed: false }).eq('id', t1.trainerId).select('id'));
  expect(unlist.count === 0, 'privacy.u1-cannot-write-t1-listing', unlist.count ? 'u1 WROTE to t1\'s listing' : `refused (${unlist.error?.message ?? 'zero rows'})`);
  const rot = await act.rotateCheckinCode(u1, g1.gymId);
  expect(!rot.ok, 'privacy.u1-cannot-rotate-g1-code', rot.ok ? 'u1 ROTATED g1\'s door code' : `refused (${msgOf(rot)})`);
  const code = await act.probeRead(u5, (c) => c.from('gym_checkin_codes').select('code').eq('gym_id', g1.gymId));
  expect(code.count === 0, 'privacy.u5-cannot-read-door-code', `u5 sees ${code.count} code row(s) of g1`);
  if (ctx.state.dayPassCode) {
    const x = await act.checkDayPass(u1, ctx.state.dayPassCode);
    expect(x.check?.state === 'not_found' || !x.ok, 'privacy.u1-cannot-lookup-pass', `u1 (no gym) looking up u2's pass: ${x.check?.state ?? msgOf(x)}`);
  }

  // Reviews. The UI never sends one below 3 check-ins — the composer renders only
  // at myCheckins >= 3 (discover/gym/[id].tsx:925), below that it shows «Rəy
  // yazmaq üçün {n} check-in qalıb». So these are SERVER-RULE probes with the
  // app's own payload: what a direct API call gets, not a path a user can take.
  const checkinsAtG1 = (ctx.state.landedAtG1 ?? []).includes('u1') ? 1 : 0;
  const isRls = (r) => r.error?.code === '42501' || /row-level security/i.test(r.error?.message ?? '');
  const rv = await act.submitReview(u1, g1.gymId, { rating: 5, body: 'TEST rəy', myCheckins: checkinsAtG1 });
  if (rv.ok) ctx.state.reviewsWritten.push({ key: u1.key, gymId: g1.gymId });
  expect(
    !rv.ok && isRls(rv),
    'privacy.server-refuses-review-below-3',
    rv.ok
      ? `a review was ACCEPTED with ${checkinsAtG1} check-in(s)`
      : isRls(rv)
        ? `refused by reviews_insert / can_review_gym (${checkinsAtG1} of 3 check-ins); the UI hides the composer below 3, so no real user can send this`
        : `refused, but not by the 3-check-in rule: ${msgOf(rv)}`
  );
  // A forged official reply. The server does NOT refuse one: reviews_stamp
  // (BEFORE INSERT) blanks reply/reply_at and restamps name and tenure. Below 3
  // check-ins the insert is refused by reviews_insert first, so the stripping is
  // never reached here; «refused» must not be read as «forged reply blocked».
  const forged = await act.probeForgedReview(u1, g1.gymId);
  if (forged.ok) {
    ctx.state.reviewsWritten.push({ key: u1.key, gymId: g1.gymId });
    expect(false, 'privacy.forged-review-below-3', `the forged review was ACCEPTED with ${checkinsAtG1} check-in(s) — the 3-check-in rule did not hold`);
    // Accepted after all, so judge what was stored: reply blank, tenure real.
    const back = await act.probeRead(u1, (c) => c.from('reviews').select('id,reply,reply_at,tenure').eq('gym_id', g1.gymId).eq('author_id', u1.profileId));
    const row = (back.rows ?? []).find((r) => r.reply != null) ?? back.rows?.[0];
    expect(
      !!row && row.reply == null && row.reply_at == null && row.tenure === `${checkinsAtG1} check-in edib`,
      'privacy.forged-reply-stripped',
      row ? `stored reply ${row.reply == null ? 'NULL' : 'KEPT (forged official answer is public)'}, tenure «${row.tenure}» (real count ${checkinsAtG1})` : `row not readable: ${msgOf(back)}`
    );
  } else {
    expect(isRls(forged), 'privacy.forged-review-below-3', isRls(forged) ? 'refused by the 3-check-in rule (reviews_insert) — before the forged reply is ever judged' : `refused, but not by the 3-check-in rule: ${msgOf(forged)}`);
    unreachable(
      'privacy.forged-reply-stripped',
      'refused by the 3-check-in rule; forged-reply stripping not exercised. reviews_stamp blanks reply/reply_at and restamps name/tenure (it does not refuse); reaching it live needs 3 gym-days of check-ins — supabase/schema80_reviews_stamp.sql records the rolled-back proof'
    );
  }
  unreachable('privacy.review-happy-path', 'a review needs 3 check-ins at the gym, and check_ins_one_per_gym_day allows ONE check-in per person per gym-day at any gym (the day turns at 04:00 Baku) — three gym-days; faking check-ins with privileged SQL is forbidden');
  unreachable('privacy.owner-reply', 'the owner reply (gym/reviews.tsx → replyToReview) needs a real review first — see review-happy-path');
}

async function phaseEndStudent(ctx) {
  if (!need(ctx, 'end-student', ['t1', 'u2'])) return;
  const t1 = A(ctx, 't1');
  const u2 = A(ctx, 'u2');
  const before = await act.getMyStudents(t1, ctx.simIds);
  const s = (before.active ?? []).find((x) => x.profileId === u2.profileId);
  if (!s) {
    expect(false, 'end-student.u2-active', `u2 is not an active student of t1 (${msgOf(before)})`);
    return;
  }
  // The confirm dialog promises the assigned program stays on the student's
  // «Məşq» tab after an end (endStudent leaves student_programs alone) — give u2
  // one first so that promise is checked too.
  const asgTitle = `TEST proqram u2 ${ctx.runId}`;
  const asg = await act.assignStudentProgram(t1, { studentId: u2.profileId, programId: ctx.state.programId ?? null, title: asgTitle, note: 'TEST qeyd' });
  expect(asg.ok, 'end-student.assigned-before-end', asg.ok ? 'u2 has an assignment before the end' : `assign refused: ${msgOf(asg)}`);

  // One phone cannot do this: the end sits behind a confirm dialog and an
  // `ending` guard (trainer/student/[id].tsx:127, :136). Two devices of the same
  // coach — or a stale screen — can, and the .eq('status','accepted') guard is
  // what must let exactly one through.
  const ends = await together('two devices end u2 at once', [0, 1].map((i) => ({ actor: t1, label: `device ${i + 1} ends`, fn: () => act.endStudent(t1, s.requestId) })));
  const oks = ends.results.filter((r) => r.ok).length;
  expect(oks === 1, 'end-student.exactly-one-end', `${oks} of 2 ends came back with the row (the .eq('status','accepted') guard should let exactly one through)`, ends.results.map((r) => ({ label: r.label, ok: r.ok, error: r.error?.message })));
  const mine = await act.getMyRequestTo(u2, t1.trainerId);
  expect(
    mine.request?.status === 'ended' && !!mine.request?.decided_at,
    'end-student.u2-sees-ended',
    `u2 sees «${mine.request?.status ?? msgOf(mine)}», decided_at ${mine.request?.decided_at ? 'stamped' : 'MISSING'}`
  );
  const after = await act.getMyStudents(t1, ctx.simIds);
  const n0 = (before.active ?? []).length;
  const n1 = (after.active ?? []).length;
  expect(n1 === n0 - 1 && !(after.active ?? []).some((x) => x.profileId === u2.profileId), 'end-student.active-drops', `t1 active ${n0} → ${n1}`);
  const page = await act.openTrainerPage(u2, t1.trainerId);
  expect(page.trainer?.clients === n1, 'end-student.public-clients', `public listing clients=${page.trainer?.clients ?? '—'}, active=${n1}`);

  // What 'ended' means (roles.ts endStudent): the coach can no longer START a
  // thread with this person, and the assignment stays.
  const open = await act.openThread(t1, u2.profileId);
  expect(!open.ok && open.refusal === 'no_relationship', 'end-student.no-new-thread', open.ok ? 't1 OPENED a thread with an ended student' : `refused: ${open.refusal} → «${act.chatRefusalText(open.refusal)}»`);
  if (asg.ok) {
    const kept = await act.getMyAssignedProgram(u2);
    expect(kept.assigned?.title === asgTitle, 'end-student.assignment-stays', kept.assigned ? `u2's Məşq card still shows «${kept.assigned.title}» (as the dialog says)` : `u2's assignment is gone: ${msgOf(kept)}`);
  }
}

/**
 * Likes, comments, follows, partner requests (u4 ↔ u5 crossing, u2 → u3 one-way)
 * and the notifications they cause — ONLY on content this run's TEST actors
 * made: u1's own post, the TEST comments under it, follows and offers between
 * TEST actors. Nothing real is liked, commented, followed or joined; those flows
 * are UNREACHABLE by rule.
 */
async function phaseSocial(ctx) {
  if (ctx.opts.keep) {
    // --keep keeps the accounts, and the TEST post only goes with u1's account.
    unreachable('social.keep', 'not run under --keep: the TEST post would stay public in the İcma feed with no end date — the app has no delete-post path, only delete_my_account removes it — and real people could like, comment on or report it');
    return;
  }
  const userKeys = ['u1', 'u2', 'u3', 'u4', 'u5'];
  if (!need(ctx, 'social', userKeys)) return;
  ctx.state.socialRan = true;
  const [u1, u2, u3, u4, u5] = userKeys.map((k) => A(ctx, k));
  const users = [u1, u2, u3, u4, u5];
  const sim = [...ctx.simIds];
  const notSim = `(${sim.join(',')})`;
  const head = { count: 'exact', head: true };
  const keyOf = (pid) => [...ctx.actors.values()].find((a) => a.profileId && a.profileId === pid)?.key ?? 'outside-run';
  const list = (arr) => [...arr].sort().join(', ') || 'none';
  const sameSet = (got, want) => got.length === new Set(got).size && list(got) === list(want);

  // Did a step's writes really overlap? together() lines up when each action
  // STARTS; each then reads (auth.getUser, its profile row) before it writes, so
  // every racing step below also lines up the WRITES (alignWrite → sync) and the
  // recorder measures at the write itself. Client side that only says every
  // write was in flight at once; created_at defaults to now(), the start of the
  // writing transaction, so the rows say how close together the transactions
  // began inside the database. TX_MS is an ESTIMATE of one PostgREST write
  // transaction here (claims, RLS, the trigger, COMMIT), not a measurement —
  // the offsets are printed so the reader can judge.
  const TX_MS = 5;
  // timestamptz → ms, keeping the microseconds Date.parse drops.
  const tsMs = (iso) => {
    const m = /^(.*T\d\d:\d\d:\d\d)(\.\d+)?(.*)$/.exec(String(iso ?? ''));
    return m ? Date.parse(m[1] + m[3]) + (m[2] ? Number(m[2]) * 1000 : 0) : NaN;
  };
  // contended: true = overlapping at the database, false = not (or probably
  // not), null = in flight together but the database's side is not observable.
  // `isos`: the written rows' created_at; null when the write leaves none to read
  // (`unseen` says why), [] when they could not be read.
  const raceOf = (step, isos = null, unseen = 'a delete leaves no server timestamp') => {
    const w = step.write;
    if (!w || w.reached < 2) return { contended: false, text: `only ${w?.reached ?? 0} write(s) left, so nothing could overlap` };
    const client = `the ${w.reached} writes left within ${w.spreadMs} ms`;
    if (!(w.overlapMs > 0)) return { contended: false, text: `${client} but were never all in flight together (the first answer came ${round(-w.overlapMs)} ms before the last write left)` };
    const t = (isos ?? []).map(tsMs).filter(Number.isFinite).sort((x, y) => x - y);
    if (t.length < 2) {
      return { contended: null, text: `${client} and were all in flight together for ${w.overlapMs} ms (${isos ? 'the rows\' server times did not come back' : unseen}, so overlap inside the database is not observable)` };
    }
    const spread = round(t[t.length - 1] - t[0]);
    const offs = `created_at = now(); offsets ${t.map((x) => `+${round(x - t[0])}`).join(', ')} ms`;
    return spread <= TX_MS
      ? { contended: true, text: `${client}, were all in flight together for ${w.overlapMs} ms, and their transactions began within ${spread} ms of each other inside the database (${offs})` }
      : { contended: false, text: `${client} and were all in flight together for ${w.overlapMs} ms, yet their transactions began ${spread} ms apart inside the database (${offs}) — longer than one write transaction lasts (~${TX_MS} ms, an estimate), so they probably ran one after another` };
  };
  // What really landed — the notification checks expect exactly this, no more.
  // matchSends holds { by, to, status }: since schema84 a send can be written
  // 'pending' OR 'accepted', and the two cause different notifications.
  const landed = { postLikers: new Set(), likeNotifiers: new Set(), followers: new Set(), commentLikers: [], replied: null, matchSends: [], matchAccepts: [] };
  // actor key → id of the TEST comment it wrote under u1's post (scenario 2).
  const commentOf = {};

  unreachable('social.real-content', 'not exercised by rule: liking, commenting on or following a real person\'s post, video or profile would notify them and move public counters; every feed video belongs to a real person, and a TEST one would need a file upload');
  unreachable('social.challenge-join', 'not exercised by rule: joining an admin challenge changes its public participant count — and the app has dropped the join path (src/lib/social.ts:108-111)');

  // ---- 1 — a TEST post, then five hearts at the same instant --------------
  const body = `TEST post ${ctx.runId} — simulyasiya, sonda silinir`;
  const made = await act.createCommunityPost(u1, body);
  expect(made.ok, 'social.post-created', made.ok ? `community_posts insert accepted — «${made.shown}»` : `refused: ${msgOf(made)} — «${made.shown ?? 'Post göndərilə bilmədi. Yenidən cəhd et.'}»`, made.ok ? null : made.error);
  // The insert returns no row, so the id comes from the feed (filtered to u1's
  // own posts). Every own post found is recorded — one whose response was lost
  // too — so cleanup can prove all of them gone.
  const mine = await act.openFeedPostsBy(u1, u1.profileId);
  for (const p of mine.posts ?? []) if (!ctx.state.posts.includes(p.id)) ctx.state.posts.push(p.id);
  const post = (mine.posts ?? []).find((p) => p.text === body) ?? null;
  expect(
    !!post && post.authorId === u1.profileId && post.author === u1.name,
    'social.post-in-feed',
    post ? `the feed card reads «${post.author}» (stamped from the profile by community_posts_stamp_author), likes=${post.likes}` : `u1's post is not in the feed: ${mine.ok ? 'no such row' : msgOf(mine)}`
  );
  if (post) {
    info('social.post-public', 'the TEST post is public in the İcma feed (shown to people without a home gym) until u1 deletes its account at cleanup: the post menu offers «Şikayət et» / «Bu postu gizlət» only — the app has no delete-post path, though community_posts_owner_delete would allow one');
  } else {
    unreachable('social.post-flows', 'no TEST post — likes, comments and their notifications (scenarios 1, 2 and part of 5) cannot run');
  }

  if (post) {
    const likeTasks = users.map((u) => ({ actor: u, label: `${u.key} likes`, alignWrite: true, prep: () => act.myPostLikes(u, [post.id]), fn: (_p, sync) => act.likePost(u, post.id, { sync }) }));
    likeTasks.push({ actor: u4, label: 'u4 likes (second device)', alignWrite: true, fn: (_p, sync) => act.likePost(u4, post.id, { sync }) });
    const s1 = await together('u1–u5 like the TEST post at the same instant (u4 from two devices)', likeTasks);
    for (const r of s1.results) {
      if (r.ok) {
        landed.postLikers.add(r.actor);
        if (r.actor !== 'u1') landed.likeNotifiers.add(r.actor);
      }
      if (r.label.includes('second')) continue;
      expect(r.ok, `social.like.${r.actor}`, r.ok ? `like landed${r.duplicate ? ' (as a swallowed duplicate)' : ''}` : `refused: ${msgOf(r)} — the heart rolls back, «${r.shown ?? 'Bəyənmə göndərilmədi'}»`, r.ok ? null : r.error);
    }
    const pair = s1.results.filter((r) => r.actor === 'u4');
    const dupes = pair.filter((r) => r.duplicate).length;
    expect(
      pair.every((r) => r.ok) && dupes === 1,
      'social.like-double-tap',
      pair.every((r) => r.ok)
        ? dupes === 1
          ? 'both of u4\'s likes came back ok: one inserted, the other hit post_likes_pkey and likePost swallowed it as «duplicate» (liked is the end state)'
          : `both came back ok, but ${dupes} were duplicates (expected exactly 1)`
        : `a like failed: ${pair.filter((r) => !r.ok).map(msgOf).join('; ')}`,
      pair.map((r) => ({ label: r.label, ok: r.ok, duplicate: r.duplicate ?? null, error: r.error?.message ?? null }))
    );

    // community_posts.likes as the card shows it, against the rows themselves.
    const likeState = async (viewer) => {
      const [card, all, ours] = await Promise.all([
        act.openFeedPost(viewer, post.id),
        act.probeCount(viewer, (c) => c.from('post_likes').select('post_id', head).eq('post_id', post.id)),
        act.probeRead(viewer, (c) => c.from('post_likes').select('profile_id,created_at').eq('post_id', post.id).in('profile_id', sim)),
      ]);
      const likers = (ours.rows ?? []).map((r) => keyOf(r.profile_id));
      return {
        likes: card.post?.likes ?? null,
        rows: all.count,
        likers,
        // [] (not null) when the read failed: raceOf then says the times did not come back.
        starts: ours.ok ? ours.rows.map((r) => r.created_at) : [],
        foreign: all.count == null ? null : all.count - likers.length,
        error: card.error ?? all.error ?? ours.error ?? null,
      };
    };
    // One message per outcome, on the same condition as the check itself.
    const counterSays = (st, race, what) => {
      if (st.likes == null || st.rows == null) {
        return `could not compare: ${st.likes == null ? 'the post card' : 'the post_likes count'} did not load (${st.error?.message ?? 'no error text'})`;
      }
      if (st.likes !== st.rows) return `community_posts.likes = ${st.likes} but ${st.rows} post_likes row(s) after ${what} — the counter lost an update. ${race.text}`;
      if (race.contended === true) return `community_posts.likes = ${st.likes} = post_likes rows after ${what} — schema82's lock-then-count held under contention: ${race.text}`;
      if (race.contended === null) return `community_posts.likes = ${st.likes} = post_likes rows after ${what}: ${race.text}`;
      return `community_posts.likes = ${st.likes} = post_likes rows after ${what} — the counter is right, but this is no evidence that the lock held under contention: ${race.text}`;
    };
    const hearts = async (label, wantLiked) => {
      const h = await together(label, users.map((u) => ({ actor: u, fn: () => act.myPostLikes(u, [post.id]) })));
      return h.results.filter((r) => !r.ok || r.liked.includes(post.id) !== wantLiked.has(r.actor)).map((r) => (r.ok ? `${r.actor} ${r.liked.includes(post.id) ? 'filled' : 'empty'}` : `${r.actor}: ${msgOf(r)}`));
    };
    const st1 = await likeState(u2);
    const race1 = raceOf(s1.step, st1.starts);
    expect(st1.likes != null && st1.likes === st1.rows, 'social.likes-counter-matches', counterSays(st1, race1, `${s1.results.length} like taps`), { ...st1, write: s1.step.write, contended: race1.contended });
    if (race1.contended === false) info('social.likes-no-overlap', `the like inserts did not overlap inside the database, so social.likes-counter-matches is no evidence about schema82's lock — re-run for an overlapping round. ${race1.text}`);
    expect(sameSet(st1.likers, [...landed.postLikers]), 'social.likers-exact', `rows from ${list(st1.likers)} (expected ${list(landed.postLikers)}); u4 holds ${st1.likers.filter((k) => k === 'u4').length} row(s)`);
    if (st1.foreign > 0) info('social.likes-foreign', `${st1.foreign} like(s) on the TEST post came from outside this run (counted, never read) — they are deleted with the post at cleanup`);
    const wrong1 = await hearts('everyone re-reads which posts they liked (feed reconcile)', landed.postLikers);
    expect(wrong1.length === 0, 'social.hearts-after-like', wrong1.length ? `the server says otherwise for: ${wrong1.join('; ')}` : 'each person\'s heart matches the server');

    const s2 = await together('u2 and u3 unlike at the same instant', [u2, u3].map((u) => ({ actor: u, alignWrite: true, fn: (_p, sync) => act.unlikePost(u, post.id, { sync }) })));
    for (const r of s2.results) {
      expect(r.ok, `social.unlike.${r.actor}`, r.ok ? 'unlike sent (delete, no error)' : `refused: ${msgOf(r)}`);
      if (r.ok) landed.postLikers.delete(r.actor);
    }
    const st2 = await likeState(u1);
    const race2 = raceOf(s2.step);
    expect(st2.likes != null && st2.likes === st2.rows, 'social.likes-counter-after-unlike', counterSays(st2, race2, 'two unlike taps'), { ...st2, write: s2.step.write, contended: race2.contended });
    if (race2.contended === false) info('social.unlikes-no-overlap', `the two unlike deletes did not overlap, so the recount after them is no evidence about the lock. ${race2.text}`);
    expect(sameSet(st2.likers, [...landed.postLikers]), 'social.likers-after-unlike', `rows from ${list(st2.likers)} (expected ${list(landed.postLikers)})`);
    const wrong2 = await hearts('everyone re-reads their hearts after the unlikes', landed.postLikers);
    expect(wrong2.length === 0, 'social.hearts-after-unlike', wrong2.length ? `the server says otherwise for: ${wrong2.join('; ')}` : 'u2 and u3 now read empty, the rest filled');

    // ---- 2 — four comments at once, likes, a reply, deletes ---------------
    const key = act.postKey(post.id);
    const commenters = [u2, u3, u4, u5];
    const s3 = await together('u2–u5 comment on u1\'s post at the same instant', commenters.map((u) => ({ actor: u, alignWrite: true, fn: (_p, sync) => act.addComment(u, key, `TEST şərh ${u.key} ${ctx.runId}`, null, { sync }) })));
    for (const r of s3.results) {
      if (r.ok) {
        commentOf[r.actor] = r.comment.id;
        ctx.state.comments.push(r.comment.id);
      }
      expect(r.ok, `social.comment.${r.actor}`, r.ok ? `comment ${short(r.comment.id)} came back with its row` : `refused: ${msgOf(r)} — «${r.shown ?? 'Şərh göndərilmədi'}»`, r.ok ? null : r.error);
    }
    const c1 = await act.fetchComments(u1, key, ctx.simIds);
    const byId = new Map((c1.comments ?? []).map((c) => [c.id, c]));
    const bad = Object.entries(commentOf).filter(([k, id]) => {
      const c = byId.get(id);
      return !c || c.parentId !== null || c.mine || c.authorName !== A(ctx, k).name;
    });
    expect(
      c1.ok && bad.length === 0 && (c1.comments ?? []).length === Object.keys(commentOf).length,
      'social.comments-u1-reads-all',
      c1.ok
        ? `u1's sheet shows ${(c1.comments ?? []).length} comment(s) (expected ${Object.keys(commentOf).length}), each under its author's name, none marked as u1's${bad.length ? `; wrong or missing: ${bad.map(([k]) => k).join(', ')}` : ''}`
        : `the sheet could not load: ${msgOf(c1)} — it says «yüklənmədi»`
    );
    if (c1.foreign) info('social.comments-foreign', `${c1.foreign} comment(s) under the TEST post are from outside this run (counted, never read) — they are NOT deleted with the post (comments.target_key has no foreign key)`);
    // The card counts raw comment rows (feed/index.tsx:90); the sheet reads
    // comments_for. The run's own rows are compared exactly; rows from outside
    // the run are counted apart (head-only, never read).
    const [cnt, ourRaw, outRaw] = await Promise.all([
      act.readCommentCounts(u2, [key]),
      act.probeCount(u2, (c) => c.from('comments').select('id', head).eq('target_key', key).in('author_id', sim)),
      act.probeCount(u2, (c) => c.from('comments').select('id', head).eq('target_key', key).not('author_id', 'in', notSim)),
    ]);
    const cardN = cnt.ok ? cnt.counts[key] : null;
    const shownOurs = (c1.comments ?? []).length;
    const countsRead = cnt.ok && ourRaw.ok && outRaw.ok;
    expect(
      countsRead && c1.ok && cardN === ourRaw.count + outRaw.count && ourRaw.count === shownOurs,
      'social.comment-count-in-feed',
      !cnt.ok
        ? `count read failed: ${msgOf(cnt)} — the card shows no number`
        : !countsRead
          ? `the card counts ${cardN}, but a row count to compare it with failed: ${msgOf(ourRaw.ok ? outRaw : ourRaw)}`
          : `the post card counts ${cardN} comment(s) = ${ourRaw.count} by TEST actors (u1's sheet shows ${shownOurs} of them) + ${outRaw.count} from outside the run`
    );
    if (countsRead && c1.ok && outRaw.count !== (c1.foreign ?? 0)) {
      info(
        'social.comment-count-hidden-authors',
        `the card counts ${outRaw.count} comment(s) from outside the run, u1's sheet lists ${c1.foreign ?? 0}: comments_for is SECURITY INVOKER and inner-joins profiles, so a comment whose author's profile is hidden from members (show_in_gym_list off, profiles_read) is counted on the card and missing from the sheet — an app mismatch, not counter drift`
      );
    }
    const card = await act.openFeedPost(u2, post.id);
    const col = card.post?.comments;
    const race3 = raceOf(s3.step, s3.results.filter((r) => r.ok).map((r) => r.comment.createdAt));
    // refresh_comment_count() counts raw rows too, so the column is compared with the card's number.
    info(
      'social.comments-column',
      `community_posts.comments = ${col ?? '—'}, ${cardN ?? '—'} comment row(s) — ${
        col == null || cardN == null
          ? 'not compared (a read failed)'
          : col === cardN
            ? race3.contended === false
              ? `in step, though refresh_comment_count() was not really raced: ${race3.text}`
              : `in step: ${race3.text}`
            : `DRIFTED: refresh_comment_count() counts without taking the row lock first (it is not one of schema82's eight); ${race3.text}`
      }. The app never renders this column (feed/index.tsx:50), so nobody sees it`,
      { write: s3.step.write, contended: race3.contended }
    );

    if (commentOf.u2) {
      const s4 = await together('u1 likes u2\'s comment from two devices while u4 likes it too', [
        { actor: u1, label: 'u1 device 1', alignWrite: true, fn: (_p, sync) => act.toggleCommentLike(u1, commentOf.u2, true, { sync }) },
        { actor: u1, label: 'u1 device 2', alignWrite: true, fn: (_p, sync) => act.toggleCommentLike(u1, commentOf.u2, true, { sync }) },
        { actor: u4, label: 'u4', alignWrite: true, fn: (_p, sync) => act.toggleCommentLike(u4, commentOf.u2, true, { sync }) },
      ]);
      const l4 = s4.results.find((r) => r.label === 'u4');
      expect(l4.ok, 'social.comment-like.u4', l4.ok ? 'u4\'s like landed' : `refused: ${msgOf(l4)}`);
      const lost = s4.results.filter((r) => r.actor === 'u1' && !r.ok);
      const rls = lost.some((r) => r.error?.code === '42501' || /row-level security/i.test(r.error?.message ?? ''));
      expect(
        lost.length === 0,
        'social.comment-like-double-tap',
        lost.length === 0
          ? 'both of u1\'s simultaneous likes came back ok — the upsert is idempotent, as toggleCommentLike promises'
          : `${lost.length} of u1's two simultaneous likes was REFUSED (${lost.map(msgOf).join('; ')})${rls ? ': the later upsert meets the first row and takes ON CONFLICT DO UPDATE, and comment_likes has an UPDATE grant but no UPDATE policy (read 2026-09-22), so RLS refuses that path' : ''} — the sheet rolls that device's heart back and says «Bəyənilmədi — yenidən cəhd et» although the like is stored`,
        s4.results.map((r) => ({ label: r.label, ok: r.ok, error: r.error ?? null }))
      );
      const rows = await act.probeRead(u1, (c) => c.from('comment_likes').select('profile_id').eq('comment_id', commentOf.u2).in('profile_id', sim));
      landed.commentLikers = (rows.rows ?? []).map((r) => keyOf(r.profile_id));
      const wantLikers = [...new Set(s4.results.filter((r) => r.ok).map((r) => r.actor))];
      expect(sameSet(landed.commentLikers, wantLikers), 'social.comment-like-rows', `u2's comment has like rows from ${list(landed.commentLikers)} (expected ${list(wantLikers)}; u1 holds ${landed.commentLikers.filter((k) => k === 'u1').length})`);
      // comments_for counts EVERY like on the comment, so it is compared with every
      // row; likes from outside the run are counted apart (head-only, never read).
      const [v1, v2, allCl] = await Promise.all([
        act.fetchComments(u1, key, ctx.simIds),
        act.fetchComments(u2, key, ctx.simIds),
        act.probeCount(u1, (c) => c.from('comment_likes').select('comment_id', head).eq('comment_id', commentOf.u2)),
      ]);
      const seen1 = (v1.comments ?? []).find((c) => c.id === commentOf.u2);
      const seen2 = (v2.comments ?? []).find((c) => c.id === commentOf.u2);
      const outCl = allCl.ok ? allCl.count - landed.commentLikers.length : null;
      expect(
        !!seen1 && !!seen2 && allCl.ok && seen2.likes === allCl.count && seen1.likes === seen2.likes && seen1.likedByMe === landed.commentLikers.includes('u1') && seen2.likedByMe === false && seen2.mine === true,
        'social.comment-likes-shown',
        !seen1 || !seen2
          ? `the comment is missing from a sheet: ${msgOf(v1.ok ? v2 : v1)}`
          : !allCl.ok
            ? `u2 sees ${seen2.likes} like(s), but the row count to compare it with failed: ${msgOf(allCl)}`
            : `u2 sees ${seen2.likes} like(s) on its own comment (marked «mine»), ${allCl.count} comment_likes row(s) (${landed.commentLikers.length} TEST + ${outCl} from outside the run); u1 sees ${seen1.likes} and its heart ${seen1.likedByMe ? 'filled' : 'EMPTY'}`
      );
      if (outCl > 0) info('social.comment-likes-foreign', `${outCl} like(s) on u2's TEST comment came from outside this run (counted, never read) — they are deleted with the comment at cleanup`);
    }

    if (commentOf.u3) {
      const rep = await act.addComment(u1, key, `TEST cavab u1 ${ctx.runId}`, commentOf.u3);
      if (rep.ok) {
        ctx.state.comments.push(rep.comment.id);
        landed.replied = rep.comment.id;
      }
      expect(rep.ok && rep.comment.parentId === commentOf.u3, 'social.reply', rep.ok ? `u1's reply hangs under u3's comment (parent ${short(rep.comment.parentId)})` : `refused: ${msgOf(rep)}`);
    }

    if (commentOf.u2) {
      // The sheet offers «Sil» only on your own comment (CommentsSheet.tsx:380),
      // so this is a direct call: what a stale or scripted client could send.
      const del = await act.probeWrite(u3, (c) => c.from('comments').delete().eq('id', commentOf.u2).select('id'));
      const after = await act.fetchComments(u1, key, ctx.simIds);
      const still = (after.comments ?? []).some((c) => c.id === commentOf.u2);
      expect(
        del.count === 0 && still,
        'social.non-author-cannot-delete',
        del.count ? 'u3 DELETED u2\'s comment' : still ? `u3's delete of u2's comment removed 0 rows (${del.error?.message ?? 'comments_delete filtered it'}) and u1 still sees it` : `the delete came back empty, but u2's comment is gone from u1's sheet (${msgOf(after)})`
      );
      info('social.post-author-may-delete', 'comments_delete also lets the POST\'s author delete any comment under it; the sheet offers «Sil» on your own comments only, so no screen sends that — not exercised');
    }
    if (commentOf.u5) {
      const own = await act.deleteMyComment(u5, key, commentOf.u5, ctx.simIds);
      expect(
        own.ok && own.gone,
        'social.author-deletes-own',
        !own.ok ? `refused: ${msgOf(own)} — «${own.shown}»` : own.gone ? `u5's own «Sil»: the re-read no longer has it — «${own.shown}»` : own.rereadOk ? `no error, but the re-read still has it — «${own.shown}»` : `the re-read after the delete failed, and the sheet then says «Şərh silindi» without knowing`
      );
      if (own.ok && own.gone) delete commentOf.u5;
    }
    const fin = await act.fetchComments(u1, key, ctx.simIds);
    const ids = (fin.comments ?? []).map((c) => c.id);
    const want = [commentOf.u2, commentOf.u3, commentOf.u4, commentOf.u5, landed.replied].filter(Boolean);
    const threaded = !landed.replied || ids.indexOf(landed.replied) === ids.indexOf(commentOf.u3) + 1;
    expect(
      fin.ok && sameSet(ids, want) && threaded,
      'social.comments-final',
      fin.ok ? `u1's sheet: ${ids.length} comment(s) (expected ${want.length})${landed.replied ? `, the reply ${threaded ? 'right under' : 'NOT under'} u3's comment` : ''}` : `the sheet could not load: ${msgOf(fin)}`
    );
  }

  // ---- 3 — four followers at the same instant ------------------------------
  const s5 = await together('u2–u5 follow u1 at the same instant (u5 from two devices)', [
    ...[u2, u3, u4, u5].map((u) => ({ actor: u, label: `${u.key} follows`, alignWrite: true, prep: () => act.myFollowing(u), fn: (_p, sync) => act.followProfile(u, u1.profileId, { sync }) })),
    { actor: u5, label: 'u5 follows (second device)', alignWrite: true, fn: (_p, sync) => act.followProfile(u5, u1.profileId, { sync }) },
  ]);
  for (const r of s5.results) {
    if (r.ok) landed.followers.add(r.actor);
    if (r.label.includes('second')) continue;
    expect(r.ok, `social.follow.${r.actor}`, r.ok ? `follow landed${r.duplicate ? ' (as a swallowed duplicate)' : ''}` : `refused: ${msgOf(r)} — «${r.shown ?? 'İzləmə göndərilmədi'}»`, r.ok ? null : r.error);
  }
  const fpair = s5.results.filter((r) => r.actor === 'u5');
  const fdupes = fpair.filter((r) => r.duplicate).length;
  expect(
    fpair.every((r) => r.ok) && fdupes === 1,
    'social.follow-double-tap',
    fpair.every((r) => r.ok) ? (fdupes === 1 ? 'both of u5\'s follows came back ok: one inserted, the other hit follows_pkey and followProfile swallowed it' : `both came back ok, but ${fdupes} were duplicates (expected exactly 1)`) : `a follow failed: ${fpair.filter((r) => !r.ok).map(msgOf).join('; ')}`
  );
  const followNotifiers = new Set(landed.followers);
  // followCounts counts EVERY follower of u1: it is compared with the TEST rows
  // plus the followers from outside the run, counted apart (head-only, never read).
  const followerState = async () => {
    const [fc, fr, out] = await Promise.all([
      act.followCounts(u1, u1.profileId),
      act.probeRead(u1, (c) => c.from('follows').select('follower_id,created_at').eq('followee_id', u1.profileId).in('follower_id', sim)),
      act.probeCount(u1, (c) => c.from('follows').select('follower_id', head).eq('followee_id', u1.profileId).not('follower_id', 'in', notSim)),
    ]);
    const keys = (fr.rows ?? []).map((r) => keyOf(r.follower_id));
    const ok = fc.ok && fr.ok && out.ok;
    return { fc, keys, out: out.count, starts: fr.ok ? fr.rows.map((r) => r.created_at) : [], ok, exact: ok && fc.followers === keys.length + out.count, error: fc.error ?? fr.error ?? out.error ?? null };
  };
  const f1 = await followerState();
  const race5 = raceOf(s5.step, f1.starts);
  expect(
    f1.exact && sameSet(f1.keys, [...landed.followers]),
    'social.followers-exact',
    !f1.fc.ok
      ? `followCounts failed (${msgOf(f1.fc)}) — the app would print 0`
      : !f1.ok
        ? `followCounts(u1) = ${f1.fc.followers}, but a row read to compare it with failed: ${f1.error?.message ?? 'no error text'}`
        : `followCounts(u1) = ${f1.fc.followers} follower(s) = ${f1.keys.length} TEST row(s) + ${f1.out} from outside the run${f1.exact ? '' : ' — MISMATCH'}; TEST rows from ${list(f1.keys)} (expected ${list(landed.followers)}), u5 holds ${f1.keys.filter((k) => k === 'u5').length}`,
    { followers: f1.fc.followers ?? null, testRows: f1.keys, outside: f1.out, write: s5.step.write, race: race5.text }
  );
  if (f1.out > 0) info('social.followers-foreign', `${f1.out} follower(s) of u1 are outside this run (counted, never read) — cascade-deleted with u1`);
  info('social.follower-count-unshown', 'followCounts() (src/lib/social.ts:100) has no caller: no screen shows a follower number or a follower list. What the app does read is each person\'s own list (myFollowing — feed ordering and the launch sync)');
  const fw = await together('each follower reads its own follow list (myFollowing)', [u2, u3, u4, u5].map((u) => ({ actor: u, fn: () => act.myFollowing(u) })));
  const fwBad = fw.results.filter((r) => !r.ok || r.following.includes(u1.profileId) !== landed.followers.has(r.actor));
  expect(fwBad.length === 0, 'social.following-lists', fwBad.length ? `wrong for ${fwBad.map((r) => (r.ok ? r.actor : `${r.actor}: ${msgOf(r)}`)).join('; ')}` : 'every follower\'s own list has u1 in it');
  if (landed.followers.has('u2')) {
    const uf = await act.unfollowProfile(u2, u1.profileId);
    const [f2, mine2] = await Promise.all([followerState(), act.myFollowing(u2)]);
    const wantAfter = [...landed.followers].filter((k) => k !== 'u2');
    const gone = uf.ok && f2.exact && mine2.ok && sameSet(f2.keys, wantAfter) && !mine2.following.includes(u1.profileId);
    expect(
      gone,
      'social.unfollow',
      !uf.ok
        ? `refused: ${msgOf(uf)}`
        : !f2.ok
          ? `u2 unfollowed, but a read to check it failed: ${f2.error?.message ?? 'no error text'}`
          : `u2 unfollowed: followCounts(u1) ${f1.fc.followers} → ${f2.fc.followers} = ${f2.keys.length} TEST row(s) (${list(f2.keys)}, expected ${list(wantAfter)}) + ${f2.out} from outside${f2.exact ? '' : ' — MISMATCH'}; u2's list ${!mine2.ok ? `could not be read (${msgOf(mine2)})` : mine2.following.includes(u1.profileId) ? 'STILL has u1' : 'no longer has u1'}`
    );
    if (gone) landed.followers.delete('u2');
  }
  unreachable('social.follow-ui-path', 'the «İzlə» button sits on a video card and on the creator page reached from a video (feed/index.tsx:450, creator.tsx:134); u1 has no video (a TEST one would need a file upload), so no screen offers to follow u1 — followProfile, the exact call that button sends, is called directly');

  // ---- 4 — partner requests: a crossing pair, then a one-way ask -----------
  unreachable('social.match-ui-path', 'u2–u5 have no home gym (Profil → Redaktə offers listed gyms only, and a real gym would put TEST people in its member list), so none of them is in another\'s Kəşf lists or deck; send_match_request and the «Təkliflər» reads and writes below are the exact requests the match and requests screens send');

  // What both phones of a pair say, read the way the app reads them: the device
  // state after «Təkliflər» ran, any card still offered, its own open offer, and
  // what the NEXT launch would show for either row order (the launch read has no
  // ORDER BY). Used by the crossing pair and by the one-way pair below.
  const viewPair = async (x, y) => {
    const [rx, ry] = await Promise.all([act.openRequestsScreen(x, ctx.simIds), act.openRequestsScreen(y, ctx.simIds)]);
    const [lx, ly] = await Promise.all([act.launchMatchSync(x, { apply: false }), act.launchMatchSync(y, { apply: false })]);
    const side = (me, other, r, l) => ({
      device: me.db.matches[other.profileId]?.state ?? '—',
      card: (r.incoming ?? []).find((z) => z.fromProfile === other.profileId) ?? null,
      offer: r.outgoing?.[other.profileId] ?? null,
      launch: l.matches?.[other.profileId]?.state ?? '—',
      launchAlt: l.altMatches?.[other.profileId]?.state ?? '—',
      readOk: !!(r.ok && l.ok),
    });
    return { [x.key]: side(x, y, rx, lx), [y.key]: side(y, x, ry, ly) };
  };
  const describe = (v) =>
    Object.entries(v)
      .map(([k, s]) => `${k}: device «${s.device}», ${s.card ? 'a live «Qəbul et» card from its partner' : 'no card'}, ${s.offer ? `own offer «${s.offer}»` : 'no open offer'}, next launch «${s.launch}»${s.launch !== s.launchAlt ? ` or «${s.launchAlt}» depending on row order` : ''}${s.readOk ? '' : ' (a read FAILED)'}`)
      .join('; ');
  const clean = (v) => Object.values(v).every((s) => s.readOk && s.device === 'accepted' && !s.card && !s.offer && s.launch === 'accepted' && s.launchAlt === 'accepted');
  const why = (v) => {
    const parts = [];
    if (Object.values(v).some((s) => s.card)) parts.push('one direction is still pending, so its sender gets a «Qəbul et» card from a person it is already matched with');
    if (Object.values(v).some((s) => s.launch !== s.launchAlt)) parts.push('reconcileMatches keys the rows by the other person (db.ts:515) and the launch read has no ORDER BY (api.ts:1230), so the next launch shows a different state depending on which row the server returns last');
    if (Object.values(v).some((s) => s.device !== 'accepted')) parts.push('a phone does not show the match');
    return parts.join('; ');
  };
  const cardsLeft = (v) => Object.entries(v).filter(([, s]) => s.card).map(([k]) => k);
  const pairRows = (res, me, other) =>
    (res.rows ?? []).filter((r) => r.otherProfileId === other.profileId).map((r) => `${r.iSent ? me.key : other.key}→${r.iSent ? other.key : me.key} ${r.status}`).sort();

  const proposal = `TEST ${ctx.runId} · Ç.a 19:00`;
  const s6 = await together('u4 and u5 send each other a partner request at the same instant (crossing)', [
    { actor: u4, label: 'u4 → u5', alignWrite: true, fn: (_p, sync) => act.sendMatchRequest(u4, u5.profileId, proposal, { sync, partnerName: u5.name }) },
    { actor: u5, label: 'u5 → u4', alignWrite: true, fn: (_p, sync) => act.sendMatchRequest(u5, u4.profileId, proposal, { sync, partnerName: u4.name }) },
  ]);
  for (const r of s6.results) {
    // The status the app read back decides what the person is told and what this
    // device records (match.tsx:220-231).
    expect(r.ok, `social.match-sent.${r.actor}`, r.ok ? `send_match_request accepted, the row came back «${r.status}» — «${r.shown}»` : `refused: ${msgOf(r)} — «${r.shown ?? 'Təklif göndərilmədi'}»`, r.ok ? null : r.error);
  }
  const [p4, p5] = await Promise.all([act.launchMatchSync(u4, { apply: false }), act.launchMatchSync(u5, { apply: false })]);
  const rows4 = pairRows(p4, u4, u5);
  const rows5 = pairRows(p5, u5, u4);
  const bothAccepted = rows4.length === 2 && rows4.every((x) => x.endsWith('accepted'));
  const twoPending = rows4.length === 2 && rows4.every((x) => x.endsWith('pending'));

  // WHICH ask arrived second is what the notifications hang on, and the app's own
  // read-back cannot tell: the first asker's read lands after the trigger has
  // settled its row, so it reads «accepted» too. The rows themselves can: a
  // transaction that saw the other direction must have started after it
  // committed, so of two accepted rows the LATER created_at is the one written
  // «accepted» (born accepted → no «match_request», and its update sends
  // «match_accepted» to the earlier asker). Not an app call — the app never reads
  // created_at here — so it is a bookkeeping probe of this pair's own two rows.
  const crossProbe = await act.probeRead(u4, (c) =>
    c
      .from('match_requests')
      .select('from_profile,to_profile,status,created_at')
      .in('from_profile', [u4.profileId, u5.profileId])
      .in('to_profile', [u4.profileId, u5.profileId])
  );
  const crossRows = (crossProbe.rows ?? [])
    .map((r) => ({ by: keyOf(r.from_profile), to: keyOf(r.to_profile), status: r.status, at: r.created_at }))
    .sort((x, y) => tsMs(x.at) - tsMs(y.at));
  const acceptedSends = s6.results.filter((r) => r.ok && r.status === 'accepted').map((r) => r.actor);
  const secondAsker = bothAccepted
    ? crossRows.length === 2 && crossRows.every((r) => Number.isFinite(tsMs(r.at)))
      ? crossRows[1].by
      : acceptedSends.length === 1
        ? acceptedSends[0]
        : null
    : null;
  // Only when the direction is known can the two match notifications be judged.
  const crossNotifUnknown = bothAccepted && !secondAsker;
  for (const r of s6.results) {
    if (!r.ok) continue;
    if (crossNotifUnknown) continue;
    const to = r.actor === 'u4' ? 'u5' : 'u4';
    landed.matchSends.push({ by: r.actor, to, status: r.status, wrote: secondAsker ? (r.actor === secondAsker ? 'accepted' : 'pending') : r.status });
  }
  if (crossNotifUnknown) {
    unreachable(
      'social.notif-match-cross',
      `both rows ended accepted, but the harness cannot say which ask arrived second (${crossProbe.ok ? 'the rows carry no usable created_at' : `the row probe failed: ${msgOf(crossProbe)}`}, and ${acceptedSends.length} read-back(s) said «accepted»), so the u4/u5 «match_request» / «match_accepted» pair is not judged — u2/u3 below still is`
    );
  }
  // schema84 (applied 2026-09-23): asking somebody who has already asked you is
  // mutual interest, so send_match_request writes that row as 'accepted' and the
  // match_requests_mutual trigger settles the opposite row too.
  info(
    'social.match-cross-outcome',
    `server after the crossing sends: ${rows4.length} row(s) — ${rows4.join(', ') || 'none'}${
      bothAccepted
        ? `: the second ask${secondAsker ? ` (${secondAsker}'s, by created_at)` : ''} met the first, so it was written as «accepted» and match_requests_mutual settled the first direction — a match on the spot, with nothing left to accept`
        : twoPending
          ? ': BOTH rows are pending — each send read the other direction before the other had committed, so neither saw an ask to answer'
          : ''
    }`,
    { u4: rows4, u5: rows5, rows: crossRows, secondAsker, readBacks: s6.results.map((r) => ({ actor: r.actor, status: r.status ?? null })) }
  );
  expect(p4.ok && p5.ok && rows4.join('|') === rows5.join('|'), 'social.match-cross-rows-agree', p4.ok && p5.ok ? `u4 reads ${rows4.join(', ') || 'none'}; u5 reads ${rows5.join(', ') || 'none'}` : `read failed: ${msgOf(p4.ok ? p5 : p4)}`);

  // Both rows must end accepted, and at least one phone must have SEEN that in
  // its read-back. Only one row can be WRITTEN accepted (the second ask; the
  // other direction is settled by the trigger), but the first asker's read-back
  // can arrive after that update and then legitimately reads «accepted» too —
  // both phones then say «artıq məşq yoldaşısınız», which is the truth.
  // Two pending rows is the pre-schema84 half-open pair: a FAIL with its own
  // explanation, never a silent pass.
  const mutualOk = bothAccepted && acceptedSends.length >= 1;
  expect(
    mutualOk,
    'social.match-cross-mutual',
    mutualOk
      ? `both rows are accepted — ${rows4.join(', ')}: the ask that arrived second was written «accepted» and match_requests_mutual settled the other direction${acceptedSends.length === 2 ? '; both read-backs saw it, so both phones said «artıq məşq yoldaşısınız» (the trigger beat the first asker\'s read-back)' : `; ${acceptedSends[0]}'s read-back saw it and its phone said «artıq məşq yoldaşısınız»`}`
      : twoPending
        ? `both rows stayed «pending» (${rows4.join(', ')}): each send read the opposite direction before the other transaction had committed, so send_match_request saw nothing to answer. The pair is back to the state schema84 was written for — accepting one direction would leave the other pending, its sender keeping a «Qəbul et» card from somebody it is already matched with, and the next launch showing «accepted» or «incoming» depending on which row the server returns last`
        : bothAccepted
          ? `both rows are accepted (${rows4.join(', ')}), but neither send read that back: both phones were told «Təklif göndərildi» although the two were already matched — the read-back (api.ts:682) answered «pending», and only «Təkliflər» or the next launch corrects the screens`
          : `expected two accepted rows; the server left ${rows4.join(', ') || 'no rows'}, and ${acceptedSends.length} send(s) came back «accepted»`,
    { rows: rows4, acceptedSends, sends: s6.results.map((r) => ({ actor: r.actor, ok: r.ok, status: r.status ?? null })) }
  );

  const v1 = await viewPair(u4, u5);
  // Both rows carry created_at = now() of their sending transaction, so the
  // probe above also says how close together the two transactions began.
  const race6 = raceOf(s6.step, crossProbe.ok ? crossRows.map((r) => r.at) : null, `the pair's rows could not be read (${msgOf(crossProbe)})`);
  info('social.match-cross-screens', `after the crossing sends — ${describe(v1)}. The two sends: ${race6.text}`, { write: s6.step.write, contended: race6.contended, view: v1 });
  expect(
    cardsLeft(v1).length === 0,
    'social.match-cross-no-card',
    cardsLeft(v1).length === 0
      ? 'neither «Təkliflər» offers a «Qəbul et» card: the two asks settled each other, so there is nothing left for either of them to accept'
      : `${cardsLeft(v1).join(', ')} still has a «Qəbul et» card from a person it is already matched with — ${describe(v1)}`,
    v1
  );
  expect(v1.u4.device === 'accepted' && v1.u5.device === 'accepted', 'social.match-both-see-accepted', `after the crossing sends and one «Təkliflər» open: u4's phone «${v1.u4.device}», u5's «${v1.u5.device}» (u5 was told «${s6.results.find((r) => r.actor === 'u5')?.shown ?? '—'}»)`, v1);
  expect(clean(v1), 'social.match-cross-consistent', clean(v1) ? 'both phones say «matched» everywhere, now and at the next launch' : `the pair is half-open — ${describe(v1)}. ${why(v1)}`, v1);

  if (bothAccepted) {
    // The match opens a chat: both press «Göndər» on their first message at once.
    const texts = { u4: `TEST salam, yoldaş (${ctx.runId})`, u5: `TEST salam (${ctx.runId})` };
    const s7 = await together('u4 and u5 send their first message at the same instant (chat/[id].tsx)', [
      { actor: u4, prep: () => act.openChatScreen(u4, u5.profileId), fn: (p) => act.sendChatMessage(u4, u5.profileId, p?.threadId ?? null, texts.u4) },
      { actor: u5, prep: () => act.openChatScreen(u5, u4.profileId), fn: (p) => act.sendChatMessage(u5, u4.profileId, p?.threadId ?? null, texts.u5) },
    ]);
    const failedChat = s7.results.filter((r) => !r.ok);
    expect(
      failedChat.length === 0,
      'social.match-chat-opens',
      failedChat.length ? failedChat.map((f) => `${f.actor}: ${msgOf(f)} — the screen shows «${act.chatRefusalText(f.refusal)}»`).join('; ') : 'the match opens a chat from both sides'
    );
    const t4 = s7.results.find((r) => r.actor === 'u4')?.threadId ?? null;
    const t5 = s7.results.find((r) => r.actor === 'u5')?.threadId ?? null;
    if (t4 && t5) expect(t4 === t5, 'social.match-one-thread', t4 === t5 ? 'one thread for the pair' : `TWO threads: ${t4} / ${t5}`);
    const tid = t4 ?? t5;
    if (tid) {
      const sent = s7.results.filter((r) => r.ok).length;
      const [read4, inbox5] = await Promise.all([act.openChatScreen(u4, u5.profileId), act.getMyThreads(u5, ctx.simIds)]);
      const inInbox = (inbox5.threads ?? []).some((t) => t.threadId === tid);
      expect(
        read4.threadId === tid && (read4.messages ?? []).length === sent && inInbox,
        'social.match-chat-reads',
        `u4's chat holds ${read4.ok ? read4.messages.length : msgOf(read4)} message(s) (${sent} sent); u5's inbox ${inInbox ? 'lists' : 'does NOT list'} the thread`
      );
    }
  } else {
    unreachable('social.match-chat-opens', 'u4 and u5 did not end up matched (see social.match-cross-mutual), so open_thread would refuse them with no_relationship — the chat cannot be judged here; the u2–u3 pair below carries the accept path');
  }

  // ---- 4b — a one-way ask: u2 asks u3, u3 presses «Qəbul et» --------------
  // Since schema84 the crossing pair never reaches a «Qəbul et» card, so the
  // accept path needs two people this phase has NOT matched. u2 and u3 have so
  // far only liked, commented on and followed u1's post.
  const oneWay = `TEST ${ctx.runId} · C. 18:00`;
  const send23 = await act.sendMatchRequest(u2, u3.profileId, oneWay, { partnerName: u3.name });
  // One row only, so the read-back IS what the row was written as: nothing can
  // have settled it between the insert and the read.
  if (send23.ok) landed.matchSends.push({ by: 'u2', to: 'u3', status: send23.status, wrote: send23.status });
  expect(
    send23.ok && send23.status === 'pending',
    'social.match-oneway-sent',
    !send23.ok
      ? `refused: ${msgOf(send23)} — «${send23.shown ?? 'Təklif göndərilmədi'}»`
      : send23.status === 'pending'
        ? `u2's offer to u3 was written «pending» — «${send23.shown}»`
        : `the row came back «${send23.status}»: send_match_request answered a mutual ask, but u3 had never asked u2 — «${send23.shown}»`,
    send23.ok ? null : send23.error
  );
  const before23 = await viewPair(u2, u3);
  const card3 = before23.u3.card;
  expect(
    !!card3,
    'social.match-oneway-card-visible',
    card3
      ? `u3's «Təkliflər» shows u2's offer («${card3.note ?? 'no note'}» from «${card3.name ?? 'name not readable'}»), and u2's own offer reads «${before23.u2.offer ?? '—'}»`
      : `u3's «Təkliflər» has no incoming offer from u2 — nothing to accept; ${describe(before23)}`,
    before23
  );
  if (card3) {
    const acc = await act.acceptMatchRequest(u3, card3);
    expect(acc.ok, 'social.match-oneway-accepted', acc.ok ? `u3 accepted u2's offer — the row came back, «${acc.shown}»` : `accept did not reach the server (${msgOf(acc)}) — «${acc.shown}»`);
    if (acc.ok) {
      landed.matchAccepts.push({ by: 'u3', of: 'u2' });
      const after23 = await viewPair(u2, u3);
      expect(
        clean(after23),
        'social.match-oneway-consistent',
        clean(after23) ? 'both phones say «matched»: no card left, no open offer, and the next launch agrees whichever row the server returns last' : `the pair is half-open — ${describe(after23)}. ${why(after23)}`,
        after23
      );
      // One message each way — the crossing pair already covers two first
      // messages at the same instant, and messages_gate holds a sender to one
      // message until the other side has replied.
      const open2 = await act.openChatScreen(u2, u3.profileId);
      const m1 = await act.sendChatMessage(u2, u3.profileId, open2.threadId ?? null, `TEST salam, yoldaş (${ctx.runId})`);
      const m2 = m1.ok ? await act.sendChatMessage(u3, u2.profileId, null, `TEST salam (${ctx.runId})`) : null;
      expect(
        m1.ok && !!m2?.ok,
        'social.match-oneway-chat-opens',
        !m1.ok
          ? `u2 could not write to its new partner: ${msgOf(m1)} — the screen shows «${act.chatRefusalText(m1.refusal)}»`
          : !m2.ok
            ? `u3's answer was refused: ${msgOf(m2)} — the screen shows «${act.chatRefusalText(m2.refusal)}»`
            : 'the accepted offer opens a chat: one message each way, both delivered'
      );
      if (m1.ok && m2?.ok) {
        expect(m1.threadId === m2.threadId, 'social.match-oneway-one-thread', m1.threadId === m2.threadId ? 'one thread for the pair' : `TWO threads: ${m1.threadId} / ${m2.threadId}`);
      }
    }
  }

  // ---- 5 — what the inboxes say ----------------------------------------------
  const n = await together('Bildirişlər: u1–u5 open their notifications', users.map((u) => ({ actor: u, fn: () => act.getNotifications(u, ctx.simIds) })));
  const inbox = Object.fromEntries(n.results.map((r) => [r.actor, r]));
  for (const r of n.results) if (!r.ok) expect(false, `social.notif-read.${r.actor}`, `the inbox did not load: ${msgOf(r)}`);
  const tally = (k, type) => {
    const out = {};
    for (const x of inbox[k]?.notifications ?? []) {
      if (x.type !== type) continue;
      const who = x.actorId ? keyOf(x.actorId) : 'deleted';
      out[who] = (out[who] ?? 0) + 1;
    }
    return out;
  };
  const onceEach = (got, from) => list(Object.keys(got)) === list(from) && Object.values(got).every((c) => c === 1);
  const fmt = (got) =>
    Object.entries(got)
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([k, c]) => `${k}×${c}`)
      .join(', ') || 'none';
  if (post) {
    const pl = tally('u1', 'post_like');
    expect(
      inbox.u1?.ok && onceEach(pl, [...landed.likeNotifiers]),
      'social.notif-post-like',
      `u1: «… postunu bəyəndi» from ${fmt(pl)} — expected one each from ${list(landed.likeNotifiers)} (u1's own like notifies nobody, u4's second device must add none, an unlike removes none)`
    );
    if (Object.keys(commentOf).length || landed.replied) {
      const aboutPost = (inbox.u1?.notifications ?? []).filter((x) => ['comment_reply', 'mention'].includes(x.type) && x.targetKey === act.postKey(post.id) && x.actorId && keyOf(x.actorId) !== 'u1');
      info(
        'social.notif-no-comment-notice',
        `u1 got ${aboutPost.length} notification(s) for the comments under its post: tg_notify_comment notifies only the parent comment's author (a reply) and @mentions — nothing tells a post's author that somebody commented`
      );
    }
    if (landed.commentLikers.length) {
      const from = landed.commentLikers.filter((k) => k !== 'u2');
      const clk = tally('u2', 'comment_like');
      expect(inbox.u2?.ok && onceEach(clk, from), 'social.notif-comment-like', `u2: «… şərhini bəyəndi» from ${fmt(clk)} — expected one each from ${list(from)} (u1 liked from two devices)`);
    }
    if (landed.replied) {
      const rp = tally('u3', 'comment_reply');
      expect(inbox.u3?.ok && onceEach(rp, ['u1']), 'social.notif-comment-reply', `u3: «… şərhinə cavab yazdı» from ${fmt(rp)} — expected one from u1`);
    }
  }
  if (followNotifiers.size) {
    const fo = tally('u1', 'follow');
    expect(
      inbox.u1?.ok && onceEach(fo, [...followNotifiers]),
      'social.notif-follow',
      `u1: «… səni izləməyə başladı» from ${fmt(fo)} — expected one each from ${list(followNotifiers)} (u5 followed from two devices; u2's unfollow removes none)`
    );
  }
  if (landed.matchSends.length || landed.matchAccepts.length) {
    // What the server really had to send, built from what each send REALLY wrote:
    //   · a row written 'pending' is an ask nobody has answered → one
    //     «match_request» to the person asked;
    //   · a row written 'accepted' answers an ask that was already there, so
    //     tg_notify_match sends NO «match_request», and the mutual update sends
    //     one «match_accepted» to whoever asked first — the person asked here.
    // Plus one «match_accepted» for every «Qəbul et» that reached the server,
    // addressed to the sender of the offer. Exactly one per (type, actor).
    // u4/u5 are left out only when the crossing pair's direction could not be
    // established (social.notif-match-cross says so) — never silently.
    const matchKeys = crossNotifUnknown ? ['u2', 'u3'] : ['u2', 'u3', 'u4', 'u5'];
    const want = Object.fromEntries(matchKeys.map((k) => [k, { match_request: [], match_accepted: [] }]));
    for (const s of landed.matchSends) {
      if ((s.wrote ?? s.status) === 'accepted') want[s.to].match_accepted.push(s.by);
      else want[s.to].match_request.push(s.by);
    }
    for (const m of landed.matchAccepts) want[m.of].match_accepted.push(m.by);
    const got = {};
    let good = true;
    for (const k of matchKeys) {
      got[k] = { match_request: tally(k, 'match_request'), match_accepted: tally(k, 'match_accepted') };
      good = good && !!inbox[k]?.ok && onceEach(got[k].match_request, want[k].match_request) && onceEach(got[k].match_accepted, want[k].match_accepted);
    }
    expect(
      good,
      'social.notif-match',
      matchKeys.map((k) => `${k}: offers from ${fmt(got[k].match_request)} (expected ${list(want[k].match_request)}), accepted by ${fmt(got[k].match_accepted)} (expected ${list(want[k].match_accepted)})`).join('; '),
      { got, want, sends: landed.matchSends, accepts: landed.matchAccepts }
    );
  }
  const u1n = inbox.u1;
  if (u1n?.ok && u1n.total < u1n.limit) {
    const badge = await act.getUnreadCount(u1);
    expect(badge.ok && badge.unread === u1n.unreadAll, 'social.notif-unread-badge', badge.ok ? `u1's badge says ${badge.unread} unread; the inbox holds ${u1n.unreadAll} unread row(s)` : `the badge read failed — it shows nothing (${msgOf(badge)})`);
  }
  for (const r of n.results) if (r.ok && r.foreign) info(`social.notif-foreign.${r.actor}`, `${r.foreign} notification(s) of ${r.actor} were caused by people outside this run (counted, never resolved)`);
}

// What delete_my_account() takes with it beyond the profile cascade. Before
// schema81 (applied 2026-09-22) never-listed gyms, their codes and day passes,
// programs and the notifications a person caused all stayed behind; the first
// live run (cl9gnb) left exactly those. schema81 deletes them, and runs clt8u9
// and cm5l1u were checked clean with read-only SQL. The bare key cannot see an
// unlisted gym, so the harness states this rather than claiming to have seen it.
const DELETED_SINCE_SCHEMA81 =
  'deleted by delete_my_account() since schema81 (never-listed gym → its day passes first, codes cascade); an unlisted gym is invisible to the public key, so confirm with read-only SQL, not from here';

// Pre-schema81 notes, kept for reading old reports.
const SURVIVES = {
  gyms:
    'delete_my_account() keeps the gym row and detaches the owner (gyms.owner_id ON DELETE SET NULL). It stays USABLE: check_in_with_code and create_day_pass look at neither owner nor listed. Before deleting, the owner switched day passes off and rotated the door code to one nobody has seen — but the row needs admin removal',
  gym_checkin_codes: 'lives as long as its gym row; rotated before deletion and unreadable now (gym_checkin_codes is owner-only)',
  day_passes:
    'day_passes.user_id AND day_passes.gym_id are ON DELETE SET NULL: delete these pass ids BEFORE the gyms, or they are left with neither a user nor a gym and can never be found again',
  programs: 'programs.owner_id ON DELETE SET NULL — a deleted author\'s program would stay PUBLIC in the library; the harness deletes its own first',
  reviews: 'reviews.author_id ON DELETE SET NULL — the review stays on the (surviving) TEST gym',
};

async function phaseCleanup(ctx) {
  // First, before any wait: no TEST coach may sit in Kəşf — not during the
  // phone wait, and not with --keep either.
  const off = await unlistTrainers(ctx, 'TEST coaches hidden from Kəşf before anything else');
  for (const r of off) expect(r.ok && r.listed === false, `cleanup.unlisted.${r.actor}`, r.ok ? 'listing hidden (listed=false came back)' : `could NOT unlist: ${msgOf(r)}`);
  ctx.unlistedForCleanup = true;

  const phoneId = ctx.phone.trainerOk ? ctx.opts.phoneTrainer : null;
  if (phoneId && ctx.opts.phoneWait > 0) {
    console.log(`   … waiting ${ctx.opts.phoneWait} s — accept or decline the TEST requests on the phone now`);
    // Interruptible: a Ctrl+C during the wait goes straight to the signal path's cleanup.
    await waitFor(() => ctx.aborted, ctx.opts.phoneWait * 1000);
    if (ctx.aborted) return;
    const users = ['u1', 'u2', 'u3', 'u4', 'u5'].map((k) => A(ctx, k)).filter((u) => u?.ready);
    const pr = await together('users re-read the phone trainer\'s answer', users.map((u) => ({ actor: u, fn: () => act.getMyRequestTo(u, phoneId) })));
    for (const r of pr.results) {
      if (['accepted', 'declined'].includes(r.request?.status)) ctx.phone.decisions += 1;
      info(`cleanup.phone-answer.${r.actor}`, `phone trainer's answer: ${r.request?.status ?? msgOf(r)}`);
    }
  }
  if (ctx.opts.keep) {
    recordKept(ctx);
    info('cleanup.kept', '--keep: nothing was deleted (TEST coaches were unlisted); every actor above is still in the live database');
    return;
  }
  await cleanupAll(ctx, 'end of run');
}

/** --keep (end of run, or a signal): every actor stays, and so does whatever it
 *  made. The social phase does not run under --keep, so no TEST post should
 *  exist — should one exist anyway, it is named as a leftover, never left silent. */
function recordKept(ctx) {
  for (const a of ctx.actors.values()) {
    if (a.userId) ctx.rec.leftover('kept-actor', { actor: a.key, userId: a.userId, profileId: a.profileId, username: a.username });
  }
  for (const id of ctx.state.posts) {
    ctx.rec.leftover('kept-public-post', { postId: id, why: 'public in the İcma feed until u1 deletes its account — the app has no delete-post path' });
    console.log(`   ! --keep: TEST post ${id} stays PUBLIC in the İcma feed until u1 deletes its account`);
  }
}

/** Delete every actor (idempotent; also the Ctrl+C / crash path). */
function cleanupAll(ctx, reason) {
  if (ctx.cleanupPromise) return ctx.cleanupPromise;
  ctx.cleanupPromise = (async () => {
    // Cleanup must be able to run concurrent steps after an abort.
    abortState.cleaning = true;
    const actors = [...ctx.actors.values()].filter((a) => a.userId && !a.deleted);
    if (!actors.length) return;
    console.log(`   · cleanup (${reason}): ${actors.length} actor(s) delete themselves`);
    await Promise.all(actors.map((a) => a.client.removeAllChannels().catch(() => null)));

    // 0 — the Ctrl+C path arrives here directly: hide the TEST coaches first.
    if (!ctx.unlistedForCleanup) {
      for (const r of await unlistTrainers(ctx, 'TEST coaches hidden from Kəşf (idempotent)')) {
        if (!r.ok) expect(false, `cleanup.unlisted.${r.actor}`, `could NOT unlist: ${msgOf(r)}`);
      }
    }

    // 1 — what each actor holds, read as itself.
    const inv = await together('inventory before deletion (as each actor)', actors.map((a) => ({ actor: a, fn: async () => ({ ok: true, inventory: await act.inventory(a, ctx.simIds) }) })));
    ctx.inventory = Object.fromEntries(inv.results.map((r) => [r.actor, r.inventory]));

    // Rows REAL people addressed to a TEST actor go with it (CASCADE). Counted,
    // never read — and a run that takes any with it is not a clean run.
    let foreignTotal = 0;
    for (const [k, i] of Object.entries(ctx.inventory)) {
      for (const [table, n] of Object.entries(i?.foreign ?? {})) {
        if (typeof n === 'number' && n > 0) {
          foreignTotal += n;
          // A real person's comment under a TEST post has no foreign key to it
          // (comments.target_key is text): it is orphaned, not deleted.
          ctx.rec.leftover(/_orphaned$/.test(table) ? 'real-user rows orphaned (their target is deleted, the rows stay)' : 'real-user rows removed by cascade', { actor: k, table, count: n });
        } else if (n && typeof n === 'object' && n.error) {
          info(`cleanup.foreign-count.${k}.${table}`, `could not count real people's ${table} addressed to ${k}: ${n.error}`);
        }
      }
    }
    expect(
      foreignTotal === 0,
      'cleanup.no-real-user-rows',
      foreignTotal
        ? `${foreignTotal} row(s) that real people addressed to TEST actors are cascade-deleted with them (counts only, in leftovers)`
        : `no real person had sent anything to a TEST actor that the public key can count (it cannot count reports or blocks${ctx.state.socialRan ? ' — see cleanup.reports-unverifiable' : ''})`
    );

    // 2 — programs would outlive their author, public and ownerless. Every actor
    //     deletes every program it OWNS per the inventory — so an insert whose
    //     response timed out is found too. If a delete fails, that actor is kept
    //     (unlisted) so the program stays removable by its author.
    const keep = new Set();
    for (const a of actors) {
      const listed = ctx.inventory[a.key]?.programs;
      const own = Array.isArray(listed) ? listed : ctx.state.programs.filter((p) => p.actor === a.key && p.result === 'saved').map((p) => p.id);
      for (const id of own) {
        const del = await act.deleteMyProgram(a, id);
        expect(del.ok, `cleanup.program-removed.${a.key}`, del.ok ? `program ${id}: ${del.result} (the library's own delete)` : `could not delete program ${id}: ${msgOf(del)} — ${a.key} is KEPT so its program stays removable`);
        if (!del.ok) {
          keep.add(a.key);
          ctx.rec.leftover('actor-kept-to-own-program', { actor: a.key, userId: a.userId, profileId: a.profileId, programId: id });
        }
      }
    }
    if (ctx.state.programs.length) {
      info('cleanup.programs-outlive-accounts', 'delete_my_account() does not delete a person\'s programs (owner_id SET NULL): a real user who deletes the account leaves their programs public and ownerless');
    }

    // 3 — reviews that should never have been accepted (reviews.author_id SET NULL).
    const seenReview = new Set();
    for (const w of ctx.state.reviewsWritten) {
      const tag = `${w.key}|${w.gymId}`;
      const a = A(ctx, w.key);
      if (seenReview.has(tag) || !a || a.deleted) continue;
      seenReview.add(tag);
      const del = await act.probeWrite(a, (c) => c.from('reviews').delete().eq('author_id', a.profileId).eq('gym_id', w.gymId).select('id'));
      const gone = del.ok && del.count >= 1;
      expect(gone, `cleanup.review-removed.${w.key}`, gone ? `deleted ${del.count} review(s) that should never have been accepted` : `review NOT deleted (${del.error?.message ?? 'zero rows came back'})`);
      if (!gone) ctx.rec.leftover('reviews', { gym_id: w.gymId, author: w.key, why: SURVIVES.reviews });
    }

    // 4 — the TEST gyms outlive their owners and stay usable (check_in_with_code
    //     and create_day_pass ignore owner and listed). Through the owner's own
    //     screens: day passes off (gym/edit.tsx), and «Yeni kod» once more so no
    //     code seen during the run opens anything. The new code is not recorded.
    const owners = actors.filter((a) => a.role === 'gym' && a.gymId && !keep.has(a.key));
    if (owners.length) {
      const seal = await together(
        'TEST gyms: day passes off + a door code nobody has seen',
        owners.map((a) => ({
          actor: a,
          fn: async () => {
            const g = await act.fetchMyGym(a);
            if (!g.gym) return { ok: false, error: g.error ?? { message: 'panel finds no gym' } };
            const off = g.gym.allowDayPass ? await act.editGym(a, g.gym, { allowDayPass: false }) : { ok: true, extrasSaved: true, already: true };
            const rot = await act.rotateCheckinCode(a, a.gymId);
            const passesOff = !!(off.ok && off.extrasSaved);
            return { ok: passesOff && rot.ok, error: off.error ?? off.extrasError ?? rot.error ?? null, passesOff, already: !!off.already, rotated: rot.ok };
          },
        }))
      );
      for (const r of seal.results) {
        expect(r.ok, `cleanup.gym-sealed.${r.actor}`, r.ok ? `day passes ${r.already ? 'were already off' : 'switched off'}, door code rotated (not recorded)` : `not sealed: ${msgOf(r)} (passes off: ${r.passesOff ?? '—'}, rotated: ${r.rotated ?? '—'})`);
      }
    }

    // 5 — everybody deletes itself at once (itself a concurrency test: the
    //     cascades of trainers and students touch the same rows).
    const doomed = actors.filter((a) => !keep.has(a.key));
    const tokens = new Map();
    for (const a of doomed) {
      const { data } = await a.client.auth.getSession().catch(() => ({ data: null }));
      if (data?.session?.access_token) tokens.set(a.key, data.session.access_token);
    }
    const del = await together('every actor deletes itself (delete_my_account)', doomed.map((a) => ({ actor: a, fn: () => act.deleteMyAccount(a) })));
    for (const r of del.results.filter((x) => !x.ok)) {
      const a = A(ctx, r.actor);
      const deadlock = r.error?.code === '40P01' || /deadlock detected/i.test(r.error?.message ?? '');
      if (deadlock) {
        // Not a harness fault: e.g. u1's post delete cascades into u4's post_likes
        // row while u4's delete, holding that row, waits in tg_post_likes for u1's post.
        info(
          `cleanup.concurrent-delete-deadlock.${a.key}`,
          `first delete_my_account() failed with «deadlock detected» (40P01): accounts that interacted, deleting at the same instant, lock shared rows (post_likes / comments / comment_likes / follows and the post they point at) in opposite order. In the app one of two such people is told «Hesab silinmədi — internet yoxlanılsın, sonra yenidən cəhd et» and must retry. Retrying alone`,
          r.error
        );
      } else {
        info(`cleanup.concurrent-delete-failed.${a.key}`, `first delete failed (${r.step ?? ''}): ${msgOf(r)} — retrying alone`, r.error);
      }
      let again = null;
      for (let i = 1; i <= 3 && !a.deleted; i++) {
        await sleep(300 * i);
        again = await act.deleteMyAccount(a);
      }
      expect(a.deleted, `cleanup.delete-retry.${a.key}`, a.deleted ? 'deleted on retry' : `STILL NOT DELETED after 3 retries: ${msgOf(again)}`, again?.error ?? null);
    }
    for (const a of doomed) {
      const tok = tokens.get(a.key);
      if (!a.deleted && tok) {
        // A delete whose RESPONSE was lost looks like a failure; the JWT tells.
        const gone = await act.probeAuthUserGone(a, tok);
        if (gone.gone) {
          a.deleted = true;
          info(`cleanup.deleted-despite-error.${a.key}`, 'delete_my_account reported an error, but the auth user no longer exists');
        }
      }
      expect(a.deleted, `cleanup.deleted.${a.key}`, a.deleted ? 'delete_my_account() returned' : 'account still exists');
      if (!a.deleted) {
        ctx.rec.leftover('actor-not-deleted', { actor: a.key, userId: a.userId, profileId: a.profileId, username: a.username, trainerId: a.trainerId ?? null, gymId: a.gymId ?? null });
      } else if (tok) {
        const gone = await act.probeAuthUserGone(a, tok);
        expect(gone.gone, `cleanup.auth-user-gone.${a.key}`, gone.gone ? `its JWT no longer resolves (${gone.error?.message ?? 'no user'})` : 'the auth user STILL resolves');
      }
    }
    for (const k of keep) info(`cleanup.kept.${k}`, 'kept on purpose (its program could not be deleted) and unlisted — delete the program as this account, then the account');

    // 6 — after: the public listings and every handle, read with the bare key.
    const trainerIds = [...ctx.actors.values()].map((a) => a.trainerId).filter(Boolean);
    const gymIds = [...ctx.actors.values()].map((a) => a.gymId).filter(Boolean);
    const programIds = [...new Set(ctx.state.programs.map((p) => p.id))];
    const handles = [...ctx.actors.values()].filter((a) => a.userId).map((a) => a.username).concat(`sim_${ctx.runId}_race`);
    // Every post and comment the run made — what the phase recorded plus what each
    // actor's inventory held (an insert whose response was lost is found there).
    const held = (k) => Object.values(ctx.inventory ?? {}).flatMap((i) => (Array.isArray(i?.[k]) ? i[k] : []));
    const postIds = [...new Set([...ctx.state.posts, ...held('community_posts')])];
    const commentIds = [...new Set([...ctx.state.comments, ...held('comments')])];
    const pub = await act.publicLeftovers(ctx.env, { runId: ctx.runId, trainerIds, programIds, gymIds, handles, postIds, commentIds });
    for (const p of pub) {
      const id = `cleanup.public.${p.label.replace(/\s*\(.*\)$/, '').replace(/\s+/g, '-')}`;
      if (!p.label.startsWith('gyms')) {
        const what = p.kind === 'username' ? (p.rows.length ? 'handle is STILL taken (username_taken = true)' : 'handle is free again') : `${p.rows.length} row(s) of this run still public`;
        expect(!p.error && p.rows.length === 0, id, p.error ? `read failed: ${p.error.message}` : what, p.rows.length ? p.rows : null);
      } else {
        info(id, `${p.rows.length} row(s) visible to the bare key — not verifiable with the public key: an unlisted gym is hidden from it${p.error ? ` (read failed: ${p.error.message})` : ''}`);
      }
      for (const row of p.rows) ctx.rec.leftover(`public:${p.label}`, { row });
    }
    if (ctx.state.socialRan || postIds.length) {
      info(
        'cleanup.social-cascades',
        'post_likes, follows, match_requests and notifications cannot be read with the bare key; they go by ON DELETE CASCADE (post_likes → community_posts and profiles; follows, match_requests, notifications → profiles; read 2026-09-22) — the rows each actor held are listed in its inventory; confirm with read-only SQL if needed'
      );
      // What a real person may have done to TEST content that nobody here can see:
      // reports_admin_read hides reports from everyone but admins, and blocks_own
      // shows a block to its blocker only.
      const profileIds = [...ctx.actors.values()].map((a) => a.profileId).filter(Boolean);
      ctx.rec.expectedDeleted = { ...(ctx.rec.expectedDeleted ?? {}), reports_to_check: { content: postIds, user: profileIds } };
      info(
        'cleanup.reports-unverifiable',
        'a real person\'s «Şikayət et» on the TEST post writes a reports row (target_type content, target_id = the post id), and one from the comments sheet reports the commenter (target_type user, target_id = the TEST profile id). reports.target_id is plain text: such a row is not cascaded, stays in the moderation queue pointing at deleted content, and the public key can neither read nor count it. A real person\'s block of a TEST actor goes with delete_my_account() uncounted. Check with read-only SQL: select id, target_type, status from public.reports where target_id in (the ids in report.expectedDeleted.reports_to_check)'
      );
    }

    // 7 — what the public key cannot see: the TEST gyms and their passes.
    const passIds = Object.values(ctx.inventory ?? {}).flatMap((i) => (Array.isArray(i?.day_passes) ? i.day_passes : []));
    if (gymIds.length || passIds.length) {
      info(
        'cleanup.unverifiable-deletions',
        `${gymIds.length} TEST gym(s) with their door codes and ${passIds.length} day-pass row(s): ${DELETED_SINCE_SCHEMA81}. Ids are in report.expectedDeleted.`
      );
      ctx.rec.expectedDeleted = { ...(ctx.rec.expectedDeleted ?? {}), gyms: gymIds, day_passes: passIds };
    }
  })();
  return ctx.cleanupPromise;
}

// Phase order is the run order. `needs` makes --only pull in what a phase builds on.
const PHASES = [
  {
    name: 'setup',
    title: '10 anonymous sessions, registration, 3 trainers, 2 gyms + door codes',
    needs: [],
    actors: [],
    run: phaseSetup,
    plan: [
      'all actors: first launch (getSession → signInAnonymously → touch_last_active → own profile → own gym) together',
      'all actors: username_taken → profiles upsert (name, @sim_<run>_<key>, age) together; read back',
      't1..t3: publishTrainer (profiles role → trainers insert → listed:true → trainer_verifications) together; read back; then setMyListed(false) at once — public for seconds only',
      'g1..g2: createGym (owned? → gyms insert usr-<ms> → lat/lng) together; panel read; QR «Kod yarat» (gym_rotate_checkin_code)',
      'phone guards: the trainer listing and the --phone-gym must belong to @yghh before any request or check-in is sent',
    ],
  },
  {
    name: 'race-username',
    title: 'u4 and u5 claim the same @username at the same instant',
    needs: [],
    actors: ['u4', 'u5'],
    run: phaseRaceUsername,
    plan: ['u4 + u5: profile edit → username_taken → profiles upsert with the SAME handle, together', 'exactly one wins; loser told «Bu istifadəçi adı tutulub»; server + phone state re-read'],
  },
  {
    name: 'race-requests',
    title: 'all 5 users send t1 a trainer request at the same instant',
    needs: [],
    actors: ['u1', 'u2', 'u3', 'u4', 'u5', 't1', 't2', 't3'],
    run: phaseRaceRequests,
    plan: ['u1..u5 (+u1 double tap, +phone trainer): trainers owner_id → trainer_requests upsert, together', 't1 getMyStudents: exactly 5 pending, no duplicates; t2/t3 see nothing; public clients=0'],
  },
  {
    name: 'decide-concurrently',
    title: 't1 accepts u1–u3 and declines u4 at the same instant',
    needs: ['race-requests'],
    actors: ['u1', 'u2', 'u3', 'u4', 'u5', 't1'],
    run: phaseDecide,
    plan: [
      't1: 4 decideTrainerRequest updates together',
      'users re-read; t1 pending=[u5] active=[u1,u2,u3]; public clients=3; u4 cannot self-accept',
      'u3 (accepted) re-sends through requestTrainer: must not reopen to pending (t1 re-accepts if it does)',
    ],
  },
  {
    name: 'program-chat',
    title: 'assigned program + first messages from both sides at once',
    needs: ['race-requests', 'decide-concurrently'],
    actors: ['t1', 't2', 't3', 'u1', 'u2', 'u3'],
    run: phaseProgramChat,
    plan: [
      't1..t3: programs insert (builder payload) together — ids are mine-<ms>, so they must not collide',
      't1: student_programs upsert for u1; u1 reads it and opens t1\'s program, u2 sees none',
      't1 + u1: open_thread + first message together; realtime delivery to u1, none to eavesdropping u2',
      'u2: cannot read/post/list/open the t1–u1 thread',
      'u3: two first messages to t1 together — the one-until-reply gate must let exactly one through',
    ],
  },
  {
    name: 'checkins-vs-rotate',
    title: '5 check-ins while the gym rotates its door code',
    needs: [],
    actors: ['u1', 'u2', 'u3', 'u4', 'u5', 'g1'],
    run: phaseCheckins,
    plan: [
      'skipped within 5 min of 00:00 / 04:00 Baku (the panel\'s day and the gym-day turn there)',
      'u1..u5 check_in_with_code(old) + g1 gym_rotate_checkin_code, together',
      'old code dead; bounced users retry new code; daily cap; panel occupancy = real successes',
      'with a verified --phone-gym: u4 then u5 at the phone gym, one at a time, gym_id compared before the second',
    ],
  },
  {
    name: 'daypass',
    title: 'day-pass price, issue, switch-off race, reception check',
    needs: [],
    actors: ['g1', 'g2', 'u2', 'u3', 'u4'],
    run: phaseDaypass,
    plan: ['g2 edits day_pass=7; u2 create_day_pass', 'g2 switches allow_day_pass off WHILE u4 asks, together', 'u3 refused day_pass_off; u2 pass still returned; g2 check_day_pass valid; g1 not_found'],
  },
  {
    name: 'privacy',
    title: 'what other roles can read or change',
    needs: ['race-requests', 'decide-concurrently', 'program-chat', 'checkins-vs-rotate'],
    actors: ['g1', 'u1', 'u2', 'u5', 't1'],
    run: phasePrivacy,
    plan: [
      'u1 logs a workout + PR; g1 reads u1 workouts/prs/progress/threads/messages/…: 0 rows',
      'u5 vs t1\'s requests; u1 edits g1 / writes t1\'s listing / rotates g1 code: refused',
      'server-rule probes: a review below 3 check-ins refused by reviews_insert; forged-reply stripping UNREACHABLE (needs 3 gym-days)',
    ],
  },
  {
    name: 'end-student',
    title: 'two devices of t1 end u2 at once',
    needs: ['race-requests', 'decide-concurrently'],
    actors: ['t1', 'u2'],
    run: phaseEndStudent,
    plan: [
      't1 assigns u2 a program; two endStudent updates together → exactly one lands',
      'u2 sees ended (decided_at stamped); t1 active −1; public clients recounted',
      't1 can no longer open a thread with u2 (no_relationship); u2 keeps the assignment',
    ],
  },
  {
    name: 'social',
    title: 'likes, comments, follows and partner requests (crossing + one-way) — on TEST content only',
    needs: [],
    actors: ['u1', 'u2', 'u3', 'u4', 'u5'],
    run: phaseSocial,
    plan: [
      'not run under --keep (the TEST post only goes with u1\'s account); u1: «Yeni post» (community_posts insert, text only), id read back from the feed filtered to u1\'s own posts',
      'every racing step lines up the WRITES, not just the calls: each actor does its own reads (getUser, profile), then all writes leave at a second barrier',
      'u1..u5 post_likes insert together (+u4 second device): likes = rows (schema82 lock-then-count), judged by whether the writes overlapped (in flight together + created_at = transaction start); one row for u4; u2+u3 unlike together: recount',
      'u2..u5 comments insert together; u1 reads comments_for; card count = TEST rows + outside rows; comment_likes upsert u1×2 + u4 together; u1 replies to u3; u3 cannot delete u2\'s; u5 deletes its own (sheet re-read)',
      'u2..u5 follows insert together (+u5 second device): followCounts(u1) = TEST rows + outside rows (counted apart), one row for u5; myFollowing each; u2 unfollows',
      'u4 + u5 send_match_request to each other together (crossing): since schema84 the second ask is written «accepted» and match_requests_mutual settles the first, so BOTH rows must end accepted, neither «Təkliflər» may offer a card, and both phones must say matched now and at the next launch; their chat opens with two first messages at once, one thread',
      'u2 → u3 one-way (a pair this phase has not matched): the row stays «pending», u3\'s «Təkliflər» shows the card, u3 accepts; both sides then read matched with no card and no open offer, at the next launch too; the chat takes one message each way',
      'Bildirişlər: post_like / follow / comment_like / comment_reply exactly once each (no duplicate for a double tap); match_* built from what each send really wrote — «pending» → one match_request to the person asked, «accepted» → one match_accepted to whoever asked first and NO match_request — plus one match_accepted per «Qəbul et»; unread badge = unread rows',
      'nothing real is liked, commented, followed or joined — those flows are UNREACHABLE by rule; reports/blocks by real people are not countable — ids to check with SQL go to report.expectedDeleted',
    ],
  },
  {
    name: 'cleanup',
    title: 'every actor deletes itself; public listings re-read',
    needs: [],
    actors: [],
    run: phaseCleanup,
    plan: [
      'TEST coaches unlisted first (before any phone wait); inventory as each actor, real people\'s rows COUNTED',
      'every actor deletes every program it owns; accepted reviews removed; gyms: day passes off + door code rotated',
      'all actors delete_my_account() together (3 retries on failure); JWTs must stop resolving',
      'bare key re-reads trainers/programs/reviews of this run and every @handle (username_taken); known leftovers listed',
    ],
  },
];
const PHASE_BY_NAME = Object.fromEntries(PHASES.map((p) => [p.name, p]));

function selectPhases(only) {
  if (!only) return PHASES.map((p) => p.name);
  const want = new Set(['setup', 'cleanup']);
  const add = (n) => {
    for (const d of PHASE_BY_NAME[n].needs) add(d);
    want.add(n);
  };
  add(only);
  return PHASES.map((p) => p.name).filter((n) => want.has(n));
}

/** A full run brings all ten. `--only` brings just the actors its phases use,
 *  so a focused re-run spends fewer anonymous sign-ins (they are rate-limited
 *  per IP); `--only setup` / `--only cleanup` still means all ten. */
function actorsFor(phases) {
  if (phases.length === PHASES.length) return ALL_ACTORS;
  const keys = new Set();
  for (const n of phases) for (const k of PHASE_BY_NAME[n].actors) keys.add(k);
  return keys.size ? ALL_ACTORS.filter((k) => keys.has(k)) : ALL_ACTORS;
}

// ------------------------------------------------------------- dry run ----

async function dryRun(opts) {
  let attempts = 0;
  const blocked = (what) => {
    attempts += 1;
    throw new Error(`[dry] network blocked: ${what}`);
  };
  globalThis.fetch = () => blocked('fetch');
  globalThis.WebSocket = class {
    constructor() {
      blocked('WebSocket');
    }
  };

  const runId = Date.now().toString(36).slice(-6);
  const phases = selectPhases(opts.only);
  const keys = actorsFor(phases);
  const problems = [];
  console.log('SPOT sim — DRY RUN. Nothing below is sent anywhere.\n');

  try {
    const env = loadEnv();
    console.log(`key: publishable (${env.anonKey.slice(0, 15)}…) for ${new URL(env.url).host} — read from .env, not from the shell`);
  } catch (e) {
    problems.push(`env: ${e.message}`);
  }

  console.log(`run id (example): ${runId}`);
  console.log(`phases: ${phases.join(' → ')}${opts.keep ? `   [--keep: cleanup skipped${phases.includes('social') ? '; social NOT run — its public TEST post could not be removed' : ''}]` : ''}`);
  for (const n of phases) {
    const p = PHASE_BY_NAME[n];
    if (typeof p.run !== 'function') problems.push(`phase ${n} has no runner`);
    console.log(`\n  ${n} — ${p.title}${p.needs.length ? `   (needs: ${p.needs.join(', ')})` : ''}`);
    for (const line of p.plan) console.log(`     · ${line}`);
  }

  console.log(`\nactors (${keys.length}):`);
  for (const k of keys) {
    try {
      const a = makeActor(ROLE_OF[k[0]], Number(k.slice(1)), runId, { dry: true });
      if (!a.name.startsWith('TEST ')) problems.push(`${k}: display name does not start with «TEST »`);
      if (!a.username.startsWith(`sim_${runId}_`)) problems.push(`${k}: @username does not start with sim_${runId}_`);
      console.log(`  ${k.padEnd(3)} ${a.role.padEnd(8)} «${a.name}»  @${a.username}`);
    } catch (e) {
      problems.push(`${k}: ${e.message}`);
    }
  }
  const race = `sim_${runId}_race`;
  if (!USERNAME_RE.test(race)) problems.push(`race handle @${race} breaks the username rule`);

  console.log('\nphone (11th participant, optional):');
  console.log(`  trainer: ${opts.phoneTrainer ? `${opts.phoneTrainer} — used only if its public listing belongs to @${opts.phoneUsername}` : 'not involved'}`);
  console.log(`  gym: ${opts.phoneCode ? `${opts.phoneGym} with code ${opts.phoneCode.slice(0, 3)}… — used only if that gym belongs to @${opts.phoneUsername}; u4, then u5, check in there one at a time (gym_id compared after the first)` : 'not involved'}`);
  if (opts.phoneOwnerProfile) console.log(`  owner profile: ${opts.phoneOwnerProfile} (checked against owner_id when the handle is not readable)`);
  if (opts.phoneWait) console.log(`  wait before cleanup: ${opts.phoneWait} s (accept/decline on the phone)`);

  // Wiring: every export used exists, every app call carries a valid anchor.
  const files = [resolve(SIM_DIR, 'lib.mjs'), resolve(SIM_DIR, 'actions.mjs')];
  const anchors = validateAnchors(files);
  problems.push(...anchors.errors);
  const src = readFileSync(resolve(SIM_DIR, 'actions.mjs'), 'utf8');
  const exempt = /^(probe|inventory|public)|^(isUsernameConflict|newId|chatRefusalText)$/;
  const chunks = src.split(/^export (?:async )?function /m).slice(1);
  let checkedFns = 0;
  for (const chunk of chunks) {
    const name = chunk.match(/^(\w+)/)?.[1];
    if (!name || exempt.test(name)) continue;
    checkedFns += 1;
    const body = chunk.split(/^}/m)[0];
    if (!body.includes('// app:')) problems.push(`actions.mjs: ${name}() has no «// app:» anchor`);
    if (typeof act[name] !== 'function') problems.push(`actions.mjs: ${name} is not exported as a function`);
  }
  if (typeof act.deleteMyAccount !== 'function') problems.push('deleteMyAccount is not wired to lib.cleanup');
  console.log(`\nwiring: ${checkedFns} app actions, ${anchors.anchors} «// app:» anchors (${anchors.verified} verified against the app line, ${anchors.structural} structural), ${anchors.mirrors} «// mirrors:» references`);

  const gyms = keys.filter((k) => k.startsWith('g')).length;
  const coaches = keys.filter((k) => k.startsWith('t')).length;
  const passes = phases.includes('daypass');
  const requests = opts.phoneTrainer && phases.includes('race-requests');
  console.log('\nthis LIVE run leaves behind: nothing expected (since schema81 delete_my_account() also removes');
  console.log('  never-listed gyms, their codes and day passes, programs and the notifications an account caused).');
  if (gyms || passes) console.log(`  · ${gyms} TEST gym(s)${passes ? ' + day passes' : ''} cannot be re-read with the public key — confirm with read-only SQL`);
  if (requests) console.log(`  · the TEST requests to @${opts.phoneUsername} and their notifications go with the TEST accounts`);
  const program = phases.includes('program-chat');
  if (coaches) console.log(`  while it runs: ${coaches} «TEST t…» trainer listing(s) are public for a few seconds in setup, then unlisted`);
  if (program) console.log(`  while it runs: up to ${coaches || 3} «TEST proqram …» row(s) are readable in the library (programs_read is public), deleted at cleanup`);
  if (phases.includes('social') && opts.keep) {
    console.log('  social: NOT run under --keep — its «TEST post …» would stay public in the İcma feed with no end date');
    console.log('    (the app has no delete-post path; only delete_my_account removes it). Reported UNREACHABLE.');
  } else if (phases.includes('social')) {
    console.log('  while it runs: 1 «TEST post …» is public in the İcma feed (people without a home gym see it), with TEST comments under it;');
    console.log('    the app has no delete-post path, so it goes when u1 deletes its account (delete_my_account removes posts and comments;');
    console.log('    likes, comment likes, follows, partner requests and notifications cascade). A real person\'s like on it goes with it;');
    console.log('    a real person\'s COMMENT would be orphaned (comments.target_key has no foreign key) — counted, reported, never read.');
    console.log('    A real person\'s REPORT of the post or a TEST commenter (reports.target_id is text) or BLOCK of a TEST actor cannot be');
    console.log('    counted with the public key: the ids to check with read-only SQL go to report.expectedDeleted.reports_to_check.');
    console.log('  nothing real is liked, commented, followed or joined.');
  }

  console.log(`\nnetwork calls attempted: ${attempts}`);
  if (attempts) problems.push(`${attempts} network call(s) were attempted in --dry`);
  if (problems.length) {
    console.log(`\nDRY RUN FAILED — ${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('\nDRY RUN OK — wiring valid, no network touched. Run without --dry to go live.');
  process.exit(0);
}

// ---------------------------------------------------------------- live ----

function printSummary(ctx) {
  const t = ctx.rec.totals();
  console.log(`\n==== SPOT sim ${ctx.runId}: ${t.PASS} PASS · ${t.FAIL} FAIL · ${t.UNREACHABLE} UNREACHABLE · ${t.INFO} INFO   (${round((Date.now() - ctx.t0) / 1000)} s)`);
  for (const p of ctx.rec.phases) {
    const c = { PASS: 0, FAIL: 0, UNREACHABLE: 0, INFO: 0 };
    for (const x of p.checks) c[x.status] += 1;
    console.log(`  ${p.name.padEnd(20)} ${String(p.ms ?? '—').padStart(8)} ms   ${c.PASS} pass, ${c.FAIL} fail, ${c.UNREACHABLE} unreachable`);
  }
  const fails = ctx.rec.checks.filter((c) => c.status === 'FAIL');
  if (fails.length) {
    console.log('\nFAIL:');
    for (const f of fails) console.log(`  ✗ ${f.id} — ${f.message}`);
  }
  const unr = ctx.rec.checks.filter((c) => c.status === 'UNREACHABLE');
  if (unr.length) {
    console.log('\nUNREACHABLE (not faked):');
    for (const u of unr) console.log(`  – ${u.id} — ${u.message}`);
  }
  if (ctx.rec.leftovers.length) {
    console.log('\nLEFT OVER in the live database:');
    for (const l of ctx.rec.leftovers) console.log(`  • ${l.kind}: ${JSON.stringify({ ...l, kind: undefined })}`);
  }
  console.log(`\nreport: ${REPORT_PATH.replace(ROOT, '').replace(/^[\\/]/, '')}`);
}

function finish(ctx, code) {
  if (ctx.finished) return;
  ctx.finished = true;
  const actors = [...ctx.actors.values()].map((a) => ({
    key: a.key,
    role: a.role,
    name: a.name,
    username: a.username,
    userId: a.userId,
    profileId: a.profileId,
    trainerId: a.trainerId ?? null,
    gymId: a.gymId ?? null,
    deleted: a.deleted,
  }));
  try {
    writeReport(REPORT_PATH, ctx.rec, { actors, inventoryBeforeDeletion: ctx.inventory ?? null, phone: ctx.phone });
  } catch (e) {
    console.error(`could not write the report: ${e.message}`);
  }
  printSummary(ctx);
  const fails = ctx.rec.totals().FAIL;
  process.exit(code ?? (fails ? 1 : 0));
}

/** argv as it goes into the report. The phone's door code is a key to a real
 *  gym — check_in_with_code checks only the code and the opening hours, not
 *  where the phone is — so it never lands in last-report.json in clear text. */
function redactArgv(argv) {
  return argv.map((v, i) => (argv[i - 1] === '--phone-code' ? `${v.slice(0, 3)}…` : v));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.dry) return dryRun(opts);

  const env = loadEnv();
  const runId = Date.now().toString(36).slice(-6);
  const phases = selectPhases(opts.only);
  const keys = actorsFor(phases);
  const rec = new Recorder({
    runId,
    argv: redactArgv(process.argv.slice(2)),
    phases,
    actors: keys,
    supabaseHost: new URL(env.url).host,
    schemaFactsReadOn: '2026-09-22',
  });
  setRecorder(rec);

  const ctx = {
    runId,
    opts,
    env,
    rec,
    t0: Date.now(),
    actors: new Map(),
    simIds: new Set(),
    // programs: every id a coach's phone minted ({ actor, id, result });
    // reviewsWritten: { key, gymId } of reviews the server should have refused.
    // posts / comments: ids of the social phase's TEST rows, proven gone at cleanup.
    state: { gyms: {}, requestIds: {}, active: {}, programId: null, programs: [], threadId: null, dayPasses: 0, dayPassCode: null, landedAtG1: [], reviewsWritten: [], posts: [], comments: [], socialRan: false },
    phone: { trainerOk: false, gymOk: false, ownerProfileId: null, requests: 0, decisions: 0, checkins: 0 },
    aborted: false,
    sigint: false,
    running: null,
    cleanupPromise: null,
    unlistedForCleanup: false,
    finished: false,
  };
  for (const k of keys) ctx.actors.set(k, makeActor(ROLE_OF[k[0]], Number(k.slice(1)), runId, { env, recorder: rec }));

  console.log(`SPOT sim ${runId} — ${keys.length} virtual actors against ${new URL(env.url).host}`);
  console.log(`phases: ${phases.join(' → ')}`);

  // Ctrl+C, a closed terminal (SIGHUP, SIGBREAK on Windows), SIGTERM and a
  // crash all take the same road: no new step starts (together() refuses once
  // aborted), the step in flight settles — every request is capped at 20 s, so
  // this is bounded — and only then does every actor delete itself. Deleting
  // under a write still in flight could let that write land AFTER the
  // inventory, e.g. a program row that then outlives its author.
  const stop = (why) => {
    if (ctx.sigint) {
      // Second time: stop waiting, but never leave without naming who is still there.
      const left = [...ctx.actors.values()].filter((a) => a.userId && !a.deleted);
      console.log(`\n${why} again — leaving now; ${left.length} actor(s) NOT deleted${left.length ? ':' : ''}`);
      for (const a of left) {
        console.log(`  ${a.key}  user ${a.userId}  profile ${a.profileId ?? '—'}  @${a.username}${a.trainerId ? `  trainer ${a.trainerId}` : ''}${a.gymId ? `  gym ${a.gymId}` : ''}`);
        rec.leftover('actor-not-deleted', { actor: a.key, userId: a.userId, profileId: a.profileId, username: a.username, trainerId: a.trainerId ?? null, gymId: a.gymId ?? null, why: `left on a second ${why}` });
      }
      finish(ctx, 130);
      process.exit(130);
    }
    ctx.sigint = true;
    ctx.aborted = true;
    abortState.aborted = true;
    console.log(
      opts.keep
        ? `\n${why} — --keep is set: TEST coaches are unlisted, nothing is deleted`
        : `\n${why} — no new step starts; waiting for the one in flight, then every virtual actor deletes itself… (again to leave at once)`
    );
    (ctx.running ?? Promise.resolve())
      .then(async () => {
        if (rec.cur?.name !== 'cleanup') {
          rec.endPhase();
          rec.startPhase('cleanup', `${why} — every actor deletes itself`);
        }
        if (opts.keep) {
          abortState.cleaning = true;
          await unlistTrainers(ctx, 'TEST coaches hidden from Kəşf (--keep)');
          recordKept(ctx);
          return null;
        }
        return cleanupAll(ctx, why);
      })
      .catch((e) => console.error(`cleanup error: ${e.message}`))
      .finally(() => {
        rec.endPhase('cleanup');
        finish(ctx, 130);
      });
  };
  process.on('SIGINT', () => stop('Ctrl+C'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGHUP', () => stop('terminal closed (SIGHUP)'));
  if (process.platform === 'win32') process.on('SIGBREAK', () => stop('Ctrl+Break / console closed (SIGBREAK)'));
  process.on('uncaughtException', (e) => {
    console.error(e);
    stop(`uncaught exception: ${e?.message ?? e}`);
  });
  process.on('unhandledRejection', (e) => {
    console.error(e);
    stop(`unhandled rejection: ${e?.message ?? e}`);
  });

  try {
    for (const name of phases) {
      if (name === 'cleanup' || ctx.aborted) continue;
      const phase = PHASE_BY_NAME[name];
      rec.startPhase(name, phase.title);
      ctx.running = (async () => {
        try {
          await phase.run(ctx);
        } catch (e) {
          if (e?.name === 'SimAbort') info(`${name}.aborted`, `phase stopped: ${e.message}`);
          else expect(false, `${name}.harness-error`, `the harness itself threw: ${e.message}`, errInfo(e));
        }
      })();
      await ctx.running;
      rec.endPhase(name);
    }
  } finally {
    if (!ctx.sigint) {
      rec.startPhase('cleanup', PHASE_BY_NAME.cleanup.title);
      try {
        await phaseCleanup(ctx);
      } catch (e) {
        if (e?.name !== 'SimAbort') expect(false, 'cleanup.harness-error', `cleanup threw: ${e.message}`, errInfo(e));
      }
      // A signal that arrived during cleanup owns the finish (it waits for the
      // same cleanup promise, then writes the report).
      if (!ctx.sigint) {
        rec.endPhase();
        finish(ctx);
      }
    }
  }
}

// Exported so the phase logic can be exercised without the CLI; the run only
// starts when this file is the program being executed.
export { PHASES, PHASE_BY_NAME, cleanupAll, selectPhases, actorsFor, finish };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
