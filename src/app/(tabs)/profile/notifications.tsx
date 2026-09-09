import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { tapFeedback } from '@/lib/feedback';
import { NOTIF_TYPES, getNotifPrefs, setNotifPref, type NotifType } from '@/lib/notifications';
import { pushPermission, registerPush } from '@/lib/push';
import { hasSupabaseConfig } from '@/lib/supabase';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

type State = 'loading' | 'ready' | 'failed';

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState<NotifType | null>(null);
  /* What the OS actually allows. Without this the switches below promise
     notifications that Android or iOS is silently dropping — the app claiming
     something only the system can grant. */
  const [perm, setPerm] = useState<'granted' | 'denied' | 'undetermined' | 'unavailable' | null>(null);

  const load = useCallback(() => {
    if (!hasSupabaseConfig) {
      setState('failed');
      return;
    }
    setState('loading');
    getNotifPrefs()
      .then((p) => {
        setPrefs(p);
        setState('ready');
      })
      .catch(() => setState('failed'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // Re-read on every focus: the person may have just come back from the
      // system settings having changed it.
      void pushPermission().then(setPerm);
    }, [load])
  );

  const toggle = async (type: NotifType, next: boolean) => {
    tapFeedback();
    setBusy(type);
    // Optimistic, then corrected by the real result — a switch that stays where
    // the finger left it while the server refused would be a lie about a setting.
    setPrefs((p) => ({ ...p, [type]: next }));
    try {
      await setNotifPref(type, next);
    } catch {
      setPrefs((p) => ({ ...p, [type]: !next }));
      toast('Ayar saxlanılmadı — yenidən cəhd et', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title="Bildirişlər" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {perm === 'denied' || perm === 'undetermined' ? (
          <PressableScale
            activeScale={0.98}
            onPress={() => {
              // «undetermined» means the system will still show the dialog;
              // «denied» means only the settings app can change it now.
              if (perm === 'undetermined') void registerPush().then(() => pushPermission().then(setPerm));
              else void Linking.openSettings();
            }}
            style={styles.permCard}>
            <Icon name="bell" size={18} color={palette.streak} />
            <View style={{ flex: 1 }}>
              <AppText variant="subhead">Telefon bildirişləri bağlıdır</AppText>
              {/* «Aşağıdaki» put a front-vowel suffix on a back-vowel stem; the
                  form Azerbaijani takes here is «Aşağıdakı». */}
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
                Aşağıdakı ayarlar işləyir, amma telefon SPOT-a bildiriş göstərməyə icazə vermir — mesaj və məşq
                təklifi yalnız tətbiqi açanda görünəcək. {perm === 'undetermined' ? 'İcazə vermək üçün toxun.' : 'Telefon ayarlarını açmaq üçün toxun.'}
              </AppText>
            </View>
          </PressableScale>
        ) : null}
        {state === 'loading' ? (
          <AppText variant="body" color={palette.textSecondary} style={styles.note}>Yüklənir…</AppText>
        ) : state === 'failed' ? (
          <View style={styles.failed}>
            <Icon name="shield" size={24} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 10 }}>Ayarlar yüklənmədi</AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 5, lineHeight: 20 }}>
              Hansı bildirişlərin açıq olduğunu oxuya bilmədik — ona görə açarları göstərmirik.
            </AppText>
            <PressableScale onPress={load} style={styles.retry}>
              <AppText variant="callout" color={palette.white}>Yenidən cəhd et</AppText>
            </PressableScale>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              {NOTIF_TYPES.map((t, i) => (
                <View key={t.type} style={[styles.row, i > 0 && styles.rowBorder]}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="callout">{t.label}</AppText>
                    <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2, lineHeight: 17 }}>
                      {t.hint}
                    </AppText>
                  </View>
                  <Switch
                    // A missing key means ON — see notif_prefs in schema35.
                    value={prefs[t.type] !== false}
                    disabled={busy === t.type}
                    onValueChange={(v) => void toggle(t.type, v)}
                    trackColor={{ false: palette.separator, true: palette.voltDeep }}
                  />
                </View>
              ))}
            </View>

            <AppText variant="footnote" color={palette.textSecondary} style={styles.footer}>
              Söndürdüyün növ ümumiyyətlə qeyd olunmur — gizlədilmir, yazılmır. Yenidən açsan,
              bundan sonrakılar gələcək.
            </AppText>

            <AppText variant="footnote" color={palette.caption} style={styles.footer2}>
              Video və postlara qoyulan bəyənmələr üçün hələ bildiriş yoxdur: bəyənmə hazırda
              yalnız cihazda saxlanılır, ona görə server kimin nəyi bəyəndiyini bilmir. Uydurma
              bildiriş göndərməkdənsə, göndərmirik.
            </AppText>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  permCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: palette.white,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: palette.streak,
  },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 28 },
  note: { textAlign: 'center', marginTop: 40 },
  failed: { alignItems: 'center', marginTop: 60, paddingHorizontal: 20 },
  retry: { marginTop: 16, backgroundColor: palette.inkText, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11 },
  card: { backgroundColor: palette.white, borderRadius: 18, paddingHorizontal: 14, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
  footer: { marginTop: 12, lineHeight: 18, paddingHorizontal: 4 },
  footer2: { marginTop: 14, lineHeight: 17, paddingHorizontal: 4 },
});
