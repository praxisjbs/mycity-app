import { createContext, useContext, useEffect } from "react";

/**
 * A "fit" page (a chat, the mailbox) fills the space under the tabs and does
 * not scroll as a page: only its own panes scroll, so the composer stays put.
 */
export const FitContext = createContext<(fit: boolean) => void>(() => {});

export function useFitPage(fit = true) {
  const set = useContext(FitContext);
  useEffect(() => {
    set(fit);
    return () => set(false);
  }, [fit, set]);
}
