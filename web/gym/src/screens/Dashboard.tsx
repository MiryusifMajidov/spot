import { useState } from 'react';

import type { ScreenProps } from '../App';
import { useAuth } from '../lib/auth';
import { bakuHour, getDailyCheckIns, getDayPassToday, getOccupancy, getRoster, postAnnouncement } from '../lib/gym';
import { useLoad } from '../lib/useLoad';
import { Icon } from '../ui/icons';
import { toast } from '../ui/toast';

const WEEKDAYS = ['B', 'BE', 'ÇA', 'Ç', 'CA', 'C', 'Ş'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];

function greeting() {
  const h = bakuHour(new Date().toISOString());
  return h < 5 ? 'Gecən xeyrə' : h < 12 ? 'Sabahın xeyir' : h < 18 ? 'Günortan xeyir' : 'Axşamın xeyir';
}

/** 14 days as a smooth area: volt fill, accent-green line (volt alone is 1.2:1 on white). */
function AreaChart({ points }: { points: { day: string; n: number }[] }) {
  const W = 640, H = 170, P = 8;
  const max = Math.max(4, ...points.map((p) => p.n));
  const xs = points.map((_, i) => P + (i * (W - 2 * P)) / Math.max(1, points.length - 1));
  const ys = points.map((p) => H - 24 - (p.n / max) * (H - 48));
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    const cx = (xs[i - 1] + xs[i]) / 2;
    d += ` C ${cx} ${ys[i - 1]}, ${cx} ${ys[i]}, ${xs[i]} ${ys[i]}`;
  }
  const area = `${d} L ${xs[xs.length - 1]} ${H - 24} L ${xs[0]} ${H - 24} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Son 14 günün check-in-ləri">
      <defs>
        <linearGradient id="vf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C5FE01" stopOpacity="0.55" />
          <stop offset="1" stopColor="#C5FE01" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={P} x2={W - P} y1={24 + f * (H - 48)} y2={24 + f * (H - 48)} stroke="#F1F1EF" strokeWidth="1" />
      ))}
      <path d={area} fill="url(#vf)" />
      <path d={d} fill="none" stroke="#527A01" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <g key={p.day}>
          {i === points.length - 1 ? <circle cx={xs[i]} cy={ys[i]} r="4" fill="#527A01" /> : null}
          {i % 2 === points.length % 2 ? null : (
            <text x={xs[i]} y={H - 4} textAnchor="middle" fontSize="11" fill="#8A8A8A" fontFamily="Inter, system-ui">
              {(() => { const dt = new Date(p.day + 'T12:00:00Z'); return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()}`; })()}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function HourBars({ byHour }: { byHour: number[] }) {
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  const values = hours.map((h) => byHour[h] ?? 0);
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  const nowHour = bakuHour(new Date().toISOString());
  return (
    <div className="bars">
      {values.map((v, i) => (
        <div className="bar-col" key={i} title={`${hours[i]}:00 — ${v} check-in`}>
          <div className="bar-val">{v > 0 ? v : ''}</div>
          <div className={'bar' + (v > 0 ? (i === peak ? ' peak' : ' on') : '')} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
          <div className={'bar-lbl' + (hours[i] === nowHour ? ' now' : '')}>{String(hours[i]).padStart(2, '0')}</div>
        </div>
      ))}
    </div>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="row" style={{ padding: '28px 0', justifyContent: 'center' }}>
      <span className="muted">Yüklənmədi.</span>
      <button className="link" onClick={onRetry}>Yenidən cəhd et</button>
    </div>
  );
}

export function Dashboard({ go }: ScreenProps) {
  const { gym, owner } = useAuth();
  const gid = gym!.id;
  const occ = useLoad(() => getOccupancy(gid), [gid]);
  const daily = useLoad(() => getDailyCheckIns(gid, 14), [gid]);
  const passes = useLoad(() => getDayPassToday(gid), [gid]);
  const roster = useLoad(() => getRoster(gid), [gid]);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);

  const here = (roster.data?.members ?? []).filter((m) => m.hereNow);
  const guests = Math.max(0, (occ.data?.now ?? 0) - here.length);
  const weekTotal = (daily.data ?? []).slice(-7).reduce((s, d) => s + d.n, 0);
  const prevWeek = (daily.data ?? []).slice(0, 7).reduce((s, d) => s + d.n, 0);
  const today = new Date();
  const firstName = (owner?.name || '').trim().split(/\s+/)[0];

  const post = async () => {
    const body = note.trim();
    if (!body || !gym || !owner) return;
    if (!confirm('Elan icma lentində sənin adınla, zalın üzvlərinə görünəcək. Göndərilsin?')) return;
    setPosting(true);
    try {
      await postAnnouncement(gym, owner, body);
      setNote('');
      toast('Elan icmaya göndərildi');
    } catch {
      toast('Elan göndərilmədi — yenidən cəhd et');
    }
    setPosting(false);
  };

  const val = (v: number | undefined, failed: boolean) => (failed ? '—' : v ?? '·');

  return (
    <div>
      <div className="hello">
        <div>
          <h1 className="page-title">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="page-sub">{today.getDate()} {MONTHS[today.getMonth()]} · {gym!.name} bu gün belədir.</p>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => go('qr')}><Icon name="qr" size={16} /> QR-ı göstər</button>
          <button className="btn primary" onClick={() => go('daypass')}><Icon name="ticket" size={16} /> Day-pass yoxla</button>
        </div>
      </div>

      <div className="page-grid">
        {!gym!.listed ? (
          <div className="banner">
            <Icon name="clock" size={20} color="var(--streak-deep)" />
            <div>
              <b>Zal hələ Kəşfdə görünmür</b>
              <span>Tətbiqdən yaradılan zallar moderator baxandan sonra siyahıya düşür. Sahiblik təsdiqi ayrıca addımdır — <button className="link" onClick={() => go('profile')}>VÖEN-i göndər</button>.</span>
            </div>
          </div>
        ) : null}

        <div className="kpis">
          <div className="kpi hero">
            <div className="row" style={{ gap: 10 }}><span className="live-dot" /><span className="k-label">İndi zalda</span></div>
            <div className="k-val" style={{ marginTop: 14 }}>{val(occ.data?.now, occ.error)}</div>
            <div className="k-sub">{occ.data ? `${here.length} üzv · ${guests} qonaq` : 'aktiv check-in'}</div>
          </div>
          <div className="kpi">
            <div className="k-label">Bu gün check-in</div>
            <div className="k-val" style={{ marginTop: 18 }}>{val(occ.data?.today, occ.error)}</div>
            <div className="k-sub">gecə yarısından bəri</div>
          </div>
          <div className="kpi">
            <div className="k-label">Day-pass bu gün</div>
            <div className="k-val" style={{ marginTop: 18 }}>{val(passes.data?.usedToday, passes.error)}</div>
            <div className="k-sub">{passes.data ? `${passes.data.live} aktiv, gözləyir` : 'təsdiqlənib'}</div>
          </div>
          <div className="kpi">
            <div className="k-label">Üzvlər</div>
            <div className="k-val" style={{ marginTop: 18 }}>{val(roster.data?.members.length, roster.error)}</div>
            <div className="k-sub">{gym!.reviewCount ? `★ ${gym!.rating.toFixed(1)} · ${gym!.reviewCount} rəy` : 'əsas zalı bura olanlar'}</div>
          </div>
        </div>

        <div className="cols-2">
          <div className="page-grid">
            <div className="card pad">
              <div className="section-head">
                <div>
                  <h2>Son 14 gün</h2>
                  {daily.data ? (
                    <div className="muted" style={{ font: '400 13px/1.4 var(--font)', marginTop: 4 }}>
                      Bu həftə {weekTotal} check-in{prevWeek ? ` · keçən həftə ${prevWeek}` : ''}
                    </div>
                  ) : null}
                </div>
                <button className="icon-btn" title="Yenilə" onClick={() => { void occ.reload(); void daily.reload(); void passes.reload(); void roster.reload(); }}>
                  <Icon name="refresh" size={16} />
                </button>
              </div>
              {daily.error ? <Failed onRetry={daily.reload} /> : daily.data ? (
                daily.data.some((d) => d.n > 0) ? <AreaChart points={daily.data} /> : (
                  <div className="empty" style={{ padding: '48px 0' }}>Son 14 gündə check-in olmayıb. Üzvlər QR-ı oxuduqca qrafik burada görünəcək.</div>
                )
              ) : <div className="spinner" />}
            </div>

            <div className="card pad">
              <div className="section-head">
                <h2>Bu gün saat-saat</h2>
                <span className="muted" style={{ font: '400 12.5px/1 var(--font)' }}>qalın — indiki saat</span>
              </div>
              {occ.error ? <Failed onRetry={occ.reload} /> : (
                <div style={{ position: 'relative' }}>
                  <HourBars byHour={occ.data?.byHour ?? []} />
                  {occ.data && occ.data.today === 0 ? (
                    <div className="muted" style={{ position: 'absolute', inset: '0 0 22px', display: 'grid', placeItems: 'center', font: '400 13.5px/1.4 var(--font)' }}>Bu gün hələ check-in olmayıb</div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="page-grid">
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="section-head pad" style={{ marginBottom: 0, paddingBottom: 14 }}>
                <h2>İndi zalda</h2>
                <button className="link" onClick={() => go('members')}>Bütün üzvlər</button>
              </div>
              {roster.error ? <Failed onRetry={roster.reload} /> : here.length === 0 && guests === 0 ? (
                <div className="p-card" style={{ padding: '0 24px 22px' }}>Hazırda heç kim check-in etməyib.</div>
              ) : (
                <div style={{ paddingBottom: 6 }}>
                  {here.slice(0, 8).map((m) => (
                    <div className="list-row" key={m.profileId}>
                      <div className="initials here">{m.anonymous ? '?' : m.name.slice(0, 1).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: '500 14px/1.2 var(--font)' }}>{m.name}</div>
                        <div className="muted" style={{ font: '400 12.5px/1.3 var(--font)', marginTop: 3 }}>{m.checkIns30d} gəliş · son 30 gün</div>
                      </div>
                    </div>
                  ))}
                  {here.length > 8 ? <div className="list-row muted">və daha {here.length - 8} üzv</div> : null}
                  {guests > 0 ? (
                    <div className="list-row">
                      <div className="initials">+{guests}</div>
                      <div className="muted2" style={{ font: '400 13px/1.4 var(--font)' }}>qonaq və ya başqa zalın üzvü</div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="card pad">
              <div className="row" style={{ marginBottom: 12 }}>
                <Icon name="megaphone" size={18} color="var(--muted2)" />
                <h2 className="h-card" style={{ margin: 0 }}>Üzvlərə elan</h2>
              </div>
              <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} placeholder="Məsələn: Bazar günü zal 10:00-da açılır." />
              <div className="row" style={{ marginTop: 12 }}>
                <span className="muted" style={{ font: '400 12px/1.4 var(--font)', flex: 1 }}>İcma lentində sənin adınla görünür.</span>
                <button className="btn primary" disabled={!note.trim() || posting} onClick={() => void post()}>{posting ? 'Göndərilir…' : 'Göndər'}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
