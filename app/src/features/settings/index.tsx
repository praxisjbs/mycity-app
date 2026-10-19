import { useEffect, useState } from "react";
import { api, ApiError } from "@/api/client";
import { usePhotos } from "@/api/download";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/settings";
import type { UserRow } from "@mycity/contract/contract.gen.ts";
import { useAuth } from "@/auth/AuthProvider";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AttendancePolicyTab } from "./Policy";
import { AuditLog } from "./AuditLog";
import { NumberingTab } from "./Numbering";
import { OrganisationTab } from "./Organisation";
import { Roles } from "./Roles";
import { SecurityTab } from "./SecurityRules";
import { Button, Card, CardHeader, Chips, ChoiceField, DataView, Field, formatDateTime, formatWhen, FormFooter, Grid, HelpTerm, LoadingRows, PageHeader, Pill, StatusPill, Swatch, Switch, TextAreaField, toast, useConfirm, useModal, useTheme, Who } from "@mycity/ui";
import { InviteToSignIn } from "@/features/shared/InviteToSignIn";
import { RolePicker, type RoleRef } from "@/features/shared/pickers";
import { Imports } from "./Imports";
import { Approvals } from "./Approvals";
import { useScreenAction } from "@/shell/screen-action";
import { useSearchParams } from "@/lib/router";

export default function Settings({ tab }: ModuleScreenProps) {
  switch (tab) {
    case "users": return <Users />;
    case "roles-and-permissions": return <Roles />;
    case "approvals": return <Approvals />;
    case "attendance-policy": return <AttendancePolicyTab />;
    case "notifications": return <Notifications />;
    case "appearance": return <AppearanceTab />;
    case "documents-and-numbering": return <NumberingTab />;
    case "integrations": return <Integrations />;
    case "security": return <SecurityTab />;
    case "audit-log": return <AuditLog />;
    case "imports":
      return <Imports />;
    default: return <OrganisationTab />;
  }
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/* ───────────── Users ───────────── */


const USER_STATUS: Record<UserRow["status"], { tone: "ok" | "warn" | "err" | "neutral"; text: string }> = {
  active: { tone: "ok", text: "Active" },
  invited: { tone: "warn", text: "Invited" },
  suspended: { tone: "err", text: "Suspended" },
  left: { tone: "neutral", text: "Left" },
};

/**
 * Settings · Users: the logins. A person gets one from their employee record
 * (Invite User): they receive a link and choose their own password. Roles,
 * suspension, links and sessions are managed from a login's sheet; nobody acts
 * on their own login here (My Security is for that).
 */
function Users() {
  const modal = useModal();
  const { can } = useAuth();
  const invite = () => modal.open({ title: "Invite User", body: (close) => <InviteToSignIn close={close} /> });
  useScreenAction(can("settings", "create") ? { label: "Invite User", onSelect: invite } : null);
  // A login linked by id (a role's People on Roles & Permissions, a search result) opens its sheet.
  const [params, setParams] = useSearchParams();
  const linked = params.get("id");
  useEffect(() => {
    if (!linked) return;
    let gone = false;
    api
      .call("GET /api/v1/users/:id", { params: { id: linked } })
      .then((u) => {
        if (!gone) modal.open({ title: u.display_name, body: (close) => <UserDetail u={u} close={close} />, onClose: () => setParams({ id: null }, { replace: true }) });
      })
      .catch(fail);
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per linked login
  }, [linked]);
  const [status, setStatus] = useState<"" | UserRow["status"]>("");
  const s = useApi("GET /api/v1/users/summary");
  const list = usePaged("GET /api/v1/users", { filters: status ? { status } : {} });
  const photo = usePhotos(list.rows.map((u) => u.photo_url));
  return (
    <>
      <PageHeader
        title="Users"
        sub={s.data ? `${s.data.users} users · ${s.data.invited} invited` : " "}
        actions={can("settings", "create") ? <Button variant="primary" icon="plus" onClick={invite}>Invite User</Button> : undefined}
      />
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Users", value: String(s.data.users) },
            { label: "Signed In Now", value: String(s.data.signed_in_now), tone: "ok" },
            { label: "Invited", value: String(s.data.invited), tone: s.data.invited ? "warn" : undefined },
            { label: "Suspended", value: String(s.data.suspended), tone: s.data.suspended ? "err" : undefined },
          ]}
        />
      )}
      <Chips
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: "", label: "Everyone" },
          { value: "active", label: "Active", count: s.data?.active },
          { value: "invited", label: "Invited", count: s.data?.invited },
          { value: "suspended", label: "Suspended", count: s.data?.suspended },
        ]}
      />
      <PagedTable<UserRow>
        title="Users"
        list={list}
        search="Name or email"
        rowKey={(u) => u.user_id}
        noun="user"
        onRowClick={(u) => modal.open({ title: u.display_name, body: (close) => <UserDetail u={u} close={close} /> })}
        columns={[
          { key: "u", label: "User", render: (u) => <Who name={u.display_name} sub={u.email} src={photo(u.photo_url)} /> },
          { key: "r", label: "Roles", render: (u) => (u.is_ceo ? ["CEO", ...u.roles.map((r) => r.name)] : u.roles.map((r) => r.name)).join(", ") },
          { key: "l", label: "Last Seen", render: (u) => (u.last_seen_at ? formatWhen(u.last_seen_at) : "Never"), desktop: true },
          { key: "t", label: "Two-Step", render: (u) => (u.two_step ? "On" : "Off"), desktop: true },
          { key: "s", label: "Status", render: (u) => <Pill tone={USER_STATUS[u.status].tone}>{USER_STATUS[u.status].text}</Pill> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? (
          <BarsCard
            title="Users by Role"
            rows={s.data.by_role.map((r) => ({ label: r.name, value: String(r.users), pct: Math.round((r.users * 100) / Math.max(1, ...s.data!.by_role.map((x) => x.users))) }))}
          />
        ) : (
          <Card><LoadingRows /></Card>
        )}
      </Grid>
    </>
  );
}

function UserDetail({ u, close }: { u: UserRow; close: () => void }) {
  const { me } = useAuth();
  const confirm = useConfirm();
  const [roles, setRoles] = useState<RoleRef[]>(u.roles);
  const [reason, setReason] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const setR = useMutation("POST /api/v1/users/:id/roles");
  const suspend = useMutation("POST /api/v1/users/:id/suspend");
  const reactivate = useMutation("POST /api/v1/users/:id/reactivate");
  const resend = useMutation("POST /api/v1/users/:id/invite");
  const reset = useMutation("POST /api/v1/users/:id/reset-link");
  const end = useMutation("POST /api/v1/users/:id/end-sessions");
  const resetTwoStep = useMutation("POST /api/v1/users/:id/reset-two-step");
  const fresh = useFreshSignIn();
  const self = me?.user_id === u.user_id;
  const reasonBad = reason != null && reason.trim().length < 6;
  const params = { id: u.user_id };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      invalidate("/api/v1/users");
      close();
      toast(msg);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <Field label="Roles" state={tried && !roles.length ? "bad" : undefined} message="Pick a role">
        {self ? <span className="text-sm">{u.roles.map((r) => r.name).join(", ")}</span> : <RolePicker value={roles} onChange={setRoles} />}
      </Field>
      {reason != null && (
        <Field label="Reason" state={tried && reasonBad ? "bad" : undefined} message="At least 6 characters">
          <TextAreaField value={reason} onChange={setReason} placeholder="Left the company" state={tried && reasonBad ? "bad" : undefined} />
        </Field>
      )}
      <FormFooter>
        {!self && u.status === "invited" && <Button busy={resend.pending} onClick={() => run(() => resend.run({ params, body: {} }), "Invitation sent again")}>Resend Invitation</Button>}
        {!self && u.status === "active" && <Button busy={reset.pending} onClick={() => run(() => reset.run({ params, body: {} }), "Reset link sent")}>Send Reset Link</Button>}
        {!self && u.status === "active" && (
          <Button
            busy={end.pending}
            onClick={async () => {
              if (await confirm({ title: "Sign Out Everywhere", confirmLabel: "Sign Out" })) await run(() => end.run({ params, body: {} }), "Signed out everywhere");
            }}
          >
            Sign Out Everywhere
          </Button>
        )}
        {!self && u.two_step && (
          <Button
            busy={resetTwoStep.pending}
            onClick={async () => {
              if (!(await confirm({ title: "Reset Two-Step", body: `${u.display_name} sets up their authenticator app again, and is signed out now.`, confirmLabel: "Reset Two-Step", destructive: true }))) return;
              try {
                if (!(await fresh.guard(() => resetTwoStep.run({ params, body: {} })))) return;
                invalidate("/api/v1/users");
                close();
                toast("Two-step reset, signed out everywhere");
              } catch (e) {
                fail(e);
              }
            }}
          >
            Reset Two-Step
          </Button>
        )}
        {!self && u.status !== "suspended" && !u.is_ceo && (reason == null ? <Button onClick={() => setReason("")}>Suspend</Button> : <Button variant="danger" busy={suspend.pending} onClick={() => (reasonBad ? setTried(true) : run(() => suspend.run({ params, body: { reason: reason.trim() } }), "Login suspended"))}>Confirm Suspend</Button>)}
        {!self && u.status === "suspended" && <Button busy={reactivate.pending} onClick={() => run(() => reactivate.run({ params, body: {} }), "Login reactivated")}>Reactivate</Button>}
        <Button onClick={close}>Close</Button>
        {!self && (
          <Button
            variant="primary"
            busy={setR.pending}
            onClick={() => (!roles.length ? setTried(true) : run(() => setR.run({ params, body: { role_codes: roles.map((r) => r.code) } }), "Roles saved"))}
          >
            Save Roles
          </Button>
        )}
      </FormFooter>
    </>
  );
}

/* ───────────── Notifications ───────────── */

function Notifications() {
  const n = useApi("GET /api/v1/settings/notifications");
  const save = useMutation("PATCH /api/v1/settings/notifications");
  const set = async (key: string, v: { in_app: boolean; email: boolean }) => {
    try {
      await save.run({ body: { [key]: v } });
      invalidate("/api/v1/settings/notifications");
    } catch (e) {
      fail(e);
    }
  };
  const rows = n.data ?? [];
  return (
    <>
      <PageHeader title="Notifications" sub="Per category and transport, saved as you change" />
      <Grid cols={2}>
        {(["email", "in_app"] as const).map((t) => (
          <Card key={t}>
            <CardHeader title={t === "email" ? "Email" : "Push and In App"} />
            {!n.data && <LoadingRows />}
            {rows.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
                <div className="text-sm font-semibold">{r.help ? <HelpTerm help={r.help}>{r.label}</HelpTerm> : r.label}</div>
                <Switch checked={r[t]} disabled={r.locked || save.pending} label={`${r.label}, ${t === "email" ? "email" : "in app"}`} onChange={(v) => void set(r.key, { in_app: r.in_app, email: r.email, [t]: v })} />
              </div>
            ))}
          </Card>
        ))}
      </Grid>
      <Grid cols={2}>
        <DataView
          title="Every Category"
          rows={rows}
          rowKey={(r) => r.key}
          columns={[
            { key: "c", label: "Category", render: (r) => r.label },
            { key: "i", label: "In App", render: (r) => <Pill tone={r.in_app ? "ok" : "neutral"}>{r.in_app ? "On" : "Off"}</Pill> },
            { key: "e", label: "Email", render: (r) => <Pill tone={r.email ? "ok" : "neutral"}>{r.email ? "On" : "Off"}</Pill> },
            { key: "w", label: "Who Sets It", render: (r) => (r.locked ? "Locked on" : "You") },
          ]}
        />
      </Grid>
    </>
  );
}

/* ───────────── Appearance ───────────── */

/** The value of a design token as the stylesheet resolves it now. */
function useTokenValues(tokens: string[], theme: string) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const key = tokens.join(",");
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    setVals(Object.fromEntries(key.split(",").map((t) => [t, cs.getPropertyValue(t).trim().toUpperCase()])));
  }, [key, theme]);
  return vals;
}

function AppearanceTab() {
  const a = useApi("GET /api/v1/settings/appearance");
  const save = useMutation("PATCH /api/v1/settings/appearance");
  const { theme } = useTheme();
  const { can } = useAuth();
  const d = a.data;
  const vals = useTokenValues([...(d?.palette ?? []), ...(d?.dark ?? [])].map((x) => x.token), String(theme));
  if (!d) return (<><PageHeader title="Appearance" /><Card><LoadingRows count={6} /></Card></>);
  return (
    <>
      <PageHeader title="Appearance" sub="MyCityApp brand" />
      <Grid cols={2}>
        <Card>
          <CardHeader title="Palette" />
          {d.palette.map((c) => (
            <div key={c.name} data-copy="content" className="flex items-center gap-2.5 py-1.5">
              <Swatch token={c.token} />
              <div className="flex-1"><div className="text-sm font-semibold">{c.name}</div><div className="text-2xs text-subtle-foreground">{vals[c.token]}</div></div>
            </div>
          ))}
        </Card>
        <Card>
          <CardHeader title="Typography and Theme" />
          <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm md:cols-term-value md:gap-y-2">
            {[["Typeface", d.typeface], ["Money figures", "Tabular figures, 2dp"], ["Dates", "Day first, 09/10/2026"], ["Logo", "MyCityApp lockup"], ["Favicon", "Map pin mark"]].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-xs text-subtle-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-1.5 text-xs text-subtle-foreground">Default theme for everyone</div>
            <ChoiceField value={d.theme_default} onChange={async (v) => { if (!can("settings", "edit")) return toast("Only Operations and the CEO set the default"); await save.run({ body: { theme_default: v } }); invalidate("/api/v1/settings/appearance"); toast("Default theme saved"); }} options={[["system", "Follow the Device"], ["light", "Light"], ["dark", "Dark"]]} />
          </div>
        </Card>
      </Grid>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Dark Theme" />
          {d.dark.map((r) => (
            <div key={r.name} className="flex items-center gap-2.5 border-b border-border py-1.5 last:border-b-0">
              <Swatch token={r.token} size="sm" />
              <span className="min-w-0 flex-1 text-xs font-semibold">{r.name} <span className="font-normal text-subtle-foreground">{vals[r.token]}</span></span>
              <span className="flex-none text-2xs text-subtle-foreground">{r.note}</span>
            </div>
          ))}
        </Card>
      </Grid>
    </>
  );
}

/* ───────────── Integrations ───────────── */

function Integrations() {
  const i = useApi("GET /api/v1/settings/integrations");
  const d = i.data;
  const count = (t: string) => d?.items.filter((x) => x.status.text === t).length ?? 0;
  return (
    <>
      <PageHeader title="Integrations" sub="Connected services" />
      {d && <KpiTiles items={[{ label: "Connected", value: String(count("Connected")) }, { label: "Manual", value: String(count("Manual")) }, { label: "Not in Scope", value: String(count("Not connected")) }, { label: "Failures, 7 Days", value: String(d.health.reduce((a, h) => a + h.failures, 0)), tone: "ok" }]} />}
      <Grid cols={3}>
        {(d?.items ?? []).map((x) => (
          <div key={x.key} className="rounded-box border border-border bg-card p-3.5">
            <h2 data-copy="content" className="text-sm font-semibold">{x.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{x.text}</p>
            <div className="mt-2.5"><StatusPill s={x.status} /></div>
          </div>
        ))}
      </Grid>
      <Grid cols={2} className="mt-3">
        <DataView
          title="Health"
          right={<span className="text-2xs text-subtle-foreground">Last 7 days</span>}
          rows={d?.health ?? []}
          rowKey={(h) => h.service}
          loading={i.loading}
          columns={[
            { key: "s", label: "Service", render: (h) => h.service },
            { key: "l", label: "Last Call", render: (h) => (h.last_call ? formatDateTime(h.last_call) : "Never") },
            { key: "v", label: "Volume, 7d", align: "n", render: (h) => h.volume_7d.toLocaleString("en-NG") },
            { key: "f", label: "Failures", align: "n", render: (h) => h.failures },
            { key: "st", label: "Status", render: (h) => <StatusPill s={h.status} /> },
          ]}
        />
      </Grid>
    </>
  );
}
