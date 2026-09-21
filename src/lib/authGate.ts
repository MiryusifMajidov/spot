import { useRouter } from 'expo-router';

import { t } from '@/lib/i18n';
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

  return (action: () => void, reason = t('Bu funksiya üçün')) => {
    if (guest || !onboarded) {
      confirm(
        t('Hesab lazımdır'),
        // It no longer asks for «zalın, məqsədin, cədvəlin» — registration is a
        // name and an @ad. Promising a questionnaire that was deleted is the
        // kind of small lie that makes people close the dialog.
        t('{reason} hesabınla daxil ol və ya yenisini aç — bir dəqiqə çəkir. Onsuz sadəcə baxış rejimindəsən.', { reason }),
        [
          { label: t('İndi yox'), style: 'cancel' },
          { label: t('Daxil ol'), style: 'primary', onPress: () => router.push('/onboarding/welcome') },
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
