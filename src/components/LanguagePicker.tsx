import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { Lang, LANG_NAMES, LANGS } from '@/lib/i18n';
import { useLang } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { palette, radius } from '@/theme';

/**
 * Choosing the language.
 *
 * Each option is written in its OWN language — «Русский», not «Rus dili». A
 * person who is here BECAUSE they cannot read Azerbaijani must be able to find
 * their language without reading Azerbaijani, which is the one thing a
 * translated label would prevent.
 *
 * For the same reason this appears on the sign-in gate and not only in
 * Settings: Settings sits behind an account, and an account is created on a
 * form the person may not be able to read.
 */
export function LanguagePicker({ compact, tone = 'light' }: { compact?: boolean; tone?: 'light' | 'dark' }) {
  const lang = useLang();
  const setLang = useAppStore((s) => s.setLang);

  return (
    <View style={[styles.row, compact ? styles.rowCompact : null]}>
      {LANGS.map((code: Lang) => {
        const on = code === lang;
        return (
          <PressableScale
            key={code}
            activeScale={0.96}
            haptic={false}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={LANG_NAMES[code]}
            onPress={() => setLang(code)}
            style={[
              styles.item,
              compact ? styles.itemCompact : null,
              tone === 'dark' ? styles.itemDark : null,
              on ? styles.itemOn : null,
            ]}>
            <AppText
              variant={compact ? 'footnote' : 'subhead'}
              color={on ? palette.ink : tone === 'dark' ? 'rgba(255,255,255,0.72)' : palette.textSecondary}
              numberOfLines={1}>
              {LANG_NAMES[code]}
            </AppText>
            {on && !compact ? <Icon name="check" size={14} color={palette.ink} /> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  rowCompact: { gap: 6 },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: palette.separator,
    backgroundColor: palette.white,
    paddingHorizontal: 8,
  },
  itemCompact: { height: 32, borderRadius: 16, paddingHorizontal: 12, flex: 0 },
  // The gate screen is dark, and a white chip row on it reads as a form the
  // person has to fill in before they can get past it.
  itemDark: { backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.18)' },
  itemOn: { backgroundColor: palette.volt, borderColor: palette.volt },
});
