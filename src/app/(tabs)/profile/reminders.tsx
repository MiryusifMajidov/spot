import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { tapFeedback } from '@/lib/feedback';
import { pushPermission } from '@/lib/push';
import { applyWorkoutReminder, reminderTime, WEEKDAYS, weekdayName } from '@/lib/reminders';
import { useT } from '@/lib/useT';
import { useAppStore, type WorkoutReminder } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

/** The times people actually train at — one tap instead of eight on the stepper. */
const QUICK_TIMES = [
  [7, 0],
  [12, 0],
  [18, 0],
  [19, 0],
  [20, 0],
] as const;

/**
 * Məşq xatırlatması — «Bazar ertəsi, çərşənbə, cümə · 19:00».
 *
 * A fitness app without one relies on the person remembering on their own,
 * which is the one thing a habit tool exists to take over. It is a LOCAL
 * notification (src/lib/reminders.ts): nothing is sent to a server and it works
 * offline. Days and time only — one switch, seven day buttons, one time. No
 * «smart» schedule and no per-day times: the settings a person can hold in their
 * head are the ones they keep.
 */
export default function Reminders() {
  const t = useT();
  const reminder = useAppStore((s) => s.reminder);
  const setTraining = useAppStore((s) => s.setTraining);
  const [perm, setPerm] = useState<'granted' | 'denied' | 'undetermined' | 'unavailable'>('granted');

  useFocusEffect(
    useCallback(() => {
      // Re-read on focus: the person may be back from the system settings.
      void pushPermission().then(setPerm);
    }, [])
  );

  /* Every change is saved and applied at once — there is no «Saxla»: a switch
     that does nothing until a second button is pressed is a switch people leave
     half-set. */
  const apply = async (next: WorkoutReminder) => {
    setTraining({ reminder: next });
    const r = await applyWorkoutReminder(next);
    if (r === 'denied') {
      // The OS said no: the switch must not stay on promising a reminder.
      setTraining({ reminder: { ...next, on: false } });
      setPerm('denied');
      toast(t('Telefon bildirişlərə icazə vermir — xatırlatma üçün ayarlardan aç'), 'error');
    } else if (r === 'failed') {
      toast(t('Xatırlatma qurulmadı — yenidən cəhd et'), 'error');
    } else if (r === 'scheduled' && !reminder.on) {
      toast(t('Xatırlatma quruldu'));
    }
    void pushPermission().then(setPerm);
  };

  const toggleDay = (iso: number) => {
    tapFeedback();
    const has = reminder.days.includes(iso);
    // At least one day while it is on: an «on» reminder with no days never rings.
    if (has && reminder.days.length === 1) {
      toast(t('Ən azı bir gün seç'), 'info');
      return;
    }
    const days = has ? reminder.days.filter((d) => d !== iso) : [...reminder.days, iso].sort((a, b) => a - b);
    void apply({ ...reminder, days });
  };

  const shiftTime = (deltaMin: number) => {
    tapFeedback();
    const total = (reminder.hour * 60 + reminder.minute + deltaMin + 24 * 60) % (24 * 60);
    void apply({ ...reminder, hour: Math.floor(total / 60), minute: total % 60 });
  };

  const on = reminder.on;

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title={t('Məşq xatırlatması')} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {perm === 'denied' ? (
          <PressableScale activeScale={0.98} onPress={() => void Linking.openSettings()} style={styles.permCard} accessibilityRole="button">
            <Icon name="bell" size={20} color={palette.streak} />
            <View style={{ flex: 1 }}>
              <AppText variant="subhead">{t('Telefon bildirişləri bağlıdır')}</AppText>
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
                {t('Xatırlatma gəlməsi üçün SPOT-a bildiriş icazəsi ver. Telefon ayarlarını açmaq üçün toxun.')}
              </AppText>
            </View>
          </PressableScale>
        ) : null}

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <AppText variant="callout">{t('Xatırlat')}</AppText>
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
                {on ? t('Seçdiyin günlərdə, saat {time}', { time: reminderTime(reminder) }) : t('Söndürülüb')}
              </AppText>
            </View>
            <Switch
              value={on}
              accessibilityLabel={t('Məşq xatırlatması')}
              onValueChange={(v) => void apply({ ...reminder, on: v })}
              trackColor={{ false: palette.separator, true: palette.voltDeep }}
            />
          </View>
        </View>

        <View style={[styles.section, !on && styles.dim]} pointerEvents={on ? 'auto' : 'none'}>
          <AppText variant="overline" color={palette.caption} style={styles.label}>
            {t('Günlər')}
          </AppText>
          <View style={styles.days}>
            {WEEKDAYS.map((iso) => {
              const sel = reminder.days.includes(iso);
              const name = weekdayName(iso, t);
              return (
                <PressableScale
                  key={iso}
                  activeScale={0.92}
                  onPress={() => toggleDay(iso)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: sel }}
                  accessibilityLabel={name.long}
                  style={[styles.day, sel && styles.dayOn]}>
                  <AppText style={[styles.dayText, sel && styles.dayTextOn]} numberOfLines={1} adjustsFontSizeToFit>
                    {name.short}
                  </AppText>
                </PressableScale>
              );
            })}
          </View>

          <AppText variant="overline" color={palette.caption} style={styles.label}>
            {t('Saat')}
          </AppText>
          <View style={styles.card}>
            <View style={styles.timeRow}>
              <PressableScale
                activeScale={0.9}
                onPress={() => shiftTime(-15)}
                accessibilityRole="button"
                accessibilityLabel={t('15 dəqiqə tez')}
                style={styles.stepBtn}>
                <AppText style={styles.stepText}>−</AppText>
              </PressableScale>
              <AppText style={styles.time}>{reminderTime(reminder)}</AppText>
              <PressableScale
                activeScale={0.9}
                onPress={() => shiftTime(15)}
                accessibilityRole="button"
                accessibilityLabel={t('15 dəqiqə gec')}
                style={styles.stepBtn}>
                <AppText style={styles.stepText}>+</AppText>
              </PressableScale>
            </View>
            <View style={styles.quick}>
              {QUICK_TIMES.map(([h, m]) => {
                const sel = reminder.hour === h && reminder.minute === m;
                return (
                  <PressableScale
                    key={`${h}:${m}`}
                    activeScale={0.94}
                    onPress={() => void apply({ ...reminder, hour: h, minute: m })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: sel }}
                    // 36 pt chip + 4 pt slop inside the 8 pt gap: a 44 pt target.
                    hitSlop={{ top: 4, bottom: 4 }}
                    style={[styles.quickChip, sel && styles.quickChipOn]}>
                    <AppText style={[styles.quickText, sel && styles.dayTextOn]}>{reminderTime({ ...reminder, hour: h, minute: m })}</AppText>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        </View>

        <AppText variant="footnote" color={palette.textSecondary} style={styles.footer}>
          {t('Xatırlatma telefonun özündə qurulur — internet tələb etmir və heç yerə göndərilmir. Toxunanda Məşq tabı açılır.')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: 28 },
  permCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: palette.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: palette.streak,
  },
  card: { backgroundColor: palette.white, borderRadius: radius.card, padding: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  section: { marginTop: 4 },
  dim: { opacity: 0.45 },
  label: { marginTop: 20, marginBottom: 10, marginLeft: 4 },
  days: { flexDirection: 'row', gap: 6 },
  // Seven equal buttons across the width; 44 pt tall so each is a real target.
  day: { flex: 1, height: 44, borderRadius: 12, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  dayOn: { backgroundColor: palette.ink },
  dayText: { fontSize: 13, fontWeight: '600', color: palette.textSecondary },
  dayTextOn: { color: palette.white },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepBtn: { width: 52, height: 44, borderRadius: 12, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '600', color: palette.inkText, lineHeight: 26 },
  time: { fontSize: 34, fontWeight: '700', color: palette.inkText, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  quickChip: { paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  quickChipOn: { backgroundColor: palette.ink },
  quickText: { fontSize: 14, fontWeight: '600', color: palette.textSecondary, fontVariant: ['tabular-nums'] },
  footer: { marginTop: 18, marginHorizontal: 4, lineHeight: 18 },
});
