import type { useRouter } from 'expo-router';

import { useAppStore } from '@/store/appStore';
import { useUi } from '@/store/ui';

type Router = ReturnType<typeof useRouter>;

type Mode = 'user' | 'trainer' | 'gym_admin';
const ROUTES: Record<Mode, string> = {
  user: '/(tabs)/discover',
  trainer: '/trainer',
  gym_admin: '/gym',
};

/**
 * Instagram-style account switcher. The one person can hold a personal account
 * plus (optionally) a trainer and/or gym account, and switch between them — this
 * is an account switch, not a "mode". Available accounts depend on what they own.
 */
export function showAccountSwitcher(router: Router) {
  const { profile, activeMode, ownsGym, setMode } = useAppStore.getState();

  const accounts: { mode: Mode; label: string }[] = [{ mode: 'user', label: 'Şəxsi hesab' }];
  if (profile.role === 'trainer') accounts.push({ mode: 'trainer', label: 'Müəllim hesabı' });
  if (ownsGym) accounts.push({ mode: 'gym_admin', label: 'Zal hesabı' });

  useUi.getState().showSheet({
    title: 'Hesabını seç',
    message: profile.name ? `${profile.name} · ${accounts.length} hesab` : undefined,
    actions: [
      ...accounts.map((a) => ({
        label: activeMode === a.mode ? `${a.label} ✓` : a.label,
        onPress: () => {
          setMode(a.mode);
          (router.replace as (r: string) => void)(ROUTES[a.mode]);
        },
      })),
      { label: 'Bağla', style: 'cancel' as const },
    ],
  });
}

/** How many accounts this person can switch between. */
export function accountCount(): number {
  const { profile, ownsGym } = useAppStore.getState();
  return 1 + (profile.role === 'trainer' ? 1 : 0) + (ownsGym ? 1 : 0);
}
