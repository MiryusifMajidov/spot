import { useState } from 'react';

import { useAuth } from '../lib/auth';
import { Icon } from '../ui/icons';

/** Google's «G», as Google asks it to appear on a sign-in button. */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function Login() {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  // A failed Google round-trip comes back as ?error_description=… — say so.
  const [err, setErr] = useState<string | null>(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get('error_description') || q.get('error') ? 'Google girişi alınmadı — yenidən cəhd et.' : null;
  });
  const [busy, setBusy] = useState(false);

  const google = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const msg = await signInWithGoogle();
    // On success the browser is already leaving for Google.
    if (msg) {
      setBusy(false);
      setErr('Google girişi açılmadı — yenidən cəhd et.');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !pw || busy) return;
    setBusy(true);
    setErr(null);
    const msg = await signIn(email.trim(), pw);
    setBusy(false);
    if (msg) setErr('Giriş uğursuz — e-poçt və ya parol yanlışdır. Google ilə qeydiyyatdan keçmisənsə, yuxarıdakı düyməni işlət.');
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

        <button type="button" onClick={google} disabled={busy}
          style={{ width: '100%', height: 48, borderRadius: 13, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', font: '600 15px/1 var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: busy ? 0.6 : 1, cursor: 'pointer' }}>
          <GoogleG />
          Google ilə daxil ol
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 18px', color: 'var(--muted)', font: '500 11.5px/1 var(--font)' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          və ya e-poçt ilə
          <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        </div>

        <label style={{ font: '600 11px/1 var(--font)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>E-poçt</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
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
          {/* It used to say «2FA və 8 saatlıq sessiya tələb olunur» — neither was
              enforced. Say only what is true. */}
          <span style={{ font: '400 11.5px/1.4 var(--font)' }}>Yalnız admin siyahısındakı hesablar daxil ola bilər.</span>
        </div>
      </form>
    </div>
  );
}
