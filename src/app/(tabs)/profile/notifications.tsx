import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { tapFeedback } from '@/lib/feedback';
import { NOTIF_TYPES, getNotifPrefs, setNotifPref, type NotifType } from '@/lib/notifications';
import { hasSupabaseConfig } from '@/lib/supabase';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

type State = 'loading' | 'ready' | 'failed';

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState<NotifType | null>(null);

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

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
