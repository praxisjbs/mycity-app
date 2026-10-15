import { useState } from "react";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/data";
import { Icon } from "@/components/ui/Icon";
import { Card, CardHeader, DesktopOnly, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { ErrorBlock, LoadingRows, Table } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { formatDate, formatDateTime } from "@/lib/format";
import { hrefFor, useRouter } from "@/lib/router";
import { Field, Input, ToggleRow } from "@/components/form";

export function MySecurityPage() {
  const { data: s, error, reload } = useApi("GET /api/v1/ess/security");
  const patch = useMutation("PATCH /api/v1/ess/security");
  const modal = useModal();
  const { navigate } = useRouter();
  if (error) return <ErrorBlock error={error} onRetry={reload} />;
  if (!s) return <LoadingRows count={6} />;
  const set = async (body: { mfa_app?: boolean; mfa_email_fallback?: boolean }) => {
    await patch.run({ body });
    invalidate("/api/v1/ess/security");
    toast("Saved");
  };
  const pw = (
    <Card>
      <CardHeader title="Password" />
      <p className="text-[11.5px] text-subtle-foreground">Last changed {formatDate(s.password_changed_at)}.</p>
      <Button className="mt-3" onClick={() => modal.open({ title: "Change Password", body: (close) => <PasswordForm close={close} /> })}>Change Password</Button>
    </Card>
  );
  const mfa = (
    <Card>
      <CardHeader title="Two-Step Sign-In" />
      <ToggleRow title="Authenticator app" text="A 6 digit code at sign in, from any authenticator app" checked={s.mfa_app} onChange={(v) => set({ mfa_app: v })} />
      <ToggleRow title="Email code as a fallback" text="Used only if the app is unavailable" checked={s.mfa_email_fallback} onChange={(v) => set({ mfa_email_fallback: v })} />
    </Card>
  );
  const pk = (
    <Card>
      <CardHeader title="Passkeys" right={<Pill tone="ok">{`${s.passkeys.length} set up`}</Pill>} />
      {s.passkeys.map((k) => (
        <div key={k.passkey_id} className="flex items-center gap-[11px] border-b border-border py-2.5">
          <span className="flex size-[34px] items-center justify-center rounded-box bg-accent text-accent-foreground"><Icon name="shield" size="m" /></span>
          <span className="flex-1"><b className="text-[13px] font-semibold">{k.name}</b><span className="block text-[11.5px] text-subtle-foreground">Added {formatDate(k.added)} · used {k.last_used}</span></span>
        </div>
      ))}
      <Button className="mt-3" icon="plus" onClick={() => toast("Follow the prompt on your device")}>Add a Passkey</Button>
      <p className="mt-[11px] text-[11.5px] text-subtle-foreground">Sign in with your fingerprint or face instead of a password.</p>
    </Card>
  );
  const pin = (
    <Card>
      <CardHeader title="PIN" right={<Pill tone={s.pin_set ? "ok" : "neutral"}>{s.pin_set ? "Set" : "Not set"}</Pill>} />
      <p className="text-[11.5px] text-subtle-foreground">A short PIN to unlock the app and confirm a clock-in on a registered device.</p>
      <Button className="mt-3" onClick={() => modal.open({ title: "Set a PIN", body: (close) => <PinForm close={close} /> })}>{s.pin_set ? "Change PIN" : "Set a PIN"}</Button>
    </Card>
  );
  const dev = (
    <Card>
      <CardHeader title="Devices" right={<Pill>Up to 3</Pill>} />
      <p className="text-[11.5px] text-subtle-foreground">The phones and laptops you clock in from are managed in My Devices. A clock-in from any other device is flagged to People.</p>
      <Button className="mt-3" iconRight="right" onClick={() => navigate(hrefFor("ess", "my-devices"))}>Open My Devices</Button>
    </Card>
  );
  const act = (
    <Table
      title="Recent Sign-Ins"
      rows={s.sign_ins}
      rowKey={(r) => r.at}
      columns={[
        { key: "w", label: "When", render: (r) => formatDateTime(r.at) },
        { key: "d", label: "Device", render: (r) => r.device },
        { key: "p", label: "Where", desktop: true, render: (r) => r.where },
        { key: "r", label: "Result", render: (r) => <Pill tone={r.result.tone}>{r.result.text}</Pill> },
      ]}
    />
  );
  return (
    <>
      <PageHead title="My Security" sub="How you sign in, and the devices you clock in from" />
      <PhoneCards
        items={[
          { icon: "shield", title: "Password", sub: `Changed ${formatDate(s.password_changed_at)}`, body: pw },
          { icon: "check", title: "Two-Step Sign-In", sub: s.mfa_app ? "Authenticator on" : "Off", body: mfa },
          { icon: "spark", title: "Passkeys", sub: `${s.passkeys.length} set up`, body: pk },
          { icon: "grid", title: "PIN", sub: s.pin_set ? "Set" : "Not set", body: pin },
          { icon: "msg", title: "Devices", sub: "Managed in My Devices", body: dev },
          { icon: "clock", title: "Sign-In Activity", sub: `${s.sign_ins.filter((x) => x.result.tone === "err").length} flagged`, body: act, wide: true },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2}>{pw}{mfa}</Grid>
        <Grid cols={2}>{pk}{pin}</Grid>
        <Grid cols={2}>{dev}{act}</Grid>
      </DesktopOnly>
    </>
  );
}

function PasswordForm({ close }: { close: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const save = useMutation("POST /api/v1/auth/password");
  const nBad = next.length > 0 && next.length < 12;
  const aBad = again.length > 0 && again !== next;
  const ok = cur.length >= 8 && next.length >= 12 && again === next;
  return (
    <>
      <Field label="Current Password" state={save.fields.current_password ? "bad" : undefined} message={save.fields.current_password?.[0]}><Input type="password" value={cur} onChange={setCur} autoComplete="current-password" /></Field>
      <Field label="New Password" state={nBad ? "bad" : next ? "good" : undefined} message="At least 12 characters"><Input type="password" value={next} onChange={setNext} autoComplete="new-password" state={nBad ? "bad" : next ? "good" : undefined} /></Field>
      <Field label="Confirm New Password" state={aBad ? "bad" : again ? "good" : undefined} message="Does not match"><Input type="password" value={again} onChange={setAgain} autoComplete="new-password" state={aBad ? "bad" : again ? "good" : undefined} /></Field>
      <p className="text-[11.5px] text-subtle-foreground">Changing your password signs you out everywhere else.</p>
      <div className="-mx-[18px] mt-3 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!ok || save.pending} onClick={async () => { try { await save.run({ body: { current_password: cur, new_password: next } }); close(); toast("Password updated"); } catch { /* the field shows why */ } }}>Update Password</Button>
      </div>
    </>
  );
}

function PinForm({ close }: { close: () => void }) {
  const [pin, setPin] = useState("");
  const save = useMutation("POST /api/v1/auth/pin");
  const ok = /^\d{4,6}$/.test(pin);
  return (
    <>
      <p className="mb-3 text-[11.5px] text-subtle-foreground">A 4 to 6 digit PIN unlocks the app and confirms a clock-in on a registered device.</p>
      <Field label="PIN" state={pin ? (ok ? "good" : "bad") : undefined} message="4 to 6 digits">
        <Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(v) => setPin(v.replace(/\D/g, ""))} className="h-[50px] text-center text-[20px] font-bold tracking-[.4em]" state={pin ? (ok ? "good" : "bad") : undefined} />
      </Field>
      <div className="-mx-[18px] mt-2 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!ok || save.pending} onClick={async () => (await save.run({ body: { pin } }), invalidate("/api/v1/ess/security"), close(), toast("PIN saved"))}>Save PIN</Button>
      </div>
    </>
  );
}
