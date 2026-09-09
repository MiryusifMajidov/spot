import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { getWeightHistory } from '@/lib/api';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useDb } from '@/store/db';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

const W = 300;
const H = 130;
const PHOTOS_KEY = 'spot-progress-photos';
/** Inside the app's DOCUMENT directory — the one place the OS does not empty
 *  behind our back. Still on this phone only: nothing here is ever uploaded. */
const PHOTO_DIR = 'progress-photos';

/**
 * Take ownership of a picked photo.
 *
 * ImagePicker hands back a copy in the app's CACHE directory, and Android's
 * storage cleaner (or Ayarlar → SPOT → Keşi təmizlə) and iOS's low-space purge
 * are both free to delete it whenever they like. The uri stayed in AsyncStorage,
 * so a private record somebody had been keeping for months quietly turned into a
 * row of empty tiles. Copying it into the document directory is what makes the
 * record survive; the uri we store is OUR file, not the picker's.
 *
 * Throws when the copy fails — storing the cache uri instead would be the same
 * silent loss with a new date on it.
 */
async function keepOnDevice(pickedUri: string): Promise<string> {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const ext = (pickedUri.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
  const dest = new File(dir, `p-${Date.now().toString(36)}.${ext.length > 4 ? 'jpg' : ext}`);
  await new File(pickedUri).copy(dest);
  return dest.uri;
}

/** True for a uri this screen copied into the document directory itself — the
 *  only files it is allowed to delete. Photos from older builds point at the
 *  picker's cache copy and are not ours to remove. */
const isOurs = (uri: string) => uri.startsWith(new Directory(Paths.document, PHOTO_DIR).uri);

/**
 * Unlink one of our own copies.
 *
 * Best effort by design: the list is what the person sees, so an unlink the OS
 * refuses must not keep the tile on screen. Every uri that leaves the list has to
 * come through here — these are body photos, and now that the file lives in the
 * document directory nothing else will ever clean it up.
 */
function deleteIfOurs(uri: string) {
  if (!isOurs(uri)) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone, or the OS refused — the entry still goes */
  }
}

function chart(weights: number[]) {
  const min = Math.min(...weights) - 0.6;
  const max = Math.max(...weights) + 0.6;
  const span = max - min || 1;
  const stepX = W / Math.max(1, weights.length - 1);
  return weights.map((w, i) => ({ x: i * stepX, y: H - ((w - min) / span) * H }));
}

export default function Progress() {
  const router = useRouter();
  // The engine is authoritative: every weigh-in goes through db.logWeight, so this is
  // the user's real history. Supabase can only ADD points it has and we don't.
  const local = useDb((s) => s.weights);
  const [remote, setRemote] = useState<number[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  /* Photos whose file the device could not open any more.
     New picks are copied into the document directory (keepOnDevice) and no longer
     evaporate, but every photo saved by an earlier build still points at the
     picker's cache copy — which Android's storage cleaner and iOS's low-space
     purge may already have deleted. Those used to draw a row of blank rectangles
     with no error and no explanation, on the one record the screen promises to
     keep, so the tile says so instead. */
  const [missing, setMissing] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig) return;
      let alive = true;
      getWeightHistory()
        .then((h) => {
          if (alive && h.length) setRemote(h);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [])
  );

  useEffect(() => {
    AsyncStorage.getItem(PHOTOS_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) setPhotos(arr.filter((x) => typeof x === 'string'));
        } catch {
          /* corrupt entry — ignore */
        }
      })
      .catch(() => {});
  }, []);

  const localValues = local.map((w) => w.kg);
  const weights = remote.length > localValues.length ? remote : localValues;

  const savePhotos = (next: string[]) => {
    setPhotos(next);
    setMissing((m) => m.filter((u) => next.includes(u)));
    AsyncStorage.setItem(PHOTOS_KEY, JSON.stringify(next)).catch(() => {});
  };

  const addPhoto = async () => {
    // Without asking, a hard refusal left this button completely inert: the sheet
    // never opened and nothing was said, so the app looked frozen. Same wording as
    // pickImage in lib/images.ts — the fix is in the device settings, not here.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast('Şəkil üçün icazə verilməyib — cihaz Ayarlarından SPOT-a qalereya icazəsi ver', 'error');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    let kept: string;
    try {
      kept = await keepOnDevice(res.assets[0].uri);
    } catch {
      // The list is not touched: an entry pointing at the cache copy would look
      // saved today and be an empty tile the next time the system needs space.
      toast('Foto telefonda saxlanıla bilmədi — yaddaşda yer olduğunu yoxlayıb yenidən cəhd et', 'error');
      return;
    }
    /* The list is capped at 12. While the entries pointed at the picker's cache
       the system reclaimed whatever fell off the end; the copies are OURS now, so
       dropping the row alone would leave a body photo sitting in the document
       directory forever with nothing on screen pointing at it. */
    const next = [kept, ...photos].slice(0, 12);
    photos.filter((p) => !next.includes(p)).forEach(deleteIfOurs);
    savePhotos(next);
  };

  const removePhoto = (uri: string) =>
    confirm('Fotonu sil', 'Bu foto siyahından silinəcək.', [
      { label: 'Ləğv et', style: 'cancel' },
      {
        label: 'Sil',
        style: 'destructive',
        onPress: () => {
          /* The file goes too, not just the row. These are body photos: dropping
             the uri and leaving the image in the app's document directory would
             keep it on the phone forever after the person had been told it was
             deleted. */
          deleteIfOurs(uri);
          savePhotos(photos.filter((p) => p !== uri));
          toast('Foto silindi', 'info');
        },
      },
    ]);

  const goLog = () => router.push('/(tabs)/workout/weight');

  return (
    <Screen>
      <NavBar
        title="İrəliləyiş"
        right={
          <PressableScale activeScale={0.9} onPress={goLog}>
            <Icon name="plus" size={22} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {weights.length === 0 ? (
          <View style={styles.emptyCard}>
            <Icon name="scale" size={28} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>
              Hələ çəki qeyd etməmisən
            </AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, lineHeight: 21, maxWidth: 260 }}>
              İlk ölçməni əlavə et — qrafik ikinci ölçmədən sonra görünəcək.
            </AppText>
            <Button title="Çəki qeyd et" icon="plus" onPress={goLog} style={{ marginTop: 18 }} />
          </View>
        ) : (
          <WeightCard weights={weights} />
        )}

        <AppText variant="overline" color={palette.caption} style={{ marginTop: 22, marginBottom: 10 }}>
          İrəliləyiş fotoları
        </AppText>
        <View style={styles.photoNote}>
          <Icon name="lock" size={16} color={palette.textSecondary} />
          <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 18 }}>
            Fotolar yalnız bu telefonda saxlanılır — heç yerə yüklənmir. Paylaşmaq şüurlu qərar olmalıdır.
          </AppText>
        </View>
        {photos.length === 0 ? (
          <View style={styles.photoEmpty}>
            <Icon name="cam" size={22} color={palette.tertiary} />
            <AppText variant="footnote" color={palette.textSecondary} center style={{ marginTop: 8, lineHeight: 18, maxWidth: 250 }}>
              Hələ foto yoxdur. Eyni işıq və eyni bucaqda çəkilən fotolar dəyişikliyi ən yaxşı göstərir.
            </AppText>
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              {photos.map((uri) =>
                missing.includes(uri) ? (
                  /* An empty rectangle would have said the photo is still there.
                     It is not: the file is gone and the only honest thing the tile
                     can do is say so and let it be cleared off the list. */
                  <PressableScale key={uri} activeScale={0.96} haptic={false} onPress={() => removePhoto(uri)} style={styles.photo}>
                    <Icon name="x" size={18} color={palette.tertiary} />
                    <AppText variant="caption" color={palette.textSecondary} center style={{ marginTop: 6, lineHeight: 14, paddingHorizontal: 6 }}>
                      Foto tapılmadı
                    </AppText>
                  </PressableScale>
                ) : (
                  <PressableScale key={uri} activeScale={0.96} haptic={false} onPress={() => removePhoto(uri)} style={styles.photo}>
                    <Image
                      source={{ uri }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      onError={() => setMissing((m) => (m.includes(uri) ? m : [...m, uri]))}
                    />
                  </PressableScale>
                )
              )}
            </View>
            {missing.length > 0 ? (
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 10, lineHeight: 18 }}>
                {missing.length} fotonun faylı telefonda tapılmadı — sistem keşi təmizləyəndə belə olur. Yenidən əlavə etmək lazımdır.
              </AppText>
            ) : null}
          </>
        )}

        <Button title="İrəliləyiş fotosu əlavə et" variant="secondary" icon="cam" full onPress={addPhoto} style={{ marginTop: 16 }} />
      </ScrollView>
    </Screen>
  );
}

function WeightCard({ weights }: { weights: number[] }) {
  const latest = weights[weights.length - 1];
  const delta = weights.length >= 2 ? latest - weights[0] : 0;
  const down = delta < 0;
  const pts = weights.length >= 2 ? chart(weights) : [];

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View>
          <AppText variant="title2">{latest} kq</AppText>
          {weights.length >= 2 ? (
            <View style={styles.changeRow}>
              <View style={{ transform: [{ rotate: down ? '180deg' : '0deg' }] }}>
                <Icon name="arrowU" size={13} color={down ? palette.voltDeep : palette.streak} />
              </View>
              <AppText variant="footnote" color={down ? palette.voltDeep : palette.streak} style={{ fontWeight: '600' }}>
                {delta > 0 ? '+' : ''}
                {delta.toFixed(1)} kq · {weights.length} ölçmə
              </AppText>
            </View>
          ) : (
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 5 }}>
              1 ölçmə · dəyişikliyi görmək üçün ikincisini əlavə et
            </AppText>
          )}
        </View>
        <AppText variant="subhead" color={palette.blue}>
          Çəki
        </AppText>
      </View>

      {pts.length >= 2 ? (
        <View style={styles.chartWrap}>
          <Svg width="100%" height={H + 20} viewBox={`-6 -10 ${W + 12} ${H + 20}`}>
            <Polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={palette.ink} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, i) => (
              <Circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 6 : 3.5} fill={i === pts.length - 1 ? palette.volt : palette.ink} stroke={i === pts.length - 1 ? palette.ink : 'none'} strokeWidth={2} />
            ))}
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 18 },
  emptyCard: { backgroundColor: palette.white, borderRadius: 18, padding: 24, alignItems: 'center' },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  chartWrap: { marginTop: 18 },
  photoNote: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: palette.white, borderRadius: 12, padding: 12, marginBottom: 12 },
  photoEmpty: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 14, paddingVertical: 26, paddingHorizontal: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: '31.5%', aspectRatio: 0.8, borderRadius: 12, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
