import { create } from 'zustand';
import { Keyboard } from 'react-native';

/**
 * Global in-app UI overlays — a professional, design-system replacement for the
 * cheap native `Alert.alert`. Rendered by <UiHost/> at the app root.
 *
 *   import { toast, confirm, actionSheet } from '@/store/ui';
 *   toast('Əlavə edildi');
 *   confirm('Sil?', 'Geri qaytarmaq olmaz', [{ label: 'Ləğv et', style: 'cancel' }, { label: 'Sil', style: 'destructive', onPress: … }]);
 */
export type ToastKind = 'success' | 'info' | 'error';

export interface UiAction {
  label: string;
  onPress?: () => void;
  style?: 'default' | 'primary' | 'destructive' | 'cancel';
}

interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
}
interface Dialog {
  title: string;
  message?: string;
  actions: UiAction[];
}
interface Sheet {
  title?: string;
  message?: string;
  actions: UiAction[];
}

interface UiState {
  toast: Toast | null;
  dialog: Dialog | null;
  sheet: Sheet | null;
  /** Which thread the comments sheet is showing, or null when it is closed.
   *  It lives here — and is rendered by <UiHost/> at the app root — for two
   *  reasons: the root sits ABOVE the floating tab bar, so the bar can no longer
   *  cover the composer; and it stays in the app's own window, so Android's
   *  `adjustResize` moves it above the keyboard by itself. Inside a Modal (its
   *  own window) neither of those held. */
  comments: string | null;
  showToast: (msg: string, kind?: ToastKind) => void;
  hideToast: () => void;
  showDialog: (d: Dialog) => void;
  showSheet: (s: Sheet) => void;
  openComments: (targetKey: string) => void;
  closeComments: () => void;
  dismiss: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUi = create<UiState>((set) => ({
  toast: null,
  dialog: null,
  sheet: null,
  comments: null,
  showToast: (msg, kind = 'success') => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), msg, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 2400);
  },
  hideToast: () => set({ toast: null }),
  /* A dialog or action sheet is a modal decision — an open keyboard would sit on
     top of its buttons and cut them in half (exactly what happened when the auth
     gate fired from the comment composer). Close the keyboard first, always. */
  showDialog: (dialog) => {
    Keyboard.dismiss();
    set({ dialog, sheet: null });
  },
  showSheet: (sheet) => {
    Keyboard.dismiss();
    set({ sheet, dialog: null });
  },
  openComments: (comments) => set({ comments }),
  closeComments: () => set({ comments: null }),
  dismiss: () => set({ dialog: null, sheet: null }),
}));

// ---- imperative helpers (usable outside React components) ----
export const toast = (msg: string, kind?: ToastKind) => useUi.getState().showToast(msg, kind);
export const confirm = (title: string, message: string | undefined, actions: UiAction[]) =>
  useUi.getState().showDialog({ title, message, actions });
export const actionSheet = (s: Sheet) => useUi.getState().showSheet(s);
export const openComments = (targetKey: string) => useUi.getState().openComments(targetKey);
export const closeComments = () => useUi.getState().closeComments();
