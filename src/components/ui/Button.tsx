import { ReactNode } from 'react';
import { successFeedback } from '@/lib/feedback';
import { AccessibilityState, Insets, StyleSheet, View, ViewStyle } from 'react-native';

import { colors, palette, radius } from '@/theme';
import { AppText } from './AppText';
import { Icon, IconName } from '../Icon';
import { PressableScale } from './PressableScale';

type Variant = 'primary' | 'secondary' | 'volt' | 'plain';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  full?: boolean;
  style?: ViewStyle;
  notify?: boolean; // stronger haptic on press
  /** Passed through so a button can say more than its title, keep a 44 pt target
   *  when it is drawn smaller, or report busy/disabled to a screen reader. */
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  hitSlop?: number | Insets;
};

/* The design's button rules: every primary action is the volt CTA with ink text
   (`primary` and `volt` are the same button now — the ink primary is gone), the
   secondary is #EDEDED with no border, and a disabled CTA turns #FEFEFE with grey
   text rather than fading. */
const surface: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: palette.cta },
  volt: { backgroundColor: palette.cta },
  secondary: { backgroundColor: palette.element },
  plain: { backgroundColor: 'transparent' },
};

const textColor: Record<Variant, string> = {
  primary: palette.ctaText,
  volt: palette.ctaText,
  secondary: palette.inkText,
  plain: colors.link,
};

const isCta = (v: Variant) => v === 'primary' || v === 'volt';

export function Button({ title, onPress, variant = 'primary', icon, disabled, full, style, notify, accessibilityLabel, accessibilityState, hitSlop }: Props) {
  return (
    <PressableScale
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      hitSlop={hitSlop}
      onPress={() => {
        if (notify) successFeedback();
        onPress?.();
      }}
      style={[
        styles.base,
        surface[variant],
        full && { alignSelf: 'stretch' },
        /* The hairline is ours, not the design's: the design only draws a disabled
           CTA on the #F7F7F7 screen, and a #FEFEFE button inside a #FEFEFE card
           (claim, reserve, the sheets) was not there at all. */
        disabled &&
          (isCta(variant)
            ? { backgroundColor: palette.ctaDisabled, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.separator }
            : { opacity: 0.4 }),
        style,
      ]}>
      <View style={styles.row}>
        {icon ? <Icon name={icon} size={20} color={disabled && isCta(variant) ? palette.tertiary : textColor[variant]} /> : null}
        <AppText variant="headline" color={disabled && isCta(variant) ? palette.tertiary : textColor[variant]}>
          {title}
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 50,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
