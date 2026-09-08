import { useEffect, useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';
import { audit } from '../lib/audit';
import { toast } from '../ui/toast';
import { useAuth, atLeast } from '../lib/auth';
import { Icon } from '../ui/icons';
import type { Challenge } from '../lib/types';
import type { ScreenProps } from '../App';

/* The embedded `leaderboard` jsonb is gone (schema60). It held seeded entries —
   invented names with invented ranks — and this screen drew the top three of them
   as «Liderlər», which made a fabricated ranking look like a moderation fact. The
   real ranking is counted from workout rows by `challenge_standings()` and lives
   in the app, where the participants are. */
type ChallengeRow = Challenge;

type Filter = 'all' | 'active' | 'inactive';

// scope → Azerbaijani label offered in the create modal.
const SCOPES: { value: string; label: string }[] = [
  { value: 'solo', label: 'Solo · fərdi' },
  { value: 'gym', label: 'Zal · komanda' },
  { value: 'city', label: 'Şəhər · hamı' },
];
const scopeLabelFor = (scope: string) => SCOPES.find((s) => s.value === scope)?.label ?? scope;

function slugify(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `${base || 'challenge'}-${Date.now().toString(36).slice(-4)}`;
}

interface Draft {
  title: string;
  scope: string;
  target: string;
  unit: string;
  reward: string;
  /** yyyy-mm-dd from a date input. A challenge with no end date never ends. */
  endsOn: string;
}
const emptyDraft: Draft = { title: '', scope: 'solo', target: '', unit: '', reward: '', endsOn: '' };

export function Challenges({ search, refreshCounts }: ScreenProps) {
  const { admin } = useAuth();
  const canManage = atLeast(admin?.role, 'ops');

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ChallengeRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null); // id currently toggling

  // create modal
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase
      .from('challenges')
      .select('*')
      .order('active', { ascending: false })
      .order('ends_at', { ascending: true, nullsFirst: false });
    setRows((data as ChallengeRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = search.trim().toLowerCase();

  const visible = useMemo(
    () =>
      rows
        .filter((c) => (filter === 'all' ? true : filter === 'active' ? c.active : !c.active))
        .filter(
          (c) =>
            !q ||
            c.title.toLowerCase().includes(q) ||
            (c.scope_label ?? '').toLowerCase().includes(q) ||
            (c.reward ?? '').toLowerCase().includes(q),
        ),
    [rows, filter, q],
  );

  const activeCount = rows.filter((c) => c.active).length;
  const participantsTotal = rows.reduce((s, c) => s + (c.participants || 0), 0);

  async function toggleActive(c: ChallengeRow) {
    if (!canManage || busy) return;
    const next = !c.active;
    const reason = window
      .prompt(`«${c.title}» challenge-i ${next ? 'AKTİV et' : 'DAYANDIR'} — səbəb (audit-ə yazılır):`, '')
      ?.trim();
    if (!reason) return; // cancelled or empty → no-op
    setBusy(c.id);
    const { error } = await supabase.from('challenges').update({ active: next }).eq('id', c.id);
    setBusy(null);
    if (error) {
      toast('Xəta: ' + error.message);
      return;
    }
    await audit(next ? 'challenge_activate' : 'challenge_deactivate', 'challenge', c.id, reason, {
      title: c.title,
      active: next,
    });
    toast(next ? 'Challenge aktivləşdirildi' : 'Challenge dayandırıldı');
    refreshCounts();
    loadData();
  }

  async function createChallenge() {
    if (!canManage || saving) return;
    const t = draft.title.trim();
    const target = parseInt(draft.target, 10);
    if (!t || !draft.unit.trim() || !Number.isFinite(target) || target <= 0) return;
    setSaving(true);
    const id = slugify(t);
    /* End of the chosen day in Baku, so a challenge that «ends on the 30th» is
       still open all day on the 30th. No date means open-ended. */
    const endsAt = draft.endsOn ? new Date(`${draft.endsOn}T23:59:59+04:00`).toISOString() : null;
    const { error } = await supabase.from('challenges').insert({
      id,
      title: t,
      scope: draft.scope,
      scope_label: scopeLabelFor(draft.scope),
      target,
      unit: draft.unit.trim(),
      reward: draft.reward.trim() || null,
      starts_at: new Date().toISOString(),
      ends_at: endsAt,
      active: false,
    });
    setSaving(false);
    if (error) {
      toast('Xəta: ' + error.message);
      return;
    }
    await audit('challenge_create', 'challenge', id, undefined, { title: t, scope: draft.scope, target, unit: draft.unit.trim(), ends_at: endsAt });
    toast('Challenge yaradıldı');
    setShowNew(false);
    setDraft(emptyDraft);
    refreshCounts();
    loadData();
  }

  const targetNum = parseInt(draft.target, 10);
  const canSubmit = !!draft.title.trim() && !!draft.unit.trim() && Number.isFinite(targetNum) && targetNum > 0;

  return (
    <>
      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <Kpi label="Challenge · ümumi" val={loading ? '—' : String(rows.length)} />
        <Kpi label="Aktiv" val={loading ? '—' : String(activeCount)} sub={activeCount ? 'canlı' : undefined} />
        <Kpi label="İştirakçı · cəmi" val={loading ? '—' : participantsTotal.toLocaleString('az')} />
        <Kpi label="Passiv / qaralama" val={loading ? '—' : String(rows.length - activeCount)} dark />
      </div>

      {/* ── Toolbar: filter chips + create ── */}
      <div className="section-head" style={{ display: 'flex', alignItems: 'center' }}>
        <h2>Challenge-lər</h2>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 7, marginRight: 12 }}>
          {(['all', 'active', 'inactive'] as Filter[]).map((f) => (
            <button key={f} className={'chip' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Hamısı' : f === 'active' ? 'Aktiv' : 'Passiv'}
            </button>
          ))}
        </div>
        {canManage ? (
          <button className="btn primary" onClick={() => { setDraft(emptyDraft); setShowNew(true); }}>
            <Icon name="trophy" size={13} color="var(--volt)" /> Yeni challenge
          </button>
        ) : null}
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div className="spinner" />
      ) : visible.length === 0 ? (
        <div className="card"><div className="empty">Challenge yoxdur</div></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
          {visible.map((c) => (
            <ChallengeCard
              key={c.id}
              c={c}
              canManage={canManage}
              busy={busy === c.id}
              onToggle={() => toggleActive(c)}
            />
          ))}
        </div>
      )}

      {/* ── Create modal ── */}
      {showNew ? (
        <div className="scrim" onClick={() => !saving && setShowNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ font: '700 16.5px/1.2 var(--font)', marginBottom: 6 }}>Yeni challenge</div>
            <div style={{ font: '400 13px/1.4 var(--font)', color: 'var(--muted2)', marginBottom: 18 }}>
              Yeni challenge qaralama kimi yaradılır (passiv). Yaratdıqdan sonra aktivləşdirə bilərsən.
            </div>

            <Field label="Başlıq">
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="məs. Avqust · 12 məşq"
                style={inputStyle}
              />
            </Field>

            <Field label="Əhatə (scope)">
              <select
                value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                style={inputStyle}
              >
                {SCOPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="Hədəf">
                <input
                  value={draft.target}
                  onChange={(e) => setDraft({ ...draft, target: e.target.value.replace(/[^0-9]/g, '') })}
                  inputMode="numeric"
                  placeholder="12"
                  style={inputStyle}
                />
              </Field>
              <Field label="Vahid">
                <input
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  placeholder="məşq"
                  style={inputStyle}
                />
              </Field>
              <Field label="Bitmə tarixi">
                <input
                  type="date"
                  value={draft.endsOn}
                  onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
                  style={inputStyle}
                />
              </Field>
            </div>

            <Field label="Mükafat">
              <input
                value={draft.reward}
                onChange={(e) => setDraft({ ...draft, reward: e.target.value })}
                placeholder="məs. 1 aylıq üzvlük"
                style={inputStyle}
              />
            </Field>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button className="btn" onClick={() => setShowNew(false)} disabled={saving}>Ləğv et</button>
              <button className="btn primary" onClick={createChallenge} disabled={!canSubmit || saving}>
                {saving ? 'Yaradılır…' : 'Yarat'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '10px 12px',
  font: '400 13.5px/1 var(--font)',
  color: 'var(--ink2)',
  outline: 'none',
  background: '#fff',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ font: '600 11px/1 var(--font)', letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 7 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, val, sub, dark }: { label: string; val: string; sub?: string; dark?: boolean }) {
  return (
    <div className={'kpi' + (dark ? ' dark' : '')}>
      <div className="k-label">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 11 }}>
        <div className="k-val">{val}</div>
        {sub ? (
          <div style={{ font: '500 11.5px/1 var(--font)', color: dark ? 'rgba(255,255,255,.5)' : 'var(--muted)' }}>{sub}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Days left, from a real timestamp. `null` = open-ended, past = finished. */
function leftLabel(endsAt: string | null): string {
  if (!endsAt) return 'tarixsiz';
  const days = Math.ceil((Date.parse(endsAt) - Date.now()) / 86400000);
  if (days <= 0) return 'bitib';
  return `${days} gün`;
}
function isUrgent(endsAt: string | null): boolean {
  if (!endsAt) return false;
  const days = Math.ceil((Date.parse(endsAt) - Date.now()) / 86400000);
  return days > 0 && days <= 3;
}

function ChallengeCard({ c, canManage, busy, onToggle }: {
  c: ChallengeRow; canManage: boolean; busy: boolean; onToggle: () => void;
}) {
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Icon name="trophy" size={19} color="var(--volt)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ font: '600 15px/1.2 var(--font)' }}>{c.title}</div>
            <span className={'badge ' + (c.active ? 'green' : 'grey')}>{c.active ? 'AKTİV' : 'PASSİV'}</span>
          </div>
          <div style={{ font: '400 12px/1.3 var(--font)', color: 'var(--muted)', marginTop: 6 }}>
            {c.scope_label || scopeLabelFor(c.scope)}
          </div>
        </div>
      </div>

      {/* stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        <Stat val={`${c.target}${c.unit ? ' ' + c.unit : ''}`} label="hədəf" />
        <Stat val={(c.participants || 0).toLocaleString('az')} label="iştirakçı" />
        <Stat val={leftLabel(c.ends_at)} label="qalıb" accent={isUrgent(c.ends_at) ? 'var(--red)' : undefined} />
      </div>

      {/* reward */}
      {c.reward ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--fill)', borderRadius: 10, padding: '9px 12px' }}>
          <Icon name="flame" size={14} color="var(--orange)" />
          <div style={{ font: '500 12.5px/1.3 var(--font)', color: 'var(--text3)' }}>{c.reward}</div>
        </div>
      ) : null}

      {/* action */}
      {canManage ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--line2)', paddingTop: 12 }}>
          <button
            className={'btn' + (c.active ? '' : ' volt')}
            onClick={onToggle}
            disabled={busy}
          >
            {busy ? '…' : c.active ? (
              <><Icon name="x" size={13} color="var(--red)" /> Dayandır</>
            ) : (
              <><Icon name="check" size={13} color="var(--ink2)" /> Aktivləşdir</>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ val, label, accent }: { val: string; label: string; accent?: string }) {
  return (
    <div style={{ background: 'var(--fill)', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ font: '700 15px/1 var(--font)', letterSpacing: '-.3px', color: accent ?? 'var(--ink2)' }}>{val}</div>
      <div style={{ font: '400 10.5px/1 var(--font)', color: 'var(--muted)', marginTop: 6 }}>{label}</div>
    </div>
  );
}
