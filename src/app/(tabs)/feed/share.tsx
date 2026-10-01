import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { uploadFeedVideo } from '@/lib/api';
import { decimal } from '@/lib/format';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { useAllPrograms } from '@/store/db';
import { actionSheet, toast } from '@/store/ui';
import { hitSlop, palette, radius, spacing } from '@/theme';

export default function Share() {
  const t = useT();
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
  /** «Bağla» and the sheet's swipe-down both stay live during an upload — the
   *  upload keeps going in the background, which is fine. But its success path
   *  ends in router.back(): run after this sheet is already gone, that call
   *  pops whatever screen the person has moved on to. */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // set here too: StrictMode runs cleanup + effect again in dev
    return () => {
      mounted.current = false;
    };
  }, []);

  /** 100 MB is the videos bucket's own limit (schema33); refusing here means the
   *  person is told before a long upload, not after it. */
  const MAX_BYTES = 100 * 1024 * 1024;
  const MAX_SECONDS = 60;

  const accept = (a: ImagePicker.ImagePickerAsset) => {
    /* Checked from the PICKER's metadata, before the file is opened. The upload
       used to do `fetch(uri).arrayBuffer()` straight away — a 4K clip from the
       phone's camera is 200 MB+ and that call pulls the whole thing into JS
       memory, which is how the app runs out of memory mid-upload. `videoMaxDuration`
       only caps recording INSIDE the picker; a file chosen from the gallery is
       not trimmed by it, so the length is checked here too. */
    const secs = a.duration != null ? Math.round(a.duration / 1000) : null;
    if (secs != null && secs > MAX_SECONDS) {
      toast(t('Video {n} saniyədir — {max} saniyəyə qədər olmalıdır. Qısaldıb yenidən seç.', { n: secs, max: MAX_SECONDS, count: secs }), 'error');
      return;
    }
    if (a.fileSize != null && a.fileSize > MAX_BYTES) {
      /* One decimal, comma-separated: a 100,4 MB clip rounded to whole MB read as
         «Video 100 MB-dır — 100 MB-a qədər qəbul olunur», i.e. the app refusing a
         file that fits. The decimal separator in Azerbaijani is a comma. */
      toast(
        t('Video {size} MB-dır — {max} MB-a qədər qəbul olunur. Telefonun kamera ayarından daha aşağı keyfiyyət seç.', {
          size: decimal(a.fileSize / 1048576),
          max: Math.round(MAX_BYTES / 1048576),
        }),
        'error'
      );
      return;
    }
    setUri(a.uri);
    setMeta({ durationSec: secs, sizeBytes: a.fileSize ?? null });
  };

  /* Both pickers throw on iOS for reasons that are not «cancelled» (no camera,
     a missing usage key, a picker that would not present) — and an unhandled
     rejection here did nothing at all: no picker, no message. */
  const fromLibrary = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 0.8, videoMaxDuration: MAX_SECONDS });
      if (res.canceled || !res.assets[0]) return;
      accept(res.assets[0]);
    } catch {
      toast(t('Video açılmadı'), 'error');
    }
  };

  /* The card says «Video çək və ya seç» and there was no way to çək: this screen
     only ever opened the gallery. Somebody who finished a set and came here to
     film it had nothing to pick and nothing to record, so their first video never
     happened. `videoMaxDuration` does cap the recording itself. */
  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      toast(t('Kamera üçün icazə verilməyib — cihaz Ayarlarından SPOT-a kamera icazəsi ver'), 'error');
      return;
    }
    try {
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], quality: 0.8, videoMaxDuration: MAX_SECONDS });
      if (res.canceled || !res.assets[0]) return;
      accept(res.assets[0]);
    } catch {
      toast(t('Video açılmadı'), 'error');
    }
  };

  const pick = () =>
    actionSheet({
      title: t('Texnika videosu'),
      message: t('Maksimum {n} saniyə.', { n: MAX_SECONDS, count: MAX_SECONDS }),
      actions: [
        { label: t('Çək'), onPress: fromCamera },
        { label: t('Qalereyadan seç'), onPress: fromLibrary },
        { label: t('Ləğv et'), style: 'cancel' as const },
      ],
    });

  // Real picker over the programs that actually exist (the user's own first, then the
  // catalog) — the video's "Proqrama bax" card must point somewhere that opens.
  const pickProgram = () =>
    actionSheet({
      title: t('Proqrama bağla'),
      message: t('Videon həmin proqramın altında toplanır.'),
      actions: [
        ...programs.slice(0, 10).map((p) => ({ label: p.title, onPress: () => setLinked({ id: p.id, title: p.title }) })),
        ...(linked ? [{ label: t('Bağlantını sil'), style: 'destructive' as const, onPress: () => setLinked(null) }] : []),
        { label: t('Ləğv et'), style: 'cancel' as const },
      ],
    });

  const publish = async () => {
    if (!uri) {
      pick();
      return;
    }
    if (!profile.name.trim()) {
      toast(t('Əvvəlcə profilində adını yaz — video adınla paylaşılır'), 'error');
      return;
    }
    if (!hasSupabaseConfig) {
      toast(t('Video yüklənə bilmədi — server bağlantısı yoxdur'), 'error');
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
        toast(t('Video {n} MB-dır — 100 MB-a qədər qəbul olunur.', { n: mb }), 'error');
      } else if (msg === 'video-read-failed') {
        toast(t('Video faylı oxunmadı — başqa video seç.'), 'error');
      } else if (msg === 'no profile') {
        toast(t('Profil yüklənmədi — video yalnız hesabla paylaşılır.'), 'error');
      } else {
        toast(t('Video yüklənə bilmədi'), 'error');
      }
      return;
    }
    toast(t('Videon feed-ə əlavə olundu'));
    if (mounted.current) router.back();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      {/* Only the iOS page sheet can be dragged down; on Android `presentation:
          'modal'` is a full-screen page, where a grabber promises a gesture that
          does nothing. */}
      {Platform.OS === 'ios' && <View style={styles.grabber} />}
      {/* The buttons take their own width and the title takes the space between
          them. Two equal flex:1 side slots would centre the title exactly, but they
          also cap each button at half of what is left: in Russian «Опубликовать»
          (115 pt) no longer fits beside «Новое видео» on a 360–390 pt phone, so the
          word broke onto two lines. Each button is a full 44 pt tap target; the bare
          text used to be ~22 pt tall. */}
      <View style={styles.header}>
        <PressableScale
          haptic={false}
          activeScale={0.94}
          onPress={() => router.back()}
          hitSlop={hitSlop}
          accessibilityRole="button"
          style={styles.headerBtn}>
          <AppText variant="body" color={palette.blue}>
            {t('Bağla')}
          </AppText>
        </PressableScale>
        <AppText variant="headline" numberOfLines={1} center style={styles.title}>
          {t('Yeni video')}
        </AppText>
        <PressableScale
          haptic={false}
          activeScale={0.94}
          onPress={publish}
          disabled={!uri || uploading}
          hitSlop={hitSlop}
          accessibilityRole="button"
          accessibilityState={{ disabled: !uri || uploading, busy: uploading }}
          style={[styles.headerBtn, styles.headerBtnEnd]}>
          {/* While uploading, the label stays in the layout (just invisible) with
              the spinner over it, so the button keeps its width and the title does
              not jump sideways. */}
          <AppText variant="headline" color={uri ? palette.blue : palette.tertiary} style={uploading && styles.hidden}>
            {t('Paylaş')}
          </AppText>
          {uploading && <ActivityIndicator color={palette.blue} style={StyleSheet.absoluteFill} />}
        </PressableScale>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PressableScale activeScale={0.98} onPress={pick} style={[styles.videoPick, uri && styles.videoPicked]}>
          <View style={[styles.videoIcon, uri && { backgroundColor: 'rgba(198,255,61,0.30)' }]}>
            <Icon name={uri ? 'check' : 'cam'} size={26} color={uri ? palette.volt : palette.white} />
          </View>
          <AppText variant="headline" color={palette.white} style={{ marginTop: 12 }}>
            {uri ? t('Video seçildi') : t('Video çək və ya seç')}
          </AppText>
          <AppText variant="footnote" color="rgba(255,255,255,0.5)" style={{ marginTop: 4 }}>
            {uri ? t('Dəyişmək üçün toxun') : t('Çək və ya qalereyadan seç · maksimum {n} saniyə', { n: MAX_SECONDS, count: MAX_SECONDS })}
          </AppText>
        </PressableScale>

        <AppText variant="overline" color={palette.caption} style={styles.label}>
          {t('Təsvir')}
        </AppText>
        <TextInput
          value={caption}
          onChangeText={setCaption}
          placeholder={t('Nə göstərirsən? Hansı hərəkət?')}
          placeholderTextColor={palette.caption}
          multiline
          style={styles.input}
        />

        <AppText variant="overline" color={palette.caption} style={styles.label}>
          {t('Proqrama bağla · istəyə bağlı')}
        </AppText>
        <PressableScale activeScale={0.98} onPress={pickProgram} style={styles.linkRow}>
          <View style={[styles.linkIcon, linked && { backgroundColor: 'rgba(198,255,61,0.30)' }]}>
            <Icon name="dumbbell" size={18} color={linked ? palette.voltDeep : palette.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="callout">{linked?.title ?? t('Proqram seç')}</AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
              {t('Feed strukturlu olur — videonun altında proqrama keçid görünür')}
            </AppText>
          </View>
          <Icon name={linked ? 'check' : 'chevR'} size={18} color={linked ? palette.voltDeep : palette.tertiary} />
        </PressableScale>

        <View style={styles.note}>
          {/* 16 px with a 1 px drop centres the glyph on the first 18 px text line. */}
          <View style={styles.noteIcon}>
            <Icon name="users" size={16} color={palette.textSecondary} />
          </View>
          <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 18 }}>
            {t('Video hamıya görünür və adınla paylaşılır. Yalnız öz zalına göstərmək hələ mümkün deyil.')}
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: palette.separator, marginTop: 8, marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.screen, paddingVertical: 2 },
  title: { flex: 1 },
  headerBtn: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  headerBtnEnd: { alignItems: 'flex-end' },
  hidden: { opacity: 0 },
  content: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 24 },
  videoPick: { height: 200, borderRadius: 18, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  videoPicked: { borderWidth: 2, borderColor: palette.volt },
  videoIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: 22, marginBottom: 10 },
  input: { backgroundColor: palette.white, borderRadius: radius.field, borderWidth: 1, borderColor: palette.separator, paddingHorizontal: 14, paddingTop: 12, height: 88, fontSize: 16, color: palette.inkText, textAlignVertical: 'top' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 14 },
  linkIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 18, paddingHorizontal: 4 },
  noteIcon: { marginTop: 1 },
});
