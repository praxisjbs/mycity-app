import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, refreshSession, session } from "@/api/client";
import { clearPhotos, useFileUrl } from "@/api/download";
import { invalidate } from "@/api/hooks";
import { connectRealtime, disconnectRealtime } from "@/api/realtime";
import type { Me, Session } from "@/api/types/identity";
import type { SignInResult } from "@mycity/contract/contract.gen.ts";
import { hrefFor } from "@/lib/routes";
import { forgetTrail } from "@/lib/trail";
import { toast } from "@mycity/ui";
import { passkeyCancelled, signWithPasskey } from "./passkey";

/**
 * Who is signed in, and the session's clock (FRONTEND_GUIDE §9.5,
 * docs/guides/identity.md §3). The access token lives in memory only
 * (api/client.ts); on load the refresh cookie restores the session without
 * asking for the password again. There is no login without an employee: `me`
 * always carries one.
 *
 *   loading     the refresh cookie is being tried
 *   signed-out  the sign-in screen
 *   signed-in   the shell
 *   locked      the session ended mid-work: the shell stays, with the person's
 *               screen and any half-filled form, and the lock screen covers it
 *               (LockSheet). Their password, PIN or passkey carries on and
 *               reloads what failed; Sign Out leaves.
 *
 * Every way in ends in the same place (`begin`): the password, the PIN on a
 * browser the person has used before, the code after either when two-step sign-in
 * asks for one, and a passkey, which is both steps at once. The password and the
 * PIN resolve to the next step's ticket when a code is still needed, or when the
 * person's role requires two-step and they have not set it up; the screen asks for
 * the code (finishTwoStep) or walks them through setting it up (finishSetup).
 *
 * The session locks, in every open tab at once:
 *   time   at its two-hour ceiling (session_expires_in from the server);
 *   idle   after the idle limit with no key, tap or pointer in any tab of the
 *          app; the session is ended on the server too, so nothing left open
 *          on the desk keeps it alive;
 *   ended  when the server refuses the refresh cookie (signed out elsewhere,
 *          the password changed, an administrator ended it).
 *
 * While the person is active the access token is renewed shortly before it
 * expires, so a long form never meets a refused save. Background calls alone
 * (the bell, the badges) do not count as activity.
 *
 * Tabs share sign-in, sign-out, locks and activity through a BroadcastChannel;
 * the refresh itself is taken one tab at a time (createApi).
 *
 * Realtime (api/realtime.ts) connects while signed in and closes otherwise.
 */
type Status = "loading" | "signed-out" | "signed-in" | "locked";
export type LockReason = "time" | "idle" | "ended";

interface AuthValue {
  status: Status;
  me: Me | null;
  /** Why the screen is locked, while it is. */
  lockReason: LockReason | null;
  /**
   * The password. Resolves to the next step and its ticket when two-step asks for a
   * code, or a role requires setting it up; to null once signed in.
   */
  signIn: (email: string, password: string) => Promise<NextStep | null>;
  /** The PIN, on a browser this person has signed in on before; resolves like signIn. */
  signInWithPin: (email: string, pin: string) => Promise<NextStep | null>;
  /** The code after the password or the PIN: the authenticator app's six digits, or a recovery code. */
  finishTwoStep: (ticket: string, code: string) => Promise<void>;
  /**
   * The set-up step's first code turns two-step on. Resolves to the recovery codes,
   * shown once, and `start`, which opens the session once the person has kept them.
   */
  finishSetup: (ticket: string, code: string) => Promise<{ recovery_codes: string[]; start: () => void }>;
  /** A passkey: the fingerprint, face or screen lock. With an email (the lock screen), only that person's. False when the prompt was closed. */
  signInWithPasskey: (email?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Can the user perform `action` on `module`? Hiding is a courtesy; the API enforces. */
  can: (module: string, action?: string) => boolean;
  /** Read the signed-in person again: after My Profile changes their photo, so the shell shows it. */
  refreshMe: () => Promise<void>;
}

/** What follows a first step that did not sign in: the code, or setting two-step up. */
export interface NextStep {
  kind: "code" | "setup";
  ticket: string;
}

/** What the server says about the session's time (contract identity.js sessionClock). */
interface ClockBody {
  expires_in?: number;
  session_expires_in?: number;
  session_idle_limit?: number;
}

type Message = { t: "active"; at: number } | { t: "locked"; reason: LockReason } | { t: "signed-in"; user_id: string } | { t: "signed-out" };

const CHANNEL = "mycity-session";
/** How often the clock is checked; also on returning to the tab. */
const TICK_MS = 15_000;
/** Renew the access token this long before it expires, if the person has been active since the last renewal. */
const RENEW_BEFORE_MS = 60_000;
/** Activity is noted at most this often, and told to other tabs at most every ACTIVE_POST_MS. */
const ACTIVE_NOTE_MS = 5_000;
const ACTIVE_POST_MS = 30_000;
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export const reasonOf = (code: string): LockReason => (code === "SESSION_TIME_LIMIT" ? "time" : code === "SESSION_IDLE" ? "idle" : "ended");

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [lockReason, setLockReason] = useState<LockReason | null>(null);
  const current = useRef<{ status: Status; me: Me | null }>({ status, me });
  useEffect(() => {
    current.current = { status, me };
  }, [status, me]);

  const clock = useRef({ accessUntil: 0, sessionUntil: Number.POSITIVE_INFINITY, idleMs: 30 * 60_000, renewedAt: 0 });
  const lastActive = useRef(Date.now());
  const channel = useRef<BroadcastChannel | null>(null);
  const tell = useCallback((m: Message) => {
    try {
      channel.current?.postMessage(m);
    } catch {
      /* a closed channel: this tab is going away */
    }
  }, []);

  const applyClock = useCallback((body: unknown) => {
    const c = (body ?? {}) as ClockBody;
    const now = Date.now();
    if (typeof c.expires_in === "number") clock.current.accessUntil = now + c.expires_in * 1000;
    if (typeof c.session_expires_in === "number") clock.current.sessionUntil = now + c.session_expires_in * 1000;
    if (typeof c.session_idle_limit === "number") clock.current.idleMs = c.session_idle_limit * 1000;
    clock.current.renewedAt = now;
  }, []);

  /** Lock this tab. `endOnServer` for the idle lock; `announce` false when another tab already said so. */
  const lock = useCallback(
    (reason: LockReason, { endOnServer = false, announce = true } = {}) => {
      const cur = current.current;
      if (cur.status !== "signed-in" || !cur.me) return;
      if (endOnServer) void api.call("POST /api/v1/auth/logout", { body: { reason: "idle" } }).catch(() => undefined);
      session.setToken(null);
      current.current = { ...cur, status: "locked" };
      setLockReason(reason);
      setStatus("locked");
      if (announce) tell({ t: "locked", reason });
    },
    [tell],
  );

  const signedOut = useCallback(() => {
    session.setToken(null);
    clearPhotos();
    clock.current.sessionUntil = Number.POSITIVE_INFINITY;
    setMe(null);
    setLockReason(null);
    setStatus("signed-out");
  }, []);

  /** Another tab signed in: pick the session up from the shared cookie. */
  const adopt = useCallback(async (userId: string) => {
    const cur = current.current;
    if (cur.status === "signed-in" && cur.me?.user_id === userId) return;
    if (cur.me && cur.me.user_id !== userId) {
      window.location.assign(hrefFor("home"));
      return;
    }
    if (!(await refreshSession())) return;
    try {
      const user = await api.call("GET /api/v1/auth/me");
      lastActive.current = Date.now();
      setMe(user);
      setLockReason(null);
      setStatus("signed-in");
      if (cur.status === "locked") invalidate("/api/");
    } catch {
      /* the next call will say what is wrong */
    }
  }, []);

  useEffect(() => {
    let live = true;
    session.onRefreshed(applyClock);
    session.onEnded((code) => {
      if (current.current.status === "signed-in" && current.current.me) lock(reasonOf(code));
      else if (current.current.status !== "locked") signedOut();
    });
    channel.current = openChannel();
    if (channel.current) {
      channel.current.onmessage = (e: MessageEvent<Message>) => {
        const m = e.data;
        if (m.t === "active") lastActive.current = Math.max(lastActive.current, m.at);
        else if (m.t === "locked") lock(m.reason, { announce: false });
        else if (m.t === "signed-out") {
          if (current.current.status !== "signed-out") signedOut();
        } else if (m.t === "signed-in") void adopt(m.user_id);
      };
    }
    (async () => {
      const ok = await refreshSession();
      if (!live) return;
      if (!ok) return setStatus("signed-out");
      try {
        const user = await api.call("GET /api/v1/auth/me");
        if (live) {
          lastActive.current = Date.now();
          setMe(user);
          setStatus("signed-in");
        }
      } catch {
        if (live) setStatus("signed-out");
      }
    })();
    return () => {
      live = false;
      channel.current?.close();
      channel.current = null;
    };
  }, [applyClock, lock, signedOut, adopt]);

  useEffect(() => {
    if (status === "signed-in") void connectRealtime();
    else disconnectRealtime();
  }, [status]);

  // Activity: a key, a tap, the pointer. Noted here and told to the other tabs.
  useEffect(() => {
    if (status !== "signed-in") return;
    let posted = 0;
    const note = () => {
      const now = Date.now();
      if (now - lastActive.current < ACTIVE_NOTE_MS) return;
      lastActive.current = now;
      if (now - posted >= ACTIVE_POST_MS) {
        posted = now;
        tell({ t: "active", at: now });
      }
    };
    for (const e of ACTIVITY) window.addEventListener(e, note, { passive: true, capture: true });
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, note, { capture: true });
    };
  }, [status, tell]);

  // The clock: the ceiling, the idle limit, and renewing the access token while active.
  useEffect(() => {
    if (status !== "signed-in") return;
    let renewing = false;
    const check = async () => {
      const now = Date.now();
      const c = clock.current;
      if (now >= c.sessionUntil) return lock("time");
      if (now - lastActive.current >= c.idleMs) return lock("idle", { endOnServer: true });
      if (!renewing && c.accessUntil - now <= RENEW_BEFORE_MS && lastActive.current > c.renewedAt) {
        renewing = true;
        const ok = await refreshSession();
        renewing = false;
        if (!ok && session.endCode !== "NETWORK") lock(reasonOf(session.endCode));
      }
    };
    const tick = setInterval(() => void check(), TICK_MS);
    const left = clock.current.sessionUntil - Date.now();
    const atEnd = Number.isFinite(left) ? setTimeout(() => lock("time"), Math.max(0, left)) : undefined;
    const back = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearInterval(tick);
      if (atEnd) clearTimeout(atEnd);
      document.removeEventListener("visibilitychange", back);
    };
  }, [status, lock]);

  /** A session from any way in: the shell opens, or the lock lifts. */
  const begin = useCallback(
    (s: Session) => {
      const before = current.current;
      if (before.status === "locked" && before.me && before.me.user_id !== s.user.user_id) {
        // Another account: start again at Home, on the new session's refresh cookie.
        window.location.assign(hrefFor("home"));
        return;
      }
      session.setToken(s.access_token);
      applyClock(s);
      lastActive.current = Date.now();
      setMe(s.user);
      setLockReason(null);
      setStatus("signed-in");
      tell({ t: "signed-in", user_id: s.user.user_id });
      if (before.status === "locked") {
        invalidate("/api/");
        toast("Welcome back");
        return;
      }
      setTimeout(() => toast(`Signed in as ${s.user.display_name}`), 260);
    },
    [applyClock, tell],
  );

  /** The first step's answer: the next step's ticket, or a session. */
  const stepped = useCallback(
    (r: SignInResult): NextStep | null => {
      if ("step" in r) return { kind: r.step, ticket: r.challenge_token };
      begin(r);
      return null;
    },
    [begin],
  );

  const signIn = useCallback(
    async (email: string, password: string) => stepped(await api.call("POST /api/v1/auth/login", { body: { email, password } })),
    [stepped],
  );

  const signInWithPin = useCallback(
    async (email: string, pin: string) => stepped(await api.call("POST /api/v1/auth/pin", { body: { email, pin } })),
    [stepped],
  );

  const finishTwoStep = useCallback(
    async (ticket: string, code: string) => begin(await api.call("POST /api/v1/auth/two-step", { body: { challenge_token: ticket, code } })),
    [begin],
  );

  const finishSetup = useCallback(
    async (ticket: string, code: string) => {
      const r = await api.call("POST /api/v1/auth/two-step/enrol", { body: { challenge_token: ticket, code } });
      const { recovery_codes, ...signedIn } = r;
      return { recovery_codes, start: () => begin(signedIn) };
    },
    [begin],
  );

  const signInWithPasskey = useCallback(
    async (email?: string) => {
      const start = await api.call("POST /api/v1/auth/passkey/options", { body: email ? { email } : {} });
      let credential: Record<string, unknown>;
      try {
        credential = await signWithPasskey(start.options);
      } catch (e) {
        if (passkeyCancelled(e)) return false;
        throw e;
      }
      begin(await api.call("POST /api/v1/auth/passkey", { body: { challenge_token: start.challenge_token, credential } }));
      return true;
    },
    [begin],
  );

  const signOut = useCallback(async () => {
    try {
      await api.call("POST /api/v1/auth/logout", { body: {} });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    signedOut();
    // This device's trail of places leaves with the person (F29), so the next one on it never sees it.
    forgetTrail();
    tell({ t: "signed-out" });
  }, [signedOut, tell]);

  const can = useCallback((module: string, action = "view") => !!me?.grants[module]?.includes(action), [me]);

  const refreshMe = useCallback(async () => {
    setMe(await api.call("GET /api/v1/auth/me"));
  }, []);

  const value = useMemo(
    () => ({
      status,
      me,
      lockReason,
      signIn,
      signInWithPin,
      finishTwoStep,
      finishSetup,
      signInWithPasskey,
      signOut,
      can,
      refreshMe,
    }),
    [status, me, lockReason, signIn, signInWithPin, finishTwoStep, finishSetup, signInWithPasskey, signOut, can, refreshMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/**
 * The signed-in person's photo, ready for an <img>: `photo_url` is an API path that needs the
 * session, so it is fetched once and handed over as an object URL. Null shows initials.
 */
export function useMyPhoto(): string | null {
  const { me } = useAuth();
  return useFileUrl(me?.photo_url ?? null);
}

/** The signed-in user. Only inside the shell, where there always is one (also while the lock screen is up). */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("useMe with no signed-in user");
  return me;
}
