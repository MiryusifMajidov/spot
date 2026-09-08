import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useAuthGate } from '@/lib/authGate';
import { useTrainer, useTrainerPhase } from '@/lib/hooks';
import { showModerationSheet } from '@/lib/moderation';
import { getMyRequestTo, type TrainerRequestRow } from '@/lib/roles';
import { hasSupabaseConfig } from '@/lib/supabase';
import { palette, spacing } from '@/theme';

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="title3">{value}</AppText>
      <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
        {label}
      </AppText>
    </View>
  );
}

const STATE_AZ: Record<TrainerRequestRow['status'], string> = {
  pending: 'Sorğun göndərilib — müəllim cavab verməyib',
  accepted: 'Müəllimin qəbul etdi',
  declined: 'Müəllim sorğunu rədd etdi',
  ended: 'Bu əməkdaşlıq bitib',
};

export default function TrainerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gate = useAuthGate();
  const trainer = useTrainer(id);
  const phase = useTrainerPhase(id);
  const [request, setRequest] = useState<TrainerRequestRow | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !id) return;
      let alive = true;
      getMyRequestTo(id)
        .then((r) => alive && setRequest(r))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [id])
  );

  if (!trainer) {
    /* Three different situations used to print the same sentence: still loading,
       the request failed, and the trainer really is not there. «Müəllim
       tapılmadı» over a dropped connection tells somebody their coach deleted
       their account. */
    const failed = phase === 'failed';
    const loading = phase === 'loading';
    return (
      <Screen>
        <NavBar />
        <View style={styles.missing}>
          <Icon name={failed ? 'x' : 'user'} size={28} color={failed ? palette.red : palette.tertiary} />
          <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10, maxWidth: 250, lineHeight: 21 }}>
            {loading
              ? 'Yüklənir…'
              : failed
                ? 'Müəllim məlumatı yüklənmədi — bu, müəllimin olmadığı demək deyil. Bağlantını yoxla və yenidən aç.'
                : 'Müəllim tapılmadı.'}
          </AppText>
          {!loading ? (
            <Button title="Geri" variant="secondary" onPress={() => router.back()} style={{ marginTop: 16, height: 44, paddingHorizontal: 24 }} />
          ) : null}
        </View>
      </Screen>
    );
  }

  // `trainers.clients` is never incremented by anything in the app, so it is not
  // a fact we may show. Only the rating is keyed off here, and even it is only
  // ever reported when it is greater than zero.
  const isNew = (trainer.rating ?? 0) === 0;

  return (
    <Screen>
      <NavBar
        right={
          <PressableScale activeScale={0.9} onPress={() => showModerationSheet(trainer.name, { type: 'trainer', id: trainer.id })}>
            <Icon name="more" size={22} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <View style={{ opacity: trainer.verified ? 1 : 0.7 }}>
            <Avatar name={trainer.name} size={84} />
          </View>
          <View style={styles.nameRow}>
            <AppText variant="title">{trainer.name}</AppText>
            {trainer.verified ? (
              <Icon name="verified" size={20} color={palette.blue} />
            ) : (
              <View style={styles.unverified}>
                <AppText style={styles.unverifiedText}>Doğrulanmayıb</AppText>
              </View>
            )}
          </View>
          <AppText variant="callout" color={palette.textSecondary}>
            {trainer.specialty}
          </AppText>
        </View>

        {isNew ? (
          <View style={styles.newCard}>
            <Icon name="star" size={17} color={palette.voltDeep} />
            <AppText variant="footnote" color={palette.text3} style={{ flex: 1, lineHeight: 18 }}>
              Yeni müəllim — hələ reytinqi yoxdur. Sorğu göndərib özün tanış ola bilərsən.
            </AppText>
          </View>
        ) : (
          <View style={styles.stats}>
            <Stat value={`${trainer.rating}`} label="reytinq" />
            {trainer.responseTime ? (
              <>
                <View style={styles.divider} />
                <Stat value={trainer.responseTime} label="cavab vaxtı" />
              </>
            ) : null}
          </View>
        )}

        {request ? (
          <View style={styles.stateCard}>
            <Icon name={request.status === 'accepted' ? 'check' : 'clock'} size={17} color={request.status === 'accepted' ? palette.voltDeep : palette.textSecondary} />
            <AppText variant="footnote" color={palette.text3} style={{ flex: 1, lineHeight: 18 }}>
              {STATE_AZ[request.status]}
              {request.preferred_time ? ` · ${request.preferred_time}` : ''}
            </AppText>
          </View>
        ) : null}

        {trainer.bio ? (
          <>
            <AppText variant="overline" color={palette.caption} style={styles.sectionLabel}>
              Haqqında
            </AppText>
            <AppText variant="body" color={palette.text3} style={{ lineHeight: 22 }}>
              {trainer.bio}
            </AppText>
          </>
        ) : null}

        {trainer.certifications.length > 0 ? (
          <>
            <AppText variant="overline" color={palette.caption} style={styles.sectionLabel}>
              Sertifikatlar
            </AppText>
            {trainer.certifications.map((c) => (
              <View key={c} style={styles.certRow}>
                <Icon name="shield" size={17} color={palette.voltDeep} />
                <AppText variant="body">{c}</AppText>
              </View>
            ))}
          </>
        ) : null}

        <AppText variant="caption" color={palette.caption} style={{ marginTop: 24, lineHeight: 17 }}>
          Qiymət yalnız məlumat üçündür — SPOT ödəniş qəbul etmir, razılaşma müəllimlə birbaşa olur.
        </AppText>
      </ScrollView>

      <View style={styles.footer}>
        {/* A trainer who left the price empty has 0 in the column — that is an
            absent value, not a free session. */}
        <AppText variant="caption" color={palette.caption} style={{ marginBottom: 8 }}>
          {trainer.priceFrom > 0 ? `Başlanğıc ${trainer.priceFrom} ₼ · məlumat üçün` : 'Qiymət göstərilməyib — müəllimlə özün danış'}
        </AppText>
        <View style={styles.footerRow}>
        <Button
          title="Mesaj yaz"
          variant="secondary"
          icon="msg"
          onPress={() => gate(() => router.push({ pathname: '/chat/[id]', params: { id: trainer.id } }), 'Müəllimə yazmaq üçün')}
          style={{ flex: 1 }}
        />
        <Button
          // The destination has no time-proposal UI for an existing request — it
          // only shows the request's state, so the label must say exactly that.
          title={request?.status === 'pending' ? 'Sorğu göndərilib' : request?.status === 'accepted' ? 'Sorğuna bax' : 'Rezerv et'}
          onPress={() => gate(() => router.push({ pathname: '/(tabs)/discover/reserve/[id]', params: { id: trainer.id } }), 'Müəllim rezerv etmək üçün')}
          style={{ flex: 1 }}
        />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 24 },
  head: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  unverified: { backgroundColor: palette.grouped, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  unverifiedText: { fontSize: 11, fontWeight: '600', color: palette.textSecondary },
  stats: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.grouped, borderRadius: 16, paddingVertical: 16, marginTop: 8 },
  newCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(198,255,61,0.20)', borderRadius: 14, padding: 14, marginTop: 8 },
  stateCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.grouped, borderRadius: 14, padding: 14, marginTop: 12 },
  stat: { flex: 1, alignItems: 'center' },
  divider: { width: 1, height: 28, backgroundColor: palette.separator },
  sectionLabel: { marginTop: 24, marginBottom: 10 },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
