import { useCallback, useEffect, useRef, useState } from "react";
import type { Confirm } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Button, ChoiceField, Field, FormError, FormFooter, OtpField, PasswordField, useContractForm, useModal } from "@mycity/ui";
import { passkeyCancelled, passkeyProblem, passkeysWork, signWithPasskey } from "./passkey";

/** Seconds of the window left below which a form asks first, so the save at its end is not refused. */
const MARGIN_SECONDS = 60;

type Way = "password" | "pin" | "passkey";

const refusedForAge = (e: unknown) => e instanceof ApiError && e.code === "REAUTH_REQUIRED";

/** How the person confirmed it is them, for a caller that acts on it (a passkey offered to one who used the PIN). */
export type ConfirmedWay = Way;

/**
 * A fresh sign-in before adding or removing a way to sign in (docs/guides/identity.md
 * §6), and before a Praxis AI card of a sensitive class runs (docs/guides/praxis-ai.md §6.11,
 * decision 11). Within the window after signing in the change goes ahead; past it the API
 * answers 403 REAUTH_REQUIRED, and the person confirms it is them in the one modal before it
 * runs again: a passkey first when they have one, else the PIN, else the password.
 *
 *   const fresh = useFreshSignIn();
 *   await fresh.guard(() => remove.run({ params, body: {} }));   // a one-press change
 *   if (await fresh.ensure()) modal.open(...);                    // before a form that ends in one
 *
 * The modal replaces any open one (there is only one), so a form asks before it
 * opens rather than at its save. `onConfirmed` is told which way the person used.
 */
export function useFreshSignIn({ onConfirmed }: { onConfirmed?: (way: ConfirmedWay) => void } = {}) {
  const modal = useModal();
  const told = useRef(onConfirmed);
  told.current = onConfirmed;

  /** Ask the person to confirm it is them. True once they have. */
  const confirm = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        let confirmed = false;
        modal.open({
          title: "Confirm It's You",
          body: (close) => (
            <ConfirmForm
              close={close}
              onConfirmed={(way) => {
                confirmed = true;
                close();
                told.current?.(way);
              }}
            />
          ),
          onClose: () => resolve(confirmed),
        });
      }),
    [modal],
  );

  /** Run a change; when the window has passed, confirm and run it once more. Undefined when the person declined. */
  const guard = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await run();
      } catch (e) {
        if (!refusedForAge(e)) throw e;
        if (!(await confirm())) return undefined;
        return run();
      }
    },
    [confirm],
  );

  /** Before a form that ends in such a change: true at once inside the window, or once the person has confirmed. */
  const ensure = useCallback(async () => {
    const methods = await api.call("GET /api/v1/security");
    return methods.confirmed_for > MARGIN_SECONDS ? true : confirm();
  }, [confirm]);

  return { guard, ensure };
}

/** The strongest way the person has, first: a passkey, else the PIN, else the password. */
function waysOf(m: { pin: { on: boolean }; passkeys: number } | null | undefined): Array<{ value: Way; label: string }> {
  return [
    ...(m && m.passkeys > 0 && passkeysWork() ? [{ value: "passkey" as const, label: "Passkey" }] : []),
    ...(m?.pin.on ? [{ value: "pin" as const, label: "PIN" }] : []),
    { value: "password" as const, label: "Password" },
  ];
}

function ConfirmForm({ close, onConfirmed }: { close: () => void; onConfirmed: (way: Way) => void }) {
  const methods = useApi("GET /api/v1/security");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const f = useContractForm(
    { way: "password" as Way, password: "", pin: "" },
    {
      password: (v, all) => (all.way === "password" && !v ? "Enter your password" : null),
      pin: (v, all) => (all.way === "pin" && !/^\d{4}$/.test(v) ? "Enter 4 digits" : null),
    },
  );
  const way = f.values.way;
  const m = methods.data;
  const ways = waysOf(m);
  // Once the ways are known, start on the strongest the person has (decision 11: a passkey first).
  const { set } = f;
  const first = ways[0]?.value;
  useEffect(() => {
    if (m && first && first !== "password") set("way", first);
  }, [m, first, set]);

  const send = async (body: Confirm) => {
    await api.call("POST /api/v1/security/confirm", { body });
    onConfirmed(body.method);
  };

  const go = async (typedPin?: string) => {
    if (way !== "passkey" && typedPin === undefined && !f.check()) return;
    setBusy(true);
    setProblem(null);
    try {
      if (way === "passkey") {
        const start = await api.call("POST /api/v1/security/confirm/options", { body: {} });
        const credential = await signWithPasskey(start.options);
        await send({ method: "passkey", challenge_token: start.challenge_token, credential });
      } else if (way === "pin") await send({ method: "pin", pin: typedPin ?? f.values.pin });
      else await send({ method: "password", password: f.values.password });
    } catch (e) {
      if (passkeyCancelled(e)) return;
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else setProblem(e instanceof ApiError ? e.message : passkeyProblem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {ways.length > 1 && (
        <Field label="Confirm With">
          <ChoiceField value={way} onChange={(v) => (f.set("way", v), setProblem(null))} options={ways} />
        </Field>
      )}
      {way === "password" && (
        <Field label="Password" {...f.status("password")}>
          <PasswordField autoComplete="current-password" {...f.field("password")} />
        </Field>
      )}
      {way === "pin" && (
        <Field label="PIN" {...f.status("pin")}>
          <OtpField label="PIN" length={4} secret {...f.field("pin")} onComplete={(v) => void go(v)} />
        </Field>
      )}
      {problem && <FormError>{problem}</FormError>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon={way === "passkey" ? "fingerprint" : "lock"} busy={busy} onClick={() => go()}>
          {way === "passkey" ? "Use Passkey" : "Confirm"}
        </Button>
      </FormFooter>
    </>
  );
}
