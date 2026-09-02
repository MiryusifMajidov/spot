import AsyncStorage from '@react-native-async-storage/async-storage';
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
    AsyncStorage.setItem(PHOTOS_KEY, JSON.stringify(next)).catch(() => {});
  };

  const addPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled && res.assets[0]) savePhotos([res.assets[0].uri, ...photos].slice(0, 12));
  };

  const removePhoto = (uri: string) =>
    confirm('Fotonu sil', 'Bu foto siyahından silinəcək.', [
      { label: 'Ləğv et', style: 'cancel' },
      {
        label: 'Sil',
        style: 'destructive',
        onPress: () => {
          savePhotos(photos.filter((p) => p !== uri));
          toast('Foto silindi', 'info');
        },
      },
    ]);

  const goLog = () => router.push('/(tabs)/workout/weight');

  return (
    <Screen>
      <NavBar
        title="Progress"
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
          Progress fotoları
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
          <View style={styles.grid}>
            {photos.map((uri) => (
              <PressableScale key={uri} activeScale={0.96} haptic={false} onPress={() => removePhoto(uri)} style={styles.photo}>
                <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              </PressableScale>
            ))}
          </View>
        )}

        <Button title="Progress fotosu əlavə et" variant="secondary" icon="cam" full onPress={addPhoto} style={{ marginTop: 16 }} />
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
