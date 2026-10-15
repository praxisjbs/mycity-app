import { useState } from "react";
import type { ApiError } from "@/api/client";
import { Banner, Button, Form, LoginField, Modal } from "@mycity/ui";
import { useAuth } from "./AuthProvider";
import { vEmail, vPass } from "./Login";

/**
 * The session ended mid-work (PR 2 question 2): this sheet opens over the
 * screen, which stays as it was underneath, half-filled form and all. Signing
 * in again as the same person carries on; another account reloads at Home.
 * It cannot be dismissed (nothing works without a session); Sign Out leaves.
 */
export function SignInSheet() {
  const { status, me, signIn, signOut } = useAuth();
  const [email, setEmail] = useState(me?.email ?? "");
  const [pass, setPass] = useState("");
  const [touched, setTouched] = useState({ email: false, pass: false });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const eErr = vEmail(email);
  const pErr = vPass(pass);

  const submit = async () => {
    setTouched({ email: true, pass: true });
    if (eErr || pErr) {
      document.getElementById(eErr ? "again-email" : "again-pass")?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await signIn(email.trim(), pass);
      setPass("");
      setTouched({ email: false, pass: false });
    } catch (err) {
      setPass("");
      setProblem((err as ApiError).message);
      document.getElementById("again-pass")?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={status === "expired"}
      onClose={() => undefined}
      dismissible={false}
      size="sm"
      title="Session Ended"
      footer={
        <>
          <Button variant="ghost" icon="logout" onClick={() => void signOut()}>
            Sign Out
          </Button>
          <Button variant="primary" type="submit" form="sign-in-again" busy={busy}>
            Sign In
          </Button>
        </>
      }
    >
      <Form id="sign-in-again" onSubmit={() => void submit()}>
        <LoginField id="again-email" label="Work Email" type="email" autoComplete="username" value={email} onChange={(v) => (setEmail(v), setProblem(null))} onBlur={() => setTouched((t) => ({ ...t, email: true }))} error={touched.email ? eErr : ""} good={!eErr} buzz={0} />
        <LoginField id="again-pass" label="Password" type="password" autoComplete="current-password" value={pass} onChange={setPass} onBlur={() => setTouched((t) => ({ ...t, pass: true }))} error={touched.pass ? pErr : ""} good={!pErr} buzz={0} />
        {problem && (
          <Banner tone="err" icon="lock" className="mt-3 mb-0">
            {problem}
          </Banner>
        )}
      </Form>
    </Modal>
  );
}
