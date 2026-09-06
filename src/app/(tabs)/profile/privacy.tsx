import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { ScrollView, Share, StyleSheet, Switch } from 'react-native';

import { ListGroup, ListRow } from '@/components/ui/ListGroup';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { ensureSession, updateMyProfile, deleteMyAccount } from '@/lib/api';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { useDb } from '@/store/db';
import { emptyGymFilter, emptyPartnerFilter, useDiscoverPrefs } from '@/store/discoverPrefs';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/** Ad-hoc AsyncStorage keys written outside the zustand stores. Kept here so the
 *  wipe below really empties everything this app stores on the device. */
const LOOSE_KEYS = ['spot-shopping', 'spot-nutrition-custom', 'spot-progress-photos'];

function Toggle({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) {
  return <Switch value={value} onValueChange={onValueChange} trackColor={{ true: palette.voltDeep, false: palette.separator }} />;
}

export default function PrivacyDetails() {
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
      toast('Parametr serverdə yenilənmədi — internet bağlantını yoxla', 'error');
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
      weights: db.weights,
      nutrition: db.nutrition,
      myReviews: db.myReviews,
      myPrograms: db.myPrograms,
      // Comments are server rows now, not device data — see the wipe copy below.
      savedPrograms: db.savedPrograms,
      bookmarks: app.bookmarks,
      savedVideos: app.savedVideos,
      joinedChallenges: app.joinedChallenges,
      following: app.following,
      blocked: app.blocked,
    };
    try {
      await Share.share({ message: JSON.stringify(payload, null, 2) });
    } catch {
      toast('Data hazırlana bilmədi', 'error');
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
      nutrition: { day: '', eaten: [], water: 0 },
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
      joinedChallenges: [],
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

  /**
   * Really delete the account — the store requirement, and the thing the old
   * «Hesabı bu cihazdan sil» could not do. Files first, then the rows
   * (`deleteMyAccount` in src/lib/api.ts explains why that order is not
   * optional), then the device copy. Two confirmations, because it is final and
   * because the first one is easy to tap by mistake in a list of red rows.
   */
  const deleteAccount = () =>
    confirm(
      'Hesabı tamamilə sil',
      'Profilin, videolarını, postlarını, şərhlərini, şəkillərini, check-inlərini və məşq tarixçəni həm bu telefondan, həm də serverdən silirik. İstifadəçi adın boşalır.\n\nZala yazdığın rəylər qalır, amma adın çıxarılır — başqaları həmin rəylərə baxıb qərar verib. Yaratdığın zal və proqramlar da qalır, çünki başqa üzvlər onlardan istifadə edir.\n\nBu addım geri qaytarıla bilməz.',
      [
        { label: 'Ləğv et', style: 'cancel' },
        {
          label: 'Davam et',
          style: 'destructive',
          onPress: () =>
            confirm(
              'Əminsən?',
              'Son təsdiq. «Sil» düyməsindən sonra hesab geri qaytarılmır.',
              [
                { label: 'Ləğv et', style: 'cancel' },
                {
                  label: 'Sil',
                  style: 'destructive',
                  onPress: async () => {
                    if (!hasSupabaseConfig) {
                      toast('Server bağlantısı yoxdur — hesab silinmədi', 'error');
                      return;
                    }
                    try {
                      await deleteMyAccount();
                    } catch {
                      // Nothing partial is reported as done: if the server refused,
                      // the account is still there and the person must know it.
                      toast('Hesab silinmədi — internet yoxlanılsın, sonra yenidən cəhd et', 'error');
                      return;
                    }
                    await wipeDevice();
                    toast('Hesabın silindi');
                    router.replace('/onboarding/welcome');
                  },
                },
              ]
            ),
        },
      ]
    );

  const wipeDeviceOnly = () =>
    confirm(
      'Bu cihazdakı nüsxəni sil',
      'Məşq, çəki, check-in, qidalanma, saxlanılanlar və filtrlər bu telefondan silinir. Hesabın SİLİNMİR — serverdəki profilin, videoların və şərhlərin yerində qalır və tətbiqi yenidən açanda geri gəlir. Hesabı həmişəlik silmək üçün aşağıdakı «Hesabı tamamilə sil» düyməsindən istifadə et.',
      [
        { label: 'Ləğv et', style: 'cancel' },
        {
          label: 'Sil',
          style: 'destructive',
          onPress: async () => {
            const sessionReady = await wipeDevice();
            toast(
              sessionReady
                ? 'Bu cihazdakı nüsxə silindi — hesabın yerindədir'
                : 'Nüsxə silindi, amma serverə qoşula bilmədik — internetə qoşulub tətbiqi yenidən aç',
              sessionReady ? 'info' : 'error'
            );
            router.replace('/onboarding/welcome');
          },
        },
      ]
    );

  return (
    <Screen>
      <NavBar title="Məxfilik" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* This used to be a «Yalnız match olanlar» switch. It wrote `profiles.visibility`
            and NOTHING read it back — neither position changed who could message you — and
            the footer advertised a one-off 'sual' channel that does not exist in the app.
            A control that promises protection it does not perform is worse than no control,
            so the section now states the rule that IS enforced and nothing more. Put the
            toggle back only when a send path actually reads `visibility`. */}
        <ListGroup
          header="Kim yaza bilər"
          footer="Bu, bütün hesablar üçün eynidir və hazırda ayarlanmır. Mesajlar hələ yalnız bu cihazda saxlanılır.">
          <ListRow
            title="Yalnız qarşılıqlı qəbuldan sonra"
            subtitle="Söhbət yalnız hər iki tərəf məşq təklifini qəbul edəndə açılır"
            value="Aktiv"
            chevron={false}
          />
        </ListGroup>

        <ListGroup header="Görünürlük" footer="Yalnız check-in etdiyin müddətdə 'indi zalda' siyahısında görünürsən — daimi lokasiya izləmə yoxdur. Söndürsən, zalın siyahısında heç görünmürsən.">
          <ListRow title="Zalda göründüyümü göstər" chevron={false} right={<Toggle value={showInGymList} onValueChange={(v) => apply({ showInGymList: v })} />} />
        </ListGroup>

        <ListGroup
          header="Sənin datan"
          footer="«Bu cihazdan sil» yalnız telefonundakı nüsxəni təmizləyir — hesabın serverdə qalır. Hesabı tamamilə silmək üçün aşağıdakı sonuncu sətri işlət. Silməzdən əvvəl datanı özünə göndərməyi məsləhət görürük.">
          <ListRow
            icon="arrowU"
            iconBg={palette.blue}
            title="Datanı yüklə"
            subtitle="Profil, məşq, çəki, check-in və qeydlərin JSON kimi"
            onPress={exportData}
          />
          <ListRow
            icon="x"
            iconBg={palette.red}
            title="Bu cihazdakı nüsxəni sil"
            subtitle="Hesabın silinmir — serverdəki profilin qalır"
            danger
            chevron={false}
            onPress={wipeDeviceOnly}
          />
          <ListRow
            icon="x"
            iconBg={palette.red}
            title="Hesabı tamamilə sil"
            subtitle="Profil, videolar, şərhlər, şəkillər — geri qaytarmaq olmur"
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
