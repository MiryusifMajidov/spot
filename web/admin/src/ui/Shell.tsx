import { useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { Icon, type IconName } from './icons';

export type ScreenId =
  | 'dashboard' | 'users' | 'trainers' | 'gyms' | 'moderation'
  | 'content' | 'challenges' | 'analytics' | 'admin';

export const NAV: { id: ScreenId; label: string; icon: IconName; countKey?: string; tone?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'users', label: 'İstifadəçilər', icon: 'users', countKey: 'users', tone: 'soft' },
  { id: 'trainers', label: 'Müəllimlər', icon: 'verified', countKey: 'trainers', tone: 'streak' },
  { id: 'gyms', label: 'Zallar', icon: 'pin', countKey: 'gyms', tone: 'streak' },
  { id: 'moderation', label: 'Moderasiya', icon: 'shield', countKey: 'moderation', tone: 'red' },
  { id: 'content', label: 'Məzmun', icon: 'dumbbell', countKey: 'content', tone: '' },
  { id: 'challenges', label: 'Challenge', icon: 'trophy' },
  { id: 'analytics', label: 'Analitika', icon: 'arrow-u' },
];

const TITLES: Record<ScreenId, string> = {
  dashboard: 'Dashboard', users: 'İstifadəçilər', trainers: 'Müəllim doğrulanması', gyms: 'Zallar və claim',
  moderation: 'Moderasiya', content: 'Məzmun', challenges: 'Challenge',
  analytics: 'Analitika', admin: 'Admin və audit',
};

function nowLabel() {
  const d = new Date();
  const days = ['bazar', 'bazar ertəsi', 'çərşənbə axşamı', 'çərşənbə', 'cümə axşamı', 'cümə', 'şənbə'];
  const months = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${months[d.getMonth()]}, ${days[d.getDay()]} · ${hh}:${mm}`;
}

export function Shell({
  screen, onNav, counts, search, onSearch, children,
}: {
  screen: ScreenId;
  onNav: (s: ScreenId) => void;
  counts: Record<string, string>;
  search: string;
  onSearch: (v: string) => void;
  children: ReactNode;
}) {
  const { admin, signOut } = useAuth();
  const [date, setDate] = useState(nowLabel());
  useEffect(() => {
    const t = setInterval(() => setDate(nowLabel()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        (document.getElementById('admin-search') as HTMLInputElement | null)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="board">
      {/* Sidebar */}
      <aside className="side">
        <div className="side-logo">
          <div className="side-mark"><i /></div>
          <div>
            <div style={{ font: '700 15px/1 var(--font)', color: '#fff', letterSpacing: '-.3px' }}>SPOT</div>
            <div style={{ font: '500 10px/1 var(--font)', color: 'rgba(255,255,255,.4)', marginTop: 4 }}>Admin · Bakı</div>
          </div>
        </div>
        <nav className="side-nav">
          {NAV.map((n) => (
            <button key={n.id} className={'nav-item' + (screen === n.id ? ' active' : '')} onClick={() => onNav(n.id)}>
              <Icon name={n.icon} size={18} />
              <span className="lbl">{n.label}</span>
              {n.countKey && counts[n.countKey] ? (
                <span className={'nav-count ' + (n.tone || '')}>{counts[n.countKey]}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="sep" />
          <button className={'nav-item' + (screen === 'admin' ? ' active' : '')} onClick={() => onNav('admin')}>
            <Icon name="settings" size={18} />
            <span className="lbl">Admin və audit</span>
          </button>
          <div className="side-me" title="Çıxış" onClick={() => { if (confirm('Çıxış edilsin?')) signOut(); }} style={{ cursor: 'pointer' }}>
            <div className="av" style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#4A4A55,#6A6A78)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ font: '600 12.5px/1 var(--font)', color: '#fff' }}>{admin?.name || admin?.email || 'Admin'}</div>
              <div style={{ font: '500 10.5px/1 var(--font)', color: 'var(--volt)', marginTop: 4, textTransform: 'capitalize' }}>{admin?.role}</div>
            </div>
            <Icon name="chev-d" size={15} color="rgba(255,255,255,.4)" />
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="main">
        <div className="topbar">
          <h1>{TITLES[screen]}</h1>
          <div className="date">{date}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="search">
              <Icon name="search" size={16} color="var(--muted)" />
              <input id="admin-search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="İstifadəçi, zal, müəllim, ID axtar" />
              <span className="kbd">⌘K</span>
            </div>
            <button className="icon-btn" title="Bildirişlər">
              <Icon name="bell" size={18} />
              <span style={{ position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: '50%', background: 'var(--red)', border: '1.5px solid var(--fill)' }} />
            </button>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
