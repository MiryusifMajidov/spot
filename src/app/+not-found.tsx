/**
 * A link that points at no screen.
 *
 * Without this file expo-router renders its own built-in fallback — a black page
 * reading «Unmatched Route / Page could not be found», with «Go back» and
 * «Sitemap» links and the raw URL printed underneath. In an app whose interface
 * is Azerbaijani and nothing else, that is the one screen that answers a person
 * in English, and the Sitemap link opens a developer route listing that has no
 * business in anyone's hands but ours. It was reached on a real device by
 * opening a `spot://` link whose path did not match, which is exactly what a
 * stale share link, an old push payload or a typo in a message produces.
 *
 * The wording says what actually happened — the address does not exist — and
 * does not guess at a cause it cannot know.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { useT } from '@/lib/useT';
import { palette } from '@/theme';

export default function NotFound() {
  const router = useRouter();
  const t = useT();
  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar />
      <View style={styles.body}>
        <Icon name="search" size={30} color={palette.tertiary} />
        <AppText variant="headline" center style={{ marginTop: 14 }}>
          {t('Belə səhifə yoxdur')}
        </AppText>
        <AppText
          variant="body"
          color={palette.textSecondary}
          center
          style={{ marginTop: 8, maxWidth: 280, lineHeight: 21 }}
        >
          {t('Açmaq istədiyin ünvan SPOT-da tapılmadı. Keçid köhnəlmiş ola bilər.')}
        </AppText>
        <Button
          title={t('Ana səhifəyə qayıt')}
          onPress={() => router.replace('/(tabs)/discover')}
          style={{ marginTop: 20, height: 46, paddingHorizontal: 22 }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
});
