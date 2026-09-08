import { useCallback, useEffect, useState } from 'react';

import { useAuth } from './lib/auth';
import { supabase } from './lib/supabase';
import type { DashboardKpis } from './lib/types';
import { Shell, type ScreenId } from './ui/Shell';
import { Icon } from './ui/icons';

import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { Users } from './screens/Users';
import { Trainers } from './screens/Trainers';
import { Gyms } from './screens/Gyms';
import { Moderation } from './screens/Moderation';
import { Content } from './screens/Content';
import { Challenges } from './screens/Challenges';
import { Analytics } from './screens/Analytics';
import { AdminAudit } from './screens/AdminAudit';

export interface ScreenProps {
  search: string;
  go: (s: ScreenId) => void;
  refreshCounts: () => void;
}

const fmtK = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));

export default function App() {
  const { loading, session, admin, signOut } = useAuth();
  const [screen, setScreen] = useState<ScreenId>('dashboard');
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});

  const refreshCounts = useCallback(async () => {
    // Keep the error: an empty badge and a failed read look identical otherwise.
      const { data, error } = await supabase.rpc('admin_dashboard');
    if (error) {
      // A read that failed is not an empty queue. '!' is visibly different from
      // both a number and a blank badge, so pending work is never hidden by a
      // broken call — which is exactly what happened while admin_dashboard()
      // was throwing 42703 (schema58).
      setCounts({ users: '', trainers: '!', gyms: '!', moderation: '!' });
      return;
    }
    const k = (data ?? {}) as Partial<DashboardKpis>;
    setCounts({
      users: k.users_total != null ? fmtK(k.users_total) : '',
      trainers: k.trainers_pending ? String(k.trainers_pending) : '',
      gyms: k.claims_pending ? String(k.claims_pending) : '',
      moderation: k.reports_open ? String(k.reports_open) : '',
    });
  }, []);

  useEffect(() => {
    if (admin) refreshCounts();
  }, [admin, refreshCounts]);

  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#101014', display: 'grid', placeItems: 'center' }}><div className="spinner" style={{ borderTopColor: '#C6FF3D' }} /></div>;
  }
  if (!session) return <Login />;
  if (!admin) {
    return (
      <div style={{ minHeight: '100vh', background: '#101014', display: 'grid', placeItems: 'center', color: '#fff', textAlign: 'center' }}>
        <div>
          <Icon name="shield" size={40} color="#C6FF3D" />
          <div style={{ font: '700 20px/1 var(--font)', marginTop: 16 }}>İcazə yoxdur</div>
          <div style={{ font: '400 14px/1.5 var(--font)', color: 'rgba(255,255,255,.6)', marginTop: 8, maxWidth: 320 }}>
            Bu hesab admin deyil. Owner səni <code>admins</code> cədvəlinə əlavə etməlidir.
          </div>
          <button className="btn" onClick={signOut} style={{ marginTop: 20 }}>Çıxış</button>
        </div>
      </div>
    );
  }

  const props: ScreenProps = { search, go: setScreen, refreshCounts };
  const view = {
    dashboard: <Dashboard {...props} />, users: <Users {...props} />, trainers: <Trainers {...props} />,
    gyms: <Gyms {...props} />, moderation: <Moderation {...props} />, content: <Content {...props} />,
    challenges: <Challenges {...props} />, analytics: <Analytics {...props} />,
    admin: <AdminAudit {...props} />,
  }[screen];

  return (
    <Shell screen={screen} onNav={setScreen} counts={counts} search={search} onSearch={setSearch}>
      {view}
    </Shell>
  );
}
