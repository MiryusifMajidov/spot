import { useState } from 'react';

import { useAuth } from '../lib/auth';
import { Icon, type IconName } from '../ui/icons';

const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'ticket', text: 'Day-pass kodlarını resepsiyada bir kliklə yoxla' },
  { icon: 'users', text: 'İndi zalda kimin olduğunu canlı gör' },
  { icon: 'qr', text: 'Check-in QR-ı ekranda göstər və ya çap et' },
  { icon: 'cal', text: 'Cədvəli, qiymətləri və şəkilləri kompüterdən idarə et' },
];

/** Sign-in: the owner's own SPOT account (Google, or a code sent by e-mail).
 *  There is no password and no separate panel account to keep. */
export function Login() {
  const { sendCode, verifyCode, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const google = async () => {
    setErr(null);
    const e = await signInWithGoogle();
    if (e) setErr('Google ilə giriş başlamadı. Yenidən cəhd et.');
  };

  const send = async () => {
    const addr = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return setErr('E-poçt ünvanını düzgün yaz.');
    setBusy(true);
    setErr(null);
    const e = await sendCode(addr);
    setBusy(false);
    if (e) {
      // shouldCreateUser:false — an unknown address is told so, not signed up.
      setErr(/signups not allowed|not found|user/i.test(e)
        ? 'Bu e-poçtla SPOT hesabı tapılmadı. Zal sahibinin tətbiqdə istifadə etdiyi ünvanı yaz.'
        : 'Kod göndərilmədi. Bir az sonra yenidən cəhd et.');
      return;
    }
    setSent(true);
  };

  const verify = async () => {
    if (code.trim().length < 6) return setErr('Məktubdakı kodu tam yaz.');
    setBusy(true);
    setErr(null);
    const e = await verifyCode(email.trim(), code.trim());
    setBusy(false);
    if (e) setErr('Kod yanlışdır və ya vaxtı bitib. Yeni kod istə.');
  };

  return (
    <div className="login">
      <div>
        <div className="row" style={{ justifyContent: 'center', gap: 10, marginBottom: 22 }}>
          <div className="side-mark"><i /></div>
          <div style={{ font: '700 16px/1 var(--font)' }}>SPOT <span style={{ color: 'var(--muted)', fontWeight: 500 }}>Zal paneli</span></div>
        </div>
        <div className="login-card">
          <div style={{ font: '700 22px/1.2 var(--font)', letterSpacing: '-.4px' }}>Daxil ol</div>
          <p className="p-card" style={{ marginTop: 6 }}>Zalın SPOT tətbiqindəki sahib hesabı ilə.</p>

          <button className="btn lg" style={{ width: '100%', marginTop: 22, display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center' }} onClick={() => void google()}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Google ilə daxil ol
          </button>

          <div className="or">və ya e-poçt kodu ilə</div>

          {!sent ? (
            <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="field">
              <label htmlFor="email">E-poçt</label>
              <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sahib@zal.az" />
              <button className="btn primary lg" style={{ marginTop: 8 }} disabled={busy || !email.trim()}>{busy ? 'Göndərilir…' : 'Kodu göndər'}</button>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void verify(); }} className="field">
              <label htmlFor="code">Məktubdakı kod</label>
              <input
                id="code"
                className="code-input"
                style={{ fontSize: 26, letterSpacing: 8, padding: '14px 10px' }}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
              />
              <span className="hint">{email.trim()} ünvanına göndərildi.</span>
              <button className="btn primary lg" style={{ marginTop: 8 }} disabled={busy || code.length < 6}>{busy ? 'Yoxlanılır…' : 'Daxil ol'}</button>
              <button type="button" className="link" style={{ marginTop: 6 }} onClick={() => { setSent(false); setCode(''); setErr(null); }}>Başqa e-poçt yaz</button>
            </form>
          )}

          {err ? <div style={{ marginTop: 14, font: '500 13px/1.45 var(--font)', color: 'var(--red-deep)' }}>{err}</div> : null}

          <div className="login-points">
            {POINTS.map((p) => (
              <div key={p.text}><Icon name={p.icon} size={16} color="var(--volt-deep)" />{p.text}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
