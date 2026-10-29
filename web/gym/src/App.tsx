import { useEffect, useState } from 'react';

import { useAuth } from './lib/auth';
import { Shell, type ScreenId } from './ui/Shell';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Icon } from './ui/icons';

import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { DayPass } from './screens/DayPass';
import { CheckinQr } from './screens/CheckinQr';
import { Members } from './screens/Members';
import { Schedule } from './screens/Schedule';
import { Reviews } from './screens/Reviews';
import { Profile } from './screens/Profile';

const SCREENS: ScreenId[] = ['dashboard', 'daypass', 'qr', 'members', 'schedule', 'reviews', 'profile'];

/** The screen lives in the address (#daypass): a refresh or a bookmark on the
 *  reception PC opens the same screen again. */
function readHash(): ScreenId {
  const h = window.location.hash.replace('#', '') as ScreenId;
  return SCREENS.includes(h) ? h : 'dashboard';
}

export interface ScreenProps {
  go: (s: ScreenId) => void;
}

function Centered({ icon, title, body, action }: { icon: 'shield' | 'pin' | 'x'; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--page)', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card" style={{ padding: 32, maxWidth: 440, textAlign: 'center' }}>
        <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--fill)', display: 'grid', placeItems: 'center', margin: '0 auto' }}>
          <Icon name={icon} size={26} color="var(--muted2)" />
        </div>
        <div style={{ font: '700 19px/1.25 var(--font)', marginTop: 16 }}>{title}</div>
        <p className="p-card" style={{ marginTop: 8 }}>{body}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>{action}</div>
      </div>
    </div>
  );
}

export default function App() {
  const { phase, signOut, retry } = useAuth();
  const [screen, setScreen] = useState<ScreenId>(readHash);
  const [passCode, setPassCode] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setScreen(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (s: ScreenId) => {
    if (s !== 'daypass') setPassCode(null);
    window.location.hash = s;
    setScreen(s);
  };

  if (phase === 'loading') {
    return <div style={{ minHeight: '100vh', background: 'var(--page)', display: 'grid', placeItems: 'center' }}><div className="spinner" /></div>;
  }
  if (phase === 'signed-out') return <Login />;

  const out = <button className="btn" onClick={() => void signOut()}>Başqa hesabla daxil ol</button>;
  if (phase === 'failed') {
    return (
      <Centered
        icon="x"
        title="Zal məlumatı yüklənmədi"
        body="Serverə çatmaq olmadı — bu, zalın olmadığı demək deyil. İnternet bağlantısını yoxla və yenidən cəhd et."
        action={<><button className="btn primary" onClick={retry}>Yenidən cəhd et</button>{out}</>}
      />
    );
  }
  if (phase === 'no-profile' || phase === 'no-gym') {
    return (
      <Centered
        icon="pin"
        title="Bu hesaba bağlı zal yoxdur"
        body="Zal paneli zal sahibinin SPOT hesabı ilə açılır. Zalı SPOT tətbiqində yarat: Profil → Parametrlər → Zal hesabı yarat. Sonra eyni hesabla bura daxil ol."
        action={out}
      />
    );
  }

  const props: ScreenProps = { go };
  const view = {
    dashboard: <Dashboard {...props} />,
    daypass: <DayPass {...props} initialCode={passCode} />,
    qr: <CheckinQr {...props} />,
    members: <Members {...props} />,
    schedule: <Schedule {...props} />,
    reviews: <Reviews {...props} />,
    profile: <Profile {...props} />,
  }[screen];

  return (
    <Shell
      screen={screen}
      onNav={go}
      onQuickPass={(code) => {
        setPassCode(code);
        window.location.hash = 'daypass';
        setScreen('daypass');
      }}>
      {/* Keyed on the screen (and the code): one broken screen must not take the
          others with it, and a new top-bar code starts a fresh check. */}
      <ErrorBoundary key={screen + (passCode ?? '')}>{view}</ErrorBoundary>
    </Shell>
  );
}
