/**
 * SPOT · comments (real, server-side).
 *
 * Comments used to live in the device's Zustand store, so «Sual ver, texnikanı
 * müzakirə et» invited the user into a conversation that reached nobody and a
 * reply could only ever answer yourself. This module is the ONLY place that
 * talks to `public.comments` / `public.comment_likes` (schema14_comments.sql):
 * everything a comment shows — its author, its like count, whether you liked it —
 * comes from a read that actually happened.
 *
 * Failure is never disguised as emptiness: every function throws, and the screen
 * decides how to say «yüklənmədi» as opposed to «hələ şərh yoxdur».
 */
import { getMyProfile } from './api';
import { supabase } from './supabase';

/** One comment as the UI needs it. `parentId === null` → top-level; otherwise a
 *  reply hanging off that comment. */
export interface Comment {
  id: string;
  parentId: string | null;
  /** profiles.id of the author — never the auth uid. */
  authorId: string;
  authorName: string;
  authorUsername: string | null;
  authorAvatar: string | null;
  body: string;
  createdAt: string; // ISO
  likes: number;
  likedByMe: boolean;
  /** True only when we know who I am AND this comment is mine. */
  mine: boolean;
}

/** Row shape returned by `comments_for(target)`. */
interface CommentRow {
  id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string | null;
  author_username: string | null;
  author_avatar: string | null;
  body: string;
  created_at: string;
  likes: number | string | null;
  liked_by_me: boolean | null;
}

/** A profile whose name never resolved has no name — we say «Silinmiş istifadəçi»
 *  rather than inventing one, because the row is real but the identity is gone. */
const UNKNOWN_AUTHOR = 'Silinmiş istifadəçi';

function toComment(r: CommentRow, myProfileId: string | null): Comment {
  return {
    id: r.id,
    parentId: r.parent_id,
    authorId: r.author_id,
    authorName: r.author_name?.trim() || UNKNOWN_AUTHOR,
    authorUsername: r.author_username ?? null,
    authorAvatar: r.author_avatar ?? null,
    body: r.body,
    createdAt: r.created_at,
    // count(*) arrives as bigint → the client may see a string.
    likes: Number(r.likes ?? 0),
    likedByMe: r.liked_by_me === true,
    mine: myProfileId != null && r.author_id === myProfileId,
  };
}

/** `avatar_url` is selected by PROFILE_COLS but absent from the DbProfile type;
 *  read it defensively instead of widening a shared interface from here. */
function avatarOf(p: unknown): string | null {
  return (p as { avatar_url?: string | null } | null)?.avatar_url ?? null;
}

/**
 * Every comment on a target, already ordered into threads by the function
 * (`coalesce(parent_id, id), created_at`) — parent first, then its replies.
 *
 * `targetKey` is the same key the client has always used: `video:<feed_videos.id>`
 * or `post:<community_posts.id>`.
 *
 * Throws on failure. It deliberately does NOT fall back to `[]`: a network error
 * and a thread nobody has written in are different facts and must read differently.
 */
export async function fetchComments(targetKey: string): Promise<Comment[]> {
  const [me, res] = await Promise.all([
    getMyProfile(),
    supabase.rpc('comments_for', { target: targetKey }),
  ]);
  if (res.error) throw res.error;
  const rows = (res.data ?? []) as CommentRow[];
  return rows.map((r) => toComment(r, me?.id ?? null));
}

/**
 * Post a comment as the signed-in user and return the row that was created, so
 * the sheet can show it immediately without a refetch — and so it shows the id
 * the server gave it, not a temporary one the UI made up.
 *
 * `parentId` must be a TOP-LEVEL comment id: SPOT keeps one level of nesting, so
 * a reply to a reply attaches to the same parent (the caller resolves that).
 * Throws when there is no profile (guest) — the caller gates with `useAuthGate`.
 */
export async function addComment(targetKey: string, body: string, parentId?: string | null): Promise<Comment> {
  const text = body.trim();
  if (!text) throw new Error('empty comment');

  const me = await getMyProfile();
  if (!me) throw new Error('no profile');

  const { data, error } = await supabase
    .from('comments')
    .insert({
      target_key: targetKey,
      parent_id: parentId ?? null,
      author_id: me.id, // profiles.id — never the auth uid
      body: text,
    })
    .select('id,parent_id,author_id,body,created_at')
    .single();
  if (error) throw error;

  const row = data as { id: string; parent_id: string | null; author_id: string; body: string; created_at: string };
  return {
    id: row.id,
    parentId: row.parent_id,
    authorId: row.author_id,
    authorName: me.name?.trim() || UNKNOWN_AUTHOR,
    authorUsername: me.username ?? null,
    authorAvatar: avatarOf(me),
    body: row.body,
    createdAt: row.created_at,
    // Nobody has had the chance to like it yet — this is a fact, not a guess.
    likes: 0,
    likedByMe: false,
    mine: true,
  };
}

/** Delete a comment. RLS allows it for its author and for the author of the
 *  video/post it sits on; anyone else gets 0 rows deleted, not an error, so the
 *  caller should refetch rather than assume the list changed. */
export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Apply a like state to a comment. `liked` is the state to END UP IN:
 * `true` → the row exists, `false` → it does not. Idempotent on purpose, so a
 * double tap cannot leave the count disagreeing with the button.
 */
export async function toggleCommentLike(commentId: string, liked: boolean): Promise<void> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');

  if (liked) {
    const { error } = await supabase
      .from('comment_likes')
      .upsert({ comment_id: commentId, profile_id: me.id }, { onConflict: 'comment_id,profile_id' });
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('comment_likes')
    .delete()
    .eq('comment_id', commentId)
    .eq('profile_id', me.id);
  if (error) throw error;
}

// ------------------------------------------------------------------ @mentions

export interface Handle {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

/** Profiles for the @mention picker. Only rows that HAVE a username come back —
 *  a person you cannot @ is not offered. A leading «@» the user typed is stripped. */
export async function searchHandles(q: string): Promise<Handle[]> {
  const query = q.trim().replace(/^@+/, '');
  const { data, error } = await supabase.rpc('search_handles', { q: query, max_rows: 8 });
  if (error) throw error;
  const rows = (data ?? []) as { id: string; name: string | null; username: string; avatar_url: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name?.trim() || r.username,
    username: r.username,
    avatarUrl: r.avatar_url ?? null,
  }));
}

/** A handle is «@» + the characters `profiles.username` is allowed to contain
 *  (DB constraint: `[A-Za-z0-9_]{3,20}`). Exported for rendering — use it with
 *  `split`/`replace`, which reset `lastIndex`; `parseMentions` keeps its own copy
 *  so a shared global regex cannot carry state between calls. */
export const MENTION_RE = /@([A-Za-z0-9_]{3,20})/g;

/** The usernames a comment body references, in order, without duplicates and
 *  without the «@». Pure — it reports what is written, nothing more. */
export function parseMentions(body: string): string[] {
  const re = new RegExp(MENTION_RE.source, 'g');
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const u = m[1];
    const key = u.toLowerCase(); // usernames are unique case-insensitively
    if (!seen.has(key)) {
      seen.add(key);
      out.push(u);
    }
  }
  return out;
}
