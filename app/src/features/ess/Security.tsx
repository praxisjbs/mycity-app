import { invalidate, useApi, useMutation } from "@/api/hooks";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { hrefFor, useRouter } from "@/lib/router";
import { Button, Card, CardHeader, DataView, DesktopOnly, ErrorState, Field, formatDate, formatDateTime, FormFooter, Grid, Icon, LoadingRows, PageHeader, PasswordField, Pill, rules, toast, ToggleRow, useContractForm, useModal } from "@mycity/ui";

export function MySecurityPage() {
  const { data: s, error, reload } = useApi("GET /api/v1/ess/security");
  const patch = useMutation("PATCH /api/v1/ess/security");
  const modal = useModal();
  const { navigate } = useRouter();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!s) return <LoadingRows count={6} />;
  const set = async (body: { mfa_app?: boolean; mfa_email_fallback?: boolean }) => {
    await patch.run({ body });
    invalidate("/api/v1/ess/security");
    toast("Saved");
  };
  const pw = (
    <Card>
      <CardHeader title="Password" />
      <p className="text-2xs text-subtle-foreground">Last changed {formatDate(s.password_changed_at)}.</p>
      <Button className="mt-3" onClick={() => modal.open({ title: "Change Password", body: (close) => <PasswordForm close={close} /> })}>Change Password</Button>
    </Card>
  );
  const mfa = (
    <Card>
      <CardHeader title="Two-Step Sign-In" />
      <ToggleRow title="Authenticator App" text="A 6 digit code at sign in, from any authenticator app" checked={s.mfa_app} onChange={(v) => set({ mfa_app: v })} />
      <ToggleRow title="Email Code Fallback" text="Used only if the app is unavailable" checked={s.mfa_email_fallback} onChange={(v) => set({ mfa_email_fallback: v })} />
    </Card>
  );
  const pk = (
    <Card>
      <CardHeader title="Passkeys" right={<Pill tone="ok">{`${s.passkeys.length} set up`}</Pill>} />
      {s.passkeys.map((k) => (
        <div key={k.passkey_id} className="flex items-center gap-2.5 border-b border-border py-2.5">
          <span className="flex size-8.5 items-center justify-center rounded-box bg-accent text-accent-foreground"><Icon name="shield" size="m" /></span>
          <span className="flex-1"><b className="text-sm font-semibold">{k.name}</b><span className="block text-2xs text-subtle-foreground">Added {formatDate(k.added)} · used {k.last_used}</span></span>
        </div>
      ))}
      <Button className="mt-3" icon="plus" onClick={() => toast("Follow the prompt on your device")}>Add a Passkey</Button>
      <p className="mt-2.5 text-2xs text-subtle-foreground">Sign in with your fingerprint or face instead of a password.</p>
    </Card>
  );
  const pin = (
    <Card>
      <CardHeader title="PIN" right={<Pill tone={s.pin_set ? "ok" : "neutral"}>{s.pin_set ? "Set" : "Not set"}</Pill>} />
      <p className="text-2xs text-subtle-foreground">A short PIN to unlock the app and confirm a clock-in on a registered device.</p>
      <Button className="mt-3" onClick={() => modal.open({ title: "Set a PIN", body: (close) => <PinForm close={close} /> })}>{s.pin_set ? "Change PIN" : "Set a PIN"}</Button>
    </Card>
  );
  const dev = (
    <Card>
      <CardHeader title="Devices" right={<Pill>Up to 3</Pill>} />
      <Button className="mt-3" iconRight="right" onClick={() => navigate(hrefFor("ess", "my-devices"))}>Open My Devices</Button>
    </Card>
  );
  const act = (
    <DataView
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
      <PageHeader title="My Security" sub="Sign-in methods and clock-in devices" />
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
  const f = useContractForm(
    { cur: "", next: "", again: "" },
    { cur: rules.min(8, "At least 8 characters"), next: rules.min(12, "At least 12 characters"), again: (v, all) => (v !== all.next ? "Does not match" : null) },
  );
  const save = useMutation("POST /api/v1/auth/password");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { current_password: f.values.cur, new_password: f.values.next } });
      close();
      toast("Password updated");
    } catch {
      /* the field shows why */
    }
  };
  const cur = f.field("cur");
  return (
    <>
      <Field label="Current Password" {...cur} state={save.fields.current_password ? "bad" : cur.state} message={save.fields.current_password?.[0] ?? cur.message}><PasswordField autoComplete="current-password" {...cur} /></Field>
      <Field label="New Password" info="Changing it signs you out everywhere else." {...f.field("next")}><PasswordField autoComplete="new-password" {...f.field("next")} /></Field>
      <Field label="Confirm New Password" {...f.field("again")}><PasswordField autoComplete="new-password" {...f.field("again")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => void submit()}>Update Password</Button>
      </FormFooter>
    </>
  );
}

function PinForm({ close }: { close: () => void }) {
  const f = useContractForm({ pin: "" }, { pin: (v) => (/^\d{4,6}$/.test(v) ? null : "4 to 6 digits") });
  const save = useMutation("POST /api/v1/auth/pin");
  const pin = f.field("pin");
  const submit = async () => {
    if (!f.check()) return;
    await save.run({ body: { pin: f.values.pin } });
    invalidate("/api/v1/ess/security");
    close();
    toast("PIN saved");
  };
  return (
    <>
      <Field label="PIN" {...pin}>
        <PasswordField inputMode="numeric" maxLength={6} {...pin} onChange={(v) => pin.onChange(v.replace(/\D/g, ""))} className="h-12 text-center text-2xl font-bold tracking-otp" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => void submit()}>Save PIN</Button>
      </FormFooter>
    </>
  );
}
