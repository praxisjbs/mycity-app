import { useEffect, useState } from "react";
import type { ApiError } from "@/api/client";
import { Banner, Button, Form, LockScreen, LoginField } from "@mycity/ui";
import { useAuth, type LockReason } from "./AuthProvider";
import { vPass } from "./Login";

const TITLE: Record<LockReason, string> = { time: "Session Ended", idle: "Session Locked", ended: "Signed Out" };
const WHY: Record<LockReason, string> = {
  time: "Your session reached its time limit",
  idle: "Locked while you were away",
  ended: "This session was ended",
};

/**
 * The lock (docs/guides/identity.md §10): the session ended mid-work, so the
 * screen is covered and the work underneath stays as it was, half-filled form
 * and all. The person's password carries on; Sign Out leaves for the sign-in
 * screen, for when this is not them.
 */
export function LockSheet() {
  const { status, me, lockReason, signIn, signOut } = useAuth();
  const [pass, setPass] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [buzz, setBuzz] = useState(0);
  const open = status === "locked" && !!me;
  useEffect(() => {
    if (!open) {
      setPass("");
      setTouched(false);
      setProblem(null);
    }
  }, [open]);
  if (!me) return null;
  const err = vPass(pass);
  const reason = lockReason ?? "ended";

  const submit = async () => {
    setTouched(true);
    if (err) {
      setBuzz((n) => n + 1);
      document.getElementById("unlock-pass")?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await signIn(me.email, pass);
    } catch (e) {
      setPass("");
      setProblem((e as ApiError).message);
      document.getElementById("unlock-pass")?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <LockScreen
      open={open}
      name={me.display_name}
      email={me.email}
      photo={me.photo_url}
      title={TITLE[reason]}
      reason={WHY[reason]}
      footer={
        <>
          <Button variant="ghost" icon="logout" onClick={() => void signOut()}>
            Sign Out
          </Button>
          <Button variant="primary" type="submit" form="unlock" icon="lock" busy={busy}>
            Unlock
          </Button>
        </>
      }
    >
      <Form id="unlock" onSubmit={() => void submit()}>
        <LoginField id="unlock-pass" label="Password" type="password" autoComplete="current-password" value={pass} onChange={(v) => (setPass(v), setProblem(null))} onBlur={() => setTouched(true)} error={touched ? err : ""} good={!err} buzz={touched && err ? buzz : 0} />
        {problem && (
          <Banner tone="err" icon="lock" className="mt-3 mb-0">
            {problem}
          </Banner>
        )}
      </Form>
    </LockScreen>
  );
}
