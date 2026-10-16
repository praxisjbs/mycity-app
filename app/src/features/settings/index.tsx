import { useEffect, useState } from "react";
import { ApiError, api } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/settings";
import "@/api/types/organisation";
import type { AuditEntry, FailedLogin, Hierarchy, Numbering, Organisation, Session, UserRow } from "@/api/types/settings";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, ExportAction, KvCard, PagedTable } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AttendancePolicyTab } from "./Policy";
import { Roles, useRoleOptions } from "./Roles";
import { Button, Card, CardHeader, Chain, Chips, ChoiceField, cn, DataView, Field, formatDate, formatDateTime, formatWhen, FormFooter, Grid, HelpTerm, Icon, InlineInput, LoadingRows, PageHeader, Paper, PaperFoot, PaperLogo, PaperTitle, Pill, SelectField, Signature, StatStrip, StatusPill, Switch, TextAreaField, toast, useModal, useTheme, Who } from "@mycity/ui";
import { EmployeePicker } from "@/features/shared/pickers";

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
        <KvCard title="Addresses" items={d.hosts.map(([k, v]) => [k, k.startsWith("Why") ? v : <code key={k} className="text-[12px]">{v}</code>])} />
        <KvCard title="System" items={d.about.map(([k, v]) => [k, v === "JBS Praxis" ? <a key={k} href="https://jbspraxis.com" target="_blank" rel="noopener noreferrer" className="font-[650] text-accent-foreground">{v}</a> : v])} />
      </Grid>
      <DataView
        title="Working Week"
        right={<span className="text-[11.5px] text-subtle-foreground">Per day, not a fixed pattern</span>}
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
  return <InlineInput aria-label={label} inputMode="numeric" className={cn("h-8 w-[70px] max-md:h-11 rounded-ctl border bg-background px-2 text-[13px] outline-none", ok ? "border-input focus:border-ring" : "border-destructive")} value={t} onChange={setT} onBlur={() => ok && t !== value && onChange(t)} />;
}

/* ───────────── Users ───────────── */


function Users() {
  const modal = useModal();
  const s = useApi("GET /api/v1/settings/users/summary");
  const list = usePaged("GET /api/v1/settings/users");
  return (
    <>
      <PageHeader
        title="Users"
        sub={s.data ? `${s.data.users} users · ${s.data.pending} pending invitation` : " "}
        actions={
          <>
            <ExportAction source="settings.users" />
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Invite User", body: (close) => <Invite close={close} /> })}>Invite User</Button>
          </>
        }
      />
      {s.data && <KpiTiles items={[{ label: "Users", value: String(s.data.users) }, { label: "Active Now", value: String(s.data.active_now) }, { label: "Pending Invitation", value: String(s.data.pending), tone: s.data.pending ? "warn" : undefined }, { label: "MFA Enrolled", value: String(s.data.mfa), tone: "warn" }]} />}
      <PagedTable<UserRow>
        title="Users"
        list={list}
        search="Search name, email or role"
        rowKey={(u) => u.user_id}
        noun="user"
        onRowClick={(u) => modal.open({ title: u.person.display_name, body: (close) => <UserDetail u={u} close={close} /> })}
        columns={[
          { key: "u", label: "User", render: (u) => <Who name={u.person.display_name} sub={u.email} /> },
          { key: "r", label: "Role", render: (u) => u.role },
          { key: "l", label: "Last Seen", render: (u) => (u.last_seen ? formatWhen(u.last_seen) : "Never"), desktop: true },
          { key: "m", label: "MFA", render: (u) => <Pill tone={u.mfa ? "ok" : "neutral"}>{u.mfa ? "On" : "Off"}</Pill>, desktop: true },
          { key: "s", label: "Status", render: (u) => <StatusPill s={u.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {s.data ? <BarsCard title="Users by Role" rows={s.data.by_role} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

function UserDetail({ u, close }: { u: UserRow; close: () => void }) {
  const roles = useRoleOptions();
  const [role, setRole] = useState(u.role);
  const [reason, setReason] = useState<string | null>(null);
  const [tried, setTried] = useState<"role" | "disable" | null>(null);
  const reasonBad = reason != null && reason.trim().length < 6;
  const setR = useMutation("POST /api/v1/settings/users/:id/role");
  const disable = useMutation("POST /api/v1/settings/users/:id/disable");
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      invalidate("/api/v1/settings/users");
      close();
      toast(msg);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <>
      <Field label="Role" state={tried === "role" && role === u.role ? "bad" : undefined} message="Pick another role"><SelectField value={role} onChange={setRole} options={roles} /></Field>
      {reason != null && (
        <Field label="Why the Login Is Disabled" state={tried === "disable" && reasonBad ? "bad" : undefined} message="At least 6 characters">
          <TextAreaField value={reason} onChange={setReason} placeholder="Role changed" state={tried === "disable" && reasonBad ? "bad" : undefined} />
        </Field>
      )}
      <FormFooter>
        {u.status.text !== "Disabled" && (reason == null ? <Button className="mr-auto" onClick={() => setReason("")}>Disable Login</Button> : <Button className="mr-auto" busy={disable.pending} onClick={() => (reasonBad ? setTried("disable") : run(() => disable.run({ params: { id: u.user_id }, body: { reason } }), "Login disabled"))}>Confirm Disable</Button>)}
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={setR.pending} onClick={() => (role === u.role ? setTried("role") : run(() => setR.run({ params: { id: u.user_id }, body: { role } }), `${u.person.display_name} is now ${role}`))}>Save Role</Button>
      </FormFooter>
    </>
  );
}

function Invite({ close }: { close: () => void }) {
  const roles = useRoleOptions();
  const [who, setWho] = useState<PersonRef[]>([]);
  const [role, setRole] = useState("Staff");
  const [tried, setTried] = useState(false);
  const inv = useMutation("POST /api/v1/settings/users/invite");
  return (
    <>
      <Field label="Employee" state={tried && !who.length ? "bad" : undefined} message="Pick the employee"><EmployeePicker value={who} onChange={setWho} /></Field>
      <Field label="Role"><SelectField value={role} onChange={setRole} options={roles} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" busy={inv.pending} onClick={async () => { if (!who.length) return setTried(true); try { await inv.run({ body: { employee_id: who[0].employee_id, role } }); invalidate("/api/v1/settings/users"); close(); toast(`Invitation sent to ${who[0].display_name}`); } catch (e) { fail(e); } }}>Send Invitation</Button>
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
          <button key={x.hierarchy_id} type="button" onClick={() => setSel(x.hierarchy_id)} className={cn("rounded-box border bg-card p-[14px] text-left transition-shadow hover:shadow-2", x.hierarchy_id === h?.hierarchy_id ? "border-secondary shadow-[0_0_0_1px_var(--secondary)]" : "border-border")}>
            <h2 data-copy="content" className="text-[13.5px] font-semibold">{x.name}</h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{x.description}</p>
            <div className="mt-2.5"><StatusPill s={x.status} /></div>
          </button>
        ))}
      </Grid>
      {h && (
        <Grid cols={2} className="mt-3">
          <Card>
            <CardHeader title={h.name} right={<StatusPill s={h.status} />} />
            <Chain steps={h.steps.map((label) => ({ label }))} />
            <dl className="mt-3.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[13px] md:grid-cols-[118px_minmax(0,1fr)] md:gap-y-[9px]">
              {[["Trigger", h.trigger], ["Steps", "Roles, not people. A role can be reassigned"], ["Deputies", h.deputies], ["Ageing", h.ageing], ["In-flight", "A request keeps the chain it started on, even if the hierarchy changes"]].map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-[12px] text-subtle-foreground">{k}</dt><dd className="font-[550] max-md:mb-2">{v}</dd></div>
              ))}
            </dl>
            <div className="mt-[13px] flex flex-wrap gap-2">
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
            <b className="w-5 text-[12px] text-subtle-foreground">{i + 1}</b>
            <InlineInput aria-label={`Step ${i + 1}`} className="h-9 min-w-0 flex-1 rounded-ctl border border-input bg-background px-3 text-[13px] outline-none focus:border-ring" value={s} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? v : x)))} />
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
                <div className="text-[13px] font-[550]">{r.help ? <HelpTerm help={r.help}>{r.label}</HelpTerm> : r.label}</div>
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
            <div key={c.name} data-copy="content" className="flex items-center gap-[11px] py-[7px]">
              <i className="size-[30px] flex-none rounded-lg border border-border" style={{ background: `var(${c.token})` }} />
              <div className="flex-1"><div className="text-[13px] font-[550]">{c.name}</div><div className="text-[11.5px] text-subtle-foreground">{vals[c.token]}</div></div>
            </div>
          ))}
        </Card>
        <Card>
          <CardHeader title="Typography and Theme" />
          <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-[13px] md:grid-cols-[minmax(0,160px)_minmax(0,1fr)] md:gap-y-[9px]">
            {[["Typeface", d.typeface], ["Money figures", "Tabular figures, 2dp"], ["Dates", "Day first, 09/10/2026"], ["Logo", "MyCityApp lockup"], ["Favicon", "Map pin mark"]].map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-[12px] text-subtle-foreground">{k}</dt><dd className="font-[550]">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-1.5 text-[12px] text-subtle-foreground">Default theme for everyone</div>
            <ChoiceField value={d.theme_default} onChange={async (v) => { if (!can("settings", "edit")) return toast("Only Operations and the CEO set the default"); await save.run({ body: { theme_default: v } }); invalidate("/api/v1/settings/appearance"); toast("Default theme saved"); }} options={[["system", "Follow the Device"], ["light", "Light"], ["dark", "Dark"]]} />
          </div>
        </Card>
      </Grid>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Dark Theme" />
          {d.dark.map((r) => (
            <div key={r.name} className="flex items-center gap-[11px] border-b border-border py-1.5 last:border-b-0">
              <i className="size-6 flex-none rounded-[7px] border border-border" style={{ background: `var(${r.token})` }} />
              <span className="min-w-0 flex-1 text-[12.5px] font-[550]">{r.name} <span className="font-normal text-subtle-foreground">{vals[r.token]}</span></span>
              <span className="flex-none text-[11.5px] text-subtle-foreground">{r.note}</span>
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
          <div className="mt-[18px] flex gap-[30px]">
            <div><Signature>For MyCity</Signature><div className="mt-0.5 border-t border-paper-dash pt-1 text-[10px] text-paper-faint">I. Chukwu · 13/03/2025</div></div>
            <div><Signature>For MTN</Signature><div className="mt-0.5 border-t border-paper-dash pt-1 text-[10px] text-paper-faint">O. Adesanya · 02/04/2025</div></div>
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
          <div key={x.key} className="rounded-box border border-border bg-card p-[14px]">
            <h2 data-copy="content" className="text-[13.5px] font-semibold">{x.name}</h2>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{x.text}</p>
            <div className="mt-2.5"><StatusPill s={x.status} /></div>
          </div>
        ))}
      </Grid>
      <Grid cols={2} className="mt-3">
        <DataView
          title="Health"
          right={<span className="text-[11.5px] text-subtle-foreground">Last 7 days</span>}
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
              <div className="text-[13px] font-[550]">{r.label}</div>
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
          right={<span className="text-[11.5px] text-subtle-foreground">Last 7 days</span>}
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
