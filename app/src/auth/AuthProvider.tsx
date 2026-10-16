import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, refreshSession, session } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { connectRealtime, disconnectRealtime } from "@/api/realtime";
import type { Me } from "@/api/types/identity";
import { hrefFor } from "@/lib/routes";
import { toast } from "@mycity/ui";

/**
 * Who is signed in (FRONTEND_GUIDE §9.5). The access token lives in memory only
 * (api/client.ts); on load the refresh cookie restores the session without
 * asking for the password again. There is no login without an employee: `me`
 * always carries one.
 *
 *   loading     the refresh cookie is being tried
 *   signed-out  the sign-in screen
 *   signed-in   the shell
 *   expired     the session ended mid-work (the refresh cookie was refused on a
 *               401): the shell stays, with the person's screen and any
 *               half-filled form, and a sign-in sheet opens over it
 *               (SignInSheet; PR 2 question 2). Signing in again as the same
 *               person carries on and reloads what failed; another account
 *               reloads the app at Home.
 *
 * Realtime (api/realtime.ts) connects while signed in and closes otherwise.
 */
type Status = "loading" | "signed-out" | "signed-in" | "expired";

interface AuthValue {
  status: Status;
  me: Me | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Can the user perform `action` on `module`? Hiding is a courtesy; the API enforces. */
  can: (module: string, action?: string) => boolean;
  justSignedIn: boolean;
  clearJustSignedIn: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [justSignedIn, setJust] = useState(false);
  const current = useRef<{ status: Status; me: Me | null }>({ status, me });
  useEffect(() => {
    current.current = { status, me };
  }, [status, me]);

  useEffect(() => {
    let live = true;
    session.onEnded(() => {
      disconnectRealtime();
      // Mid-work, the person and their screen stay; the sign-in sheet opens over them.
      if (current.current.status === "signed-in" && current.current.me) setStatus("expired");
      else {
        setMe(null);
        setStatus("signed-out");
      }
    });
    (async () => {
      const ok = await refreshSession();
      if (!live) return;
      if (!ok) return setStatus("signed-out");
      try {
        const user = await api.call("GET /api/v1/auth/me");
        if (live) {
          setMe(user);
          setStatus("signed-in");
        }
      } catch {
        if (live) setStatus("signed-out");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (status === "signed-in") void connectRealtime();
    else disconnectRealtime();
  }, [status]);

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await api.call("POST /api/v1/auth/login", { body: { email, password } });
    const before = current.current;
    if (before.status === "expired" && before.me && before.me.user_id !== s.user.user_id) {
      // Another account: start again at Home, on the new session's refresh cookie.
      window.location.assign(hrefFor("home"));
      return;
    }
    session.setToken(s.access_token);
    setMe(s.user);
    setStatus("signed-in");
    if (before.status === "expired") {
      invalidate("/api/");
      toast("Signed in again");
      return;
    }
    setJust(true);
    setTimeout(() => toast(`Signed in as ${s.user.display_name}`), 260);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.call("POST /api/v1/auth/logout", { body: {} });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    session.setToken(null);
    setMe(null);
    setStatus("signed-out");
  }, []);

  const can = useCallback((module: string, action = "view") => !!me?.grants[module]?.includes(action), [me]);

  const value = useMemo(
    () => ({ status, me, signIn, signOut, can, justSignedIn, clearJustSignedIn: () => setJust(false) }),
    [status, me, signIn, signOut, can, justSignedIn],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

/** The signed-in user. Only inside the shell, where there always is one (also while the session sheet is open). */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("useMe with no signed-in user");
  return me;
}
