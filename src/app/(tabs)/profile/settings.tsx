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
import { wipeDeviceData } from '@/lib/wipe';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
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
     on this phone».
     `phase` exists because `currentIdentity()` used to answer `kind: 'none'` for
     TWO different things — «this device has no session» and «getUser() did not
     come back» — and this screen rendered nothing at all for 'none'. So a dropped
     connection removed the red «Hesabını qoru» row AND the footer that warns the
     account lives only on this phone, from exactly the person who needs to read
     them; the group then looked like «there is nothing to say about your
     account». A failed read now says it failed. `auth.ts` since separated the two
     itself — an un-answerable read is `kind: 'unknown'` — so the disambiguation
     below reads that flag instead of reconstructing it. */
  type Ident =
    | { phase: 'loading' }
    | { phase: 'failed' }
    | { phase: 'ready'; kind: 'anonymous' | 'google' | 'apple' | 'phone' | 'email' | 'none'; label: string | null };
  const [ident, setIdent] = useState<Ident>({ phase: 'loading' });

  const readIdentity = useCallback(async (): Promise<Ident> => {
    try {
      const i = await currentIdentity();
      /* Every kind except 'unknown' is an ANSWER, 'none' included: auth.ts only
         says 'none' when supabase-js reported «no stored session», and reports a
         read that failed for any other reason as 'unknown'. Routing 'unknown'
         into the branch below rather than into the ready state is what keeps a
         dropped connection from telling someone with a linked Google account
         that their data lives only on this phone. */
      if (i.kind !== 'unknown') return { phase: 'ready', kind: i.kind, label: i.label };
      /* The read never reached the server — and the stored session tells «no
         account» and «could not ask» apart with no network at all, because
         `is_anonymous` is a claim inside the JWT this device already holds. */
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const u = data.session?.user;
      if (!u) return { phase: 'ready', kind: 'none', label: null };
      // A session exists, so the read above is what failed. The claim still
      // answers the one question this group is about.
      if (u.is_anonymous) return { phase: 'ready', kind: 'anonymous', label: null };
      return { phase: 'failed' };
    } catch {
      return { phase: 'failed' };
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (!hasSupabaseConfig) return;
      readIdentity().then((i) => {
        if (alive) setIdent(i);
      });
      return () => {
        alive = false;
      };
    }, [readIdentity])
  );

  const retryIdentity = () => {
    setIdent({ phase: 'loading' });
    readIdentity().then(setIdent);
  };

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
            /* The dialog above promises the phone is cleared. Until now nothing
               cleared it: the Supabase session ended and `spot-db` / `spot-app`
               stayed exactly where they were, so the next person to open SPOT
               on this phone got the previous account's workouts, weigh-ins and
               chat threads. Wipe FIRST — if the network call then fails the
               device is still clean, which is the safe order. */
            wipeDeviceData()
              .then(() => signOut())
              .then(() => {
                toast('Hesabdan çıxdın — bu telefondakı məlumatlar silindi');
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

  /** Scope note: this restarts the onboarding FLOW on this device. It does not
   *  delete anything on the server — `bootstrap()` reads the profile back from
   *  `profiles` on the next launch, so the name, gym, goals and level return.
   *  The copy used to promise they would be «silinəcək», which was never true. */
  /* «Onboarding» is an English word, and the app is Azerbaijani only. The dialog
     body and the row's own footer already called this flow «qeydiyyat», so the
     screen used two names for one thing and one of them was not the language the
     product ships in. */
  const resetOnboarding = () =>
    confirm(
      'Qeydiyyatı yenidən keç',
      'Qeydiyyat addımları bu cihazda yenidən başlayacaq və cavablarını yenidən verə bilərsən. Serverdəki profilin silinmir — dəyişmədiyin sahələr olduğu kimi qalır. Məşq, çəki və check-in tarixçən də toxunulmur; onları silmək üçün Məxfilik → «Datanı bu cihazdan sil».',
      [
        { label: 'Ləğv et', style: 'cancel' },
        {
          label: 'Yenidən keç',
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
            /* A confirmed «no session» means the same thing as an anonymous one for
               this warning: nothing on a server can bring this data back. */
            ident.phase === 'ready' && (ident.kind === 'anonymous' || ident.kind === 'none')
              ? 'Hesabın yalnız bu telefondadır. Tətbiqi silsən və ya telefonu dəyişsən, məşq tarixçən və @adın qayıtmır.'
              : ident.phase === 'failed'
                ? 'Hesabının qorunub-qorunmadığını indi yoxlaya bilmədik — sətrə toxunub yenidən cəhd et.'
                : undefined
          }>
          {ident.phase === 'loading' ? null : ident.phase === 'failed' ? (
            <ListRow
              icon="shield"
              iconBg={palette.streak}
              iconColor={palette.white}
              title="Hesab məlumatı gətirilmədi"
              subtitle="İnternetə qoşul və yenidən yoxla"
              chevron={false}
              onPress={retryIdentity}
            />
          ) : ident.kind === 'anonymous' || ident.kind === 'none' ? (
            <ListRow
              icon="shield"
              iconBg={palette.red}
              iconColor={palette.white}
              title="Hesabını qoru"
              subtitle="Google və ya nömrə ilə — heç nə itmir"
              onPress={() => router.push('/auth/sign-in')}
            />
          ) : (
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
          )}
          <ListRow icon="user" iconBg={palette.blue} title="Profili redaktə et" onPress={() => router.push('/(tabs)/profile/edit')} />
          <ListRow icon="lock" iconBg="#8A8A93" title="Məxfilik" subtitle="Görünürlük və data" onPress={() => router.push('/(tabs)/profile/privacy')} />
          <ListRow icon="bookmark" iconBg={palette.voltDeep} title="Saxlanılanlar" subtitle="Videolar və zallar" onPress={() => router.push('/(tabs)/profile/saved')} />
          <ListRow icon="bell" iconBg={palette.streak} title="Bildirişlər" subtitle="Hansı bildirişləri alacağını seç" onPress={() => router.push('/(tabs)/profile/notifications')} />
        </ListGroup>

        {/* «Kəşf-də», not «Kəşfdə»: the hyphen before a case suffix belongs to
            acronyms and foreign forms («SPOT-da», «PR-lar», «Challenge-ə»), and
            «Kəşf» is neither — every other screen that names the tab writes it
            without one («Kəşfdə zal seç» in check-in, «Kəşfdən çıxarıldı» in
            become-trainer), so this footer spelled the tab differently from the
            tab. */}
        <ListGroup header="Hesablar" footer="Müəllim və ya zal hesabı yarat — Kəşfdə görünəcəksən. Instagram kimi bir neçə hesab arasında keçə bilərsən.">
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
          {/* «Seriya», not «streak». Every other place the counter is named — the
              profile badge, check-in, analitika, nailiyyətlər — calls it «seriya»,
              so this row advertised a screen by a name that appears nowhere on it. */}
          <ListRow icon="trophy" iconBg={palette.streak} title="Nailiyyətlər" subtitle="Nişanlar və seriya" onPress={() => router.push('/(tabs)/profile/achievements')} />
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
          <ListRow icon="arrowU" iconBg={palette.red} iconColor={palette.white} title="Qeydiyyatı yenidən keç" danger chevron={false} onPress={resetOnboarding} />
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
