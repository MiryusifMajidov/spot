import { NativeTabs } from 'expo-router/unstable-native-tabs';

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
 * and would have kept producing them on every screen added later. The native bar
 * reserves its own space, so that entire class of bug cannot occur.
 */
export default function TabsLayout() {
  return (
    <NativeTabs backgroundColor={palette.white} tintColor={palette.ink} labelStyle={{ selected: { color: palette.ink } }}>
      <NativeTabs.Trigger name="discover">
        <NativeTabs.Trigger.Label>Kəşf</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'magnifyingglass', selected: 'magnifyingglass' }} md="search" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="workout">
        <NativeTabs.Trigger.Label>Məşq</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'dumbbell', selected: 'dumbbell.fill' }} md="fitness_center" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="feed">
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'play.rectangle', selected: 'play.rectangle.fill' }} md="play_circle" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
