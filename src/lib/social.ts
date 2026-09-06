/**
 * Likes, follows and challenge participation — on the server (F-19, schema43).
 *
 * These all used to live in `useAppStore`: `likedPosts`, `savedVideos`,
 * `following` and `joinedChallenges`. So an author never learned that anyone
 * liked their video, «İzlənir» changed nothing for anybody, a challenge could
 * not have a participant count, and `following` was keyed by the author's NAME —
 * two people called «Yusif» followed each other, and a rename broke the link.
 *
 * The counters (`feed_videos.likes`, `community_posts.likes`,
 * `challenges.participants`) are withheld from clients and maintained by
 * triggers, so nothing here writes a number: it writes the fact, and the number
 * follows.
 *
 * The device list stays as an instant-feedback cache. The server row is what
 * makes it real, so every call reports failure rather than leaving a heart
 * filled in over a like nobody received.
 */
import { getMyProfile } from './api';
import { supabase } from './supabase';

async function myId(): Promise<string> {
  const me = await getMyProfile();
  if (!me?.id) throw new Error('no profile');
  return me.id;
}

// ------------------------------------------------------------------- videos
export async function likeVideo(videoId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase.from('video_likes').insert({ video_id: videoId, profile_id: me });
  // Already liked is the desired end state, not a failure.
  if (error && !String(error.message ?? '').includes('duplicate')) throw error;
}

export async function unlikeVideo(videoId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase
    .from('video_likes').delete().eq('video_id', videoId).eq('profile_id', me);
  if (error) throw error;
}

/** Which of these videos I have liked. One query, not one per row. */
export async function myVideoLikes(videoIds: string[]): Promise<Set<string>> {
  const me = await getMyProfile();
  if (!me?.id || !videoIds.length) return new Set();
  const { data, error } = await supabase
    .from('video_likes').select('video_id').eq('profile_id', me.id).in('video_id', videoIds);
  if (error) throw error;
  return new Set(((data ?? []) as { video_id: string }[]).map((r) => r.video_id));
}

// -------------------------------------------------------------------- posts
export async function likePost(postId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase.from('post_likes').insert({ post_id: postId, profile_id: me });
  if (error && !String(error.message ?? '').includes('duplicate')) throw error;
}

export async function unlikePost(postId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase
    .from('post_likes').delete().eq('post_id', postId).eq('profile_id', me);
  if (error) throw error;
}

export async function myPostLikes(postIds: string[]): Promise<Set<string>> {
  const me = await getMyProfile();
  if (!me?.id || !postIds.length) return new Set();
  const { data, error } = await supabase
    .from('post_likes').select('post_id').eq('profile_id', me.id).in('post_id', postIds);
  if (error) throw error;
  return new Set(((data ?? []) as { post_id: string }[]).map((r) => r.post_id));
}

// ------------------------------------------------------------------ follows
/** Follow BY PROFILE ID. The old store keyed this by display name. */
export async function followProfile(profileId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase.from('follows').insert({ follower_id: me, followee_id: profileId });
  if (error && !String(error.message ?? '').includes('duplicate')) throw error;
}

export async function unfollowProfile(profileId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase
    .from('follows').delete().eq('follower_id', me).eq('followee_id', profileId);
  if (error) throw error;
}

export async function myFollowing(): Promise<Set<string>> {
  const me = await getMyProfile();
  if (!me?.id) return new Set();
  const { data, error } = await supabase.from('follows').select('followee_id').eq('follower_id', me.id);
  if (error) throw error;
  return new Set(((data ?? []) as { followee_id: string }[]).map((r) => r.followee_id));
}

/** How many people follow this profile, and how many it follows. */
export async function followCounts(profileId: string): Promise<{ followers: number; following: number }> {
  const [a, b] = await Promise.all([
    supabase.from('follows').select('followee_id', { count: 'exact', head: true }).eq('followee_id', profileId),
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('follower_id', profileId),
  ]);
  return { followers: a.count ?? 0, following: b.count ?? 0 };
}

// --------------------------------------------------------------- challenges
export async function joinChallenge(challengeId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase
    .from('challenge_members').insert({ challenge_id: challengeId, profile_id: me });
  if (error && !String(error.message ?? '').includes('duplicate')) throw error;
}

export async function leaveChallenge(challengeId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase
    .from('challenge_members').delete().eq('challenge_id', challengeId).eq('profile_id', me);
  if (error) throw error;
}

export async function myChallenges(): Promise<Set<string>> {
  const me = await getMyProfile();
  if (!me?.id) return new Set();
  const { data, error } = await supabase
    .from('challenge_members').select('challenge_id').eq('profile_id', me.id);
  if (error) throw error;
  return new Set(((data ?? []) as { challenge_id: string }[]).map((r) => r.challenge_id));
}

// -------------------------------------------------------------------- saves
/**
 * Saving a video. Until schema45 this lived only in `useAppStore.savedVideos`,
 * so it survived nothing: reinstall the app and your shelf was empty, and the
 * author could never know a clip was worth keeping.
 *
 * WHO SEES IT. Your saves are yours — `video_saves` is readable only as
 * yourself, so nobody can page through what you bookmarked. The author gets the
 * COUNT and no names, and only the author: that is Instagram's shape, and a
 * public save count would turn a private bookmark into a broadcast.
 */
export async function saveVideo(videoId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase.from('video_saves').insert({ video_id: videoId, profile_id: me });
  if (error && !String(error.message ?? '').includes('duplicate')) throw error;
}

export async function unsaveVideo(videoId: string): Promise<void> {
  const me = await myId();
  const { error } = await supabase
    .from('video_saves').delete().eq('video_id', videoId).eq('profile_id', me);
  if (error) throw error;
}

/** Which of these videos I have saved. */
export async function myVideoSaves(videoIds: string[]): Promise<Set<string>> {
  const me = await getMyProfile();
  if (!me?.id || !videoIds.length) return new Set();
  const { data, error } = await supabase
    .from('video_saves').select('video_id').eq('profile_id', me.id).in('video_id', videoIds);
  if (error) throw error;
  return new Set(((data ?? []) as { video_id: string }[]).map((r) => r.video_id));
}

/**
 * How many people saved this video — author only.
 *
 * Returns `null` when the answer is not ours to know (someone else's video) AND
 * when the call fails. Both are «no number», and the caller shows nothing rather
 * than a 0 that would read as «nobody saved it».
 */
export async function videoSaveCount(videoId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('video_save_count', { v: videoId });
  if (error) return null;
  return typeof data === 'number' ? data : null;
}

/**
 * Everything this account has saved, newest first — not filtered to a list of
 * ids, because the saved shelf must show a video the feed window no longer
 * reaches. Returns null when the read fails, so the shelf can say «yüklənmədi»
 * instead of «hələ heç nə saxlamamısan».
 */
export async function allMyVideoSaves(): Promise<string[] | null> {
  const me = await getMyProfile().catch(() => null);
  if (!me?.id) return null;
  const { data, error } = await supabase
    .from('video_saves').select('video_id').eq('profile_id', me.id)
    .order('created_at', { ascending: false });
  if (error) return null;
  return ((data ?? []) as { video_id: string }[]).map((r) => r.video_id);
}
