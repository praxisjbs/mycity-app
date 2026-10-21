import type { LocationError } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";

/**
 * The attendance feature's one location reader (docs/guides/attendance.md §6.5): the clock's punch
 * and its Check In, and the home's Use This Location all read through it. It watches the device for
 * up to ten seconds and keeps the best fix, stopping early at 50 m or better; it never takes a cached
 * position; and a watchdog ends it whatever the browser does, so the panel never sticks while it
 * reads and Not Now, Esc and the close button keep working. Address fields keep their own fallback
 * (AddressField, F27).
 *
 * It also says what kind of device and browser this is, so a rough or missing reading names the fix
 * for that device, and gives every punch its Idempotency-Key on a page where crypto.randomUUID is
 * missing (an insecure page has none).
 */

export type Fix = { latitude: number; longitude: number; accuracy_m: number };
/** What a reading came to: the best fix, or why there is none. */
export type Reading = { fix: Fix; error: null } | { fix: null; error: LocationError };

/** How long a reading watches once the browser answers. */
export const READ_MS = 10_000;
/** A fix this fine (metres) ends the reading at once. */
export const GOOD_ENOUGH_M = 50;
/** How long the browser's own question may stay open before the reading gives up. */
export const ASK_MS = 30_000;
/** A phone's reading rougher than this (metres) comes from approximate location, not a weak signal. */
export const APPROXIMATE_M = 1000;

type Nav = Pick<Navigator, "userAgent" | "maxTouchPoints"> & {
  geolocation?: Geolocation;
  permissions?: Permissions;
  userAgentData?: { mobile?: boolean };
};

const nav = (): Nav | undefined => (typeof navigator === "undefined" ? undefined : (navigator as Nav));

/** False on a page the browser will not trust with a location (http on a real host). */
export const secure = (): boolean => typeof window === "undefined" || window.isSecureContext !== false;

/** Whether this browser can read a location at all. */
export const supported = (): boolean => Boolean(nav()?.geolocation);

/** Whether this site may read the location: granted, denied, or the browser will ask. */
export async function permission(): Promise<"granted" | "denied" | "prompt"> {
  try {
    const p = await nav()?.permissions?.query({ name: "geolocation" as PermissionName });
    return p?.state === "granted" || p?.state === "denied" ? p.state : "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * Read the location once: watch for up to READ_MS from the browser's first answer and keep the
 * finest fix, ending at GOOD_ENOUGH_M or better. Denied ends it at once. While the browser is still
 * asking, the watchdog waits ASK_MS for its first answer; either way the reading always ends.
 * Aborting it (the panel closed) stops the watch at once; its caller ignores what it answers then.
 */
export async function readLocation({ signal }: { signal?: AbortSignal } = {}): Promise<Reading> {
  if (!secure()) return { fix: null, error: "insecure" };
  const geo = nav()?.geolocation;
  if (!geo) return { fix: null, error: "unsupported" };
  const asking = (await permission()) !== "granted";
  return new Promise<Reading>((resolve) => {
    let best: Fix | null = null;
    let lastError: LocationError | null = null;
    let watch: number | null = null;
    let answered = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (forced?: Reading) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (watch !== null) geo.clearWatch(watch);
      signal?.removeEventListener("abort", stop);
      resolve(forced ?? (best ? { fix: best, error: null } : { fix: null, error: lastError ?? "timeout" }));
    };
    const stop = () => finish();
    /** The browser's first answer starts the ten seconds when it had to ask first. */
    const heard = () => {
      if (answered) return;
      answered = true;
      if (asking) {
        clearTimeout(timer);
        timer = setTimeout(stop, READ_MS);
      }
    };
    if (signal?.aborted) return finish();
    signal?.addEventListener("abort", stop);
    timer = setTimeout(stop, asking ? ASK_MS : READ_MS);
    try {
      watch = geo.watchPosition(
        (p) => {
          heard();
          const fix = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) };
          if (!best || fix.accuracy_m < best.accuracy_m) best = fix;
          if (best.accuracy_m <= GOOD_ENOUGH_M) finish();
        },
        (e) => {
          heard();
          if (e.code === 1) return finish({ fix: null, error: "denied" });
          lastError = e.code === 3 ? "timeout" : "unavailable";
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: READ_MS },
      );
    } catch {
      finish({ fix: null, error: "unsupported" });
    }
  });
}

/**
 * A reading a press starts and the screen waits on without holding its buttons: `read()` only
 * marks it reading (one press, one reading: a second press while it reads changes nothing), the
 * reading runs here, and `onRead` gets its answer. Closing the screen stops it.
 */
export function useLocationReader(onRead: (reading: Reading) => void) {
  const [reading, setReading] = useState(false);
  const latest = useRef(onRead);
  latest.current = onRead;
  useEffect(() => {
    if (!reading) return;
    const stop = new AbortController();
    readLocation({ signal: stop.signal }).then((r) => {
      if (stop.signal.aborted) return;
      setReading(false);
      latest.current(r);
    });
    return () => stop.abort();
  }, [reading]);
  return { reading, read: () => setReading(true) };
}

/* ------------------------------------------------------------------ *
 * This device, and the fix for it
 * ------------------------------------------------------------------ */

export type Device = "iphone" | "android" | "computer";
export type Browser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "other";

/** An iPhone or iPad, another phone (told as Android), or a computer. */
export function deviceOf(n: Nav | undefined = nav()): Device {
  const ua = n?.userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (n?.maxTouchPoints ?? 0) > 1)) return "iphone";
  if (/Android/i.test(ua) || n?.userAgentData?.mobile || /Mobi/i.test(ua)) return "android";
  return "computer";
}

/** The browser, as far as its settings differ. */
export function browserOf(n: Nav | undefined = nav()): Browser {
  const ua = n?.userAgent ?? "";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Edg(e|A|iOS)?\//i.test(ua)) return "edge";
  if (/Firefox|FxiOS/i.test(ua)) return "firefox";
  if (/Chrome|CriOS|Chromium/i.test(ua)) return "chrome";
  if (/Safari/i.test(ua)) return "safari";
  return "other";
}

const APP_NAME: Record<Browser, string> = { safari: "Safari Websites", chrome: "Chrome", edge: "Edge", firefox: "Firefox", samsung: "Samsung Internet", other: "your browser" };

/** The banner a reading's fix shows: its name and what to do, one sentence. */
export type LocationFix = { title: string; text: string };

/**
 * What a reading that cannot prove the place needs, for this device (§6.5, T10): a phone set to
 * approximate location, a computer, a blocked permission, an insecure page. Null when the fix is
 * the usual one (move, then retry), which the location step says itself.
 */
export function fixFor(reading: { error: LocationError | null; accuracy_m?: number | null }, n: Nav | undefined = nav()): LocationFix | null {
  const device = deviceOf(n);
  const browser = browserOf(n);
  if (reading.error === "insecure")
    return { title: "Secure Address Needed", text: `open ${typeof location === "undefined" ? "the https address" : `https://${location.host}`} to clock in.` };
  if (reading.error === "denied") return { title: "Location Blocked", text: blockedHow(device, browser) };
  if (reading.error === "unsupported") return null;
  if (device === "computer") return { title: "Use Your Phone", text: "a computer cannot place you closely enough, so clock in from your phone." };
  if (!reading.error && (reading.accuracy_m ?? 0) > APPROXIMATE_M)
    return {
      title: "Precise Location Off",
      text:
        device === "iphone"
          ? `open Settings, Privacy, Location Services, ${APP_NAME[browser === "other" ? "safari" : browser]}, and turn on Precise Location.`
          : `open Settings, Location, App permissions, ${APP_NAME[browser]}, and turn on Use precise location.`,
    };
  return null;
}

/** How to let this site read the location again, in this browser on this device. */
function blockedHow(device: Device, browser: Browser): string {
  if (device === "iphone")
    return browser === "safari" || browser === "other"
      ? "tap aA in the address bar, then Website Settings, Location, Allow."
      : `open Settings, Privacy, Location Services, ${APP_NAME[browser]}, and choose While Using.`;
  if (browser === "firefox") return "tap the icon beside the address, then clear Blocked next to Location.";
  if (browser === "safari") return "open Safari, Settings for This Website, then set Location to Allow.";
  return device === "android"
    ? "tap the icon beside the address, then Permissions, Location, Allow."
    : "click the icon beside the address, then turn Location on.";
}

/* ------------------------------------------------------------------ *
 * A punch's key
 * ------------------------------------------------------------------ */

/** A new Idempotency-Key: crypto.randomUUID where the page has it, else a version 4 UUID from getRandomValues. */
export function newKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < b.length; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
