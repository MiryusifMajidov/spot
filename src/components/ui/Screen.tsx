import { ReactNode } from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';

import { colors, dark as darkTokens, spacing } from '@/theme';

type Props = {
  children: ReactNode;
  dark?: boolean;
  scroll?: boolean;
  padded?: boolean;
  edges?: readonly Edge[];
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

/** Safe-area screen container. Light by default; `dark` for immersive screens. */
export function Screen({ children, dark, scroll, padded, edges = ['top'], contentContainerStyle, style }: Props) {
  const bg = dark ? darkTokens.bg : colors.bg;
  const pad = padded ? { paddingHorizontal: spacing.screen } : null;

  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: bg }, style]}>
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[pad, contentContainerStyle]}
          contentInsetAdjustmentBehavior="automatic">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, pad, contentContainerStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
