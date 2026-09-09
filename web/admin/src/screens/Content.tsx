import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '../lib/supabase';
import { audit } from '../lib/audit';
import { toast } from '../ui/toast';
import { useAuth, atLeast } from '../lib/auth';
import { Icon } from '../ui/icons';
import type { CommunityPost, FeedVideo } from '../lib/types';
import type { ScreenProps } from '../App';

// programs is a public catalog table (not moderation-specific), so it has no
// entry in lib/types — model just the columns this screen reads.
interface Program {
  id: string;
  title: string;
  creator_name: string | null;
  creator_type: string | null;
  creator_verified: boolean | null;
  level: string | null;
  goal: string | null;
  paid: boolean | null;
  price: number | null;
  days_per_week: number | null;
  video_count: number | null;
  hidden_at?: string | null;
}

/** The three tables this screen can take content down from. */
type ContentTable = 'programs' | 'feed_videos' | 'community_posts';

// The 6 standard reject templates from the design — offered as quick picks in
// the remove-reason modal and listed in the rules card.
const TEMPLATES: { n: string; text: string }[] = [
  { n: '#1', text: 'Hərəkətdə video yoxdur' },
  { n: '#2', text: 'Video keyfiyyəti / bucaq forma göstərmir' },
  { n: '#3', text: 'Set/təkrar sxemi təhlükəlidir (həddindən artıq həcm)' },
  { n: '#4', text: 'Qeyri-real nəticə vədi və ya sağlamlıq riski' },
  { n: '#5', text: 'Ödənişli proqram, amma müəllim doğrulanmayıb' },
  { n: '#6', text: 'Başqasının məzmununun kopyası' },
];

type Tab = 'programs' | 'feed';

// One unified feed row: a feed_videos row or a community_posts row.
type FeedItem =
  | { kind: 'video'; id: string; author: string; verified: boolean; is_trainer: boolean; text: string; likes: number; comments: number; noVideo: boolean; stale: boolean }
  | { kind: 'post'; id: string; author: string; gym: string | null; text: string; likes: number; comments: number; stale: boolean };

interface RemoveTarget { targetId: string; label: string; table: ContentTable }

const creatorLabel = (t: string | null) => (t === 'trainer' ? 'MÜƏLLİM' : 'İSTİFADƏÇİ');

export function Content({ search, refreshCounts }: ScreenProps) {
  const { admin } = useAuth();
  const canModerate = atLeast(admin?.role, 'moderator');

  const [tab, setTab] = useState<Tab>('programs');
  const [loading, setLoading] = useState(true);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [videos, setVideos] = useState<FeedVideo[]>([]);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  // Ids with a logged `content_remove` action. This is NOT the same thing as
  // being taken down: rows removed before the takedown wrote `hidden_at` are
  // still live in the app, so they stay listed here with a warning instead of
  // being filtered away where no moderator could ever notice them again.
  const [loggedRemoved, setLoggedRemoved] = useState<Set<string>>(new Set());

  // remove-reason modal
  const [target, setTarget] = useState<RemoveTarget | null>(null);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState('');
  const [tpl, setTpl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    const [p, v, c, m] = await Promise.all([
      supabase.from('programs').select('*').order('title'),
      supabase.from('feed_videos').select('*').order('ord'),
      supabase.from('community_posts').select('*').order('created_at', { ascending: false }),
      // which content ids were already removed (moderator+ can read; ignore on error)
      supabase.from('moderation_actions').select('target_id').eq('target_type', 'content').eq('action', 'content_remove'),
    ]);
    // «Yoxlanılacaq proqram yoxdur» is a statement about the platform's content.
    // It may only be made after a read that landed.
    setFailed(!!p.error || !!v.error || !!c.error);
    setPrograms((p.data as Program[]) ?? []);
    setVideos((v.data as FeedVideo[]) ?? []);
    setPosts((c.data as CommunityPost[]) ?? []);
    const rows = (m.data as { target_id: string }[] | null) ?? [];
    setLoggedRemoved(new Set(rows.map((r) => r.target_id)));
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = search.trim().toLowerCase();

  // Only a real takedown (`hidden_at`) removes a row from the queue.
  const visiblePrograms = useMemo(
    () =>
      programs
        .filter((p) => !p.hidden_at)
        .filter((p) => !q || p.title.toLowerCase().includes(q) || (p.creator_name ?? '').toLowerCase().includes(q)),
    [programs, q],
  );

  const feedItems = useMemo<FeedItem[]>(() => {
    const vids: FeedItem[] = videos
      .filter((v) => !v.hidden_at)
      .map((v) => ({
        kind: 'video',
        id: v.id,
        author: v.author,
        verified: v.verified,
        is_trainer: v.is_trainer,
        text: v.caption,
        likes: v.likes,
        comments: v.comments,
        noVideo: !v.video_url,
        stale: loggedRemoved.has(v.id),
      }));
    const pst: FeedItem[] = posts
      .filter((p) => !p.hidden_at)
      .map((p) => ({ kind: 'post', id: p.id, author: p.author, gym: p.gym, text: p.body, likes: p.likes, comments: p.comments, stale: loggedRemoved.has(p.id) }));
    const all = [...vids, ...pst].filter(
      (i) => !q || i.author.toLowerCase().includes(q) || i.text.toLowerCase().includes(q),
    );
    // videosuz feed_videos float to the very top (priority for moderation)
    return all.sort((a, b) => {
      const av = a.kind === 'video' && a.noVideo ? 1 : 0;
      const bv = b.kind === 'video' && b.noVideo ? 1 : 0;
      return bv - av;
    });
  }, [videos, posts, loggedRemoved, q]);

  function askRemove(t: RemoveTarget) {
    setTarget(t);
    setReason('');
    setTpl(null);
  }

  async function confirmRemove() {
    if (!target || !reason.trim() || saving) return;
    setSaving(true);
    const why = reason.trim();

    // 1. Take the content down FIRST. Writing only an audit row and toasting
    //    «Məzmun silindi» left the post, video or program live in the app
    //    forever — the log is the record of a takedown, not the takedown.
    //    `.select('id')` is mandatory: an RLS-filtered UPDATE returns
    //    `error: null` with zero rows changed.
    /* One audited path for all three tables (schema64). `programs.hidden_at` had
       no UPDATE grant at all, so an abusive program could never be taken down;
       and it could not simply be granted, because `programs` — unlike
       feed_videos and community_posts — has an OWNER update policy, so the
       author would have been able to un-hide their own moderated program. The
       RPC checks the admin role, writes the row and writes the audit entry. */
    const { error: hErr } = await supabase.rpc('admin_set_content_hidden', {
      p_table: target.table,
      p_id: target.targetId,
      p_hidden: true,
      p_reason: why,
    });
    if (hErr) {
      setSaving(false);
      toast('Məzmun silinmədi: ' + hErr.message + '. Məzmun hələ də canlıdır');
      return;
    }

    // 2. Only a real takedown gets logged.
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('moderation_actions').insert({
      admin_id: u.user?.id,
      target_type: 'content',
      target_id: target.targetId,
      action: 'content_remove',
      reason: why,
    });
    const auditErr = error ? null : await audit('content_remove', 'content', target.targetId, why, { label: target.label, table: target.table });
    setSaving(false);
    if (error) toast('Məzmun silindi, amma moderasiya qeydi yazılmadı: ' + error.message);
    else if (auditErr) toast('Məzmun silindi, amma audit qeydi yazılmadı: ' + auditErr);
    else toast('Məzmun silindi');
    setTarget(null);
    refreshCounts();
    loadData();
  }

  return (
    <>
      {/* ── Tabs ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--fill)', borderRadius: 9, padding: 2 }}>
          <Seg active={tab === 'programs'} onClick={() => setTab('programs')}>Proqramlar {programs.length ? programs.length : ''}</Seg>
          <Seg active={tab === 'feed'} onClick={() => setTab('feed')}>Feed {videos.length + posts.length ? videos.length + posts.length : ''}</Seg>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, alignItems: 'start' }}>
        {/* ── Left: content list ── */}
        <div>
          {tab === 'programs' ? (
            <div style={{ background: 'rgba(255,149,0,.1)', border: '1px solid rgba(255,149,0,.3)', borderRadius: 12, padding: '13px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 11 }}>
              <Icon name="clock" size={17} color="var(--orange-deep)" />
              <div style={{ font: '500 12.5px/1.4 var(--font)', color: 'var(--orange-deep)' }}>
                Moderasiya qaydası: proqram 24 saat içində yoxlanılmalıdır. Yoxlanılana qədər yalnız müəllif görür.
              </div>
            </div>
          ) : (
            <div style={{ background: 'rgba(255,149,0,.1)', border: '1px solid rgba(255,149,0,.3)', borderRadius: 12, padding: '13px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 11 }}>
              <Icon name="play" size={17} color="var(--orange-deep)" />
              <div style={{ font: '500 12.5px/1.4 var(--font)', color: 'var(--orange-deep)' }}>
                Videosuz hərəkətlər öndə göstərilir — prioritet moderasiya üçün.
              </div>
            </div>
          )}

          {loading ? (
            <div className="spinner" />
          ) : tab === 'programs' ? (
            visiblePrograms.length === 0 ? (
              <div className="card"><div className="empty">{failed ? 'Proqramlar yüklənmədi — bu «yoxdur» demək DEYİL. Səhifəni yenilə.' : 'Yoxlanılacaq proqram yoxdur'}</div></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {visiblePrograms.map((p) => (
                  <ProgramCard key={p.id} p={p} stale={loggedRemoved.has(p.id)} canModerate={canModerate} onRemove={() => askRemove({ targetId: p.id, label: p.title, table: 'programs' })} />
                ))}
              </div>
            )
          ) : feedItems.length === 0 ? (
            <div className="card"><div className="empty">{failed ? 'Feed məzmunu yüklənmədi — bu «yoxdur» demək DEYİL. Səhifəni yenilə.' : 'Feed məzmunu yoxdur'}</div></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {feedItems.map((i) => (
                <FeedCard key={i.kind + i.id} item={i} canModerate={canModerate} onRemove={() => askRemove({ targetId: i.id, label: i.text.slice(0, 60) || i.author, table: i.kind === 'video' ? 'feed_videos' : 'community_posts' })} />
              ))}
            </div>
          )}
        </div>

        {/* ── Right: auto-check hint + reject templates ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ font: '600 14px/1 var(--font)', marginBottom: 13 }}>3 avtomatik yoxlama</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {['Video tamlığı — hər hərəkətin videosu var', 'Set məntiqi — set/təkrar sxemi təhlükəsiz', 'Mətn qaydaları — iddia və başlıq qaydalara uyğun'].map((t) => (
                <div key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <Icon name="check" size={14} color="var(--green)" />
                  <div style={{ font: '500 12px/1.4 var(--font)', color: 'var(--text3)' }}>{t}</div>
                </div>
              ))}
            </div>
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'var(--muted)', marginTop: 13 }}>
              Moderator qərar vermir, yoxlayır: sistem hər proqram üçün bu 3 yoxlamanı aparıb problemi öncədən yazır.
            </div>
          </div>

          <div style={{ background: 'var(--ink)', borderRadius: 14, padding: 18, color: '#fff' }}>
            <div style={{ font: '600 14px/1 var(--font)', marginBottom: 13 }}>Məzmun qaydaları · rədd şablonları</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {TEMPLATES.map((t) => (
                <div key={t.n} style={{ font: '400 12.5px/1.5 var(--font)', color: 'rgba(255,255,255,.65)' }}>
                  <b style={{ color: '#fff' }}>{t.n}</b> {t.text}
                </div>
              ))}
            </div>
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'rgba(255,255,255,.4)', marginTop: 13 }}>
              Şablon seçilir → səbəb audit-ə yazılır → məzmun dərhal gizlədilir → müəllif düzəldib təkrar göndərə bilər.
            </div>
            <div style={{ font: '400 11.5px/1.5 var(--font)', color: 'rgba(255,255,255,.4)', marginTop: 9 }}>
              Proqramın qiyməti yalnız məlumat üçün göstərilir. SPOT heç bir ödəniş qəbul etmir və komissiya götürmür —
              ödəniş varsa, istifadəçi ilə müəllif arasında birbaşa həll olunur.
            </div>
          </div>
        </div>
      </div>

      {/* ── Remove-reason modal ── */}
      {target ? (
        <div className="scrim" onClick={() => !saving && setTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ font: '700 16.5px/1.2 var(--font)', marginBottom: 6 }}>Məzmunu sil</div>
            <div style={{ font: '400 13px/1.4 var(--font)', color: 'var(--muted2)', marginBottom: 16 }}>
              «{target.label}» — məzmun dərhal tətbiqdən gizlədiləcək və səbəb audit jurnalına yazılacaq.
              Şablon seç və ya öz səbəbini yaz.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.n}
                  className={'chip' + (tpl === t.n ? ' active' : '')}
                  onClick={() => { setTpl(t.n); setReason(`${t.n} ${t.text}`); }}
                >
                  {t.n}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setTpl(null); }}
              placeholder="Silmə səbəbi (məcburi)…"
              rows={3}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', font: '400 13.5px/1.45 var(--font)', color: 'var(--ink2)', resize: 'vertical', outline: 'none' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button className="btn" onClick={() => setTarget(null)} disabled={saving}>Ləğv et</button>
              <button className="btn danger" onClick={confirmRemove} disabled={!reason.trim() || saving}>
                {saving ? 'Silinir…' : 'Sil'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 14px', borderRadius: 7, border: 'none',
        background: active ? '#fff' : 'transparent',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
        font: `${active ? 600 : 500} 12.5px/1 var(--font)`,
        color: active ? 'var(--ink2)' : 'var(--muted2)',
      }}
    >
      {children}
    </button>
  );
}

function ProgramCard({ p, stale, canModerate, onRemove }: { p: Program; stale: boolean; canModerate: boolean; onRemove: () => void }) {
  const paid = !!p.paid && !!p.price;
  const meta = [p.creator_name || 'Naməlum', p.creator_verified ? 'doğrulanmış' : 'doğrulanmamış', `${p.video_count ?? 0} hərəkət`, p.days_per_week ? `${p.days_per_week} gün/həftə` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 96, height: 70, borderRadius: 11, background: 'linear-gradient(150deg,#D2D2D8,#EDEDF0)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="play" size={20} color="#B4B4BB" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <div style={{ font: '600 15px/1.2 var(--font)' }}>{p.title}</div>
            {p.creator_type === 'trainer' ? (
              <span className="badge blue" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="verified" size={11} color="var(--blue)" />{creatorLabel(p.creator_type)}</span>
            ) : (
              <span className="badge grey">{creatorLabel(p.creator_type)}</span>
            )}
            {paid ? (
              <span className="badge" style={{ background: 'var(--ink)', color: 'var(--volt)' }}>{p.price} ₼</span>
            ) : (
              <span className="badge green">PULSUZ</span>
            )}
          </div>
          <div style={{ font: '400 12.5px/1.3 var(--font)', color: 'var(--muted)', marginTop: 6 }}>{meta}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {p.level ? <span className="badge grey">{p.level}</span> : null}
            {p.goal ? <span className="badge grey">{p.goal}</span> : null}
            {stale ? <StaleFlag /> : null}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: '500 11.5px/1 var(--font)', color: 'var(--muted2)' }}>
              <Icon name="shield" size={13} color="var(--muted)" /> 3 avtomatik yoxlama
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
          {canModerate ? (
            <button className="btn danger" onClick={onRemove}><Icon name="x" size={13} color="var(--red)" /> Sil</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** An id with a logged takedown that is nevertheless still live. Shown so the
 *  moderator can retry, instead of the item silently disappearing from the
 *  panel while every user in the app keeps seeing it. */
function StaleFlag() {
  return (
    <span className="badge red" title="Əvvəllər «silindi» kimi qeyd olunub, amma məzmun hələ də canlıdır">
      SİLİNMƏYİB — TƏKRAR CƏHD ET
    </span>
  );
}

function FeedCard({ item, canModerate, onRemove }: { item: FeedItem; canModerate: boolean; onRemove: () => void }) {
  const isVideo = item.kind === 'video';
  const noVideo = isVideo && item.noVideo;
  return (
    <div className="card" style={{ padding: 16, borderColor: noVideo ? 'var(--orange)' : undefined, borderWidth: noVideo ? 1.5 : 1, borderStyle: 'solid' }}>
      <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
        <div className="avatar" style={{ width: 40, height: 40 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ font: '600 14px/1.2 var(--font)' }}>{item.author}</div>
            {isVideo && item.verified ? <Icon name="verified" size={13} color="var(--blue)" /> : null}
            {isVideo && item.is_trainer ? <span className="badge blue">MÜƏLLİM</span> : null}
            {item.kind === 'post' ? <span className="badge grey">POST</span> : <span className="badge grey">VİDEO</span>}
            {noVideo ? <span className="badge orange">VİDEOSUZ</span> : null}
            {item.stale ? <StaleFlag /> : null}
            {item.kind === 'post' && item.gym ? <span style={{ font: '400 11.5px/1 var(--font)', color: 'var(--muted)' }}>· {item.gym}</span> : null}
          </div>
          <div style={{ font: '400 13px/1.45 var(--font)', color: 'var(--text3)', marginTop: 6 }}>{item.text || '(mətn yoxdur)'}</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, font: '500 12px/1 var(--font)', color: 'var(--muted2)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="flame" size={13} color="var(--muted)" /> {item.likes}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="doc" size={13} color="var(--muted)" /> {item.comments}</span>
          </div>
        </div>
        <div style={{ flex: 'none' }}>
          {canModerate ? (
            <button className="btn danger" onClick={onRemove}><Icon name="x" size={13} color="var(--red)" /> Sil</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
