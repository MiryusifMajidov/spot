import { useRouter } from 'expo-router';
import { ReactNode, useEffect, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { KeyboardLift, useKeyboardLift } from '@/components/ui/KeyboardLift';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { palette, spacing } from '@/theme';

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
        <PressableScale activeScale={0.9} onPress={() => router.back()} style={styles.back}>
          <Icon name="chevL" size={26} color={palette.blue} />
        </PressableScale>
        <View style={styles.progress}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View key={i} style={[styles.progressSeg, { backgroundColor: i < step ? palette.ink : palette.separator }]} />
          ))}
        </View>
        <PressableScale activeScale={0.92} onPress={onSkip} style={styles.skip}>
          <AppText variant="body" color={onSkip ? palette.blue : 'transparent'}>
            Keç
          </AppText>
        </PressableScale>
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
        <Button title={nextLabel} onPress={onNext} disabled={nextDisabled} full />
      </KeyboardLift>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, height: 44, gap: 10 },
  back: { width: 30, justifyContent: 'center' },
  progress: { flex: 1, flexDirection: 'row', gap: 5 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  skip: { width: 36, alignItems: 'flex-end' },
  content: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 24 },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 6 },
});
