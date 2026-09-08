import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { confirm, toast } from '@/store/ui';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { ListGroup, ListRow } from '@/components/ui/ListGroup';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { accountCount, showAccountSwitcher } from '@/lib/accounts';
import { useAuthGate } from '@/lib/authGate';
import { currentIdentity, signOut } from '@/lib/auth';
import { hasSupabaseConfig } from '@/lib/supabase';
import { releaseSounds, successFeedback, tapFeedback } from '@/lib/feedback';
import { useAppStore } from '@/store/appStore';
import { palette, spacing } from '@/theme';

export default function Settings() {
  const router = useRouter();
  const gate = useAuthGate();
  const haptics = useAppStore((s) => s.haptics);
  const sounds = useAppStore((s) => s.sounds);
  const setFeedback = useAppStore((s) => s.setFeedback);
  const reset = useAppStore((s) => s.resetOnboarding);
  const role = useAppStore((s) => s.profile.role);
  const ownsGym = useAppStore((s) => s.ownsGym);

  /* Which identity is behind the session right now. Read from the server, not
     guessed: `is_anonymous` is the difference between «an account» and «a file
     on this phone». */
  const [ident, setIdent] = useState<{
    kind: 'anonymous' | 'google' | 'apple' | 'phone' | 'email' | 'none';
    label: string | null;
  }>({
    kind: 'none',
    label: null,
  });
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (!hasSupabaseConfig) return;
      currentIdentity()
        .then((i) => alive && setIdent(i))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [])
  );

  const signOutRow = () =>
    confirm(
      'Hesabdan çıx',
      'Bu telefonda saxlanan məlumatlar silinir. Hesabın serverdə qalır — eyni Google hesabı və ya nömrə ilə yenidən girə bilərsən.',
      [
        { label: 'Ləğv et', style: 'cancel' },
        {
          label: 'Çıx',
          style: 'destructive',
          onPress: () => {
            signOut()
              .then(() => {
                toast('Hesabdan çıxdın');
                router.replace('/onboarding/welcome');
              })
              .catch(() => toast('Çıxmaq alınmadı — yenidən cəhd et', 'error'));
          },
        },
      ]
    );


  /* Support opens a screen with a text field instead of filing a canned report.
     The three buttons that used to be here sent a fixed phrase as the whole
     message — «Tətbiqdə problem» — so nobody could say what actually happened
     and the team's queue was a wall of identical tickets. The report still lands
     in the same `reports` table the admin panel reads (schema21). */
  const help = () => router.push('/(tabs)/profile/support');

  /** Scope note: resetOnboarding() clears the profile + onboarding flag only —
   *  workouts, weights and check-ins stay. The confirm says exactly that. */
  const resetOnboarding = () =>
    confirm(
      'Onboarding-i sıfırla',
      'Profil məlumatların (ad, zal, məqsəd, səviyyə) silinəcək və qeydiyyat yenidən başlayacaq. Məşq, çəki və check-in tarixçən qalır — onları da silmək üçün Məxfilik → «Datanı bu cihazdan sil».',
      [
        { label: 'Ləğv et', style: 'cancel' },
        {
          label: 'Sıfırla',
          style: 'destructive',
          onPress: () => {
            reset();
            router.replace('/onboarding/welcome');
          },
        },
      ]
    );

  return (
    <Screen>
      <NavBar title="Parametrlər" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* There is no subscription tier. The SPOT+ card that used to sit here sold a
            «PULSUZ (hazırda)» plan — a paid tier that was cancelled permanently — and its
            chevron led nowhere. Nothing in the app is gated by a plan, so nothing here
            may imply one. */}
        {/* Identity comes first, because without it everything below belongs to a
            single phone. An anonymous account is offered a way back in; a linked
            one is told what it is linked to and can sign out — signing out of an
            ANONYMOUS session would destroy it, so that is never offered. */}
        <ListGroup
          header="Hesab"
          footer={
            ident.kind === 'anonymous'
              ? 'Hesabın yalnız bu telefondadır. Tətbiqi silsən və ya telefonu dəyişsən, məşq tarixçən və @adın qayıtmır.'
              : undefined
          }>
          {ident.kind === 'anonymous' ? (
            <ListRow
              icon="shield"
              iconBg={palette.red}
              iconColor={palette.white}
              title="Hesabını qoru"
              subtitle="Google və ya nömrə ilə — heç nə itmir"
              onPress={() => router.push('/auth/sign-in')}
            />
          ) : ident.kind !== 'none' ? (
            <ListRow
              icon="shield"
              iconBg={palette.voltDeep}
              title="Giriş"
              value={
                ident.label ??
                (ident.kind === 'google' ? 'Google' : ident.kind === 'apple' ? 'Apple' : 'Nömrə')
              }
              chevron={false}
              onPress={signOutRow}
            />
          ) : null}
          <ListRow icon="user" iconBg={palette.blue} title="Profili redaktə et" onPress={() => router.push('/(tabs)/profile/edit')} />
          <ListRow icon="lock" iconBg="#8A8A93" title="Məxfilik" subtitle="Görünürlük və data" onPress={() => router.push('/(tabs)/profile/privacy')} />
          <ListRow icon="bookmark" iconBg={palette.voltDeep} title="Saxlanılanlar" subtitle="Videolar və zallar" onPress={() => router.push('/(tabs)/profile/saved')} />
          <ListRow icon="bell" iconBg={palette.streak} title="Bildirişlər" subtitle="Hansı bildirişləri alacağını seç" onPress={() => router.push('/(tabs)/profile/notifications')} />
        </ListGroup>

        <ListGroup header="Hesablar" footer="Müəllim və ya zal hesabı yarat — Kəşf-də görünəcəksən. Instagram kimi bir neçə hesab arasında keçə bilərsən.">
          {accountCount() > 1 ? (
            <ListRow icon="grid" iconBg={palette.inkText} title="Hesabı dəyiş" subtitle="Şəxsi · Müəllim · Zal" onPress={() => showAccountSwitcher(router)} />
          ) : null}
          {role === 'trainer' ? (
            <ListRow icon="verified" iconBg={palette.blue} title="Müəllim hesabım" subtitle="Redaktə et" onPress={() => router.push('/(tabs)/profile/become-trainer')} />
          ) : (
            <ListRow icon="verified" iconBg={palette.blue} title="Müəllim ol" subtitle="Öz təlim hesabını yarat" onPress={() => router.push('/(tabs)/profile/become-trainer')} />
          )}
          {ownsGym ? null : (
            /* A guest has no profiles row, so the whole form would fail at the end —
                ask for the 30-second profile before the form, not after it. */
            <ListRow
              icon="dumbbell"
              iconBg={palette.voltDeep}
              title="Zal hesabı yarat"
              subtitle="Öz idman zalını qeydiyyata al"
              onPress={() => gate(() => router.push('/(tabs)/profile/create-gym'), 'Zal hesabı üçün')}
            />
          )}
        </ListGroup>

        <ListGroup
          header="Toxunma və səs"
          footer="Düymələrə basanda titrəmə və qısa səs. İkisini də ayrıca söndürə bilərsən.">
          <FeedbackRow
            icon="sliders"
            iconBg={palette.inkText}
            title="Titrəmə"
            subtitle="Basanda yüngül titrəmə"
            value={haptics}
            onChange={(v) => {
              setFeedback({ haptics: v });
              if (v) tapFeedback();
            }}
          />
          <FeedbackRow
            icon="sound"
            iconBg={palette.blue}
            title="Səs"
            subtitle="Qısa interfeys səsləri"
            value={sounds}
            onChange={(v) => {
              setFeedback({ sounds: v });
              if (v) successFeedback();
              else releaseSounds();
            }}
          />
        </ListGroup>

        <ListGroup header="Tətbiq" footer="SPOT tam pulsuzdur — abunə, tətbiqdaxili ödəniş və ya kilidli funksiya yoxdur. Zal və məşqçi qiymətləri yalnız məlumat üçün göstərilir; SPOT bu ödənişlərə qarışmır və heç bir pay götürmür.">
          <ListRow icon="target" iconBg={palette.ink} title="Analitika" subtitle="Həcm, 1RM, disbalans" onPress={() => router.push('/(tabs)/profile/analytics')} />
          <ListRow icon="trophy" iconBg={palette.streak} title="Nailiyyətlər" subtitle="Nişanlar və streak" onPress={() => router.push('/(tabs)/profile/achievements')} />
          <ListRow icon="shield" iconBg={palette.voltDeep} title="Kömək və dəstək" subtitle="Problemi komandaya bildir" onPress={help} />
          <ListRow icon="share" iconBg="#8A8A93" title="Dil" value="Azərbaycanca" chevron={false} />
          <ListRow icon="star" iconBg={palette.streak} title="SPOT haqqında" value="v1.0" chevron={false} />
        </ListGroup>

        {/* Reachable AFTER onboarding too: the store review checks that a
            privacy policy is available from inside the app, and somebody who
            agreed on the welcome screen must be able to read what they agreed
            to later. */}
        <ListGroup header="Hüquqi">
          <ListRow
            icon="shield"
            iconBg={palette.ink}
            title="İstifadə şərtləri"
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}
          />
          <ListRow
            icon="shield"
            iconBg={palette.blue}
            title="Məxfilik siyasəti"
            subtitle="Hansı məlumat toplanır, kim görür"
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
          />
          <ListRow
            icon="users"
            iconBg={palette.voltDeep}
            title="İcma qaydaları"
            subtitle="Bu tanışlıq tətbiqi deyil"
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'rules' } })}
          />
        </ListGroup>

        <ListGroup footer="Bu, test üçün qeydiyyatı yenidən başladır.">
          <ListRow icon="arrowU" iconBg={palette.red} iconColor={palette.white} title="Onboarding-i sıfırla" danger chevron={false} onPress={resetOnboarding} />
        </ListGroup>
      </ScrollView>
    </Screen>
  );
}

/** A settings row whose control is a real switch, styled like the list rows. */
function FeedbackRow({ icon, iconBg, title, subtitle, value, onChange }: {
  icon: 'sliders' | 'sound';
  iconBg: string;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.fbRow}>
      <View style={[styles.fbIcon, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={17} color={palette.white} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="body">{title}</AppText>
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>{subtitle}</AppText>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: palette.voltDeep, false: palette.separator }} />
    </View>
  );
}

const styles = StyleSheet.create({
  fbRow: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 10, paddingHorizontal: 14, minHeight: 56 },
  fbIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
});
