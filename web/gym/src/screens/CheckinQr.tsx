import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import type { ScreenProps } from '../App';
import { useAuth } from '../lib/auth';
import { getCheckinCode, rotateCheckinCode } from '../lib/gym';
import { useLoad } from '../lib/useLoad';
import { Icon } from '../ui/icons';
import { toast } from '../ui/toast';

/** The gym's check-in QR (gym_checkin_codes, schema74). Dark modules on light
 *  in both the screen and the print — a scanner needs that contrast. */
function QrSvg({ value, size }: { value: string; size: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    void QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1A1A1A', light: '#FEFEFE' } }).then((s) => {
      if (alive) setSvg(s);
    });
    return () => { alive = false; };
  }, [value]);
  return <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} aria-label="Check-in QR kodu" role="img" />;
}

export function CheckinQr(_: ScreenProps) {
  const { gym } = useAuth();
  const code = useLoad(() => getCheckinCode(gym!.id), [gym!.id]);
  const [busy, setBusy] = useState(false);
  const [kiosk, setKiosk] = useState(false);

  useEffect(() => {
    if (!kiosk) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setKiosk(false); };
    window.addEventListener('keydown', onKey);
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [kiosk]);

  const rotate = async (fresh: boolean) => {
    if (!fresh && !confirm('Yeni kod yaradılsın? Divardakı köhnə QR həmin an işləməyi dayandırır — yenisini çap edib asmalısan.')) return;
    setBusy(true);
    try {
      const c = await rotateCheckinCode(gym!.id);
      code.setData(c);
      toast(fresh ? 'Kod hazırdır' : 'Yeni kod hazırdır — köhnə çap artıq işləmir');
    } catch {
      toast('Kod yaradılmadı — bağlantını yoxla və yenidən cəhd et');
    }
    setBusy(false);
  };

  if (code.loading && code.data == null) return <div className="spinner" />;

  if (code.error) {
    return (
      <div className="card pad" style={{ maxWidth: 520 }}>
        <h2 className="h-card">Kod yüklənmədi</h2>
        <p className="p-card">Serverə çatmaq olmadı. Bu, zalın kodu olmadığı demək deyil — yeni kod yaratma, əvvəlcə yenidən yoxla.</p>
        <button className="btn primary" style={{ marginTop: 14 }} onClick={() => void code.reload()}>Yenidən cəhd et</button>
      </div>
    );
  }

  const value = code.data;

  if (!value) {
    return (
      <div className="card" style={{ padding: 32, maxWidth: 560 }}>
        <div className="initials" style={{ width: 48, height: 48 }}><Icon name="qr" size={24} /></div>
        <h2 className="h-card" style={{ marginTop: 16 }}>Zalın check-in kodu hələ yoxdur</h2>
        <p className="p-card">Kod yarat, çap et və resepsiyaya as. Üzvlər onu SPOT tətbiqində oxuyub check-in edəcək.</p>
        <button className="btn primary lg" style={{ marginTop: 18 }} disabled={busy} onClick={() => void rotate(true)}>{busy ? 'Yaradılır…' : 'Kod yarat'}</button>
      </div>
    );
  }

  return (
    <>
      <div className="cols-2">
        <div className="card" style={{ padding: 30, display: 'flex', gap: 30, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="qr-box"><QrSvg value={value} size={240} /></div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="muted" style={{ font: '600 13px/1 var(--font)' }}>Zalın kodu</div>
            <div className="qr-code-text" style={{ marginTop: 10 }}>{value}</div>
            <p className="p-card" style={{ marginTop: 14 }}>Üzv SPOT-da Check-in tabını açıb bu QR-ı oxuyur. Kamera işləməsə, kodu əl ilə də yaza bilər.</p>
            <div className="row" style={{ marginTop: 20, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => setKiosk(true)}><Icon name="expand" size={15} /> Ekranda göstər</button>
              <button className="btn" onClick={() => window.print()}><Icon name="print" size={15} /> Çap et</button>
            </div>
          </div>
        </div>

        <div className="page-grid">
          <div className="card pad">
            <h2 className="h-card">Resepsiya monitoru üçün</h2>
            <p className="p-card">«Ekranda göstər» QR-ı tam ekranda açır — resepsiyadakı ikinci monitorda və ya planşetdə açıq saxla. Çıxmaq üçün Esc.</p>
          </div>
          <div className="card pad">
            <h2 className="h-card">Kodu yenilə</h2>
            <p className="p-card">Kod zalın divarından kənara çıxıbsa (məsələn, şəkli paylaşılıb) yenisini yarat. Köhnə QR o an işləməyi dayandırır.</p>
            <button className="btn danger" style={{ marginTop: 14 }} disabled={busy} onClick={() => void rotate(false)}>
              <Icon name="refresh" size={14} /> {busy ? 'Yaradılır…' : 'Yeni kod yarat'}
            </button>
          </div>
        </div>
      </div>

      {kiosk ? (
        <div className="kiosk">
          <button className="btn close" onClick={() => setKiosk(false)}><Icon name="x" size={14} /> Bağla</button>
          <div className="row" style={{ gap: 12 }}>
            <div className="side-mark" style={{ width: 40, height: 40, borderRadius: 12 }}><i style={{ width: 16, height: 16 }} /></div>
            <div style={{ font: '700 22px/1 var(--font)' }}>SPOT</div>
          </div>
          <h1>{gym!.name}</h1>
          <div className="qr-box" style={{ padding: 28, borderRadius: 24 }}><QrSvg value={value} size={Math.min(window.innerHeight * 0.5, 460)} /></div>
          <p>SPOT tətbiqində <b>Check-in</b> tabını aç və bu kodu oxut.</p>
          <div className="qr-code-text muted2">{value}</div>
        </div>
      ) : null}

      <div className="poster">
        <div style={{ font: '700 22px/1 var(--font)' }}>SPOT</div>
        <h1>{gym!.name}</h1>
        <QrSvg value={value} size={420} />
        <p>SPOT tətbiqində Check-in tabını aç və bu kodu oxut.</p>
        <div className="qr-code-text">{value}</div>
      </div>
    </>
  );
}
