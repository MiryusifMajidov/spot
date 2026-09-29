import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { ScrollView, Share, StyleSheet, Switch } from 'react-native';

import { ListGroup, ListRow } from '@/components/ui/ListGroup';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { ensureSession, updateMyProfile } from '@/lib/api';
import { confirmDeleteAccount } from '@/lib/deleteAccount';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { useDb } from '@/store/db';
import { emptyGymFilter, emptyPartnerFilter, useDiscoverPrefs } from '@/store/discoverPrefs';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/** Ad-hoc AsyncStorage keys written outside the zustand stores. Kept here so the
 *  wipe below really empties everything this app stores on the device. */
const LOOSE_KEYS = ['spot-progress-photos'];

/** `label` is what a screen reader says: the switch sits apart from its row's
 *  title, so without it VoiceOver/TalkBack announce only «switch, on». */
function Toggle({ value, onValueChange, label }: { value: boolean; onValueChange: (v: boolean) => void; label: string }) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      accessibilityLabel={label}
      trackColor={{ true: palette.voltDeep, false: palette.separator }}
    />
  );
}

export default function PrivacyDetails() {
  const t = useT();
  const router = useRouter();
  const showInGymList = useAppStore((s) => s.showInGymList);
  const setPrivacy = useAppStore((s) => s.setPrivacy);

  /** Local store is authoritative; the DB copy is what other users' queries read, so
   *  push it too — otherwise "hide me" would only be true on this phone. */
  const apply = (patch: { showInGymList?: boolean }) => {
    setPrivacy(patch);
    if (!hasSupabaseConfig) return;
    const s = useAppStore.getState();
    updateMyProfile({ visibility: s.visibility, show_in_gym_list: s.showInGymList }).catch(() => {
      toast(t('Parametr serverdə yenilənmədi — internet bağlantını yoxla'), 'error');
    });
  };

  const exportData = async () => {
    const db = useDb.getState();
    const app = useAppStore.getState();
    const payload = {
      exportedAt: new Date().toISOString(),
      profile: app.profile,
      privacy: { visibility: app.visibility, showInGymList: app.showInGymList },
      checkIns: db.checkIns,
      workouts: db.workouts,
      myReviews: db.myReviews,
      myPrograms: db.myPrograms,
      // Comments are server rows now, not device data — see the wipe copy below.
      savedPrograms: db.savedPrograms,
      bookmarks: app.bookmarks,
      savedVideos: app.savedVideos,
      following: app.following,
      blocked: app.blocked,
    };
    try {
      await Share.share({ message: JSON.stringify(payload, null, 2) });
    } catch {
      toast(t('Məlumatlar hazırlana bilmədi'), 'error');
    }
  };

  /**
   * Device-local wipe — and ONLY that.
   *
   * It used to sign the session out and mint a fresh anonymous identity, so that
   * «the rows already on the server stay detached from this device». With
   * anonymous sign-in as the only identity the app has, that detachment is
   * permanent: the old account has no phone number, no e-mail and no password,
   * so nobody — not the person, not support — can ever reach it again. Their
   * @username stays taken, their videos stay credited to a ghost, and the button
   * that did it is labelled «yalnız telefondakı nüsxə».
   *
   * The session is now kept. The local caches are cleared, and the profile comes
   * back from the server on the next bootstrap, which is what «clear the copy on
   * this phone» should mean. Deleting the account for real is the button
   * directly below this one.
   */
  const wipeDevice = async () => {
    const sessionReady = !hasSupabaseConfig || !!(await ensureSession().catch(() => null));

    // Engine: the domain reset + the slices resetDomain() does not cover.
    useDb.getState().resetDomain();
    useDb.setState({
      myReviews: {},
      myPrograms: [],
    });

    // App store: profile/onboarding + every persisted personal list.
    useAppStore.getState().resetOnboarding();
    useAppStore.setState({
      activeMode: 'user',
      ownsGym: false,
      bookmarks: [],
      savedVideos: [],
      following: [],
      likedPosts: [],
      visibility: 'match-only',
      showInGymList: true,
      blocked: [],
    });

    // Discover/chat preferences (filters, read markers, saved partners, weekly picks).
    useDiscoverPrefs.setState({
      gymFilter: emptyGymFilter,
      partnerFilter: emptyPartnerFilter,
      lastRead: {},
      savedPartners: [],
      weeklyPicks: null,
    });

    // Files/lists kept outside the stores (shopping list, custom meals, progress photos).
    try {
      await AsyncStorage.multiRemove(LOOSE_KEYS);
    } catch {
      /* the stores are already cleared; a stale loose key is not worth a false error */
    }

    return sessionReady;
  };

  /* Two confirmations, then files → rows → device copy: src/lib/deleteAccount.ts,
     shared with the same row in Parametrlər. */
  const deleteAccount = () => confirmDeleteAccount(router);

  const wipeDeviceOnly = () =>
    confirm(
      t('Bu cihazdakı nüsxəni sil'),
      t('Məşq, check-in, saxlanılanlar və filtrlər bu telefondan silinir. Hesabın SİLİNMİR — serverdəki profilin, videoların və şərhlərin yerində qalır və tətbiqi yenidən açanda geri gəlir. Hesabı həmişəlik silmək üçün aşağıdakı «Hesabı tamamilə sil» düyməsindən istifadə et.'),
      [
        { label: t('Ləğv et'), style: 'cancel' },
        {
          label: t('Sil'),
          style: 'destructive',
          onPress: async () => {
            const sessionReady = await wipeDevice();
            toast(
              sessionReady
                ? t('Bu cihazdakı nüsxə silindi — hesabın yerindədir')
                : t('Nüsxə silindi, amma serverə qoşula bilmədik — internetə qoşulub tətbiqi yenidən aç'),
              sessionReady ? 'info' : 'error'
            );
            router.replace('/onboarding/welcome');
          },
        },
      ]
    );

  return (
    <Screen>
      <NavBar title={t('Məxfilik')} />
      {/* Pushed inside the Profil tab: on iOS 26 the floating Liquid Glass tab bar
          covers the bottom of this list and reserves no space, and the last row
          here is the destructive «Hesabı tamamilə sil» — it must be fully visible
          and readable before anyone taps it. NavBar is Screen's first child, so
          react-native-screens does not adjust this scroll view on its own;
          «automatic» adds the bar's bottom safe area. iOS-only prop; Android's
          bar takes its own space. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}>
        {/* This used to be a «Yalnız match olanlar» switch. It wrote `profiles.visibility`
            and NOTHING read it back — neither position changed who could message you — and
            the footer advertised a one-off 'sual' channel that does not exist in the app.
            A control that promises protection it does not perform is worse than no control,
            so the section now states the rule that IS enforced and nothing more. Put the
            toggle back only when a send path actually reads `visibility`. */}
        <ListGroup
          header={t('Kim yaza bilər')}
          footer={t('Bu, bütün hesablar üçün eynidir və hazırda ayarlanmır. Mesajlar hələ yalnız bu cihazda saxlanılır.')}>
          <ListRow
            title={t('Yalnız qarşılıqlı qəbuldan sonra')}
            subtitle={t('Söhbət yalnız hər iki tərəf məşq təklifini qəbul edəndə açılır')}
            value={t('Aktiv')}
            chevron={false}
          />
        </ListGroup>

        <ListGroup header={t('Görünürlük')} footer={t("Yalnız check-in etdiyin müddətdə 'indi zalda' siyahısında görünürsən — daimi lokasiya izləmə yoxdur. Söndürsən, zalın siyahısında heç görünmürsən.")}>
          <ListRow
            title={t('Zalda göründüyümü göstər')}
            chevron={false}
            right={
              <Toggle
                value={showInGymList}
                onValueChange={(v) => apply({ showInGymList: v })}
                label={t('Zalda göründüyümü göstər')}
              />
            }
          />
        </ListGroup>

        {/* The footer names both rows by their real titles. It used to quote
            «Bu cihazdan sil» (no row is called that) and point to the «last row
            below» — but a footer is drawn UNDER the group, so that row is above it. */}
        <ListGroup
          header={t('Sənin məlumatların')}
          footer={t('«Bu cihazdakı nüsxəni sil» yalnız telefonundakı nüsxəni təmizləyir — hesabın serverdə qalır. Hesabı tamamilə silmək üçün «Hesabı tamamilə sil» sətrini işlət. Silməzdən əvvəl məlumatlarını özünə göndərməyi məsləhət görürük.')}>
          <ListRow
            icon="arrowU"
            iconBg={palette.blue}
            title={t('Məlumatlarını yüklə')}
            subtitle={t('Profil, məşq, check-in və qeydlərin JSON kimi')}
            onPress={exportData}
          />
          <ListRow
            icon="x"
            iconBg={palette.red}
            title={t('Bu cihazdakı nüsxəni sil')}
            subtitle={t('Hesabın silinmir — serverdəki profilin qalır')}
            danger
            chevron={false}
            onPress={wipeDeviceOnly}
          />
          <ListRow
            icon="x"
            iconBg={palette.red}
            title={t('Hesabı tamamilə sil')}
            subtitle={t('Profil, videolar, şərhlər, şəkillər — geri qaytarmaq olmur')}
            danger
            chevron={false}
            onPress={deleteAccount}
          />
        </ListGroup>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
});
