import { useRouter } from 'expo-router';

import { useAppStore } from '@/store/appStore';
import { confirm } from '@/store/ui';

/**
 * Guest gate. Wrap any action that needs a real account (matching, messaging,
 * check-in, logging, saving). For guests it shows a gentle sign-up prompt and
 * routes to onboarding; for signed-in users it just runs the action.
 *
 *   const gate = useAuthGate();
 *   <Button onPress={() => gate(() => sendRequest(), 'Yoldaş tapmaq üçün')} />
 */
export function useAuthGate() {
  const guest = useAppStore((s) => s.guest);
  const onboarded = useAppStore((s) => s.onboarded);
  const router = useRouter();

  return (action: () => void, reason = 'Bu funksiya üçün') => {
    if (guest || !onboarded) {
      confirm(
        'Qısa profil lazımdır',
        `${reason} 30 saniyəlik profil yarat — zalın, məqsədin, cədvəlin. Onsuz sadəcə baxış rejimindəsən.`,
        [
          { label: 'İndi yox', style: 'cancel' },
          { label: 'Profil yarat', style: 'primary', onPress: () => router.push('/onboarding/goal') },
        ]
      );
      return;
    }
    action();
  };
}

/** Simple boolean for rendering read-only vs. full UI. */
export function useIsGuest() {
  return useAppStore((s) => s.guest && !s.onboarded);
}
