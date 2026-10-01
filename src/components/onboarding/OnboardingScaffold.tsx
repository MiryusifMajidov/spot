import { useRouter } from 'expo-router';
import { ReactNode, useEffect, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { KeyboardLift, useKeyboardLift } from '@/components/ui/KeyboardLift';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useT } from '@/lib/useT';
import { iconSize, palette, spacing } from '@/theme';

export function OnboardingScaffold({
  step,
  totalSteps = 5,
  title,
  subtitle,
  onNext,
  nextLabel = 'Davam et',
  nextDisabled,
  onSkip,
  children,
}: {
  step: number;
  totalSteps?: number;
  title: string;
  subtitle?: string;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onSkip?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const router = useRouter();

  /* Android edge-to-edge does not resize the window when the keyboard opens, and an
     onboarding step is shorter than the screen — so without this the ScrollView has zero
     scroll range and the last field (the Bio box on step 5) plus «Davam et» are simply
     buried, with the text being typed invisible. Lifting the footer is a layout change,
     so the ScrollView above it shrinks by the same amount and becomes scrollable.
     Fixed here, in the shared scaffold, so every step gets it. */
  const lift = useKeyboardLift();
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const lifted = useRef(0);
  useEffect(() => {
    const delta = lift - lifted.current;
    lifted.current = lift;
    // Scroll by exactly what the scroller lost, so the field just tapped stays put.
    if (delta > 0) scroller.current?.scrollTo({ y: scrollY.current + delta, animated: true });
  }, [lift]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        {/* The first step is usually reached with router.replace (welcome, the auth
            callback), so there is nothing behind it and the chevron did nothing when
            tapped. Then a spacer of the same width keeps the progress bar centred. */}
        {router.canGoBack() ? (
          <PressableScale
            activeScale={0.9}
            onPress={() => router.back()}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel={t('Geri')}>
            <Icon name="chevL" size={iconSize.action} color={palette.inkText} />
          </PressableScale>
        ) : (
          <View style={styles.skipSpacer} />
        )}
        <View style={styles.progress}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View key={i} style={[styles.progressSeg, { backgroundColor: i < step ? palette.ink : palette.separator }]} />
          ))}
        </View>
        {/* Without onSkip there is no button at all — an invisible «Keç» used to sit
            here, still tappable and still read out by a screen reader. The spacer takes
            the same room as the back box, so the progress bar stays centred. */}
        {onSkip ? (
          <PressableScale activeScale={0.92} onPress={onSkip} style={styles.skip} accessibilityRole="button">
            <AppText variant="body" numberOfLines={1} color={palette.inkText} style={{ fontWeight: '500' }}>
              {t('Keç')}
            </AppText>
          </PressableScale>
        ) : (
          <View style={styles.skipSpacer} />
        )}
      </View>

      {/* «handled»: with the default the ScrollView swallows the first tap while a field
          is focused, so tapping a gym card after searching only dismissed the keyboard
          and selected nothing. */}
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}>
        <AppText variant="title" style={{ marginBottom: subtitle ? 8 : 20 }}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="body" color={palette.textSecondary} style={{ marginBottom: 22, lineHeight: 21 }}>
            {subtitle}
          </AppText>
        ) : null}
        {children}
      </ScrollView>

      <KeyboardLift extra={8} style={styles.footer}>
        <Button title={t(nextLabel)} onPress={onNext} disabled={nextDisabled} full />
      </KeyboardLift>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, height: 44, gap: 10 },
  /* 44x44 tap areas, the iOS and Material minimum (the back box was 30 wide, «Keç»
     only as tall as its text). Same geometry as NavBar: each box grows 10 pt toward
     the screen edge (negative margin + matching padding), so the glyphs stay at the
     gutter and each takes 34 pt of the row. */
  back: { width: 44, height: 44, marginLeft: -10, paddingLeft: 10, justifyContent: 'center' },
  progress: { flex: 1, flexDirection: 'row', gap: 5 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  // minWidth, not width: «Пропустить» is far wider than «Keç» and did not fit in 36 pt.
  skip: { minWidth: 44, height: 44, marginRight: -10, paddingRight: 10, alignItems: 'flex-end', justifyContent: 'center' },
  skipSpacer: { width: 34 },
  content: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 24 },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 6 },
});
