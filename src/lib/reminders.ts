import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { t } from '@/lib/i18n';
import type { WorkoutReminder } from '@/store/appStore';

/**
 * «Məşq vaxtıdır» — a weekly reminder the person sets in Parametrlər.
 *
 * Local notifications: scheduled on the phone by the OS, so they arrive without
 * a server, without an account and without internet, and nothing about when
 * somebody trains leaves the device. Every schedule carries `kind` so this file
 * only ever cancels its own — the app's other notifications are not touched.
 *
 * The text is fixed at scheduling time, so it is scheduled again whenever the
 * language or the reminder changes (see the root layout).
 */

export const REMINDER_KIND = 'workout-reminder';
const CHANNEL = 'reminders';

/** ISO weekdays, Monday first — the order an Azerbaijani week is written in. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** A weekday's names, translated. Written as literal tr('…') calls on purpose:
 *  scripts/i18n_extract.py finds keys by scanning for them, and a table of
 *  plain-ASCII abbreviations («B.e.», «C.») rendered through t(value) is
 *  invisible to it — those days would have stayed Azerbaijani in ru/en. */
export function weekdayName(iso: number, tr: typeof t = t): { short: string; long: string } {
  switch (iso) {
    case 1: return { short: tr('B.e.'), long: tr('Bazar ertəsi') };
    case 2: return { short: tr('Ç.a.'), long: tr('Çərşənbə axşamı') };
    case 3: return { short: tr('Ç.'), long: tr('Çərşənbə') };
    case 4: return { short: tr('C.a.'), long: tr('Cümə axşamı') };
    case 5: return { short: tr('C.'), long: tr('Cümə') };
    case 6: return { short: tr('Ş.'), long: tr('Şənbə') };
    default: return { short: tr('B.'), long: tr('Bazar') };
  }
}

/* expo-notifications counts weekdays from Sunday = 1 (Date's order, plus one). */
const toExpoWeekday = (iso: number) => (iso === 7 ? 1 : iso + 1);

const pad = (n: number) => String(n).padStart(2, '0');
export const reminderTime = (r: WorkoutReminder) => `${pad(r.hour)}:${pad(r.minute)}`;

/** «B.e., Ç., C. · 19:00», or null when the reminder is off. */
export function reminderSummary(r: WorkoutReminder, tr: typeof t = t): string | null {
  if (!r.on || !r.days.length) return null;
  const days = WEEKDAYS.filter((d) => r.days.includes(d)).map((d) => weekdayName(d, tr).short);
  return `${days.join(', ')} · ${reminderTime(r)}`;
}

/** Cancel this file's schedules — and only them. */
export async function cancelWorkoutReminders(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .filter((n) => (n.content.data as { kind?: string } | undefined)?.kind === REMINDER_KIND)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch {
    /* Nothing scheduled, or the module is unavailable (web): nothing to cancel. */
  }
}

/** Permission for a reminder the person has just switched on. Asks only when the
 *  OS still allows asking — the same rule as push registration. */
async function allowed(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.status === 'granted') return true;
  if (!cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).status === 'granted';
}

export type ReminderResult = 'scheduled' | 'off' | 'denied' | 'failed';

/* Every apply runs after the previous one has finished. Two used to run at once
   — the settings screen applies a change and the root layout re-applies on the
   same state change — and each cancelled «ours» before the other had scheduled
   anything, then both scheduled: every reminder was on the phone TWICE and rang
   twice (seen in `dumpsys alarm` on the test phone). Serialised, the second run
   cancels what the first scheduled and the schedule is exactly one per day. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Make the phone's schedule match `r`: everything of ours is cancelled, then one
 * weekly notification per chosen day is scheduled. Safe to call repeatedly and
 * concurrently — calls are applied one after another.
 */
export function applyWorkoutReminder(r: WorkoutReminder): Promise<ReminderResult> {
  const run = queue.then(() => applyNow(r));
  queue = run.catch(() => {});
  return run;
}

async function applyNow(r: WorkoutReminder): Promise<ReminderResult> {
  try {
    await cancelWorkoutReminders();
    if (!r.on || !r.days.length) return 'off';
    if (!(await allowed())) return 'denied';
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: t('Məşq xatırlatması'),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    for (const iso of r.days) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: t('Məşq vaxtıdır'),
          body: t('Bugünkü məşqin hazırdır — SPOT-u aç və başla.'),
          data: { kind: REMINDER_KIND },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: toExpoWeekday(iso),
          hour: r.hour,
          minute: r.minute,
          channelId: CHANNEL,
        },
      });
    }
    return 'scheduled';
  } catch {
    return 'failed';
  }
}
