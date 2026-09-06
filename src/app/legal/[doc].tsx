import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { LEGAL, LegalDoc } from '@/lib/legal';
import { palette, spacing } from '@/theme';

/**
 * İstifadə şərtləri / Məxfilik siyasəti / İcma qaydaları.
 *
 * Onboarding has always said «Davam etməklə İstifadə şərtləri və Məxfilik
 * siyasəti ilə razılaşırsan» over plain text with nothing behind it. This is
 * the something. It renders from `lib/legal.ts` and needs no network, so the
 * documents are readable before an account exists and while offline — which is
 * exactly when somebody is being asked to agree to them.
 */
export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const key = (['terms', 'privacy', 'rules'] as LegalDoc[]).includes(doc as LegalDoc)
    ? (doc as LegalDoc)
    : 'terms';
  const c = LEGAL[key];

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title={c.title} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppText variant="caption" color={palette.caption}>
          Son yenilənmə: {c.updated}
        </AppText>
        <AppText variant="body" color={palette.text3} style={styles.intro}>
          {c.intro}
        </AppText>

        {c.sections.map((sec) => (
          <View key={sec.heading ?? sec.body[0]} style={styles.section}>
            {sec.heading ? (
              <AppText variant="headline" style={{ marginBottom: 8 }}>
                {sec.heading}
              </AppText>
            ) : null}
            {sec.body.map((line) => (
              <AppText key={line} variant="body" color={palette.text3} style={styles.line}>
                {line}
              </AppText>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 48 },
  intro: { marginTop: 10, lineHeight: 22 },
  section: { marginTop: 26 },
  line: { lineHeight: 22, marginBottom: 8 },
});
