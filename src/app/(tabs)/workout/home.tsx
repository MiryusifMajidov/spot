import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { useGyms } from '@/lib/hooks';
import { useAllPrograms } from '@/store/db';
import { palette, spacing } from '@/theme';
import { homeWorkoutPlan } from './day';

const EQUIP = ['Heç nə', 'Dumbbell', 'Rezin', 'Turnik', 'Kettlebell', 'Skamya'];
const TIMES = ['10', '20', '30', '45'];

export default function HomeWorkout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const gyms = useGyms();
  const programs = useAllPrograms();
  const [equip, setEquip] = useState<string[]>(['Heç nə']);
  const [time, setTime] = useState('20');

  const toggle = (e: string) =>
    setEquip((s) => {
      const next = s.includes(e) ? s.filter((x) => x !== e) : [...s, e];
      return next.length ? next : ['Heç nə'];
    });

  // The headline numbers and the session run off the SAME plan.
  const plan = useMemo(() => homeWorkoutPlan(equip, Number(time)), [equip, time]);

  const start = () =>
    router.push({ pathname: '/(tabs)/workout/home-session', params: { equip: equip.join(','), minutes: time } });

  const passes = gyms.map((g) => g.dayPass).filter((n) => n > 0);
  const cheapest = passes.length ? Math.min(...passes) : null;
  const homeProgram = programs.find((p) => (p.tags ?? []).some((t) => t.toLowerCase() === 'evdə'));

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 24 }}>
        <AppText variant="caption" color={palette.tertiary}>
          Zalım yoxdur rejimi
        </AppText>
        <AppText variant="largeTitle" style={{ marginTop: 4, marginBottom: 14 }}>
          Evdə məşq
        </AppText>

        <View style={styles.todayCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
            <View style={styles.voltDot} />
            <AppText style={styles.overlineVolt}>BUGÜN · {equip.length === 1 && equip[0] === 'Heç nə' ? 'AVADANLIQSIZ' : equip.filter((e) => e !== 'Heç nə').join(', ').toUpperCase()}</AppText>
          </View>
          <AppText style={{ fontSize: 21, fontWeight: '700', color: palette.white, letterSpacing: -0.4 }}>Tam bədən · {time} dəqiqə</AppText>
          <AppText style={{ fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.55)', marginTop: 7 }}>
            {plan.circuit.length} hərəkət · {plan.rounds} dövrə · yer və 2 m² kifayətdir
          </AppText>
          <View style={styles.moveList}>
            {plan.circuit.map((m) => (
              <View key={m.id} style={styles.moveChip}>
                <AppText style={{ fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.8)' }}>{m.name}</AppText>
              </View>
            ))}
          </View>
          <PressableScale activeScale={0.97} onPress={start} style={styles.startBtn}>
            <Icon name="play" size={19} color={palette.inkText} />
            <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>Başla</AppText>
          </PressableScale>
        </View>

        <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 11 }}>
          AVADANLIĞIN NƏ VAR?
        </AppText>
        <View style={styles.chips}>
          {EQUIP.map((e) => {
            const on = equip.includes(e);
            return (
              <PressableScale key={e} activeScale={0.95} onPress={() => toggle(e)} style={[styles.chip, on && styles.chipOn]}>
                <AppText style={{ fontSize: 12.5, fontWeight: '600', color: on ? palette.white : palette.inkText }}>{e}</AppText>
              </PressableScale>
            );
          })}
        </View>

        <AppText variant="overline" color={palette.tertiary} style={{ marginTop: 16, marginBottom: 11 }}>
          VAXTIN NƏ QƏDƏRDİR?
        </AppText>
        <View style={{ flexDirection: 'row', gap: 9 }}>
          {TIMES.map((t) => (
            <PressableScale key={t} activeScale={0.96} onPress={() => setTime(t)} style={[styles.timeCard, time === t && { backgroundColor: palette.ink }]}>
              <AppText style={{ fontSize: 16, fontWeight: '700', color: time === t ? palette.white : palette.inkText }}>{t}</AppText>
              <AppText style={{ fontSize: 11, color: time === t ? 'rgba(255,255,255,0.55)' : palette.tertiary, marginTop: 5 }}>dəq</AppText>
            </PressableScale>
          ))}
        </View>

        {gyms.length ? (
          <PressableScale activeScale={0.98} onPress={() => router.push('/(tabs)/discover')} style={styles.convertCard}>
            <View style={styles.convertIcon}>
              <Icon name="pin" size={20} color="#5B7F00" />
            </View>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 14.5, fontWeight: '600', color: '#3F5500' }}>Zala keçməyə hazırsan?</AppText>
              <AppText style={{ fontSize: 12.5, lineHeight: 17, color: '#4C6B00', marginTop: 4 }}>
                {gyms.length} zal SPOT-dadır{cheapest ? ` · ${cheapest} ₼-dan 1 günlük giriş` : ''}
              </AppText>
            </View>
            <Icon name="chevR" size={17} color="#5B7F00" />
          </PressableScale>
        ) : null}

        {homeProgram ? (
          <>
            <AppText variant="headline" style={{ marginTop: 18, marginBottom: 11 }}>
              Sənə uyğun proqramlar
            </AppText>
            <PressableScale
              activeScale={0.98}
              onPress={() => router.push({ pathname: '/(tabs)/workout/program/[id]', params: { id: homeProgram.id } })}
              style={styles.programRow}>
              <View style={styles.programThumb}>
                <Icon name="video" size={20} color="#B4B4BB" />
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{homeProgram.title}</AppText>
                <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 5 }}>
                  {homeProgram.creatorName} · {homeProgram.weeks} həftə · {homeProgram.level}
                </AppText>
              </View>
              <Icon name="chevR" size={18} color={palette.tertiary} />
            </PressableScale>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  todayCard: { backgroundColor: palette.ink, borderRadius: 20, padding: 18, marginBottom: 13 },
  voltDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.volt },
  overlineVolt: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, color: palette.volt },
  moveList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  moveChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.10)' },
  startBtn: { height: 50, borderRadius: 14, backgroundColor: palette.volt, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, backgroundColor: palette.white },
  chipOn: { backgroundColor: palette.ink },
  timeCard: { flex: 1, height: 58, borderRadius: 14, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center' },
  convertCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(198,255,61,0.2)', borderRadius: 16, padding: 15, marginTop: 16 },
  convertIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center' },
  programRow: { backgroundColor: palette.white, borderRadius: 16, padding: 13, flexDirection: 'row', gap: 12, alignItems: 'center' },
  programThumb: { width: 56, height: 56, borderRadius: 13, backgroundColor: '#E2E2E7', alignItems: 'center', justifyContent: 'center' },
});
