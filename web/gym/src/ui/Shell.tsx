import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { Icon, type IconName } from './icons';

export type ScreenId = 'dashboard' | 'daypass' | 'qr' | 'members' | 'schedule' | 'reviews' | 'profile';

export const NAV: { id: ScreenId; label: string; icon: IconName; group?: string }[] = [
  { id: 'dashboard', label: 'Panel', icon: 'grid' },
  { id: 'daypass', label: 'Day-pass yoxla', icon: 'ticket', group: 'Resepsiya' },
  { id: 'qr', label: 'Check-in QR', icon: 'qr' },
  { id: 'members', label: 'Üzvlər', icon: 'users' },
  { id: 'schedule', label: 'Dərs cədvəli', icon: 'cal', group: 'Zal' },
  { id: 'reviews', label: 'Rəylər', icon: 'star' },
  { id: 'profile', label: 'Zal profili', icon: 'edit' },
];

const TITLES: Record<ScreenId, string> = {
  dashboard: 'Panel', daypass: 'Day-pass yoxla', qr: 'Check-in QR', members: 'Üzvlər',
  schedule: 'Dərs cədvəli', reviews: 'Rəylər', profile: 'Zal profili',
};

export function Shell({
  screen, onNav, onQuickPass, children,
}: {
  screen: ScreenId;
  onNav: (s: ScreenId) => void;
  /** A code typed into the top bar: open Day-pass with it already checked. */
  onQuickPass: (code: string) => void;
  children: ReactNode;
}) {
  const { owner, gym, gyms, selectGym, signOut } = useAuth();
  const [quick, setQuick] = useState('');
  const quickRef = useRef<HTMLInputElement>(null);

  /* Reception lives on the keyboard: Ctrl/⌘+K jumps to the day-pass box from
     anywhere, so a visitor's code is two keystrokes away. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (screen === 'daypass') (document.querySelector('.code-input') as HTMLInputElement | null)?.focus();
        else quickRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  const submitQuick = () => {
    const c = quick.trim().toUpperCase();
    if (!c) return;
    setQuick('');
    onQuickPass(c);
  };

  return (
    <div className="board">
      <aside className="side">
        <div className="side-logo">
          <div className="side-mark"><i /></div>
          <div>
            <div style={{ font: '700 15px/1 var(--font)', letterSpacing: '-.3px' }}>SPOT</div>
            <div style={{ font: '500 11.5px/1 var(--font)', color: 'var(--muted)', marginTop: 4 }}>Zal paneli</div>
          </div>
        </div>
        <nav className="side-nav">
          {NAV.map((n) => (
            <div key={n.id}>
              {n.group ? <div className="nav-group">{n.group}</div> : null}
              <button className={'nav-item' + (screen === n.id ? ' active' : '')} onClick={() => onNav(n.id)}>
                <Icon name={n.icon} size={18} />
                <span className="lbl">{n.label}</span>
              </button>
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-me">
            <div className="initials" style={{ width: 34, height: 34, background: 'var(--ink)', color: 'var(--volt)' }}>
              {(gym?.name || 'Z').slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: '600 13.5px/1.2 var(--font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gym?.name}</div>
              <div style={{ font: '400 12px/1.2 var(--font)', color: 'var(--muted)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{owner?.name || 'Sahib'}</div>
            </div>
            <button className="icon-btn" title="Çıxış" onClick={() => { if (confirm('Paneldən çıxılsın?')) void signOut(); }}>
              <Icon name="logout" size={17} />
            </button>
          </div>
          {gyms.length > 1 ? (
            <select className="gym-switch" value={gym?.id} onChange={(e) => selectGym(e.target.value)} aria-label="Zal seç">
              {gyms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          ) : null}
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <h1>{gym?.name} <span style={{ color: 'var(--fill2)', margin: '0 6px' }}>/</span> <span style={{ color: 'var(--ink)' }}>{TITLES[screen]}</span></h1>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            {gym ? (
              gym.listed ? (
                <span className="pill live"><span className="d" />Kəşfdə görünür</span>
              ) : (
                <span className="pill warn" title="Moderator baxandan və ya sahiblik təsdiqlənəndən sonra zal Kəşfdə görünəcək">
                  <span className="d" />Kəşfdə hələ görünmür
                </span>
              )
            ) : null}
            {screen !== 'daypass' ? (
              <form className="quick" onSubmit={(e) => { e.preventDefault(); submitQuick(); }}>
                <Icon name="ticket" size={16} color="var(--muted)" />
                <input ref={quickRef} value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Day-pass kodunu yaz" maxLength={12} aria-label="Day-pass kodu" />
                {quick.trim() ? <button type="submit" className="btn small primary">Yoxla</button> : <span className="kbd">Ctrl K</span>}
              </form>
            ) : null}
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
