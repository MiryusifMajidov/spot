/**
 * Notifications.
 *
 * Every row is written by a database trigger on the event it describes
 * (schema35) — a comment like, a request, a reply. The client has no INSERT
 * grant at all, so nothing here can announce something that did not happen, and
 * nobody can put a notification in somebody else's list.
 *
 * The switches live on `profiles.notif_prefs` and are checked INSIDE the
 * triggers, so a type that is off is never recorded rather than recorded and
 * hidden. Off means the app stopped keeping it.
 */
import { getMyProfile } from './api';
import { supabase } from './supabase';

/**
 * Every type the DATABASE can write.
 *
 * This list had eight entries while the `notifications_type_check` constraint
 * accepted twelve: schema42 added `message` and schema43 added `video_like`,
 * `post_like` and `follow`, and neither updated the client. The inbox looked
 * each row's type up in a Record with eight keys and read `.name` off the
 * result, so the first message anyone received crashed the screen on open.
 *
 * Keep this in step with the CHECK constraint on `public.notifications.type`.
 */
export type NotifType =
  | 'comment_like'
  | 'comment_reply'
  | 'mention'
  | 'match_request'
  | 'match_accepted'
  | 'trainer_request'
  | 'trainer_decided'
  | 'review_reply'
  | 'message'
  | 'video_like'
  | 'post_like'
  | 'follow';

/** The types, in the order the settings screen lists them. */
export const NOTIF_TYPES: { type: NotifType; label: string; hint: string }[] = [
  { type: 'comment_like', label: 'Şərhimi bəyənəndə', hint: 'Kimsə yazdığın şərhi bəyənir' },
  { type: 'comment_reply', label: 'Şərhimə cavab', hint: 'Kimsə şərhinin altına yazır' },
  { type: 'mention', label: 'Məni etiketləyəndə', hint: '@adınla çəkilirsən' },
  { type: 'match_request', label: 'Yoldaş təklifi', hint: 'Kimsə səninlə məşq etmək istəyir' },
  { type: 'match_accepted', label: 'Təklifim qəbul edildi', hint: 'Göndərdiyin təklifə cavab gəlir' },
  { type: 'trainer_request', label: 'Şagird sorğusu', hint: 'Kimsə səninlə işləmək istəyir (müəllim)' },
  { type: 'trainer_decided', label: 'Müəllim cavab verdi', hint: 'Göndərdiyin sorğuya cavab gəlir' },
  { type: 'review_reply', label: 'Rəyimə cavab', hint: 'Zal yazdığın rəyə cavab verir' },
  { type: 'message', label: 'Yeni mesaj', hint: 'Yoldaşın sənə yazır' },
  { type: 'video_like', label: 'Videomu bəyənəndə', hint: 'Kimsə paylaşdığın videonu bəyənir' },
  { type: 'post_like', label: 'Postumu bəyənəndə', hint: 'Kimsə postunu bəyənir' },
  { type: 'follow', label: 'Yeni izləyici', hint: 'Kimsə səni izləməyə başlayır' },
];

export interface NotifRow {
  id: string;
  type: NotifType;
  /** The other person, when there is one. Null when the account was deleted. */
  actorName: string | null;
  actorId: string | null;
  targetKey: string | null;
  entityId: string | null;
  read: boolean;
  createdAt: string;
}

interface RawNotif {
  id: string;
  type: NotifType;
  actor_id: string | null;
  target_key: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** The inbox, newest first. Throws on a real failure — «bildiriş yoxdur» must
 *  never be printed over a read that did not happen. */
export async function getNotifications(limit = 50): Promise<NotifRow[]> {
  const me = await getMyProfile();
  if (!me) return [];
  const { data, error } = await supabase
    .from('notifications')
    .select('id,type,actor_id,target_key,entity_id,read_at,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as RawNotif[];
  if (!rows.length) return [];

  // One extra read for the actors' names — a notification with a bare uuid in it
  // is unreadable, and guessing a name is not an option.
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id,name').in('id', ids);
    for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
      if (p.name) names.set(p.id, p.name);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actorId: r.actor_id,
    actorName: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
    targetKey: r.target_key,
    entityId: r.entity_id,
    read: !!r.read_at,
    createdAt: r.created_at,
  }));
}

/** How many are unread. `null` means we could not ask — the badge then shows
 *  nothing rather than a confident zero. */
export async function getUnreadCount(): Promise<number | null> {
  const me = await getMyProfile();
  if (!me) return null;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) return null;
  return count ?? 0;
}

/** Mark one, or everything, as read. Verified: an RLS-filtered UPDATE returns
 *  `error: null` with zero rows. */
export async function markRead(id?: string): Promise<void> {
  const me = await getMyProfile();
  if (!me) return;
  let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (id) q = q.eq('id', id);
  const { error } = await q.select('id');
  if (error) throw error;
}

export async function deleteNotification(id: string): Promise<void> {
  const { data, error } = await supabase.from('notifications').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('not-deleted');
}

// ------------------------------------------------------------------ settings
/** A MISSING key means ON — a type added later must not arrive switched off for
 *  everyone who registered before it existed. */
export async function getNotifPrefs(): Promise<Record<string, boolean>> {
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return {};
  const { data, error } = await supabase.from('profiles').select('notif_prefs').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return ((data as { notif_prefs?: Record<string, boolean> } | null)?.notif_prefs ?? {}) as Record<string, boolean>;
}

export async function setNotifPref(type: NotifType, on: boolean): Promise<void> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');
  const prefs = await getNotifPrefs();
  const next = { ...prefs, [type]: on };
  const { data, error } = await supabase
    .from('profiles')
    .update({ notif_prefs: next })
    .eq('id', me.id)
    .select('id');
  if (error) throw error;
  // The switch must not slide back on its own: if the row did not change, the
  // caller has to know the setting was not saved.
  if (!data?.length) throw new Error('pref-not-saved');
}

// ------------------------------------------------------------------ wording
/** One line, in Azerbaijani, naming who did what. The actor's name is used only
 *  when we actually read it; «Kimsə» is the honest stand-in, never a guess. */
export function notifText(n: NotifRow): string {
  const who = n.actorName?.trim() || 'Kimsə';
  switch (n.type) {
    case 'comment_like': return `${who} şərhini bəyəndi`;
    case 'comment_reply': return `${who} şərhinə cavab yazdı`;
    case 'mention': return `${who} səni şərhdə etiketlədi`;
    case 'match_request': return `${who} səninlə məşq etmək istəyir`;
    case 'match_accepted': return `${who} təklifini qəbul etdi`;
    case 'trainer_request': return `${who} şagirdin olmaq istəyir`;
    case 'trainer_decided': return `${who} sorğuna cavab verdi`;
    case 'review_reply': return `${who} rəyinə cavab yazdı`;
    case 'message': return `${who} sənə mesaj yazdı`;
    case 'video_like': return `${who} videonu bəyəndi`;
    case 'post_like': return `${who} postunu bəyəndi`;
    case 'follow': return `${who} səni izləməyə başladı`;
    default:
      // A type this build does not know about — a newer trigger against an older
      // app. It is still a real event, so it is shown plainly rather than hidden
      // or crashed on.
      return `${who} səninlə bağlı bir hərəkət etdi`;
  }
}

/** Where tapping it should go, or null when there is nothing to open. */
export function notifTarget(
  n: NotifRow
): { kind: 'comments'; key: string } | { kind: 'requests' } | { kind: 'chat'; profileId: string } | { kind: 'profile'; profileId: string } | null {
  switch (n.type) {
    case 'comment_like':
    case 'comment_reply':
    case 'mention':
      return n.targetKey ? { kind: 'comments', key: n.targetKey } : null;
    case 'match_request':
    case 'match_accepted':
    case 'trainer_request':
    case 'trainer_decided':
      return { kind: 'requests' };
    case 'message':
      return n.actorId ? { kind: 'chat', profileId: n.actorId } : null;
    case 'follow':
      return n.actorId ? { kind: 'profile', profileId: n.actorId } : null;
    case 'video_like':
    case 'post_like':
      // The like is on my own content; there is no useful second screen for it.
      return null;
    default:
      return null;
  }
}
