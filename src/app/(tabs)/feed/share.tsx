import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { uploadFeedVideo } from '@/lib/api';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { useAllPrograms } from '@/store/db';
import { actionSheet, toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

export default function Share() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const programs = useAllPrograms();
  const [caption, setCaption] = useState('');
  const [linked, setLinked] = useState<{ id: string; title: string } | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** What the picker reported about the chosen file — stored so the row can
   *  record the real duration and size instead of leaving them null. */
  const [meta, setMeta] = useState<{ durationSec: number | null; sizeBytes: number | null }>({
    durationSec: null,
    sizeBytes: null,
  });

  /** 100 MB is the videos bucket's own limit (schema33); refusing here means the
   *  person is told before a long upload, not after it. */
  const MAX_BYTES = 100 * 1024 * 1024;
  const MAX_SECONDS = 60;

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.8, videoMaxDuration: MAX_SECONDS });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];

    /* Checked from the PICKER's metadata, before the file is opened. The upload
       used to do `fetch(uri).arrayBuffer()` straight away — a 4K clip from the
       phone's camera is 200 MB+ and that call pulls the whole thing into JS
       memory, which is how the app runs out of memory mid-upload. `videoMaxDuration`
       only caps recording INSIDE the picker; a file chosen from the gallery is
       not trimmed by it, so the length is checked here too. */
    const secs = a.duration != null ? Math.round(a.duration / 1000) : null;
    if (secs != null && secs > MAX_SECONDS) {
      toast(`Video ${secs} saniyədir — ${MAX_SECONDS} saniyəyə qədər olmalıdır. Qısaldıb yenidən seç.`, 'error');
      return;
    }
    if (a.fileSize != null && a.fileSize > MAX_BYTES) {
      toast(
        `Video ${Math.round(a.fileSize / 1048576)} MB-dır — ${Math.round(MAX_BYTES / 1048576)} MB-a qədər qəbul olunur. Telefonun kamera ayarından daha aşağı keyfiyyət seç.`,
        'error'
      );
      return;
    }
    setUri(a.uri);
    setMeta({ durationSec: secs, sizeBytes: a.fileSize ?? null });
  };

  // Real picker over the programs that actually exist (the user's own first, then the
  // catalog) — the video's "Proqrama bax" card must point somewhere that opens.
  const pickProgram = () =>
    actionSheet({
      title: 'Proqrama bağla',
      message: 'Videon həmin proqramın altında toplanır.',
      actions: [
        ...programs.slice(0, 10).map((p) => ({ label: p.title, onPress: () => setLinked({ id: p.id, title: p.title }) })),
        ...(linked ? [{ label: 'Bağlantını sil', style: 'destructive' as const, onPress: () => setLinked(null) }] : []),
        { label: 'Ləğv et', style: 'cancel' as const },
      ],
    });

  const publish = async () => {
    if (!uri) {
      pick();
      return;
    }
    if (!profile.name.trim()) {
      toast('Əvvəlcə profilində adını yaz — video adınla paylaşılır', 'error');
      return;
    }
    if (!hasSupabaseConfig) {
      toast('Video yüklənə bilmədi — server bağlantısı yoxdur', 'error');
      return;
    }
    setUploading(true);
    try {
      await uploadFeedVideo({
        uri,
        caption: caption.trim() || 'Yeni video',
        author: profile.name.trim(),
        linkedProgramTitle: linked?.title ?? '',
        linkedProgramId: linked?.id ?? '',
        durationSec: meta.durationSec,
        sizeBytes: meta.sizeBytes,
      });
    } catch (e) {
      setUploading(false);
      // The reason matters: «yüklənə bilmədi» over a 300 MB file sends the person
      // to check their wifi over and over for a problem the network never had.
      const msg = String((e as Error)?.message ?? '');
      if (msg === 'video-too-large') {
        const mb = Math.round(((e as { sizeBytes?: number }).sizeBytes ?? 0) / 1048576);
        toast(`Video ${mb} MB-dır — 100 MB-a qədər qəbul olunur.`, 'error');
      } else if (msg === 'video-read-failed') {
        toast('Video faylı oxunmadı — başqa video seç.', 'error');
      } else if (msg === 'no profile') {
        toast('Profil yüklənmədi — video yalnız hesabla paylaşılır.', 'error');
      } else {
        toast('Video yüklənə bilmədi', 'error');
      }
      return;
    }
    toast('Videon feed-ə əlavə olundu');
    router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <PressableScale haptic={false} activeScale={0.94} onPress={() => router.back()}>
          <AppText variant="body" color={palette.blue}>
            Bağla
          </AppText>
        </PressableScale>
        <AppText variant="headline">Paylaş</AppText>
        {uploading ? (
          <ActivityIndicator color={palette.blue} />
        ) : (
          <PressableScale haptic={false} activeScale={0.94} onPress={publish} disabled={!uri}>
            <AppText variant="headline" color={uri ? palette.blue : palette.tertiary}>
              Paylaş
            </AppText>
          </PressableScale>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PressableScale activeScale={0.98} onPress={pick} style={[styles.videoPick, uri && styles.videoPicked]}>
          <View style={[styles.videoIcon, uri && { backgroundColor: 'rgba(198,255,61,0.30)' }]}>
            <Icon name={uri ? 'check' : 'cam'} size={26} color={uri ? palette.volt : palette.white} />
          </View>
          <AppText variant="headline" color={palette.white} style={{ marginTop: 12 }}>
            {uri ? 'Video seçildi' : 'Video çək və ya seç'}
          </AppText>
          <AppText variant="footnote" color="rgba(255,255,255,0.5)" style={{ marginTop: 4 }}>
            {uri ? 'Dəyişmək üçün toxun' : 'Qalereyadan seç · maksimum 60 saniyə'}
          </AppText>
        </PressableScale>

        <AppText variant="overline" color={palette.caption} style={styles.label}>
          Təsvir
        </AppText>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder="Nə göstərirsən? Hansı hərəkət?"
          placeholderTextColor={palette.caption}
          multiline
          style={styles.input}
        />

        <AppText variant="overline" color={palette.caption} style={styles.label}>
          Proqrama bağla · istəyə bağlı
        </AppText>
        <PressableScale activeScale={0.98} onPress={pickProgram} style={styles.linkRow}>
          <View style={[styles.linkIcon, linked && { backgroundColor: 'rgba(198,255,61,0.30)' }]}>
            <Icon name="dumbbell" size={18} color={linked ? palette.voltDeep : palette.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="callout">{linked?.title ?? 'Proqram seç'}</AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
              Feed strukturlu olur — videonun altında proqrama keçid görünür
            </AppText>
          </View>
          <Icon name={linked ? 'check' : 'chevR'} size={18} color={linked ? palette.voltDeep : palette.tertiary} />
        </PressableScale>

        <View style={styles.note}>
          <Icon name="users" size={15} color={palette.textSecondary} />
          <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 18 }}>
            Video hər kəsə açıq olur və adınla göstərilir. Yalnız zala görünmə hələ yoxdur — paylaşmadan əvvəl bunu nəzərə al.
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: palette.separator, marginTop: 8, marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingVertical: 8 },
  content: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 24 },
  videoPick: { height: 200, borderRadius: 18, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  videoPicked: { borderWidth: 2, borderColor: palette.volt },
  videoIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: 22, marginBottom: 10 },
  input: { backgroundColor: palette.white, borderRadius: radius.field, borderWidth: 1, borderColor: palette.separator, paddingHorizontal: 14, paddingTop: 12, height: 88, fontSize: 16, color: palette.inkText, textAlignVertical: 'top' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 14 },
  linkIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 18, paddingHorizontal: 4 },
});
