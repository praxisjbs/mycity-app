import { useCallback, useSyncExternalStore } from "react";

/** A phone: 760 px wide and below (gate 11). The `phone:` variant and the gates use the same width. */
export const PHONE_QUERY = "(max-width: 760px)";

/** true while the media query matches; false before the first render on a server. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** true on a phone: the phone shell renders (gate 11). */
export const useIsPhone = (): boolean => useMediaQuery(PHONE_QUERY);

/** The merged screens' name for useIsPhone. */
export const useIsMobile = useIsPhone;

/** Running as an installed app: every display mode but a browser tab's. */
export const INSTALLED_QUERY =
  "(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen), (display-mode: window-controls-overlay)";

const iosHomeScreen = () => typeof navigator !== "undefined" && (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Running as an installed app right now, read once (outside React: the app's start). */
export const isInstalled = (): boolean =>
  typeof window !== "undefined" && (!!window.matchMedia?.(INSTALLED_QUERY).matches || iosHomeScreen());

/**
 * true while the app runs as an installed app (FRONTEND_FOUNDATION F29): its
 * own window on a computer, or opened from the home screen of a phone, where
 * an iPhone says so through navigator.standalone. A browser tab is false.
 */
export function useInstalled(): boolean {
  const mode = useMediaQuery(INSTALLED_QUERY);
  return mode || iosHomeScreen();
}
