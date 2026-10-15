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
