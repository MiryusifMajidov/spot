import { useEffect, useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';
import { audit } from '../lib/audit';
import { toast } from '../ui/toast';
import { useAuth, atLeast } from '../lib/auth';
import { Icon } from '../ui/icons';
import type { Admin, AdminRole, AuditRow } from '../lib/types';
import type { ScreenProps } from '../App';

// ── role presentation ───────────────────────────────────────────────────────
const ROLE_META: Record<AdminRole, { label: string; bg: string; color: string }> = {
  owner: { label: 'OWNER', bg: '#101014', color: '#C6FF3D' },
  moderator: { label: 'MODERATOR', bg: 'rgba(255,59,48,.12)', color: '#C42B22' },
  ops: { label: 'OPS', bg: 'rgba(10,132,255,.12)', color: '#0A84FF' },
  support: { label: 'SUPPORT', bg: '#F0F0F3', color: '#6E6E76' },
};
const ROLE_ORDER: AdminRole[] = ['support', 'moderator', 'ops', 'owner'];

// ── audit action → badge ─────────────────────────────────────────────────────
function actionMeta(action: string): { label: string; bg: string; color: string } {
  const a = action.toLowerCase();
  const green = { bg: 'rgba(198,255,61,.28)', color: '#3F5500' };
  const red = { bg: 'rgba(255,59,48,.12)', color: '#C42B22' };
  const orange = { bg: 'rgba(255,149,0,.16)', color: '#8A5A00' };
  const blue = { bg: 'rgba(10,132,255,.12)', color: '#0A84FF' };
  const grey = { bg: '#F0F0F3', color: '#6E6E76' };
  const ink = { bg: '#101014', color: '#C6FF3D' };
  const map: Record<string, { label: string; bg: string; color: string }> = {
    admin_role_change: { label: 'Rol dəyişdirildi', ...ink },
    admin_note: { label: 'Qeyd əlavə edildi', ...grey },
    verify_approve: { label: 'Müəllim doğrulandı', ...green },
    approve: { label: 'Təsdiqləndi', ...green },
    verify_reject: { label: 'Doğrulanma rədd edildi', ...red },
    reject: { label: 'Rədd edildi', ...red },
    claim_approve: { label: 'Zal sahibliyi təsdiqləndi', ...blue },
    claim_reject: { label: 'Claim rədd edildi', ...red },
    ban: { label: 'Hesab bağlandı', ...red },
    suspend: { label: 'Hesab dayandırıldı', ...red },
    mute: { label: 'Mesaj qadağası', ...orange },
    warn: { label: 'Xəbərdarlıq', ...grey },
    restore: { label: 'Sanksiya götürüldü', ...green },
    report_dismiss: { label: 'Şikayət rədd edildi', ...grey },
    content_remove: { label: 'Məzmun silindi', ...red },
    phone_unmask: { label: 'Telefon nömrəsi açıldı', ...grey },
  };
  return map[a] ?? { label: action, ...grey };
}

// ── permission matrix (README §14.1) ─────────────────────────────────────────
type Cell = boolean;
const MATRIX: { op: string; cells: [Cell, Cell, Cell, Cell]; red?: boolean }[] = [
  { op: 'Datanı oxumaq', cells: [true, true, true, true] },
  { op: 'Şikayət qərarı, məzmun silmə', cells: [false, true, true, true] },
  { op: 'Doğrulanma və zal claim qərarı', cells: [false, false, true, true] },
  { op: 'Telefon nömrəsini açmaq', cells: [false, false, true, true] },
  { op: 'Rol idarəsi, audit ixracı', cells: [false, false, false, true] },
  { op: 'Çəki, progress fotosu, söhbət arxivi', cells: [false, false, false, false], red: true },
];

/** How many entries the on-screen table holds. The heading says so out loud —
 *  it used to print `{filtered.length} qeyd` next to «24 ay saxlanılır», which
 *  reads as the size of the whole log rather than the size of one page. */
const TABLE_LIMIT = 100;
/** Export page size, and the ceiling that stops a runaway loop. An export that
 *  hits the ceiling says so rather than passing off a truncated file as
 *  complete. */
const EXPORT_PAGE = 1000;
const EXPORT_MAX = 20000;

function timeParts(iso: string): { t: string; d: string } {
  const dt = new Date(iso);
  return {
    t: dt.toLocaleTimeString('az', { hour: '2-digit', minute: '2-digit' }),
    d: dt.toLocaleDateString('az', { day: 'numeric', month: 'short' }),
  };
}

export function AdminAudit({ search }: ScreenProps) {
  const { admin } = useAuth();
  const isOwner = atLeast(admin?.role, 'owner');

  const [team, setTeam] = useState<Admin[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // pending owner-only role change awaiting a reason
  const [pending, setPending] = useState<{ target: Admin; role: AdminRole } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    // try/catch/finally: a throw between here and the end used to skip
    // `setLoading(false)` and leave the audit log behind a permanent spinner.
    try {
      const [t, a] = await Promise.all([
        supabase.from('admins').select('*'),
        supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(TABLE_LIMIT),
      ]);
      /* «Komanda · 0 admin» and «Audit qeydi yoxdur» are claims. A refused read
         is not one of them. */
      setTeamError(t.error ? t.error.message : null);
      setRowsError(a.error ? a.error.message : null);
      const admins = ((t.data as Admin[]) ?? []).slice().sort(
        (x, y) => ROLE_ORDER.indexOf(y.role) - ROLE_ORDER.indexOf(x.role),
      );
      setTeam(admins);
      setRows((a.data as AuditRow[]) ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'naməlum xəta';
      setTeamError(msg);
      setRowsError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.admin_name ?? ''} ${r.action} ${r.entity ?? ''} ${r.entity_id ?? ''} ${r.reason ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const activeTeam = useMemo(() => team.filter((m) => !m.disabled_at).length, [team]);

  // ── owner actions ──────────────────────────────────────────────────────────
  function askRole(target: Admin, role: AdminRole) {
    if (role === target.role) return;
    setReason('');
    setPending({ target, role });
  }

  async function confirmRole() {
    if (!pending) return;
    const r = reason.trim();
    if (!r) {
      toast('Səbəb mütləqdir');
      return;
    }
    setBusy(true);
    try {
      /* `.select('user_id')` + a row check: `admins_owner_write` is an RLS
         policy, so a caller outside it gets `error: null` with ZERO rows changed
         — and this toast would have announced a role change that never happened,
         with an audit entry to match. */
      const { data: changed, error } = await supabase
        .from('admins')
        .update({ role: pending.role })
        .eq('user_id', pending.target.user_id)
        .select('user_id');
      if (error) {
        toast('Alınmadı: ' + error.message);
        return;
      }
      if (!changed?.length) {
        toast('Rol dəyişmədi — icazə yoxdur. Hesab əvvəlki rolda qaldı');
        return;
      }
      const auditErr = await audit('admin_role_change', 'admin', pending.target.user_id, r, {
        from: pending.target.role,
        to: pending.role,
        email: pending.target.email,
      });
      const done = `${pending.target.name ?? pending.target.email ?? 'Admin'} → ${ROLE_META[pending.role].label}`;
      toast(auditErr ? `${done}, amma audit qeydi yazılmadı: ${auditErr}` : done);
      await load();
    } finally {
      setBusy(false);
      setPending(null);
      setReason('');
    }
  }

  async function addNote(target: Admin) {
    const note = window.prompt(`${target.name ?? target.email ?? 'Admin'} üçün qeyd (audit log-a düşür):`);
    if (!note || !note.trim()) return;
    /* The audit row IS the note — it has no other storage. Throwing away what
       `audit()` returns meant a failed insert (expired session, refused
       `audit_insert`) still toasted «Qeyd audit log-a yazıldı», and the only
       copy of what the owner wrote was their memory. */
    const auditErr = await audit('admin_note', 'admin', target.user_id, note.trim(), { email: target.email });
    toast(auditErr ? 'Qeyd YAZILMADI: ' + auditErr : 'Qeyd audit log-a yazıldı');
    await load();
  }

  // ── exports (owner only) ────────────────────────────────────────────────────
  function download(name: string, mime: string, text: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = name;
    el.click();
    URL.revokeObjectURL(url);
  }

  /* The exports used to serialise the same 100 rows the table holds. An owner
     asked for the moderation history behind a ban three months old pressed «CSV
     ixrac», read «24 ay saxlanılır» above it, and handed over a file whose
     oldest row was a few weeks old — the ban's own entry was not in it. The
     export now runs its own paged query over the whole log. Returns the rows, or
     an error string; `truncated` is true when the ceiling was reached, and the
     caller says so instead of shipping a silent tail. */
  async function fetchAllAudit(): Promise<{ rows: AuditRow[]; truncated: boolean } | string> {
    const out: AuditRow[] = [];
    for (let from = 0; from < EXPORT_MAX; from += EXPORT_PAGE) {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, from + EXPORT_PAGE - 1);
      if (error) return error.message;
      const page = (data as AuditRow[]) ?? [];
      out.push(...page);
      if (page.length < EXPORT_PAGE) return { rows: out, truncated: false };
    }
    return { rows: out, truncated: true };
  }

  async function runExport(kind: 'csv' | 'json') {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetchAllAudit();
      if (typeof res === 'string') {
        toast(`İxrac alınmadı: ${res}. Fayl yazılmadı`);
        return;
      }
      const { rows: all, truncated } = res;
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === 'csv') {
        const head = ['created_at', 'admin_name', 'action', 'entity', 'entity_id', 'reason'];
        const lines = all.map((r) =>
          [r.created_at, r.admin_name ?? '', r.action, r.entity ?? '', r.entity_id ?? '', r.reason ?? '']
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(','),
        );
        download(`spot-audit-${stamp}.csv`, 'text/csv;charset=utf-8', [head.join(','), ...lines].join('\n'));
      } else {
        download(`spot-audit-${stamp}.json`, 'application/json', JSON.stringify(all, null, 2));
      }
      void audit('audit_export', 'audit_log', kind, `${all.length} sətir${truncated ? ` (${EXPORT_MAX} limitinə çatdı)` : ''}`);
      toast(
        truncated
          ? `${all.length} sətir ixrac edildi — LİMİTƏ ÇATDI, log bundan uzundur. Tam nüsxə üçün baza sorğusu lazımdır`
          : `${all.length} sətir ixrac edildi (bütün log)`,
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 10px',
            borderRadius: 7,
            background: 'rgba(255,59,48,.1)',
          }}
        >
          <Icon name="shield" size={14} color="#C42B22" />
          <span style={{ font: '600 11.5px/1 var(--font)', color: '#C42B22' }}>Yalnız Owner rolu</span>
        </span>
        {isOwner ? (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button className="btn" disabled={exporting} onClick={() => void runExport('csv')}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name="download" size={15} color="var(--ink2)" />
                {exporting ? 'İxrac olunur…' : 'CSV ixrac'}
              </span>
            </button>
            <button className="btn" disabled={exporting} onClick={() => void runExport('json')}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name="download" size={15} color="var(--ink2)" />
                {exporting ? 'İxrac olunur…' : 'JSON ixrac'}
              </span>
            </button>
          </div>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '440px 1fr', gap: 20, alignItems: 'start' }}>
        {/* ── left column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Komanda */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div
              style={{
                padding: '16px 18px',
                borderBottom: '1px solid var(--line2)',
                font: '600 14px/1 var(--font)',
              }}
            >
              {/* Counts the ACTIVE admins. A disabled row is not a member of the
                  team — `is_admin()` filters `disabled_at is null` — so folding
                  it into «4 admin» overstated who actually holds access. */}
              Komanda · {loading ? '—' : `${activeTeam} aktiv admin${team.length > activeTeam ? ` · ${team.length - activeTeam} deaktiv` : ''}`}
            </div>
            {loading ? (
              <div className="spinner" />
            ) : team.length === 0 ? (
              <div className="empty">
                {teamError ? `Komanda yüklənmədi (${teamError}) — bu «admin yoxdur» demək DEYİL.` : 'Admin yoxdur'}
              </div>
            ) : (
              <div>
                {team.map((m) => {
                  const rm = ROLE_META[m.role];
                  const off = !!m.disabled_at;
                  return (
                    <div
                      key={m.user_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 11,
                        padding: '13px 18px',
                        borderBottom: '1px solid var(--line2)',
                        opacity: off ? 0.6 : 1,
                      }}
                    >
                      <div className="avatar" style={{ width: 34, height: 34 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: '600 13.5px/1 var(--font)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={off ? { textDecoration: 'line-through' } : undefined}>{m.name ?? 'Adsız'}</span>
                          {/* A revoked admin rendered exactly like a working one:
                              same name, same 2FA badge, same role dropdown. An
                              access review could not tell them apart, so a genuinely
                              active admin could be left unrevoked. */}
                          {off ? <span className="badge red" style={{ fontSize: 9 }}>DEAKTİV</span> : null}
                          {m.two_factor ? (
                            <span className="badge green" style={{ fontSize: 9 }}>2FA</span>
                          ) : (
                            <span className="badge grey" style={{ fontSize: 9 }}>2FA yox</span>
                          )}
                        </div>
                        <div
                          style={{
                            font: '400 11px/1.3 var(--font)',
                            color: 'var(--muted)',
                            marginTop: 5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {m.email ?? '—'}
                          {off ? ` · girişi bağlanıb ${new Date(m.disabled_at as string).toLocaleDateString('az')}` : ''}
                        </div>
                      </div>
                      {isOwner ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                          <select
                            value={m.role}
                            disabled={off}
                            title={off ? 'Bu hesabın girişi bağlanıb — rol dəyişikliyi ona giriş qaytarmır' : undefined}
                            onChange={(e) => askRole(m, e.target.value as AdminRole)}
                            style={{
                              border: '1px solid var(--line)',
                              borderRadius: 8,
                              padding: '5px 8px',
                              font: '600 11px/1 var(--font)',
                              background: '#fff',
                              color: 'var(--ink2)',
                            }}
                          >
                            {ROLE_ORDER.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_META[r].label}
                              </option>
                            ))}
                          </select>
                          <button className="link" onClick={() => addNote(m)}>
                            Qeyd əlavə et
                          </button>
                        </div>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: rm.bg,
                            color: rm.color,
                            font: '700 10.5px/1 var(--font)',
                          }}
                        >
                          {rm.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* İcazə matrisi */}
          <div className="card" style={{ padding: 18 }}>
            <div style={{ font: '600 14px/1 var(--font)', marginBottom: 15 }}>İcazə matrisi</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--line2)',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    font: '600 10.5px/1 var(--font)',
                    letterSpacing: '.06em',
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                  }}
                >
                  Əməliyyat
                </div>
                {['SUP', 'MOD', 'OPS', 'OWN'].map((h) => (
                  <div
                    key={h}
                    style={{ width: 46, textAlign: 'center', font: '600 10px/1 var(--font)', color: 'var(--muted)' }}
                  >
                    {h}
                  </div>
                ))}
              </div>
              {MATRIX.map((row) => (
                <div
                  key={row.op}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: row.red ? '9px 8px' : '9px 0',
                    borderRadius: row.red ? 8 : 0,
                    background: row.red ? 'rgba(255,59,48,.05)' : undefined,
                  }}
                >
                  <div style={{ flex: 1, font: '400 12.5px/1.3 var(--font)' }}>{row.op}</div>
                  {row.cells.map((ok, i) => (
                    <div key={i} style={{ width: 46, textAlign: 'center' }}>
                      {ok ? (
                        <Icon name="check" size={14} color="#5B7F00" />
                      ) : (
                        <Icon name="x" size={13} color="#C0C0C6" />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 12 }}>
              Son sətir heç bir rola açıq deyil — texniki olaraq admin API-da belə sahə yoxdur.
            </div>
          </div>
        </div>

        {/* ── audit log ── */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div
            style={{
              padding: '16px 18px',
              borderBottom: '1px solid var(--line2)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {/* «Audit log» was the last English heading in an Azerbaijani-only
                panel. And the count beside «24 ay saxlanılır» read as the size of
                the whole log while the table holds one page of it — the export
                below reads the log itself, not this list. */}
            <div style={{ font: '600 14px/1 var(--font)' }}>Audit qeydləri</div>
            <div style={{ font: '400 12px/1 var(--font)', color: 'var(--muted)' }}>
              dəyişdirilə bilməz · 24 ay saxlanılır · ekranda son {TABLE_LIMIT} qeyd
            </div>
            {!loading ? (
              <div style={{ marginLeft: 'auto', font: '400 12px/1 var(--font)', color: 'var(--muted)' }}>
                {filtered.length} göstərilir{search.trim() ? ` · «${search.trim()}»` : ''}
              </div>
            ) : null}
          </div>
          {loading ? (
            <div className="spinner" />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 96 }}>Vaxt</th>
                  <th style={{ width: 130 }}>Admin</th>
                  <th style={{ width: 210 }}>Əməliyyat</th>
                  <th style={{ width: 150 }}>Obyekt</th>
                  <th>Səbəb</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const tp = timeParts(r.created_at);
                  const am = actionMeta(r.action);
                  return (
                    <tr key={r.id}>
                      <td style={{ color: 'var(--muted2)' }}>
                        {tp.t}
                        <br />
                        <span style={{ color: '#A0A0A8', fontSize: 11 }}>{tp.d}</span>
                      </td>
                      <td style={{ font: '400 12.5px/1.3 var(--font)' }}>{r.admin_name ?? '—'}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: am.bg,
                            color: am.color,
                            font: '600 11px/1.3 var(--font)',
                          }}
                        >
                          {am.label}
                        </span>
                      </td>
                      <td>
                        {r.entity_id ? (
                          <span style={{ color: 'var(--blue)', font: '400 12.5px/1.3 var(--font)' }}>
                            {r.entity ? `${r.entity} · ` : ''}
                            {r.entity_id.length > 10 ? `#${r.entity_id.slice(0, 8)}` : r.entity_id}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--muted2)', font: '400 12px/1.4 var(--font)' }}>{r.reason ?? '—'}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      {rowsError
                        ? `Audit qeydləri yüklənmədi (${rowsError}) — bu «qeyd yoxdur» demək DEYİL.`
                        : rows.length === 0 ? 'Audit qeydi yoxdur' : 'Uyğun qeyd tapılmadı'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* role-change reason modal (owner only) */}
      {pending ? (
        <div className="scrim" onClick={() => !busy && setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ font: '700 16px/1.3 var(--font)', marginBottom: 8 }}>
              Rol dəyişikliyi — {pending.target.name ?? pending.target.email ?? 'Admin'}
            </div>
            <div style={{ font: '400 12.5px/1.5 var(--font)', color: 'var(--muted)', marginBottom: 14 }}>
              {ROLE_META[pending.target.role].label} → {ROLE_META[pending.role].label}. Bu əməliyyat audit log-a düşür.
              Səbəb tələb olunur.
            </div>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Səbəb (mütləqdir)…"
              style={{
                width: '100%',
                minHeight: 92,
                resize: 'vertical',
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: 12,
                font: '400 13.5px/1.5 var(--font)',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" disabled={busy} onClick={() => setPending(null)}>
                Ləğv et
              </button>
              <button className="btn primary" disabled={busy || !reason.trim()} onClick={confirmRole}>
                {busy ? 'İcra olunur…' : 'Təsdiqlə'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
