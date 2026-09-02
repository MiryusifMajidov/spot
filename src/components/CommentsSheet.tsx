import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { useAuthGate } from '@/lib/authGate';
import {
  MENTION_RE,
  addComment,
  deleteComment,
  fetchComments,
  searchHandles,
  toggleCommentLike,
  type Comment,
  type Handle,
} from '@/lib/comments';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { showModerationSheet } from '@/lib/moderation';
import { useAppStore } from '@/store/appStore';
import { timeAgoAz } from '@/store/db';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';

/** Drag further than this (or flick faster) and the sheet closes. */
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 800;

/** Instagram shows the first two replies of a thread and hides the rest behind a link. */
const REPLIES_PREVIEW = 2;

/** How long to wait after the last keystroke before asking the server for handles. */
const MENTION_DEBOUNCE = 200;

type Status = 'loading' | 'ready' | 'error';
type Thread = { root: Comment; replies: Comment[] };
type ReplyTarget = { parentId: string; name: string; handle: string | null };

/**
 * In-page comments bottom sheet (Instagram-style): slides up from the bottom over the
 * still-playing video, dims it with a backdrop but never navigates away or pauses it.
 * Kept always mounted so the close animation can play; when hidden it sits off-screen
 * with the backdrop non-interactive.
 *
 * Dragging works the way Instagram's does: the pan lives on the WHOLE panel and runs
 * simultaneously with the list's native scroll gesture. While the list is scrolled away
 * from the top the finger scrolls the list; the moment the list sits at offset 0 (or the
 * touch started on the header) a downward drag takes over and moves the sheet instead —
 * so the same continuous gesture scrolls to the top and then pulls the sheet closed.
 *
 * Comments are REAL and SHARED: they live in `public.comments` and are read through
 * `@/lib/comments`, keyed per content item — `video:<id>` / `post:<id>`. They used to
 * sit in the device's own store, which meant a comment reached nobody while the sheet
 * invited people to discuss. Now a failed read says so («Şərhlər yüklənmədi») instead
 * of pretending the thread is empty, and a failed write never clears the box.
 */
export function CommentsSheet({ visible, onClose, targetKey }: { visible: boolean; onClose: () => void; targetKey: string | null }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  /* Android edge-to-edge (the default from Expo SDK 54) means `adjustResize` does
     NOT shrink the window when the keyboard opens — the app is told about it as an
     inset instead. So the sheet has to lift itself, and `height` stays the full
     screen throughout, which at least keeps the slide-out animation stable. */
  const SHEET_H = Math.round(height * 0.72);
  const translateY = useSharedValue(SHEET_H);
  const [text, setText] = useState('');

  // ---- server state ----
  const [status, setStatus] = useState<Status>('loading');
  const [rows, setRows] = useState<Comment[]>([]);
  const [sending, setSending] = useState(false);
  /** Which threads the reader expanded past the first two replies. */
  const [openThreads, setOpenThreads] = useState<Record<string, boolean>>({});
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);

  // ---- composer / @mention state ----
  const inputRef = useRef<TextInput>(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  /** Set for exactly one render to move the caret after we rewrite the text ourselves. */
  const [forceSel, setForceSel] = useState<{ start: number; end: number } | null>(null);
  const [suggestions, setSuggestions] = useState<Handle[]>([]);

  const myName = useAppStore((s) => s.profile.name);
  const gate = useAuthGate();

  // Gesture bookkeeping (UI thread): where the list is scrolled, how tall the drag
  // handle is, and whether the current pan has taken the sheet over from the list.
  const scrollY = useSharedValue(0);
  const headerH = useSharedValue(58);
  const dragging = useSharedValue(false);
  const dragFrom = useSharedValue(0);
  const fromHeader = useSharedValue(false);

  /* The window has to outlive `visible` by one animation, or closing the sheet
     would make it vanish instantly instead of sliding away. `mounted` keeps it
     up until the slide-out has finished. */
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = SHEET_H;
      translateY.value = withTiming(0, { duration: 260 });
      return;
    }
    Keyboard.dismiss();
    translateY.value = withTiming(SHEET_H, { duration: 220 }, (done) => {
      if (done) runOnJS(setMounted)(false);
    });
  }, [visible, SHEET_H, translateY]);

  /* The raw overlap — NOT `useKeyboardLift`, which subtracts `insets.bottom` for
     surfaces that already stop short of the window edge. This sheet is mounted at
     the app root and does reach the bottom of the window, so it lifts by the whole
     overlap. The measurement itself lives in one place now. */
  const kb = useKeyboardOverlap();

  // ---------------------------------------------------------------- loading

  /** Guards against a slow answer for a thread the reader has already left. */
  const reqId = useRef(0);

  /** Returns the rows it actually got, or null when it did not get any — the caller
   *  needs that difference to know whether it may claim anything about the server. */
  const load = useCallback(
    async (silent = false): Promise<Comment[] | null> => {
      if (!targetKey) return null;
      const mine = ++reqId.current;
      if (!silent) setStatus('loading');
      try {
        const data = await fetchComments(targetKey);
        if (reqId.current !== mine) return null;
        setRows(data);
        setStatus('ready');
        return data;
      } catch {
        if (reqId.current !== mine) return null;
        /* A silent refresh keeps what is on screen — it is real, just possibly a
           moment stale. A first load has nothing real to show, so it says so. */
        if (!silent) {
          setRows([]);
          setStatus('error');
        }
        return null;
      }
    },
    [targetKey]
  );

  useEffect(() => {
    if (!visible || !targetKey) return;
    // The component never unmounts, so a new thread has to wipe the old one by hand —
    // otherwise the previous video's comments would flash under the new header.
    setRows([]);
    setOpenThreads({});
    setReplyTo(null);
    setSuggestions([]);
    setText('');
    load();
  }, [visible, targetKey, load]);

  // ------------------------------------------------------------- threading

  /* The RPC already returns rows ordered by `coalesce(parent_id, id), created_at`,
     so a parent always precedes its replies. Anything whose parent is missing
     (deleted since, or a reply to a reply) is shown as its own top-level entry
     rather than silently dropped — one level of nesting, nothing hidden. */
  const threads = useMemo<Thread[]>(() => {
    const out: Thread[] = [];
    const index = new Map<string, Thread>();
    for (const r of rows) {
      if (r.parentId) continue;
      const t: Thread = { root: r, replies: [] };
      index.set(r.id, t);
      out.push(t);
    }
    for (const r of rows) {
      if (!r.parentId) continue;
      const t = index.get(r.parentId);
      if (t) {
        t.replies.push(r);
        index.set(r.id, t); // a reply to this reply lands in the same thread
      } else {
        const orphan: Thread = { root: r, replies: [] };
        index.set(r.id, orphan);
        out.push(orphan);
      }
    }
    return out;
  }, [rows]);

  /** Handles we can resolve for certain: the authors on screen, plus everyone the
   *  mention picker has already returned. Never guessed. */
  const knownHandles = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.authorUsername) m.set(r.authorUsername.toLowerCase(), r.authorId);
    return m;
  }, [rows]);
  const learnedHandles = useRef(new Map<string, string>());

  const openHandle = async (handle: string) => {
    const key = handle.toLowerCase();
    let id = knownHandles.get(key) ?? learnedHandles.current.get(key) ?? null;
    if (!id) {
      try {
        const hits = await searchHandles(key);
        id = hits.find((h) => h.username.toLowerCase() === key)?.id ?? null;
      } catch {
        id = null;
      }
    }
    // An unresolvable handle does nothing at all — opening the wrong profile
    // would be worse than opening none.
    if (!id) return;
    onClose();
    router.push({ pathname: '/(tabs)/discover/partner/[id]', params: { id } });
  };

  // -------------------------------------------------------------- mentions

  const caret = Math.min(sel.start, text.length);
  const mention = useMemo(() => (sel.start === sel.end ? mentionToken(text, caret) : null), [text, caret, sel.start, sel.end]);
  const mentionQuery = mention && mention.q.length > 0 ? mention.q : null;

  /** Guards against an older, slower answer overwriting a newer one. */
  const suggReq = useRef(0);
  useEffect(() => {
    if (!mentionQuery) {
      setSuggestions([]);
      return;
    }
    const mine = ++suggReq.current;
    const t = setTimeout(async () => {
      try {
        const hits = await searchHandles(mentionQuery);
        if (suggReq.current !== mine) return;
        for (const h of hits) learnedHandles.current.set(h.username.toLowerCase(), h.id);
        setSuggestions(hits);
      } catch {
        // The picker is a convenience; a failed lookup just offers nothing.
        if (suggReq.current === mine) setSuggestions([]);
      }
    }, MENTION_DEBOUNCE);
    return () => clearTimeout(t);
  }, [mentionQuery]);

  const onChangeText = (next: string) => {
    /* Android does not always fire `onSelectionChange` while typing, so keep our
       own running estimate of the caret; the real event corrects it right after. */
    setSel((s) => {
      const c = Math.max(0, Math.min(next.length, s.start + (next.length - text.length)));
      return { start: c, end: c };
    });
    setText(next);
  };

  const applyHandle = (h: Handle) => {
    if (!mention) return;
    const next = `${text.slice(0, mention.start)}@${h.username} ${text.slice(mention.end)}`;
    const c = mention.start + h.username.length + 2; // '@' + handle + trailing space
    setText(next);
    setSel({ start: c, end: c });
    setForceSel({ start: c, end: c });
    setSuggestions([]);
    inputRef.current?.focus();
  };

  // ----------------------------------------------------------- interactions

  const like = (c: Comment) =>
    gate(() => {
      const next = !c.likedByMe;
      setRows((rs) => rs.map((r) => (r.id === c.id ? { ...r, likedByMe: next, likes: Math.max(0, r.likes + (next ? 1 : -1)) } : r)));
      toggleCommentLike(c.id, next).catch(() => {
        // Put the heart back where it was — the count on screen must be the count on the server.
        setRows((rs) => rs.map((r) => (r.id === c.id ? { ...r, likedByMe: !next, likes: Math.max(0, r.likes + (next ? -1 : 1)) } : r)));
        errorFeedback();
        toast(next ? 'Bəyənilmədi — yenidən cəhd et' : 'Bəyənmə geri götürülmədi — yenidən cəhd et', 'error');
      });
    }, 'Şərhi bəyənmək üçün');

  /** `parentId` is always the TOP-LEVEL comment: a reply to a reply joins the same thread. */
  const startReply = (c: Comment, parentId: string) =>
    gate(() => {
      setReplyTo({ parentId, name: c.authorName, handle: c.authorUsername });
      // Answering someone inside a thread: name them in the text, the way Instagram does,
      // so the thread still reads as a conversation once it is flattened.
      if (parentId !== c.id && c.authorUsername) {
        const pre = `@${c.authorUsername} `;
        const next = text.startsWith(pre) ? text : pre + text;
        setText(next);
        setSel({ start: next.length, end: next.length });
        setForceSel({ start: next.length, end: next.length });
      }
      inputRef.current?.focus();
    }, 'Cavab yazmaq üçün');

  const remove = async (c: Comment) => {
    const before = rows;
    setRows((rs) => rs.filter((r) => r.id !== c.id));
    try {
      await deleteComment(c.id);
    } catch {
      setRows(before);
      errorFeedback();
      toast('Şərh silinmədi — yenidən cəhd et', 'error');
      return;
    }
    /* A delete the policy refuses removes 0 rows WITHOUT raising an error, and only
       the server knows what became of the replies under it. So re-read, and let that
       read — not the request — decide what we tell the user. */
    const after = await load(true);
    if (after?.some((r) => r.id === c.id)) {
      errorFeedback();
      toast('Şərh silinmədi', 'error');
      return;
    }
    successFeedback();
    toast('Şərh silindi');
  };

  const more = (c: Comment) => {
    if (c.mine) {
      confirm('Şərhi sil', 'Şərh həmişəlik silinir — geri qaytarmaq olmur.', [
        { label: 'Ləğv et', style: 'cancel' },
        { label: 'Sil', style: 'destructive', onPress: () => remove(c) },
      ]);
      return;
    }
    // Report/block acts on the person, so blocking actually filters them everywhere else.
    showModerationSheet(c.authorName, { type: 'user', id: c.authorId });
  };

  const send = () => {
    const body = text.trim();
    if (!body || !targetKey || sending) return;
    gate(async () => {
      setSending(true);
      try {
        const row = await addComment(targetKey, body, replyTo?.parentId ?? null);
        /* If the list itself never loaded, one appended row would read as «this is
           the only comment». Re-read instead of implying a complete thread. */
        if (status === 'ready') setRows((rs) => [...rs, row]);
        else await load();
        // Open the thread you just answered — a reply hidden behind «Daha N cavaba
        // bax» looks exactly like a reply that never posted.
        if (replyTo) setOpenThreads((s) => ({ ...s, [replyTo.parentId]: true }));
        setText('');
        setSel({ start: 0, end: 0 });
        setReplyTo(null);
        setSuggestions([]);
        successFeedback();
        Keyboard.dismiss();
      } catch {
        // The text stays in the box — a failed send must never look like a sent one.
        errorFeedback();
        toast('Şərh göndərilmədi — yenidən cəhd et', 'error');
      } finally {
        setSending(false);
      }
    }, 'Şərh yazmaq üçün');
  };

  // ------------------------------------------------------------- animation

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, SHEET_H], [1, 0], Extrapolation.CLAMP),
  }));

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // The list's own scroll gesture — declared here so the pan can run alongside it
  // instead of stealing its touches.
  const nativeScroll = Gesture.Native();

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .simultaneousWithExternalGesture(nativeScroll)
    .onBegin((e) => {
      dragging.value = false;
      fromHeader.value = e.y <= headerH.value; // handle / title bar always drags
    })
    .onUpdate((e) => {
      if (!dragging.value) {
        // hand over from the list only when it can't scroll down any further
        if (e.translationY > 0 && (fromHeader.value || scrollY.value <= 0.5)) {
          dragging.value = true;
          dragFrom.value = e.translationY; // zero point, so the sheet doesn't jump
        } else return;
      }
      translateY.value = Math.max(0, e.translationY - dragFrom.value);
    })
    .onEnd((e) => {
      if (!dragging.value) return;
      if (translateY.value > CLOSE_DISTANCE || (e.velocityY > CLOSE_VELOCITY && translateY.value > 8)) {
        translateY.value = withTiming(SHEET_H, { duration: 220 }, () => runOnJS(onClose)());
      } else {
        translateY.value = withTiming(0, { duration: 180 });
      }
    })
    .onFinalize((_e, success) => {
      if (dragging.value && !success) translateY.value = withTiming(0, { duration: 180 }); // cancelled mid-drag
      dragging.value = false;
    });

  // Mirror the relation so neither side waits for the other — the list keeps scrolling
  // normally while the pan quietly watches for the pull-down.
  nativeScroll.simultaneousWithExternalGesture(pan);

  const canSend = text.trim().length > 0 && !sending;
  /* Lift the whole sheet onto the keyboard, and shrink it so the grabber and the
     «Şərhlər» header stay on screen instead of being pushed off the top. Without
     the shrink the panel keeps its resting height, its bottom (the composer) ends
     up under the keys, and you cannot see what you are typing. */
  const panelH = kb > 0 ? Math.max(220, Math.min(SHEET_H, height - kb - insets.top - 12)) : SHEET_H;
  const showList = status === 'ready' && threads.length > 0;

  /* Mounted by <UiHost/> at the app root, NOT inside the feed screen.
   *
   * That placement does two jobs at once. The root is drawn above the navigator,
   * so the floating tab bar can no longer sit across the composer. And it stays
   * in the app's own window — a Modal would be a separate window, where Android's
   * `adjustResize` does not apply and the keyboard covers whatever you type. */
  if (!mounted) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.panel, { height: panelH, bottom: kb }, panelStyle]}>
          <View onLayout={(e) => (headerH.value = e.nativeEvent.layout.height)}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <AppText variant="headline">{showList ? `Şərhlər · ${rows.length}` : 'Şərhlər'}</AppText>
              <PressableScale haptic={false} activeScale={0.9} onPress={onClose}>
                <Icon name="x" size={22} color={palette.inkText} />
              </PressableScale>
            </View>
          </View>

          <View style={{ flex: 1 }}>
            <GestureDetector gesture={nativeScroll}>
              <Animated.ScrollView
                onScroll={onScroll}
                scrollEventThrottle={16}
                bounces={false}
                alwaysBounceVertical={false}
                overScrollMode="never"
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[styles.content, !showList && styles.contentEmpty]}>
                {status === 'loading' ? (
                  <View style={styles.state}>
                    <ActivityIndicator color={palette.tertiary} />
                    <AppText variant="body" color={palette.textSecondary} style={{ marginTop: 12 }}>
                      Şərhlər yüklənir…
                    </AppText>
                  </View>
                ) : status === 'error' ? (
                  /* «Yüklənmədi» is not «yoxdur». The difference matters: one is a
                     broken connection, the other is a thread nobody has written in. */
                  <View style={styles.state}>
                    <Icon name="x" size={24} color="#D14A15" />
                    <AppText variant="headline" style={{ marginTop: 12 }}>
                      Şərhlər yüklənmədi
                    </AppText>
                    <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, lineHeight: 20, maxWidth: 260 }}>
                      Bu, «şərh yoxdur» demək deyil — sorğu alınmadı. Bağlantını yoxla və yenidən cəhd et.
                    </AppText>
                    <Button title="Yenidən cəhd et" variant="secondary" style={{ marginTop: 14 }} onPress={() => load()} />
                  </View>
                ) : threads.length === 0 ? (
                  <View style={styles.state}>
                    <Icon name="msg" size={26} color={palette.tertiary} />
                    <AppText variant="headline" style={{ marginTop: 12 }}>
                      Hələ şərh yoxdur
                    </AppText>
                    <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, lineHeight: 20, maxWidth: 250 }}>
                      İlk şərhi sən yaz. Sual ver, texnikanı müzakirə et.
                    </AppText>
                  </View>
                ) : (
                  threads.map((t) => {
                    const expanded = !!openThreads[t.root.id];
                    const shown = expanded ? t.replies : t.replies.slice(0, REPLIES_PREVIEW);
                    const hidden = t.replies.length - shown.length;
                    return (
                      <View key={t.root.id}>
                        <CommentItem
                          c={t.root}
                          mine={t.root.mine}
                          onLike={() => like(t.root)}
                          onReply={() => startReply(t.root, t.root.id)}
                          onMore={() => more(t.root)}
                          onMention={openHandle}
                        />
                        {shown.map((r) => (
                          <CommentItem
                            key={r.id}
                            c={r}
                            reply
                            mine={r.mine}
                            onLike={() => like(r)}
                            onReply={() => startReply(r, t.root.id)}
                            onMore={() => more(r)}
                            onMention={openHandle}
                          />
                        ))}
                        {hidden > 0 || expanded ? (
                          <PressableScale
                            haptic={false}
                            activeScale={0.98}
                            onPress={() => setOpenThreads((s) => ({ ...s, [t.root.id]: !expanded }))}
                            style={styles.moreReplies}>
                            <View style={styles.threadLine} />
                            <AppText variant="caption" color={palette.textSecondary} style={{ fontWeight: '600' }}>
                              {expanded ? 'Cavabları gizlət' : `Daha ${hidden} cavaba bax`}
                            </AppText>
                          </PressableScale>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </Animated.ScrollView>
            </GestureDetector>

            {/* With the keyboard up the navigation bar is covered by it, so the
                safe-area padding would just add a dead strip above the keys. */}
            <View style={[styles.dock, { paddingBottom: kb > 0 ? 10 : Math.max(insets.bottom, 10) }]}>
              {suggestions.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.suggStrip}>
                  {suggestions.map((h) => (
                    <PressableScale key={h.id} haptic={false} activeScale={0.95} onPress={() => applyHandle(h)} style={styles.sugg}>
                      <Avatar name={h.name} size={22} uri={h.avatarUrl} />
                      <AppText variant="caption" style={{ fontWeight: '600' }} numberOfLines={1}>
                        @{h.username}
                      </AppText>
                    </PressableScale>
                  ))}
                </ScrollView>
              ) : null}

              {replyTo ? (
                <View style={styles.replyChip}>
                  <Icon name="msg" size={13} color={palette.textSecondary} />
                  <AppText variant="caption" color={palette.textSecondary} numberOfLines={1} style={{ flex: 1 }}>
                    {replyTo.handle ? `@${replyTo.handle}-ə cavab` : `${replyTo.name} adlı istifadəçiyə cavab`}
                  </AppText>
                  {/* Changed your mind? Drop the chip and the same text posts as a normal comment. */}
                  <PressableScale haptic={false} activeScale={0.85} onPress={() => setReplyTo(null)} hitSlop={8}>
                    <Icon name="x" size={14} color={palette.textSecondary} />
                  </PressableScale>
                </View>
              ) : null}

              <View style={styles.composer}>
                <Avatar name={myName || 'Sən'} size={32} />
                <View style={styles.field}>
                  <TextInput
                    ref={inputRef}
                    value={text}
                    onChangeText={onChangeText}
                    selection={forceSel ?? undefined}
                    onSelectionChange={(e) => {
                      setSel(e.nativeEvent.selection);
                      if (forceSel) setForceSel(null); // hand the caret back to the user
                    }}
                    placeholder={replyTo ? 'Cavab yaz…' : 'Şərh yaz…'}
                    placeholderTextColor={palette.caption}
                    style={styles.input}
                    onSubmitEditing={send}
                    returnKeyType="send"
                    multiline={false}
                  />
                  <PressableScale
                    activeScale={0.9}
                    onPress={send}
                    disabled={!canSend}
                    style={[styles.send, !canSend && styles.sendOff]}>
                    {sending ? (
                      <ActivityIndicator size="small" color={palette.tertiary} />
                    ) : (
                      <Icon name="arrowU" size={18} color={canSend ? palette.inkText : palette.tertiary} />
                    )}
                  </PressableScale>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** One comment — top-level or an indented reply under its thread. */
function CommentItem({
  c,
  reply,
  mine,
  onLike,
  onReply,
  onMore,
  onMention,
}: {
  c: Comment;
  reply?: boolean;
  mine: boolean;
  onLike: () => void;
  onReply: () => void;
  onMore: () => void;
  onMention: (handle: string) => void;
}) {
  const name = c.authorName;
  const uname = c.authorUsername?.trim();
  return (
    <Pressable onLongPress={onMore} delayLongPress={350} style={[styles.row, reply && styles.rowReply]}>
      <Avatar name={name} size={reply ? 28 : 38} uri={c.authorAvatar} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <AppText variant="subhead" numberOfLines={1} style={{ fontWeight: '600', flexShrink: 1 }}>
            {name}
          </AppText>
          {/* Only shown when the account really has a handle — never invented. */}
          {uname ? (
            <AppText variant="caption" color={palette.caption} numberOfLines={1} style={{ flexShrink: 1 }}>
              @{uname}
            </AppText>
          ) : null}
          {mine ? (
            <View style={styles.mineTag}>
              <AppText style={{ fontSize: 9.5, fontWeight: '700', color: palette.voltDeep }}>SƏN</AppText>
            </View>
          ) : null}
          <AppText variant="caption" color={palette.tertiary}>
            · {timeAgoAz(c.createdAt)}
          </AppText>
        </View>

        <Body body={c.body} onMention={onMention} />

        <View style={styles.actions}>
          <PressableScale haptic={false} activeScale={0.95} onPress={onReply} hitSlop={6}>
            <AppText variant="caption" color={palette.textSecondary} style={{ fontWeight: '600' }}>
              Cavab yaz
            </AppText>
          </PressableScale>
          <PressableScale haptic={false} activeScale={0.9} onPress={onMore} hitSlop={6} style={{ paddingHorizontal: 2 }}>
            <Icon name="more" size={14} color={palette.tertiary} />
          </PressableScale>
        </View>
      </View>

      <PressableScale
        activeScale={0.85}
        haptic={false}
        onPress={onLike}
        style={{ alignItems: 'center', gap: 3, paddingHorizontal: 4 }}>
        <Icon name="heart" size={16} color={c.likedByMe ? palette.streak : palette.tertiary} />
        {c.likes > 0 ? (
          <AppText variant="caption" color={c.likedByMe ? palette.streak : palette.caption}>
            {c.likes}
          </AppText>
        ) : null}
      </PressableScale>
    </Pressable>
  );
}

/** Comment text with every `@handle` picked out in blue and made tappable. */
function Body({ body, onMention }: { body: string; onMention: (handle: string) => void }) {
  const parts = useMemo(() => splitMentions(body), [body]);
  return (
    <AppText variant="body" color={palette.text3} style={{ marginTop: 4, lineHeight: 20 }}>
      {parts.map((p, i) =>
        p.handle ? (
          <AppText key={i} variant="body" color={palette.blue} style={{ lineHeight: 20 }} onPress={() => onMention(p.handle as string)}>
            {p.text}
          </AppText>
        ) : (
          p.text
        )
      )}
    </AppText>
  );
}

type Part = { text: string; handle?: string };

/** Split a body into plain runs and mention runs. ONLY what `MENTION_RE` matches is
 *  treated as a handle — the same pattern `profiles.username` is constrained to — so
 *  the sheet can never paint a handle that could not exist. Whether it points at a
 *  real account is decided later, when the reader taps it. */
function splitMentions(body: string): Part[] {
  // A fresh regex per call: a shared /g pattern carries `lastIndex` between bodies.
  const re = new RegExp(MENTION_RE.source, 'g');
  const out: Part[] = [];
  let last = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m[0].length === 0) {
      re.lastIndex++; // a zero-width match would loop forever
      continue;
    }
    const at = m[0].indexOf('@');
    if (at < 0) continue;
    if (m.index > last) out.push({ text: body.slice(last, m.index) });
    // The pattern may swallow the separator before the '@' — that part is plain text.
    if (at > 0) out.push({ text: m[0].slice(0, at) });
    const handle = m[0].slice(at + 1);
    out.push({ text: `@${handle}`, handle });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}

/** The `@word` token the caret is sitting in, or null. Drives the suggestion strip. */
function mentionToken(value: string, caret: number): { start: number; end: number; q: string } | null {
  let i = caret - 1;
  while (i >= 0 && /[A-Za-z0-9_]/.test(value[i])) i--;
  if (i < 0 || value[i] !== '@') return null;
  // '@' only opens a mention at the start of a word — «e-mail@ad» is not one.
  if (i > 0 && !/\s/.test(value[i - 1])) return null;
  let end = caret;
  while (end < value.length && /[A-Za-z0-9_]/.test(value[end])) end++;
  return { start: i, end, q: value.slice(i + 1, caret) };
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  panel: {
    // Anchored to the bottom of the WINDOW, lifted by the keyboard overlap.
    position: 'absolute', left: 0, right: 0,
    backgroundColor: palette.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden',
  },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: palette.separator, marginTop: 8, marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.separator },
  content: { paddingHorizontal: spacing.screen, paddingTop: 14, paddingBottom: 16 },
  contentEmpty: { flexGrow: 1, justifyContent: 'center' },
  state: { alignItems: 'center', paddingVertical: 24 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  rowReply: { marginLeft: 34, gap: 10 }, // one level of nesting, never deeper
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mineTag: { backgroundColor: 'rgba(198,255,61,0.30)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
  moreReplies: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 34, marginBottom: 16, marginTop: -4 },
  threadLine: { width: 22, height: StyleSheet.hairlineWidth, backgroundColor: palette.separator },
  dock: {
    paddingTop: 8, backgroundColor: palette.white,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator,
  },
  suggStrip: { paddingHorizontal: spacing.screen, gap: 8, paddingBottom: 8 },
  sugg: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: palette.element, borderRadius: 999, paddingLeft: 5, paddingRight: 11, paddingVertical: 4,
  },
  replyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginHorizontal: spacing.screen, marginBottom: 8,
    backgroundColor: palette.element, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
  },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.screen },
  field: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: palette.element, borderRadius: 999, height: 42, paddingLeft: 15, paddingRight: 5,
  },
  input: { flex: 1, fontSize: 15, color: palette.inkText, paddingVertical: 0, marginRight: 6 },
  send: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: 'transparent' },
});
