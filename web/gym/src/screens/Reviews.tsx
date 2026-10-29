import { useState } from 'react';

import type { ScreenProps } from '../App';
import { useAuth } from '../lib/auth';
import { fmtDate, getReviews, replyToReview, type Review } from '../lib/gym';
import { useLoad } from '../lib/useLoad';
import { toast } from '../ui/toast';

const stars = (n: number) => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

function ReviewCard({ r, onSaved }: { r: Review; onSaved: (id: string, reply: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(r.reply ?? '');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await replyToReview(r.id, body);
      onSaved(r.id, body);
      setOpen(false);
      toast('Cavab göndərildi');
    } catch {
      toast('Cavab göndərilmədi — yenidən cəhd et');
    }
    setBusy(false);
  };

  return (
    <div className="card pad">
      <div className="row">
        <div className="initials">{r.name.slice(0, 1).toUpperCase()}</div>
        <div style={{ flex: 1 }}>
          <div style={{ font: '600 14px/1.2 var(--font)' }}>{r.name}</div>
          <div className="muted" style={{ font: '400 12px/1.3 var(--font)', marginTop: 3 }}>{[r.tenure, fmtDate(r.createdAt)].filter(Boolean).join(' · ')}</div>
        </div>
        <span className="stars" aria-label={`${r.rating} ulduz`}>{stars(r.rating)}</span>
      </div>
      {r.text ? <p style={{ font: '400 13.5px/1.55 var(--font)', margin: '12px 0 0' }}>{r.text}</p> : null}

      {r.reply && !open ? (
        <div className="reply" style={{ marginTop: 12 }}>
          <b>Zalın cavabı</b>
          {r.reply}
          <div><button className="link" style={{ marginTop: 8, padding: 0 }} onClick={() => setOpen(true)}>Düzəlt</button></div>
        </div>
      ) : null}

      {!r.reply && !open ? (
        <button className="btn small" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>Cavab yaz</button>
      ) : null}

      {open ? (
        <div style={{ marginTop: 12 }}>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={800} placeholder="Nəzakətli və qısa — cavab hamıya görünür." autoFocus />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn" onClick={() => { setOpen(false); setText(r.reply ?? ''); }} disabled={busy}>Ləğv et</button>
            <button className="btn primary" onClick={() => void send()} disabled={busy || !text.trim()}>{busy ? 'Göndərilir…' : 'Göndər'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Reviews(_: ScreenProps) {
  const { gym } = useAuth();
  const list = useLoad(() => getReviews(gym!.id), [gym!.id]);
  const rows = list.data ?? [];
  const unanswered = rows.filter((r) => !r.reply).length;
  const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0;

  if (list.error) {
    return (
      <div className="card pad" style={{ maxWidth: 520 }}>
        <h2 className="h-card">Rəylər yüklənmədi</h2>
        <p className="p-card">Serverə çatmaq olmadı.</p>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={() => void list.reload()}>Yenidən cəhd et</button>
      </div>
    );
  }
  if (list.loading && !list.data) return <div className="spinner" />;

  return (
    <div className="cols-2">
      <div className="page-grid">
        {rows.length === 0 ? (
          <div className="card empty">
            <div style={{ font: '600 15px/1.3 var(--font)', color: 'var(--ink)' }}>Hələ rəy yoxdur</div>
            <div style={{ marginTop: 6, font: '400 13px/1.5 var(--font)' }}>Üzvlər zalı SPOT-da qiymətləndirəndə rəylər burada görünəcək.</div>
          </div>
        ) : (
          rows.map((r) => (
            <ReviewCard key={r.id} r={r} onSaved={(id, reply) => list.setData(rows.map((x) => (x.id === id ? { ...x, reply } : x)))} />
          ))
        )}
      </div>
      <div className="page-grid">
        <div className="kpi">
          <div className="k-label">Orta qiymət</div>
          <div className="row" style={{ marginTop: 10, alignItems: 'baseline' }}>
            <div className="k-val">{rows.length ? avg.toFixed(1) : '—'}</div>
            <span className="stars">{rows.length ? stars(avg) : ''}</span>
          </div>
          <div className="k-sub">{rows.length} rəy</div>
        </div>
        <div className="kpi">
          <div className="k-label">Cavabsız</div>
          <div className="k-val" style={{ marginTop: 10 }}>{unanswered}</div>
          <div className="k-sub">Cavab rəyin altında hamıya görünür.</div>
        </div>
      </div>
    </div>
  );
}
