import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Socket } from "socket.io-client";
import { refreshSession, session } from "./client";

/**
 * Realtime for the staff app (FRONTEND_GUIDE §9.6): one Socket.io connection
 * to the API (src/realtime/socket.js) while a person is signed in, for the bell
 * and presence. Best effort, like the server: everything that changes state
 * reaches the screen by HTTP too, so a dropped socket only means the bell
 * refreshes when it is opened.
 *
 *   connect     with the access token from memory (handshake `auth.token`, read
 *               again on every reconnect); the server joins the socket to the
 *               person's own rooms, the client cannot choose any
 *   expiry      the server closes the socket when the access token expires; the
 *               client refreshes the session once and reconnects. A refused
 *               refresh leaves it closed (the session sheet takes over)
 *   events      `notification` (a new notification for this person) and
 *               `presence` ({ user_id, online }, sent with M1 chat)
 *   in front    while this tab is on screen and was touched in the last 5 minutes, the
 *               socket says `presence:active` every 30 seconds, and `presence:idle` when that
 *               stops: the server holds a push to the person's devices for a minute while
 *               they are looking at the app (docs/guides/notifications.md §6)
 *
 * The in-browser mock has no server: in mock mode nothing connects and the
 * hooks never fire. socket.io-client is loaded only when a live build connects.
 */
const LIVE = import.meta.env.VITE_API_MODE === "live";

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
let socket: Socket | null = null;
let wanted = false;

function dispatch(event: string, payload: unknown) {
  handlers.get(event)?.forEach((h) => h(payload));
}

/* ───── presence ───── */

const online = new Set<string>();
const presenceListeners = new Set<() => void>();
let presenceVersion = 0;
function notePresence(payload: unknown) {
  const p = payload as { user_id?: unknown; online?: unknown } | null;
  if (!p || typeof p.user_id !== "string") return;
  if (p.online === true) online.add(p.user_id);
  else online.delete(p.user_id);
  presenceVersion += 1;
  presenceListeners.forEach((l) => l());
}

/* ───── in front of the app ───── */

const BEAT_MS = 30_000;
const IDLE_AFTER_MS = 5 * 60_000;
const TOUCHES = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
let touchedAt = Date.now();
let saidActive = false;
let beat: ReturnType<typeof setInterval> | null = null;

const inFront = () => document.visibilityState === "visible" && Date.now() - touchedAt < IDLE_AFTER_MS;

function sayPresence() {
  if (!socket?.connected) return;
  const now = inFront();
  if (now) socket.emit("presence:active");
  else if (saidActive) socket.emit("presence:idle");
  saidActive = now;
}
const touched = () => {
  const was = inFront();
  touchedAt = Date.now();
  if (!was) sayPresence();
};

function startPresence() {
  if (beat) return;
  TOUCHES.forEach((t) => window.addEventListener(t, touched, { passive: true }));
  document.addEventListener("visibilitychange", sayPresence);
  beat = setInterval(sayPresence, BEAT_MS);
}

function stopPresence() {
  TOUCHES.forEach((t) => window.removeEventListener(t, touched));
  document.removeEventListener("visibilitychange", sayPresence);
  if (beat) clearInterval(beat);
  beat = null;
  saidActive = false;
}

/** Opens the connection (a live build only); the shell calls it once signed in. */
export async function connectRealtime(): Promise<void> {
  wanted = true;
  if (!LIVE || socket) return;
  const { io } = await import("socket.io-client");
  if (!wanted || socket) return;
  const s = io({
    path: "/socket.io",
    transports: ["websocket"],
    withCredentials: true,
    auth: (cb) => cb({ token: session.token ?? "" }),
  });
  socket = s;
  s.on("connect", sayPresence);
  startPresence();
  s.onAny((event: string, payload: unknown) => {
    if (event === "presence") notePresence(payload);
    dispatch(event, payload);
  });
  // The server closes the socket at token expiry (or refuses an expired one): refresh once, then reconnect.
  const renew = async () => {
    if (!wanted) return;
    if (await refreshSession()) s.connect();
  };
  s.on("disconnect", (reason) => {
    if (reason === "io server disconnect") void renew();
  });
  s.on("connect_error", (err: Error & { data?: { code?: string } }) => {
    if (err.data?.code === "TOKEN_EXPIRED" || err.data?.code === "AUTH_REQUIRED") void renew();
  });
}

/** Closes the connection: sign-out, or the session ended. */
export function disconnectRealtime(): void {
  wanted = false;
  stopPresence();
  socket?.disconnect();
  socket = null;
  online.clear();
}

/** Calls `handler` for each `event` while the component is mounted. */
export function useRealtime(event: string, handler: Handler): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    const h: Handler = (p) => ref.current(p);
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(h);
    return () => {
      handlers.get(event)?.delete(h);
    };
  }, [event]);
}

/** Is this person online, as far as the server has said? False until presence ships (M1 chat). */
export function usePresence(userId: string | null | undefined): boolean {
  useSyncExternalStore(
    (l) => (presenceListeners.add(l), () => presenceListeners.delete(l)),
    () => presenceVersion,
    () => 0,
  );
  return !!userId && online.has(userId);
}

/** Tests only: deliver an event as if the server had sent it. */
export function emitRealtimeForTest(event: string, payload: unknown): void {
  if (event === "presence") notePresence(payload);
  dispatch(event, payload);
}
