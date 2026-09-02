import { StyleSheet, View } from 'react-native';

import { Partner } from '@/data/types';
import { seedById } from '@/store/db';
import { palette } from '@/theme';
import { Avatar } from './ui/Avatar';
import { AppText } from './ui/AppText';
import { PressableScale } from './ui/PressableScale';
import { Icon } from './Icon';
import { nameWithAge } from '@/lib/authorName';

/* ------------------------------------------------------------------ compat helpers
 *
 * Shared by every surface that prints a compatibility score (this row,
 * discover/cards, discover/match, discover/weekly, discover/partner/[id]) so the
 * five of them cannot drift apart.
 *
 * `compatibility` is `number | null`: null means NO COMPARISON WAS PERFORMED —
 * the app does not hold enough of the user's own profile to compare anything.
 * That is not «0 % uyğun»: a score of zero is a measurement, a null is the
 * absence of one, and the UI must never print the second as the first. */

/** The colour used for a mismatch — `palette.warning` does not exist. */
export const MISMATCH_COLOR = '#FF9500';

/** Copy shown wherever a score cannot be computed. One string, one meaning. */
export const COMPAT_UNKNOWN = 'Uyğunluq hesablanmayıb — profilini tamamla';
export const COMPAT_UNKNOWN_SHORT = 'Uyğunluq hesablanmayıb';

/** The score, or null when nothing was compared. Written so it keeps compiling
 *  whether `Partner.compatibility` is `number` or `number | null`. */
export function compatOf(p: Pick<Partner, 'compatibility'>): number | null {
  const raw = p.compatibility as number | null | undefined;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** The comparison also reports what did NOT line up («Səviyyə fərqi», «Fərqli
 *  saat») — the score is not a black box. A miss must never be painted as a
 *  reason two people match, so every consumer splits before rendering. */
const MISMATCH_MARK = /^\s*[−–—\-≠×✗!]\s*/;
const MISMATCH_RE = /fərq|deyil|yox|uzaq|başqa|düşmür|uyğunsuz|ayrı|çatışm|zəif|aşağı|göstərilməyib/i;

export const isMismatchReason = (r: string) => MISMATCH_MARK.test(r) || MISMATCH_RE.test(r);

/** «Profilini tamamla» is an instruction to the user, not a dimension of the
 *  comparison. src/store/db.ts still folds it into reasons[] for the seed path,
 *  so it is dropped here rather than rendered under a green check. */
const isInstruction = (r: string) => /profil/i.test(r);

/** Strips a leading «−» / «≠» marker so the UI can apply its own, once. */
const reasonLabel = (r: string) => r.replace(MISMATCH_MARK, '').trim() || r;

/** Positives and misses, from the two fields plus a safety net: partners produced
 *  by the local seed path carry no `mismatches`, and may still fold a miss into
 *  reasons[]. */
export function splitReasons(p: Pick<Partner, 'matchReasons' | 'mismatches'> | null | undefined): {
  pros: string[];
  cons: string[];
} {
  const reasons = (p?.matchReasons ?? []).filter((r) => !isInstruction(r));
  const declared = (p?.mismatches ?? []).filter((r) => !isInstruction(r)).map(reasonLabel);
  const folded = reasons.filter(isMismatchReason).map(reasonLabel);
  return {
    pros: reasons.filter((r) => !isMismatchReason(r)),
    cons: [...declared, ...folded.filter((c) => !declared.includes(c))],
  };
}

/** Workout-partner row. Compatibility is computed from workout params, not photos. */
export function PartnerRow({ partner, onPress }: { partner: Partner; onPress?: () => void }) {
  const score = compatOf(partner);
  const { pros, cons } = splitReasons(partner);
  // Compact row: never let the two-chip budget swallow the mismatch — one of
  // each when both exist, so the row cannot read as all-positive.
  const chips: { text: string; bad: boolean }[] =
    score === null
      ? []
      : [
          ...pros.slice(0, cons.length ? 1 : 2).map((text) => ({ text, bad: false })),
          ...cons.slice(0, 1).map((text) => ({ text, bad: true })),
        ];

  return (
    <PressableScale onPress={onPress} activeScale={0.98} style={styles.row}>
      <Avatar name={partner.name} size={54} />
      <View style={styles.mid}>
        <View style={styles.nameRow}>
          <AppText variant="headline">
            {nameWithAge(partner.name, partner.age)}
          </AppText>
          {/* Presence is only claimed for a real profile with a live check-in —
              a catalogue entry can never say it is at the gym. */}
          {partner.hereNow && !seedById(partner.id) ? (
            <View style={styles.hereBadge}>
              <View style={styles.dot} />
              <AppText style={styles.hereText}>indi zalda</AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
          {[partner.level, partner.usualTime].filter(Boolean).join(' · ')}
        </AppText>
        {score === null ? (
          <AppText variant="caption" color={palette.caption} style={{ marginTop: 7, lineHeight: 16 }}>
            {COMPAT_UNKNOWN}
          </AppText>
        ) : chips.length > 0 ? (
          <View style={styles.reasons}>
            {chips.map((c) => (
              <View key={c.text} style={[styles.reason, c.bad && styles.reasonBad]}>
                <AppText style={[styles.reasonText, c.bad && { color: MISMATCH_COLOR }]}>
                  {c.bad ? '≠ ' : ''}
                  {c.text}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.compatWrap}>
        {score === null ? (
          <Icon name="user" size={18} color={palette.tertiary} />
        ) : (
          <>
            <AppText style={styles.compat}>{score}%</AppText>
            <AppText style={styles.compatLabel}>uyğun</AppText>
          </>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  mid: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hereBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(198,255,61,0.28)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.voltDeep },
  hereText: { fontSize: 10.5, fontWeight: '700', color: palette.voltText },
  reasons: { flexDirection: 'row', gap: 6, marginTop: 7, flexWrap: 'wrap' },
  reason: { backgroundColor: palette.grouped, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  reasonBad: { backgroundColor: 'rgba(255,149,0,0.14)' },
  reasonText: { fontSize: 11, fontWeight: '600', color: palette.text3 },
  compatWrap: { alignItems: 'center' },
  compat: { fontSize: 18, fontWeight: '700', color: palette.inkText, letterSpacing: -0.3 },
  compatLabel: { fontSize: 10.5, color: palette.caption, marginTop: 1 },
});
