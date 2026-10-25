import { useState } from "react";
import identity from "@mycity/contract/schemas/identity.js";
import security from "@mycity/contract/schemas/security.js";
import type { MyDevice, Passkey, SignIn, SignInMethods, TwoStepSetup } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import { createPasskey, passkeyCancelled, passkeyProblem, passkeysWork } from "@/auth/passkey";
import { DEVICE_STATUS } from "@/features/attendance/labels";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { PagedTable } from "@/features/shared/sections";
import { hrefFor, useRouter } from "@/lib/router";
import { useUrlAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  ChoiceField,
  DesktopOnly,
  ErrorState,
  Field,
  formatDate,
  formatWhen,
  FormFooter,
  Grid,
  Inline,
  LoadingRows,
  OtpField,
  PageHeader,
  PasswordField,
  Pill,
  TextField,
  toast,
  useConfirm,
  useContractForm,
  useModal,
  Who,
} from "@mycity/ui";

/** How an ended sign-in ended, in a person's words. */
const ENDED: Record<NonNullable<SignIn["end_reason"]>, string> = {
  signed_out: "Signed out",
  session_max_age: "Timed out",
  inactivity_timeout: "Idle",
  refresh_token_reuse: "Stopped",
  password_changed: "Password changed",
  password_reset: "Password reset",
  ended_by_user: "Signed out",
  ended_by_admin: "Signed out",
  account_suspended: "Suspended",
};

/** How a sign-in began. */
const METHOD: Record<SignIn["method"], string> = {
  password: "Password",
  password_totp: "Password and Code",
  pin: "PIN",
  pin_totp: "PIN and Code",
  passkey: "Passkey",
};

type Frequency = SignInMethods["two_step"]["mfa_frequency"];
const HOW_OFTEN: Array<{ value: Frequency; label: string }> = [
  { value: "every_sign_in", label: "Every Sign-In" },
  { value: "daily", label: "Once a Day" },
  { value: "monthly", label: "Once a Month" },
];

/** After any change to a way in: My Security's view, and the greeting the lock screen and sign-in read. */
const refreshWays = () => invalidate("/api/v1/security", "/api/v1/auth/device");

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : passkeyProblem(e));

function statusOf(s: SignIn) {
  if (s.current) return <Pill tone="ok">This Device</Pill>;
  if (s.status === "active") return <Pill tone="info">Signed In</Pill>;
  return <Pill tone="neutral">{s.end_reason ? ENDED[s.end_reason] : "Ended"}</Pill>;
}

/**
 * ESS · My Security: how the person signs in and where they are signed in
 * (docs/guides/identity.md §10, docs/guides/ess.md §10): the password, two-step
 * sign-in, passkeys and the PIN, the live sessions and every sign-in with how it
 * began. Adding or removing a way in asks the person to confirm it is them once
 * the window after signing in has passed (useFreshSignIn).
 */
export function MySecurityPage() {
  const summary = useApi("GET /api/v1/auth/security");
  const ways = useApi("GET /api/v1/security");
  const live = usePaged("GET /api/v1/auth/sessions", { filters: { status: "active" } });
  const all = usePaged("GET /api/v1/auth/sessions");
  const devices = usePaged("GET /api/v1/devices/mine");
  const endOne = useMutation("POST /api/v1/auth/sessions/:id/end");
  const endOthers = useMutation("POST /api/v1/auth/sessions/end-others");
  const modal = useModal();
  const confirm = useConfirm();
  const { navigate } = useRouter();
  const changePassword = () => modal.open({ title: "Change Password", body: (close) => <PasswordForm close={close} /> });
  useUrlAction("password", summary.data ? changePassword : null);
  const failed = summary.error ?? ways.error;
  if (failed) return <ErrorState error={failed} onRetry={() => (summary.reload(), ways.reload())} />;
  if (!summary.data || !ways.data) return <LoadingRows count={6} />;
  const s = summary.data;
  const w = ways.data;
  const refresh = () => invalidate("/api/v1/auth/s");

  const end = async (row: SignIn) => {
    if (!(await confirm({ title: "Sign Out Device", body: row.device_label, confirmLabel: "Sign Out" }))) return;
    try {
      await endOne.run({ params: { id: row.session_id }, body: {} });
      refresh();
      toast("Device signed out");
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const others = async () => {
    if (!(await confirm({ title: "Sign Out Others", confirmLabel: "Sign Out" }))) return;
    try {
      const r = await endOthers.run({ body: {} });
      refresh();
      toast(r.ended === 1 ? "1 device signed out" : `${r.ended} devices signed out`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not signed out. Try again.");
    }
  };

  const pw = (
    <Card>
      <CardHeader title="Password" />
      <p className="text-sm text-muted-foreground">{s.password_changed_at ? `Changed ${formatDate(s.password_changed_at)}` : "Not changed yet"}</p>
      <Button className="mt-3" icon="lock" onClick={changePassword}>
        Change Password
      </Button>
    </Card>
  );
  const sessions = (
    <PagedTable<SignIn>
      title="Signed In"
      list={live}
      rowKey={(r) => r.session_id}
      noun="device"
      right={s.active_sessions > 1 ? <Button size="sm" busy={endOthers.pending} onClick={() => others()}>Sign Out Others</Button> : undefined}
      columns={[
        { key: "d", label: "Device", render: (r) => <Who name={r.device_label} sub={r.ip_address ?? ""} /> },
        { key: "w", label: "Signed In", render: (r) => formatWhen(r.issued_at) },
        { key: "s", label: "Status", render: (r) => (r.current ? statusOf(r) : <Button size="sm" onClick={() => end(r)}>Sign Out</Button>) },
      ]}
    />
  );
  const history = (
    <PagedTable<SignIn>
      title="Recent Sign-Ins"
      list={all}
      rowKey={(r) => r.session_id}
      noun="sign-in"
      columns={[
        { key: "w", label: "When", render: (r) => formatWhen(r.issued_at) },
        { key: "d", label: "Device", render: (r) => r.device_label },
        { key: "m", label: "Method", render: (r) => METHOD[r.method] },
        { key: "a", label: "Address", desktop: true, render: (r) => r.ip_address ?? "" },
        { key: "s", label: "Status", render: statusOf },
      ]}
    />
  );
  // The devices used to clock in, registered or seen; managed on My Devices (attendance, LA).
  const clockIn = (devices.rows as MyDevice[]).filter((d) => d.status !== "removed");
  const registered = clockIn.filter((d) => d.status === "registered").length;
  const dev = (
    <Card>
      <CardHeader title="Clock-In Devices" />
      {devices.error ? (
        <ErrorState error={devices.error} onRetry={devices.reload} />
      ) : devices.loading && !devices.rows.length ? (
        <LoadingRows count={2} />
      ) : clockIn.length ? (
        <ul className="m-0 list-none p-0">
          {clockIn.map((d) => (
            <li key={d.attendance_device_id} className="flex flex-wrap items-center gap-2 border-b border-border py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <b className="block text-sm">{d.label}{d.platform ? ` · ${d.platform}` : ""}</b>
                <span className="text-2xs text-subtle-foreground">
                  {d.last_punch_at ? `Last clock-in ${formatWhen(d.last_punch_at)}` : "Not used to clock in yet"}
                </span>
              </span>
              {d.this_device && <Pill tone="info">This Device</Pill>}
              <Pill tone={DEVICE_STATUS[d.status].tone}>{DEVICE_STATUS[d.status].text}</Pill>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No clock-in devices yet. Your device is added the first time you clock in.</p>
      )}
      <Button className="mt-3" iconRight="right" onClick={() => navigate(hrefFor("ess", "my-devices"))}>
        Manage My Devices
      </Button>
    </Card>
  );

  return (
    <>
      <PageHeader title="My Security" />
      <PhoneCards
        items={[
          { icon: "lock", title: "Password", sub: s.password_changed_at ? `Changed ${formatDate(s.password_changed_at)}` : "Not changed yet", body: pw },
          { icon: "shield", title: "Two-Step Sign-In", sub: w.two_step.on ? "On" : "Off", body: <TwoStepCard /> },
          { icon: "fingerprint", title: "Passkeys", sub: w.passkeys === 1 ? "1 passkey" : w.passkeys ? `${w.passkeys} passkeys` : "None yet", body: <PasskeysCard />, wide: true },
          { icon: "key", title: "PIN", sub: w.pin.on ? "On" : "Off", body: <PinCard /> },
          { icon: "globe", title: "Signed In", sub: s.active_sessions === 1 ? "1 device" : `${s.active_sessions} devices`, body: sessions, wide: true },
          { icon: "clock", title: "Recent Sign-Ins", sub: "Every sign-in", body: history, wide: true },
          { icon: "msg", title: "Clock-In Devices", sub: registered === 1 ? "1 registered" : `${registered} registered`, body: dev },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2}>
          {pw}
          <TwoStepCard />
          <PinCard />
          {dev}
        </Grid>
        <PasskeysCard />
        {sessions}
        {history}
      </DesktopOnly>
    </>
  );
}

/* ───────────── Two-step sign-in ───────────── */

/** Two-step sign-in: set up, how often it asks, new recovery codes, a new app, off. */
function TwoStepCard() {
  const ways = useApi("GET /api/v1/security");
  const modal = useModal();
  const confirm = useConfirm();
  const fresh = useFreshSignIn();
  const setup = useMutation("POST /api/v1/security/two-step/setup");
  const often = useMutation("POST /api/v1/security/two-step/frequency");
  const codes = useMutation("POST /api/v1/security/two-step/recovery-codes");
  const off = useMutation("POST /api/v1/security/two-step/off");
  const t = ways.data?.two_step;
  if (!t) return <Card><LoadingRows count={2} /></Card>;

  const start = async () => {
    try {
      if (!(await fresh.ensure())) return;
      const r = await fresh.guard(() => setup.run({ body: {} }));
      if (r) modal.open({ title: t.on ? "Change App" : "Set Up Two-Step", body: (close) => <SetUpForm setup={r} close={close} /> });
    } catch (e) {
      say(e);
    }
  };
  const ask = async (v: Frequency) => {
    try {
      const r = await fresh.guard(() => often.run({ body: { mfa_frequency: v } }));
      if (!r) return;
      refreshWays();
      toast(`Code asked ${HOW_OFTEN.find((h) => h.value === v)?.label.toLowerCase()}`);
    } catch (e) {
      say(e);
    }
  };
  const renew = async () => {
    if (!(await confirm({ title: "New Recovery Codes", body: "Your current recovery codes will stop working.", confirmLabel: "Make New Codes" }))) return;
    try {
      const r = await fresh.guard(() => codes.run({ body: {} }));
      if (!r) return;
      refreshWays();
      modal.open({ title: "Recovery Codes", body: (close) => <RecoveryCodes codes={r.recovery_codes} close={close} /> });
    } catch (e) {
      say(e);
    }
  };
  const turnOff = async () => {
    if (!(await confirm({ title: "Turn Off Two-Step", body: "Signing in will no longer ask for a code.", confirmLabel: "Turn Off", destructive: true }))) return;
    try {
      const r = await fresh.guard(() => off.run({ body: {} }));
      if (!r) return;
      refreshWays();
      toast("Two-step sign-in is off");
    } catch (e) {
      say(e);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Two-Step Sign-In"
        help="A code from an authenticator app on your phone after your password or PIN, on a device that has not given one lately. A passkey needs no code."
        actions={<Pill tone={t.on ? "ok" : "neutral"}>{t.on ? "On" : "Off"}</Pill>}
      />
      {t.on ? (
        <>
          <Field label="Ask for a Code">
            <ChoiceField value={t.mfa_frequency} onChange={(v) => void ask(v)} options={HOW_OFTEN} />
          </Field>
          <p className="text-sm text-muted-foreground">{t.recovery_codes_left === 1 ? "1 recovery code left" : `${t.recovery_codes_left} recovery codes left`}</p>
          <Inline className="mt-3" gap={2}>
            <Button size="sm" icon="refresh" busy={codes.pending} onClick={() => renew()}>
              New Codes
            </Button>
            <Button size="sm" icon="phone" busy={setup.pending} onClick={() => start()}>
              Change App
            </Button>
            {!t.required && (
              <Button size="sm" variant="danger" busy={off.pending} onClick={() => turnOff()}>
                Turn Off
              </Button>
            )}
          </Inline>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Not set up</p>
          <Button className="mt-3" icon="shield" busy={setup.pending} onClick={() => start()}>
            Set Up Two-Step
          </Button>
        </>
      )}
    </Card>
  );
}

/** The new key as a QR code and as text; its first code turns two-step on and shows the recovery codes. */
function SetUpForm({ setup, close }: { setup: TwoStepSetup; close: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const turnOn = useMutation("POST /api/v1/security/two-step");
  const f = useContractForm({ code: "" }, { code: (v) => (/^\d{6}$/.test(v) ? null : "Enter 6 digits") });
  if (codes) return <RecoveryCodes codes={codes} close={close} />;

  const submit = async (typed?: string) => {
    if (typed === undefined && !f.check()) return;
    try {
      const r = await turnOn.run({ body: { code: typed ?? f.values.code } });
      refreshWays();
      setCodes(r.recovery_codes);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };

  return (
    <>
      <p className="text-sm">Scan this with your authenticator app, then enter the code it shows.</p>
      <div className="my-4 flex flex-col items-center gap-2">
        <img src={setup.qr_code} alt="QR code for your authenticator app" className="size-60 rounded-box" />
        <p className="text-center font-mono text-sm tracking-wide wrap-any" data-copy="content">
          {setup.secret}
        </p>
      </div>
      <Field label="Code From App" {...f.status("code")}>
        <OtpField label="Code From App" {...f.field("code")} onComplete={(v) => void submit(v)} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="shield" busy={turnOn.pending} onClick={() => submit()}>
          Turn On
        </Button>
      </FormFooter>
    </>
  );
}

/** Ten recovery codes, shown this once. */
function RecoveryCodes({ codes, close }: { codes: string[]; close: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast("Recovery codes copied");
    } catch {
      toast("Copy them by hand");
    }
  };
  return (
    <>
      <p className="text-sm">Keep these somewhere safe. Each one signs you in once without your phone.</p>
      <ul className="my-4 grid grid-cols-2 gap-2 font-mono text-sm" data-copy="content">
        {codes.map((c) => (
          <li key={c} className="rounded-box bg-muted px-3 py-2 text-center tracking-wide">
            {c}
          </li>
        ))}
      </ul>
      <FormFooter>
        <Button icon="copy" onClick={() => copy()}>
          Copy Codes
        </Button>
        <Button variant="primary" onClick={close}>
          Close
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Passkeys ───────────── */

/** The person's passkeys: add one on this device, rename one, remove one. */
function PasskeysCard() {
  const list = usePaged("GET /api/v1/security/passkeys");
  const modal = useModal();
  const fresh = useFreshSignIn();
  const options = useMutation("POST /api/v1/security/passkeys/options");
  const [adding, setAdding] = useState(false);

  const add = async () => {
    setAdding(true);
    try {
      const start = await fresh.guard(() => options.run({ body: {} }));
      if (!start) return;
      const credential = await createPasskey(start.options);
      await api.call("POST /api/v1/security/passkeys", { body: { challenge_token: start.challenge_token, credential } });
      refreshWays();
      toast("Passkey added");
    } catch (e) {
      if (!passkeyCancelled(e)) say(e);
    } finally {
      setAdding(false);
    }
  };

  return (
    <PagedTable<Passkey>
      title="Passkeys"
      list={list}
      rowKey={(p) => p.passkey_id}
      noun="passkey"
      right={
        passkeysWork() ? (
          <Button size="sm" icon="fingerprint" busy={adding} onClick={() => add()}>
            Add Passkey
          </Button>
        ) : undefined
      }
      empty={{ title: "No Passkeys Yet", text: "Sign in with your fingerprint or face." }}
      onRowClick={(p) => modal.open({ title: "Passkey", body: (close) => <PasskeyForm passkey={p} close={close} /> })}
      columns={[
        {
          key: "n",
          label: "Name",
          render: (p) => (
            <Inline gap={2}>
              <span data-copy="content">{p.label}</span>
              {p.this_device && <Pill tone="ok">This Device</Pill>}
            </Inline>
          ),
        },
        { key: "a", label: "Added", render: (p) => formatDate(p.created_at) },
        { key: "u", label: "Last Used", render: (p) => (p.last_used_at ? formatWhen(p.last_used_at) : "Never") },
      ]}
    />
  );
}

/** One passkey: its name, and removing it. */
function PasskeyForm({ passkey, close }: { passkey: Passkey; close: () => void }) {
  const confirm = useConfirm();
  const fresh = useFreshSignIn();
  const rename = useMutation("POST /api/v1/security/passkeys/:id/rename");
  const remove = useMutation("POST /api/v1/security/passkeys/:id/remove");
  const f = useContractForm({ label: passkey.label }, security.PasskeyRename);
  const params = { id: passkey.passkey_id };

  const save = async () => {
    if (!f.check()) return;
    try {
      await rename.run({ params, body: { label: f.values.label.trim() } });
      refreshWays();
      close();
      toast("Passkey renamed");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const drop = async () => {
    if (!(await confirm({ title: "Remove Passkey", body: `${passkey.label} will no longer sign you in.`, confirmLabel: "Remove Passkey", destructive: true }))) return;
    try {
      const r = await fresh.guard(() => remove.run({ params, body: {} }));
      if (!r) return;
      refreshWays();
      close();
      toast("Passkey removed");
    } catch (e) {
      say(e);
    }
  };

  return (
    <>
      <Field label="Name" {...f.status("label")}>
        <TextField {...f.field("label")} placeholder="Work Laptop" />
      </Field>
      <FormFooter>
        <Button variant="danger" icon="trash" busy={remove.pending} onClick={() => drop()}>
          Remove Passkey
        </Button>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={rename.pending} onClick={() => save()}>
          Save Name
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── The PIN ───────────── */

/** The PIN: set, change, remove. */
function PinCard() {
  const ways = useApi("GET /api/v1/security");
  const modal = useModal();
  const confirm = useConfirm();
  const fresh = useFreshSignIn();
  const remove = useMutation("POST /api/v1/security/pin/remove");
  const p = ways.data?.pin;
  const set = async () => {
    try {
      if (await fresh.ensure()) modal.open({ title: p?.on ? "Change PIN" : "Set PIN", body: (close) => <PinForm close={close} /> });
    } catch (e) {
      say(e);
    }
  };
  useUrlAction("pin", p ? () => void set() : null);
  if (!p) return <Card><LoadingRows count={2} /></Card>;

  const drop = async () => {
    if (!(await confirm({ title: "Remove PIN", body: "Your PIN will no longer unlock the app.", confirmLabel: "Remove PIN", destructive: true }))) return;
    try {
      const r = await fresh.guard(() => remove.run({ body: {} }));
      if (!r) return;
      refreshWays();
      toast("PIN removed");
    } catch (e) {
      say(e);
    }
  };

  return (
    <Card>
      <CardHeader
        title="PIN"
        help="Four digits that unlock the app, and sign you in on a device you have signed in on before."
        actions={<Pill tone={p.on ? "ok" : "neutral"}>{p.on ? "On" : "Off"}</Pill>}
      />
      <p className="text-sm text-muted-foreground">{p.on && p.pin_changed_at ? `Changed ${formatDate(p.pin_changed_at)}` : "Not set"}</p>
      <Inline className="mt-3" gap={2}>
        <Button icon="key" onClick={() => set()}>
          {p.on ? "Change PIN" : "Set PIN"}
        </Button>
        {p.on && (
          <Button variant="danger" busy={remove.pending} onClick={() => drop()}>
            Remove PIN
          </Button>
        )}
      </Inline>
    </Card>
  );
}

function PinForm({ close }: { close: () => void }) {
  const fresh = useFreshSignIn();
  const save = useMutation("POST /api/v1/security/pin");
  const f = useContractForm(
    { pin: "", again: "" },
    { pin: (v) => security.weakPinReason(v), again: (v, all) => (v !== all.pin ? "Does not match" : null) },
  );
  const submit = async () => {
    if (!f.check()) return;
    try {
      const r = await fresh.guard(() => save.run({ body: { pin: f.values.pin } }));
      if (!r) return;
      refreshWays();
      close();
      toast("PIN saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="New PIN" {...f.status("pin")}>
        <OtpField label="New PIN" length={4} secret {...f.field("pin")} />
      </Field>
      <Field label="Confirm PIN" {...f.status("again")}>
        <OtpField label="Confirm PIN" length={4} secret {...f.field("again")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="key" busy={save.pending} onClick={() => submit()}>
          Save PIN
        </Button>
      </FormFooter>
    </>
  );
}

/* ───────────── The password ───────────── */

/** The contract's rule for a new password, as a field mark. */
const newPasswordRule = (v: string) => {
  const r = identity.NewPassword.safeParse(v);
  return r.success ? null : r.error.issues[0].message;
};

function PasswordForm({ close }: { close: () => void }) {
  const f = useContractForm(
    { cur: "", next: "", again: "" },
    { cur: (v) => (v ? null : "Enter your password"), next: newPasswordRule, again: (v, all) => (v !== all.next ? "Does not match" : null) },
  );
  const save = useMutation("POST /api/v1/auth/password");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const r = await save.run({ body: { current_password: f.values.cur, new_password: f.values.next } });
      invalidate("/api/v1/auth/s");
      close();
      toast(r.sessions_signed_out ? "Password changed, other devices signed out" : "Password changed");
    } catch {
      /* the fields show why */
    }
  };
  const cur = f.field("cur");
  const next = f.field("next");
  return (
    <>
      <Field label="Current Password" {...cur} state={save.fields.current_password ? "bad" : cur.state} message={save.fields.current_password?.[0] ?? cur.message}>
        <PasswordField autoComplete="current-password" {...cur} />
      </Field>
      <Field label="New Password" {...next} state={save.fields.new_password ? "bad" : next.state} message={save.fields.new_password?.[0] ?? next.message}>
        <PasswordField autoComplete="new-password" {...next} />
      </Field>
      <Field label="Confirm New Password" {...f.field("again")}>
        <PasswordField autoComplete="new-password" {...f.field("again")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>
          Change Password
        </Button>
      </FormFooter>
    </>
  );
}
