import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { createCommunityPost } from '@/lib/api';
import { useGyms } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

export default function Compose() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const profile = useAppStore((s) => s.profile);
  const gyms = useGyms();
  const gymName = gyms.find((g) => g.id === profile.homeGymId)?.name ?? '';

  const post = async () => {
    if (!text.trim() || posting) return;
    if (!profile.name.trim()) {
      toast('Əvvəlcə profilində adını yaz — post adınla paylaşılır', 'error');
      return;
    }
    if (!hasSupabaseConfig) {
      toast('Post göndərilə bilmədi — server bağlantısı yoxdur', 'error');
      return;
    }
    setPosting(true);
    try {
      await createCommunityPost({ author: profile.name.trim(), gym: gymName, body: text.trim() });
    } catch {
      setPosting(false);
      toast('Post göndərilə bilmədi. Yenidən cəhd et.', 'error');
      return;
    }
    toast('Postun paylaşıldı');
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar
        title="Yeni post"
        right={<Button title="Paylaş" variant="volt" disabled={!text.trim() || posting} onPress={post} />}
      />
      <View style={styles.body}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Nə paylaşmaq istəyirsən? Nailiyyət, sual və ya motivasiya…"
          placeholderTextColor={palette.caption}
          multiline
          autoFocus
          style={styles.input}
        />
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 8 }}>
          {gymName ? `${gymName} · community feed-də görünəcək` : 'Community feed-də görünəcək'}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.screen, flex: 1, paddingTop: 8 },
  input: { fontSize: 17, color: palette.inkText, lineHeight: 24, minHeight: 120, textAlignVertical: 'top' },
});
