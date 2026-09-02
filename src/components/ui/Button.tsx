import { ReactNode } from 'react';
import { successFeedback } from '@/lib/feedback';
import { StyleSheet, View, ViewStyle } from 'react-native';

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
};

const surface: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: palette.ink },
  volt: { backgroundColor: palette.volt },
  secondary: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator },
  plain: { backgroundColor: 'transparent' },
};

const textColor: Record<Variant, string> = {
  primary: palette.white,
  volt: palette.inkText,
  secondary: palette.inkText,
  plain: colors.link,
};

export function Button({ title, onPress, variant = 'primary', icon, disabled, full, style, notify }: Props) {
  return (
    <PressableScale
      disabled={disabled}
      onPress={() => {
        if (notify) successFeedback();
        onPress?.();
      }}
      style={[styles.base, surface[variant], full && { alignSelf: 'stretch' }, disabled && { opacity: 0.4 }, style]}>
      <View style={styles.row}>
        {icon ? <Icon name={icon} size={19} color={textColor[variant]} /> : null}
        <AppText variant="headline" color={textColor[variant]}>
          {title}
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
