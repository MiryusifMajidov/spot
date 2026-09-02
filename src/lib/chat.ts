/**
 * Two-sided messaging (schema42).
 *
 * Everything here talks to the server. The old path wrote into
 * `useDb.threads` (AsyncStorage) and stopped there, so a message existed only on
 * the phone that typed it — the partner flow ended with one person waiting for a
 * reply to something the other never received.
 *
 * The rules are the database's, not this file's:
 *   · a thread exists only between people with an accepted match or trainer
 *     link, and never when either has blocked the other (`open_thread`);
 *   · the sender is `sender_id`, checked against the caller — the old table's
 *     `from_me boolean` identified nobody;
 *   · «sual = 1 mesaj, cavab gələnə qədər bağlı» is a trigger.
 *
 * So this module reports what the server decided; it does not decide anything.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';

import { getMyProfile } from './api';
import { supabase } from './supabase';

export interface ChatMessageRow {
  id: string;
  threadId: string;
  senderId: string;
  /** True when this device's account wrote it — derived from ids, never stored. */
  mine: boolean;
  body: string;
  createdAt: string;
  read: boolean;
}

/** Why the server refused. Each maps to a sentence the screen can actually say. */
export type ChatRefusal =
  | 'not_signed_in'
  | 'no_relationship'
  | 'blocked'
  | 'wait_for_reply'
  | 'sanctioned'
  | 'unknown';

export class ChatError extends Error {
  constructor(readonly code: ChatRefusal, message: string) {
    super(message);
    this.name = 'ChatError';
  }
}

function refusalOf(message: string): ChatRefusal {
  const m = message.toLowerCase();
  if (m.includes('no_relationship')) return 'no_relationship';
  if (m.includes('blocked')) return 'blocked';
  if (m.includes('wait_for_reply')) return 'wait_for_reply';
  if (m.includes('not_signed_in')) return 'not_signed_in';
  if (m.includes('row-level security') || m.includes('violates')) return 'sanctioned';
  return 'unknown';
}

export function chatRefusalText(code: ChatRefusal): string {
  switch (code) {
    case 'no_relationship':
      return 'Söhbət yalnız təklif qəbul ediləndən sonra açılır.';
    case 'blocked':
      return 'Bu adamla yazışmaq mümkün deyil.';
    case 'wait_for_reply':
      return 'Bir mesaj göndərdin — cavab gələnə qədər ikincisini göndərmək olmur.';
    case 'sanctioned':
      return 'Hesabına məhdudiyyət qoyulub — mesaj göndərə bilmirsən.';
    case 'not_signed_in':
      return 'Profil tapılmadı — mesaj göndərmək üçün profilini tamamla.';
    default:
      return 'Mesaj göndərilmədi.';
  }
}

/** Open (or find) the thread with someone. Throws a `ChatError` on refusal. */
export async function openThread(otherProfileId: string): Promise<string> {
  const { data, error } = await supabase.rpc('open_thread', { other: otherProfileId });
  if (error) throw new ChatError(refusalOf(String(error.message ?? '')), String(error.message ?? ''));
  if (!data) throw new ChatError('unknown', 'no thread id');
  return data as string;
}

/** The thread with someone, WITHOUT creating one. `null` = none yet. */
export async function findThread(otherProfileId: string): Promise<string | null> {
  const me = await getMyProfile();
  if (!me?.id) return null;
  const [lo, hi] = me.id < otherProfileId ? [me.id, otherProfileId] : [otherProfileId, me.id];
  const { data, error } = await supabase
    .from('chat_threads')
    .select('id')
    .eq('a_profile', lo)
    .eq('b_profile', hi)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

export async function getMessages(threadId: string): Promise<ChatMessageRow[]> {
  const me = await getMyProfile();
  const { data, error } = await supabase
    .from('messages')
    .select('id,thread_id,sender_id,body,created_at,read_at')
    .eq('thread_id', threadId)
    .order('created_at');
  if (error) throw error;
  return ((data ?? []) as {
    id: string; thread_id: string; sender_id: string; body: string; created_at: string; read_at: string | null;
  }[]).map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    senderId: r.sender_id,
    mine: !!me?.id && r.sender_id === me.id,
    body: r.body,
    createdAt: r.created_at,
    read: !!r.read_at,
  }));
}

/** Send. The returned row is the proof it landed — an RLS refusal returns no row. */
export async function sendMessage(threadId: string, body: string): Promise<ChatMessageRow> {
  const me = await getMyProfile();
  if (!me?.id) throw new ChatError('not_signed_in', 'no profile');
  const { data, error } = await supabase
    .from('messages')
    .insert({ thread_id: threadId, sender_id: me.id, body: body.trim() })
    .select('id,thread_id,sender_id,body,created_at,read_at')
    .single();
  if (error) throw new ChatError(refusalOf(String(error.message ?? '')), String(error.message ?? ''));
  return {
    id: data.id, threadId: data.thread_id, senderId: data.sender_id, mine: true,
    body: data.body, createdAt: data.created_at, read: !!data.read_at,
  };
}

/** Mark everything the OTHER person sent as read. RLS allows nothing else. */
export async function markThreadRead(threadId: string): Promise<void> {
  const me = await getMyProfile();
  if (!me?.id) return;
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .neq('sender_id', me.id)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Live updates for one thread. Returns an unsubscribe function.
 *
 * Without this the recipient only sees a message when they reopen the screen —
 * which is how the old local-only chat felt even when it «worked».
 */
export function subscribeToThread(threadId: string, onInsert: (m: ChatMessageRow) => void): () => void {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  void getMyProfile().then((me) => {
    if (cancelled) return;
    channel = supabase
      .channel(`thread:${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const r = payload.new as {
            id: string; thread_id: string; sender_id: string; body: string; created_at: string; read_at: string | null;
          };
          onInsert({
            id: r.id, threadId: r.thread_id, senderId: r.sender_id,
            mine: !!me?.id && r.sender_id === me.id,
            body: r.body, createdAt: r.created_at, read: !!r.read_at,
          });
        }
      )
      .subscribe();
  });

  return () => {
    cancelled = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

export interface ThreadSummary {
  threadId: string;
  otherProfileId: string;
  otherName: string | null;
  lastBody: string | null;
  lastAt: string | null;
  lastMine: boolean;
  unread: number;
}

/** Every thread I am in, newest activity first — the real inbox. */
export async function getMyThreads(): Promise<ThreadSummary[]> {
  const me = await getMyProfile();
  if (!me?.id) return [];
  const { data: threads, error } = await supabase
    .from('chat_threads')
    .select('id,a_profile,b_profile');
  if (error) throw error;
  const rows = (threads ?? []) as { id: string; a_profile: string; b_profile: string }[];
  if (!rows.length) return [];

  const otherOf = new Map(rows.map((t) => [t.id, t.a_profile === me.id ? t.b_profile : t.a_profile]));

  const [{ data: msgs, error: mErr }, { data: profs }] = await Promise.all([
    supabase
      .from('messages')
      .select('thread_id,sender_id,body,created_at,read_at')
      .in('thread_id', rows.map((t) => t.id))
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('id,name').in('id', [...otherOf.values()]),
  ]);
  if (mErr) throw mErr;

  const names = new Map(((profs ?? []) as { id: string; name: string | null }[]).map((p) => [p.id, p.name]));
  const last = new Map<string, { body: string; at: string; mine: boolean }>();
  const unread = new Map<string, number>();
  for (const m of (msgs ?? []) as { thread_id: string; sender_id: string; body: string; created_at: string; read_at: string | null }[]) {
    if (!last.has(m.thread_id)) {
      last.set(m.thread_id, { body: m.body, at: m.created_at, mine: m.sender_id === me.id });
    }
    if (!m.read_at && m.sender_id !== me.id) unread.set(m.thread_id, (unread.get(m.thread_id) ?? 0) + 1);
  }

  return rows
    .map((t) => {
      const other = otherOf.get(t.id)!;
      const l = last.get(t.id);
      return {
        threadId: t.id,
        otherProfileId: other,
        otherName: names.get(other) ?? null,
        lastBody: l?.body ?? null,
        lastAt: l?.at ?? null,
        lastMine: l?.mine ?? false,
        unread: unread.get(t.id) ?? 0,
      };
    })
    .sort((x, y) => (y.lastAt ?? '').localeCompare(x.lastAt ?? ''));
}
