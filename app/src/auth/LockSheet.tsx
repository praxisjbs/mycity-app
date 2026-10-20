import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Banner, Button, Field, Form, LockScreen, LoginField, OtpField } from "@mycity/ui";
import { useAuth, useMyPhoto, type LockReason } from "./AuthProvider";
import { vCode, vPass, vPin, vRecovery } from "./Login";
import { passkeyProblem, passkeysWork } from "./passkey";

const TITLE: Record<LockReason, string> = { time: "Session Ended", idle: "Session Locked", ended: "Signed Out" };
const WHY: Record<LockReason, string> = {
  time: "Your session reached its time limit",
  idle: "Locked while you were away",
  ended: "This session was ended",
};

type Way = "pin" | "password";
type Step = { kind: "first" } | { kind: "code"; ticket: string; recovery: boolean };

/**
 * The lock (docs/guides/identity.md §10): the session ended mid-work, so the
 * screen is covered and the work underneath stays as it was, half-filled form
 * and all. The person carries on with their PIN when they have set one (four
 * digits go on their own), their passkey (the fingerprint or face on a phone), or
 * their password; two-step sign-in may then ask for the code. Sign Out leaves for
 * the sign-in screen, for when this is not them.
 */
export function LockSheet() {
  const { status, me, lockReason, signIn, signInWithPin, finishTwoStep, signInWithPasskey, signOut } = useAuth();
  const photo = useMyPhoto();
  const open = status === "locked" && !!me;
  const device = useApi("GET /api/v1/auth/device", { enabled: open });
  const known = device.data?.account && me && device.data.account.email === me.email ? device.data.account : null;
  const [way, setWay] = useState<Way | null>(null);
  const [step, setStep] = useState<Step>({ kind: "first" });
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [buzz, setBuzz] = useState(0);

  useEffect(() => {
    if (!open) {
      setWay(null);
      setStep({ kind: "first" });
      setValue("");
      setTouched(false);
      setProblem(null);
    }
  }, [open]);

  // The PIN first when there is one; the person can always switch to the password.
  const using: Way = way ?? (known?.has_pin ? "pin" : "password");
  const fieldId = step.kind === "code" ? (step.recovery ? "unlock-recovery" : "unlock-code") : using === "pin" ? "unlock-pin" : "unlock-pass";
  // Whichever field is showing has the focus, also after switching between them.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => document.getElementById(fieldId)?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, fieldId]);
  if (!me) return null;

  const withPasskey = !!known?.has_passkey && passkeysWork();
  const reason = lockReason ?? "ended";
  const err = step.kind === "code" ? (step.recovery ? vRecovery(value) : vCode(value)) : using === "pin" ? vPin(value) : vPass(value);
  const focus = () => document.getElementById(fieldId)?.focus();
  // An empty field is marked when Unlock is pressed, not when the person taps away to switch.
  const leave = () => value && setTouched(true);

  const reset = (next: Partial<{ way: Way; step: Step }>) => {
    if (next.way) setWay(next.way);
    if (next.step) setStep(next.step);
    setValue("");
    setTouched(false);
    setProblem(null);
  };

  const submit = async (typed = value) => {
    setTouched(true);
    const bad = step.kind === "code" ? (step.recovery ? vRecovery(typed) : vCode(typed)) : using === "pin" ? vPin(typed) : vPass(typed);
    if (bad) {
      setBuzz((n) => n + 1);
      focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (step.kind === "code") await finishTwoStep(step.ticket, typed);
      else {
        const next = using === "pin" ? await signInWithPin(me.email, typed) : await signIn(me.email, typed);
        // Setting two-step up needs the whole sign-in card, so the lock screen sends the person there.
        if (next?.kind === "setup") {
          setValue("");
          setTouched(false);
          setProblem("Your role now needs two-step sign-in. Sign out, then sign in to set it up.");
        } else if (next) reset({ step: { kind: "code", ticket: next.ticket, recovery: false } });
      }
    } catch (e) {
      const a = e as ApiError;
      setValue("");
      setTouched(false);
      if (step.kind === "first" && using === "pin" && (a.code === "PIN_SWITCHED_OFF" || a.code === "PIN_UNAVAILABLE")) {
        setWay("password");
        void device.reload();
      }
      setProblem(a.message);
      focus();
    } finally {
      setBusy(false);
    }
  };

  const passkey = async () => {
    setKeyBusy(true);
    setProblem(null);
    try {
      await signInWithPasskey(me.email);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : passkeyProblem(e));
    } finally {
      setKeyBusy(false);
    }
  };

  const mark = touched && err ? "bad" : undefined;
  // Everything on the card sits on one centred axis: the label and the boxes centre with it.
  const field =
    step.kind === "code" ? (
      step.recovery ? (
        <div className="[&_label]:text-center">
          <LoginField id="unlock-recovery" label="Recovery Code" type="text" autoComplete="off" value={value} onChange={(v) => (setValue(v), setProblem(null))} onBlur={leave} error={touched ? err : ""} good={!err} buzz={touched && err ? buzz : 0} />
        </div>
      ) : (
        <Field label="Sign-In Code" htmlFor="unlock-code" state={mark} message={err} className="mt-5 [&>*]:justify-center">
          <OtpField id="unlock-code" label="Sign-In Code" value={value} onChange={(v) => (setValue(v), setProblem(null))} onComplete={(v) => void submit(v)} />
        </Field>
      )
    ) : using === "pin" ? (
      <Field label="PIN" htmlFor="unlock-pin" state={mark} message={err} className="mt-5 [&>*]:justify-center">
        <OtpField id="unlock-pin" label="PIN" length={4} secret value={value} onChange={(v) => (setValue(v), setProblem(null))} onComplete={(v) => void submit(v)} />
      </Field>
    ) : (
      <div className="[&_label]:text-center">
        <LoginField id="unlock-pass" label="Password" type="password" autoComplete="current-password" value={value} onChange={(v) => (setValue(v), setProblem(null))} onBlur={leave} error={touched ? err : ""} good={!err} buzz={touched && err ? buzz : 0} />
      </div>
    );

  return (
    <LockScreen
      open={open}
      name={me.display_name}
      email={me.email}
      photo={photo}
      title={step.kind === "code" ? "Enter Code" : TITLE[reason]}
      reason={step.kind === "code" ? "From your authenticator app" : WHY[reason]}
      footer={
        <>
          <Button variant="primary" type="submit" form="unlock" icon="lock" busy={busy}>
            Unlock
          </Button>
          {step.kind === "code" ? (
            <Button variant="ghost" onClick={() => reset({ step: { ...step, recovery: !step.recovery } })}>
              {step.recovery ? "Use App Code" : "Use Recovery Code"}
            </Button>
          ) : (
            <>
              {withPasskey && (
                <Button icon="fingerprint" busy={keyBusy} onClick={() => passkey()}>
                  Use Passkey
                </Button>
              )}
              {known?.has_pin && (
                <Button variant="ghost" icon={using === "pin" ? "lock" : "key"} onClick={() => reset({ way: using === "pin" ? "password" : "pin" })}>
                  {using === "pin" ? "Use Password" : "Use PIN"}
                </Button>
              )}
            </>
          )}
          {/* The exit is a different kind of action from getting back in: a hairline sets the red Sign Out apart. */}
          <div role="separator" className="my-1 h-px w-full bg-border" />
          <Button variant="danger" icon="logout" onClick={() => signOut()}>
            Sign Out
          </Button>
        </>
      }
    >
      <Form id="unlock" onSubmit={() => submit()}>
        {field}
        {problem && (
          <Banner tone="err" icon="lock" className="mt-3 mb-0">
            {problem}
          </Banner>
        )}
      </Form>
    </LockScreen>
  );
}
