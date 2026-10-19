import { useSyncExternalStore } from "react";

/**
 * Whether the notification pane and Notification Settings are open: one store, so the bell,
 * ⌘K (Notification Settings) and a link from a notification (`pane=notifications`) open the
 * same ones.
 */
interface UiState {
  pane: boolean;
  settings: boolean;
}

let ui: UiState = { pane: false, settings: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<UiState>) => {
  ui = { ...ui, ...patch };
  listeners.forEach((l) => l());
};

export function useNotificationsUi(): UiState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => ui,
    () => ui,
  );
}

export const setPaneOpen = (pane: boolean) => set({ pane });
export const setSettingsOpen = (settings: boolean) => set({ settings });
/** Notification Settings, over the pane on a phone. */
export const openNotificationSettings = () => set({ settings: true });
