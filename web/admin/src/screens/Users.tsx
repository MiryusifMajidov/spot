import { useEffect, useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';
import { audit } from '../lib/audit';
import { toast } from '../ui/toast';
import { useAuth, atLeast } from '../lib/auth';
import { Icon } from '../ui/icons';
import type { Profile, ProfileStats } from '../lib/types';
import type { ScreenProps } from '../App';

type RoleFilter = 'all' | 'user' | 'trainer' | 'gym_admin';
type StatusFilter = 'all' | 'active' | 'muted' | 'suspended' | 'banned';
type Ladder = 'warn' | 'mute' | 'suspend' | 'ban';

// A pending destructive action awaiting a mandatory reason.
interface Pending {
  title: string;
  hint: string;
  run: (reason: string) => Promise<void>;
}

const ROLE_LABEL: Record<string, { text: string; cls: string }> = {
  user: { text: 'İstifadəçi', cls: 'grey' },
  trainer: { text: 'Müəllim', cls: 'blue' },
  gym_admin: { text: 'Zal admini', cls: 'green' },
};

const STATUS_META: Record<Profile['status'], { text: string; dot: string; color: string }> = {
  active: { text: 'Aktiv', dot: '#5B7F00', color: '#3A3A42' },
  muted: { text: 'Susdurulub', dot: '#FF9500', color: '#8A5A00' },
  suspended: { text: 'Dayandırılıb', dot: '#FF9500', color: '#8A5A00' },
  banned: { text: 'Ban', dot: '#FF3B30', color: '#C42B22' },
};

/** The mute rung is a SEVEN-DAY message ban, so it must carry an expiry —
 *  a mute with no `status_until` is a permanent mute, which is not the rule. */
const MUTE_DAYS = 7;

const LADDER_META: Record<
  Ladder,
  { label: string; status: Profile['status'] | null; days: number | null; done: string; effect: string }
> = {
  warn: {
    label: 'Xəbərdarlıq göndər', status: null, days: null,
    done: 'Xəbərdarlıq göndərildi',
    effect: 'Hesaba toxunulmur — yalnız moderasiya qeydi və audit yazılır.',
  },
  mute: {
    label: `Sussun (${MUTE_DAYS} gün mesaj qadağası)`, status: 'muted', days: MUTE_DAYS,
    done: 'Mesaj qadağası tətbiq edildi',
    effect: `${MUTE_DAYS} gün mesaj, şərh və məşq sorğusu göndərə bilməz. Müddət bitəndə özü açılır.`,
  },
  suspend: {
    label: 'Dayandır (axtarışdan çıxar)', status: 'suspended', days: null,
    done: 'Hesab dayandırıldı',
    effect: 'Partnyor axtarışından və «indi zalda» siyahısından çıxarılır, yeni məzmun yaza bilməz.',
  },
  ban: {
    label: 'Ban', status: 'banned', days: null,
    done: 'Hesab banlandı',
    effect: 'Tətbiqdə tam bağlanma — giriş edə bilər, amma heç nə yaza və axtarışda görünə bilməz.',
  },
};

/** A sanction with a past `status_until` is over. The panel must show that,
 *  otherwise a lapsed 7-day mute reads as a live one forever. */
function lapsed(p: Pick<Profile, 'status' | 'status_until'>): boolean {
  return p.status !== 'active' && !!p.status_until && new Date(p.status_until).getTime() <= Date.now();
}

/** What the account is subject to RIGHT NOW, expiry taken into account. */
function effectiveStatus(p: Pick<Profile, 'status' | 'status_until'>): Profile['status'] {
  return lapsed(p) ? 'active' : p.status;
}

function untilLabel(p: Pick<Profile, 'status' | 'status_until'>): string | null {
  if (p.status === 'active' || !p.status_until) return null;
  return lapsed(p)
    ? `müddəti bitib · ${new Date(p.status_until).toLocaleDateString('az')}`
    : `${new Date(p.status_until).toLocaleDateString('az')}-dək`;
}

/** Never render the real number. Show +994 ** *** ** <last two digits>. */
/** `undefined` is now the normal case: the column is withheld from the panel and
 *  the number arrives only from the audited admin_unmask_phone RPC. */
function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 2) return '+994 ** *** ** **';
  return `+994 ** *** ** ${digits.slice(-2)}`;
}

export function Users({ search }: ScreenProps) {
  const { admin } = useAuth();
  const canModerate = atLeast(admin?.role, 'moderator');
  const canUnmask = atLeast(admin?.role, 'ops');

  const [rows, setRows] = useState<Profile[]>([]);
  const [gymNames, setGymNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<RoleFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [onlyReported, setOnlyReported] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Profile | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  /* Two failures, told apart: the roster read and the counters read. «0 users»
     must never stand in for «we could not ask». */
  const [failed, setFailed] = useState(false);
  const [statsFailed, setStatsFailed] = useState(false);
  // Phones that ops explicitly unmasked this session (id -> real number).
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    // try/catch/finally: a throw in the merge below used to skip
    // `setLoading(false)`, leaving the roster — and the sanction ladder that
    // lives in its row drawer — behind a spinner that never stopped.
    try {
      await loadInner();
    } catch {
      setFailed(true);
      setStatsFailed(true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadInner() {
    const [{ data: profs, error: profErr }, { data: gyms }, { data: stats, error: statErr }] = await Promise.all([
      // Never request `phone`: schema9 revokes column access to it, so `select('*')`
      // would fail outright — and the masked value shown here is meant to come from
      // the audited admin_unmask_phone RPC, not from the raw row.
      supabase
        .from('profiles')
        .select(
          // No `status_reason`: schema57 revoked SELECT on it, and PostgREST fails
          // the WHOLE select when one column is ungranted — which turned a
          // permission error into «0 istifadəçi» over a full database. It now
          // arrives through admin_profile_stats(), which checks the admin role.
          'id,user_id,name,gender,age,home_gym_id,level,goals,types,time_slot,bio,visibility,show_in_gym_list,role,specialty,price_from,avatar_url,created_at,status,status_until,last_active_at'
        )
        .order('created_at', { ascending: false }),
      supabase.from('gyms').select('id,name'),
      // The real counters. Computed from `reports`, `match_requests` and
      // `check_ins` — see schema20. A profile missing from this result gets
      // zeros, which here genuinely means «nothing found», not «not measured».
      supabase.rpc('admin_profile_stats'),
    ]);
    const stat = new Map(
      ((stats as ProfileStats[]) ?? []).map((r) => [r.profile_id, r])
    );
    // The row as it comes out of `profiles`: the four counters are not columns
    // there, so they are absent until merged in below.
    type ProfileRow = Omit<Profile, 'reports_count' | 'requests_sent' | 'requests_answered' | 'checkin_streak' | 'status_reason'>;
    // A refused read is not an empty platform. Without this the screen stated
    // «0 istifadəçi · 0 aktiv» over a database full of people, and the sanction
    // ladder — which lives in the row drawer — became unreachable with no
    // explanation anywhere on screen.
    setFailed(!!profErr);
    setStatsFailed(!!statErr);
    /* `?? 0` is only correct when the CALL landed: a profile missing from a
       successful result really has nothing to count. When the whole
       admin_profile_stats() call failed, the same `?? 0` printed «0 şikayət» on
       every row — including the account a moderator was investigating — and put
       those zeros in the CSV they handed to a colleague. Null now, «—» on
       screen, and the «yalnız şikayət olunanlar» filter turned off, because with
       no counters there is nothing to filter by. */
    if (statErr) setOnlyReported(false);
    setRows(
      ((profs as ProfileRow[]) ?? []).map((p) => {
        const s = stat.get(p.id);
        return {
          ...p,
          reports_count: statErr ? null : s?.reports_count ?? 0,
          requests_sent: statErr ? null : s?.requests_sent ?? 0,
          requests_answered: statErr ? null : s?.requests_answered ?? 0,
          checkin_streak: statErr ? null : s?.checkin_streak ?? 0,
          status_reason: s?.status_reason ?? null,
        };
      })
    );
    const map: Record<string, string> = {};
    for (const g of (gyms as { id: string; name: string }[]) ?? []) map[g.id] = g.name;
    setGymNames(map);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((p) => {
      if (role !== 'all' && (p.role ?? 'user') !== role) return false;
      if (status !== 'all' && effectiveStatus(p) !== status) return false;
      if (onlyReported && (p.reports_count ?? 0) === 0) return false;
      if (q) {
        const hay = `${p.name ?? ''} ${p.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, role, status, onlyReported, search]);

  const reportedCount = useMemo(() => rows.filter((p) => (p.reports_count ?? 0) > 0).length, [rows]);
  const activeCount = useMemo(() => rows.filter((p) => effectiveStatus(p) === 'active').length, [rows]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === filtered.length && filtered.length > 0 ? new Set() : new Set(filtered.map((p) => p.id))));
  }

  function resetFilters() {
    setRole('all');
    setStatus('all');
    setOnlyReported(false);
  }

  // ---- destructive flow: gate → reason → write → moderation_actions → audit → toast → reload ----
  function ask(p: Pending) {
    setReason('');
    setPending(p);
  }

  async function confirmPending() {
    if (!pending) return;
    const r = reason.trim();
    if (!r) {
      toast('Səbəb mütləqdir');
      return;
    }
    setBusy(true);
    try {
      await pending.run(r);
    } finally {
      setBusy(false);
      setPending(null);
      setReason('');
    }
  }

  /** Applies one rung of the ladder. Returns true ONLY when every write that the
   *  action depends on actually landed. Reports rather than throws: the single
   *  caller of the bulk path loops over this, and an unhandled rejection would
   *  abort the rest of the batch silently. */
  async function applyLadder(target: Profile, action: Ladder, r: string, quiet = false): Promise<boolean> {
    const meta = LADDER_META[action];
    const say = (m: string) => {
      if (!quiet) toast(m);
    };
    if (meta.status) {
      // `.select('id')` is required, not cosmetic: an RLS-filtered update returns
      // `error: null` with zero rows changed, so checking the error alone would
      // still let a no-op report success.
      //
      // `status_until` is written together with `status`: it is what makes the
      // mute rung a SEVEN-DAY ban rather than a permanent one, and what the
      // server-side check reads to decide whether the sanction is still live.
      const until = meta.days == null ? null : new Date(Date.now() + meta.days * 864e5).toISOString();
      /* Through the RPC, not a table UPDATE. `status`, `status_reason` and
         `status_until` have no UPDATE grant for `authenticated` and must not get
         one: `profiles_update` matches a user's OWN row, so a column grant would
         let a banned account lift its own ban. Until schema64 there was no other
         path either, which is why every rung of this ladder returned 42501 and
         nobody on SPOT could be sanctioned at all. The RPC also writes the audit
         entry, so a sanction can no longer exist without a record. */
      const { error } = await supabase.rpc('admin_set_profile_status', {
        p_profile: target.id,
        p_status: meta.status,
        p_reason: r,
        p_until: until,
      });
      if (error) {
        say(`Alınmadı: ${error.message}`);
        return false;
      }
    }
    // For `warn` meta.status is null, so this row and the audit entry are the ONLY
    // record the action ever happened — a failed insert must never toast success.
    const { error: mErr } = await supabase.from('moderation_actions').insert({
      admin_id: admin?.user_id ?? null,
      target_type: 'user',
      target_id: target.id,
      action,
      reason: r,
    });
    if (mErr) {
      say(`Moderasiya qeydi yazılmadı: ${mErr.message}`);
      return false;
    }
    const auditErr = await audit(action, 'profile', target.id, r);
    say(auditErr ? `${meta.done}, amma audit qeydi yazılmadı: ${auditErr}` : meta.done);
    return true;
  }

  /** Lifts a sanction. Without this the ladder is one-way: a wrongly banned
   *  account, or one whose 7-day mute has lapsed, could never be put back. */
  async function applyRestore(target: Profile, r: string): Promise<boolean> {
    const { error } = await supabase.rpc('admin_set_profile_status', {
      p_profile: target.id,
      p_status: 'active',
      p_reason: r,
      p_until: null,
    });
    if (error) {
      toast(`Alınmadı: ${error.message}`);
      return false;
    }
    const { error: mErr } = await supabase.from('moderation_actions').insert({
      admin_id: admin?.user_id ?? null,
      target_type: 'user',
      target_id: target.id,
      action: 'restore',
      reason: r,
    });
    if (mErr) {
      toast(`Moderasiya qeydi yazılmadı: ${mErr.message}`);
      return false;
    }
    const auditErr = await audit('restore', 'profile', target.id, r);
    toast(auditErr ? `Sanksiya götürüldü, amma audit qeydi yazılmadı: ${auditErr}` : 'Sanksiya götürüldü');
    return true;
  }

  function runRestore(target: Profile) {
    ask({
      title: `Sanksiyanı götür — ${target.name ?? target.id.slice(0, 6)}`,
      hint: 'Hesab yenidən aktiv olacaq. Bu əməliyyat audit log-a düşür.',
      run: async (r) => {
        const ok = await applyRestore(target, r);
        await load();
        if (ok) setOpen(null);
      },
    });
  }

  function runLadder(target: Profile, action: Ladder) {
    const meta = LADDER_META[action];
    ask({
      title: `${meta.label} — ${target.name ?? target.id.slice(0, 6)}`,
      hint: 'Bu əməliyyat audit log-a düşür. Səbəb tələb olunur.',
      run: async (r) => {
        const ok = await applyLadder(target, action, r);
        await load();
        // Keep the drawer open when the write did not land, so the moderator can
        // see the untouched status and retry instead of walking away believing it.
        if (ok) setOpen(null);
      },
    });
  }

  function runBulk(action: Ladder) {
    const targets = rows.filter((p) => selected.has(p.id));
    if (targets.length === 0) return;
    const meta = LADDER_META[action];
    ask({
      title: `${meta.label} — ${targets.length} istifadəçi`,
      hint: 'Səbəb hamısına eyni yazılacaq və audit log-a düşəcək.',
      run: async (r) => {
        let ok = 0;
        let lastError = '';
        for (const t of targets) {
          if (await applyLadder(t, action, r, true)) ok++;
          else lastError = t.name ?? t.id.slice(0, 6);
        }
        if (ok === targets.length) toast(`${meta.done} — ${ok} istifadəçi`);
        else if (ok === 0) toast(`Heç biri tətbiq edilmədi (${targets.length} istifadəçi)`);
        else toast(`${ok}/${targets.length} tətbiq edildi — «${lastError}» alınmadı`);
        setSelected(new Set());
        await load();
      },
    });
  }

  async function unmask(p: Profile) {
    const why = window.prompt('Telefonu açmaq üçün səbəb (audit log-a düşür):');
    if (!why || !why.trim()) return;
    const { data, error } = await supabase.rpc('admin_unmask_phone', { target_profile: p.id, why: why.trim() });
    if (error) {
      toast('Açmaq alınmadı: ' + error.message);
      return;
    }
    const phone = (data as string | null) ?? null;
    if (phone) setRevealed((s) => ({ ...s, [p.id]: phone }));
    toast(phone ? `Telefon: ${phone}` : 'Telefon qeydə alınmayıb');
  }

  function exportCsv() {
    const head = ['id', 'name', 'role', 'gym', 'status', 'status_until', 'reports', 'checkin_streak', 'phone_masked'];
    const lines = filtered.map((p) =>
      [
        p.id,
        p.name ?? '',
        p.role ?? 'user',
        (p.home_gym_id && gymNames[p.home_gym_id]) || '',
        effectiveStatus(p),
        p.status_until ?? '',
        // Empty, never 0: this file leaves the panel and is read without the
        // banner that says the counters could not be obtained.
        p.reports_count ?? '',
        p.checkin_streak ?? '',
        maskPhone(p.phone),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spot-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(
      statsFailed
        ? `${filtered.length} sətir ixrac edildi (maskalanmış) — şikayət və seriya sütunları BOŞDUR, sayğaclar yüklənmədi`
        : `${filtered.length} sətir ixrac edildi (maskalanmış)`,
    );
  }

  const roleChips: { id: RoleFilter; label: string }[] = [
    { id: 'all', label: 'Rol: hamısı' },
    { id: 'user', label: 'İstifadəçi' },
    { id: 'trainer', label: 'Müəllim' },
    { id: 'gym_admin', label: 'Zal admini' },
  ];
  const statusChips: { id: StatusFilter; label: string }[] = [
    { id: 'active', label: 'Aktiv' },
    { id: 'muted', label: 'Susdurulub' },
    { id: 'suspended', label: 'Dayandırılıb' },
    { id: 'banned', label: 'Ban' },
  ];

  return (
    <>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ font: '400 13px/1 var(--font)', color: failed ? 'var(--red)' : 'var(--muted)' }}>
          {loading
            ? '—'
            : failed
              ? 'İstifadəçi siyahısı yüklənmədi'
              : `${rows.length.toLocaleString('az')} nəfər · ${activeCount.toLocaleString('az')} aktiv`}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="btn" onClick={exportCsv}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Icon name="download" size={15} color="var(--ink2)" />
              CSV ixrac
            </span>
          </button>
          <button className="btn primary" onClick={() => toast('Elan göndərmə tezliklə')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Icon name="bell" size={14} color="var(--volt)" />
              Elan göndər
            </span>
          </button>
        </div>
      </div>

      {/* filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {roleChips.map((c) => (
          <button key={c.id} className={'chip' + (role === c.id ? ' active' : '')} onClick={() => setRole(c.id)}>
            {c.label}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
        <button className={'chip' + (status === 'all' ? ' active' : '')} onClick={() => setStatus('all')}>
          Status: hamısı
        </button>
        {statusChips.map((c) => (
          <button key={c.id} className={'chip' + (status === c.id ? ' active' : '')} onClick={() => setStatus(c.id)}>
            {c.label}
          </button>
        ))}
        {/* Disabled while the counters are unknown: an enabled filter that can
            only ever return nobody says «heç kim şikayət olunmayıb» about a
            question it never got to ask. */}
        <button
          className="chip"
          disabled={statsFailed}
          title={statsFailed ? 'Sayğaclar yüklənmədi — bu filtri işlətmək olmur' : undefined}
          onClick={() => !statsFailed && setOnlyReported((v) => !v)}
          style={
            statsFailed
              ? { opacity: 0.45, cursor: 'not-allowed' }
              : onlyReported
                ? { background: 'rgba(255,59,48,.1)', color: '#C42B22', borderColor: 'rgba(255,59,48,.25)' }
                : undefined
          }
        >
          Şikayəti var: {statsFailed ? '—' : reportedCount}
        </button>
        <button className="link" style={{ marginLeft: 'auto' }} onClick={resetFilters}>
          Filtri sıfırla
        </button>
      </div>

      {/* The counters come from admin_profile_stats(); when THAT read fails but the
          roster loads, every number in the table would silently be 0. Say so. */}
      {!loading && !failed && statsFailed ? (
        <div className="card" style={{ padding: 12, marginBottom: 12, borderColor: 'var(--orange)' }}>
          <div style={{ font: '400 12.5px/1.5 var(--font)', color: 'var(--text3)' }}>
            Sayğaclar yüklənmədi — şikayət sayı, sorğu sayı və seriya sütunları boşdur. Sıfırlar ölçülmüş
            rəqəm deyil.
          </div>
        </div>
      ) : null}

      {/* table */}
      {loading ? (
        <div className="spinner" />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  aria-label="Hamısını seç"
                />
              </th>
              <th>İstifadəçi</th>
              <th>Rol</th>
              <th>Zal</th>
              <th>Telefon</th>
              <th>Şikayət</th>
              <th title="Yalnız check-in-lərdən sayılır — məşq qeydləri cihazdan çıxmır">Check-in seriyası</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const rMeta = ROLE_LABEL[p.role ?? 'user'] ?? ROLE_LABEL.user;
              const sMeta = STATUS_META[effectiveStatus(p)];
              const until = untilLabel(p);
              // null = not measured. `?? 0` here is what printed «0» in the
              // Şikayət column of a reported account while the stats call was
              // broken, and made it look clean.
              const reports = p.reports_count;
              // `p.phone` is never selected, so there is nothing to mask: say the
              // number is hidden rather than printing a mask of `undefined`.
              const shownPhone = revealed[p.id] ?? 'gizli';
              return (
                <tr
                  key={p.id}
                  style={{ cursor: 'pointer', background: (reports ?? 0) > 0 ? 'rgba(255,59,48,.04)' : undefined }}
                  onClick={() => setOpen(p)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      aria-label="Seç"
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div className="avatar" style={{ width: 34, height: 34 }} />
                      <div>
                        <div style={{ font: '600 13.5px/1 var(--font)' }}>
                          {p.name ?? 'Adsız'}
                          {p.age ? `, ${p.age}` : ''}
                        </div>
                        <div style={{ font: '400 11.5px/1 var(--font)', color: 'var(--muted)', marginTop: 5 }}>
                          #{p.id.slice(0, 6)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={'badge ' + rMeta.cls}>{rMeta.text}</span>
                  </td>
                  <td style={{ color: 'var(--muted2)' }}>
                    {(p.home_gym_id && gymNames[p.home_gym_id]) || '—'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ font: '400 12.5px/1 var(--font)', color: revealed[p.id] ? 'var(--ink2)' : 'var(--muted2)' }}>
                        {shownPhone}
                      </span>
                      {/* NOT gated on `p.phone`. The panel deliberately never selects
                          that column (schema9 revokes it), so the value is always
                          undefined and this button could never render — the audited
                          admin_unmask_phone path was unreachable from the UI. */}
                      {canUnmask && !revealed[p.id] ? (
                        <button
                          className="link"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          onClick={() => unmask(p)}
                        >
                          <Icon name="eye" size={13} color="var(--blue)" />
                          aç
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {reports == null ? (
                      <span style={{ color: 'var(--muted)' }} title="Sayğaclar yüklənmədi — bu «0 şikayət» demək deyil">—</span>
                    ) : reports > 0 ? (
                      <span className="badge red">{reports} ŞİKAYƏT</span>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>0</span>
                    )}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                      {(p.checkin_streak ?? 0) > 0 ? <Icon name="flame" size={13} color="#FF6B35" /> : null}
                      {p.checkin_streak == null ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>—</span> : p.checkin_streak}
                    </span>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: sMeta.dot }} />
                      <span style={{ font: '500 12.5px/1 var(--font)', color: sMeta.color }}>{sMeta.text}</span>
                    </span>
                    {until ? (
                      <div style={{ font: '400 10.5px/1 var(--font)', color: 'var(--muted)', marginTop: 5 }}>{until}</div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">
                  {failed
                    ? 'İstifadəçi siyahısı yüklənmədi — bu, platformada istifadəçi olmadığı demək DEYİL. Səhifəni yenilə; problem qalarsa, icazələri yoxla.'
                    : 'İstifadəçi tapılmadı'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      {/* bulk-action bar */}
      {selected.size > 0 ? (
        <div
          style={{
            position: 'sticky',
            bottom: 16,
            marginTop: 16,
            background: 'var(--ink)',
            borderRadius: 12,
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            color: '#fff',
            boxShadow: '0 12px 30px rgba(0,0,0,.28)',
          }}
        >
          <div style={{ font: '600 13px/1 var(--font)' }}>{selected.size} seçildi</div>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.16)' }} />
          <button className="bulk-a" onClick={() => toast('Elan göndərmə tezliklə')} style={bulkBtn}>
            Elan göndər
          </button>
          {canModerate ? (
            <>
              <button onClick={() => runBulk('warn')} style={bulkBtn}>
                Xəbərdarlıq göndər
              </button>
              <button onClick={() => runBulk('mute')} style={{ ...bulkBtn, color: '#FF6B6B' }}>
                Mesaj qadağası
              </button>
            </>
          ) : null}
          <button onClick={() => setSelected(new Set())} style={{ ...bulkBtn, marginLeft: 'auto', color: 'rgba(255,255,255,.5)' }}>
            Seçimi ləğv et
          </button>
        </div>
      ) : null}

      {/* detail modal */}
      {open ? <DetailModal p={open} gymNames={gymNames} canModerate={canModerate} canUnmask={canUnmask} revealed={revealed[open.id]} onUnmask={() => unmask(open)} onLadder={(a) => runLadder(open, a)} onRestore={() => runRestore(open)} onClose={() => setOpen(null)} /> : null}

      {/* reason modal */}
      {pending ? (
        <div className="scrim" onClick={() => !busy && setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ font: '700 16px/1.3 var(--font)', marginBottom: 8 }}>{pending.title}</div>
            <div style={{ font: '400 12.5px/1.5 var(--font)', color: 'var(--muted)', marginBottom: 14 }}>{pending.hint}</div>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Səbəb (mütləqdir)…"
              style={{
                width: '100%',
                minHeight: 92,
                resize: 'vertical',
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: 12,
                font: '400 13.5px/1.5 var(--font)',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" disabled={busy} onClick={() => setPending(null)}>
                Ləğv et
              </button>
              <button className="btn danger" disabled={busy || !reason.trim()} onClick={confirmPending}>
                {busy ? 'İcra olunur…' : 'Təsdiqlə'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const bulkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'rgba(255,255,255,.85)',
  font: '500 12.5px/1 var(--font)',
  padding: 0,
};

function DetailModal({
  p,
  gymNames,
  canModerate,
  canUnmask,
  revealed,
  onUnmask,
  onLadder,
  onRestore,
  onClose,
}: {
  p: Profile;
  gymNames: Record<string, string>;
  canModerate: boolean;
  canUnmask: boolean;
  revealed: string | undefined;
  onUnmask: () => void;
  onLadder: (a: Ladder) => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  // null = the counters call failed. The whole «Aktivlik siqnalı» block then has
  // nothing to report, and a spam verdict computed from 0/0 would be invented.
  const sent = p.requests_sent;
  const answered = p.requests_answered;
  const rate = sent != null && answered != null && sent > 0 ? answered / sent : null;
  const spam = rate !== null && rate < 0.15 && (sent ?? 0) >= 20;
  const eff = effectiveStatus(p);
  const sMeta = STATUS_META[eff];
  const until = untilLabel(p);
  const rMeta = ROLE_LABEL[p.role ?? 'user'] ?? ROLE_LABEL.user;

  const ladder: Ladder[] = ['warn', 'mute', 'suspend', 'ban'];

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: '94vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div className="avatar" style={{ width: 52, height: 52 }} />
          <div style={{ flex: 1 }}>
            <div style={{ font: '700 17px/1.2 var(--font)' }}>
              {p.name ?? 'Adsız'}
              {p.age ? `, ${p.age}` : ''}
            </div>
            <div style={{ font: '400 12px/1.3 var(--font)', color: 'var(--muted)', marginTop: 5 }}>
              #{p.id.slice(0, 8)} · {(p.home_gym_id && gymNames[p.home_gym_id]) || 'zal yox'}
            </div>
          </div>
          <span className={'badge ' + rMeta.cls}>{rMeta.text}</span>
          <button className="btn" style={{ padding: 8 }} onClick={onClose} aria-label="Bağla">
            <Icon name="x" size={16} color="var(--ink2)" />
          </button>
        </div>

        {/* summary rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <Row label="Status">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: sMeta.dot }} />
              <span style={{ color: sMeta.color, fontWeight: 500 }}>{sMeta.text}</span>
              {until ? <span style={{ color: 'var(--muted)', font: '400 11.5px/1 var(--font)' }}>· {until}</span> : null}
            </span>
          </Row>
          {p.status !== 'active' && p.status_reason ? (
            <Row label="Sanksiya səbəbi">
              <span style={{ color: 'var(--muted2)' }}>{p.status_reason}</span>
            </Row>
          ) : null}
          <Row label="Telefon">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {revealed ?? maskPhone(p.phone)}
              {canUnmask && p.phone && !revealed ? (
                <button className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} onClick={onUnmask}>
                  <Icon name="eye" size={13} color="var(--blue)" />
                  aç
                </button>
              ) : null}
            </span>
          </Row>
          <Row label="Səviyyə / məqsəd">
            {[p.level, (p.goals ?? []).join(', ')].filter(Boolean).join(' · ') || '—'}
          </Row>
          <Row label="Qeydiyyat">{new Date(p.created_at).toLocaleDateString('az')}</Row>
          <Row label="Son giriş">
            {p.last_active_at ? new Date(p.last_active_at).toLocaleString('az') : '—'}
          </Row>
        </div>

        {/* activity signal */}
        <div style={{ border: '1px solid var(--line2)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ font: '600 13px/1 var(--font)', marginBottom: 14 }}>Aktivlik siqnalı</div>
          <div style={{ display: 'flex', gap: 22 }}>
            <Stat n={sent ?? '—'} label={<>sorğu<br />göndərdi</>} />
            <Stat n={answered ?? '—'} label={<>cavab<br />aldı</>} color={spam ? '#C42B22' : undefined} />
            <Stat
              n={rate === null ? '—' : `${Math.round(rate * 100)}%`}
              label={<>cavab<br />nisbəti</>}
              color={spam ? '#C42B22' : undefined}
            />
            <Stat n={p.reports_count ?? '—'} label="şikayət" color={(p.reports_count ?? 0) > 0 ? '#C42B22' : undefined} />
          </div>
          {p.reports_count == null ? (
            <div style={{ font: '400 11.5px/1.45 var(--font)', color: 'var(--orange-deep)', marginTop: 12 }}>
              Sayğaclar yüklənmədi — bu rəqəmlər ölçülməyib. «—» sıfır demək deyil.
            </div>
          ) : null}
          {spam ? (
            <div style={{ background: 'rgba(255,59,48,.08)', borderRadius: 11, padding: 12, marginTop: 14 }}>
              <div style={{ font: '500 12px/1.45 var(--font)', color: '#8A2B22' }}>
                Siqnal: {sent} sorğuya {answered} cavab ({Math.round((rate ?? 0) * 100)}%). Spam davranışı ehtimalı yüksəkdir.
              </div>
            </div>
          ) : null}
        </div>

        {/* punishment ladder */}
        <div style={{ font: '600 13px/1 var(--font)', marginBottom: 12 }}>Admin əməliyyatları</div>
        {canModerate ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ladder.map((a) => {
              const danger = a === 'suspend' || a === 'ban';
              const meta = LADDER_META[a];
              return (
                <div key={a}>
                  <button
                    className={'btn' + (danger ? ' danger' : '')}
                    style={{ justifyContent: 'flex-start', textAlign: 'left', width: '100%' }}
                    onClick={() => onLadder(a)}
                  >
                    {meta.label}
                  </button>
                  {/* Spell out the effect: a rung whose consequence is not stated
                      is a button a moderator has to guess about. */}
                  <div style={{ font: '400 11px/1.45 var(--font)', color: 'var(--muted)', margin: '6px 2px 0' }}>
                    {meta.effect}
                  </div>
                </div>
              );
            })}
            {p.status !== 'active' ? (
              <button
                className="btn"
                style={{ justifyContent: 'flex-start', textAlign: 'left', marginTop: 4 }}
                onClick={onRestore}
              >
                Sanksiyanı götür (hesabı aktiv et)
              </button>
            ) : null}
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 4 }}>
              Hər əməliyyat səbəb tələb edir və audit log-a düşür. Sanksiya profilə yazılır
              (<code>status</code> + <code>status_until</code>) və tətbiq onu hər açılışda oxuyur.
            </div>
          </div>
        ) : (
          <div style={{ font: '400 12.5px/1.5 var(--font)', color: 'var(--muted)' }}>
            Cəza əməliyyatları üçün moderator (və ya yuxarı) rolu tələb olunur.
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', font: '400 13px/1 var(--font)' }}>
      <div style={{ color: 'var(--muted)' }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Stat({ n, label, color }: { n: React.ReactNode; label: React.ReactNode; color?: string }) {
  return (
    <div>
      <div style={{ font: '700 20px/1 var(--font)', color }}>{n}</div>
      <div style={{ font: '400 11px/1.3 var(--font)', color: 'var(--muted)', marginTop: 6 }}>{label}</div>
    </div>
  );
}
