import { useCallback } from "react";
import { refresh } from "@/api/hooks";
import { useRouter } from "@/lib/router";
import { pendingUpdate, STAYED_MS } from "./pwa";

/**
 * Refresh and reload, the same from every way in (FRONTEND_FOUNDATION F28): the
 * pull on a phone, the refresh button on desktop, and ⌘K's Refresh Screen and
 * Reload App.
 *
 *   refreshScreen   every read on the screen asks again in place: what is shown
 *                   stays until the answers land, scroll and typing are kept.
 *                   It settles when the last read is in, or after REFRESH_MS,
 *                   so a request that never answers cannot keep the pin turning.
 *   useReloadApp    the whole app starts again on the same screen. A screen
 *                   holding unsaved work asks first, as leaving it would; a new
 *                   version waiting takes over on the way (the update notice's
 *                   Reload). The promise settles only if the page stays.
 */
export const REFRESH_MS = 15000;

export function refreshScreen(): Promise<void> {
  return Promise.race([refresh("/api/"), new Promise<void>((done) => window.setTimeout(done, REFRESH_MS))]);
}

export function useReloadApp(): () => Promise<void> {
  const { confirmLeave } = useRouter();
  return useCallback(async () => {
    if (!(await confirmLeave())) return;
    const update = pendingUpdate();
    if (update) return update();
    window.location.reload();
    await new Promise<void>((stay) => window.setTimeout(stay, STAYED_MS));
  }, [confirmLeave]);
}
