import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabase';
import type { ScreenProps } from '../App';

/** All metrics are derived from live head:true count queries. `null` means the
 *  underlying table/column is unavailable (e.g. RLS or missing table) — we then
 *  render the block with a "data yoxdur" conclusion rather than crashing. */
interface Metrics {
  profilesTotal: number | null;
  withGym: number | null;
  withGoals: number | null;
  matchTotal: number | null;
  matchAccepted: number | null;
  /** DISTINCT people on an accepted request — what «Yoldaşı olan» means. */
  matchedProfiles: number | null;
  feedVideos: number | null;
  communityPosts: number | null;
}

// Run a head:true count query; swallow errors (missing table / RLS) into null.
async function countOf(build: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const { count, error } = await build;
  return error ? null : count ?? 0;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const nf = (n: number) => n.toLocaleString('az');

export function Analytics(_props: ScreenProps) {
  const [loading, setLoading] = useState(true);
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    (async () => {
      // NOTE: `select('*')` on profiles is rejected outright (column privileges
      // withhold `phone`), so every projection here names a granted column.
      const [profilesTotal, withGym, withGoals, feedVideos, communityPosts] = await Promise.all([
        countOf(supabase.from('profiles').select('id', { count: 'exact', head: true })),
        countOf(supabase.from('profiles').select('id', { count: 'exact', head: true }).not('home_gym_id', 'is', null)),
        countOf(supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('goals', '{}')),
        countOf(supabase.from('feed_videos').select('id', { count: 'exact', head: true })),
        countOf(supabase.from('community_posts').select('id', { count: 'exact', head: true })),
      ]);

      /* NOT a table count. `match_read` has no admin branch, so an admin's own
         count of match_requests is permanently 0 whatever the table holds — and
         counting ROWS answers the wrong question anyway: one accepted row is two
         people, and one person can hold many. admin_match_stats() (schema65)
         computes it server-side, including the DISTINCT headcount that
         «Yoldaşı olan» claims to be. */
      const { data: ms } = await supabase.rpc('admin_match_stats');
      const mm = (ms ?? null) as
        | { requests_total: number; requests_accepted: number; matched_profiles: number }
        | null;
      setM({
        profilesTotal,
        withGym,
        withGoals,
        matchTotal: mm ? mm.requests_total : null,
        matchAccepted: mm ? mm.requests_accepted : null,
        matchedProfiles: mm ? mm.matched_profiles : null,
        feedVideos,
        communityPosts,
      });
      setLoading(false);
    })();
  }, []);

  if (loading || !m) return <div className="spinner" />;

  // ---- Block 1: core hypothesis (yoldaşı olan vs tək) ---------------------
  // `total` stays null when the profiles count could not be read — a failed read
  // must never be rendered as the number 0.
  const total = m.profilesTotal;
  // People, not rows: DISTINCT profiles appearing on an accepted request.
  const withPartner = m.matchedProfiles;
  const partnerShare = withPartner != null && total != null && total > 0 ? pct(withPartner, total) : null;
  const alone = withPartner != null && total != null ? Math.max(0, total - withPartner) : null;
  const hypoConclusion =
    total == null || withPartner == null
      ? 'Göstəriciləri oxumaq mümkün olmadı — hipotezi qiymətləndirmək olmur.'
      : total === 0 || (withPartner ?? 0) === 0
        ? 'Hipotezi yoxlamaq üçün hələ kifayət data yoxdur — qəbul edilmiş match sayı çox azdır.'
        : `Bazanın ${partnerShare}%-i məşq yoldaşı tapıb. Prioritet: ilk 14 gündə match faizini qaldırmaq — bu, saxlanmanı (retention) ən çox hərəkət etdirən leverdir.`;

  // ---- Block 2: onboarding funnel ----------------------------------------
  // Every step needs a real total; without it the bars would be fabricated.
  const funnelKnown = total != null && m.withGym != null && m.withGoals != null;
  const gymPct = funnelKnown ? pct(m.withGym!, total!) : 0;
  const goalsPct = funnelKnown ? pct(m.withGoals!, total!) : 0;
  const funnel: { label: string; text: string; share: number; color: string }[] = [
    {
      label: 'Qeydiyyat tamamlandı',
      text: total != null ? `${nf(total)} · ${total > 0 ? 100 : 0}%` : '—',
      share: (total ?? 0) > 0 ? 100 : 0,
      color: 'var(--ink)',
    },
    {
      label: 'Zal seçildi',
      text: funnelKnown ? `${nf(m.withGym!)} · ${gymPct}%` : m.withGym != null ? nf(m.withGym) : '—',
      share: gymPct,
      color: 'var(--ink)',
    },
    {
      label: 'Hədəf təyin edildi',
      text: funnelKnown ? `${nf(m.withGoals!)} · ${goalsPct}%` : m.withGoals != null ? nf(m.withGoals) : '—',
      share: goalsPct,
      color: 'var(--volt)',
    },
  ];
  // Mark the transition with the biggest percentage-point drop as the problem step.
  const drops = [100 - gymPct, gymPct - goalsPct];
  const worstIdx = drops[1] > drops[0] ? 2 : 1;
  if (funnelKnown && total! > 0) funnel[worstIdx].color = '#FF6B35';
  const funnelConclusion = !funnelKnown
    ? 'Funnel göstəriciləri oxunmadı.'
    : total === 0
      ? 'Funnel üçün hələ kifayət data yoxdur.'
      : `Ən böyük itki: «${funnel[worstIdx - 1].label} → ${funnel[worstIdx].label}» (${drops[worstIdx - 1]} punkt). Fəaliyyət: bu addımı sadələşdir.`;

  // ---- Block 3: matching quality -----------------------------------------
  const acceptPct = m.matchTotal != null && m.matchAccepted != null ? pct(m.matchAccepted, m.matchTotal) : null;
  const matchRows: { label: string; value: string; accent?: string }[] = [
    { label: 'Ümumi sorğu', value: m.matchTotal != null ? nf(m.matchTotal) : '—' },
    { label: 'Qəbul edilmiş', value: m.matchAccepted != null ? nf(m.matchAccepted) : '—' },
    { label: 'Qəbul faizi', value: acceptPct != null ? `${acceptPct}%` : '—', accent: acceptPct != null && acceptPct >= 30 ? 'var(--green)' : acceptPct != null ? '#D14A15' : undefined },
  ];
  const matchConclusion =
    m.matchTotal == null || m.matchAccepted == null || m.matchTotal === 0
      ? 'Matching keyfiyyəti üçün hələ kifayət data yoxdur.'
      : `Sorğuların ${acceptPct}%-i qəbul olunur — ${acceptPct! >= 30 ? 'sağlam səviyyə' : 'aşağı, təklif keyfiyyətini yoxla'}.`;

  // ---- Block 4: content ---------------------------------------------------
  // SPOT takes no payments and no commission, so there is no revenue metric here.
  const contentRows: { label: string; value: string }[] = [
    { label: 'Feed videoları', value: m.feedVideos != null ? nf(m.feedVideos) : '—' },
    { label: 'İcma postları', value: m.communityPosts != null ? nf(m.communityPosts) : '—' },
  ];
  const hasContent = (m.feedVideos ?? 0) + (m.communityPosts ?? 0) > 0;
  const contentConclusion = hasContent
    ? 'Məzmun kanalları işləyir — feed və icma aktivdir.'
    : 'Məzmun üzrə hələ kifayət data yoxdur.';

  return (
    <>
      {/* Core hypothesis — dark card */}
      <div style={{ background: 'var(--ink)', borderRadius: 14, padding: '22px 24px', color: '#fff', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ font: '600 10.5px/1 var(--font)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--volt)' }}>Əsas hipotez</div>
          <div style={{ font: '600 15px/1 var(--font)' }}>Məşq yoldaşı olan istifadəçi daha uzun qalır</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 18 }}>
          <HypoStat label="Ümumi istifadəçi" value={total != null ? nf(total) : '—'} />
          <HypoStat label="Yoldaşı olan" value={withPartner != null ? nf(withPartner) : '—'} volt />
          <HypoStat label="Tək" value={alone != null ? nf(alone) : '—'} />
          <HypoStat label="Yoldaşı olan %" value={partnerShare != null ? `${partnerShare}%` : '—'} volt />
        </div>
        <div style={{ background: 'rgba(198,255,61,.14)', borderRadius: 11, padding: '12px 14px', marginTop: 18 }}>
          <div style={{ font: '500 12.5px/1.5 var(--font)', color: '#DDEEB8' }}>{hypoConclusion}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18, marginBottom: 18, alignItems: 'start' }}>
        {/* Onboarding funnel */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ font: '600 14.5px/1 var(--font)', marginBottom: 18 }}>Onboarding funnel</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {funnel.map((f) => (
              <div key={f.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', font: '600 12.5px/1 var(--font)', marginBottom: 7 }}>
                  <div>{f.label}</div>
                  <div>{f.text}</div>
                </div>
                <div style={{ height: 26, borderRadius: 6, background: 'var(--fill)' }}>
                  <div style={{ height: 26, borderRadius: 6, background: f.color, width: `${f.share}%`, minWidth: f.share > 0 ? 6 : 0 }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: 'rgba(255,107,53,.1)', borderRadius: 11, padding: '12px 14px', marginTop: 16 }}>
            <div style={{ font: '500 12.5px/1.5 var(--font)', color: '#8A4A25' }}>{funnelConclusion}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Matching quality */}
          <div className="card" style={{ padding: 18 }}>
            <div style={{ font: '600 14.5px/1 var(--font)', marginBottom: 15 }}>Matching keyfiyyəti</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {matchRows.map((r) => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', font: '400 13px/1 var(--font)' }}>
                  <div style={{ color: 'var(--muted)' }}>{r.label}</div>
                  <div style={{ fontWeight: 600, color: r.accent }}>{r.value}</div>
                </div>
              ))}
            </div>
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 13 }}>{matchConclusion}</div>
          </div>

          {/* Content */}
          <div className="card" style={{ padding: 18 }}>
            <div style={{ font: '600 14.5px/1 var(--font)', marginBottom: 15 }}>Məzmun</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {contentRows.map((r) => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', font: '400 13px/1 var(--font)' }}>
                  <div style={{ color: 'var(--muted)' }}>{r.label}</div>
                  <div style={{ fontWeight: 600 }}>{r.value}</div>
                </div>
              ))}
            </div>
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 13 }}>{contentConclusion}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function HypoStat({ label, value, volt }: { label: string; value: string; volt?: boolean }) {
  return (
    <div>
      <div style={{ font: '400 11.5px/1.3 var(--font)', color: 'rgba(255,255,255,.5)', marginBottom: 10 }}>{label}</div>
      <div style={{ font: '700 26px/1 var(--font)', letterSpacing: '-.8px', color: volt ? 'var(--volt)' : '#fff' }}>{value}</div>
    </div>
  );
}
