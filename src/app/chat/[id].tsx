import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { tapFeedback } from '@/lib/feedback';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { usePartner, useTrainers } from '@/lib/hooks';
import { showModerationSheet } from '@/lib/moderation';
import { gymById, timeAgoAz, useDb } from '@/store/db';
import {
  ChatError, chatRefusalText, findThread, getMessages, markThreadRead,
  openThread, sendMessage, subscribeToThread, type ChatMessageRow,
} from '@/lib/chat';

/** Only a real profile row has a server thread; seed ids never will. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { useDiscoverPrefs } from '@/store/discoverPrefs';
import { palette, spacing } from '@/theme';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { hasSupabaseConfig } from '@/lib/supabase';
import { toast } from '@/store/ui';

const QUICK = ['Yoldayam 👍', 'Gecikirəm 10 dəq', 'Sabaha keçirək'];

export default function Conversation() {
  // `name` is passed by the screens that already know the counterpart (a trainer
  // opening a student thread); it is only a fallback for the real record below.
  const { id, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const trainers = useTrainers();
  const trainer = trainers.find((t) => t.id === id);
  // Not a trainer id → the counterpart is a person with a profiles row: a partner
  // or a trainer's student. Both resolve through the same lookup.
  const partner = usePartner(trainer ? '' : id);

  const match = useDb((s) => s.matches[id]);
  const acceptInvite = useDb((s) => s.acceptInvite);
  const localThread = useDb((s) => s.threads[id]);
  const markThreadReadLocal = useDiscoverPrefs((s) => s.markThreadRead);

  /* The conversation now lives on the server (schema42). `threadId` is null until
     `open_thread` confirms the two people are actually allowed to talk — an
     accepted match or trainer link, and no block. `state` separates «still
     asking» from «asked and there is nothing», so an empty screen is never shown
     over a read that failed. */
  const [threadId, setThreadId] = useState<string | null>(null);
  const [serverMsgs, setServerMsgs] = useState<ChatMessageRow[]>([]);
  const [chatState, setChatState] = useState<'loading' | 'ready' | 'unavailable' | 'failed'>('loading');
  const [refusal, setRefusal] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  // Never invent a name: when nobody could be resolved we say so instead of
  // labelling the thread (and the block dialog) with a placeholder.
  const resolvedName = partner?.name ?? trainer?.name ?? (nameParam?.trim() || null);
  const name = resolvedName ?? 'Söhbət';
  const isPartner = !!partner || !!match;

  // Opening the thread is what marks it read — never "who wrote last".
  useFocusEffect(
    useCallback(() => {
      if (id) markThreadReadLocal(id);
    }, [id, markThreadReadLocal])
  );

  // Find the server thread (never create one here: opening a screen is not
  // consent to start a conversation — `openThread` runs when a message is sent).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (!hasSupabaseConfig || !UUID.test(id ?? '')) {
        setChatState('unavailable');
        return;
      }
      setChatState('loading');
      findThread(id)
        .then(async (t) => {
          if (!alive) return;
          setThreadId(t);
          if (!t) {
            setServerMsgs([]);
            setChatState('ready');
            return;
          }
          const ms = await getMessages(t);
          if (!alive) return;
          setServerMsgs(ms);
          setChatState('ready');
          void markThreadRead(t).catch(() => {});
        })
        .catch(() => alive && setChatState('failed'));
      return () => { alive = false; };
    }, [id])
  );

  // Live: without this the other side only appears on a reopen, which is exactly
  // how the old device-only chat felt.
  useEffect(() => {
    if (!threadId) return;
    return subscribeToThread(threadId, (m) => {
      setServerMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (!m.mine) void markThreadRead(threadId).catch(() => {});
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
  }, [threadId]);

  /* Scroll the newest message back into view when the composer rises. The lift
     itself comes from the shared `useKeyboardLift` — this file used to carry its
     own copy of the overlap maths, and four copies of a subtle measurement is
     three too many. iOS still uses KeyboardAvoidingView (it animates in sync with
     the keyboard), so the lift is Android-only. */
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => show.remove();
  }, []);

  const lift = useKeyboardLift();
  const composerLift = Platform.OS === 'android' ? lift : 0;

  // db.threads is keyed by an arbitrary id, so partner and trainer threads use one path.
  const send = async (body: string) => {
    const text = body.trim();
    if (!text || !id || sending) return;
    tapFeedback();
    if (!hasSupabaseConfig || !UUID.test(id)) {
      toast('Mesaj göndərilə bilmir — bu söhbətin serverdə qarşı tərəfi yoxdur', 'error');
      return;
    }
    setSending(true);
    setRefusal(null);
    try {
      // The thread is opened on the FIRST message, not when the screen opens:
      // `open_thread` is what checks the relationship and the block, so a refusal
      // arrives with a reason instead of a blank screen.
      const t = threadId ?? (await openThread(id));
      if (!threadId) setThreadId(t);
      const m = await sendMessage(t, text);
      setServerMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setText('');
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      const code = e instanceof ChatError ? e.code : 'unknown';
      setRefusal(chatRefusalText(code));
      toast(chatRefusalText(code), 'error');
    } finally {
      setSending(false);
    }
  };

  // Server messages are the conversation. The device copy is kept only for the
  // workout-invite cards, which are still a local construct.
  const messages = serverMsgs;
  const invites = (localThread ?? []).filter((m) => m.kind === 'invite');

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar
        title={name}
        right={
          <PressableScale
            activeScale={0.9}
            onPress={() => showModerationSheet(resolvedName ?? 'Bu istifadəçi', { type: trainer ? 'trainer' : 'user', id })}>
            <Icon name="more" size={22} color={palette.inkText} />
          </PressableScale>
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
          <View style={styles.privacyNote}>
            <Icon name="lock" size={13} color={palette.caption} />
            <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
              {chatState === 'unavailable'
                ? 'Bu söhbətin serverdə qarşı tərəfi yoxdur — yazdıqların göndərilmir.'
                : 'Mesajlar qarşı tərəfə çatır. Cavab gələnə qədər bir mesaj göndərmək olur — vaxtı zalda dəqiqləşdirin.'}
            </AppText>
          </View>

          {chatState === 'loading' ? (
            <View style={styles.startNote}>
              <AppText variant="footnote" color={palette.caption} center>Yüklənir…</AppText>
            </View>
          ) : chatState === 'failed' ? (
            <View style={styles.startNote}>
              <AppText variant="footnote" color={palette.caption} center style={{ lineHeight: 19 }}>
                Söhbət yüklənmədi — neçə mesaj olduğunu bilmirik. İnternet qayıdanda yenidən aç.
              </AppText>
            </View>
          ) : messages.length === 0 && invites.length === 0 ? (
            <View style={styles.startNote}>
              <AppText variant="footnote" color={palette.caption} center style={{ lineHeight: 19 }}>
                {!resolvedName
                  ? 'Bu söhbətin qarşı tərəfini tapa bilmədik. Yazdıqların yalnız bu cihazda qalır.'
                  : isPartner
                    ? match?.state === 'accepted'
                      ? `${name} ilə match oldunuz. İlk mesajı yaz — yoldaşlıq zalda başlayır.`
                      : match
                        ? `${name} hələ təklifə cavab verməyib. Cavab gələndə söhbət burada davam edəcək.`
                        : `${name} ilə söhbət. İlk mesajı yaz.`
                    : `${name} ilə söhbət. Qeydlərini burada saxlaya bilərsən.`}
              </AppText>
            </View>
          ) : (
            <>
              {invites.map((m) => (
                <InviteCard
                  key={m.id}
                  when={m.invite?.when ?? ''}
                  gymName={gymById(m.invite?.gymId ?? '')?.name ?? 'Zal'}
                  accepted={!!m.invite?.accepted}
                  onAccept={() => acceptInvite(id, m.id)}
                />
              ))}
              {messages.map((m) => (
                <View key={m.id} style={[styles.bubbleWrap, m.mine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                  <View style={[styles.bubble, m.mine ? styles.mine : styles.theirs]}>
                    <AppText variant="body" color={m.mine ? palette.white : palette.inkText}>
                      {m.body}
                    </AppText>
                  </View>
                  <AppText variant="caption" color={palette.tertiary} style={{ marginTop: 3, marginHorizontal: 4 }}>
                    {timeAgoAz(m.createdAt)}
                    {m.mine && m.read ? ' · oxundu' : ''}
                  </AppText>
                </View>
              ))}
              {refusal ? (
                <View style={styles.startNote}>
                  <AppText variant="footnote" color={palette.red} center style={{ lineHeight: 19 }}>{refusal}</AppText>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        {/* Input */}
        <View style={[styles.inputArea, composerLift > 0 ? { paddingBottom: composerLift } : null]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quick}>
            {QUICK.map((q) => (
              <PressableScale key={q} activeScale={0.95} onPress={() => send(q)} style={styles.quickChip}>
                <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.text3 }}>{q}</AppText>
              </PressableScale>
            ))}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Mesaj yaz…"
              placeholderTextColor={palette.caption}
              style={styles.input}
              onSubmitEditing={() => send(text)}
              returnKeyType="send"
            />
            <PressableScale activeScale={0.9} onPress={() => send(text)} style={styles.sendBtn}>
              <Icon name="arrowU" size={20} color={palette.inkText} />
            </PressableScale>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function InviteCard({ when, gymName, accepted, onAccept }: { when: string; gymName: string; accepted: boolean; onAccept: () => void }) {
  return (
    <View style={[styles.proposal, accepted && styles.proposalDone]}>
      <View style={styles.proposalHead}>
        <Icon name="dumbbell" size={16} color={accepted ? palette.voltDeep : palette.inkText} />
        <AppText variant="overline" color={accepted ? palette.voltDeep : palette.caption}>
          {accepted ? 'TƏSDİQLƏNDİ' : 'MƏŞQ TƏKLİFİ'}
        </AppText>
      </View>
      <AppText variant="title3" style={{ marginTop: 8 }}>
        {when}
      </AppText>
      <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 4 }}>
        {gymName} · birlikdə məşq
      </AppText>
      {accepted ? (
        <View style={styles.acceptedRow}>
          <Icon name="check" size={16} color={palette.voltDeep} />
          <AppText variant="subhead" color={palette.voltDeep} style={{ fontWeight: '600' }}>
            Təqvimə əlavə olundu
          </AppText>
        </View>
      ) : (
        <PressableScale activeScale={0.97} onPress={onAccept} style={styles.acceptBtn}>
          <AppText style={{ color: palette.inkText, fontWeight: '600', fontSize: 14 }}>Qəbul et</AppText>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 16 },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: palette.white, borderRadius: 12, padding: 11, marginBottom: 12 },
  startNote: { paddingVertical: 24, paddingHorizontal: 20 },
  proposal: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: palette.separator },
  proposalDone: { backgroundColor: 'rgba(198,255,61,0.14)', borderColor: 'rgba(198,255,61,0.5)' },
  proposalHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  acceptBtn: { marginTop: 14, height: 42, borderRadius: 12, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  acceptedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  bubbleWrap: { marginBottom: 8 },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { backgroundColor: palette.ink, borderBottomRightRadius: 5 },
  theirs: { backgroundColor: palette.white, borderBottomLeftRadius: 5 },
  inputArea: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator, paddingTop: 8 },
  quick: { paddingHorizontal: spacing.screen, gap: 7, paddingBottom: 8 },
  quickChip: { backgroundColor: palette.white, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: palette.separator },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: spacing.screen, paddingBottom: 4 },
  input: { flex: 1, backgroundColor: palette.white, borderRadius: 999, paddingHorizontal: 16, height: 44, fontSize: 15, color: palette.inkText, borderWidth: 1, borderColor: palette.separator },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
});
