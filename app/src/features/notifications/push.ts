import { useSyncExternalStore } from "react";
import { toast } from "@mycity/ui";
import { api, ApiError } from "@/api/client";
import { clearDevice, readDevice, writeDevice } from "./device-store";

/**
 * Web push on this device (docs/guides/notifications.md §3, §6): what the browser allows,
 * turning it on (the permission, the subscription, saving it as one of the person's devices),
 * keeping it saved on every sign-in, and turning it off.
 *
 *   unsupported    this browser has no web push
 *   needs-install  an iPhone or iPad in Safari: iOS pushes only to an installed app
 *   ask            never asked: Turn On asks the browser (from a press, as iOS requires)
 *   blocked        refused in the browser's settings; only the person can allow it there
 *   off            allowed, but turned off here (Turn Off, remembered on this device)
 *   on             subscribed and saved
 *   unavailable    the server cannot push (no keys)
 *
 * syncPush() runs on every signed-in start: a browser already allowed is subscribed again if
 * it lost its subscription or was subscribed under an older key, and saved, which also moves
 * the device to whoever is signed in. The device's id and token go to IndexedDB for the
 * service worker (device-store.ts).
 */
export type PushState = "checking" | "unsupported" | "needs-install" | "ask" | "blocked" | "off" | "on" | "unavailable";

const OFF_KEY = "mc-push-off";
const READY_MS = 8000;

let state: PushState = "checking";
const listeners = new Set<() => void>();
const set = (next: PushState) => {
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
};

/** The state, for a component. */
export function usePushState(): PushState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state,
  );
}

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const appleMobile = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

const offHere = () => {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
};
const rememberOff = (off: boolean) => {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    /* storage can be refused; the next start asks the server again */
  }
};

/** The service worker, or null when there is none (a laptop's dev server) or it is slow to start. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), READY_MS))]);
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Saves this browser's subscription as the person's device, keeping the token it holds. */
async function save(sub: PushSubscription, key: string, keyId: string): Promise<void> {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error("push: the subscription has no keys");
  const held = await readDevice();
  const saved = await api.call("POST /api/v1/notifications/push/subscriptions", {
    body: {
      endpoint: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
      expires_at: sub.expirationTime ? new Date(sub.expirationTime).toISOString() : null,
      ...(held ? { push_subscription_id: held.id, device_token: held.token } : {}),
    },
  });
  await writeDevice({ id: saved.push_subscription_id, token: saved.device_token, key, keyId });
}

/** The state before anything is subscribed: what the browser and the person allow. */
function permissionState(): PushState {
  if (!supported()) return appleMobile() && !installed() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "default") return appleMobile() && !installed() ? "needs-install" : "ask";
  return offHere() ? "off" : "on";
}

/**
 * On every signed-in start: subscribes again where the browser is allowed but lost its
 * subscription or holds one under an older key, and saves the device. Never asks.
 */
export async function syncPush(): Promise<PushState> {
  const allowed = permissionState();
  if (allowed !== "on") {
    set(allowed);
    return allowed;
  }
  try {
    const reg = await registration();
    if (!reg) {
      set("unsupported");
      return "unsupported";
    }
    const config = await api.call("GET /api/v1/notifications/push/config");
    if (!config.enabled || !config.public_key || !config.key_id) {
      set("unavailable");
      return "unavailable";
    }
    let sub = await reg.pushManager.getSubscription();
    const held = await readDevice();
    if (sub && held && held.keyId !== config.key_id) {
      await sub.unsubscribe().catch(() => undefined);
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.public_key) });
    await save(sub, config.public_key, config.key_id);
    set("on");
    return "on";
  } catch {
    // Offline, or the push service refused for now: the next start tries again.
    set(permissionState() === "on" ? "off" : permissionState());
    return state;
  }
}

/** Turn On, from a press: asks the browser when it has not been asked, then subscribes and saves. */
export async function enablePush(): Promise<PushState> {
  rememberOff(false);
  if (!supported()) return syncPush();
  if (Notification.permission === "default") {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") {
      set(answer === "denied" ? "blocked" : "ask");
      return state;
    }
  }
  return syncPush();
}

/** Turn On, from wherever it is pressed: the push is turned on and the person is told what became of it. */
export async function turnOnPush(): Promise<PushState> {
  const s = await enablePush();
  if (s === "on") toast("Notifications are on");
  else if (s === "blocked") toast.error("Notifications are blocked here");
  else if (s === "needs-install") toast.info("Install the app first");
  else if (s === "ask") toast.info("Notifications not turned on");
  else toast.error("Not available on this device");
  return s;
}

/** Turn Off on this device: the server stops sending here, and the next start does not subscribe again. */
export async function disablePush(): Promise<void> {
  rememberOff(true);
  const held = await readDevice();
  if (held) await api.call("POST /api/v1/notifications/push/devices/:id/remove", { params: { id: held.id }, body: {} }).catch(() => undefined);
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => undefined);
  await clearDevice();
  set("off");
}

/** Send Test: to this device. */
export async function sendTestPush(): Promise<number> {
  const held = await readDevice();
  const out = await api.call("POST /api/v1/notifications/push/test", { body: held ? { push_subscription_id: held.id } : {} });
  return out.devices;
}

/** Send Test, from wherever it is pressed: the server's reason when it cannot send. */
export async function testPush(): Promise<void> {
  try {
    await sendTestPush();
    toast("Test sent");
  } catch (e) {
    toast.error(e instanceof ApiError && e.status !== 0 ? e.message : "Could not send the test");
  }
}

/** This device's id on the server, to tell it apart from the person's other devices. */
export async function thisDeviceId(): Promise<string | null> {
  return (await readDevice())?.id ?? null;
}

/** Tests only. */
export function resetPushForTest(next: PushState = "checking"): void {
  state = next;
  listeners.forEach((l) => l());
}
