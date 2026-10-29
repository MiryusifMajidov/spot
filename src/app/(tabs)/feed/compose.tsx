import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { createCommunityPost } from '@/lib/api';
import { useGyms } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { hitSlop, palette, radius, spacing, inputTint } from '@/theme';

export default function Compose() {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const profile = useAppStore((s) => s.profile);
  const gyms = useGyms();
  const gymName = gyms.find((g) => g.id === profile.homeGymId)?.name ?? '';
  const hasText = !!text.trim();

  const post = async () => {
    if (!text.trim() || posting) return;
    if (!profile.name.trim()) {
      toast(t('Əvvəlcə profilində adını yaz — post adınla paylaşılır'), 'error');
      return;
    }
    if (!hasSupabaseConfig) {
      toast(t('Post göndərilə bilmədi — server bağlantısı yoxdur'), 'error');
      return;
    }
    setPosting(true);
    try {
      await createCommunityPost({ author: profile.name.trim(), gym: gymName, body: text.trim() });
    } catch {
      setPosting(false);
      toast(t('Post göndərilə bilmədi. Yenidən cəhd et.'), 'error');
      return;
    }
    toast(t('Postun paylaşıldı'));
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']} contentContainerStyle={styles.sheet}>
      <NavBar
        title={t('Yeni post')}
        right={
          /* A compact pill sized for the 44 pt NavBar row. The shared <Button> is a
             52 pt tall CTA — in this row it overflowed the bar and was clipped by
             the sheet's rounded top-right corner on iOS. hitSlop keeps the tap
             area at 34 + 16 = 50 pt. Empty text turns it into the design's disabled
             CTA (not just faded); while posting it stays volt and shows a spinner. */
          <PressableScale
            activeScale={0.94}
            hitSlop={hitSlop}
            disabled={!hasText || posting}
            onPress={post}
            accessibilityRole="button"
            accessibilityLabel={t('Paylaş')}
            accessibilityState={{ disabled: !hasText || posting, busy: posting }}
            style={[styles.postPill, !hasText && !posting && styles.postPillOff]}>
            {posting ? (
              <ActivityIndicator size="small" color={palette.ctaText} />
            ) : (
              <AppText variant="callout" color={hasText ? palette.ctaText : palette.tertiary}>
                {t('Paylaş')}
              </AppText>
            )}
          </PressableScale>
        }
      />
      <View style={styles.body}>
        <TextInput {...inputTint}
          value={text}
          onChangeText={setText}
          placeholder={t('Nə paylaşmaq istəyirsən? Nailiyyət, sual və ya motivasiya…')}
          placeholderTextColor={palette.caption}
          multiline
          autoFocus
          style={styles.input}
        />
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 8 }}>
          {/* Same names the feed toggle shows: with a home gym the post lands in
              «Zalım» (that gym only), without one in «İcma» (every gym). */}
          {gymName ? t('{gym} · «Zalım» bölməsində görünəcək', { gym: gymName }) : t('«İcma» bölməsində görünəcək')}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /* On iOS this modal is a page sheet: no top safe-area inset and large rounded
     corners, so the header needs a little air above it. On Android the modal is
     full screen and the top-edged SafeAreaView already clears the status bar. */
  sheet: { paddingTop: Platform.OS === 'ios' ? spacing.sm : 0 },
  postPill: {
    minWidth: 84,
    height: 34,
    paddingHorizontal: spacing.base,
    borderRadius: radius.pill,
    backgroundColor: palette.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* The design's disabled CTA: #FEFEFE with grey text, a pill against the #F7F7F7
     sheet rather than a faded volt one. */
  postPillOff: { backgroundColor: palette.ctaDisabled },
  body: { paddingHorizontal: spacing.screen, flex: 1, paddingTop: 8 },
  input: { fontSize: 17, color: palette.inkText, lineHeight: 24, minHeight: 120, textAlignVertical: 'top' },
});
