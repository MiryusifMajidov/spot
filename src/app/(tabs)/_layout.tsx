import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { DynamicColorIOS, Platform } from 'react-native';

import { useIsGuest } from '@/lib/authGate';
import { useT } from '@/lib/useT';
import { palette } from '@/theme';

/**
 * The platform's own bottom bar.
 *
 * We tried a custom floating pill (`SpotTabBar`, see git history) and moved back.
 * Worth recording why, because the obvious argument for the pill was wrong: it did
 * NOT make tab switching faster. The 1.2 s lag on the Feed tab came from expo-video
 * building its ExoPlayers during the transition, and that was fixed separately
 * (`playersReady` + `afterTransition` in feed/index.tsx). With that fix in place the
 * native bar measures the same as the custom one — ~920 ms, the adb noise floor.
 *
 * What the pill did cost was real. It floats, so it takes no layout space, and every
 * screen had to subtract its footprint by hand. That produced a run of layout bugs —
 * the video and its scrubber hidden underneath it, the comments composer covered —
 * and would have kept producing them on every screen added later.
 *
 * CORRECTION (28.09.2026): «the native bar reserves its own space» is true on
 * ANDROID ONLY. On iOS 26 NativeTabs is the Liquid Glass bar, and it FLOATS: content
 * runs underneath it by design. So the bug class above is back on iPhones — a fixed
 * bottom button row on a tab screen gets covered (the trainer profile's buttons were
 * hidden behind the glass). The fix is not a hard-coded height: inside a tab screen
 * UIKit's safe area already includes the bar, so ON iOS a pinned bottom row pads by
 * useSafeAreaInsets().bottom. `Screen` applies only the top edge by default, which is
 * why that padding has to be asked for on those screens.
 *
 * iOS ONLY — do not apply it on Android. There, expo-router already wraps each tab
 * scene in a bottom-edged SafeAreaView (NativeTabsView.android.js), while
 * useSafeAreaInsets() reads the root provider and returns the navigation-bar height;
 * adding it again leaves an empty band above the Material bar. The pattern every
 * fixed screen uses is `Platform.OS === 'ios' ? insets.bottom : 0`.
 *
 * A guest sees ONE tab. Browsing without an account is a catalogue: which gyms
 * are in the city and which coaches work in them. Məşq, Feed and Profil all need
 * an identity to mean anything — a workout history belongs to somebody, a video
 * is posted by somebody — so showing them to a guest offered three rooms with
 * nothing in them and a sign-up prompt behind every button.
 *
 * `hidden` rather than not rendering the trigger: the number of children stays
 * the same, so the native bar is never rebuilt underneath the person when they
 * sign in — the three tabs simply appear.
 */
/**
 * Tab colours.
 *
 * ACTIVE: iOS 26 draws the bar as glass that takes on the content behind it — over a
 * dark screen (exercise detail, a running session, the video feed) the glass turns
 * dark. A fixed ink tint then drew the active tab black on black, and it read as a
 * DISABLED tab rather than the current one. DynamicColorIOS follows the bar instead.
 * Android's Material bar is always white here, so ink is right there.
 *
 * INACTIVE: the old default was `tertiary` (#A0A0A8), about 2.6:1 on white — below
 * the 3:1 floor for interface controls, which is why the icons read as faint and
 * «too small» even at the platform's standard size. `textSecondary` is ~5:1.
 */
const active = Platform.OS === 'ios' ? DynamicColorIOS({ light: palette.ink, dark: palette.white }) : palette.ink;
const inactive =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ light: palette.textSecondary, dark: 'rgba(255,255,255,0.62)' })
    : palette.textSecondary;

export default function TabsLayout() {
  const t = useT();
  const guest = useIsGuest();
  return (
    <NativeTabs
      backgroundColor={palette.white}
      tintColor={active}
      iconColor={{ default: inactive, selected: active }}
      labelStyle={{ default: { color: inactive }, selected: { color: active } }}
      /* Android named only the SELECTED tab, so four of five icons stood alone and a
         person had to guess what a QR glyph or a play button meant. Five tabs is
         exactly where Material recommends labelling all of them. */
      labelVisibilityMode="labeled"
      /* The default indicator is derived from the ink tint: a dark slate pill with an
         ink icon on top of it, so the ACTIVE tab was the hardest one to see. Volt is
         the app's own selection colour (the «Məşqə başla» button), and ink on volt is
         the highest-contrast pair the brand has. */
      indicatorColor={palette.volt}>
      <NativeTabs.Trigger name="discover">
        <NativeTabs.Trigger.Label>{t('Kəşf')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'magnifyingglass', selected: 'magnifyingglass' }} md="search" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="workout" hidden={guest}>
        <NativeTabs.Trigger.Label>{t('Məşq')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'dumbbell', selected: 'dumbbell.fill' }} md="fitness_center" />
      </NativeTabs.Trigger>

      {/* The QR scanner sits in the middle of five, which is where a thumb
          lands. Check-in used to be a tile inside the Məşq tab — three taps and
          a guess about where it lived; it is the one action a person performs
          standing in the doorway of a gym, so it is one tap from anywhere. */}
      <NativeTabs.Trigger name="checkin" hidden={guest}>
        <NativeTabs.Trigger.Label>{t('Check-in')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'qrcode.viewfinder', selected: 'qrcode.viewfinder' }} md="qr_code_scanner" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="feed" hidden={guest}>
        <NativeTabs.Trigger.Label>{t('Feed')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'play.rectangle', selected: 'play.rectangle.fill' }} md="play_circle" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile" hidden={guest}>
        <NativeTabs.Trigger.Label>{t('Profil')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
