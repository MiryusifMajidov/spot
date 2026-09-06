import { useMemo } from 'react';
import { StyleSheet, Switch, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { palette } from '@/theme';

/**
 * Opening hours, entered as hours — not as a sentence.
 *
 * `gyms.hours` is a text column and the form behind it was a bare text field, so
 * an owner could type «gecə-gündüz», «8-24», «səhərdən axşama» or a typo, and
 * whatever they typed became a public claim. That matters more than it looks:
 * both the check-in screen and the server parse this string to decide whether
 * the gym is open right now, and «Kəşf» filters on «24 saat». Text the parser
 * cannot read means the gym silently drops out of the filter and check-in falls
 * back to «saatı oxuya bilmədik».
 *
 * So the value is composed here into the one shape everything already reads —
 * «HH:MM–HH:MM», or «24 saat» — and the field shows the owner exactly what will
 * be stored. Nothing is guessed: an incomplete entry is reported as incomplete
 * rather than rounded into a plausible-looking time.
 */

export const ALWAYS_OPEN = '24 saat';

const pad = (n: number) => String(n).padStart(2, '0');

/** Digits only, at most 4, rendered as HH:MM while it is typed. */
function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** A complete, real clock time, or null. 25:00 and 07:70 are not times. */
export function parseTime(v: string): { h: number; m: number } | null {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return { h, m: min };
}

/** Pull the two ends out of a stored value so editing an existing gym starts
 *  from what is really there rather than from an empty field. */
export function splitHours(stored: string): { always: boolean; open: string; close: string } {
  const text = (stored ?? '').trim();
  if (!text) return { always: false, open: '', close: '' };
  if (/24\s*\/\s*7|24\s*saat|həmişə|24h/i.test(text)) return { always: true, open: '', close: '' };
  const m = text.match(/(\d{1,2})[:.](\d{2})\s*[–—\-−]\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return { always: false, open: '', close: '' };
  return { always: false, open: `${pad(Number(m[1]))}:${m[2]}`, close: `${pad(Number(m[3]))}:${m[4]}` };
}

/** What gets stored. Empty string when the entry is not yet a real window —
 *  the caller refuses to save rather than storing half a time. */
export function composeHours(always: boolean, open: string, close: string): string {
  if (always) return ALWAYS_OPEN;
  const a = parseTime(open);
  const b = parseTime(close);
  if (!a || !b) return '';
  if (a.h === b.h && a.m === b.m) return ALWAYS_OPEN;
  return `${pad(a.h)}:${pad(a.m)}–${pad(b.h)}:${pad(b.m)}`;
}

export function HoursField({
  always,
  open,
  close,
  onChange,
}: {
  always: boolean;
  open: string;
  close: string;
  onChange: (next: { always: boolean; open: string; close: string }) => void;
}) {
  const status = useMemo(() => {
    if (always) return { text: 'Saxlanılacaq: 24 saat', bad: false };
    if (!open && !close) return { text: 'Açılış və bağlanış saatını yaz', bad: false };
    const composed = composeHours(false, open, close);
    if (!composed) return { text: 'Saat tam deyil — məsələn 06:00 və 24:00', bad: true };
    return { text: `Saxlanılacaq: ${composed}`, bad: false };
  }, [always, open, close]);

  return (
    <View style={{ marginBottom: 18 }}>
      <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 8, fontWeight: '600' }}>
        İş saatları
      </AppText>

      <View style={styles.row}>
        <AppText variant="body">24 saat açıqdır</AppText>
        <Switch
          value={always}
          onValueChange={(v) => onChange({ always: v, open, close })}
          trackColor={{ true: palette.volt, false: palette.separator }}
        />
      </View>

      {!always ? (
        <View style={styles.times}>
          <TextInput
            value={open}
            onChangeText={(t) => onChange({ always, open: maskTime(t), close })}
            placeholder="06:00"
            placeholderTextColor={palette.caption}
            keyboardType="numeric"
            maxLength={5}
            style={[styles.input, styles.time]}
          />
          <AppText variant="body" color={palette.caption}>
            –
          </AppText>
          <TextInput
            value={close}
            onChangeText={(t) => onChange({ always, open, close: maskTime(t) })}
            placeholder="24:00"
            placeholderTextColor={palette.caption}
            keyboardType="numeric"
            maxLength={5}
            style={[styles.input, styles.time]}
          />
        </View>
      ) : null}

      <AppText style={[styles.hint, status.bad && { color: palette.red }]}>{status.text}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: palette.separator,
  },
  times: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  input: {
    backgroundColor: palette.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: palette.inkText,
    borderWidth: 1,
    borderColor: palette.separator,
  },
  time: { flex: 1, textAlign: 'center' },
  hint: { fontSize: 12, lineHeight: 17, color: palette.tertiary, marginTop: 8 },
});
