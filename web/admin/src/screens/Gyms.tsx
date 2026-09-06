import { useEffect, useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';
import { audit } from '../lib/audit';
import { toast } from '../ui/toast';
import { useAuth, atLeast } from '../lib/auth';
import { Icon } from '../ui/icons';
import type { Gym, GymClaim, Profile } from '../lib/types';
import type { ScreenProps } from '../App';

function slaBadge(due: string): { cls: string; text: string } {
  const ms = new Date(due).getTime() - Date.now();
  if (ms < 0) return { cls: 'red', text: 'gecikib' };
  const h = ms / 3600000;
  if (h < 24) return { cls: 'orange', text: `${Math.max(1, Math.round(h))}s` };
  return { cls: 'grey', text: `${Math.round(h / 24)}g` };
}

/** Supabase errors are plain objects, not Error instances — pull a real message
 *  out of whatever we caught so the admin sees the actual failure. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'naməlum xəta';
}

interface ReasonState {
  claim: GymClaim;
  mode: 'approve' | 'reject';
}

export function Gyms({ search }: ScreenProps) {
  const { admin } = useAuth();
  const canDecide = atLeast(admin?.role, 'ops');

  const [gyms, setGyms] = useState<Gym[]>([]);
  const [claims, setClaims] = useState<GymClaim[]>([]);
  const [names, setNames] = useState<Record<string, string>>({}); // user_id -> profile name
  /** auth user_id -> profiles.id. gyms.owner_id is an FK to profiles(id), so the
   *  auth uid stored on a claim must never be written there directly. */
  const [profileIds, setProfileIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gymsError, setGymsError] = useState<string | null>(null);
  const [claimsError, setClaimsError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<ReasonState | null>(null);
  const [reason, setReason] = useState('');

  /** Publish or hide a gym in Kəşf. Goes through `admin_set_gym_listed`
   *  (schema50) because `gyms.listed` is not in any client UPDATE grant — a
   *  plain table update is refused, including for an admin. */
  const [publishing, setPublishing] = useState<string | null>(null);

  async function setListed(g: Gym) {
    const next = g.listed === false;
    setPublishing(g.id);
    const { error } = await supabase.rpc('admin_set_gym_listed', {
      p_gym: g.id,
      p_listed: next,
      p_reason: null,
    });
    setPublishing(null);
    if (error) {
      toast(`Dəyişmədi: ${error.message}`);
      return;
    }
    toast(next ? `${g.name} Kəşfdə göstərilir` : `${g.name} Kəşfdən gizlədildi`);
    await load();
  }

  async function load() {
    setLoading(true);
    const [g, c] = await Promise.all([
      supabase.from('gyms').select('*').order('members', { ascending: false, nullsFirst: false }),
      supabase.from('gym_claims').select('*').eq('status', 'pending').order('sla_due_at'),
    ]);
    setGymsError(g.error ? g.error.message : null);
    setClaimsError(c.error ? c.error.message : null);
    const gymRows = (g.data as Gym[]) ?? [];
    const claimRows = (c.data as GymClaim[]) ?? [];
    setGyms(gymRows);
    setClaims(claimRows);

    const claimantIds = Array.from(
      new Set(claimRows.map((r) => r.claimant_id).filter((x): x is string => !!x)),
    );
    if (claimantIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id,user_id,name')
        .in('user_id', claimantIds);
      const map: Record<string, string> = {};
      const ids: Record<string, string> = {};
      ((profs as Pick<Profile, 'id' | 'user_id' | 'name'>[]) ?? []).forEach((p) => {
        if (p.user_id) {
          map[p.user_id] = p.name ?? '—';
          ids[p.user_id] = p.id;
        }
      });
      setNames(map);
      setProfileIds(ids);
    } else {
      setNames({});
      setProfileIds({});
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const gymName = (id: string | null): string =>
    (id && gyms.find((g) => g.id === id)?.name) || id || 'Zal';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return gyms;
    return gyms.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.district ?? '').toLowerCase().includes(q) ||
        g.id.toLowerCase().includes(q),
    );
  }, [gyms, search]);

  const unclaimed = useMemo(() => gyms.filter((g) => g.claim_status === 'unclaimed'), [gyms]);

  const verifiedCount = gyms.filter((g) => g.verified).length;

  function openDialog(claim: GymClaim, mode: 'approve' | 'reject') {
    setReason('');
    setDialog({ claim, mode });
  }

  async function submit() {
    if (!dialog) return;
    const { claim, mode } = dialog;
    if (mode === 'reject' && !reason.trim()) {
      toast('Səbəb tələb olunur');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'approve') {
        if (!claim.gym_id) throw new Error('İddiada zal göstərilməyib');
        if (!claim.claimant_id) throw new Error('İddiada iddiaçı göstərilməyib');

        // gyms.owner_id is an FK to profiles(id) — resolve the claimant's PROFILE
        // id from their auth uid first. Never write the auth uid here.
        let ownerProfileId = profileIds[claim.claimant_id];
        if (!ownerProfileId) {
          const { data: prof, error: pErr } = await supabase
            .from('profiles')
            .select('id')
            .eq('user_id', claim.claimant_id)
            .maybeSingle();
          if (pErr) throw pErr;
          if (!prof) throw new Error('İddiaçının profili tapılmadı');
          ownerProfileId = (prof as { id: string }).id;
        }

        // Grant ownership FIRST; only mark the claim approved if that succeeded,
        // otherwise the claim would leave the pending queue without ownership.
        /* Through an RPC — see the note in Trainers.tsx. `gyms.claim_status` and
           `gyms.owner_id` are not in the client UPDATE grant (schema27/41), so
           this table update was refused even for an admin, and no gym claim on
           the platform could ever be approved. */
        const { error: gErr } = await supabase.rpc('admin_set_gym_claim', {
          p_gym: claim.gym_id,
          p_status: 'claimed',
          p_owner: ownerProfileId,
          p_reason: null,
        });
        if (gErr) throw gErr;

        const { error: cErr } = await supabase
          .from('gym_claims')
          .update({ status: 'approved' })
          .eq('id', claim.id);
        if (cErr) throw cErr;

        // The audit entry is the only record this approval ever happened, so a
        // failure to write it is reported rather than hidden behind a success toast.
        const auditErr = await audit('claim_approve', 'gym_claim', claim.id, reason.trim() || undefined, {
          gym_id: claim.gym_id,
          claimant_id: claim.claimant_id,
          owner_profile_id: ownerProfileId,
        });
        toast(
          auditErr
            ? `Claim təsdiqləndi, amma audit qeydi yazılmadı: ${auditErr}`
            : 'Claim təsdiqləndi'
        );
      } else {
        const { data: rows, error } = await supabase
          .from('gym_claims')
          .update({ status: 'rejected', reject_reason: reason.trim() })
          .eq('id', claim.id)
          .select('id');
        if (error) throw error;
        if (!rows?.length) throw new Error('İddia yenilənmədi');
        const auditErr = await audit('claim_reject', 'gym_claim', claim.id, reason.trim(), {
          gym_id: claim.gym_id,
        });
        toast(
          auditErr ? `Claim rədd edildi, amma audit qeydi yazılmadı: ${auditErr}` : 'Claim rədd edildi'
        );
      }
      setDialog(null);
      await load();
    } catch (e) {
      toast(`Alınmadı: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function invite(g: Gym) {
    // Nothing is actually sent to the gym — the action only records an audit
    // entry, so the toast must not claim a delivered invitation.
    toast(`${g.name}: dəvət qeydə alındı (avtomatik mesaj göndərilmir)`);
    void audit('gym_invite', 'gym', g.id, undefined, { name: g.name });
  }

  const qr = (verified: boolean) =>
    verified
      ? { cls: 'green', text: 'aktiv' }
      : { cls: 'orange', text: 'yoxdur' };

  const claimBadge = (s: Gym['claim_status']) =>
    s === 'claimed'
      ? { cls: 'green', text: 'Təsdiqlənmiş' }
      : s === 'pending'
        ? { cls: 'orange', text: 'Claim gözləyir' }
        : { cls: 'grey', text: 'Sahibsiz' };

  const docFlags = (c: GymClaim): { label: string; ok: boolean; url?: string | null }[] => [
    { label: 'VÖEN', ok: !!c.voen },
    { label: 'Zəng', ok: !!c.call_code },
    { label: 'Selfie', ok: !!c.selfie_url, url: c.selfie_url },
  ];

  if (loading) return <div className="spinner" />;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 18,
          font: '400 13px/1 var(--font)',
          color: 'var(--muted)',
        }}
      >
        <span style={{ font: '600 17px/1 var(--font)', color: 'var(--ink)' }}>Zallar</span>
        <span>
          {gymsError
            ? 'Zal siyahısı yüklənmədi'
            : `${gyms.length} zal · ${verifiedCount} təsdiqlənmiş`}
          {' · '}
          {claimsError ? 'claim növbəsi yüklənmədi' : `${claims.length} claim gözləyir`}
        </span>
      </div>

      {/* Claim queue */}
      <div
        style={{
          background: 'var(--ink)',
          borderRadius: 14,
          padding: '18px 20px',
          color: '#fff',
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Icon name="shield" size={18} color="var(--volt)" />
          <div style={{ font: '600 14.5px/1 var(--font)' }}>
            Sahiblik iddiası növbəsi · {claims.length}
          </div>
          <div
            style={{
              marginLeft: 'auto',
              font: '400 12.5px/1 var(--font)',
              color: 'rgba(255,255,255,.5)',
            }}
          >
            Təsdiq: VÖEN + zəng kodu + zal içindən selfie
          </div>
        </div>

        {claims.length === 0 ? (
          <div style={{ font: '400 12.5px/1.4 var(--font)', color: 'rgba(255,255,255,.5)', padding: '6px 0 4px' }}>
            {claimsError
              ? `Claim növbəsi yüklənmədi: ${claimsError}`
              : 'Claim növbəsi boşdur'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {claims.map((c) => {
              const sla = slaBadge(c.sla_due_at);
              return (
                <div key={c.id} style={{ background: 'rgba(255,255,255,.07)', borderRadius: 12, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div
                      className="avatar"
                      style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#3A3A42,#5A5A66)' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ font: '600 13.5px/1.2 var(--font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {gymName(c.gym_id)}
                      </div>
                      <div style={{ font: '400 11px/1.2 var(--font)', color: 'rgba(255,255,255,.45)', marginTop: 4 }}>
                        {c.claimant_id ? names[c.claimant_id] ?? 'İddiaçı' : 'İddiaçı'}
                      </div>
                    </div>
                    <span className={'badge ' + sla.cls}>SLA {sla.text}</span>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    {docFlags(c).map((f) => (
                      <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Icon
                          name={f.ok ? 'check' : 'clock'}
                          size={12}
                          color={f.ok ? 'var(--volt)' : 'var(--orange)'}
                        />
                        {f.url ? (
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ font: '500 10.5px/1 var(--font)', color: 'var(--volt)', textDecoration: 'none' }}
                          >
                            {f.label}
                          </a>
                        ) : (
                          <span style={{ font: '500 10.5px/1 var(--font)', color: 'rgba(255,255,255,.7)' }}>
                            {f.label}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {c.voen ? (
                    <div style={{ font: '400 10.5px/1.3 var(--font)', color: 'rgba(255,255,255,.4)', marginBottom: 10 }}>
                      VÖEN {c.voen}
                    </div>
                  ) : null}

                  {canDecide ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => openDialog(c, 'approve')}
                        style={{
                          flex: 1,
                          height: 34,
                          borderRadius: 9,
                          border: 'none',
                          background: 'var(--volt)',
                          color: '#0B0B0E',
                          font: '600 12.5px/1 var(--font)',
                          cursor: 'pointer',
                        }}
                      >
                        Təsdiqlə
                      </button>
                      <button
                        onClick={() => openDialog(c, 'reject')}
                        title="Rədd et"
                        style={{
                          width: 40,
                          height: 34,
                          borderRadius: 9,
                          border: 'none',
                          background: 'rgba(255,255,255,.12)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Icon name="x" size={15} color="rgba(255,255,255,.7)" />
                      </button>
                    </div>
                  ) : (
                    <div style={{ font: '400 11px/1.3 var(--font)', color: 'rgba(255,255,255,.4)' }}>
                      Qərar üçün ops rolu lazımdır
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Catalog */}
      <div className="section-head">
        <h2>Kataloq</h2>
        <span className="link" style={{ cursor: 'default' }}>
          {filtered.length} zal
        </span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Zal</th>
            <th>Rayon</th>
            <th>Üzv</th>
            <th>Reytinq</th>
            <th>QR statusu</th>
            <th>Claim</th>
            <th>Kəşfdə</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((g) => {
            const q = qr(g.verified);
            const cb = claimBadge(g.claim_status);
            return (
              <tr key={g.id} style={g.claim_status === 'unclaimed' ? { opacity: 0.7 } : undefined}>
                <td style={{ fontWeight: 600 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {g.name}
                    {g.verified ? <Icon name="verified" size={13} color="var(--blue)" /> : null}
                  </span>
                </td>
                <td style={{ color: 'var(--muted2)' }}>{g.district ?? '—'}</td>
                <td>{g.members ?? '—'}</td>
                <td>
                  {g.rating != null ? (
                    <>
                      ★ {g.rating}
                      <span style={{ color: 'var(--muted)', font: '400 11.5px/1 var(--font)', marginLeft: 4 }}>
                        ({g.review_count ?? 0})
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>rəy yoxdur</span>
                  )}
                </td>
                <td>
                  <span className={'badge ' + q.cls}>{q.text}</span>
                </td>
                <td>
                  <span className={'badge ' + cb.cls}>{cb.text}</span>
                </td>
                {/* schema41 makes a gym created inside the app start unlisted, and
                    nothing in the product could ever publish it — the column is not
                    in any client UPDATE grant. This is that control (schema50). */}
                <td>
                  <button
                    className="btn small"
                    disabled={publishing === g.id}
                    onClick={() => setListed(g)}
                    title={g.listed === false ? 'Kəşfdə göstər' : 'Kəşfdən gizlət'}>
                    {publishing === g.id ? '…' : g.listed === false ? 'Dərc et' : 'Gizlət'}
                  </button>
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty">
                {gymsError
                  ? `Zal siyahısı yüklənmədi: ${gymsError}`
                  : gyms.length
                    ? 'Axtarışa uyğun zal tapılmadı'
                    : 'Zal yoxdur'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* Unclaimed invite note */}
      {unclaimed.length ? (
        <div className="card" style={{ padding: '16px 18px', marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
            <Icon name="pin" size={16} color="var(--muted)" />
            <div style={{ font: '600 13.5px/1 var(--font)' }}>Sahibsiz zallara dəvət</div>
            <div style={{ marginLeft: 'auto', font: '400 12px/1 var(--font)', color: 'var(--muted)' }}>
              {unclaimed.length} zal
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unclaimed.slice(0, 8).map((g) => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="avatar" style={{ width: 24, height: 24 }} />
                <div style={{ flex: 1, font: '500 12.5px/1 var(--font)' }}>
                  {g.name}
                  <span style={{ color: 'var(--muted)', marginLeft: 8, font: '400 11.5px/1 var(--font)' }}>
                    {g.district ?? '—'}
                  </span>
                </div>
                <button className="btn" style={{ padding: '6px 12px' }} onClick={() => invite(g)}>
                  Dəvəti qeyd et
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Reason modal */}
      {dialog ? (
        <div className="scrim" onClick={() => (busy ? null : setDialog(null))}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ font: '600 16px/1.2 var(--font)', marginBottom: 6 }}>
              {dialog.mode === 'approve' ? 'Claim təsdiqlə' : 'Claim rədd et'}
            </div>
            <div style={{ font: '400 13px/1.4 var(--font)', color: 'var(--muted)', marginBottom: 14 }}>
              {gymName(dialog.claim.gym_id)}
              {dialog.claim.claimant_id ? ` · ${names[dialog.claim.claimant_id] ?? 'İddiaçı'}` : ''}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                dialog.mode === 'reject' ? 'Rədd səbəbi (mütləq)' : 'Qeyd (istəyə bağlı)'
              }
              rows={3}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                borderRadius: 10,
                border: '1px solid var(--line)',
                padding: '10px 12px',
                font: '400 13px/1.4 var(--font)',
                resize: 'vertical',
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn" onClick={() => setDialog(null)} disabled={busy}>
                Ləğv et
              </button>
              <button
                className={'btn ' + (dialog.mode === 'approve' ? 'volt' : 'danger')}
                onClick={submit}
                disabled={busy || (dialog.mode === 'reject' && !reason.trim())}
              >
                {dialog.mode === 'approve' ? 'Təsdiqlə' : 'Rədd et'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
