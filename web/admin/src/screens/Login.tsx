import { useState } from 'react';

import { useAuth } from '../lib/auth';
import { Icon } from '../ui/icons';

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pw || busy) return;
    setBusy(true);
    setErr(null);
    const msg = await signIn(email.trim(), pw);
    setBusy(false);
    if (msg) setErr('Giriş uğursuz — e-poçt və ya parol yanlışdır.');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#101014' }}>
      <form onSubmit={submit} style={{ width: 380, background: '#fff', borderRadius: 22, padding: 30, boxShadow: '0 24px 70px rgba(0,0,0,.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--volt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 13, height: 13, borderRadius: '50%', border: '3px solid #101014' }} />
          </div>
          <div style={{ font: '700 18px/1 var(--font)' }}>SPOT Admin</div>
        </div>
        <div style={{ font: '400 13.5px/1.5 var(--font)', color: 'var(--muted2)', marginBottom: 22 }}>
          Daxili idarə paneli. Yalnız icazəli admin hesabları.
        </div>

        <label style={{ font: '600 11px/1 var(--font)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>E-poçt</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
          style={{ width: '100%', height: 46, borderRadius: 12, border: '1px solid var(--line)', padding: '0 14px', marginTop: 7, marginBottom: 16, font: '400 15px/1 var(--font)', outline: 'none' }} />

        <label style={{ font: '600 11px/1 var(--font)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Parol</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          style={{ width: '100%', height: 46, borderRadius: 12, border: '1px solid var(--line)', padding: '0 14px', marginTop: 7, font: '400 15px/1 var(--font)', outline: 'none' }} />

        {err ? <div style={{ color: 'var(--red)', font: '500 12.5px/1.4 var(--font)', marginTop: 14 }}>{err}</div> : null}

        <button type="submit" disabled={busy}
          style={{ width: '100%', height: 48, borderRadius: 13, border: 'none', background: 'var(--ink)', color: '#fff', font: '600 15px/1 var(--font)', marginTop: 22, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Yoxlanılır…' : 'Daxil ol'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 16, color: 'var(--muted)' }}>
          <Icon name="shield" size={14} color="var(--muted)" />
          <span style={{ font: '400 11.5px/1.4 var(--font)' }}>2FA və 8 saatlıq sessiya tələb olunur.</span>
        </div>
      </form>
    </div>
  );
}
