import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { ScrollView, Share, StyleSheet, Switch } from 'react-native';

import { ListGroup, ListRow } from '@/components/ui/ListGroup';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { ensureSession, updateMyProfile } from '@/lib/api';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
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
   * Device-local wipe. It clears every store and every AsyncStorage key this app
   * writes on this phone, then signs the session out and immediately opens a brand-new
   * anonymous one — without it the app would run session-less until the next cold start
   * and re-onboarding could never be saved. The new identity is deliberately a different
   * uid, so the rows already on the server stay detached from this device. It does NOT
   * delete those rows — the confirm text says exactly that, and the toast afterwards
   * claims only what actually happened.
   *
   * Returns true when the device ends up with a usable session again.
   */
  const wipeDevice = async () => {
    let sessionReady = !hasSupabaseConfig;
    if (hasSupabaseConfig) {
      try {
        await supabase.auth.signOut();
      } catch {
        /* the local wipe must run regardless of the network */
      }
      try {
        sessionReady = !!(await ensureSession());
      } catch {
        /* offline: the next app launch bootstraps a session */
        sessionReady = false;
      }
    }

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

  const deleteAccount = () =>
    confirm(
      'Hesabı bu cihazdan sil',
      'Məşq, çəki, check-in, qidalanma, rəy, saxlanılanlar və profil datan bu telefondan tamamilə silinir və sessiyadan çıxılır. Serverdə yazılmış sətirlər (post, video, şərh, rəy, check-in) bu düymə ilə silinmir — şərhlərini bir-bir özün silə bilərsən, qalanları üçün Parametrlər → Kömək və dəstək bölməsindən bizə yaz. Bu addım geri qaytarıla bilməz.',
      [
        { label: 'Ləğv et', style: 'cancel' },
        {
          label: 'Sil',
          style: 'destructive',
          onPress: async () => {
            const sessionReady = await wipeDevice();
            toast(
              sessionReady
                ? 'Data bu cihazdan silindi'
                : 'Data bu cihazdan silindi — yeni sessiya açılmadı, internetə qoşulub tətbiqi yenidən başlat',
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
          footer="Silmə bu cihazdakı datanı təmizləyir və sessiyanı bağlayır. Serverdəki köhnə sətirlər üçün dəstəyə yaz. Silməzdən əvvəl datanı özünə göndərməyi məsləhət görürük.">
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
            title="Datanı bu cihazdan sil"
            subtitle="Hər şey silinir və çıxış edilir"
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
