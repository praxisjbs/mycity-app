import { useEffect, useState } from "react";
import type { FailedSignIn, LiveSession, SecurityPolicy } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { Button, Card, CardHeader, DataView, ErrorState, Field, Form, FormFooter, formatDateTime, formatWhen, Grid, LoadingRows, NumberField, PageHeader, Pill, toast, ToggleRow, useConfirm, Who } from "@mycity/ui";

const METHOD: Record<LiveSession["method"], string> = {
  password: "Password",
  password_totp: "Password and Code",
  pin: "PIN",
  pin_totp: "PIN and Code",
  passkey: "Passkey",
};
const REASON: Record<FailedSignIn["reason"], { tone: "err" | "warn" | "neutral"; text: string }> = {
  bad_password: { tone: "err", text: "Wrong password" },
  bad_code: { tone: "err", text: "Wrong code" },
  no_such_account: { tone: "neutral", text: "No such account" },
  throttled: { tone: "warn", text: "Slowed down" },
  suspended: { tone: "warn", text: "Suspended" },
  closed: { tone: "neutral", text: "Closed" },
  other: { tone: "neutral", text: "Refused" },
};
const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/**
 * Settings · Security (docs/guides/foundation.md §6.4, §10): session length, the
 * idle lock and the password minimum, each within the server's own limit; two-step
 * required by role; everyone's live sessions, with End Session; failed sign-ins.
 */
export function SecurityTab() {
  const { can } = useAuth();
  const policy = useApi("GET /api/v1/settings/security");
  const canEdit = can("settings", "edit");
  const p = policy.data;
  return (
    <>
      <PageHeader title="Security" sub="Sign-in rules, sessions and failed sign-ins" />
      {p && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Signed In Now", value: String(p.active_sessions) },
            { label: "Two-Step On", value: `${p.two_step_on} of ${p.users}`, tone: p.two_step_on < p.users ? "warn" : "ok" },
            { label: "Failed Sign-Ins", value: String(p.failed_7d), sub: "Last 7 days", tone: p.failed_7d ? "warn" : undefined },
          ]}
        />
      )}
      {policy.error ? (
        <Card>
          <ErrorState error={policy.error} onRetry={policy.reload} />
        </Card>
      ) : !p ? (
        <Card>
          <LoadingRows count={6} />
        </Card>
      ) : (
        <Grid cols={2}>
          <Rules policy={p} canEdit={canEdit} />
          <TwoStepRoles policy={p} canEdit={canEdit} />
        </Grid>
      )}
      <Sessions canEdit={canEdit} />
      <Failed />
    </>
  );
}

/* ───────────── Rules within the floor ───────────── */

function Rules({ policy, canEdit }: { policy: SecurityPolicy; canEdit: boolean }) {
  const save = useMutation("PATCH /api/v1/settings/security");
  const initial = { session: String(policy.session_max_age_min), idle: String(policy.idle_lock_min), password: String(policy.password_min_length) };
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  useEffect(() => setV(initial), [policy.session_max_age_min, policy.idle_lock_min, policy.password_min_length]); // eslint-disable-line react-hooks/exhaustive-deps -- the saved rules
  const n = (s: string) => Number.parseInt(s, 10);
  const local = {
    session_max_age_min: !n(v.session) || n(v.session) < 5 ? "At least 5 minutes" : n(v.session) > policy.session_max_age_floor ? `At most ${policy.session_max_age_floor} minutes` : null,
    idle_lock_min: !n(v.idle) || n(v.idle) < 5 ? "At least 5 minutes" : n(v.idle) > policy.idle_lock_floor ? `At most ${policy.idle_lock_floor} minutes` : n(v.idle) > n(v.session) ? "Within the session length" : null,
    password_min_length: !n(v.password) || n(v.password) < policy.password_min_floor ? `At least ${policy.password_min_floor}` : n(v.password) > 64 ? "At most 64" : null,
  };
  const [tried, setTried] = useState(false);
  const mark = (k: keyof typeof local) => {
    const m = errors[k]?.[0] ?? (tried ? local[k] : null);
    return m ? { state: "bad" as const, message: m } : {};
  };
  const submit = async () => {
    setTried(true);
    if (Object.values(local).some(Boolean)) return;
    try {
      await save.run({ body: { session_max_age_min: n(v.session), idle_lock_min: n(v.idle), password_min_length: n(v.password) } });
      invalidate("/api/v1/settings/security");
      setErrors({});
      setTried(false);
      toast("Security rules saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrors(e.fields);
      else say(e);
    }
  };
  return (
    <Card>
      <CardHeader title="Sessions and Passwords" />
      <Form onSubmit={() => void submit()}>
        <Field label="Session Minutes" help={`No longer than ${policy.session_max_age_floor} minutes, the server's own limit. After it, the screen locks and the person signs in again.`} {...mark("session_max_age_min")}>
          <NumberField value={v.session} onChange={(x) => (setV((o) => ({ ...o, session: x })), setErrors({}))} disabled={!canEdit} />
        </Field>
        <Field label="Idle Lock Minutes" help={`No later than ${policy.idle_lock_floor} minutes, the server's own limit. Nothing touched for this long locks every tab.`} {...mark("idle_lock_min")}>
          <NumberField value={v.idle} onChange={(x) => (setV((o) => ({ ...o, idle: x })), setErrors({}))} disabled={!canEdit} />
        </Field>
        <Field label="Password Minimum" help={`At least ${policy.password_min_floor} characters, the server's own limit. Applies to the next password each person chooses.`} {...mark("password_min_length")}>
          <NumberField value={v.password} onChange={(x) => (setV((o) => ({ ...o, password: x })), setErrors({}))} disabled={!canEdit} />
        </Field>
        {canEdit && (
          <FormFooter>
            <Button onClick={() => (setV(initial), setErrors({}), setTried(false))}>Undo Changes</Button>
            <Button variant="primary" type="submit" busy={save.pending}>
              Save Rules
            </Button>
          </FormFooter>
        )}
      </Form>
    </Card>
  );
}

/* ───────────── Two-step by role ───────────── */

function TwoStepRoles({ policy, canEdit }: { policy: SecurityPolicy; canEdit: boolean }) {
  const save = useMutation("PATCH /api/v1/settings/security");
  const confirm = useConfirm();
  const set = async (code: string, on: boolean) => {
    const role = policy.two_step_roles.find((r) => r.code === code)!;
    if (on && !(await confirm({ title: "Require Two-Step", body: `Everyone with ${role.name} sets it up at their next sign-in.`, confirmLabel: "Require Two-Step" }))) return;
    const codes = policy.two_step_roles.filter((r) => (r.code === code ? on : r.two_step_required)).map((r) => r.code);
    try {
      await save.run({ body: { two_step_roles: codes } });
      invalidate("/api/v1/settings/security");
      invalidate("/api/v1/settings/roles");
      toast(on ? `${role.name} now needs two-step` : `${role.name} no longer needs it`);
    } catch (e) {
      say(e);
    }
  };
  return (
    <Card>
      <CardHeader title="Two-Step by Role" help="A role that requires it makes each of its people set up two-step sign-in at their next sign-in. A passkey counts as both steps." />
      {policy.two_step_roles.map((r) => (
        <ToggleRow key={r.code} title={r.name} text={r.holders ? `${r.enrolled} of ${r.holders} set up` : "Nobody holds it"} checked={r.two_step_required} disabled={!canEdit || save.pending} onChange={(v) => void set(r.code, v)} />
      ))}
    </Card>
  );
}

/* ───────────── Live sessions ───────────── */

function Sessions({ canEdit }: { canEdit: boolean }) {
  const list = usePaged("GET /api/v1/settings/security/sessions");
  const end = useMutation("POST /api/v1/settings/security/sessions/:id/end");
  const confirm = useConfirm();
  const stop = async (s: LiveSession) => {
    if (!(await confirm({ title: "End Session", body: `${s.display_name} is signed out on ${s.device_label}.`, confirmLabel: "End Session", destructive: true }))) return;
    try {
      await end.run({ params: { id: s.session_id }, body: {} });
      invalidate("/api/v1/settings/security");
      toast(`${s.display_name} is signed out there`);
    } catch (e) {
      say(e);
    }
  };
  return (
    <DataView
      className="mt-3"
      title="Signed In"
      list={list}
      search="Name or device"
      rowKey={(s) => s.session_id}
      noun="session"
      columns={[
        { key: "who", label: "Person", render: (s) => <Who name={s.display_name} sub={s.email} /> },
        { key: "device", label: "Device", render: (s) => s.device_label },
        { key: "method", label: "Method", desktop: true, render: (s: LiveSession) => METHOD[s.method] },
        { key: "last_seen_at", label: "Last Active", sortable: true, render: (s) => formatWhen(s.last_seen_at) },
        { key: "address", label: "Address", desktop: true, render: (s) => s.ip_address },
        {
          key: "end",
          label: "",
          render: (s) =>
            s.current ? (
              <Pill tone="info">This Session</Pill>
            ) : canEdit ? (
              <Button size="sm" busy={end.pending} onClick={() => void stop(s)}>
                End Session
              </Button>
            ) : null,
        },
      ]}
    />
  );
}

/* ───────────── Failed sign-ins ───────────── */

function Failed() {
  const list = usePaged("GET /api/v1/settings/security/failed-logins");
  return (
    <DataView
      className="mt-3"
      title="Failed Sign-Ins"
      list={list}
      search="Email or address"
      rowKey={(f) => f.audit_ledger_id}
      noun="failed sign-in"
      empty={{ title: "No Failed Sign-Ins", icon: "shield" }}
      columns={[
        { key: "occurred_at", label: "When", sortable: true, render: (f) => formatDateTime(f.occurred_at) },
        { key: "email", label: "Email", render: (f) => f.email },
        { key: "who", label: "Person", desktop: true, render: (f) => f.display_name },
        { key: "reason", label: "Outcome", render: (f: FailedSignIn) => <Pill tone={REASON[f.reason].tone}>{REASON[f.reason].text}</Pill> },
        { key: "address", label: "Address", desktop: true, render: (f) => f.ip_address },
      ]}
    />
  );
}
