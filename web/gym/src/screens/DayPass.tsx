import { useEffect, useRef, useState } from 'react';

import type { ScreenProps } from '../App';
import { useAuth } from '../lib/auth';
import { checkDayPass, fmtDate, fmtTime, getDayPassToday, redeemDayPass, type PassCheck } from '../lib/gym';
import { useLoad } from '../lib/useLoad';
import { Icon } from '../ui/icons';
import { toast } from '../ui/toast';

/**
 * «Day-pass yoxla» at the front desk — the same two steps as the app: «Yoxla»
 * reads, «Təsdiqlə» writes. One verify-and-burn button would let a mistyped
 * character turn a stranger's valid pass into a used one, with no undo.
 * Nothing about the person holding the pass is shown — only the pass.
 */
type Verdict =
  | { k: 'idle' }
  | { k: 'busy' }
  | { k: 'offline' }
  | { k: 'result'; code: string; r: PassCheck };

interface LogEntry { code: string; at: number; state: PassCheck['state'] }

function describe(r: PassCheck): { tone: 'good' | 'bad' | 'neutral'; title: string; body: string } {
  switch (r.state) {
    case 'valid':
      return { tone: 'good', title: 'Kod keçərlidir', body: r.expires_at ? `Bu gün ${fmtTime(r.expires_at)}-dək. Qonağı içəri burax və aşağıdan təsdiqlə.` : 'Qonağı içəri burax və aşağıdan təsdiqlə.' };
    case 'redeemed':
      return { tone: 'good', title: 'Təsdiqləndi', body: 'Bu day-pass indi istifadə olunmuş kimi qeyd edildi.' };
    case 'used':
      return { tone: 'bad', title: 'Bu kod artıq istifadə olunub', body: r.used_at ? `${fmtDate(r.used_at)}, ${fmtTime(r.used_at)} tarixində təsdiqlənib. Yenidən keçmir.` : 'Daha əvvəl təsdiqlənib. Yenidən keçmir.' };
    case 'expired':
      return { tone: 'bad', title: 'Kodun vaxtı bitib', body: 'Day-pass yalnız alındığı gün keçərlidir.' };
    case 'refunded':
      return { tone: 'bad', title: 'Bu day-pass ləğv edilib', body: 'Kod artıq keçərli deyil.' };
    default:
      return { tone: 'neutral', title: 'Belə kod tapılmadı', body: 'Kodu bir də yoxla. Başqa zalın kodu da burada görünmür — hər zal yalnız öz day-passlarını yoxlaya bilir.' };
  }
}

export function DayPass({ initialCode }: ScreenProps & { initialCode: string | null }) {
  const { gym } = useAuth();
  const today = useLoad(() => getDayPassToday(gym!.id), [gym!.id]);
  const [code, setCode] = useState(initialCode ?? '');
  const [verdict, setVerdict] = useState<Verdict>({ k: 'idle' });
  const [redeeming, setRedeeming] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = async (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    setVerdict({ k: 'busy' });
    try {
      const r = await checkDayPass(c);
      setVerdict({ k: 'result', code: c, r });
      setLog((l) => [{ code: c, at: Date.now(), state: r.state }, ...l].slice(0, 12));
    } catch {
      // Not reaching the server is not «the code is wrong».
      setVerdict({ k: 'offline' });
    }
  };

  // A code typed into the top bar arrives already: check it straight away.
  useEffect(() => {
    if (initialCode) void check(initialCode);
    else inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redeem = async () => {
    if (verdict.k !== 'result') return;
    setRedeeming(true);
    try {
      const r = await redeemDayPass(verdict.code);
      setVerdict({ k: 'result', code: verdict.code, r });
      setLog((l) => [{ code: verdict.code, at: Date.now(), state: r.state }, ...l].slice(0, 12));
      if (r.state === 'redeemed') toast('Day-pass təsdiqləndi');
      void today.reload();
    } catch {
      toast('Təsdiqlənmədi — bağlantını yoxla və yenidən cəhd et');
    }
    setRedeeming(false);
  };

  const next = () => {
    setCode('');
    setVerdict({ k: 'idle' });
    inputRef.current?.focus();
  };

  const d = verdict.k === 'result' ? describe(verdict.r) : null;

  return (
    <div className="cols-2">
      <div className="page-grid">
        <div className="card" style={{ padding: 26 }}>
          <h2 className="h-card">Qonağın kodu</h2>
          <p className="p-card">Qonaq SPOT tətbiqində «Resepsiyada bu kodu göstər» ekranını açır. Kodu yaz və Enter bas.</p>
          <form
            onSubmit={(e) => { e.preventDefault(); void check(code); }}
            style={{ display: 'flex', gap: 12, marginTop: 18 }}>
            <input
              ref={inputRef}
              className="code-input"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/\s/g, '')); if (verdict.k !== 'busy') setVerdict({ k: 'idle' }); }}
              maxLength={12}
              placeholder="ABC123"
              aria-label="Day-pass kodu"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="btn primary lg" style={{ minWidth: 130 }} disabled={!code.trim() || verdict.k === 'busy'}>
              {verdict.k === 'busy' ? 'Yoxlanılır…' : 'Yoxla'}
            </button>
          </form>

          {verdict.k === 'offline' ? (
            <div className="verdict neutral" style={{ marginTop: 18 }}>
              <div className="dot"><Icon name="x" size={20} /></div>
              <div>
                <b>Yoxlanmadı</b>
                <p>Sorğu serverə çatmadı — bu, kodun səhv olduğu demək DEYİL. Bağlantını yoxla və yenidən yoxla.</p>
              </div>
            </div>
          ) : null}

          {d && verdict.k === 'result' ? (
            <div className={'verdict ' + d.tone} style={{ marginTop: 18 }}>
              <div className="dot"><Icon name={d.tone === 'good' ? 'check' : d.tone === 'bad' ? 'x' : 'search'} size={20} /></div>
              <div style={{ flex: 1 }}>
                <b>{d.title}</b>
                <p>{d.body}</p>
                {verdict.r.state === 'valid' ? (
                  <button className="btn primary lg" style={{ marginTop: 14 }} disabled={redeeming} onClick={() => void redeem()}>
                    {redeeming ? 'Təsdiqlənir…' : 'Təsdiqlə və istifadə olunmuş kimi qeyd et'}
                  </button>
                ) : (
                  <button className="btn" style={{ marginTop: 14 }} onClick={next}>Növbəti kod</button>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="p-card" style={{ padding: '0 4px', fontSize: 12.5 }}>
          SPOT ödəniş qəbul etmir: day-pass-ın haqqı zalda ödənilir. Bu ekran yalnız kodun keçərli olub-olmadığını göstərir və qonaq haqqında heç bir məlumat vermir.
        </div>
      </div>

      <div className="page-grid">
        <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="kpi">
            <div className="k-label">Bu gün təsdiqlənən</div>
            <div className="k-val" style={{ marginTop: 10 }}>{today.error ? '—' : today.data?.usedToday ?? '…'}</div>
          </div>
          <div className="kpi">
            <div className="k-label">Aktiv, gözləyir</div>
            <div className="k-val" style={{ marginTop: 10 }}>{today.error ? '—' : today.data?.live ?? '…'}</div>
          </div>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="pad" style={{ paddingBottom: 10 }}><h2 className="h-card" style={{ margin: 0 }}>Bu növbədə yoxlananlar</h2></div>
          {log.length === 0 ? (
            <div className="p-card" style={{ padding: '0 20px 18px' }}>Hələ kod yoxlanmayıb. Siyahı yalnız bu kompüterdə, səhifə açıq qalanda saxlanır.</div>
          ) : (
            log.map((e, i) => {
              const v = describe({ state: e.state });
              return (
                <div className="list-row" key={i}>
                  <span style={{ font: '700 13px/1 ui-monospace, Menlo, Consolas, monospace', letterSpacing: 1.5 }}>{e.code}</span>
                  <span className="spacer" />
                  <span className={'badge ' + (v.tone === 'good' ? 'green' : v.tone === 'bad' ? 'red' : 'grey')}>
                    {e.state === 'valid' ? 'Keçərli' : e.state === 'redeemed' ? 'Təsdiqləndi' : e.state === 'used' ? 'İstifadə olunub' : e.state === 'expired' ? 'Vaxtı bitib' : e.state === 'refunded' ? 'Ləğv edilib' : 'Tapılmadı'}
                  </span>
                  <span className="muted" style={{ font: '400 11.5px/1 var(--font)', width: 40, textAlign: 'right' }}>
                    {new Date(e.at).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
