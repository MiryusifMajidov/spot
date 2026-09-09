import { useCallback, useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import { audit } from '../lib/audit';
import { toast } from '../ui/toast';
import { useAuth, atLeast } from '../lib/auth';
import { Icon } from '../ui/icons';
import type { Report, ReportMessage } from '../lib/types';
import type { ScreenProps } from '../App';

// ---- category → AZ uppercase label + tone -----------------------------------
const CAT: Record<Report['category'], { label: string; tone: 'red' | 'orange' | 'grey' }> = {
  safety: { label: 'TƏHLÜKƏSİZLİK', tone: 'red' },
  harassment: { label: 'TƏQİB', tone: 'red' },
  spam: { label: 'SPAM', tone: 'grey' },
  fake: { label: 'SAXTA PROFİL', tone: 'grey' },
  // Legacy only: SPOT processes no payments, so nothing in the app can raise
  // this category any more. Kept so historical rows still render a real label.
  payment: { label: 'ÖDƏNİŞ (KÖHNƏ)', tone: 'orange' },
  other: { label: 'DİGƏR', tone: 'grey' },
};

const TARGET_LABEL: Record<Report['target_type'], string> = {
  user: 'İstifadəçi', content: 'Məzmun', gym: 'Zal', trainer: 'Müəllim', message: 'Mesaj',
  support: 'Dəstək müraciəti',
};

// moderation_actions.target_type allows user/content/gym/trainer — map 'message'
// and 'support' → content. For 'support' this is unreachable: the ladder is not
// rendered at all, because a support message has nothing to punish.
function actionTarget(t: Report['target_type']): 'user' | 'content' | 'gym' | 'trainer' {
  return t === 'message' || t === 'support' ? 'content' : t;
}

function slaBadge(due: string): { cls: string; text: string; overdue: boolean } {
  const ms = new Date(due).getTime() - Date.now();
  if (ms < 0) {
    const mins = Math.round(-ms / 60000);
    return { cls: 'red', text: mins < 90 ? `${mins} dəq` : `${Math.round(mins / 60)}s gecikib`, overdue: true };
  }
  const h = ms / 3600000;
  if (h < 1) return { cls: 'red', text: `${Math.max(1, Math.round(h * 60))} dəq`, overdue: false };
  if (h < 4) return { cls: 'red', text: `${Math.round(h)}s ${Math.round((h % 1) * 60)}d`, overdue: false };
  if (h < 24) return { cls: 'orange', text: `${Math.round(h)} saat`, overdue: false };
  return { cls: 'grey', text: `${Math.round(h / 24)} gün`, overdue: false };
}

// punishment ladder (moderator+): moderation_actions.action values.
// `status` is what gets written to profiles.status and `days` the sanction's
// lifetime — the mute rung is a SEVEN-DAY message ban, not a permanent one.
type Rung = 'warn' | 'mute' | 'suspend' | 'ban';

const MUTE_DAYS = 7;

const LADDER: { key: Rung; label: string; status: 'muted' | 'suspended' | 'banned' | null; days: number | null; danger?: boolean }[] = [
  { key: 'warn', label: 'Xəbərdarlıq', status: null, days: null },
  { key: 'mute', label: 'Sussun · ' + MUTE_DAYS + ' gün', status: 'muted', days: MUTE_DAYS },
  { key: 'suspend', label: 'Dayandır', status: 'suspended', days: null },
  { key: 'ban', label: 'Ban', status: 'banned', days: null, danger: true },
];

/* This card used to list four rules in the present tense under the heading
   «Avtomatik siqnal qaydaları», including «24 saatda 3 şikayət → hesab avtomatik
   mesaj qadağasına düşür». Nothing implements three of them: there is no
   trigger, function, cron job or client code that counts reports in a window,
   mutes an account, scans comment text for keywords or routes requests to a
   «şübhəli» box. A moderator who read the mute rule treated a reported account
   as already contained and worked the queue in SLA order while the account kept
   sending messages. Only the first rule is real, and even it is a figure the
   panel computes and DISPLAYS — it tags nothing and stops nobody. */
const AUTO_FLAG: { text: string; live: boolean }[] = [
  { text: 'Sorğu cavab faizi < 15% və ≥ 20 sorğu → İstifadəçilər ekranında hesab kartında «spam davranışı ehtimalı» kimi göstərilir (etiket yazılmır, heç nə bloklanmır)', live: true },
  { text: '24 saatda 3 şikayət → hesabın avtomatik mesaj qadağasına düşməsi', live: false },
  { text: 'Şərhdə açar sözlərin (steroid, dərman adları) avtomatik növbəyə salınması', live: false },
  { text: 'Yeni profil + avatarsız + 10 sorğu → sorğuların «şübhəli» qutusuna yönləndirilməsi', live: false },
];

const LADDER_STEPS = [
  { n: '1', t: 'Xəbərdarlıq' },
  { n: '2', t: '7 gün mesaj qadağası' },
  { n: '3', t: 'Axtarışdan çıxarılma' },
  { n: '4', t: 'Hesabın bağlanması', danger: true },
];

export function Moderation({ go, refreshCounts }: ScreenProps) {
  const { admin } = useAuth();
  const myUid = admin?.user_id ?? '';
  const canAct = atLeast(admin?.role, 'moderator');

  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [rows, setRows] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  // null = the count could not be read. Rendered as «—», never as 0.
  const [resolvedToday, setResolvedToday] = useState<number | null>(0);

  const [active, setActive] = useState<Report | null>(null);
  /** The 15-minute lock write came back with zero rows — the report is open in
   *  read-only mode and nothing is holding it. */
  const [lockFailed, setLockFailed] = useState(false);
  const [msgs, setMsgs] = useState<ReportMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  /* «Şikayət yoxdur» is a claim about the queue. It may only be made after a read
     that landed. */
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    /* try/finally, not a bare sequence: a throw anywhere between here and the
       end used to skip `setLoading(false)`, so the abuse queue span forever with
       no error, no rows and no way to retry short of a reload. */
    try {
      const q = supabase.from('reports').select('*');
      /* PostgREST does not throw: a refused or dropped read returns
         `{data: null, error}`. Reading only `data` turned that into `[]`, and the
         screen then stated «Açıq şikayət yoxdur» and «Bugün həll olundu: 0» over a
         queue holding open safety reports. Dashboard.tsx was fixed for exactly
         this; the queue itself was not. */
      const { data, error } = tab === 'open'
        ? await q.eq('status', 'open').order('sla_due_at', { ascending: true })
        : await q.in('status', ['resolved', 'dismissed']).order('created_at', { ascending: false }).limit(60);
      setFailed(!!error);
      setRows((data as Report[]) ?? []);

      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const { count, error: cErr } = await supabase
        .from('reports').select('id', { count: 'exact', head: true })
        .in('status', ['resolved', 'dismissed'])
        .gte('resolved_at', startOfDay.toISOString());
      setResolvedToday(cErr ? null : (count ?? 0));
    } catch {
      setFailed(true);
      setRows([]);
      setResolvedToday(null);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  // tick the lock countdown every second while a report is open
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  function lockedByOther(r: Report): boolean {
    return !!(r.locked_by && r.locked_by !== myUid && r.locked_until && new Date(r.locked_until).getTime() > Date.now());
  }

  async function openReport(r: Report) {
    if (lockedByOther(r)) { toast('Bu şikayət başqa moderatorda kilidlidir'); return; }
    // 15-min row lock
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { data: locked } = await supabase
      .from('reports')
      .update({ locked_by: myUid, locked_until: lockedUntil })
      .eq('id', r.id)
      .select('*')
      .maybeSingle();
    /* No fabricated fallback. `reports_admin_update` is moderator+, so for a
       support admin — who CAN read the queue — this UPDATE comes back
       `error: null` with zero rows and `maybeSingle()` yields null. The old
       `?? { ...r, locked_by: myUid, locked_until: lockedUntil }` then invented
       the lock in local state and wrote it into `rows`, so the screen counted
       down «15 dəq kilid · sən» over a database row that was never locked and a
       moderator opened the same harassment report seconds later. */
    const opened = (locked as Report | null) ?? r;
    setLockFailed(!locked);
    setActive(opened);
    setNow(Date.now());
    if (locked) setRows((prev) => prev.map((x) => (x.id === opened.id ? opened : x)));

    // attached chat evidence — the ONLY place message text appears (max 20)
    setMsgLoading(true);
    setMsgs([]);
    const { data: mm } = await supabase
      .from('report_messages').select('*').eq('report_id', r.id).order('ord', { ascending: true }).limit(20);
    setMsgs((mm as ReportMessage[]) ?? []);
    setMsgLoading(false);
  }

  async function closeDetail() {
    // release the lock if it's mine
    if (active && active.locked_by === myUid) {
      await supabase.from('reports').update({ locked_by: null, locked_until: null }).eq('id', active.id).eq('status', 'open');
    }
    setActive(null);
    setLockFailed(false);
    setMsgs([]);
  }

  /** Closes a report. `.select('id')` is mandatory rather than cosmetic: an
   *  RLS-filtered UPDATE comes back with `error: null` and ZERO rows changed,
   *  so checking only the error would let a still-open report toast «həll
   *  olundu». Returns null on success, or a human-readable reason. */
  async function closeReport(patch: Record<string, unknown>): Promise<string | null> {
    if (!active) return 'Şikayət açıq deyil';
    const { data, error } = await supabase
      .from('reports')
      .update({ ...patch, resolved_by: myUid, resolved_at: new Date().toISOString(), locked_by: null, locked_until: null })
      .eq('id', active.id)
      .select('id');
    if (error) return error.message;
    if (!data?.length) return 'icazə yoxdur — şikayət açıq qaldı';
    return null;
  }

  async function punish(action: Rung, label: string) {
    if (!active || !canAct) return;
    const rung = LADDER.find((l) => l.key === action);
    if (!rung) return;
    const tt = actionTarget(active.target_type);
    // Only a `user` report carries a profiles id in target_id; on a content /
    // gym / trainer report it is that object's id, so an account sanction can
    // not be applied from here at all — say so instead of pretending.
    if (rung.status && active.target_type !== 'user') {
      toast('Bu şikayət hesaba bağlı deyil — sanksiyanı İstifadəçilər ekranından tətbiq et');
      return;
    }
    const reason = window.prompt(`${label} — səbəb (audit log-a düşəcək, məcburidir):`)?.trim();
    if (!reason) { toast('Səbəb tələb olunur'); return; }
    setBusy(true);

    // 1. Apply the sanction to the offender's account FIRST. Logging a ban and
    //    closing the report while the account stays «Aktiv» is exactly the
    //    failure this ordering prevents.
    if (rung.status) {
      const until = rung.days == null ? null : new Date(Date.now() + rung.days * 864e5).toISOString();
      /* Through admin_set_profile_status, not a table UPDATE: the three sanction
         columns have no UPDATE grant for `authenticated` and must not get one
         (profiles_update matches a user's own row, so a banned account could
         lift its own ban). Before schema64 there was no working path at all —
         every rung here returned 42501 and the report stayed open. */
      const { error: pErr } = await supabase.rpc('admin_set_profile_status', {
        p_profile: active.target_id,
        p_status: rung.status,
        p_reason: reason,
        p_until: until,
      });
      if (pErr) {
        setBusy(false);
        toast('Profil yenilənmədi: ' + pErr.message + '. Şikayət açıq qaldı');
        return;
      }
    }

    // 2. Moderation record. For `warn` this row plus the audit entry are the
    //    ONLY trace the action happened, so a failed insert must not close it.
    const { error: aErr } = await supabase.from('moderation_actions').insert({
      admin_id: myUid, target_type: tt, target_id: active.target_id, action, reason, report_id: active.id,
    });
    if (aErr) { setBusy(false); toast('Moderasiya qeydi yazılmadı: ' + aErr.message); return; }

    // 3. Only now close the report — and verify that write landed as well.
    const closeErr = await closeReport({ status: 'resolved', resolution: `${label}: ${reason}` });
    if (closeErr) {
      setBusy(false);
      toast(`${label} tətbiq olundu, amma şikayət bağlanmadı: ${closeErr}`);
      await load(); refreshCounts();
      return;
    }

    const auditErr = await audit(action, 'report', active.id, reason, { target_type: tt, target_id: active.target_id });
    setBusy(false);
    toast(auditErr ? `${label} tətbiq olundu, amma audit qeydi yazılmadı: ${auditErr}` : `${label} tətbiq olundu`);
    setActive(null); setMsgs([]);
    await load(); refreshCounts();
  }

  async function dismiss() {
    if (!active || !canAct) return;
    const reason = window.prompt('Rədd et (əsassız) — səbəb (məcburidir):')?.trim();
    if (!reason) { toast('Səbəb tələb olunur'); return; }
    setBusy(true);
    const closeErr = await closeReport({ status: 'dismissed', resolution: `Əsassız: ${reason}` });
    if (closeErr) {
      setBusy(false);
      toast('Şikayət rədd edilmədi: ' + closeErr);
      await load(); refreshCounts();
      return;
    }
    const auditErr = await audit('report_dismiss', 'report', active.id, reason, { target_type: active.target_type, target_id: active.target_id });
    setBusy(false);
    toast(auditErr ? `Şikayət rədd edildi, amma audit qeydi yazılmadı: ${auditErr}` : 'Şikayət rədd edildi');
    setActive(null); setMsgs([]);
    await load(); refreshCounts();
  }

  // header stat + KPI counts (computed from the loaded open queue)
  const open = rows.filter((r) => r.status === 'open');
  const overdue = open.filter((r) => new Date(r.sla_due_at).getTime() < Date.now()).length;
  const safety = open.filter((r) => r.category === 'safety').length;
  const spamFake = open.filter((r) => r.category === 'spam' || r.category === 'fake').length;
  const harass = open.filter((r) => r.category === 'harassment').length;

  const kpis = [
    { label: 'SLA keçir', val: overdue, accent: overdue > 0 },
    { label: 'Təhlükəsizlik', val: safety },
    { label: 'Spam / saxta', val: spamFake },
    { label: 'Təqib', val: harass },
  ];

  return (
    <>
      <div className="section-head" style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--fill)', borderRadius: 9, padding: 2 }}>
            <TabBtn active={tab === 'open'} onClick={() => setTab('open')} label={`Şikayətlər ${open.length || ''}`.trim()} />
            <TabBtn active={tab === 'closed'} onClick={() => setTab('closed')} label="Bağlanmış" />
            <TabBtn active={false} onClick={() => go('content')} label="Məzmun" />
          </div>
        </div>
        <div style={{ font: '400 12.5px/1 var(--font)', color: 'var(--muted)' }}>
          Bugün həll olundu: <b style={{ fontWeight: 600, color: 'var(--ink2)' }}>{resolvedToday ?? '—'}</b> · SLA: təhlükəsizlik 2 saat · təqib 6 saat · digər 24 saat
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, margin: '16px 0 18px' }}>
        {kpis.map((c) => (
          <div key={c.label} className="card" style={{ padding: '15px 17px', border: c.accent ? '1px solid rgba(255,59,48,.25)' : undefined }}>
            <div style={{ font: '600 10.5px/1 var(--font)', letterSpacing: '.06em', textTransform: 'uppercase', color: c.accent ? 'var(--red-deep)' : 'var(--muted)' }}>{c.label}</div>
            <div style={{ font: '700 24px/1 var(--font)', letterSpacing: '-.7px', marginTop: 10 }}>{loading ? '—' : c.val}</div>
          </div>
        ))}
      </div>

      {/* queue table */}
      {loading ? (
        <div className="spinner" />
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 108 }}>SLA</th>
              <th style={{ width: 150 }}>Kateqoriya</th>
              <th style={{ width: 210 }}>Şikayət olunan</th>
              <th>Kontekst</th>
              <th style={{ width: 160 }}>Moderator</th>
              <th style={{ width: 88 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="empty">
                {failed
                  ? 'Şikayətlər yüklənmədi — bu «şikayət yoxdur» demək DEYİL. Səhifəni yenilə.'
                  : tab === 'open' ? 'Açıq şikayət yoxdur' : 'Bağlanmış şikayət yoxdur'}
              </td></tr>
            ) : rows.map((r) => {
              const sla = slaBadge(r.sla_due_at);
              const cat = CAT[r.category];
              const locked = lockedByOther(r);
              const closed = r.status !== 'open';
              return (
                <tr key={r.id} style={{ background: r.status === 'open' && sla.overdue ? 'rgba(255,59,48,.05)' : undefined, opacity: closed ? 0.66 : 1 }}>
                  <td>
                    {closed ? (
                      <span className={'badge ' + (r.status === 'resolved' ? 'green' : 'grey')}>{r.status === 'resolved' ? 'Həll olundu' : 'Rədd edildi'}</span>
                    ) : (
                      <span className={'badge ' + sla.cls}>{sla.text}</span>
                    )}
                  </td>
                  <td><span className={'badge ' + (cat.tone === 'red' ? 'red' : cat.tone === 'orange' ? 'orange' : 'grey')}>{cat.label}</span></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{TARGET_LABEL[r.target_type]} · {r.target_id.slice(0, 8)}</div>
                    <div style={{ font: '400 10.5px/1 var(--font)', color: 'var(--muted)', marginTop: 4 }}>#{r.id.slice(0, 4)}</div>
                  </td>
                  <td style={{ color: 'var(--muted2)' }}>{r.note || '—'}</td>
                  <td>
                    {locked ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '600 11.5px/1 var(--font)', color: 'var(--orange-deep)' }}>
                        <Icon name="clock" size={13} color="var(--orange)" /> Kilidli
                      </span>
                    ) : r.locked_by === myUid && !closed ? (
                      <span style={{ font: '600 11.5px/1 var(--font)', color: 'var(--volt-deep)' }}>Səndə</span>
                    ) : (
                      <span className="badge grey">Təyin edilməyib</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!closed && (
                      <button className="btn primary" disabled={locked} style={{ padding: '8px 14px', opacity: locked ? 0.4 : 1, cursor: locked ? 'not-allowed' : 'pointer' }} onClick={() => openReport(r)}>Aç</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* bottom info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
        <div className="card" style={{ padding: 17 }}>
          <div style={{ font: '600 13.5px/1 var(--font)', marginBottom: 13 }}>Siqnal qaydaları</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, font: '400 12.5px/1.45 var(--font)', color: 'var(--muted2)' }}>
            {AUTO_FLAG.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span className={'badge ' + (r.live ? 'green' : 'grey')} style={{ flex: 'none' }}>
                  {r.live ? 'İŞLƏYİR' : 'İŞLƏMİR'}
                </span>
                <span style={{ color: r.live ? 'var(--muted2)' : 'var(--muted)' }}>{r.text}</span>
              </div>
            ))}
          </div>
          <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--orange-deep)', marginTop: 12 }}>
            «İŞLƏMİR» qeyd olunanlar planlaşdırılıb, amma qurulmayıb: heç bir hesab avtomatik
            susdurulmur, heç bir şərh avtomatik növbəyə düşmür. Növbədəki hər şikayət əl ilə
            yoxlanılmalıdır.
          </div>
        </div>
        <div className="card" style={{ padding: 17 }}>
          <div style={{ font: '600 13.5px/1 var(--font)', marginBottom: 13 }}>Cəza pillələri · README §6.8</div>
          <div style={{ display: 'flex', gap: 9 }}>
            {LADDER_STEPS.map((s) => (
              <div key={s.n} style={{ flex: 1, background: s.danger ? 'rgba(255,59,48,.08)' : 'var(--fill)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                <div style={{ font: '700 15px/1 var(--font)', color: s.danger ? 'var(--red-deep)' : 'var(--ink2)' }}>{s.n}</div>
                <div style={{ font: '400 11px/1.35 var(--font)', color: s.danger ? '#8A2B22' : 'var(--muted2)', marginTop: 7 }}>{s.t}</div>
              </div>
            ))}
          </div>
          <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 12 }}>
            Təhlükəsizlik pozuntusunda birbaşa 4-cü pillə. Pillə seçimi audit log-a səbəblə düşür.
          </div>
        </div>
      </div>

      {active && (
        <div className="scrim" onClick={busy ? undefined : closeDetail}>
          <div className="modal" style={{ width: 560, maxHeight: '86vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <ReportDetail
              r={active} msgs={msgs} msgLoading={msgLoading} now={now} myUid={myUid} canAct={canAct} busy={busy}
              lockFailed={lockFailed}
              onClose={closeDetail} onPunish={punish} onDismiss={dismiss}
            />
          </div>
        </div>
      )}
    </>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 13px', borderRadius: 7, border: 'none',
        background: active ? '#fff' : 'transparent',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
        font: `${active ? 600 : 500} 12.5px/1 var(--font)`, color: active ? 'var(--ink2)' : 'var(--muted2)',
      }}
    >{label}</button>
  );
}

function ReportDetail({
  r, msgs, msgLoading, now, myUid, canAct, busy, lockFailed, onClose, onPunish, onDismiss,
}: {
  r: Report; msgs: ReportMessage[]; msgLoading: boolean; now: number; myUid: string;
  canAct: boolean; busy: boolean; lockFailed: boolean; onClose: () => void;
  onPunish: (a: Rung, label: string) => void; onDismiss: () => void;
}) {
  // Account sanctions need a profiles id; only a `user` report has one in
  // target_id. On the other target types those rungs are disabled rather than
  // shown as working buttons that quietly punish nobody.
  const accountRungs = r.target_type === 'user';
  // A support message has no subject to punish — not an account, not a piece of
  // content. The whole ladder is withheld rather than shown greyed out, because
  // there is no case in which any rung on it applies.
  const isSupport = r.target_type === 'support';
  const cat = CAT[r.category];
  const remainMs = r.locked_until ? new Date(r.locked_until).getTime() - now : 0;
  const mm = Math.max(0, Math.floor(remainMs / 60000));
  const ss = Math.max(0, Math.floor((remainMs % 60000) / 1000));
  const lockLabel = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  const mine = r.locked_by === myUid;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ font: '700 16px/1 var(--font)' }}>Şikayət #{r.id.slice(0, 4)}</div>
        <span className={'badge ' + (cat.tone === 'red' ? 'red' : cat.tone === 'orange' ? 'orange' : 'grey')}>{cat.label}</span>
        <button className="link" style={{ marginLeft: 'auto' }} onClick={onClose}>Bağla</button>
      </div>

      {/* An unlocked report is opened read-only rather than with an invented
          countdown — two people can otherwise work the same case believing each
          holds it exclusively. */}
      {lockFailed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,149,0,.12)', borderRadius: 7, padding: '7px 11px', margin: '4px 0 14px' }}>
          <Icon name="clock" size={13} color="var(--orange-deep)" />
          <span style={{ font: '500 11.5px/1.4 var(--font)', color: 'var(--orange-deep)' }}>
            Kilid alınmadı — bu şikayət səndə deyil. Başqa moderator eyni anda onunla işləyə bilər.
          </span>
        </div>
      )}

      {!lockFailed && r.locked_until && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: mine ? 'rgba(198,255,61,.28)' : 'var(--fill)', borderRadius: 7, padding: '5px 10px', margin: '4px 0 14px' }}>
          <Icon name="clock" size={13} color={mine ? 'var(--volt-deep)' : 'var(--muted2)'} />
          <span style={{ font: '600 11.5px/1 var(--font)', color: mine ? 'var(--volt-deep)' : 'var(--muted2)' }}>
            {lockLabel} kilid · {mine ? (admLabel(myUid)) : 'başqa moderator'}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <Info label="Şikayət olunan" value={`${TARGET_LABEL[r.target_type]} · ${r.target_id.slice(0, 12)}`} />
        <Info label="SLA" value={new Date(r.sla_due_at).toLocaleString('az')} />
        <Info label="Yaradıldı" value={new Date(r.created_at).toLocaleString('az')} />
        <Info label="Şikayətçi" value={r.reporter_id ? r.reporter_id.slice(0, 12) : 'Anonim'} />
      </div>
      {r.note && (
        <div style={{ background: 'var(--fill)', borderRadius: 10, padding: '11px 13px', font: '400 12.5px/1.5 var(--font)', color: 'var(--text3)', marginBottom: 14 }}>{r.note}</div>
      )}

      {/* attached chat evidence — the ONLY place message text is shown */}
      <div style={{ font: '600 12px/1 var(--font)', letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 9 }}>
        Əlavə edilmiş sübut · söhbət
      </div>
      {msgLoading ? (
        <div className="spinner" style={{ margin: '18px auto' }} />
      ) : msgs.length === 0 ? (
        <div style={{ font: '400 12.5px/1 var(--font)', color: 'var(--muted)', padding: '10px 0 14px' }}>Bu şikayətə söhbət əlavə edilməyib</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, maxHeight: 220, overflow: 'auto' }}>
          {msgs.map((m) => (
            <div key={m.id} style={{ border: '1px solid var(--line2)', borderRadius: 10, padding: '9px 12px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ font: '600 12px/1 var(--font)' }}>{m.sender_name || 'İstifadəçi'}</span>
                {m.sent_at && <span style={{ font: '400 10.5px/1 var(--font)', color: 'var(--muted)' }}>{new Date(m.sent_at).toLocaleString('az')}</span>}
              </div>
              <div style={{ font: '400 12.5px/1.5 var(--font)', color: 'var(--text3)' }}>{m.body}</div>
            </div>
          ))}
        </div>
      )}

      {/* punishment ladder — moderator+ */}
      {canAct && isSupport ? (
        <>
          <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 8 }}>
            Bu, komandaya göndərilən dəstək mesajıdır — kimsə barədə şikayət deyil.
            Sanksiya tətbiq ediləcək hesab yoxdur; mesajı oxuduqdan sonra bağla.
          </div>
          <button
            className="btn"
            disabled={busy}
            style={{ width: '100%', marginTop: 8, color: 'var(--muted2)', opacity: busy ? 0.5 : 1 }}
            onClick={onDismiss}
          >Bağla</button>
        </>
      ) : canAct ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {LADDER.map((b) => {
              const off = busy || (!!b.status && !accountRungs);
              return (
                <button
                  key={b.key}
                  className={'btn' + (b.danger ? ' danger' : '')}
                  disabled={off}
                  title={!!b.status && !accountRungs ? 'Yalnız istifadəçi şikayətində' : undefined}
                  style={{ flex: 1, minWidth: 110, opacity: off ? 0.4 : 1, cursor: off ? 'not-allowed' : 'pointer' }}
                  onClick={() => onPunish(b.key, b.label)}
                >{b.label}</button>
              );
            })}
          </div>
          {!accountRungs ? (
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 8 }}>
              Bu şikayət hesaba yox, {TARGET_LABEL[r.target_type].toLocaleLowerCase('az')} obyektinə aiddir — hesab sanksiyası
              İstifadəçilər ekranından tətbiq olunur. Buradan yalnız xəbərdarlıq və ya rədd mümkündür.
            </div>
          ) : (
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 8 }}>
              Seçilən pillə şikayət bağlanmazdan ƏVVƏL hesabın statusuna yazılır. Yazılmasa şikayət açıq qalır.
            </div>
          )}
          <button
            className="btn"
            disabled={busy}
            style={{ width: '100%', marginTop: 8, color: 'var(--muted2)', opacity: busy ? 0.5 : 1 }}
            onClick={onDismiss}
          >Rədd et (əsassız)</button>
        </>
      ) : (
        <div style={{ font: '400 12px/1.4 var(--font)', color: 'var(--muted)', textAlign: 'center', padding: '10px 0' }}>
          Qərar vermək üçün moderator icazəsi lazımdır. Yalnız baxış rejimi.
        </div>
      )}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ font: '600 10px/1 var(--font)', letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div style={{ font: '500 12.5px/1.3 var(--font)', color: 'var(--ink2)', marginTop: 5, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

function admLabel(uid: string): string {
  return uid ? 'sən' : 'moderator';
}
