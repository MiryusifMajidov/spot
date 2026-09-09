import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '../lib/supabase';
import { toast } from '../ui/toast';
import { useAuth, atLeast } from '../lib/auth';
import { Icon } from '../ui/icons';
import type { Trainer, TrainerVerification } from '../lib/types';
import type { ScreenProps } from '../App';

type Tab = 'pending' | 'active' | 'rejected';

/** SLA colour + short label from time-to-due (mirrors Dashboard.slaBadge). */
function slaBadge(due: string): { cls: 'red' | 'orange' | 'grey'; text: string } {
  const ms = new Date(due).getTime() - Date.now();
  if (ms < 0) return { cls: 'red', text: 'gecikib' };
  const h = ms / 3600000;
  if (h < 4) return { cls: 'red', text: `${Math.max(1, Math.round(h))}s` };
  if (h < 24) return { cls: 'orange', text: `${Math.round(h)}s` };
  return { cls: 'grey', text: `${Math.round(h / 24)}g` };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('az', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function Trainers({ search, refreshCounts }: ScreenProps) {
  const { admin } = useAuth();
  const canDecide = atLeast(admin?.role, 'ops');

  const [tab, setTab] = useState<Tab>('pending');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<TrainerVerification[]>([]);
  const [rejected, setRejected] = useState<TrainerVerification[]>([]);
  const [active, setActive] = useState<Trainer[]>([]);
  const [trainerMap, setTrainerMap] = useState<Record<string, Trainer>>({});
  const [gymMap, setGymMap] = useState<Record<string, string>>({});

  const [selId, setSelId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [busy, setBusy] = useState(false);

  // reject modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  async function load() {
    setLoading(true);
    /* try/catch/finally: a throw in the lookup mapping below used to skip
       `setLoading(false)` and leave the verification queue behind a permanent
       spinner with no error anywhere on screen. */
    try {
      await loadInner();
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function loadInner() {
    const [pv, rv, vt] = await Promise.all([
      /* Named columns, not `*`. schema70 took `internal_note` out of the
         column grant — it is the moderator's working note and
         `tv_admin_read` lets the applicant read their own row, so granting
         it meant the trainer read every word. A `select('*')` that touches
         an ungranted column is refused outright, which would have emptied
         the whole verification queue. The note is fetched per row below. */
      supabase.from('trainer_verifications').select('id,trainer_id,user_id,status,doc_id_url,doc_cert_url,gym_confirm,intro_video_url,reject_reason,sla_due_at,created_at').eq('status', 'pending').order('sla_due_at'),
      supabase.from('trainer_verifications').select('id,trainer_id,user_id,status,doc_id_url,doc_cert_url,gym_confirm,intro_video_url,reject_reason,sla_due_at,created_at').eq('status', 'rejected').order('created_at', { ascending: false }),
      supabase.from('trainers').select('*').eq('verified', true).order('name'),
    ]);
    /* PostgREST resolves on failure, so reading `data` alone made a refused or
       dropped read look like an empty verification queue — the screen then said
       «Növbə boşdur» over people waiting to be reviewed. */
    setFailed(!!pv.error || !!rv.error || !!vt.error);
    const pendingRows = (pv.data as TrainerVerification[]) ?? [];
    const rejectedRows = (rv.data as TrainerVerification[]) ?? [];
    const activeRows = (vt.data as Trainer[]) ?? [];
    setPending(pendingRows);
    setRejected(rejectedRows);
    setActive(activeRows);

    // trainer + gym lookups for the queue rows
    const ids = Array.from(
      new Set([...pendingRows, ...rejectedRows].map((v) => v.trainer_id).filter((x): x is string => !!x)),
    );
    const tmap: Record<string, Trainer> = {};
    activeRows.forEach((t) => { tmap[t.id] = t; });
    if (ids.length) {
      const { data: tr } = await supabase.from('trainers').select('*').in('id', ids);
      ((tr as Trainer[]) ?? []).forEach((t) => { tmap[t.id] = t; });
    }
    setTrainerMap(tmap);

    const gymIds = Array.from(
      new Set(Object.values(tmap).map((t) => t.gym_id).filter((x): x is string => !!x)),
    );
    const gmap: Record<string, string> = {};
    if (gymIds.length) {
      const { data: gy } = await supabase.from('gyms').select('id,name').in('id', gymIds);
      ((gy as { id: string; name: string }[]) ?? []).forEach((g) => { gmap[g.id] = g.name; });
    }
    setGymMap(gmap);

    setSelId((prev) => (prev && pendingRows.some((v) => v.id === prev) ? prev : pendingRows[0]?.id ?? null));
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const q = search.trim().toLowerCase();
  const label = (v: TrainerVerification): { name: string; sub: string } => {
    const t = v.trainer_id ? trainerMap[v.trainer_id] : undefined;
    const gym = t?.gym_id ? gymMap[t.gym_id] : null;
    const name = t?.name ?? (v.trainer_id ? `Müəllim ${v.trainer_id.slice(0, 6)}` : 'Naməlum müəllim');
    const sub = [t?.specialty, gym].filter(Boolean).join(' · ') || 'zalsız';
    return { name, sub };
  };

  const filteredPending = useMemo(() => {
    if (!q) return pending;
    return pending.filter((v) => {
      const { name, sub } = label(v);
      return name.toLowerCase().includes(q) || sub.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, trainerMap, gymMap, q]);

  const selected = pending.find((v) => v.id === selId) ?? null;
  const selTrainer = selected?.trainer_id ? trainerMap[selected.trainer_id] : undefined;

  /* The note comes from an admin-gated RPC, one row at a time, because the
     column is no longer readable through the table (schema70). `null` while it
     loads, so the textarea does not briefly show the previous row's note. */
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteFailed, setNoteFailed] = useState(false);
  useEffect(() => {
    if (!selId) { setNote(''); setNoteFailed(false); return; }
    let alive = true;
    setNoteLoading(true);
    setNoteFailed(false);
    void (async () => {
      const { data, error } = await supabase.rpc('admin_verification_note', { p_verification: selId });
      if (!alive) return;
      setNoteLoading(false);
      if (error) { setNoteFailed(true); setNote(''); return; }
      setNote((data as string | null) ?? '');
    })();
    return () => { alive = false; };
  }, [selId]);

  // ---- actions (ops+ only) --------------------------------------------------
  /* All three go through SECURITY DEFINER RPCs (schema50/56).
     `trainer_verifications.status`, `internal_note` and `reject_reason` are not
     in the client UPDATE grant — schema55 narrowed it to the three evidence
     columns so a TRAINER could attach their own certificate without also being
     handed `status`. The admin panel signs in with the same publishable key and
     the same `authenticated` role, so a plain `.update()` here is refused just
     as it is for everybody else. The RPC asks «is this an admin» itself, moves
     the queue row and the trainer's badge in one statement, and writes the audit
     entry — so the request can no longer leave the queue without the badge
     following it. */
  async function saveNote() {
    if (!selected || !canDecide) return;
    setSavingNote(true);
    const { error } = await supabase.rpc('admin_set_verification_note', {
      p_verification: selected.id,
      p_note: note || null,
    });
    setSavingNote(false);
    if (error) { toast(`Qeyd saxlanmadı: ${error.message}`); return; }
    toast('Qeyd saxlanıldı');
    // The row no longer carries the note, so there is nothing to patch back in.
  }

  async function approve() {
    if (!selected || !canDecide || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_decide_verification', {
      p_verification: selected.id,
      p_status: 'approved',
      p_note: note || null,
      p_reason: null,
    });
    setBusy(false);
    if (error) {
      toast(`Nişan verilmədi: ${error.message}`);
      refreshCounts();
      await load();
      return;
    }
    toast('Müəllim doğrulandı');
    refreshCounts();
    await load();
  }

  async function confirmReject() {
    if (!selected || !canDecide) return;
    const reason = rejectReason.trim();
    if (!reason) { toast('Səbəb mütləqdir'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('admin_decide_verification', {
      p_verification: selected.id,
      p_status: 'rejected',
      p_note: note || null,
      p_reason: reason,
    });
    setBusy(false);
    if (error) {
      toast(`Rədd yazılmadı: ${error.message}`);
      refreshCounts();
      await load();
      return;
    }
    setRejectOpen(false);
    setRejectReason('');
    toast('Müraciət rədd edildi');
    refreshCounts();
    await load();
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'pending', label: 'Doğrulanma növbəsi', count: pending.length },
    { id: 'active', label: 'Aktiv', count: active.length },
    { id: 'rejected', label: 'Rədd edilmiş', count: rejected.length },
  ];

  return (
    <>
      {/* segmented tabs (design top-bar) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--fill)', borderRadius: 9, padding: 2 }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                border: 'none', padding: '7px 13px', borderRadius: 7, cursor: 'pointer',
                font: `${tab === t.id ? 600 : 500} 12.5px/1 var(--font)`,
                background: tab === t.id ? '#fff' : 'transparent',
                color: tab === t.id ? 'var(--ink2)' : 'var(--muted2)',
                boxShadow: tab === t.id ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
              }}>
              {t.label} {t.count > 0 ? t.count : ''}
            </button>
          ))}
        </div>
        {!canDecide ? (
          <span className="badge grey" style={{ marginLeft: 'auto' }}>
            Qərar üçün Ops+ icazəsi lazımdır
          </span>
        ) : null}
      </div>

      {loading ? <div className="spinner" /> : null}

      {!loading && tab === 'pending' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '376px 1fr', gap: 16, alignItems: 'start' }}>
          {/* left: SLA-ordered queue */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ font: '600 13px/1 var(--font)' }}>Növbə · {filteredPending.length}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, font: '600 11.5px/1 var(--font)', color: 'var(--blue)' }}>
                <Icon name="clock" size={13} color="var(--blue)" /> SLA üzrə
              </div>
            </div>
            {filteredPending.length === 0 ? (
              <div className="empty" style={{ padding: 40 }}>
                {failed ? 'Növbə yüklənmədi — bu «yoxdur» demək DEYİL. Səhifəni yenilə.' : 'Növbə boşdur'}
              </div>
            ) : filteredPending.map((v) => {
              const { name, sub } = label(v);
              const b = slaBadge(v.sla_due_at);
              const docs = [!!v.doc_id_url, !!v.doc_cert_url, v.gym_confirm];
              const isSel = v.id === selId;
              return (
                <button key={v.id} onClick={() => setSelId(v.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                    padding: '12px 16px', borderBottom: '1px solid var(--line2)',
                    background: isSel ? 'rgba(198,255,61,.1)' : '#fff',
                    borderLeft: isSel ? '3px solid var(--volt)' : '3px solid transparent',
                  }}>
                  <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
                    <div className="avatar" style={{ width: 40, height: 40 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: '600 14px/1.2 var(--font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                      <div style={{ font: '400 11.5px/1.2 var(--font)', color: 'var(--muted)', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
                    </div>
                    <span className={'badge ' + b.cls}>{b.text}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 11 }}>
                    {docs.map((ok, i) => (
                      <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: ok ? 'var(--volt)' : '#DCDCE1' }} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {/* right: selected verification detail */}
          {selected ? (
            <VerificationDetail
              v={selected}
              trainer={selTrainer}
              gymName={selTrainer?.gym_id ? gymMap[selTrainer.gym_id] ?? null : null}
              canDecide={canDecide}
              busy={busy}
              note={note}
              setNote={setNote}
              savingNote={savingNote}
              noteLoading={noteLoading}
              noteFailed={noteFailed}
              onSaveNote={saveNote}
              onApprove={approve}
              onReject={() => { setRejectReason(''); setRejectOpen(true); }}
            />
          ) : (
            <div className="card" style={{ padding: 0 }}><div className="empty">Müraciət seçilməyib</div></div>
          )}
        </div>
      ) : null}

      {!loading && tab === 'active' ? (
        <table className="tbl">
          {/* No «Reytinq» column. `reviews` has a `gym_id` and no `trainer_id` at
              all, so nothing on SPOT can rate a coach; `trainers.rating` is
              `numeric default 0` that schema27 pinned to 0 and made unwritable.
              The old `t.rating != null` guard was therefore always true and this
              column printed «★ 0» next to every applicant — read as a terrible
              score rather than as an impossible measurement. */}
          <thead><tr><th>Müəllim</th><th>İxtisas</th><th>Zal</th><th>Müştəri</th><th>Status</th></tr></thead>
          <tbody>
            {active
              .filter((t) => !q || t.name.toLowerCase().includes(q) || (t.specialty ?? '').toLowerCase().includes(q))
              .map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>
                    {t.name} <Icon name="verified" size={13} color="var(--blue)" />
                  </td>
                  <td style={{ color: 'var(--muted2)' }}>{t.specialty ?? '—'}</td>
                  <td style={{ color: 'var(--muted2)' }}>{t.gym_id ? gymMap[t.gym_id] ?? '—' : 'zalsız'}</td>
                  <td>{t.clients ?? 0}</td>
                  <td><span className="badge green">Doğrulanmış</span></td>
                </tr>
              ))}
            {active.length === 0 ? <tr><td colSpan={5} className="empty">{failed ? 'Siyahı yüklənmədi — bu «yoxdur» demək DEYİL. Səhifəni yenilə.' : 'Doğrulanmış müəllim yoxdur'}</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {!loading && tab === 'rejected' ? (
        <table className="tbl">
          <thead><tr><th>Müəllim</th><th>İxtisas · zal</th><th>Səbəb</th><th>Tarix</th></tr></thead>
          <tbody>
            {rejected.map((v) => {
              const { name, sub } = label(v);
              return (
                <tr key={v.id}>
                  <td style={{ fontWeight: 600 }}>{name}</td>
                  <td style={{ color: 'var(--muted2)' }}>{sub}</td>
                  <td style={{ color: 'var(--muted2)', maxWidth: 360 }}>{v.reject_reason ?? '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{fmtDate(v.created_at)}</td>
                </tr>
              );
            })}
            {rejected.length === 0 ? <tr><td colSpan={4} className="empty">{failed ? 'Siyahı yüklənmədi — bu «yoxdur» demək DEYİL. Səhifəni yenilə.' : 'Rədd edilmiş müraciət yoxdur'}</td></tr> : null}
          </tbody>
        </table>
      ) : null}

      {/* reject reason modal */}
      {rejectOpen && selected ? (
        <div className="scrim" onClick={() => setRejectOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ font: '700 17px/1.2 var(--font)', marginBottom: 6 }}>Müraciəti rədd et</div>
            <div style={{ font: '400 13px/1.4 var(--font)', color: 'var(--muted2)', marginBottom: 14 }}>
              {label(selected).name} · səbəb məcburidir.
            </div>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Rədd səbəbi (məs. sertifikatı verən təşkilat naməlum)"
              style={{ width: '100%', minHeight: 96, resize: 'vertical', border: '1px solid var(--line)', borderRadius: 10, padding: 12, font: '400 13px/1.5 var(--font)', outline: 'none', background: 'var(--board)' }} />
            {/* A «Səbəbi müəllimə göndər» checkbox stood here, ticked by default
                and read by nothing: `confirmReject` always passed the text as
                `p_reason`, which lands in `trainer_verifications.reject_reason`,
                and `tv_admin_read` is `is_admin(auth.uid()) OR auth.uid() =
                user_id` — the applicant reads their own row either way. Unticking
                it changed nothing, so the panel offered a privacy choice it could
                not honour. Say plainly who will read this instead. */}
            <div style={{ background: 'rgba(255,149,0,.1)', borderRadius: 10, padding: '10px 12px', marginTop: 12, font: '400 12px/1.45 var(--font)', color: 'var(--orange-deep)' }}>
              Bu səbəbi müəllimin özü oxuyacaq — onun müraciət sətrində saxlanılır. Daxili qeyd kimi
              istifadə etmə; ona yazdığın kimi yaz.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button className="btn" onClick={() => setRejectOpen(false)}>Ləğv et</button>
              <button className="btn danger" disabled={busy || !rejectReason.trim()} onClick={confirmReject}>Rədd et</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
function VerificationDetail({
  v, trainer, gymName, canDecide, busy, note, setNote, savingNote, noteLoading, noteFailed, onSaveNote, onApprove, onReject,
}: {
  v: TrainerVerification;
  trainer: Trainer | undefined;
  gymName: string | null;
  canDecide: boolean;
  busy: boolean;
  note: string;
  setNote: (s: string) => void;
  savingNote: boolean;
  noteLoading: boolean;
  noteFailed: boolean;
  onSaveNote: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  /* The evidence lives in the PRIVATE `certs` bucket and the column holds a
     storage PATH, not a URL — the mobile app mints a signed URL to read it
     (src/lib/images.ts). This panel rendered the raw path in a plain anchor, so
     «Böyüt» navigated to https://<admin-host>/<path> and 404'd: the reviewer
     could not see one pixel of the document they were deciding on, while the
     card printed a green check and «Sənəd yükləndi». */
  const [signed, setSigned] = useState<Record<string, string | null>>({});
  const [signFailed, setSignFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const paths = [v.doc_id_url, v.doc_cert_url].filter((x): x is string => !!x);
    (async () => {
      const out: Record<string, string | null> = {};
      let bad = false;
      for (const path of paths) {
        const { data, error } = await supabase.storage.from('certs').createSignedUrl(path, 300);
        if (error || !data?.signedUrl) bad = true;
        out[path] = data?.signedUrl ?? null;
      }
      if (!alive) return;
      setSigned(out);
      setSignFailed(bad);
    })();
    return () => { alive = false; };
  }, [v.doc_id_url, v.doc_cert_url]);

  const name = trainer?.name ?? (v.trainer_id ? `Müəllim ${v.trainer_id.slice(0, 6)}` : 'Naməlum müəllim');
  const meta = [
    v.trainer_id ? `#${v.trainer_id}` : null,
    trainer?.specialty,
    gymName,
    `müraciət: ${fmtDate(v.created_at)}`,
  ].filter(Boolean).join(' · ');

  const docs: { title: string; caption: string; url: string | null; ok: boolean; flag?: boolean }[] = [
    { title: 'Şəxsiyyət vəsiqəsi', caption: v.doc_id_url ? 'Sənəd yükləndi' : 'Sənəd yoxdur', url: v.doc_id_url, ok: !!v.doc_id_url },
    { title: 'Məşqçi sertifikatı', caption: v.doc_cert_url ? 'Sənəd yükləndi' : 'Sənəd yoxdur', url: v.doc_cert_url, ok: !!v.doc_cert_url, flag: !v.doc_cert_url },
    { title: 'Zal təsdiqi', caption: v.gym_confirm ? 'Təsdiqləndi' : 'Zal cavab verməyib', url: null, ok: v.gym_confirm },
  ];

  return (
    <div>
      {/* header + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div className="avatar" style={{ width: 56, height: 56 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ font: '700 20px/1.2 var(--font)', letterSpacing: '-.4px' }}>{name}</div>
            <span className="badge orange">YOXLANILIR</span>
          </div>
          <div style={{ font: '400 12.5px/1.3 var(--font)', color: 'var(--muted)', marginTop: 6 }}>{meta}</div>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          <button className="btn danger" disabled={!canDecide || busy} onClick={onReject}
            style={!canDecide ? { opacity: .45, cursor: 'not-allowed' } : undefined}>Rədd et</button>
          <button className="btn primary" disabled={!canDecide || busy} onClick={onApprove}
            style={{ display: 'flex', alignItems: 'center', gap: 7, ...(!canDecide ? { opacity: .45, cursor: 'not-allowed' } : {}) }}>
            <Icon name="check" size={15} color="var(--volt)" /> Təsdiqlə
          </button>
        </div>
      </div>

      {signFailed ? (
        <div className="card" style={{ padding: 12, marginBottom: 12, borderColor: 'var(--orange)' }}>
          <div style={{ font: '400 12.5px/1.5 var(--font)', color: 'var(--text3)' }}>
            Sənədlərin bir hissəsi açılmadı — fayl yerindədir, amma linki almaq alınmadı. Görmədiyin sənədə
            görə qərar vermə: səhifəni yenilə və yenidən cəhd et.
          </div>
        </div>
      ) : null}

      {/* 3 documents side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
        {docs.map((d) => (
          <div key={d.title} className="card"
            style={{ overflow: 'hidden', border: d.flag ? '1.5px solid var(--orange)' : '1px solid var(--line2)' }}>
            <div style={{ height: 150, background: 'linear-gradient(135deg,#DCDCE1,#EFEFF2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, position: 'relative' }}>
              {d.url ? <Icon name="doc" size={26} color="#B4B4BB" /> : <Icon name={d.ok ? 'check' : 'clock'} size={24} color={d.ok ? 'var(--green)' : '#C0C0C6'} />}
              <div style={{ position: 'absolute', top: 9, left: 9, padding: '4px 8px', borderRadius: 6, background: 'rgba(11,11,14,.7)', color: '#fff', font: '600 10px/1 var(--font)' }}>{d.title.split(' ')[0]}</div>
              {d.ok ? (
                <div style={{ position: 'absolute', top: 9, right: 9, width: 22, height: 22, borderRadius: '50%', background: 'var(--volt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={13} color="var(--ink2)" />
                </div>
              ) : null}
              {d.url && signed[d.url] ? (
                <a href={signed[d.url] as string} target="_blank" rel="noreferrer"
                  style={{ position: 'absolute', bottom: 9, right: 9, padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,.9)', font: '600 10px/1 var(--font)', color: 'var(--ink2)' }}>Böyüt</a>
              ) : d.url ? (
                /* The file exists but we could not mint a link for it. Saying so
                   is the difference between «review this» and «you cannot». */
                <div style={{ position: 'absolute', bottom: 9, right: 9, padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,.9)', font: '600 10px/1 var(--font)', color: 'var(--orange-deep)' }}>
                  {signFailed ? 'Açılmadı' : 'Yüklənir…'}
                </div>
              ) : null}
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ font: '600 13px/1.2 var(--font)' }}>{d.title}</div>
              <div style={{ font: '400 11.5px/1.3 var(--font)', color: d.ok ? 'var(--green)' : d.flag ? 'var(--orange-deep)' : 'var(--muted)', marginTop: 5 }}>{d.caption}</div>
            </div>
          </div>
        ))}
      </div>

      {/* profile-content + internal note */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ font: '600 13px/1 var(--font)', marginBottom: 14 }}>Profil məzmunu</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <Row k="İntro video" val={v.intro_video_url ? (
              <a href={v.intro_video_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--blue)' }}>
                <Icon name="play" size={13} color="var(--blue)" /> Bax
              </a>
            ) : <span style={{ color: 'var(--muted)' }}>yoxdur</span>} />
            <Row k="İxtisas" val={trainer?.specialty ?? '—'} />
            <Row k="Zal" val={gymName ?? 'zalsız'} />
            <Row k="Qiymət" val={trainer?.price_from != null ? `${trainer.price_from} ₼-dən` : '—'} />
            {/* «★ 0», printed here for every applicant, was not a low score:
                SPOT has no way to rate a trainer at all — `reviews` carries only
                `gym_id`. The app says «Yeni müəllim — hələ reytinqi yoxdur» and
                this panel now says the same thing. */}
            <Row k="Reytinq" val={<span style={{ color: 'var(--muted)' }}>müəllim reytinqi hələ yoxdur</span>} />
          </div>
          {/* A displayed rate is informational only — SPOT processes no money. */}
          <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 12 }}>
            Qiymət müəllimin öz elanıdır və yalnız məlumat üçün göstərilir. SPOT ödəniş qəbul etmir,
            komissiya götürmür — hesablaşma müəllimlə şagird arasında birbaşa aparılır.
          </div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          {/* It IS internal now. `internal_note` used to be SELECT-granted to
              `authenticated` while `tv_admin_read` lets the applicant read their
              own verification row, so the trainer being judged read every word —
              under a field the panel called «daxili». schema70 took the column
              out of the grant; it is read here through an admin-gated RPC. */}
          <div style={{ font: '600 13px/1 var(--font)', marginBottom: 12 }}>Qərar üçün daxili qeyd</div>
          {noteFailed ? (
            <div style={{ font: '400 12px/1.4 var(--font)', color: 'var(--orange-deep)', marginBottom: 8 }}>
              Mövcud qeyd oxunmadı — burada yazsan, əvvəlki qeydin üzərinə yazılacaq.
            </div>
          ) : null}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!canDecide || noteLoading}
            placeholder={noteLoading ? 'Qeyd yüklənir…' : 'Qeyd — yalnız moderatorlar görür, audit log-a düşür'}
            style={{ width: '100%', minHeight: 76, resize: 'vertical', border: 'none', borderRadius: 10, padding: 12, background: 'var(--board)', font: '400 13px/1.5 var(--font)', color: 'var(--text3)', outline: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
            <div style={{ font: '400 11.5px/1.4 var(--font)', color: 'var(--muted)', maxWidth: 220 }}>
              Yalnız moderatorlar görür (schema70). Audit log-a düşür.
            </div>
            <button className="btn" disabled={!canDecide || savingNote} onClick={onSaveNote}
              style={{ marginLeft: 'auto', padding: '7px 13px', font: '600 12px/1 var(--font)', ...(!canDecide ? { opacity: .45, cursor: 'not-allowed' } : {}) }}>
              {savingNote ? 'Saxlanır…' : 'Qeydi saxla'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, val }: { k: string; val: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: '400 13px/1 var(--font)' }}>
      <div style={{ color: 'var(--muted)' }}>{k}</div>
      <div>{val}</div>
    </div>
  );
}
