import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { useAppStore } from '@/store/appStore';
import { UiAction, useUi } from '@/store/ui';
import { palette } from '@/theme';
import { CommentsSheet } from '@/components/CommentsSheet';

function actionColors(style: UiAction['style']) {
  switch (style) {
    case 'destructive':
      return { bg: palette.white, border: palette.separator, text: palette.red };
    case 'cancel':
      return { bg: palette.grouped, border: 'transparent', text: palette.textSecondary };
    case 'primary':
      return { bg: palette.volt, border: 'transparent', text: palette.inkText };
    default:
      return { bg: palette.ink, border: 'transparent', text: palette.white };
  }
}

/** When a time-boxed sanction lapses, in words.
 *
 *  It used to print `toLocaleDateString` alone, so a mute ending in ten minutes
 *  read «02/09/2026 tarixinə qədər» — today's date, with no hour. «Until today»
 *  tells the person nothing; on the last day the only useful number is the clock. */
function untilLabel(until: Date): string {
  const now = new Date();
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const time = until.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
  if (day(until) === day(now)) return `bu gün saat ${time}-a qədər`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (day(until) === day(tomorrow)) return `sabah saat ${time}-a qədər`;
  return `${until.toLocaleDateString('az-AZ')} tarixinə qədər`;
}

/** Global overlay host — renders custom toasts, dialogs and action sheets. */
export function UiHost() {
  const insets = useSafeAreaInsets();
  const toast = useUi((s) => s.toast);
  const dialog = useUi((s) => s.dialog);
  const sheet = useUi((s) => s.sheet);
  const comments = useUi((s) => s.comments);
  const sanction = useAppStore((s) => s.sanction);
  const sessionLost = useAppStore((s) => s.sessionLost);
  const closeComments = useUi((s) => s.closeComments);
  const dismiss = useUi((s) => s.dismiss);
  const hideToast = useUi((s) => s.hideToast);
  // The banner used to sit at `insets.top + 6`, directly over every screen's
  // title — «Kəşf» was invisible for as long as the sanction lasted. It now sits
  // above the tab bar, where it is still on every screen and still unmissable,
  // and the toast stacks on top of it instead of underneath.
  const [bannerH, setBannerH] = useState(0);
  const banner = sanction ? 'sanction' : sessionLost ? 'session' : null;
  const bannerBottom = insets.bottom + 74;

  /* Android's back button belongs to whatever is on top, and every overlay in
     SPOT — confirm dialogs, action sheets, the comments sheet — is state in
     `useUi` rendered HERE, outside the navigator. Nothing registered a handler,
     so back went to the Stack underneath: the screen behind the dialog navigated
     away while the dialog stayed mounted and live on top of whatever arrived.
     Pressing back to cancel «Hesabı tamamilə sil» left a red «Sil» button
     floating over the settings list, one tap from deleting the account. On the
     Feed tab, which is the app's root route, back exited SPOT with the comments
     sheet still open. */
  useEffect(() => {
    if (!dialog && !sheet && !comments) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (comments) {
        closeComments();
        return true;
      }
      if (dialog || sheet) {
        dismiss();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [dialog, sheet, comments, dismiss, closeComments]);

  const run = (a: UiAction) => {
    dismiss();
    a.onPress?.();
  };

  return (
    <>
      {/* ---- Centered dialog ---- */}
      {dialog ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
          <Animated.View entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(130)} style={styles.dialog}>
            <AppText variant="title3" center>
              {dialog.title}
            </AppText>
            {dialog.message ? (
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, lineHeight: 21 }}>
                {dialog.message}
              </AppText>
            ) : null}
            {/* Two actions sit side by side; three or more stack. `flex: 1` is
                applied ONLY in the row case — in a column the container has no
                fixed height, so a flexed child collapses to nothing. With four
                actions the buttons disappeared entirely and the dialog became a
                question with no answers. */}
            <View style={[styles.dialogActions, dialog.actions.length === 2 ? { flexDirection: 'row' } : undefined]}>
              {dialog.actions.map((a) => {
                const c = actionColors(a.style);
                return (
                  <PressableScale
                    key={a.label}
                    activeScale={0.97}
                    onPress={() => run(a)}
                    style={[
                      styles.dialogBtn,
                      dialog.actions.length === 2 ? { flex: 1 } : null,
                      { backgroundColor: c.bg, borderColor: c.border, borderWidth: c.border === 'transparent' ? 0 : 1 },
                    ]}>
                    <AppText style={{ fontSize: 15.5, fontWeight: '600', color: c.text }}>{a.label}</AppText>
                  </PressableScale>
                );
              })}
            </View>
          </Animated.View>
        </Animated.View>
      ) : null}

      {/* ---- Bottom action sheet ---- */}
      {sheet ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
          <Animated.View entering={SlideInDown.duration(220)} exiting={SlideOutDown.duration(160)} style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            {sheet.title || sheet.message ? (
              <View style={styles.sheetHeader}>
                {sheet.title ? <AppText variant="headline">{sheet.title}</AppText> : null}
                {sheet.message ? (
                  <AppText variant="footnote" color={palette.caption} style={{ marginTop: 4, lineHeight: 18 }}>
                    {sheet.message}
                  </AppText>
                ) : null}
              </View>
            ) : null}
            <View style={styles.sheetGroup}>
              {sheet.actions
                .filter((a) => a.style !== 'cancel')
                .map((a, i) => (
                  <View key={a.label}>
                    {i > 0 ? <View style={styles.sheetSep} /> : null}
                    <PressableScale activeScale={0.98} onPress={() => run(a)} style={styles.sheetRow}>
                      <AppText style={{ fontSize: 16, fontWeight: '500', color: a.style === 'destructive' ? palette.red : palette.inkText }}>
                        {a.label}
                      </AppText>
                    </PressableScale>
                  </View>
                ))}
            </View>
            <PressableScale activeScale={0.98} onPress={dismiss} style={styles.sheetCancel}>
              <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>
                {sheet.actions.find((a) => a.style === 'cancel')?.label ?? 'Ləğv et'}
              </AppText>
            </PressableScale>
          </Animated.View>
        </Animated.View>
      ) : null}

      {/* ---- Toast ----
          Cleared above the native tab bar. The host is outside the tab navigator, so
          `insets.bottom` here is the system inset only and the bar's own height has to
          be allowed for by hand. */}
      {toast ? (
        <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: bannerBottom + (banner ? bannerH + 8 : 0) }]}>
          <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(160)}>
            <PressableScale haptic={false} activeScale={0.98} onPress={hideToast} style={styles.toast}>
              {toast.kind !== 'info' ? (
                <View style={[styles.toastDot, { backgroundColor: toast.kind === 'error' ? palette.red : palette.volt }]}>
                  <Icon name={toast.kind === 'error' ? 'x' : 'check'} size={12} color={toast.kind === 'error' ? palette.white : palette.inkText} />
                </View>
              ) : null}
              <AppText style={{ color: palette.white, fontSize: 14, fontWeight: '600', flexShrink: 1 }}>{toast.msg}</AppText>
            </PressableScale>
          </Animated.View>
        </View>
      ) : null}
      {/* Rendered here, not inside the feed screen, for two reasons: the root sits
          above the tab bar, so the bar can never cover the composer; and it stays
          in the app's own window rather than a Modal's, which is what lets the
          sheet see the keyboard insets and lift itself. (Under Android
          edge-to-edge `adjustResize` does NOT resize the window — the sheet does
          that work itself; see CommentsSheet.) `comments` is the target key of the
          open thread, or null when the sheet is closed. */}
      <CommentsSheet visible={comments != null} targetKey={comments} onClose={closeComments} />

      {/* A live moderation sanction. The DATABASE is what blocks the writes
          (schema18 `is_sanctioned`), so without this the person would just find
          buttons that silently fail. Shown once, at the root, on every screen. */}
      {banner === 'sanction' && sanction ? (
        <View
          pointerEvents="box-none"
          style={[styles.sanctionWrap, { bottom: bannerBottom }]}
          onLayout={(e) => setBannerH(e.nativeEvent.layout.height)}
        >
          <View style={styles.sanctionCard}>
            <Icon name="shield" size={16} color={palette.white} />
            <AppText style={styles.sanctionText}>
              {sanction.status === 'banned'
                ? 'Hesabın bağlanıb — yeni paylaşım, şərh və mesaj göndərə bilmirsən.'
                : sanction.status === 'suspended'
                  ? 'Hesabın dayandırılıb — yeni paylaşım, şərh və mesaj göndərə bilmirsən.'
                  : sanction.until
                    ? `Yazma məhdudiyyətin var — ${untilLabel(sanction.until)}.`
                    : 'Yazma məhdudiyyətin var.'}
            </AppText>
          </View>
        </View>
      ) : null}

      {/* The account is on this device but its session did not come back. The app
          keeps working as a guest; saying nothing would make it look like the
          person's zal, streak and videos had simply vanished. Never shown at the
          same time as a sanction — one banner slot, the graver message wins. */}
      {banner === 'session' ? (
        <View
          pointerEvents="box-none"
          style={[styles.sanctionWrap, { bottom: bannerBottom }]}
          onLayout={(e) => setBannerH(e.nativeEvent.layout.height)}
        >
          <View style={styles.sanctionCard}>
            <Icon name="shield" size={16} color={palette.white} />
            <AppText style={styles.sanctionText}>
              Hesabına bağlanmaq alınmadı — qonaq kimi davam edirsən. Məlumatların
              itməyib; internet qayıdanda tətbiqi yenidən aç.
            </AppText>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,11,14,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  dialog: { width: '84%', maxWidth: 340, backgroundColor: palette.white, borderRadius: 22, padding: 22 },
  dialogActions: { gap: 9, marginTop: 20 },
  dialogBtn: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  sheet: { position: 'absolute', left: 8, right: 8, bottom: 0, gap: 8 },
  sheetHeader: { alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 16 },
  sheetGroup: { backgroundColor: palette.white, borderRadius: 16, overflow: 'hidden' },
  sheetRow: { height: 56, alignItems: 'center', justifyContent: 'center' },
  sheetSep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.separator },
  sheetCancel: { height: 56, borderRadius: 16, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center' },
  sanctionWrap: { position: 'absolute', left: 10, right: 10, alignItems: 'center', zIndex: 1002 },
  sanctionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: palette.red, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, maxWidth: '100%',
  },
  sanctionText: { flex: 1, color: palette.white, fontSize: 12.5, fontWeight: '600', lineHeight: 17 },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1001 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: palette.ink, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 12, maxWidth: '88%', ...(({ shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 }) as object) },
  toastDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
