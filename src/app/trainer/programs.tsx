import { useRouter } from 'expo-router';

import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { LargeHeader } from '@/components/ui/LargeHeader';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Program } from '@/data/types';
import { removeProgram } from '@/lib/removeProgram';
import { useDb } from '@/store/db';
import { actionSheet, confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/**
 * A trainer's programs.
 *
 * THIS SCREEN USED TO BE A SECOND PROGRAM BUILDER, and it was the worse one.
 *
 * It asked for weeks, level, goal and minutes — the four questions the real
 * builder deliberately stopped asking — and offered no description field and no
 * way to add a single exercise. «Yarat» called `buildDays()`, which invented
 * days named Push / Pull / Ayaq with `exercises: []`, so a trainer's brand-new
 * program was three empty days they had not written. Everything went to
 * `useDb.createProgram`, which is AsyncStorage on that one phone, so a program
 * assigned to a student opened on the student's phone as «bu proqram hələ
 * SPOT-a yüklənməyib». The footer admitted all of it in small grey text.
 *
 * A trainer is not a different kind of author. They write a program in the same
 * builder as everybody else — where exercises, sets, repetitions, holds and
 * their own technique clips exist — and it reaches the server the same way, so
 * the student can actually open it. This screen is now what its name says: the
 * list, with a way in.
 */
export default function TrainerPrograms() {
  const router = useRouter();
  const programs = useDb((s) => s.myPrograms);

  const openNew = () => router.push('/(tabs)/workout/create');
  const openEdit = (p: Program) => router.push({ pathname: '/(tabs)/workout/create', params: { id: p.id } });

  const rowMenu = (p: Program) =>
    actionSheet({
      title: p.title,
      actions: [
        { label: 'Redaktə et', onPress: () => openEdit(p) },
        {
          label: 'Sil',
          style: 'destructive',
          onPress: () =>
            confirm(
              'Proqramı silmək?',
              `«${p.title}» siyahından silinəcək. Şagirdə artıq təyin etmisənsə, ona yenidən proqram təyin etməlisən.`,
              [
                { label: 'Ləğv et', style: 'cancel' },
                {
                  label: 'Sil',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      const r = await removeProgram(p.id);
                      if (!r.ok) {
                        // Still published, under this trainer's name.
                        toast('Proqram silinmədi — serverə çatmadı. Bağlantını yoxla.', 'error');
                        return;
                      }
                      toast('Proqram silindi');
                    })();
                  },
                },
              ]
            ),
        },
        { label: 'Bağla', style: 'cancel' },
      ],
    });

  /** What a row can honestly say about a program, and nothing more.
   *  `weeks` and `level` are no longer asked for, so the old
   *  «8 həftə · 3 gün/həftə · 60 dəq · Orta» line printed three defaults
   *  nobody chose. Days and exercises are counted from the program itself. */
  const summary = (p: Program): string => {
    const days = p.days?.length ?? 0;
    const moves = (p.days ?? []).reduce((a, d) => a + (d.exercises?.length ?? 0), 0);
    const clips = (p.days ?? []).reduce(
      (a, d) => a + (d.exercises ?? []).filter((e) => !!e.videoUrl).length,
      0
    );
    const parts = [
      days ? `${days} gün` : 'gün yazılmayıb',
      moves ? `${moves} hərəkət` : null,
      clips ? `${clips} video` : null,
      p.minutes ? `~${p.minutes} dəq` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  };

  return (
    <Screen edges={['top']}>
      <LargeHeader
        title="Proqramlar"
        subtitle="Yaratdığın proqramlar. Hamısı pulsuzdur."
        right={
          <PressableScale
            activeScale={0.9}
            accessibilityRole="button"
            accessibilityLabel="Yeni proqram yarat"
            hitSlop={8}
            onPress={openNew}
            style={styles.fab}>
            <Icon name="plus" size={20} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 28 }}>
        {programs.length === 0 ? (
          <View style={styles.empty}>
            <AppText style={{ fontSize: 15, fontWeight: '600', marginBottom: 6 }}>Hələ proqram yaratmamısan</AppText>
            <AppText style={{ fontSize: 13.5, lineHeight: 19, color: palette.textSecondary }}>
              İlk proqramını yarat — hər hərəkətin set sayını, təkrarını və ya müddətini özün yazırsan, istəsən
              texnika videosu da əlavə edirsən. Sonra onu şagirdlərinə təyin edə bilərsən.
            </AppText>
            <PressableScale
              activeScale={0.97}
              accessibilityRole="button"
              accessibilityLabel="İlk proqramı yarat"
              onPress={openNew}
              style={[styles.primaryBtn, { marginTop: 15, alignSelf: 'flex-start', paddingHorizontal: 18 }]}>
              <AppText style={{ color: palette.white, fontSize: 13.5, fontWeight: '600' }}>Proqram yarat</AppText>
            </PressableScale>
          </View>
        ) : (
          <View style={{ gap: 11 }}>
            {programs.map((p) => (
              <View key={p.id} style={styles.card}>
                <PressableScale
                  activeScale={0.99}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title} proqramını redaktə et`}
                  onPress={() => openEdit(p)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.thumb}>
                    <Icon name="dumbbell" size={20} color={palette.voltDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontSize: 15, fontWeight: '600' }}>{p.title}</AppText>
                    <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>{summary(p)}</AppText>
                  </View>
                  <PressableScale
                    activeScale={0.9}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.title} üçün əməliyyatlar`}
                    hitSlop={10}
                    onPress={() => rowMenu(p)}
                    style={styles.moreBtn}>
                    <Icon name="more" size={18} color={palette.textSecondary} />
                  </PressableScale>
                </PressableScale>
              </View>
            ))}
          </View>
        )}

        <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.caption, marginTop: 18 }}>
          Şagirdə proqram təyin edəndə ona proqramın özü açılır — günləri, hərəkətləri, yazdığın set və təkrar
          sayı ilə birlikdə. SPOT-da ödəniş yoxdur, bütün proqramlar pulsuzdur.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fab: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  empty: { backgroundColor: palette.white, borderRadius: 16, padding: 18 },
  primaryBtn: { backgroundColor: palette.ink, borderRadius: 12, height: 40, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: palette.white, borderRadius: 16, padding: 13 },
  thumb: { width: 44, height: 44, borderRadius: 13, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  moreBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
