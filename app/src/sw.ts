/// <reference lib="webworker" />
/**
 * The staff app's service worker (FRONTEND_GUIDE §9.7; docs/guides/notifications.md §3, §6).
 *
 *   offline  the shell and its files precached; a navigation is answered with index.html,
 *            never /api/ or /gallery; /api/ always goes to the network, so nothing personal
 *            is cached and every number is live
 *   update   a new version waits until the page asks it to take over (SKIP_WAITING, the
 *            Reload notice in shell/pwa.ts)
 *   push     a notice for this browser's person. When the app is on screen here and says it
 *            showed the banner, nothing more; otherwise a notification: one per conversation
 *            (tag), alerting again for mail and direct messages, updating quietly for channel
 *            posts, with Mark Read, the sender's initials, the MyCity pin in the status bar and
 *            the unread count on the app icon where the platform has one. Safari and every
 *            iPhone or iPad always show it: WebKit stops a subscription whose pushes show
 *            nothing. A test always shows
 *   click    opens the record: a window of the app is focused and sent there, else a window is
 *            opened on it. Sign-in keeps the address, so a tap after the session has ended
 *            lands on the record once signed in; `n` marks the notices read
 *   renew    pushsubscriptionchange: subscribes again and tells the server with the device
 *            token the page kept (features/notifications/device-store.ts)
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import type { PushPayload } from "@mycity/contract/contract.gen.ts";
import tokens from "@mycity/ui/styles/tokens.css?raw";
import { readDevice } from "./features/notifications/device-store";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

/* ───── offline and update ───── */

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//, /^\/gallery(\/|$)/] }));

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") void self.skipWaiting();
});

/* ───── what the page and the worker say to each other ───── */

/** What the worker asks a page; the page answers `{ ok: true }` on the port when it did it. */
export type WorkerMessage = { type: "mycity:push"; payload: PushPayload } | { type: "mycity:open"; url: string };

/** What a shown notification keeps, to group the next one and to open or mark it. */
interface NoticeData {
  ids: string[];
  path: string | null;
  tag: string;
  mode: PushPayload["mode"];
  count: number;
}

type ShowOptions = NotificationOptions & {
  actions?: Array<{ action: string; title: string }>;
  renotify?: boolean;
  timestamp?: number;
};

const UA = self.navigator.userAgent;
/** Safari and every iPhone or iPad: a push must always show a notification. */
const WEBKIT = /AppleWebKit/.test(UA) && !/Chrome|Chromium|CriOS|Edg|OPR|SamsungBrowser|Firefox|FxiOS/.test(UA);
const ASK_MS = 1500;

/** Posts to one page and waits for its answer; no answer in time is a no. */
function ask(client: Client, message: WorkerMessage): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), ASK_MS);
    channel.port1.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      resolve(Boolean(e.data && e.data.ok));
    };
    try {
      client.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

async function pages(): Promise<WindowClient[]> {
  return (await self.clients.matchAll({ type: "window", includeUncontrolled: true })) as WindowClient[];
}

/* ───── the notification ───── */

/** A brand colour, read from the one file that holds colours. */
const colour = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)?.[1]?.trim();
const DEEP = colour("deep");
const PRIMARY = colour("primary");

function initialsOf(title: string): string {
  if (title.startsWith("#")) return "#";
  const words = title.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const first = words[0] ?? "";
  const letters = words.length > 1 ? `${first.charAt(0)}${words[words.length - 1].charAt(0)}` : first.slice(0, 2);
  return letters.toUpperCase();
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The sender's initials, or # for a channel, on Deep Green: a conversation's picture. */
async function avatarOf(p: PushPayload): Promise<string | undefined> {
  const person = p.tag.startsWith("mail_thread:") || p.tag.startsWith("community_channel:");
  if (!person || !DEEP || !PRIMARY || typeof OffscreenCanvas === "undefined") return undefined;
  const text = initialsOf(p.title);
  if (!text) return undefined;
  try {
    const size = 192;
    const canvas = new OffscreenCanvas(size, size);
    const g = canvas.getContext("2d");
    if (!g) return undefined;
    g.fillStyle = DEEP;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PRIMARY;
    g.font = `600 ${text.length > 1 ? 76 : 92}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, size / 2, size / 2 + 4);
    return await dataUrl(await canvas.convertToBlob({ type: "image/png" }));
  } catch {
    return undefined;
  }
}

async function setBadge(unread: number): Promise<void> {
  const nav = self.navigator as WorkerNavigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (unread > 0) await nav.setAppBadge?.(unread);
    else await nav.clearAppBadge?.();
  } catch {
    /* no badge on this platform */
  }
}

async function show(p: PushPayload): Promise<void> {
  const shown = (await self.registration.getNotifications({ tag: p.tag }))[0];
  const before = shown?.data as NoticeData | undefined;
  const grouped = p.mode !== "single" && before?.mode === p.mode;
  const count = grouped && before ? before.count + 1 : 1;
  const ids = [...(grouped && before ? before.ids : []), ...(p.id ? [p.id] : [])].slice(-25);
  const title = count > 1 ? `${p.title} · ${count} new${p.mode === "quiet" ? " posts" : ""}` : p.title;
  const data: NoticeData = { ids, path: p.path, tag: p.tag, mode: p.mode, count };
  const options: ShowOptions = {
    body: p.body,
    tag: p.tag,
    renotify: p.mode === "alert" && Boolean(shown),
    silent: p.mode === "quiet" && Boolean(shown),
    icon: (await avatarOf(p)) ?? "/pwa-192.png",
    badge: "/badge-96.png",
    timestamp: Date.parse(p.ts) || Date.now(),
    lang: "en-NG",
    dir: "ltr",
    data,
    actions: ids.length ? [{ action: "read", title: "Mark Read" }] : [],
  };
  await self.registration.showNotification(title, options);
}

function parse(event: PushEvent): PushPayload | null {
  try {
    const p = event.data?.json() as PushPayload | undefined;
    return p && p.v === 1 && typeof p.title === "string" && typeof p.tag === "string" ? p : null;
  } catch {
    return null;
  }
}

async function onPush(event: PushEvent): Promise<void> {
  const p = parse(event);
  if (!p) {
    await self.registration.showNotification("MyCity", { body: "You have a new notification.", tag: "unknown", badge: "/badge-96.png", icon: "/pwa-192.png" });
    return;
  }
  await setBadge(p.unread);
  if (!p.test && !WEBKIT) {
    const visible = (await pages()).filter((c) => c.visibilityState === "visible");
    const answers = await Promise.all(visible.map((c) => ask(c, { type: "mycity:push", payload: p })));
    if (answers.some(Boolean)) return;
  }
  await show(p);
}

self.addEventListener("push", (event) => event.waitUntil(onPush(event)));

/* ───── a tap, and Mark Read ───── */

function urlFor(d: Partial<NoticeData>): string {
  const ids = (d.ids ?? []).join(",");
  const base = d.path || "/";
  const params = [d.path ? null : "pane=notifications", ids ? `n=${ids}` : null].filter(Boolean).join("&");
  return params ? `${base}${base.includes("?") ? "&" : "?"}${params}` : base;
}

async function openApp(url: string): Promise<void> {
  const windows = await pages();
  const target = windows.find((w) => w.focused) ?? windows.find((w) => w.visibilityState === "visible") ?? windows[0];
  if (target) {
    try {
      await target.focus();
    } catch {
      /* focus can be refused; the page is still told */
    }
    if (await ask(target, { type: "mycity:open", url })) return;
    try {
      await target.navigate(url);
      return;
    } catch {
      /* a page this worker does not control cannot be sent anywhere */
    }
  }
  await self.clients.openWindow(url);
}

async function markRead(ids: string[]): Promise<void> {
  const device = await readDevice();
  if (!device || ids.length === 0) return;
  try {
    await fetch("/api/v1/notifications/push/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ push_subscription_id: device.id, device_token: device.token, notification_ids: ids }),
    });
  } catch {
    /* offline: it stays unread in the bell */
  }
}

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const d = (n.data ?? {}) as Partial<NoticeData>;
  n.close();
  event.waitUntil(event.action === "read" ? markRead(d.ids ?? []) : openApp(urlFor(d)));
});

/* ───── the browser replaced the subscription ───── */

interface SubscriptionChangeEvent extends ExtendableEvent {
  readonly newSubscription: PushSubscription | null;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function renew(event: SubscriptionChangeEvent): Promise<void> {
  const device = await readDevice();
  if (!device) return;
  try {
    const sub =
      event.newSubscription ?? (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(device.key) }));
    const j = sub.toJSON();
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return;
    await fetch("/api/v1/notifications/push/renew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        push_subscription_id: device.id,
        device_token: device.token,
        endpoint: j.endpoint,
        p256dh: j.keys.p256dh,
        auth: j.keys.auth,
        expires_at: sub.expirationTime ? new Date(sub.expirationTime).toISOString() : null,
      }),
    });
  } catch {
    /* the page subscribes again on its next start */
  }
}

self.addEventListener("pushsubscriptionchange", (event) => (event as SubscriptionChangeEvent).waitUntil(renew(event as SubscriptionChangeEvent)));
