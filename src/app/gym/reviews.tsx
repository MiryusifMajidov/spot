import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { StatusBarScrim } from '@/components/ui/StatusBarScrim';
import { createReport } from '@/lib/api';
import { reviewerName, tenureLabel } from '@/lib/format';
import { EmptyNote, GymGate, getGymReviews, replyToReview, useMyGym, type GymReviewRow } from '@/lib/gymOwner';
import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';
import { useFormat, useT } from '@/lib/useT';
import { actionSheet, toast } from '@/store/ui';
import { palette, spacing, inputTint } from '@/theme';

export default function GymReviews() {
  const t = useT();
  // «4,6» in Azerbaijani and Russian, «4.6» in English — via the hook so a
  // language switch recomputes it.
  const fmt = useFormat();
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
    if (!gym) return;
    void (async () => {
      await load(gym.id);
    })();
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
      toast(t('Rəsmi cavabın yazıldı'));
    } catch {
      toast(t('Cavab yazılmadı — serverdə saxlanıla bilmədi. Bağlantını yoxla və yenidən cəhd et.'), 'error');
    }
    setSaving(false);
  };

  const report = (r: GymReviewRow) => {
    actionSheet({
      title: t('Rəyi şikayət et'),
      message: t('Şikayət rəyi SİLMİR. SPOT moderatoru yoxlayır və qərar verir.'),
      actions: [
        { label: t('Saxta rəy'), onPress: () => submitReport(r, 'fake') },
        { label: t('Təhqir / söyüş'), onPress: () => submitReport(r, 'harassment') },
        { label: t('Spam / reklam'), onPress: () => submitReport(r, 'spam') },
        { label: t('Ləğv et'), style: 'cancel' },
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
      toast(t('Şikayət moderatora göndərildi'));
    } catch {
      toast(t('Şikayət göndərilmədi — bağlantını yoxla'), 'error');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.tertiary} />}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 24 }}>
        <AppText variant="largeTitle" style={{ marginBottom: 4 }}>
          {t('Rəylər')}
        </AppText>

        {failed ? (
          <View style={styles.failCard}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Icon name="x" size={17} color={palette.streakText} />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{t('Rəylər yüklənmədi')}</AppText>
                <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 5 }}>
                  {reviews.length
                    ? t('Aşağıdakılar əvvəlki yükləmədən qalıb — yeni rəylər olmaya bilər. Bağlantını yoxla.')
                    : t('Bu, «rəy yoxdur» demək deyil — sorğu alınmadı. Bağlantını yoxla və yenidən cəhd et.')}
                </AppText>
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <Button title={t('Yenidən cəhd et')} variant="secondary" full onPress={refresh} />
            </View>
          </View>
        ) : null}

        {/* Not before the read returns: «— · 0 rəy» beside «Yüklənir…» was a count
            of reviews we had not fetched yet. */}
        {!loaded || (failed && !reviews.length) ? null : (
          <View style={styles.summary}>
            <AppText style={{ fontSize: 34, fontWeight: '700', letterSpacing: -1 }}>
              {summary.count ? fmt.decimal(summary.avg, 1) : '—'}
            </AppText>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <Icon key={i} name="star" size={15} color={i <= Math.round(summary.avg) ? palette.voltDeep : palette.separator} />
                ))}
              </View>
              <AppText variant="caption" color={palette.tertiary} style={{ marginTop: 4 }}>
                {t('{n} rəy · rəyləri silə bilməzsən, yalnız cavab yaza bilərsən', {
                  n: summary.count,
                  count: summary.count,
                })}
              </AppText>
            </View>
          </View>
        )}

        {!reviews.length ? (
          failed ? null : !loaded ? (
            // The empty-state copy («Rəy gələndə burada görünəcək») reads as «none
            // yet» — not something to say about a list still on its way.
            <View style={[styles.card, { marginTop: 10 }]}>
              <AppText style={{ fontSize: 14.5, color: palette.textSecondary }}>{t('Yüklənir…')}</AppText>
            </View>
          ) : (
            <EmptyNote
              title={t('Hələ rəy yoxdur')}
              body={t(
                'Üzvlər zalında check-in etdikdən sonra rəy yaza bilir. Rəy gələndə burada real olaraq görünəcək — biz nümunə rəy göstərmirik.'
              )}
            />
          )
        ) : (
          <View style={{ gap: 12 }}>
            {reviews.map((r) => (
              <View key={r.id} style={styles.card}>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <Avatar name={reviewerName(r.name, t)} size={40} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="headline">{reviewerName(r.name, t)}</AppText>
                    {tenureLabel(r.tenure, t) ? (
                      <AppText variant="caption" color={palette.tertiary} style={{ marginTop: 2 }}>
                        {tenureLabel(r.tenure, t)}
                      </AppText>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Icon key={i} name="star" size={13} color={i <= r.rating ? palette.voltDeep : palette.separator} />
                    ))}
                  </View>
                </View>

                <AppText variant="body" color={palette.text3} style={{ marginTop: 12, lineHeight: 21 }}>
                  {r.text}
                </AppText>

                {r.reply ? (
                  <View style={styles.reply}>
                    <AppText style={{ fontSize: 12, fontWeight: '700', color: palette.inkText }}>
                      {t('{gym} · rəsmi cavab', { gym: gym.name })}
                    </AppText>
                    <AppText variant="footnote" color={palette.text3} style={{ marginTop: 4, lineHeight: 18 }}>
                      {r.reply}
                    </AppText>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <PressableScale
                    activeScale={0.97}
                    onPress={() => {
                      setReplyTo(r);
                      setReplyText(r.reply ?? '');
                    }}
                    style={styles.actionHit}
                    accessibilityRole="button">
                    <View style={styles.replyBtn}>
                      <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.inkText }}>
                        {r.reply ? t('Cavabı redaktə et') : t('Rəsmi cavab yaz')}
                      </AppText>
                    </View>
                  </PressableScale>
                  <PressableScale
                    activeScale={0.97}
                    onPress={() => report(r)}
                    style={[styles.actionHit, styles.reportHit]}
                    accessibilityRole="button">
                    <AppText style={{ fontSize: 12.5, color: palette.tertiary }}>{t('Şikayət et')}</AppText>
                  </PressableScale>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.rule}>
          <Icon name="shield" size={15} color={palette.tertiary} />
          <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.textSecondary, flex: 1 }}>
            {t('Sahib rəyi silə bilmir — yalnız cavab yaza və ya şikayət edə bilər. Şikayət rəyi silmir, moderator yoxlayır.')}
          </AppText>
        </View>
      </ScrollView>
      <StatusBarScrim />

      <Modal visible={!!replyTo} animationType="slide" transparent onRequestClose={() => setReplyTo(null)}>
        <View style={styles.modalBg}>
          <View style={[styles.sheet, { paddingBottom: (kb > 0 ? kb : insets.bottom) + 16 }]}>
            <AppText variant="headline">{t('Rəsmi cavab')}</AppText>
            <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 6 }}>
              {t('Cavabın rəyin altında {gym} adından görünəcək.', { gym: gym.name })}
            </AppText>
            <TextInput {...inputTint}
              value={replyText}
              onChangeText={setReplyText}
              multiline
              placeholder={t('Qeydin üçün təşəkkür edirik…')}
              placeholderTextColor={palette.caption}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button title={t('Ləğv et')} variant="secondary" full onPress={() => setReplyTo(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={saving ? t('Yazılır…') : t('Yaz')}
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
  reply: { backgroundColor: palette.inkTint, borderRadius: 12, padding: 12, marginTop: 12 },
  /* The pill was the whole press area (~35 pt) and «Şikayət et» only its own
     12.5 pt line of text (~17 pt). Each now sits in a 44 pt-tall box; the pill
     looks as it did. The row's top margin drops from 12 to 8 and a -4 bottom
     margin takes back the extra below, so the pill still sits about 12 pt under
     the text and 16 pt above the card's edge; the -4 stays inside the card's own
     padding, so Android still delivers those touches. Gap 6 + the link's 8 pt
     side padding is the 14 pt that used to separate pill and link.
     Wraps: in Russian «Написать официальный ответ» + «Пожаловаться» is ~330 pt,
     wider than the card on any phone narrower than ~400 pt, and without a wrap
     the link was drawn past the card's edge. No row gap — the 44 pt boxes
     already space a wrapped link from the pill. */
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, marginTop: 8, marginBottom: -4 },
  actionHit: { minHeight: 44, justifyContent: 'center' },
  reportHit: { paddingHorizontal: 8 },
  replyBtn: { backgroundColor: palette.grouped, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  rule: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 16, paddingHorizontal: 4 },
  modalBg: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.grouped, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20 },
  input: { backgroundColor: palette.white, borderRadius: 14, padding: 14, fontSize: 15, color: palette.inkText, minHeight: 110, textAlignVertical: 'top', marginTop: 14, borderWidth: 1, borderColor: palette.separator },
});
