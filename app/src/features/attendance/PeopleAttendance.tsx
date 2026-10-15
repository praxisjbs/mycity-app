import { useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import type { FieldAssignment, LocationRequest, ReconCase, RegisterRow } from "@/api/types/attendance";
import { useMe } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { AreaChart, Donut } from "@/components/ui/charts";
import { Banner, EmptyState, KV, Pill, StatStrip, Who } from "@/components/ui/data";
import { InfoButton, InfoText, useInfo } from "@/components/ui/Info";
import { Card, CardHeader, Grid, MobileOnly, DesktopOnly } from "@/components/ui/layout";
import { Grow, useModal } from "@/components/ui/Modal";
import { BackButton } from "@/components/ui/Profile";
import { Chips, ErrorBlock, LoadingRows, Pager, Table, Toolbar } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { useSearchParams } from "@/lib/router";
import { DateField, Field, FormRow, Input, PersonPicker, rules, SearchBox, Seg, Select, Textarea, useForm } from "@/components/form";

type View = "register" | "assignments" | "requests" | "manager";
const VIEWS: Array<[View, string]> = [["register", "Register"], ["assignments", "Field Assignments"], ["requests", "Location Requests"], ["manager", "Manager Preview"]];

/**
 * People · Attendance. People and HR see the whole register; a line manager
 * sees only their direct reports (the same data, narrower scope).
 */
export function PeopleAttendance() {
  const me = useMe();
  const hr = !!me.grants.people?.includes("edit");
  const [params, setParams] = useSearchParams();
  const view = (hr ? (params.get("view") as View | "reconcile" | null) : "manager") ?? "register";
  const summary = useApi("GET /api/v1/attendance/summary", { query: { scope: hr ? "all" : "team" } });
  const info = useInfo();
  const modal = useModal();

  if (view === "reconcile") return <Reconcile onBack={() => setParams({ view: null })} />;
  const recon = summary.data?.kpis.find((k) => k.key === "recon")?.value ?? "0";
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 max-md:items-start">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5">
            <h1 className="text-[20px]">Attendance</h1>
            <InfoButton {...info} label="About attendance" />
          </span>
          <p className="mt-[3px] text-[13px] text-muted-foreground">{summary.data ? `${formatDate(summary.data.date)} · Africa/Lagos · ${hr ? "the whole organisation" : "your team"}` : " "}</p>
        </div>
        {hr && (
          <div className="flex flex-wrap gap-2 md:ml-auto max-md:w-full max-md:[&>button]:flex-1">
            <Button icon="plus" onClick={() => modal.open({ title: "Add Field Assignment", wide: true, body: (close) => <AssignmentForm close={close} /> })}>Field Assignment</Button>
            <Button variant="primary" icon="check" onClick={() => setParams({ view: "reconcile" })}>
              Reconcile <span className="rounded-full bg-on-primary-badge px-[7px] text-[11px]">{recon}</span>
            </Button>
          </div>
        )}
      </div>
      <InfoText {...info}>
        Every figure here is computed from clock events. Reconcile fixes what the record should say and never edits a punch. Possible policy breaches go to Queries & Sanctions, which is separate.
      </InfoText>
      {summary.error && <ErrorBlock error={summary.error} onRetry={summary.reload} />}
      {summary.data && hr && (
        <>
          <KpiTiles items={summary.data.kpis.slice(0, 4)} mobileCols={2} />
          <KpiTiles items={summary.data.kpis.slice(4)} mobileCols={2} />
          <div className="no-scrollbar mb-3 max-w-[640px] overflow-x-auto max-md:max-w-none">
            <Seg value={view} onChange={(v) => setParams({ view: v === "register" ? null : v })} options={VIEWS} />
          </div>
        </>
      )}
      {view === "register" && hr && <Register />}
      {view === "assignments" && <Assignments />}
      {view === "requests" && <Requests />}
      {(view === "manager" || !hr) && <ManagerView />}
    </>
  );
}

function Register() {
  const summary = useApi("GET /api/v1/attendance/summary", { query: { scope: "all" } });
  const [filter, setFilter] = useState("all");
  const list = usePaged("GET /api/v1/attendance/register", { filters: filter === "all" ? {} : { filter } });
  const modal = useModal();
  const open = (r: RegisterRow) => modal.open({ title: `${r.employee.display_name} · Today`, wide: true, body: <DayDetailView id={r.employee.employee_id} /> });
  const s = summary.data;
  return (
    <>
      {s && (
        <Grid cols="1.4/1">
          <AreaChart title="Clocked In by Hour, Today" values={s.hours} labels={["07", "08", "09", "10", "11", "12", "13", "14", "15", "16"]} note="From 07:00, cumulative. The grace period closes at 09:10." />
          <Donut pct={s.on_time_pct} label="clocked in" text={s.donut_text} />
        </Grid>
      )}
      <Toolbar>
        <SearchBox value={list.q} onChange={list.setQ} placeholder="Name or location" className="w-full md:w-[260px]" />
      </Toolbar>
      {s && <Chips value={filter} onChange={setFilter} options={[["all", `All ${s.kpis[0].value.split(" / ")[1]}`], ...s.filters.map((f) => [f.value, `${f.label} ${f.count}`] as [string, string])]} />}
      <DesktopOnly>
        <Table
          title="Today’s Register"
          right={<span className="text-[11.5px] text-subtle-foreground">Click a row for every recorded field</span>}
          wide
          rows={list.rows}
          rowKey={(r) => r.employee.employee_id}
          loading={list.loading}
          error={list.error}
          onRowClick={open}
          empty={{ icon: "srch", title: "Nobody matches this filter", text: "Choose All to see the whole register." }}
          columns={[
            { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} /> },
            { key: "a", label: "Arrangement", render: (r) => <Pill>{r.arrangement}</Pill> },
            { key: "i", label: "Clock In", render: (r) => r.clock_in ?? <span className="text-subtle-foreground">None</span> },
            { key: "o", label: "Clock Out", render: (r) => r.clock_out ?? <span className="text-subtle-foreground">None</span> },
            { key: "x", label: "Expected Location", render: (r) => r.expected_location },
            { key: "m", label: "Actual or Matched Location", render: (r) => r.matched_location ?? "Not yet" },
            { key: "d", label: "Device", render: (r) => (r.device ? <>{r.device}<br />{r.device_status && <Pill tone={r.device_status.tone}>{r.device_status.text}</Pill>}</> : <span className="text-subtle-foreground">None</span>) },
            { key: "s", label: "Status", render: (r) => <Pill tone={r.status.tone}>{r.status.text}</Pill> },
            { key: "c", label: "Exception", render: (r) => (<>{r.exception && <span className="inline-block max-w-[240px] truncate align-bottom" title={r.exception}>{r.exception}</span>} {r.case_number && <Pill tone="warn">{r.case_number}</Pill>}{!r.exception && !r.case_number && <span className="text-subtle-foreground">None</span>}</>) },
          ]}
          footer={<Pager page={list.page} onPage={list.setPage} noun="person" nounPlural="people" />}
        />
      </DesktopOnly>
      <MobileOnly>
        <div className="grid gap-2.5">
          {list.rows.map((r) => (
            <button key={r.employee.employee_id} type="button" onClick={() => open(r)} className="block w-full rounded-card border border-border bg-card p-[13px] text-left shadow-1">
              <span className="mb-2.5 flex items-start justify-between gap-2.5">
                <Who name={r.employee.display_name} sub={r.employee.department} />
                <Pill tone={r.status.tone}>{r.status.text}</Pill>
              </span>
              <span className="mb-2.5 block"><Pill>{r.arrangement}</Pill></span>
              <span className="flex gap-2.5 border-y border-border py-2.5">
                <span className="min-w-0 flex-1"><small className="mb-[3px] block text-[9.5px] font-[650] tracking-[.08em] text-subtle-foreground uppercase">Clock in</small><span className="block text-[14px] font-[650]">{r.clock_in ?? "None"}</span></span>
                <span className="min-w-0 flex-1"><small className="mb-[3px] block text-[9.5px] font-[650] tracking-[.08em] text-subtle-foreground uppercase">Clock out</small><span className="block text-[14px] font-[650]">{r.clock_out ?? "None"}</span></span>
              </span>
              <span className="flex gap-2.5 pt-2.5 text-[12px] leading-snug">
                <span className="min-w-0 flex-1"><small className="mb-[3px] block text-[9.5px] font-[650] tracking-[.08em] text-subtle-foreground uppercase">Expected</small>{r.expected_location}</span>
                <span className="min-w-0 flex-1"><small className="mb-[3px] block text-[9.5px] font-[650] tracking-[.08em] text-subtle-foreground uppercase">Matched</small>{r.matched_location ?? "Not yet"}</span>
              </span>
              <span className="mt-[9px] flex flex-wrap gap-2.5 border-t border-border pt-[9px] text-[11.5px] text-muted-foreground">
                <span>{r.device ? `Device: ${r.device}` : "No device recorded"}</span>
                <span>{r.case_number ? `Review ${r.case_number}` : (r.exception ?? "No exception")}</span>
              </span>
            </button>
          ))}
          {list.rows.length === 0 && !list.loading && <EmptyState icon="srch" title="Nobody matches this filter" text="Choose All to see the whole register." />}
          <Pager page={list.page} onPage={list.setPage} noun="person" nounPlural="people" className="px-0" />
        </div>
      </MobileOnly>
      <p className="mt-3 text-[11.5px] text-subtle-foreground">Reconcile decides what a day’s record should say. The original punch is never overwritten.</p>
    </>
  );
}

function DayDetailView({ id }: { id: string }) {
  const { data, error } = useApi("GET /api/v1/attendance/register/:employee_id", { params: { employee_id: id } });
  if (error) return <ErrorBlock error={error} />;
  if (!data) return <LoadingRows />;
  if (!data.events.length) return <EmptyState bare icon="clock" title="No clock events today" text={data.status.text === "On leave" ? "On approved leave." : "Nothing has been recorded yet."} />;
  type Ev = (typeof data.events)[number];
  const fields: Array<[string, (e: Ev) => string]> = [
    ["Event", (e) => (e.kind === "out" ? "Clock-out" : "Clock-in")], ["System time", (e) => e.system_time], ["Employee device time", (e) => e.device_time ?? "Not applicable"],
    ["Submitted GPS", (e) => e.gps], ["GPS accuracy", (e) => (e.accuracy_m == null ? "Not captured" : `${e.accuracy_m} m`)], ["Expected location", (e) => e.expected],
    ["Matched worksite or assignment", (e) => e.matched], ["Distance from expected", (e) => e.distance], ["Device", (e) => e.device], ["Device enrolment", (e) => e.device_status],
    ["Server result", (e) => e.result + (e.superseded ? " · superseded, kept" : "")], ["Exception or warning", (e) => e.exception ?? "None"], ["Policy version", (e) => e.policy_version], ["Source", (e) => e.source],
  ];
  return (
    <>
      <div className="mb-3">
        <KV items={[["Work arrangement", data.arrangement], ["Shift", data.shift], ["Attendance status", <Pill tone={data.status.tone}>{data.status.text}</Pill>], ["Hours", data.hours]]} />
      </div>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border-b border-border bg-muted px-3 py-[9px] text-left text-[10.5px] font-[650] tracking-[.09em] text-subtle-foreground uppercase">Field</th>
              {data.events.map((e) => <th key={e.event_number} className="border-b border-border bg-muted px-3 py-[9px] text-left text-[10.5px] font-[650] tracking-[.09em] text-subtle-foreground uppercase">{e.event_number}</th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map(([label, get]) => (
              <tr key={label}>
                <td className="border-b border-border px-3 py-[9px] text-[11.5px] text-subtle-foreground">{label}</td>
                {data.events.map((e) => <td key={e.event_number} className={cn("border-b border-border px-3 py-[9px]", e.superseded && "text-subtle-foreground line-through")}>{get(e)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const FA_TONE: Record<FieldAssignment["status"], "ok" | "neutral" | "err" | "warn"> = { Approved: "ok", Completed: "neutral", Rejected: "err", "Awaiting manager": "warn" };

function Assignments() {
  const list = usePaged("GET /api/v1/attendance/assignments");
  const approve = useMutation("POST /api/v1/attendance/assignments/:id/approve");
  const modal = useModal();
  const ok = async (a: FieldAssignment) => {
    await approve.run({ params: { id: a.assignment_id }, body: {} });
    invalidate("/api/v1/attendance");
    toast(`${a.number} approved. Clock In now uses it.`);
  };
  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-[15px]">Field Assignments</h2>
          <p className="mt-[3px] text-[13px] text-muted-foreground">An approved assignment overrides the office or home for its day and time window.</p>
        </div>
        <Button variant="primary" icon="plus" className="md:ml-auto" onClick={() => modal.open({ title: "Add Field Assignment", wide: true, body: (close) => <AssignmentForm close={close} /> })}>Add Field Assignment</Button>
      </div>
      <Table
        title="Assignments"
        right={<span className="text-[11.5px] text-subtle-foreground">Default radius 150 m · 100 to 500 by venue</span>}
        wide
        rows={list.rows}
        rowKey={(r) => r.assignment_id}
        loading={list.loading}
        error={list.error}
        columns={[
          { key: "n", label: "Assignment", render: (a) => (<><b>{a.number}</b><br />{a.name}</>) },
          { key: "e", label: "Employee or Team", render: (a) => (<>{a.employees.map((e) => e.display_name).join(", ")}{a.team && <><br /><span className="text-[11.5px] text-subtle-foreground">{a.team}</span></>}</>) },
          { key: "c", label: "Client, Event or Campaign", render: (a) => a.client },
          { key: "s", label: "Approved Sites", render: (a) => a.sites.map((s) => <div key={s.name}>{s.name}</div>) },
          { key: "r", label: "Radius", render: (a) => a.sites.map((s) => <div key={s.name}>{s.radius_m} m</div>) },
          { key: "d", label: "Date", render: (a) => formatDate(a.date) },
          { key: "v", label: "Valid", render: (a) => `${a.start} to ${a.end}` },
          { key: "p", label: "Approving Manager", render: (a) => a.approver },
          { key: "t", label: "Status", render: (a) => <Pill tone={FA_TONE[a.status]}>{a.status}</Pill> },
          { key: "x", label: "", render: (a) => a.status === "Awaiting manager" && <Button disabled={approve.pending} onClick={() => ok(a)}>Approve</Button> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="assignment" />}
      />
    </>
  );
}

function AssignmentForm({ close }: { close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const f = useForm(
    { name: "", client: "", site_name: "", radius_m: "150", date: "", start: "09:00", end: "17:00", note: "" },
    {
      name: rules.required("Name the assignment"), client: rules.required("Name the client or event"), site_name: rules.required("Name the site"), date: rules.required("Pick a date"),
      radius_m: (v) => (/^\d+$/.test(v) && Number(v) >= 100 && Number(v) <= 500 ? null : "Between 100 and 500"),
      start: (v) => (/^\d{2}:\d{2}$/.test(v) ? null : "HH:MM"), end: (v, a) => (!/^\d{2}:\d{2}$/.test(v) ? "HH:MM" : v <= (a.start as string) ? "After the start" : null),
    },
  );
  const save = useMutation("POST /api/v1/attendance/assignments");
  const submit = async () => {
    if (!f.check() || !who.length) return;
    try {
      const a = await save.run({ body: { ...f.values, radius_m: Number(f.values.radius_m), employee_ids: who.map((w) => w.employee_id) } });
      invalidate("/api/v1/attendance");
      close();
      toast(`${a.number} created. The line manager confirms it.`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Grid cols={2} className="mb-0">
        <div>
          <Field label="Assignment Name" {...f.field("name")}><Input {...f.field("name")} placeholder="Venue check" /></Field>
          <Field label="Client, Event or Campaign" {...f.field("client")}><Input {...f.field("client")} /></Field>
          <Field label="Employees"><PersonPicker multiple value={who} onChange={setWho} /></Field>
        </div>
        <div>
          <Field label="Approved Site" {...f.field("site_name")}><Input {...f.field("site_name")} placeholder="Venue, area" /></Field>
          <Field label="Radius, Metres" {...f.field("radius_m")} info="100 m for a single building, up to 500 m for a park or an open venue."><Input inputMode="numeric" {...f.field("radius_m")} /></Field>
          <Field label="Date" {...f.field("date")}><DateField {...f.field("date")} /></Field>
          <FormRow>
            <Field label="From" {...f.field("start")}><Input {...f.field("start")} placeholder="09:00" /></Field>
            <Field label="To" {...f.field("end")}><Input {...f.field("end")} placeholder="17:00" /></Field>
          </FormRow>
          <Field label="Note"><Input {...f.field("note")} /></Field>
        </div>
      </Grid>
      <div className="-mx-[18px] mt-2 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Add Assignment</Button>
      </div>
    </>
  );
}

export const REQ_TONE: Record<LocationRequest["status"], "ok" | "warn" | "err" | "neutral" | "info"> = { Approved: "ok", Rejected: "err", "Awaiting manager": "warn", "Awaiting HR": "info", Draft: "neutral", Expired: "neutral" };

function Requests() {
  const list = usePaged("GET /api/v1/attendance/location-requests", { filters: { scope: "all" } });
  const modal = useModal();
  const open = (r: LocationRequest) => modal.open({ title: `Review ${r.number}`, wide: true, body: (close) => <RequestDecision r={r} close={close} /> });
  const waiting = list.rows.filter((r) => r.status === "Awaiting manager" || r.status === "Awaiting HR").length;
  return (
    <>
      <WithParagraph text="People approves or rejects. A request normally reaches People after the line manager, but People can decide at either stage. Approved locations are used by Clock In for their dates only." />
      <Table
        title="Work Location Requests"
        right={<span className="text-[11.5px] text-subtle-foreground">{waiting} awaiting a decision</span>}
        wide
        rows={list.rows}
        rowKey={(r) => r.request_id}
        loading={list.loading}
        error={list.error}
        onRowClick={open}
        columns={[
          { key: "n", label: "Request", render: (r) => r.number },
          { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} /> },
          { key: "t", label: "Type", render: (r) => r.type },
          { key: "d", label: "Dates", render: (r) => (r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`) },
          { key: "l", label: "Location", render: (r) => (<>{r.area}<br /><span className="text-[11.5px] text-subtle-foreground">Full address in the request</span></>) },
          { key: "r", label: "Radius", align: "n", render: (r) => `${r.radius_m} m` },
          { key: "w", label: "Reason", render: (r) => <span className="inline-block max-w-[240px] truncate align-bottom" title={r.reason}>{r.reason}</span> },
          { key: "s", label: "Status", render: (r) => <Pill tone={REQ_TONE[r.status]}>{r.status}</Pill> },
          { key: "x", label: "", render: (r) => <Button onClick={(e) => (e.stopPropagation(), open(r))}>{r.status === "Awaiting manager" || r.status === "Awaiting HR" ? "Review" : "View"}</Button> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="request" />}
      />
    </>
  );
}

function WithParagraph({ text }: { text: string }) {
  const i = useInfo();
  return (
    <div className="mb-2.5">
      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground">How Requests Are Decided<InfoButton {...i} label="About location requests" /></span>
      <InfoText {...i} className={i.open ? "mt-2" : undefined}>{text}</InfoText>
    </div>
  );
}

function RequestDecision({ r, close }: { r: LocationRequest; close: () => void }) {
  const me = useMe();
  const decide = useMutation("POST /api/v1/attendance/location-requests/:id/decision");
  const [note, setNote] = useState("");
  const own = r.employee.employee_id === me.employee_id;
  const open = r.status === "Awaiting manager" || r.status === "Awaiting HR";
  const act = async (approve: boolean) => {
    try {
      await decide.run({ params: { id: r.request_id }, body: { approve, note } });
      invalidate("/api/v1/attendance");
      close();
      toast(approve ? `${r.number} approved. Clock In will use it on its dates.` : `${r.number} rejected. The employee has been told.`);
    } catch {
      toast(decide.error?.message ?? "Not saved");
    }
  };
  return (
    <>
      {own && <Banner tone="info" icon="info">This is your own request. You cannot approve it yourself; it goes to the CEO.</Banner>}
      {r.status === "Awaiting manager" && <Banner tone="info" icon="info">The line manager has not recommended this yet. People can still decide.</Banner>}
      <Grid cols={2} className="mb-0">
        <Card>
          <CardHeader title="Request" />
          <KV items={[["Employee", r.employee.display_name], ["Type", r.type], ["Dates", r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`], ["Reason", r.reason], ["Evidence", r.evidence ?? "None"], ["Manager", r.manager_note ?? "No recommendation yet"]]} />
        </Card>
        <Card>
          <CardHeader title="Location, Old and New" />
          <KV items={[["Requested", `${r.area} · ${r.radius_m} m`], ["Full address", r.address ?? "Not needed for this type"], ["After it ends", "The permanent location applies again. Both stay in history."], ["Status", <Pill tone={REQ_TONE[r.status]}>{r.status}</Pill>]]} />
        </Card>
      </Grid>
      {open && (
        <Field label="Note to the Employee" className="mt-3">
          <Input value={note} onChange={setNote} placeholder="Optional" />
        </Field>
      )}
      <div className="-mx-[18px] mt-3 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>{open ? "Cancel" : "Close"}</Button>
        {open && !own && (
          <>
            <Button disabled={decide.pending} onClick={() => act(false)}>Reject</Button>
            <Button variant="primary" icon="ok" disabled={decide.pending} onClick={() => act(true)}>Approve</Button>
          </>
        )}
      </div>
    </>
  );
}

function ManagerView() {
  const me = useMe();
  const list = usePaged("GET /api/v1/attendance/register", { filters: { scope: "team" } });
  const summary = useApi("GET /api/v1/attendance/summary", { query: { scope: "team" } });
  const reqs = usePaged("GET /api/v1/attendance/location-requests", { filters: { scope: "team", status: "Awaiting manager" } });
  const cases = usePaged("GET /api/v1/attendance/cases", { filters: { scope: "team", status: "Awaiting manager" } });
  const modal = useModal();
  const waiting = (reqs.page?.total ?? 0) + (cases.page?.total ?? 0);
  return (
    <>
      <Banner tone="info" icon="users">
        <b>Manager view.</b> What {me.display_name} sees as line manager of {list.page?.total ?? 0} people. Nothing outside this team is visible here.
      </Banner>
      {summary.data && <KpiTiles items={summary.data.kpis.slice(0, 4)} mobileCols={2} />}
      <Table
        title="My Team Today"
        rows={list.rows}
        rowKey={(r) => r.employee.employee_id}
        loading={list.loading}
        columns={[
          { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} /> },
          { key: "a", label: "Arrangement", render: (r) => <Pill>{r.arrangement}</Pill> },
          { key: "t", label: "Today", render: (r) => <Pill tone={r.status.tone}>{r.status.text}</Pill> },
          { key: "x", label: "Expected Location", desktop: true, render: (r) => r.expected_location },
          { key: "m", label: "Matched Location", desktop: true, render: (r) => r.matched_location ?? "Not yet" },
        ]}
        empty={{ title: "Nobody reports to you", text: "Your direct reports appear here." }}
        footer={<Pager page={list.page} onPage={list.setPage} noun="person" nounPlural="people" />}
      />
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title="Needs Your Recommendation" right={<Pill tone={waiting ? "warn" : "ok"}>{String(waiting)}</Pill>} />
          {reqs.rows.map((q) => (
            <Row key={q.request_id} icon="target" title={`${q.type} · ${q.employee.display_name}`} sub={`${q.area} · ${formatDate(q.from)} to ${formatDate(q.to)} · ${q.reason}`}>
              <Button onClick={() => modal.open({ title: `Recommend ${q.number}`, body: (close) => <Recommend r={q} close={close} /> })}>Recommend</Button>
            </Row>
          ))}
          {cases.rows.map((c) => (
            <Row key={c.case_id} icon="alert" title={`${c.type} · ${c.employee.display_name}`} sub={`${formatDate(c.date)} · ${c.explanation ?? "No explanation yet"}`}>
              <Button onClick={() => modal.open({ title: `Review Explanation · ${c.number}`, wide: true, body: (close) => <CaseRecommend c={c} close={close} /> })}>Review</Button>
            </Row>
          ))}
          {!waiting && <p className="text-[11.5px] text-subtle-foreground">Nothing is waiting on you.</p>}
        </Card>
        <Card>
          <CardHeader title="What a Manager Can and Cannot Do" />
          <KV items={[["Can", "Confirm field assignments, recommend temporary locations, review explanations, recommend corrections"], ["Cannot change policy", "Attendance policy belongs to People"], ["Cannot edit a clock event", "A recommendation goes to People, who decide"], ["Cannot see", "Employees outside the team"]]} />
        </Card>
      </Grid>
    </>
  );
}

function Row({ icon, title, sub, children }: { icon: "target" | "alert" | "brief"; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border py-[9px] last:border-b-0">
      <span className="flex size-[30px] flex-none items-center justify-center rounded-ctl bg-accent text-accent-foreground">
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><use href={`#i-${icon}`} /></svg>
      </span>
      <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
        <b className="text-[12.5px] font-semibold">{title}</b>
        <span className="text-[11.5px] text-subtle-foreground">{sub}</span>
      </span>
      {children}
    </div>
  );
}

function Recommend({ r, close }: { r: LocationRequest; close: () => void }) {
  const [note, setNote] = useState("");
  const rec = useMutation("POST /api/v1/attendance/location-requests/:id/recommendation");
  const send = async (recommend: boolean) => {
    if (note.trim().length < 3) return;
    await rec.run({ params: { id: r.request_id }, body: { recommend, note } });
    invalidate("/api/v1/attendance");
    close();
    toast("Sent to People with your comment.");
  };
  return (
    <>
      <KV items={[["Employee", r.employee.display_name], ["Request", r.type], ["Dates", `${formatDate(r.from)} to ${formatDate(r.to)}`], ["Location", `${r.area} · ${r.radius_m} m`], ["Reason", r.reason]]} />
      <Field label="Your Comment for People" className="mt-3" state={note ? (note.trim().length < 3 ? "bad" : "good") : undefined} message="Add a comment">
        <Input value={note} onChange={setNote} placeholder="I support this" />
      </Field>
      <div className="-mx-[18px] mt-2 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button disabled={rec.pending} onClick={() => send(false)}>Do Not Recommend</Button>
        <Button variant="primary" disabled={rec.pending} onClick={() => send(true)}>Recommend</Button>
      </div>
    </>
  );
}

export const OUTCOMES: Array<[string, string]> = [
  ["add_in", "Add missing clock-in"], ["add_out", "Add missing clock-out"], ["correct", "Correct recorded time"], ["approve_loc", "Approve location exception"],
  ["attach_fa", "Attach field assignment"], ["leave", "Classify as approved leave"], ["auth_abs", "Classify as authorised absence"], ["unauth_abs", "Classify as unauthorised absence"],
  ["exclude_dup", "Exclude duplicate from calculation"], ["reject", "Reject correction"], ["info", "Request more information"], ["escalate", "Escalate to Queries & Sanctions"],
];

function CaseRecommend({ c, close }: { c: ReconCase; close: () => void }) {
  const [out, setOut] = useState(c.suggested_outcome);
  const [note, setNote] = useState("");
  const send = () => {
    if (note.trim().length < 10) return;
    close();
    toast(`Recommendation on ${c.number} sent to People.`);
    void out;
  };
  return (
    <>
      <KV items={[["Employee", c.employee.display_name], ["Case", `${c.type} · ${formatDate(c.date)}`], ["Employee explanation", c.explanation ?? "None given"]]} />
      <p className="my-3 text-[11.5px] text-subtle-foreground">You recommend. People decides and records the outcome. You cannot change the clock event.</p>
      <Field label="Recommended Outcome"><Select value={out} onChange={setOut} options={OUTCOMES.filter(([k]) => k !== "escalate")} /></Field>
      <Field label="Your Comment" state={note ? (note.trim().length < 10 ? "bad" : "good") : undefined} message="Write at least 10 characters">
        <Textarea value={note} onChange={setNote} placeholder="Approved site visit" state={note ? (note.trim().length < 10 ? "bad" : "good") : undefined} />
      </Field>
      <div className="-mx-[18px] mt-2 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={note.trim().length < 10} onClick={send}>Recommend Correction</Button>
      </div>
    </>
  );
}

export const CASE_TONE: Record<ReconCase["status"], "warn" | "info" | "ok" | "err" | "neutral"> = { "Awaiting HR": "warn", "Awaiting manager": "info", "Awaiting employee": "info", Resolved: "ok", Escalated: "err" };

/** The reconciliation queue: decide what a day's record should say, never editing a punch. */
function Reconcile({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState("open");
  const list = usePaged("GET /api/v1/attendance/cases", { filters: { ...(status !== "all" && { status }) } });
  const all = usePaged("GET /api/v1/attendance/cases");
  const [sel, setSel] = useState<string | null>(null);
  const current = list.rows.find((c) => c.case_id === sel) ?? list.rows[0] ?? null;
  const info = useInfo();
  const count = (s: string) => all.rows.filter((c) => c.status === s).length;
  return (
    <>
      <BackButton label="Back to Attendance" onClick={onBack} />
      <div className="mb-4">
        <span className="flex items-center gap-1.5">
          <h1 className="text-[20px]">Reconciliation Queue</h1>
          <InfoButton {...info} label="About reconciliation" />
        </span>
        <p className="mt-[3px] text-[13px] text-muted-foreground">{count("Awaiting HR")} awaiting People · {count("Awaiting manager")} awaiting a manager</p>
      </div>
      <InfoText {...info}>Reconciliation decides what the attendance record should say. It never edits a clock event: a correction is a new event, and the original stays visible. A possible policy breach goes to Queries & Sanctions, which is a separate process.</InfoText>
      <StatStrip items={[{ label: "Awaiting People", value: String(count("Awaiting HR")), tone: count("Awaiting HR") ? "warn" : "ok" }, { label: "Awaiting a manager", value: String(count("Awaiting manager")) }, { label: "More information", value: String(count("Awaiting employee")) }, { label: "Escalated", value: String(count("Escalated")), desktop: true }, { label: "Total cases", value: String(all.page?.total ?? 0) }]} />
      <Toolbar>
        <SearchBox value={list.q} onChange={list.setQ} placeholder="Case, name, type" className="w-full md:w-[260px]" />
      </Toolbar>
      <Chips value={status} onChange={setStatus} options={[["open", "Open"], ["Awaiting HR", "Awaiting People"], ["Awaiting manager", "Awaiting a manager"], ["Resolved", "Resolved"], ["all", "All"]]} />
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-card border border-border bg-card shadow-1" role="list">
          {list.rows.map((c) => (
            <button
              key={c.case_id}
              type="button"
              role="listitem"
              onClick={() => setSel(c.case_id)}
              className={cn("flex w-full flex-col gap-1 border-b border-border px-[13px] py-[11px] text-left last:border-b-0 hover:bg-muted", current?.case_id === c.case_id && "bg-accent shadow-[inset_3px_0_0_var(--primary)]")}
            >
              <span className="flex items-center justify-between gap-2"><b className="text-[12.5px] font-[650]">{c.type}</b><Pill tone={CASE_TONE[c.status]}>{c.status}</Pill></span>
              <span className="text-[11.5px] text-subtle-foreground">{c.number} · {c.employee.display_name} · {formatDate(c.date)} · payroll: {c.payroll_impact}</span>
            </button>
          ))}
          {!list.rows.length && !list.loading && <EmptyState bare title="No cases match" text="Clear the filter to see the whole queue." />}
          <Pager page={list.page} onPage={list.setPage} noun="case" />
        </div>
        <div className="min-w-0">{current ? <CaseDetail key={current.case_id} c={current} /> : <EmptyState icon="check" title="Nothing selected" text="Choose a case on the left." />}</div>
      </div>
    </>
  );
}

function CaseDetail({ c }: { c: ReconCase }) {
  const done = c.status === "Resolved" || c.status === "Escalated";
  const [out, setOut] = useState(c.suggested_outcome);
  const [time, setTime] = useState(c.suggested_outcome === "add_out" ? "17:00" : "08:00");
  const [why, setWhy] = useState("");
  const decide = useMutation("POST /api/v1/attendance/cases/:id/decision");
  const save = async () => {
    try {
      await decide.run({ params: { id: c.case_id }, body: { outcome: out, note: why, ...(["add_in", "add_out", "correct"].includes(out) && { time }) } });
      invalidate("/api/v1/attendance");
      toast(out === "escalate" ? `${c.number} sent to Queries & Sanctions` : `${c.number} resolved. The original punch is kept.`);
    } catch {
      /* the field shows the server's message */
    }
  };
  const bad = why.length > 0 && why.trim().length < 10;
  return (
    <>
      <Card>
        <CardHeader title={`${c.number} · ${c.type}`} right={<Pill tone={CASE_TONE[c.status]}>{c.status}</Pill>} />
        <KV items={[["Employee", `${c.employee.display_name} · ${c.department}`], ["Work arrangement", c.arrangement], ["Date", formatDate(c.date)], ...c.evidence, ["Employee explanation", c.explanation ?? "None given"], ["Manager comment", c.manager_note ?? "None yet"], ["Payroll impact", c.payroll_impact]]} />
      </Card>
      {!done && (
        <Card className="mt-3">
          <CardHeader title="Decide the Record" />
          {c.status === "Awaiting manager" && <Banner tone="info" icon="info">The line manager has not recommended yet. People can still decide.</Banner>}
          <Field label="Outcome"><Select value={out} onChange={setOut} options={OUTCOMES} /></Field>
          {["add_in", "add_out", "correct"].includes(out) && (
            <Field label="Time" state={/^\d{2}:\d{2}$/.test(time) ? undefined : "bad"} message="HH:MM">
              <Input value={time} onChange={setTime} placeholder="17:00" />
            </Field>
          )}
          <Field label="Resolution Reason" state={bad || decide.fields.note ? "bad" : why ? "good" : undefined} message={decide.fields.note?.[0] ?? "At least 10 characters"}>
            <Textarea value={why} onChange={setWhy} placeholder="Matches gate log" state={bad ? "bad" : why ? "good" : undefined} />
          </Field>
          <div className="flex justify-end gap-2">
            <Grow />
            <Button variant="primary" disabled={decide.pending || why.trim().length < 10} onClick={save}>Record Decision</Button>
          </div>
        </Card>
      )}
    </>
  );
}
