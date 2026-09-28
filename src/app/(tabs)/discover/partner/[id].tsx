import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { COMPAT_UNKNOWN, MISMATCH_COLOR, compatOf, splitReasons } from '@/components/PartnerRow';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { getPartner } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { showModerationSheet } from '@/lib/moderation';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useFormat, useT } from '@/lib/useT';
import { Partner } from '@/data/types';
import { seedById, useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { palette, spacing } from '@/theme';
import { nameWithAge } from '@/lib/authorName';
import { memberOnly } from '@/lib/memberOnly';

/** Four different things used to render as the same endless spinner: still loading,
 *  no such profile, a profile whose owner turned «Zalda göründüyümü göstər» off, and
 *  a failed request. They are three different answers and now read differently. */
type Phase = 'loading' | 'ok' | 'gone' | 'fail';

function PartnerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const fmt = useFormat();
  const gate = useAuthGate();
  /* The action row at the bottom is pinned to a TAB screen. On Android the Material
     bar reserves its own space (expo-router pads the tab scene by the navigation-bar
     inset, so adding it here would count it twice). On iOS 26 the Liquid Glass bar
     FLOATS over the content — «Məşq təklif et» sat behind the glass. Inside a tab
     screen UIKit's safe area already includes that bar, so the row pads by the
     inset instead of guessing the bar's height. */
  const insets = useSafeAreaInsets();
  const footerBottom = (Platform.OS === 'ios' ? insets.bottom : 0) + spacing.sm;
  const match = useDb((s) => s.matches[id]);
  // The block dialog promises this person disappears from the user's lists — the
  // profile must not go on offering «Məşq təklif et» as if nothing happened.
  const blocked = useAppStore((s) => s.blocked);
  const isBlocked = blocked.includes(id);
  const [p, setP] = useState<Partner | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  /* One loader for focus AND for «Yenidən cəhd et». A retry counter listed in
     the deps but never read in the body can be dropped by the compiler, which
     leaves the button doing nothing (the same bug the gym panel and the trainer
     inbox had). */
  const load = useCallback(() => {
      if (!id) {
        setPhase('gone');
        return;
      }
      if (!hasSupabaseConfig) {
        setPhase('fail');
        return;
      }
      let alive = true;
      setPhase((prev) => (prev === 'ok' ? prev : 'loading'));
      getPartner(id)
        .then((partner) => {
          if (!alive) return;
          setP(partner);
          setPhase(partner ? 'ok' : 'gone');
        })
        .catch(() => {
          if (alive) setPhase('fail');
        });
      return () => {
        alive = false;
      };
  }, [id]);
  useFocusEffect(load);

  if (!p) {
    return (
      <Screen>
        <NavBar />
        <View style={styles.state}>
          {phase === 'loading' ? (
            <ActivityIndicator color={palette.textSecondary} />
          ) : phase === 'gone' ? (
            <>
              <Icon name="user" size={28} color={palette.tertiary} />
              <AppText variant="headline" style={{ marginTop: 12 }}>
                {t('Bu profil artıq görünmür')}
              </AppText>
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, maxWidth: 270, lineHeight: 21 }}>
                {t('Bu adam profilini gizlədib və ya hesabı yoxdur.')}
              </AppText>
              <Button title={t('Geri')} variant="secondary" onPress={() => router.back()} style={{ marginTop: 18, height: 44, paddingHorizontal: 26 }} />
            </>
          ) : (
            <>
              <Icon name="bell" size={28} color={palette.tertiary} />
              <AppText variant="headline" style={{ marginTop: 12 }}>
                {t('Yüklənmədi')}
              </AppText>
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, maxWidth: 270, lineHeight: 21 }}>
                {hasSupabaseConfig
                  ? t('Bu profili oxuya bilmədik. İnternet bağlantısını yoxla və yenidən cəhd et.')
                  : t('Bu quraşdırmada server bağlantısı yoxdur — profili oxuya bilmirik.')}
              </AppText>
              {hasSupabaseConfig ? (
                <Button
                  title={t('Yenidən cəhd et')}
                  onPress={() => void load()}
                  style={{ marginTop: 18, height: 44, paddingHorizontal: 26 }}
                />
              ) : null}
            </>
          )}
        </View>
      </Screen>
    );
  }

  // null = nothing was compared (we hold too little of MY profile), which is not
  // «0 % uyğun». The pill becomes an instruction and the reasons block disappears —
  // «Profilini tamamla» is a thing to do, never a reason two people match.
  const score = compatOf(p);
  const { pros, cons } = splitReasons(p);

  return (
    <Screen>
      <NavBar
        right={
          <PressableScale
            activeScale={0.9}
            onPress={() => showModerationSheet(p.name, { type: 'user', id: p.id })}
            accessibilityRole="button"
            accessibilityLabel={t('Digər seçimlər')}
            style={styles.moreBtn}>
            <Icon name="more" size={22} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Avatar name={p.name} size={92} />
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <AppText variant="title">
                {nameWithAge(p.name, p.age)}
              </AppText>
              {/* Presence is only claimed for a real profile with a live check-in. */}
              {p.hereNow && !seedById(p.id) && (
                <View style={styles.hereBadge}>
                  <View style={styles.dot} />
                  <AppText style={styles.hereText}>{t('indi zalda')}</AppText>
                </View>
              )}
            </View>
            <AppText variant="callout" color={palette.textSecondary} style={{ marginTop: 2 }}>
              {[t(p.level ?? 'Səviyyə göstərilməyib'), t(p.usualTime)].filter(Boolean).join(' · ')}
            </AppText>
            {score === null ? (
              <PressableScale
                activeScale={0.97}
                onPress={() => router.push('/(tabs)/profile/edit')}
                accessibilityRole="button"
                // The pill is ~28 pt tall; the slop lifts the touch area toward 44 pt
                // without changing how it looks (the parent's bounds still clip it).
                hitSlop={8}
                style={styles.unknownPill}>
                <Icon name="sliders" size={14} color={palette.textSecondary} />
                <AppText style={styles.unknownText}>{t(COMPAT_UNKNOWN)}</AppText>
              </PressableScale>
            ) : (
              <View style={styles.compatPill}>
                <AppText style={styles.compatText}>{t('{n}% uyğun', { n: score })}</AppText>
              </View>
            )}
          </View>
        </View>

        {/* No score = no comparison happened, so there is nothing to explain. The
            block is suppressed rather than filled with an app instruction. */}
        {score !== null && (pros.length > 0 || cons.length > 0) ? (
          <>
            <AppText variant="overline" color={palette.caption} style={styles.label}>
              {cons.length > 0 ? t('Uyğunluq təhlili') : t('Niyə uyğundur')}
            </AppText>
            {pros.map((r) => (
              <View key={r} style={styles.reasonRow}>
                <Icon name="check" size={16} color={palette.voltDeep} />
                <AppText variant="body">{t(r)}</AppText>
              </View>
            ))}
            {/* A mismatch never gets the green check — that is what made the score
                a black box in the first place. */}
            {cons.map((r) => (
              <View key={r} style={styles.reasonRow}>
                <Icon name="x" size={16} color={MISMATCH_COLOR} />
                <AppText variant="body" color={palette.textSecondary}>
                  {t(r)}
                </AppText>
              </View>
            ))}
          </>
        ) : null}

        {p.prs.length > 0 ? (
          <>
            <AppText variant="overline" color={palette.caption} style={styles.label}>
              {t('Şəxsi rekordlar')}
            </AppText>
            <View style={styles.prRow}>
              {p.prs.map((pr) => (
                <View key={pr.lift} style={styles.prCard}>
                  {/* 72,5 not 72.5 — Azerbaijani and Russian use a decimal comma. */}
                  <AppText variant="title2">{fmt.weight(pr.value)}</AppText>
                  <AppText variant="caption" color={palette.caption}>
                    {t('{lift} · kq', { lift: t(pr.lift) })}
                  </AppText>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <AppText variant="overline" color={palette.caption} style={styles.label}>
          {t('Məqsəd və məşq tipi')}
        </AppText>
        <View style={styles.tagWrap}>
          {[...p.goals, ...p.types].map((tag) => (
            <View key={tag} style={styles.softTag}>
              <AppText style={{ fontSize: 12.5, fontWeight: '600', color: palette.text3 }}>{t(tag)}</AppText>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: footerBottom }]}>
        {isBlocked ? (
          <AppText variant="footnote" color={palette.textSecondary} center style={{ paddingVertical: 6, lineHeight: 18 }}>
            {t(
              'Bu istifadəçini bloklamısan — o sənin siyahılarında görünmür. Blokun götürülməsi üçün yuxarıdakı «···» menyusundan istifadə et.'
            )}
          </AppText>
        ) : match?.state === 'accepted' ? (
          <Button
            title={t('Söhbətə keç')}
            icon="msg"
            full
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: p.id } })}
          />
        ) : match?.state === 'requested' ? (
          <>
            <AppText variant="footnote" color={palette.textSecondary} center style={{ marginBottom: 10, lineHeight: 18 }}>
              {t('Təklif göndərilib — {name} cavab verənə qədər söhbət açılmır.', { name: p.name })}
            </AppText>
            <Button
              title={t('Təklifə bax')}
              variant="secondary"
              full
              onPress={() => router.push({ pathname: '/(tabs)/discover/match', params: { id: p.id } })}
            />
          </>
        ) : (
          <Button
            title={t('Məşq təklif et')}
            icon="dumbbell"
            full
            notify
            onPress={() => gate(() => router.push({ pathname: '/(tabs)/discover/match', params: { id: p.id } }), t('Yoldaş tapmaq üçün'))}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 24 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  hereBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(198,255,61,0.28)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.voltDeep },
  hereText: { fontSize: 10.5, fontWeight: '700', color: palette.voltText },
  compatPill: { alignSelf: 'flex-start', backgroundColor: palette.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 10 },
  compatText: { color: palette.volt, fontSize: 13, fontWeight: '700' },
  unknownPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: palette.grouped, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, marginTop: 10 },
  unknownText: { color: palette.textSecondary, fontSize: 12, fontWeight: '600' },
  label: { marginTop: 22, marginBottom: 10 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  prRow: { flexDirection: 'row', gap: 9 },
  prCard: { flex: 1, backgroundColor: palette.grouped, borderRadius: 14, padding: 14, alignItems: 'center' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  softTag: { backgroundColor: palette.grouped, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  // paddingBottom is set inline from the safe-area inset (see `footerBottom`).
  footer: { paddingHorizontal: spacing.screen, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
  /* A 44 pt hit area around the 22 pt glyph. The negative margin gives back the 11 pt
     of padding on the edge side, so the glyph stays aligned with the screen gutter —
     only the touch area grew. (Not hitSlop: on Android a hit slop is clipped to the
     parent, and NavBar's right slot is only as tall as its content.) */
  moreBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -11 },
});

// Real people on this screen: not reachable as a guest by any route.
export default memberOnly(PartnerDetail);
