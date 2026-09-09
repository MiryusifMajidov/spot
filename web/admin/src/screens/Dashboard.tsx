import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { DashboardKpis, GymClaim, Report, TrainerVerification, Gym } from '../lib/types';
import { Icon } from '../ui/icons';
import type { ScreenProps } from '../App';

/** A streak day starts at 04:00 LOCAL, so "today" for check-in counting starts
 *  there too — before 04:00 we are still inside yesterday's day. */
function dayStart(): Date {
  const d = new Date();
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  d.setHours(4, 0, 0, 0);
  return d;
}

function slaBadge(due: string) {
  const ms = new Date(due).getTime() - Date.now();
  if (ms < 0) return { cls: 'red', text: 'gecikib' };
  const h = ms / 3600000;
  if (h < 4) return { cls: 'red', text: `${Math.max(1, Math.round(h * 60 / 60))}s` };
  if (h < 24) return { cls: 'orange', text: `${Math.round(h)}s` };
  return { cls: 'grey', text: `${Math.round(h / 24)}g` };
}

export function Dashboard({ go }: ScreenProps) {
  const [k, setK] = useState<DashboardKpis | null>(null);
  const [verifs, setVerifs] = useState<TrainerVerification[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [claims, setClaims] = useState<GymClaim[]>([]);
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [checkInsToday, setCheckInsToday] = useState<number | null>(null);
  const [kpiFailed, setKpiFailed] = useState(false);
  const [queuesFailed, setQueuesFailed] = useState(false);

  useEffect(() => {
    (async () => {
      /* The error is kept, not discarded. It used to be dropped, so when the
         RPC was broken every queue count silently became 0 — a moderator read
         «Şikayətlər 0» with five open reports listed underneath. */
      const { data: kpi, error: kpiErr } = await supabase.rpc('admin_dashboard');
      setKpiFailed(!!kpiErr);
      setK((kpi ?? null) as DashboardKpis | null);
      const [v, r, c, g, ci] = await Promise.all([
        supabase.from('trainer_verifications').select('*').eq('status', 'pending').order('sla_due_at').limit(3),
        supabase.from('reports').select('*').eq('status', 'open').order('sla_due_at').limit(3),
        supabase.from('gym_claims').select('*').eq('status', 'pending').order('sla_due_at').limit(3),
        supabase.from('gyms').select('*').order('members', { ascending: false }).limit(4),
        supabase.from('check_ins').select('id', { count: 'exact', head: true }).gte('created_at', dayStart().toISOString()),
      ]);
      /* The KPI strip beside these was fixed to report failure; the previews
         under it were not, so a refused read still drew «növbə boşdur». */
      setQueuesFailed(!!v.error || !!r.error || !!c.error);
      setVerifs((v.data as TrainerVerification[]) ?? []);
      setReports((r.data as Report[]) ?? []);
      setClaims((c.data as GymClaim[]) ?? []);
      setGyms((g.data as Gym[]) ?? []);
      // `count` is null when the query errored — keep '—' rather than a fake 0.
      setCheckInsToday(ci.error ? null : ci.count ?? 0);
    })();
  }, []);

  const kpis = [
    { label: 'İstifadəçi · ümumi', val: k ? k.users_total.toLocaleString('az') : '—' },
    { label: 'Zallar', val: k ? String(k.gyms_total) : '—' },
    { label: 'Açıq şikayət', val: k ? String(k.reports_open) : '—', accent: k && k.reports_overdue > 0 ? 'red' : undefined, sub: k && k.reports_overdue ? `${k.reports_overdue} gecikib` : undefined },
    /* «Aktiv day-pass · canlı» used to sit here reading the literal string
       "undefined": schema58 removed the key because nothing ever moves a pass out
       of 'active', so the number counted every pass ever created and the word
       «canlı» was false. The gym owner's own panel shows today's live and
       redeemed counts, which are measured. */
    { label: 'Bugün check-in', val: checkInsToday != null ? checkInsToday.toLocaleString('az') : '—', dark: true, sub: '04:00-dan' },
    { label: 'Gözləyən müəllim', val: k ? String(k.trainers_pending) : '—', sub: 'doğrulama' },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14, marginBottom: 20 }}>
        {kpis.map((c) => (
          <div key={c.label} className={'kpi' + (c.dark ? ' dark' : '')}>
            <div className="k-label">{c.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 11 }}>
              <div className="k-val" style={c.accent === 'red' ? { color: 'var(--red)' } : undefined}>{c.val}</div>
              {c.sub ? <div style={{ font: '500 11.5px/1 var(--font)', color: c.dark ? 'rgba(255,255,255,.5)' : 'var(--muted)' }}>{c.sub}</div> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="section-head"><h2>Növbələr · SLA</h2></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <QueueCard icon="verified" color="var(--blue)" title="Müəllim doğrulanması" count={kpiFailed || !k ? null : k.trainers_pending} onOpen={() => go('trainers')}
          rows={verifs.map((v) => ({ label: v.trainer_id || 'Müəllim', badge: slaBadge(v.sla_due_at) }))} empty={queuesFailed ? 'Növbə yüklənmədi — bu «yoxdur» demək DEYİL. Səhifəni yenilə.' : 'Növbə boşdur'} />
        <QueueCard icon="shield" color="var(--red)" title="Şikayətlər" count={kpiFailed || !k ? null : k.reports_open} onOpen={() => go('moderation')}
          rows={reports.map((r) => ({ label: `${r.category} · #${r.id.slice(0, 4)}`, badge: slaBadge(r.sla_due_at) }))} empty={queuesFailed ? 'Şikayətlər yüklənmədi — bu «yoxdur» demək DEYİL. Səhifəni yenilə.' : 'Açıq şikayət yoxdur'} />
        <QueueCard icon="pin" color="var(--green)" title="Zal sahibliyi (claim)" count={kpiFailed || !k ? null : k.claims_pending} onOpen={() => go('gyms')}
          rows={claims.map((c) => ({ label: c.gym_id || 'Zal', badge: slaBadge(c.sla_due_at) }))} empty={queuesFailed ? 'Claim növbəsi yüklənmədi — bu «yoxdur» demək DEYİL. Səhifəni yenilə.' : 'Claim növbəsi boşdur'} />
      </div>

      <div className="section-head"><h2>Ən aktiv zallar</h2><button className="link" onClick={() => go('gyms')}>Hamısına bax</button></div>
      <table className="tbl">
        <thead><tr><th>Zal</th><th>Rayon</th><th>Üzv</th><th>Reytinq</th><th>Claim</th></tr></thead>
        <tbody>
          {gyms.map((g) => (
            <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => go('gyms')}>
              <td style={{ fontWeight: 600 }}>{g.name}{g.verified ? <Icon name="verified" size={13} color="var(--blue)" /> : null}</td>
              <td style={{ color: 'var(--muted2)' }}>{g.district}</td>
              <td>{g.members}</td>
              <td>★ {g.rating}</td>
              <td><span className={'badge ' + (g.claim_status === 'claimed' ? 'green' : g.claim_status === 'pending' ? 'orange' : 'grey')}>{g.claim_status}</span></td>
            </tr>
          ))}
          {gyms.length === 0 ? <tr><td colSpan={5} className="empty">Zal yoxdur</td></tr> : null}
        </tbody>
      </table>
    </>
  );
}

function QueueCard({ icon, color, title, count, rows, empty, onOpen }: {
  icon: 'verified' | 'shield' | 'pin'; color: string; title: string; count: number | null;
  rows: { label: string; badge: { cls: string; text: string } }[]; empty: string; onOpen: () => void;
}) {
  return (
    <div className="card" style={{ padding: '16px 18px', cursor: 'pointer' }} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <Icon name={icon} size={17} color={color} />
        <div style={{ flex: 1, font: '600 13.5px/1 var(--font)' }}>{title}</div>
        {/* «—», never 0: a count we could not obtain is not a count of zero. */}
        <div style={{ font: '700 16px/1 var(--font)' }}>{count ?? '—'}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.length === 0 ? <div style={{ font: '400 12.5px/1 var(--font)', color: 'var(--muted)' }}>{empty}</div> : null}
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div className="avatar" style={{ width: 22, height: 22, borderRadius: '50%' }} />
            <div style={{ flex: 1, font: '400 12.5px/1 var(--font)' }}>{r.label}</div>
            <span className={'badge ' + r.badge.cls}>SLA {r.badge.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
