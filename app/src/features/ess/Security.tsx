import identity from "@mycity/contract/schemas/identity.js";
import type { SignIn } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { PagedTable } from "@/features/shared/sections";
import { hrefFor, useRouter } from "@/lib/router";
import { Button, Card, CardHeader, DesktopOnly, ErrorState, Field, formatDate, formatWhen, FormFooter, Grid, LoadingRows, PageHeader, PasswordField, Pill, toast, useConfirm, useContractForm, useModal, Who } from "@mycity/ui";

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

function statusOf(s: SignIn) {
  if (s.current) return <Pill tone="ok">This Device</Pill>;
  if (s.status === "active") return <Pill tone="info">Signed In</Pill>;
  return <Pill tone="neutral">{s.end_reason ? ENDED[s.end_reason] : "Ended"}</Pill>;
}

/**
 * ESS · My Security: the person's password, where they are signed in, and the
 * sign-ins on their account (docs/guides/identity.md §10). Two-step sign-in,
 * passkeys and the PIN join this page with the security module.
 */
export function MySecurityPage() {
  const summary = useApi("GET /api/v1/auth/security");
  const live = usePaged("GET /api/v1/auth/sessions", { filters: { status: "active" } });
  const all = usePaged("GET /api/v1/auth/sessions");
  const endOne = useMutation("POST /api/v1/auth/sessions/:id/end");
  const endOthers = useMutation("POST /api/v1/auth/sessions/end-others");
  const modal = useModal();
  const confirm = useConfirm();
  const { navigate } = useRouter();
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.reload} />;
  if (!summary.data) return <LoadingRows count={6} />;
  const s = summary.data;
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
    const r = await endOthers.run({ body: {} });
    refresh();
    toast(r.ended === 1 ? "1 device signed out" : `${r.ended} devices signed out`);
  };

  const pw = (
    <Card>
      <CardHeader title="Password" />
      <p className="text-sm text-muted-foreground">{s.password_changed_at ? `Changed ${formatDate(s.password_changed_at)}` : "Not changed yet"}</p>
      <Button className="mt-3" icon="lock" onClick={() => modal.open({ title: "Change Password", body: (close) => <PasswordForm close={close} /> })}>
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
      right={s.active_sessions > 1 ? <Button size="sm" busy={endOthers.pending} onClick={() => void others()}>Sign Out Others</Button> : undefined}
      columns={[
        { key: "d", label: "Device", render: (r) => <Who name={r.device_label} sub={r.ip_address ?? ""} /> },
        { key: "w", label: "Signed In", render: (r) => formatWhen(r.issued_at) },
        { key: "s", label: "Status", render: (r) => (r.current ? statusOf(r) : <Button size="sm" onClick={() => void end(r)}>Sign Out</Button>) },
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
        { key: "a", label: "Address", desktop: true, render: (r) => r.ip_address ?? "" },
        { key: "s", label: "Status", render: statusOf },
      ]}
    />
  );
  const dev = (
    <Card>
      <CardHeader title="Clock-In Devices" />
      <Button className="mt-3" iconRight="right" onClick={() => navigate(hrefFor("ess", "my-devices"))}>
        Open My Devices
      </Button>
    </Card>
  );

  return (
    <>
      <PageHeader title="My Security" sub="Your password and where you are signed in" />
      <PhoneCards
        items={[
          { icon: "lock", title: "Password", sub: s.password_changed_at ? `Changed ${formatDate(s.password_changed_at)}` : "Not changed yet", body: pw },
          { icon: "shield", title: "Signed In", sub: s.active_sessions === 1 ? "1 device" : `${s.active_sessions} devices`, body: sessions, wide: true },
          { icon: "clock", title: "Recent Sign-Ins", sub: "Every sign-in", body: history, wide: true },
          { icon: "msg", title: "Clock-In Devices", sub: "In My Devices", body: dev },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2}>
          {pw}
          {dev}
        </Grid>
        {sessions}
        {history}
      </DesktopOnly>
    </>
  );
}

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
        <Button variant="primary" busy={save.pending} onClick={() => void submit()}>
          Change Password
        </Button>
      </FormFooter>
    </>
  );
}
