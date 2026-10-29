import { useMemo, useState } from 'react';

import type { ScreenProps } from '../App';
import { useAuth } from '../lib/auth';
import { fmtAgo, fmtDate, getRoster, LOYAL_CHECKINS, type Member } from '../lib/gym';
import { useLoad } from '../lib/useLoad';
import { Icon } from '../ui/icons';

type Filter = 'all' | 'here' | 'loyal' | 'away';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Hamısı' },
  { id: 'here', label: 'İndi zalda' },
  { id: 'loyal', label: 'Sadiq' },
  { id: 'away', label: '14+ gündür gəlmir' },
];

const away = (m: Member) => !m.lastCheckIn || Date.now() - Date.parse(m.lastCheckIn) > 14 * 86_400_000;

export function Members(_: ScreenProps) {
  const { gym } = useAuth();
  const roster = useLoad(() => getRoster(gym!.id), [gym!.id]);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const all = roster.data?.members ?? [];
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('az');
    return all
      .filter((m) => (filter === 'here' ? m.hereNow : filter === 'loyal' ? m.checkIns30d >= LOYAL_CHECKINS : filter === 'away' ? away(m) : true))
      .filter((m) => !needle || (!m.anonymous && m.name.toLocaleLowerCase('az').includes(needle)))
      .sort((a, b) => Number(b.hereNow) - Number(a.hereNow) || b.checkIns30d - a.checkIns30d);
  }, [all, filter, q]);

  const count = (f: Filter) =>
    f === 'all' ? all.length : f === 'here' ? all.filter((m) => m.hereNow).length : f === 'loyal' ? all.filter((m) => m.checkIns30d >= LOYAL_CHECKINS).length : all.filter(away).length;

  return (
    <div className="page-grid">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={'chip' + (filter === f.id ? ' active' : '')} onClick={() => setFilter(f.id)}>
            {f.label}{roster.data ? ` · ${count(f.id)}` : ''}
          </button>
        ))}
        <span className="spacer" />
        <div className="search" style={{ background: 'var(--card)', width: 260 }}>
          <Icon name="search" size={16} color="var(--muted)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad ilə axtar" />
        </div>
        <button className="btn" onClick={() => void roster.reload()}><Icon name="refresh" size={14} /> Yenilə</button>
      </div>

      {roster.error ? (
        <div className="card pad">
          <h2 className="h-card">Üzvlər yüklənmədi</h2>
          <p className="p-card">Serverə çatmaq olmadı — bu, üzv olmadığı demək deyil.</p>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => void roster.reload()}>Yenidən cəhd et</button>
        </div>
      ) : roster.loading && !roster.data ? (
        <div className="spinner" />
      ) : all.length === 0 ? (
        <div className="card empty">
          <div style={{ font: '600 15px/1.3 var(--font)', color: 'var(--ink)' }}>Hələ üzv yoxdur</div>
          <div style={{ marginTop: 6, font: '400 13px/1.5 var(--font)' }}>SPOT-da əsas zalını «{gym!.name}» seçən hər kəs burada görünəcək.</div>
        </div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Üzv</th>
              <th>Səviyyə</th>
              <th>Məqsəd</th>
              <th style={{ textAlign: 'right' }}>30 gündə gəliş</th>
              <th>Son gəliş</th>
              <th>SPOT-da</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.profileId}>
                <td>
                  <div className="row">
                    <div className={'initials' + (m.hereNow ? ' here' : '')}>{m.anonymous ? '?' : m.name.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 600, color: m.anonymous ? 'var(--muted2)' : undefined }}>{m.name}</div>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        {m.hereNow ? <span className="badge green">İndi zalda</span> : null}
                        {m.checkIns30d >= LOYAL_CHECKINS ? <span className="badge green">Sadiq</span> : null}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="muted2">{m.level ?? '—'}</td>
                <td className="muted2">{m.goals.length ? m.goals.slice(0, 2).join(', ') : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{m.checkIns30d}</td>
                <td className="muted2">{fmtAgo(m.lastCheckIn)}</td>
                <td className="muted2">{fmtDate(m.joinedAt)}</td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>Bu filtrə uyğun üzv yoxdur.</td></tr>
            ) : null}
          </tbody>
        </table>
      )}

      <p className="p-card" style={{ fontSize: 12, padding: '0 4px' }}>
        Bütün rəqəmlər son 30 günün real check-in-lərindən hesablanır. «Sadiq» — son 30 gündə ən azı {LOYAL_CHECKINS} check-in.
        Gizli profil seçən üzv «Anonim üzv» kimi görünür. Üzvlərin məşqləri, çəkiləri və mesajları zala göstərilmir.
      </p>
    </div>
  );
}
