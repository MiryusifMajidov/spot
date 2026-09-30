import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { actionSheet, confirm, toast } from '@/store/ui';

import { LanguagePicker } from '@/components/LanguagePicker';
import { ListGroup, ListRow } from '@/components/ui/ListGroup';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { accountCount, showAccountSwitcher } from '@/lib/accounts';
import { useAuthGate } from '@/lib/authGate';
import { currentIdentity, signOut } from '@/lib/auth';
import { confirmDeleteAccount } from '@/lib/deleteAccount';
import { reminderSummary } from '@/lib/reminders';
import { wipeDeviceData } from '@/lib/wipe';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { releaseSounds, successFeedback, tapFeedback } from '@/lib/feedback';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { palette, spacing } from '@/theme';

/* The version the build was made with (app.json → embedded manifest). The row
   used to print a hard-coded «v1.0» while the store build was 1.4.x, so the one
   place someone looks up the version to report a bug told them the wrong one. */
const APP_VERSION = Constants.expoConfig?.version ?? null;

export default function Settings() {
  const t = useT();
  const router = useRouter();
  const gate = useAuthGate();
  const haptics = useAppStore((s) => s.haptics);
  const sounds = useAppStore((s) => s.sounds);
  const setFeedback = useAppStore((s) => s.setFeedback);
  const restSeconds = useAppStore((s) => s.restSeconds);
  const reminder = useAppStore((s) => s.reminder);
  const setTraining = useAppStore((s) => s.setTraining);
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
      t('Hesabdan çıx'),
      t('Yalnız bu telefondan çıxırsan: burada saxlanan məlumatlar silinir, digər cihazlarında hesab açıq qalır. Hansı yolla girmisənsə, eyni yolla yenidən girə bilərsən.'),
      [
        { label: t('Ləğv et'), style: 'cancel' },
        {
          label: t('Çıx'),
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
                toast(t('Hesabdan çıxdın — bu telefondakı məlumatlar silindi'));
                router.replace('/onboarding/welcome');
              })
              .catch(() => toast(t('Çıxmaq alınmadı — yenidən cəhd et'), 'error'));
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

  /* «Qeydiyyatı yenidən keç» lived here — a developer's tool, footed «Bu, test
     üçün…», shipped to every user. It is gone. What a person actually needs from
     this group is at the bottom now: sign out and delete, by name. */

  /* The rest a ticked set starts. Four choices cover everything from curls to
     heavy squats; ±30 s on the running timer covers the rest. */
  const REST_CHOICES = [60, 90, 120, 180];
  const restLabel = (s: number) => (s % 60 === 0 ? t('{n} dəq', { n: s / 60, count: s / 60 }) : t('{n} san', { n: s }));
  const pickRest = () =>
    actionSheet({
      title: t('Setlər arası fasilə'),
      actions: [
        ...REST_CHOICES.map((s) => ({
          label: s === restSeconds ? `✓ ${restLabel(s)}` : restLabel(s),
          onPress: () => setTraining({ restSeconds: s }),
        })),
        { label: t('Bağla'), style: 'cancel' as const },
      ],
    });

  const linked = ident.phase === 'ready' && ident.kind !== 'anonymous' && ident.kind !== 'none';

  return (
    <Screen>
      <NavBar title={t('Parametrlər')} />
      {/* Pushed inside the Profil tab, so on iOS 26 the floating Liquid Glass tab
          bar sits over the bottom of this list and reserves no space: at RN's
          default («never») the last group, «Qeydiyyatı yenidən keç», could not be
          scrolled out from under it. The first child of Screen is NavBar, so
          react-native-screens does not find this scroll view by itself — it is
          said here. «automatic» adds the bar's safe area at the bottom only (the
          top is already Screen's edge). iOS-only prop; Android's bar takes its
          own space. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}>
        {/* There is no subscription tier. The SPOT+ card that used to sit here sold a
            «PULSUZ (hazırda)» plan — a paid tier that was cancelled permanently — and its
            chevron led nowhere. Nothing in the app is gated by a plan, so nothing here
            may imply one. */}
        {/* Identity comes first, because without it everything below belongs to a
            single phone. An anonymous account is offered a way back in; a linked
            one is told what it is linked to and can sign out — signing out of an
            ANONYMOUS session would destroy it, so that is never offered. */}
        <ListGroup
          header={t('Hesab')}
          footer={
            /* A confirmed «no session» means the same thing as an anonymous one for
               this warning: nothing on a server can bring this data back. */
            ident.phase === 'ready' && (ident.kind === 'anonymous' || ident.kind === 'none')
              ? t('Hesabın yalnız bu telefondadır. Tətbiqi silsən və ya telefonu dəyişsən, məşq tarixçən və @adın qayıtmır.')
              : ident.phase === 'failed'
                ? t('Hesabının qorunub-qorunmadığını indi yoxlaya bilmədik — sətrə toxunub yenidən cəhd et.')
                : undefined
          }>
          {ident.phase === 'loading' ? null : ident.phase === 'failed' ? (
            <ListRow
              icon="shield"
              iconBg={palette.streak}
              iconColor={palette.white}
              title={t('Hesab məlumatı gətirilmədi')}
              subtitle={t('İnternetə qoşul və yenidən yoxla')}
              chevron={false}
              onPress={retryIdentity}
            />
          ) : ident.kind === 'anonymous' || ident.kind === 'none' ? (
            <ListRow
              icon="shield"
              iconBg={palette.red}
              iconColor={palette.white}
              title={t('Hesabını qoru')}
              subtitle={t('Hesaba bağla — telefon dəyişəndə heç nə itmir')}
              onPress={() => router.push('/auth/sign-in')}
            />
          ) : (
            <ListRow
              icon="shield"
              iconBg={palette.voltDeep}
              title={t('Giriş')}
              value={
                ident.label ??
                (ident.kind === 'google' ? 'Google' : ident.kind === 'apple' ? 'Apple' : t('Nömrə'))
              }
              chevron={false}
            />
          )}
          {/* Where else this account is open, and a way to end it there — a lost
              or sold phone stays signed in otherwise. Linked accounts only: an
              anonymous one exists on this phone alone. */}
          {linked ? (
            <ListRow
              icon="phone"
              iconBg={palette.ink}
              title={t('Aktiv cihazlar')}
              subtitle={t('Hesabının açıq olduğu telefonlar')}
              onPress={() => router.push('/(tabs)/profile/devices')}
            />
          ) : null}
          <ListRow icon="user" iconBg={palette.blue} title={t('Profili redaktə et')} onPress={() => router.push('/(tabs)/profile/edit')} />
          <ListRow icon="lock" iconBg={palette.caption} title={t('Məxfilik')} subtitle={t('Görünürlük və məlumatlar')} onPress={() => router.push('/(tabs)/profile/privacy')} />
          <ListRow icon="bookmark" iconBg={palette.voltDeep} title={t('Saxlanılanlar')} subtitle={t('Videolar və zallar')} onPress={() => router.push('/(tabs)/profile/saved')} />
          <ListRow icon="bell" iconBg={palette.streak} title={t('Bildirişlər')} subtitle={t('Hansı bildirişləri alacağını seç')} onPress={() => router.push('/(tabs)/profile/notifications')} />
        </ListGroup>

        {/* Inline, not a row that pushes a screen: there are three options and
            they fit. A language switch hidden one tap deeper is a language
            switch a confused person does not find. */}
        <ListGroup header="Dil / Язык / Language">
          <View style={{ padding: 12 }}>
            <LanguagePicker />
          </View>
        </ListGroup>

        <ListGroup header={t('Məşq')}>
          <ListRow
            icon="clock"
            iconBg={palette.blue}
            title={t('Məşq xatırlatması')}
            value={reminderSummary(reminder, t) ?? t('Söndürülüb')}
            onPress={() => router.push('/(tabs)/profile/reminders')}
          />
          <ListRow icon="timer" iconBg={palette.voltDeep} title={t('Setlər arası fasilə')} value={restLabel(restSeconds)} onPress={pickRest} />
        </ListGroup>

        {/* «Kəşf-də», not «Kəşfdə»: the hyphen before a case suffix belongs to
            acronyms and foreign forms («SPOT-da», «PR-lar», «Challenge-ə»), and
            «Kəşf» is neither — every other screen that names the tab writes it
            without one («Kəşfdə zal seç» in check-in, «Kəşfdən çıxarıldı» in
            become-trainer), so this footer spelled the tab differently from the
            tab. */}
        <ListGroup header={t('Hesablar')} footer={t('Müəllim profili yaradılan kimi Kəşfdə görünür, zal isə SPOT yoxlayandan sonra. Instagram kimi bir neçə hesab arasında keçə bilərsən.')}>
          {accountCount() > 1 ? (
            <ListRow icon="grid" iconBg={palette.inkText} title={t('Hesabı dəyiş')} subtitle={[t('Şəxsi'), role === 'trainer' ? t('Müəllim') : null, ownsGym ? t('Zal') : null].filter(Boolean).join(' · ')} onPress={() => showAccountSwitcher(router)} />
          ) : null}
          {role === 'trainer' ? (
            <ListRow icon="users" iconBg={palette.blue} title={t('Müəllim hesabım')} subtitle={t('Redaktə et')} onPress={() => router.push('/(tabs)/profile/become-trainer')} />
          ) : (
            <ListRow icon="verified" iconBg={palette.blue} title={t('Müəllim ol')} subtitle={t('Öz təlim hesabını yarat')} onPress={() => router.push('/(tabs)/profile/become-trainer')} />
          )}
          {ownsGym ? null : (
            /* A guest has no profiles row, so the whole form would fail at the end —
                ask for the 30-second profile before the form, not after it. */
            <ListRow
              icon="dumbbell"
              iconBg={palette.voltDeep}
              title={t('Zal hesabı yarat')}
              subtitle={t('Öz idman zalını qeydiyyata al')}
              onPress={() => gate(() => router.push('/(tabs)/profile/create-gym'), t('Zal hesabı üçün'))}
            />
          )}
        </ListGroup>

        {/* Plain ListRows with a switch on the right, like «Zalda göründüyümü göstər»
            in Məxfilik. These two used to be a hand-made copy of ListRow (glyph 17,
            12 pt caption subtitle, 56 pt rows), so they never quite matched the rows
            around them — and a change to ListRow's icon size would have skipped them. */}
        <ListGroup
          header={t('Toxunma və səs')}
          footer={t('Düymələrə basanda titrəmə və qısa səs. İkisini də ayrıca söndürə bilərsən.')}>
          <ListRow
            icon="sliders"
            iconBg={palette.inkText}
            title={t('Titrəmə')}
            subtitle={t('Basanda yüngül titrəmə')}
            chevron={false}
            right={
              <FeedbackSwitch
                label={t('Titrəmə')}
                value={haptics}
                onChange={(v) => {
                  setFeedback({ haptics: v });
                  if (v) tapFeedback();
                }}
              />
            }
          />
          <ListRow
            icon="sound"
            iconBg={palette.blue}
            title={t('Səs')}
            subtitle={t('Qısa interfeys səsləri')}
            chevron={false}
            right={
              <FeedbackSwitch
                label={t('Səs')}
                value={sounds}
                onChange={(v) => {
                  setFeedback({ sounds: v });
                  if (v) successFeedback();
                  else releaseSounds();
                }}
              />
            }
          />
        </ListGroup>

        <ListGroup header={t('Tətbiq')} footer={t('SPOT tam pulsuzdur — abunə, tətbiqdaxili ödəniş və ya kilidli funksiya yoxdur. Zal və məşqçi qiymətləri yalnız məlumat üçün göstərilir; SPOT bu ödənişlərə qarışmır və heç bir pay götürmür.')}>
          <ListRow icon="target" iconBg={palette.ink} title={t('Analitika')} subtitle={t('Həcm, 1RM, disbalans')} onPress={() => router.push('/(tabs)/profile/analytics')} />
          {/* «Seriya», not «streak». Every other place the counter is named — the
              profile badge, check-in, analitika, nailiyyətlər — calls it «seriya»,
              so this row advertised a screen by a name that appears nowhere on it. */}
          <ListRow icon="trophy" iconBg={palette.streak} title={t('Nailiyyətlər')} subtitle={t('Nişanlar və seriya')} onPress={() => router.push('/(tabs)/profile/achievements')} />
          <ListRow icon="shield" iconBg={palette.voltDeep} title={t('Kömək və dəstək')} subtitle={t('Problemi komandaya bildir')} onPress={help} />
          <ListRow icon="star" iconBg={palette.streak} title={t('SPOT haqqında')} value={APP_VERSION ? `v${APP_VERSION}` : undefined} chevron={false} />
        </ListGroup>

        {/* Reachable AFTER onboarding too: the store review checks that a
            privacy policy is available from inside the app, and somebody who
            agreed on the welcome screen must be able to read what they agreed
            to later. */}
        <ListGroup header={t('Hüquqi')}>
          <ListRow
            icon="shield"
            iconBg={palette.ink}
            title={t('İstifadə şərtləri')}
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}
          />
          <ListRow
            icon="shield"
            iconBg={palette.blue}
            title={t('Məxfilik siyasəti')}
            subtitle={t('Hansı məlumat toplanır, kim görür')}
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
          />
          <ListRow
            icon="users"
            iconBg={palette.voltDeep}
            title={t('İcma qaydaları')}
            subtitle={t('Bu tanışlıq tətbiqi deyil')}
            onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'rules' } })}
          />
        </ListGroup>

        {/* Sign-out used to hide behind a tap on the «Giriş» row, which reads as
            information, not as a button. Delete was only inside Məxfilik. Both are
            named here, last, where every phone's settings keep them. Sign-out only
            for a linked account: signing out of an anonymous one destroys it. */}
        <ListGroup footer={t('Hesabı silmək həmişəlikdir: profil, videolar və məşq tarixçəsi serverdən də silinir.')}>
          {linked ? <ListRow title={t('Hesabdan çıx')} danger chevron={false} onPress={signOutRow} /> : null}
          <ListRow title={t('Hesabı sil')} danger chevron={false} onPress={() => confirmDeleteAccount(router)} />
        </ListGroup>
      </ScrollView>
    </Screen>
  );
}

/** The switch at the end of a feedback row. `label` is its row's title: on its
 *  own a switch is read out as an unlabelled «switch, on», with no hint which of
 *  the two it is. */
function FeedbackSwitch({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      accessibilityLabel={label}
      trackColor={{ true: palette.voltDeep, false: palette.separator }}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
});
