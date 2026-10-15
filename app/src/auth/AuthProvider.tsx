import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, refreshSession, session } from "@/api/client";
import type { Me } from "@/api/types/identity";
import { toast } from "@mycity/ui";

/**
 * Who is signed in. The access token lives in memory only (api/client.ts);
 * on load the refresh cookie restores the session without asking for the
 * password again. There is no login without an employee: `me` always carries one.
 */
type Status = "loading" | "signed-out" | "signed-in";

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

  useEffect(() => {
    let live = true;
    session.onEnded(() => {
      setMe(null);
      setStatus("signed-out");
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

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await api.call("POST /api/v1/auth/login", { body: { email, password } });
    session.setToken(s.access_token);
    setMe(s.user);
    setJust(true);
    setStatus("signed-in");
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

/** The signed-in user. Only inside the shell, where there always is one. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("useMe with no signed-in user");
  return me;
}
