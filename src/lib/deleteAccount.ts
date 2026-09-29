import type { useRouter } from 'expo-router';

import { deleteMyAccount } from '@/lib/api';
import { t } from '@/lib/i18n';
import { unregisterPush } from '@/lib/push';
import { hasSupabaseConfig } from '@/lib/supabase';
import { wipeDeviceData } from '@/lib/wipe';
import { confirm, toast } from '@/store/ui';

/**
 * Really delete the account — the store requirement, and the thing the old
 * «Hesabı bu cihazdan sil» could not do. Files first, then the rows
 * (`deleteMyAccount` in src/lib/api.ts explains why that order is not
 * optional), then the device copy. Two confirmations, because it is final and
 * because the first one is easy to tap by mistake in a list of red rows.
 *
 * One function for both places it is offered: Məxfilik, where it always was,
 * and Parametrlər, where people (and App Review, guideline 5.1.1(v)) look for it
 * first — it used to be reachable only from inside Məxfilik.
 */
export function confirmDeleteAccount(router: ReturnType<typeof useRouter>): void {
  confirm(
    t('Hesabı tamamilə sil'),
    t('Profilin, videolarını, postlarını, şərhlərini, şəkillərini, check-inlərini və məşq tarixçəni həm bu telefondan, həm də serverdən silirik. İstifadəçi adın boşalır.\n\nZala yazdığın rəylər qalır, amma adın çıxarılır — başqaları həmin rəylərə baxıb qərar verib. Yaratdığın zal və proqramlar da qalır, çünki başqa üzvlər onlardan istifadə edir.\n\nBu addım geri qaytarıla bilməz.'),
    [
      { label: t('Ləğv et'), style: 'cancel' },
      {
        label: t('Davam et'),
        style: 'destructive',
        onPress: () =>
          confirm(
            t('Əminsən?'),
            t('Son təsdiq. «Sil» düyməsindən sonra hesab geri qaytarılmır.'),
            [
              { label: t('Ləğv et'), style: 'cancel' },
              {
                label: t('Sil'),
                style: 'destructive',
                onPress: async () => {
                  if (!hasSupabaseConfig) {
                    toast(t('Server bağlantısı yoxdur — hesab silinmədi'), 'error');
                    return;
                  }
                  try {
                    // Take this device's push address out first, while the
                    // session still exists to authorise it. The row would die
                    // with the profile anyway, but not until the RPC finishes.
                    await unregisterPush();
                    await deleteMyAccount();
                  } catch {
                    // Nothing partial is reported as done: if the server refused,
                    // the account is still there and the person must know it.
                    toast(t('Hesab silinmədi — internet yoxlanılsın, sonra yenidən cəhd et'), 'error');
                    return;
                  }
                  /* NOT the privacy screen's wipeDevice(): that one calls
                     ensureSession() first, so deleting the account signed a
                     brand-new anonymous user in on the server a second later — a
                     fresh orphan profile created by the act of deleting one.
                     wipeDeviceData() touches no session. */
                  await wipeDeviceData();
                  toast(t('Hesabın silindi'));
                  router.replace('/onboarding/welcome');
                },
              },
            ]
          ),
      },
    ]
  );
}
