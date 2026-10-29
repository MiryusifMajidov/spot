import { useState } from 'react';

import type { ScreenProps } from '../App';
import { useAuth } from '../lib/auth';
import { getDailyCheckIns, getDayPassToday, getOccupancy, getRoster, postAnnouncement, bakuHour } from '../lib/gym';
import { useLoad } from '../lib/useLoad';
import { Icon } from '../ui/icons';
import { toast } from '../ui/toast';

const WEEKDAYS = ['B', 'BE', 'ÇA', 'Ç', 'CA', 'C', 'Ş'];

function Bars({ values, labels, highlight }: { values: number[]; labels: string[]; highlight?: number }) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  const total = values.reduce((s, v) => s + v, 0);
  return (
    <div style={{ position: 'relative' }}>
    {total === 0 ? (
      <div className="muted" style={{ position: 'absolute', inset: '0 0 24px', display: 'grid', placeItems: 'center', font: '500 13px/1.4 var(--font)' }}>
        Bu müddətdə check-in olmayıb
      </div>
    ) : null}
    <div className="bars">
      {values.map((v, i) => (
        <div className="bar-col" key={i} title={`${labels[i]}: ${v}`}>
          <div className="bar-val">{v > 0 ? v : ''}</div>
          <div className={'bar' + (v > 0 ? (i === peak ? ' peak' : ' on') : '')} style={{ height: `${Math.max(3, (v / max) * 100)}%` }} />
          <div className={'bar-lbl' + (i === highlight ? ' now' : '')}>{labels[i]}</div>
        </div>
      ))}
    </div>
    </div>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="row" style={{ padding: '24px 0', justifyContent: 'center' }}>
      <span className="muted" style={{ font: '400 13px/1.4 var(--font)' }}>Yüklənmədi.</span>
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

  const refreshAll = () => { void occ.reload(); void daily.reload(); void passes.reload(); void roster.reload(); };

  const here = (roster.data?.members ?? []).filter((m) => m.hereNow);
  const guests = Math.max(0, (occ.data?.now ?? 0) - here.length);
  const nowHour = bakuHour(new Date().toISOString());
  const hours = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 – 23:00

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

  const kpi = (v: number | undefined, failed: boolean) => (failed ? '—' : v ?? '…');

  return (
    <div className="page-grid">
      {!gym!.listed ? (
        <div className="banner">
          <Icon name="clock" size={20} color="#B8441A" />
          <div>
            <b>Zal hələ Kəşfdə görünmür</b>
            <span>
              Tətbiqdən yaradılan zallar moderator baxandan sonra siyahıya düşür. Sahiblik təsdiqi ayrıca addımdır —{' '}
              <button className="link" onClick={() => go('profile')}>VÖEN-i Zal profilindən göndər</button>.
            </span>
          </div>
        </div>
      ) : null}

      <div className="kpis">
        <div className="kpi dark">
          <div className="k-label">İndi zalda</div>
          <div className="k-val" style={{ marginTop: 10 }}>{kpi(occ.data?.now, occ.error)}</div>
          <div className="k-sub">aktiv check-in · canlı</div>
        </div>
        <div className="kpi">
          <div className="k-label">Bu gün check-in</div>
          <div className="k-val" style={{ marginTop: 10 }}>{kpi(occ.data?.today, occ.error)}</div>
          <div className="k-sub">gecə yarısından bəri</div>
        </div>
        <div className="kpi">
          <div className="k-label">Day-pass bu gün</div>
          <div className="k-val" style={{ marginTop: 10 }}>{kpi(passes.data?.usedToday, passes.error)}</div>
          <div className="k-sub">{passes.data ? `təsdiqlənib · ${passes.data.live} aktiv gözləyir` : 'təsdiqlənib'}</div>
        </div>
        <div className="kpi">
          <div className="k-label">Üzvlər</div>
          <div className="k-val" style={{ marginTop: 10 }}>{kpi(roster.data?.members.length, roster.error)}</div>
          <div className="k-sub">{gym!.reviewCount ? `★ ${gym!.rating.toFixed(1)} · ${gym!.reviewCount} rəy` : 'əsas zalı bura olanlar'}</div>
        </div>
      </div>

      <div className="cols-2">
        <div className="page-grid">
          <div className="card pad">
            <div className="section-head">
              <h2>Bu günün axını</h2>
              <button className="btn small" onClick={refreshAll}><Icon name="refresh" size={14} /> Yenilə</button>
            </div>
            {occ.error ? <Failed onRetry={occ.reload} /> : (
              <Bars
                values={hours.map((h) => occ.data?.byHour[h] ?? 0)}
                labels={hours.map((h) => `${String(h).padStart(2, '0')}`)}
                highlight={hours.indexOf(nowHour)}
              />
            )}
            <p className="p-card" style={{ marginTop: 10, fontSize: 12 }}>Check-in-lərin saatlara görə sayı. Qalın yazılan saat — indiki saat.</p>
          </div>

          <div className="card pad">
            <div className="section-head"><h2>Son 14 gün</h2></div>
            {daily.error ? <Failed onRetry={daily.reload} /> : (
              <Bars
                values={(daily.data ?? []).map((d) => d.n)}
                labels={(daily.data ?? []).map((d) => {
                  const dt = new Date(d.day + 'T12:00:00Z');
                  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()}`;
                })}
              />
            )}
          </div>
        </div>

        <div className="page-grid">
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="section-head pad" style={{ marginBottom: 0, paddingBottom: 12 }}>
              <h2>İndi zalda</h2>
              <button className="link" onClick={() => go('members')}>Bütün üzvlər</button>
            </div>
            {roster.error ? <Failed onRetry={roster.reload} /> : here.length === 0 && guests === 0 ? (
              <div className="p-card" style={{ padding: '4px 20px 20px' }}>Hazırda heç kim check-in etməyib.</div>
            ) : (
              <div>
                {here.slice(0, 8).map((m) => (
                  <div className="list-row" key={m.profileId}>
                    <div className="initials here">{m.anonymous ? '?' : m.name.slice(0, 1).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: '600 13.5px/1.2 var(--font)' }}>{m.name}</div>
                      <div className="muted" style={{ font: '400 12px/1.3 var(--font)', marginTop: 3 }}>{m.checkIns30d} gəliş · son 30 gün</div>
                    </div>
                  </div>
                ))}
                {here.length > 8 ? <div className="list-row muted" style={{ font: '500 12.5px/1 var(--font)' }}>və daha {here.length - 8} üzv</div> : null}
                {guests > 0 ? (
                  <div className="list-row">
                    <div className="initials">+{guests}</div>
                    <div className="muted2" style={{ font: '400 12.5px/1.4 var(--font)' }}>qonaq və ya başqa zalın üzvü</div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="card pad">
            <div className="row" style={{ marginBottom: 10 }}>
              <Icon name="megaphone" size={18} color="var(--muted2)" />
              <h2 className="h-card" style={{ margin: 0 }}>Üzvlərə elan</h2>
            </div>
            <textarea
              className="textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={600}
              placeholder="Məsələn: Bazar günü zal 10:00-da açılır."
            />
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted" style={{ font: '400 11.5px/1.4 var(--font)', flex: 1 }}>İcma lentində sənin adınla görünür.</span>
              <button className="btn primary" disabled={!note.trim() || posting} onClick={() => void post()}>{posting ? 'Göndərilir…' : 'Göndər'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
