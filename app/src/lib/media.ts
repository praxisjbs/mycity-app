import { useSyncExternalStore } from "react";

/** The prototype's mobile width. Below it the mobile shell renders, above it the desktop shell. */
const MOBILE_QUERY = "(max-width: 760px)";

function subscribe(query: string) {
  return (notify: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", notify);
    return () => mq.removeEventListener("change", notify);
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(subscribe(query), () => window.matchMedia(query).matches, () => false);
}

/** true on a phone: the mobile shell (gate 11). */
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
