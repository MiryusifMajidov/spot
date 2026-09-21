import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { CONTACT, LEGAL, LegalDoc, OPERATOR } from '@/lib/legal';
import { useLang, useT } from '@/lib/useT';
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
  const t = useT();
  const lang = useLang();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  // Filled into the two lines that name who runs SPOT (see lib/legal.ts).
  const who = { operator: OPERATOR, contact: CONTACT };
  const key = (['terms', 'privacy', 'rules'] as LegalDoc[]).includes(doc as LegalDoc)
    ? (doc as LegalDoc)
    : 'terms';
  const c = LEGAL[key];

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title={t(c.title)} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppText variant="caption" color={palette.caption}>
          {t('Son yenilənmə: {date}', { date: t(c.updated) })}
        </AppText>
        {/* A translation of a legal text is a convenience, not the text. Said
            once, at the top, in the reader's own language — the alternative is
            a Russian reader who agreed to a Russian sentence that is not what
            the binding Azerbaijani one says, and nobody told them which counts. */}
        {lang !== 'az' ? (
          <View style={styles.notice}>
            <AppText variant="footnote" color={palette.textSecondary} style={{ lineHeight: 18 }}>
              {t('Bu, tərcümədir. Hüquqi qüvvəsi olan mətn Azərbaycan dilindəki versiyadır; fərq olarsa, o əsas götürülür.')}
            </AppText>
          </View>
        ) : null}
        <AppText variant="body" color={palette.text3} style={styles.intro}>
          {t(c.intro)}
        </AppText>

        {c.sections.map((sec) => (
          <View key={sec.heading ?? sec.body[0]} style={styles.section}>
            {sec.heading ? (
              <AppText variant="headline" style={{ marginBottom: 8 }}>
                {t(sec.heading)}
              </AppText>
            ) : null}
            {sec.body.map((line) => (
              <AppText key={line} variant="body" color={palette.text3} style={styles.line}>
                {t(line, who)}
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
  notice: { backgroundColor: palette.grouped, borderRadius: 12, padding: 12, marginTop: 12 },
  section: { marginTop: 26 },
  line: { lineHeight: 22, marginBottom: 8 },
});
