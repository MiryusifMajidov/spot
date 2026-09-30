import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import type { IconName } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { ListGroup, ListRow } from '@/components/ui/ListGroup';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { deviceTitle, listDevices, revokeDevice, revokeOtherDevices, touchDevice, type DeviceSession } from '@/lib/devices';
import { successFeedback } from '@/lib/feedback';
import { t as tDefault } from '@/lib/i18n';
import { useT } from '@/lib/useT';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

type State = { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; items: DeviceSession[] };

/** «İndi aktiv», «3 saat əvvəl», «Dünən», «12 gün əvvəl», then the date. */
function lastActive(iso: string, now: number, tr: typeof tDefault): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const min = Math.max(0, Math.floor((now - then) / 60000));
  if (min < 5) return tr('İndi aktiv');
  if (min < 60) return tr('{n} dəqiqə əvvəl', { n: min, count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return tr('{n} saat əvvəl', { n: hr, count: hr });
  const days = Math.floor(hr / 24);
  if (days === 1) return tr('Dünən');
  if (days < 30) return tr('{n} gün əvvəl', { n: days, count: days });
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/**
 * Aktiv cihazlar — where this account is open right now.
 *
 * Each row is a real session on the server (src/lib/devices.ts), so removing one
 * really ends it: that phone stops getting this account's notifications at once
 * and is signed out the next time it opens SPOT. This phone is not removable
 * from here — leaving on this phone is «Hesabdan çıx», which also clears it.
 */
export default function Devices() {
  const t = useT();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      // Report this phone first, so its own row carries its model and version
      // even right after signing in (the launch-time report ran before that).
      await touchDevice(true);
      const items = await listDevices();
      setNow(Date.now());
      setState({ phase: 'ready', items });
    } catch {
      setState((s) => (s.phase === 'ready' ? s : { phase: 'failed' }));
      return false;
    }
    return true;
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    const ok = await load();
    setRefreshing(false);
    if (!ok) toast(t('Cihazlar yenilənmədi — internet yoxlanılsın'), 'error');
  };

  const retry = () => {
    setState({ phase: 'loading' });
    void load();
  };

  const removeOne = (d: DeviceSession) =>
    confirm(
      t('{name} hesabdan çıxarılsın?', { name: deviceTitle(d, t) }),
      t('O cihaz bu hesabın bildirişlərini dərhal almır və SPOT-u növbəti açanda hesabdan çıxır. Sonra yenidən daxil ola bilər.'),
      [
        { label: t('Ləğv et'), style: 'cancel' },
        {
          label: t('Çıxar'),
          style: 'destructive',
          onPress: async () => {
            setBusy(d.id);
            try {
              await revokeDevice(d.id);
              successFeedback();
              setState((s) => (s.phase === 'ready' ? { ...s, items: s.items.filter((x) => x.id !== d.id) } : s));
              toast(t('Cihaz hesabdan çıxarıldı'));
            } catch {
              toast(t('Cihaz çıxarılmadı — yenidən cəhd et'), 'error');
            } finally {
              setBusy(null);
              void load();
            }
          },
        },
      ]
    );

  const removeOthers = (count: number) =>
    confirm(
      t('Digər bütün cihazlardan çıxılsın?'),
      t('Hesab yalnız bu telefonda açıq qalacaq. Digər {n} cihaz bildiriş almayacaq və SPOT-u növbəti açanda hesabdan çıxacaq.', { n: count, count }),
      [
        { label: t('Ləğv et'), style: 'cancel' },
        {
          label: t('Hamısından çıx'),
          style: 'destructive',
          onPress: async () => {
            setBusy('all');
            try {
              const n = await revokeOtherDevices();
              successFeedback();
              setState((s) => (s.phase === 'ready' ? { ...s, items: s.items.filter((x) => x.current) } : s));
              toast(t('{n} cihaz hesabdan çıxarıldı', { n, count: n }));
            } catch {
              toast(t('Cihazlar çıxarılmadı — yenidən cəhd et'), 'error');
            } finally {
              setBusy(null);
              void load();
            }
          },
        },
      ]
    );

  const subtitleOf = (d: DeviceSession) => {
    const bits = [d.os, d.appVersion ? `SPOT ${d.appVersion}` : null].filter(Boolean) as string[];
    const seen = d.current ? t('İndi aktiv') : lastActive(d.lastActiveAt, now, t);
    return [...bits, seen].filter(Boolean).join(' · ');
  };

  const iconOf = (d: DeviceSession): IconName => (d.platform === 'web' ? 'browser' : 'phone');

  let body: ReactNode;
  if (state.phase === 'loading') {
    body = <ActivityIndicator style={styles.spinner} color={palette.caption} />;
  } else if (state.phase === 'failed') {
    body = (
      <ListGroup footer={t('Cihazların siyahısı serverdən gəlir. İnternetə qoşul və yenidən yoxla.')}>
        <ListRow
          icon="shield"
          iconBg={palette.streak}
          title={t('Cihazlar yüklənmədi')}
          subtitle={t('Yenidən cəhd etmək üçün toxun')}
          chevron={false}
          onPress={retry}
        />
      </ListGroup>
    );
  } else {
    const current = state.items.filter((d) => d.current);
    const others = state.items.filter((d) => !d.current);
    body = (
      <>
        <ListGroup header={t('Bu cihaz')}>
          {current.length ? (
            current.map((d) => (
              <ListRow key={d.id} icon={iconOf(d)} iconBg={palette.voltDeep} title={deviceTitle(d, t)} subtitle={subtitleOf(d)} />
            ))
          ) : (
            // Only a session that is not in the list at all — a token the server
            // no longer knows. touchDevice signs such a phone out on its own.
            <ListRow icon="phone" iconBg={palette.voltDeep} title={t('Bu telefon')} subtitle={t('İndi aktiv')} />
          )}
        </ListGroup>

        <ListGroup
          header={others.length ? t('Digər cihazlar ({n})', { n: others.length }) : t('Digər cihazlar')}
          footer={t('Tanımadığın və ya artıq istifadə etmədiyin cihazı çıxar. O cihaz dərhal bildiriş almır və SPOT-u növbəti açanda hesabdan çıxır.')}>
          {others.length ? (
            others.map((d) => (
              <ListRow
                key={d.id}
                icon={iconOf(d)}
                iconBg={palette.ink}
                title={deviceTitle(d, t)}
                subtitle={subtitleOf(d)}
                right={
                  busy === d.id ? (
                    <ActivityIndicator color={palette.caption} style={styles.removeBtn} />
                  ) : (
                    <PressableScale
                      activeScale={0.94}
                      disabled={busy !== null}
                      onPress={() => removeOne(d)}
                      accessibilityRole="button"
                      accessibilityLabel={t('{name} cihazını çıxar', { name: deviceTitle(d, t) })}
                      style={styles.removeBtn}>
                      <AppText variant="subhead" color={palette.red}>
                        {t('Çıxar')}
                      </AppText>
                    </PressableScale>
                  )
                }
              />
            ))
          ) : (
            <ListRow title={t('Hesabın başqa cihazda açıq deyil')} chevron={false} />
          )}
        </ListGroup>

        {others.length ? (
          <ListGroup>
            <ListRow
              title={busy === 'all' ? t('Çıxarılır…') : t('Digər bütün cihazlardan çıx')}
              danger
              chevron={false}
              onPress={busy !== null ? undefined : () => removeOthers(others.length)}
            />
          </ListGroup>
        ) : null}
      </>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title={t('Aktiv cihazlar')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.caption} />}>
        <View style={styles.lead}>
          <AppText variant="footnote" color={palette.textSecondary} style={styles.leadText}>
            {t('SPOT hesabının hazırda açıq olduğu telefonlar. Siyahını aşağı çəkib yeniləyə bilərsən.')}
          </AppText>
        </View>
        {body}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: 28 },
  lead: { marginTop: 4, marginBottom: 16, marginHorizontal: 4 },
  leadText: { lineHeight: 18 },
  spinner: { marginTop: 40 },
  // A 44 pt target for a word-sized button at the end of the row.
  removeBtn: { minWidth: 64, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
});
