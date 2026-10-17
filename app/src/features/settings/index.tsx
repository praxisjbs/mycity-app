import { useEffect, useState } from "react";
import { ApiError, api } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/settings";
import "@/api/types/organisation";
import type { AuditEntry, FailedLogin, Hierarchy, Numbering, Organisation, Session } from "@/api/types/settings";
import type { UserRow } from "@mycity/contract/contract.gen.ts";
import { useAuth } from "@/auth/AuthProvider";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ExportAction, KvCard, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AttendancePolicyTab } from "./Policy";
import { Roles } from "./Roles";
import { Button, Card, CardHeader, Chain, Chips, ChoiceField, cn, DataView, Field, formatDate, formatDateTime, formatWhen, FormFooter, Grid, HelpTerm, Icon, InlineInput, LoadingRows, PageHeader, Paper, PaperFoot, PaperLogo, PaperTitle, Pill, Signature, StatStrip, StatusPill, Swatch, Switch, TextAreaField, toast, useConfirm, useModal, useTheme, Who } from "@mycity/ui";
import { InviteToSignIn } from "@/features/shared/InviteToSignIn";
import { RolePicker, type RoleRef } from "@/features/shared/pickers";
import { Imports } from "./Imports";

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
    case "security": return <Security />;
    case "audit-log": return <Audit />;
    case "imports":
      return <Imports />;
    default: return <OrganisationTab />;
  }
}

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : "Something went wrong");

/* ───────────── Organisation ───────────── */

function OrganisationTab() {
  const o = useApi("GET /api/v1/settings/organisation");
  const depts = useApi("GET /api/v1/departments", { query: {} });
  const [week, setWeek] = useState<Organisation["week"] | null>(null);
  const save = useMutation("PATCH /api/v1/settings/organisation");
  const d = o.data;
  if (!d) return (<><PageHeader title="Organisation" /><Card><LoadingRows count={8} /></Card></>);
  const w = week ?? d.week;
  const dirty = !!week && JSON.stringify(week) !== JSON.stringify(d.week);
  const edit = (i: number, patch: Partial<Organisation["week"][number]>) => setWeek(w.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <>
      <PageHeader
        title="Organisation"
        sub={d.legal_name}
        actions={dirty && <Button variant="primary" busy={save.pending} onClick={async () => { try { await save.run({ body: { week: w } }); invalidate("/api/v1/settings"); setWeek(null); toast("Working week saved. Attendance and payroll use it"); } catch (e) { fail(e); } }}>Save</Button>}
      />
      <Grid cols={2}>
        <KvCard title="Company" items={[["Legal name", d.legal_name], ["Trading name", d.trading_name], ["Country", d.country], ["Currency", d.currency], ["Time zone", d.time_zone], ["Financial year", d.financial_year]]} />
        <KvCard title="Departments" items={(depts.data?.data ?? []).map((x) => [x.name, `${x.headcount} staff`])} />
      </Grid>
      <Grid cols={2}>
        <KvCard title="Addresses" items={d.hosts.map(([k, v]) => [k, k.startsWith("Why") ? v : <code key={k} className="text-xs">{v}</code>])} />
        <KvCard title="System" items={d.about.map(([k, v]) => [k, v === "JBS Praxis" ? <a key={k} href="https://jbspraxis.com" target="_blank" rel="noopener noreferrer" className="font-strong text-accent-foreground">{v}</a> : v])} />
      </Grid>
      <DataView
        title="Working Week"
        right={<span className="text-2xs text-subtle-foreground">Per day, not a fixed pattern</span>}
        rows={w}
        rowKey={(r) => r.day}
        columns={[
          { key: "d", label: "Day", render: (r) => <b>{r.day}</b> },
          { key: "w", label: "Working", render: (r) => <Switch checked={r.working} label={`${r.day} is a working day`} onChange={(v) => edit(w.indexOf(r), { working: v, start: v ? r.start ?? "09:00" : null, end: v ? r.end ?? "17:00" : null, grace_min: v ? r.grace_min ?? 10 : null })} /> },
          { key: "s", label: "Start", render: (r) => (r.working ? <TimeBox value={r.start ?? ""} label={`${r.day} start`} onChange={(v) => edit(w.indexOf(r), { start: v })} /> : "None") },
          { key: "e", label: "End", render: (r) => (r.working ? <TimeBox value={r.end ?? ""} label={`${r.day} end`} onChange={(v) => edit(w.indexOf(r), { end: v })} /> : "None") },
          { key: "g", label: "Grace", render: (r) => (r.grace_min != null ? `${r.grace_min} min` : "None"), desktop: true },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <KvCard title={`Public Holidays, ${d.holidays[0]?.date.slice(0, 4) ?? ""}`} items={d.holidays.map((h) => [formatDate(h.date).slice(0, 5), h.name])} />
      </Grid>
    </>
  );
}

function TimeBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  const ok = /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  return <InlineInput aria-label={label} inputMode="numeric" className={cn("h-8 w-18 max-md:h-11 rounded-ctl border bg-background px-2 text-sm outline-none", ok ? "border-input focus:border-ring" : "border-destructive")} value={t} onChange={setT} onBlur={() => ok && t !== value && onChange(t)} />;
}

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
  const [status, setStatus] = useState<"" | UserRow["status"]>("");
  const s = useApi("GET /api/v1/users/summary");
  const list = usePaged("GET /api/v1/users", { filters: status ? { status } : {} });
  return (
    <>
      <PageHeader
        title="Users"
        sub={s.data ? `${s.data.users} users · ${s.data.invited} invited` : " "}
        actions={can("settings", "create") ? <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Invite User", body: (close) => <InviteToSignIn close={close} /> })}>Invite User</Button> : undefined}
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
          { key: "u", label: "User", render: (u) => <Who name={u.display_name} sub={u.email} /> },
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
        {!self && u.status === "invited" && <Button busy={resend.pending} onClick={() => void run(() => resend.run({ params, body: {} }), "Invitation sent again")}>Resend Invitation</Button>}
        {!self && u.status === "active" && <Button busy={reset.pending} onClick={() => void run(() => reset.run({ params, body: {} }), "Reset link sent")}>Send Reset Link</Button>}
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
        {!self && u.status !== "suspended" && !u.is_ceo && (reason == null ? <Button onClick={() => setReason("")}>Suspend</Button> : <Button variant="danger" busy={suspend.pending} onClick={() => (reasonBad ? setTried(true) : void run(() => suspend.run({ params, body: { reason: reason.trim() } }), "Login suspended"))}>Confirm Suspend</Button>)}
        {!self && u.status === "suspended" && <Button busy={reactivate.pending} onClick={() => void run(() => reactivate.run({ params, body: {} }), "Login reactivated")}>Reactivate</Button>}
        <Button onClick={close}>Close</Button>
        {!self && (
          <Button
            variant="primary"
            busy={setR.pending}
            onClick={() => (!roles.length ? setTried(true) : void run(() => setR.run({ params, body: { role_codes: roles.map((r) => r.code) } }), "Roles saved"))}
          >
            Save Roles
          </Button>
        )}
      </FormFooter>
    </>
  );
}

/* ───────────── Approvals ───────────── */

function Approvals() {
  const modal = useModal();
  const s = useApi("GET /api/v1/settings/approvals/summary");
  const list = usePaged("GET /api/v1/settings/approvals");
  const [sel, setSel] = useState<string | null>(null);
  const h = list.rows.find((x) => x.hierarchy_id === sel) ?? list.rows[0];
  return (
    <>
      <PageHeader title="Approvals" sub="Hierarchies as data. Changing one needs no deploy." />
      {s.data && <KpiTiles items={[{ label: "Hierarchies", value: String(s.data.hierarchies) }, { label: "Active", value: String(s.data.active), tone: "ok" }, { label: "Awaiting a Decision", value: String(s.data.awaiting), tone: s.data.awaiting ? "warn" : undefined }, { label: "Steps, Longest", value: String(s.data.longest) }]} />}
      <Grid cols={3}>
        {list.rows.map((x) => (
          <button key={x.hierarchy_id} type="button" onClick={() => setSel(x.hierarchy_id)} className={cn("rounded-box border bg-card p-3.5 text-left transition-shadow hover:shadow-2", x.hierarchy_id === h?.hierarchy_id ? "border-secondary ring-1 ring-secondary" : "border-border")}>
            <h2 data-copy="content" className="text-sm font-semibold">{x.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{x.description}</p>
            <div className="mt-2.5"><StatusPill s={x.status} /></div>
          </button>
        ))}
      </Grid>
      {h && (
        <Grid cols={2} className="mt-3">
          <Card>
            <CardHeader title={h.name} right={<StatusPill s={h.status} />} />
            <Chain steps={h.steps.map((label) => ({ label }))} />
            <dl className="mt-3.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm md:cols-term-value-tight md:gap-y-2">
              {[["Trigger", h.trigger], ["Steps", "Roles, not people. A role can be reassigned"], ["Deputies", h.deputies], ["Ageing", h.ageing], ["In-flight", "A request keeps the chain it started on, even if the hierarchy changes"]].map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-xs text-subtle-foreground">{k}</dt><dd className="font-semibold max-md:mb-2">{v}</dd></div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon="plus" onClick={() => modal.open({ title: `Steps · ${h.name}`, body: (close) => <EditSteps h={h} close={close} /> })}>Edit Steps</Button>
            </div>
          </Card>
        </Grid>
      )}
    </>
  );
}

function EditSteps({ h, close }: { h: Hierarchy; close: () => void }) {
  const [steps, setSteps] = useState(h.steps);
  const save = useMutation("PUT /api/v1/settings/approvals/:id/steps");
  const move = (i: number, d: number) => {
    const n = [...steps];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    setSteps(n);
  };
  return (
    <>
      <div className="flex flex-col gap-1.5">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <b className="w-5 text-xs text-subtle-foreground">{i + 1}</b>
            <InlineInput aria-label={`Step ${i + 1}`} className="h-9 min-w-0 flex-1 rounded-ctl border border-input bg-background px-3 text-sm outline-none focus:border-ring" value={s} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? v : x)))} />
            <Button size="sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><Icon name="up" /></Button>
            <Button size="sm" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><Icon name="up" className="rotate-180" /></Button>
            <Button size="sm" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Icon name="x" /></Button>
          </div>
        ))}
      </div>
      <Button size="sm" icon="plus" className="mt-2" onClick={() => setSteps([...steps, ""])}>Add a Step</Button>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={async () => { try { await save.run({ params: { id: h.hierarchy_id }, body: { steps } }); invalidate("/api/v1/settings/approvals"); close(); toast(`${h.name} updated`); } catch (e) { if (e instanceof ApiError && e.fields) toast(Object.values(e.fields)[0][0]); else fail(e); } }}>Save Steps</Button>
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

/* ───────────── Documents & numbering ───────────── */

function NumberingTab() {
  const s = useApi("GET /api/v1/settings/numbering/summary");
  const list = usePaged("GET /api/v1/settings/numbering");
  return (
    <>
      <PageHeader title="Documents & Numbering" sub="Reference formats and templates" />
      {s.data && <StatStrip items={[{ label: "Document Types", value: s.data.types }, { label: "Templates", value: s.data.templates }, { label: "Issued This Year", value: s.data.issued_this_year }, { label: "Signed", value: s.data.signed }, { label: "Format", value: "PREFIX-0000", desktop: true }]} />}
      <Grid cols="1/1.5">
        <PagedTable<Numbering>
          title="Numbering"
          list={list}
          rowKey={(n) => n.key}
          noun="document type"
          columns={[
            { key: "d", label: "Document", render: (n) => n.document },
            { key: "p", label: "Prefix", render: (n) => <b>{n.prefix}</b> },
            { key: "f", label: "Format", render: (n) => n.format, desktop: true },
            { key: "n", label: "Next", align: "n", render: (n) => n.next },
          ]}
        />
        <Paper note="Every document type has a template like this. The engine fills it, numbers it and hashes it.">
          <PaperLogo reference="MOU-0004" />
          <PaperTitle sub="Between MyCity App Ltd and MTN Nigeria Communications Plc · Executed 13/03/2025">Memorandum of Understanding</PaperTitle>
          <p><b>1. Purpose.</b> The parties record their intention to co-operate on the distribution and promotion of the MyCityApp platform across Nigerian cities.</p>
          <p><b>2. Term.</b> This memorandum takes effect on 13 March 2025 and continues for twenty-four months, expiring on 13 March 2027 unless renewed in writing.</p>
          <p><b>3. Consideration.</b> The commercial schedule is set out in Annexe A and carries a total value of ₦18,400,000.</p>
          <div className="mt-4.5 flex gap-7.5">
            <div><Signature>For MyCity</Signature><div className="mt-0.5 border-t border-paper-dash pt-1 text-2xs text-paper-faint">I. Chukwu · 13/03/2025</div></div>
            <div><Signature>For MTN</Signature><div className="mt-0.5 border-t border-paper-dash pt-1 text-2xs text-paper-faint">O. Adesanya · 02/04/2025</div></div>
          </div>
          <PaperFoot><span>Content hash verified</span><span>Artifact hash verified</span><span className="ml-auto">go.mycityapp.io/verify/MOU-0004</span></PaperFoot>
        </Paper>
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

/* ───────────── Security ───────────── */

function Security() {
  const s = useApi("GET /api/v1/settings/security");
  const sessions = usePaged("GET /api/v1/settings/security/sessions");
  const failed = usePaged("GET /api/v1/settings/security/failed-logins");
  const save = useMutation("PATCH /api/v1/settings/security");
  const d = s.data;
  return (
    <>
      <PageHeader title="Security" sub="Sessions, devices and access" />
      {d && <KpiTiles items={[{ label: "Active Sessions", value: String(d.active_sessions) }, { label: "MFA Enrolled", value: `${d.mfa_enrolled} of ${d.users}`, tone: "warn" }, { label: "Failed Logins, 7 Days", value: String(d.failed_7d) }, { label: "Devices", value: String(d.devices) }]} />}
      <Grid cols={2}>
        <Card>
          <CardHeader title="Policy" />
          {!d && <LoadingRows />}
          {d?.rules.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0">
              <div className="text-sm font-semibold">{r.label}</div>
              <Switch checked={r.on} label={r.label} disabled={save.pending} onChange={async (v) => { try { await save.run({ body: { [r.key]: v } }); invalidate("/api/v1/settings/security"); toast(`${r.label}: ${v ? "on" : "off"}`); } catch (e) { fail(e); } }} />
            </div>
          ))}
        </Card>
        <PagedTable<Session>
          title="Active Sessions"
          list={sessions}
          rowKey={(x) => x.session_id}
          noun="session"
          columns={[
            { key: "u", label: "User", render: (x) => <Who name={x.person.display_name} /> },
            { key: "d", label: "Device", render: (x) => x.device },
            { key: "s", label: "Started", render: (x) => formatWhen(x.started_at), desktop: true },
            { key: "e", label: "", render: (x) => <Button size="sm" onClick={async () => { await api.call("POST /api/v1/settings/security/sessions/:id/end", { params: { id: x.session_id }, body: {} }); invalidate("/api/v1/settings/security"); toast(`${x.person.display_name}'s session ends on their next request`); }}>End</Button> },
          ]}
        />
      </Grid>
      <Grid cols={2}>
        <PagedTable<FailedLogin>
          title="Failed Sign-Ins"
          right={<span className="text-2xs text-subtle-foreground">Last 7 days</span>}
          list={failed}
          rowKey={(x) => x.attempt_id}
          noun="attempt"
          columns={[
            { key: "w", label: "When", render: (x) => formatDateTime(x.at) },
            { key: "e", label: "Who", render: (x) => x.email },
            { key: "p", label: "From", render: (x) => x.place, desktop: true },
            { key: "o", label: "Outcome", render: (x) => <StatusPill s={x.outcome} /> },
          ]}
        />
      </Grid>
    </>
  );
}

/* ───────────── Audit log ───────────── */

function Audit() {
  const s = useApi("GET /api/v1/audit/summary");
  const [mod, setMod] = useState("");
  const list = usePaged("GET /api/v1/audit", { filters: mod ? { module: mod } : {} });
  const none = <span className="text-subtle-foreground">None</span>;
  return (
    <>
      <PageHeader title="Audit Log" sub="Append only. Nobody can edit this." actions={<ExportAction source="audit" filters={mod ? { module: mod } : {}} />} />
      {s.data && <KpiTiles items={[{ label: "Entries Today", value: String(s.data.today) }, { label: "This Month", value: s.data.this_month.toLocaleString("en-NG") }, { label: "Modules", value: String(s.data.modules.length) }, { label: "Retention", value: s.data.retention }]} />}
      {s.data && <Chips value={mod} onChange={setMod} options={[["", "Everything"], ...s.data.modules.map((m) => [m, m] as [string, string])]} />}
      <PagedTable<AuditEntry>
        title="Recent Entries"
        list={list}
        search="Search actor, action or record"
        rowKey={(a) => a.audit_id}
        noun="entry"
        nounPlural="entries"
        wide
        columns={[
          { key: "t", label: "Date and Time", render: (a) => formatDateTime(a.at) },
          { key: "a", label: "Actor", render: (a) => a.actor },
          { key: "x", label: "Action", render: (a) => <b>{a.action}</b> },
          { key: "e", label: "Entity", render: (a) => a.entity },
          { key: "b", label: "Before", render: (a) => a.before ?? none, desktop: true },
          { key: "f", label: "After", render: (a) => a.after ?? none, desktop: true },
          { key: "r", label: "Reason or Reference", render: (a) => a.reason ?? none, desktop: true },
          { key: "m", label: "Module", render: (a) => a.module },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Entries by Module" rows={s.data.by_module} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}
