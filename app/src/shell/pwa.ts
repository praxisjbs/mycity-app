import { useSyncExternalStore } from "react";

/**
 * The installed app (FRONTEND_GUIDE §9.7; PR 2 question 4). One store for:
 *
 *   update     a new version is waiting (vite-plugin-pwa, registerType "prompt"):
 *              the shell asks with a notice instead of reloading under someone
 *   install    the browser offered to install (beforeinstallprompt), or this is an
 *              iPhone or iPad in Safari, where Install App shows the steps instead
 *   installed  opened as an installed app (display-mode standalone, or iOS's
 *              navigator.standalone), or the browser said it was installed
 *              (appinstalled): then nothing offers to install
 *   banner     the one-time offer: from the person's second signed-in visit on
 *              this device, on a phone and on desktop; Not Now holds it for 30 days
 *
 * The service worker registers only in a build (never under `npm run dev`); the
 * screen gates' crawl blocks it.
 *
 * Reload hands over to the waiting version and reloads once it has taken over
 * (reloadOnTakeover). The plugin alone reloads only a page that a service worker
 * was already running when it loaded, so after a hard refresh pressing Reload did
 * nothing; and with no sign of work the press looked dead even when it worked.
 */

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  update: (() => Promise<void>) | null;
  prompt: InstallPrompt | null;
  installed: boolean;
  ios: boolean;
  visits: number;
  laterUntil: number;
}

const VISITS = "mc-visits";
const LATER = "mc-install-later";
const COUNTED = "mc-visit-counted";
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
/** How long Reload waits for the new version to take over before it reloads anyway. */
export const TAKEOVER_MS = 4000;
/** How long after asking for the reload the page is taken to have stayed (a person kept unsaved work). */
export const STAYED_MS = 3000;

const read = (key: string, store: () => Storage): number => {
  try {
    return Number(store().getItem(key)) || 0;
  } catch {
    return 0;
  }
};
const write = (key: string, value: number, store: () => Storage) => {
  try {
    store().setItem(key, String(value));
  } catch {
    /* storage can be blocked; the offer then shows again next time */
  }
};

const standalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
const iosSafari = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

let state: PwaState = { update: null, prompt: null, installed: false, ios: false, visits: 0, laterUntil: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let started = false;
let registration: ServiceWorkerRegistration | undefined;

/**
 * Asks the waiting version to take over, then reloads as soon as it has: when it
 * controls this page, when it reports itself activated (a page loaded with a hard
 * refresh is not controlled, so it never hears the first), or after TAKEOVER_MS
 * at the latest. With nothing waiting, it reloads at once. The promise keeps the
 * Reload button busy, and settles only if the page stays after all (the browser
 * asked about unsaved work and the person stayed), so the button comes back.
 */
export function reloadOnTakeover(
  waiting: ServiceWorker | null | undefined,
  skipWaiting: () => Promise<void>,
  reload: () => void,
  container: ServiceWorkerContainer | undefined = typeof navigator === "undefined" ? undefined : navigator.serviceWorker,
): Promise<void> {
  return new Promise<void>((settle) => {
    let asked = false;
    const go = () => {
      if (asked) return;
      asked = true;
      reload();
      window.setTimeout(settle, STAYED_MS);
    };
    if (!waiting) return go();
    container?.addEventListener("controllerchange", go, { once: true });
    waiting.addEventListener("statechange", () => {
      if (waiting.state === "activated") go();
    });
    window.setTimeout(go, TAKEOVER_MS);
    skipWaiting().catch(go);
  });
}

/** Called once at start: reads the device's state, listens for the browser's install events, registers the service worker. */
export function startPwa(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  set({ installed: standalone(), ios: iosSafari(), visits: read(VISITS, () => localStorage), laterUntil: read(LATER, () => localStorage) });
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    set({ prompt: e as InstallPrompt });
  });
  window.addEventListener("appinstalled", () => set({ installed: true, prompt: null }));
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", (e) => e.matches && set({ installed: true }));

  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      onRegisteredSW(_url, r) {
        registration = r;
      },
      onNeedRefresh() {
        set({
          update: async () => {
            const reg = registration ?? (await navigator.serviceWorker.getRegistration());
            return reloadOnTakeover(reg?.waiting, () => updateSW(true), () => window.location.reload());
          },
        });
      },
    });
  });
}

/** A signed-in visit, counted once per browser session (the shell calls it on mount). */
export function noteVisit(): void {
  if (read(COUNTED, () => sessionStorage)) return;
  write(COUNTED, 1, () => sessionStorage);
  const visits = read(VISITS, () => localStorage) + 1;
  write(VISITS, visits, () => localStorage);
  set({ visits });
}

/** Not Now: no banner on this device for 30 days. */
export function installLater(now = Date.now()): void {
  write(LATER, now + THIRTY_DAYS, () => localStorage);
  set({ laterUntil: now + THIRTY_DAYS });
}

/**
 * Installs: the browser's own prompt where there is one. Returns "steps" on an
 * iPhone or iPad, where the shell shows the Add to Home Screen steps instead.
 */
export async function install(): Promise<"done" | "steps" | "none"> {
  if (state.prompt) {
    const p = state.prompt;
    await p.prompt();
    const choice = await p.userChoice;
    set({ prompt: null, installed: choice.outcome === "accepted" || state.installed });
    return "done";
  }
  return state.ios && !state.installed ? "steps" : "none";
}

/** What the shell shows: the update notice, Install App, and the one-time banner. */
export function usePwa() {
  const s = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state,
  );
  const canInstall = !s.installed && (!!s.prompt || s.ios);
  return {
    update: s.update,
    canInstall,
    installed: s.installed,
    banner: canInstall && s.visits >= 2 && s.laterUntil < Date.now(),
  };
}

/** Tests only: back to a fresh device. */
export function resetPwaForTest(patch: Partial<PwaState> = {}): void {
  started = false;
  state = { update: null, prompt: null, installed: false, ios: false, visits: 0, laterUntil: 0, ...patch };
  listeners.forEach((l) => l());
}
