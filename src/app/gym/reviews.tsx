import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { createReport } from '@/lib/api';
import { EmptyNote, GymGate, getGymReviews, replyToReview, useMyGym, type GymReviewRow } from '@/lib/gymOwner';
import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';
import { actionSheet, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

export default function GymReviews() {
  const insets = useSafeAreaInsets();
  // The reply sheet is a Modal — its own window, which Android never resizes for
  // the keyboard. Pad it by the measured overlap so the field and «Yaz» stay above.
  const kb = useKeyboardOverlap();
  const state = useMyGym();
  const gym = state.gym;

  const [reviews, setReviews] = useState<GymReviewRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** The query itself failed — that is NOT the same as "no reviews yet". */
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [replyTo, setReplyTo] = useState<GymReviewRow | null>(null);
  const [replyText, setReplyText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (gymId: string) => {
    try {
      setReviews(await getGymReviews(gymId));
      setFailed(false);
    } catch {
      // Keep whatever we last really read; never claim the gym has no reviews.
      setFailed(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (gym) load(gym.id);
  }, [gym, load]);

  const summary = useMemo(() => {
    if (!reviews.length) return { avg: 0, count: 0 };
    const sum = reviews.reduce((s, r) => s + r.rating, 0);
    return { avg: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
  }, [reviews]);

  if (!gym) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.grouped, paddingTop: insets.top }}>
        <GymGate state={state} />
      </View>
    );
  }

  const refresh = async () => {
    setRefreshing(true);
    await load(gym.id);
    setRefreshing(false);
  };

  const sendReply = async () => {
    const body = replyText.trim();
    if (!replyTo || !body || saving) return;
    setSaving(true);
    try {
      await replyToReview(replyTo.id, body);
      setReviews((rs) => rs.map((r) => (r.id === replyTo.id ? { ...r, reply: body } : r)));
      setReplyTo(null);
      setReplyText('');
      toast('Rəsmi cavabın yazıldı');
    } catch {
      toast('Cavab yazılmadı — schema7_gym_owner.sql işlədilməyib və ya bağlantı yoxdur', 'error');
    }
    setSaving(false);
  };

  const report = (r: GymReviewRow) => {
    actionSheet({
      title: 'Rəyi şikayət et',
      message: 'Şikayət rəyi SİLMİR. SPOT moderatoru yoxlayır və qərar verir.',
      actions: [
        { label: 'Saxta rəy', onPress: () => submitReport(r, 'fake') },
        { label: 'Təhqir / söyüş', onPress: () => submitReport(r, 'harassment') },
        { label: 'Spam / reklam', onPress: () => submitReport(r, 'spam') },
        { label: 'Ləğv et', style: 'cancel' },
      ],
    });
  };

  const submitReport = async (r: GymReviewRow, category: 'fake' | 'harassment' | 'spam') => {
    try {
      await createReport({
        targetType: 'content',
        targetId: r.id,
        category,
        note: `Zal sahibi şikayəti · ${gym.name} · rəy: ${r.text.slice(0, 180)}`,
      });
      toast('Şikayət moderatora göndərildi');
    } catch {
      toast('Şikayət göndərilmədi — bağlantını yoxla', 'error');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.tertiary} />}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 24 }}>
        <AppText variant="largeTitle" style={{ marginBottom: 4 }}>
          Rəylər
        </AppText>

        {failed ? (
          <View style={styles.failCard}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Icon name="x" size={17} color="#D14A15" />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>Rəylər yüklənmədi</AppText>
                <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 5 }}>
                  {reviews.length
                    ? 'Aşağıdakılar əvvəlki yükləmədən qalıb — yeni rəylər olmaya bilər. Bağlantını yoxla.'
                    : 'Bu, «rəy yoxdur» demək deyil — sorğu alınmadı. Bağlantını yoxla və yenidən cəhd et.'}
                </AppText>
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <Button title="Yenidən cəhd et" variant="secondary" full onPress={refresh} />
            </View>
          </View>
        ) : null}

        {failed && !reviews.length ? null : (
          <View style={styles.summary}>
            <AppText style={{ fontSize: 34, fontWeight: '700', letterSpacing: -1 }}>
              {summary.count ? summary.avg.toFixed(1) : '—'}
            </AppText>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Icon key={i} name="star" size={15} color={i <= Math.round(summary.avg) ? palette.volt : palette.separator} />
                ))}
              </View>
              <AppText variant="caption" color={palette.tertiary} style={{ marginTop: 4 }}>
                {summary.count} rəy · rəyləri silə bilməzsən, yalnız cavab yaza bilərsən
              </AppText>
            </View>
          </View>
        )}

        {!reviews.length ? (
          failed ? null : (
            <EmptyNote
              title={loaded ? 'Hələ rəy yoxdur' : 'Yüklənir…'}
              body="Üzvlər zalında check-in etdikdən sonra rəy yaza bilir. Rəy gələndə burada real olaraq görünəcək — biz nümunə rəy göstərmirik."
            />
          )
        ) : (
          <View style={{ gap: 12 }}>
            {reviews.map((r) => (
              <View key={r.id} style={styles.card}>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <Avatar name={r.name} size={40} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="headline">{r.name}</AppText>
                    {r.tenure ? (
                      <AppText variant="caption" color={palette.tertiary} style={{ marginTop: 2 }}>
                        {r.tenure}
                      </AppText>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Icon key={i} name="star" size={13} color={i <= r.rating ? palette.volt : palette.separator} />
                    ))}
                  </View>
                </View>

                <AppText variant="body" color={palette.text3} style={{ marginTop: 12, lineHeight: 21 }}>
                  {r.text}
                </AppText>

                {r.reply ? (
                  <View style={styles.reply}>
                    <AppText style={{ fontSize: 12, fontWeight: '700', color: palette.blue }}>
                      {gym.name} · rəsmi cavab
                    </AppText>
                    <AppText variant="footnote" color={palette.text3} style={{ marginTop: 4, lineHeight: 18 }}>
                      {r.reply}
                    </AppText>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 }}>
                  <PressableScale
                    activeScale={0.97}
                    onPress={() => {
                      setReplyTo(r);
                      setReplyText(r.reply ?? '');
                    }}
                    style={styles.replyBtn}>
                    <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.inkText }}>
                      {r.reply ? 'Cavabı redaktə et' : 'Rəsmi cavab yaz'}
                    </AppText>
                  </PressableScale>
                  <PressableScale activeScale={0.97} onPress={() => report(r)}>
                    <AppText style={{ fontSize: 12.5, color: palette.tertiary }}>Şikayət et</AppText>
                  </PressableScale>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.rule}>
          <Icon name="shield" size={15} color={palette.tertiary} />
          <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.textSecondary, flex: 1 }}>
            Sahib rəyi silə bilmir — yalnız cavab yaza və ya şikayət edə bilər. Şikayət rəyi silmir, moderator yoxlayır.
          </AppText>
        </View>
      </ScrollView>

      <Modal visible={!!replyTo} animationType="slide" transparent onRequestClose={() => setReplyTo(null)}>
        <View style={styles.modalBg}>
          <View style={[styles.sheet, { paddingBottom: (kb > 0 ? kb : insets.bottom) + 16 }]}>
            <AppText variant="headline">Rəsmi cavab</AppText>
            <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 6 }}>
              Cavabın rəyin altında {gym.name} adından görünəcək.
            </AppText>
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              multiline
              placeholder="Qeydin üçün təşəkkür edirik…"
              placeholderTextColor={palette.caption}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button title="Ləğv et" variant="secondary" full onPress={() => setReplyTo(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={saving ? 'Yazılır…' : 'Yaz'}
                  variant="primary"
                  full
                  disabled={!replyText.trim() || saving}
                  onPress={sendReply}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 },
  failCard: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginTop: 10, marginBottom: 14 },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 16 },
  reply: { backgroundColor: 'rgba(10,132,255,0.06)', borderRadius: 12, padding: 12, marginTop: 12 },
  replyBtn: { backgroundColor: palette.grouped, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  rule: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 16, paddingHorizontal: 4 },
  modalBg: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.grouped, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20 },
  input: { backgroundColor: palette.white, borderRadius: 14, padding: 14, fontSize: 15, color: palette.inkText, minHeight: 110, textAlignVertical: 'top', marginTop: 14, borderWidth: 1, borderColor: palette.separator },
});
