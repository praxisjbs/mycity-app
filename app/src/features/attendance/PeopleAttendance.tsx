import attendance from "@mycity/contract/schemas/attendance.js";
import type { AttendanceEvent, AttendanceException, ExceptionDecision, HomeDecision, HomeRequest, HomeStatus, RegisterRow, RegisterStatus } from "@mycity/contract/contract.gen.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { useSearchParams } from "@/lib/router";
import { Button, Card, CardHeader, Chips, ChoiceField, DataView, DateField, DateRangeField, ErrorState, Field, formatDate, formatDateTime, formatTime, FormFooter, Grid, HelpTerm, KeyValue, KpiCard, LoadingRows, PageHeader, Pill, SegmentedControl, TextAreaField, TimeField, toast, todayIso, useContractForm, useModal, Who } from "@mycity/ui";
import { EXCEPTION_TYPE, HOME_STATUS, hours, lateBy, PATTERN, PUNCH_STATE, REGISTER_STATUS, VERDICT } from "./labels";

/**
 * People · Attendance (#25, docs/guides/attendance.md §10): one day's register for everyone in the
 * reader's `people` scope, with its figures, each person's day and the evidence of every punch,
 * the exceptions waiting on People, and remote staff's home locations. A manager sees their team;
 * the coordinates, the home addresses and the decisions are for People with scope all, which the
 * API enforces.
 */

type View = "register" | "exceptions" | "homes";
const STATUS_CHIPS: Array<[RegisterStatus | "all", string]> = [
  ["all", "All"],
  ["present", "Present"],
  ["late", "Late"],
  ["absent", "Absent"],
  ["leave", "On Leave"],
  ["not_in", "Not In"],
];

export function PeopleAttendance() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const homeId = params.get("home");
  const { can } = useAuth();
  const modal = useModal();
  const [date, setDate] = useState(todayIso());
  const [view, setView] = useState<View>("register");
  const [status, setStatus] = useState<RegisterStatus | "all">("all");
  const summary = useApi("GET /api/v1/attendance/summary", { query: { date } });
  const s = summary.data;
  const openDay = (employeeId: string, name: string, day: string) => modal.open({ title: name, wide: true, body: <DayView employeeId={employeeId} date={day} /> });
  useRecordLink(id, openDay);
  const openHome = useCallback((h: HomeRequest) => modal.open({ title: h.employee.display_name, body: (close) => <HomeView h={h} close={close} /> }), [modal]);
  useHomeLink(homeId, openHome, () => setView("homes"));

  const exportRange = () => modal.open({ title: "Export Register", body: (close) => <ExportForm close={close} date={date} status={status} /> });
  const tile = (title: string, value: number | undefined, filter: RegisterStatus | null, tone?: "ok" | "warn" | "err", help?: string) => (
    <KpiCard title={title} value={value === undefined ? "" : String(value)} tone={value ? tone : undefined} help={help} onOpen={filter ? () => (setView("register"), setStatus(filter)) : undefined} />
  );

  return (
    <>
      <PageHeader
        title="Attendance"
        sub={formatDate(date)}
        actions={can("people", "export") ? <Button icon="download" onClick={exportRange}>Export</Button> : undefined}
      >
        <Field label="Date">
          <DateField value={date} onChange={(d) => d && setDate(d)} max={todayIso()} />
        </Field>
      </PageHeader>
      {summary.error && !s && <ErrorState error={summary.error} onRetry={summary.reload} />}
      <Grid cols="4m2">
        {tile("Expected", s?.expected, null)}
        {tile("Present", s?.present, "present", "ok")}
        {tile("Late", s?.late, "late", "warn")}
        {tile("Absent", s?.absent, "absent", "err")}
      </Grid>
      <Grid cols="4m2" className="mt-3">
        {tile("On Leave", s?.on_leave, "leave")}
        {tile("Not In", s?.not_in, "not_in")}
        <KpiCard
          title="Open Exceptions"
          value={s ? String(s.open_exceptions) : ""}
          tone={s?.open_exceptions ? "warn" : undefined}
          help="Punches recorded for review on this day, waiting on People to accept, reject or correct."
          onOpen={() => setView("exceptions")}
        />
      </Grid>
      <div className="my-3">
        <SegmentedControl label="View" value={view} onChange={setView} options={[["register", "Register"], ["exceptions", "Exceptions"], ["homes", "Homes"]]} />
      </div>
      {view === "register" ? <Register date={date} status={status} setStatus={setStatus} openDay={openDay} /> : view === "exceptions" ? <Exceptions date={date} /> : <Homes openHome={openHome} />}
    </>
  );
}

/** A link from search or a notice opens the day it names, once. */
function useRecordLink(id: string | null | undefined, openDay: (employeeId: string, name: string, date: string) => void) {
  const ref = useApi("GET /api/v1/attendance/records/:id", { params: { id: id ?? "" }, enabled: !!id });
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (ref.data && done.current !== ref.data.attendance_day_id) {
      done.current = ref.data.attendance_day_id;
      openDay(ref.data.employee_id, formatDate(ref.data.date), ref.data.date);
    }
  }, [ref.data, openDay]);
}

function Register({ date, status, setStatus, openDay }: { date: string; status: RegisterStatus | "all"; setStatus: (s: RegisterStatus | "all") => void; openDay: (employeeId: string, name: string, date: string) => void }) {
  const list = usePaged("GET /api/v1/attendance/register", { filters: { date, ...(status !== "all" && { status }) } });
  const open = (r: RegisterRow) => openDay(r.employee.employee_id, r.employee.display_name, r.date);
  return (
    <>
      <Chips label="Status" value={status} onChange={setStatus} options={STATUS_CHIPS} />
      <DataView
        title="Register"
        wide
        list={list}
        search="Name or Location"
        rowKey={(r) => r.employee.employee_id}
        onRowClick={open}
        noun="person"
        nounPlural="people"
        empty={{ icon: "srch", title: "Nobody Matches", text: "Choose All to see everyone." }}
        columns={[
          { key: "display_name", label: "Employee", sortable: true, render: (r) => <Who name={r.employee.display_name} sub={r.employee.department} /> },
          { key: "s", label: "Status", render: (r) => <Pill tone={REGISTER_STATUS[r.status].tone}>{r.status === "late" ? `Late ${lateBy(r.late_minutes)}` : REGISTER_STATUS[r.status].text}</Pill> },
          { key: "clock_in_at", label: "Clock In", sortable: true, render: (r) => (r.clock_in_at ? formatTime(r.clock_in_at) : null) },
          { key: "o", label: "Clock Out", render: (r) => (r.clock_out_at ? formatTime(r.clock_out_at) : null) },
          { key: "a", label: "Arrangement", desktop: true, render: (r) => PATTERN[r.work_pattern] },
          { key: "l", label: "Location", desktop: true, render: (r) => (r.location_verdict ? `${r.expected_location ?? "None"} · ${VERDICT[r.location_verdict]}` : r.expected_location) },
          { key: "d", label: "Device", desktop: true, render: (r) => r.device_label },
          { key: "r", label: "Review", desktop: true, render: (r) => (r.open_exceptions ? <Pill tone="warn">{`${r.open_exceptions} Open`}</Pill> : null) },
        ]}
      />
    </>
  );
}

/** One person's day: the record, every punch with its evidence, and the day's exceptions. */
function DayView({ employeeId, date }: { employeeId: string; date: string }) {
  const day = useApi("GET /api/v1/attendance/register/:employee_id", { params: { employee_id: employeeId }, query: { date } });
  const events = usePaged("GET /api/v1/attendance/events", { filters: { employee_id: employeeId, date } });
  const exceptions = usePaged("GET /api/v1/attendance/exceptions", { filters: { employee_id: employeeId, date } });
  const modal = useModal();
  const d = day.data;
  if (day.error) return <ErrorState error={day.error} onRetry={day.reload} />;
  if (!d) return <LoadingRows />;
  const decideOne = (x: AttendanceException) => modal.open({ title: EXCEPTION_TYPE[x.exception_type], wide: true, body: (close) => <ExceptionView x={x} close={close} /> });
  return (
    <>
      <Card>
        <CardHeader record title={formatDate(d.date)} right={<Pill tone={REGISTER_STATUS[d.status].tone}>{REGISTER_STATUS[d.status].text}</Pill>} />
        <KeyValue
          items={[
            ["Shift", d.shift.working_day && d.shift.starts_at ? `${d.shift.starts_at} to ${d.shift.ends_at}${d.shift.grace_minutes ? `, ${d.shift.grace_minutes} min grace` : ""}` : "Day Off"],
            ["Arrangement", PATTERN[d.work_pattern]],
            ["Expected Location", d.expected_location ? `${d.expected_location.name} · ${d.expected_location.radius_m} m` : null],
            ["Clock In", d.clock_in_at ? formatTime(d.clock_in_at) : null],
            ["Clock Out", d.clock_out_at ? formatTime(d.clock_out_at) : null],
            ["Hours", d.worked_minutes ? hours(d.worked_minutes) : null],
            ["Late By", d.late_minutes ? lateBy(d.late_minutes) : null],
            ["Overtime", d.overtime_minutes ? `${d.overtime_minutes} min` : null],
          ]}
        />
      </Card>
      <DataView
        className="mt-3"
        title="Punches"
        wide
        list={events}
        rowKey={(e) => e.attendance_event_id}
        noun="punch"
        nounPlural="punches"
        empty={{ icon: "clock", title: "No Punches", text: "Nothing was recorded on this day." }}
        columns={evidenceColumns}
      />
      {exceptions.rows.length > 0 && (
        <DataView
          className="mt-3"
          title="Exceptions"
          list={exceptions}
          rowKey={(x) => x.attendance_exception_id}
          onRowClick={decideOne}
          noun="exception"
          columns={exceptionColumns(false)}
        />
      )}
    </>
  );
}

const evidenceColumns = [
  { key: "t", label: "Punch", render: (e: AttendanceEvent) => (e.event_type === "clock_in" ? "Clock In" : "Clock Out") },
  { key: "a", label: "Server Time", render: (e: AttendanceEvent) => formatTime(e.occurred_at) },
  { key: "r", label: "Result", render: (e: AttendanceEvent) => <Pill tone={e.excluded ? "err" : PUNCH_STATE[e.validation_state].tone}>{e.excluded ? "Not Counted" : PUNCH_STATE[e.validation_state].text}</Pill> },
  { key: "v", label: "Device Time", desktop: true, render: (e: AttendanceEvent) => (e.device_at ? `${formatTime(e.device_at)}${e.skew_seconds && Math.abs(e.skew_seconds) >= 60 ? `, ${Math.round(e.skew_seconds / 60)} min` : ""}` : null) },
  { key: "l", label: "Location", render: (e: AttendanceEvent) => `${VERDICT[e.geofence]}${e.distance_m !== null ? `, ${e.distance_m} m` : ""}` },
  { key: "c", label: "Accuracy", desktop: true, render: (e: AttendanceEvent) => (e.accuracy_m !== null ? `${Math.round(e.accuracy_m)} m` : null) },
  { key: "g", label: "Coordinates", desktop: true, render: (e: AttendanceEvent) => (e.latitude !== null && e.longitude !== null ? `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}` : null) },
  { key: "d", label: "Device", desktop: true, render: (e: AttendanceEvent) => e.device_label },
  { key: "s", label: "Source", desktop: true, render: (e: AttendanceEvent) => (e.source === "admin" ? `Added by ${e.recorded_by_name ?? "People"}` : "Clock") },
];

const exceptionColumns = (withPerson: boolean) => [
  ...(withPerson ? [{ key: "e", label: "Employee", render: (x: AttendanceException) => <Who name={x.employee.display_name} sub={x.employee.department} /> }] : []),
  { key: "t", label: "Exception", render: (x: AttendanceException) => EXCEPTION_TYPE[x.exception_type] },
  { key: "w", label: "Date", render: (x: AttendanceException) => formatDate(x.work_date) },
  { key: "d", label: "Detail", desktop: true, render: (x: AttendanceException) => x.detail },
  { key: "n", label: "Note", desktop: true, render: (x: AttendanceException) => (x.employee_note ? <Pill tone="info">Explained</Pill> : null) },
  {
    key: "s",
    label: "Status",
    render: (x: AttendanceException) =>
      x.status === "open" ? <Pill tone="warn">Open</Pill> : <Pill tone={x.outcome === "rejected" ? "err" : "ok"}>{x.outcome === "rejected" ? "Rejected" : x.outcome === "corrected" ? "Corrected" : "Accepted"}</Pill>,
  },
];

function Exceptions({ date }: { date: string }) {
  const modal = useModal();
  const [status, setStatus] = useState<"open" | "resolved" | "day">("open");
  const list = usePaged("GET /api/v1/attendance/exceptions", { filters: status === "day" ? { date } : { status } });
  const open = (x: AttendanceException) => modal.open({ title: EXCEPTION_TYPE[x.exception_type], wide: true, body: (close) => <ExceptionView x={x} close={close} /> });
  return (
    <>
      <Chips label="Exceptions" value={status} onChange={setStatus} options={[["open", "Open"], ["resolved", "Decided"], ["day", formatDate(date)]]} />
      <DataView
        title="Exceptions"
        list={list}
        search="Name or Detail"
        rowKey={(x) => x.attendance_exception_id}
        onRowClick={open}
        noun="exception"
        empty={{ icon: "check", title: "Nothing Waiting", text: "Every exception here is decided." }}
        columns={exceptionColumns(true)}
      />
    </>
  );
}

/** An exception: what happened, the person's note, the punch's evidence, and the decision. */
function ExceptionView({ x, close }: { x: AttendanceException; close: () => void }) {
  const { can } = useAuth();
  const events = usePaged("GET /api/v1/attendance/events", { filters: { employee_id: x.employee.employee_id, date: x.work_date } });
  return (
    <>
      <Card>
        <CardHeader record title={x.employee.display_name} right={x.status === "open" ? <Pill tone="warn">Open</Pill> : <Pill tone="ok">Decided</Pill>} />
        <KeyValue
          items={[
            ["Date", formatDate(x.work_date)],
            ["Detail", x.detail],
            ["Severity", x.severity === "high" ? "High" : x.severity === "medium" ? "Medium" : "Low"],
            ["Their Note", x.employee_note],
            ...(x.status === "resolved"
              ? ([
                  ["Decided By", x.reviewed_by_name],
                  ["Decided", x.reviewed_at ? formatDateTime(x.reviewed_at) : null],
                  ["Reason", x.resolution],
                ] as Array<[string, string | null]>)
              : []),
          ]}
        />
      </Card>
      <DataView className="mt-3" title="Punches" wide list={events} rowKey={(e) => e.attendance_event_id} noun="punch" nounPlural="punches" columns={evidenceColumns} />
      {x.status === "open" && can("people", "approve") ? (
        <DecisionForm x={x} close={close} />
      ) : (
        <FormFooter>
          <Button variant="primary" onClick={close}>Close</Button>
        </FormFooter>
      )}
    </>
  );
}

const DECISIONS: Record<ExceptionDecision["decision"], string> = { accept: "Accept", reject: "Reject", add_clock_out: "Add Clock-Out" };

/** Decide: accept the punch, stop it counting, or add the missing clock-out. The punch itself never changes. */
function DecisionForm({ x, close }: { x: AttendanceException; close: () => void }) {
  const options = (x.exception_type === "missing_clock_out" ? ["add_clock_out", "accept"] : ["accept", "reject"]) as Array<ExceptionDecision["decision"]>;
  const f = useContractForm({ decision: options[0], resolution: "", clock_out_time: "" }, {
    safeParse: (v: { decision: ExceptionDecision["decision"]; resolution: string; clock_out_time: string }) =>
      attendance.ExceptionDecision.safeParse({ decision: v.decision, resolution: v.resolution, ...(v.decision === "add_clock_out" && v.clock_out_time ? { clock_out_time: v.clock_out_time } : {}) }),
  });
  const save = useMutation("POST /api/v1/attendance/exceptions/:id/decision");
  const v = f.values;
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({
        params: { id: x.attendance_exception_id },
        body: { decision: v.decision, resolution: v.resolution.trim(), ...(v.decision === "add_clock_out" && { clock_out_time: v.clock_out_time }) },
      });
      invalidate("/api/v1/attendance");
      close();
      toast("Decision recorded");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Decision not recorded");
    }
  };
  return (
    <Card className="mt-3">
      <CardHeader title="Decide" />
      <Field label={<HelpTerm help="Accept keeps the punch. Reject stops it counting for the day. Add Clock-Out records the time the person left.">Outcome</HelpTerm>} {...f.status("decision")}>
        <ChoiceField value={v.decision} onChange={(d) => f.set("decision", d)} options={options.map((o) => [o, DECISIONS[o]] as [ExceptionDecision["decision"], string])} />
      </Field>
      {v.decision === "add_clock_out" && (
        <Field label="Clock-Out Time" {...f.status("clock_out_time")}>
          <TimeField {...f.field("clock_out_time")} />
        </Field>
      )}
      <Field label="Reason" {...f.status("resolution")}>
        <TextAreaField {...f.field("resolution")} placeholder="Matches gate log" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>Record Decision</Button>
      </FormFooter>
    </Card>
  );
}

/** A link to a home location (`?home=`, from a notice or search) opens it in Homes, once. */
function useHomeLink(id: string | null, openHome: (h: HomeRequest) => void, toHomes: () => void) {
  const home = useApi("GET /api/v1/attendance/homes/:id", { params: { id: id ?? "" }, enabled: !!id });
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (home.data && done.current !== home.data.attendance_home_id) {
      done.current = home.data.attendance_home_id;
      toHomes();
      openHome(home.data);
    }
  }, [home.data, openHome, toHomes]);
}

const HOME_CHIPS: Array<[HomeStatus | "all", string]> = [
  ["pending", "Waiting"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["all", "All"],
];

/** Metres under a kilometre, kilometres after. */
const far = (m: number | null) => (m === null ? null : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

/** Remote staff's home locations, waiting first; the address only where the reader's scope allows. */
function Homes({ openHome }: { openHome: (h: HomeRequest) => void }) {
  const [status, setStatus] = useState<HomeStatus | "all">("pending");
  const list = usePaged("GET /api/v1/attendance/homes", { filters: status === "all" ? {} : { status } });
  return (
    <>
      <Chips label="Homes" value={status} onChange={setStatus} options={HOME_CHIPS} />
      <DataView
        title="Homes"
        list={list}
        search="Name"
        rowKey={(h) => h.attendance_home_id}
        onRowClick={openHome}
        noun="home"
        empty={{ icon: "home", title: "No Homes Here", text: "Choose All to see every home." }}
        columns={[
          { key: "e", label: "Employee", render: (h) => <Who name={h.employee.display_name} sub={h.employee.department} /> },
          { key: "a", label: "Address", desktop: true, render: (h) => h.home_address },
          { key: "c", label: "Accuracy", desktop: true, render: (h) => (h.accuracy_m !== null ? `${Math.round(h.accuracy_m)} m` : null) },
          { key: "requested_at", label: "Requested", desktop: true, render: (h) => formatDate(h.requested_at) },
          { key: "f", label: "From Approved Home", render: (h) => far(h.distance_from_approved_m) },
          { key: "s", label: "Status", render: (h) => <Pill tone={HOME_STATUS[h.status].tone}>{HOME_STATUS[h.status].text}</Pill> },
        ]}
      />
    </>
  );
}

/** One home location: what was sent, how it compares with the home in force, and the decision. */
function HomeView({ h, close }: { h: HomeRequest; close: () => void }) {
  const { can } = useAuth();
  return (
    <>
      <Card>
        <CardHeader record title="Home Location" right={<Pill tone={HOME_STATUS[h.status].tone}>{HOME_STATUS[h.status].text}</Pill>} />
        <KeyValue
          items={[
            ["Address", h.home_address],
            ["Coordinates", h.home_latitude !== null && h.home_longitude !== null ? `${h.home_latitude.toFixed(5)}, ${h.home_longitude.toFixed(5)}` : null],
            ["Accuracy", h.accuracy_m !== null ? `${Math.round(h.accuracy_m)} m` : null],
            ["Radius", `${h.radius_m} m`],
            [<HelpTerm key="f" help="How far this home is from the one the person is clocked against now.">From Approved Home</HelpTerm>, far(h.distance_from_approved_m)],
            ["Requested", formatDateTime(h.requested_at)],
            ...(h.decided_at
              ? ([
                  ["Decided By", h.decided_by_name],
                  ["Decided", formatDateTime(h.decided_at)],
                  ["Reason", h.decision_reason],
                ] as Array<[string, string | null]>)
              : []),
          ]}
        />
      </Card>
      {h.status === "pending" && can("people", "approve") ? (
        <HomeDecisionForm h={h} close={close} />
      ) : (
        <FormFooter>
          <Button variant="primary" onClick={close}>Close</Button>
        </FormFooter>
      )}
    </>
  );
}

const HOME_DECISIONS: Array<[HomeDecision["decision"], string]> = [
  ["approve", "Approve"],
  ["reject", "Reject"],
];

/** Approve the home, so remote punches are matched to it, or reject it with a reason the person reads. */
function HomeDecisionForm({ h, close }: { h: HomeRequest; close: () => void }) {
  const f = useContractForm({ decision: "approve" as HomeDecision["decision"], reason: "" }, {
    safeParse: (v: unknown) => {
      const x = v as { decision: HomeDecision["decision"]; reason: string };
      return attendance.HomeDecision.safeParse({ decision: x.decision, ...(x.decision === "reject" && { reason: x.reason.trim() }) });
    },
  });
  const save = useMutation("POST /api/v1/attendance/homes/:id/decision");
  const v = f.values;
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: h.attendance_home_id }, body: { decision: v.decision, ...(v.decision === "reject" && { reason: v.reason.trim() }) } });
      invalidate("/api/v1/attendance");
      close();
      toast(v.decision === "approve" ? "Home location approved" : "Home location rejected");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Decision not recorded");
    }
  };
  return (
    <Card className="mt-3">
      <CardHeader title="Decide" />
      <Field label="Outcome" {...f.status("decision")}>
        <ChoiceField value={v.decision} onChange={(d) => f.set("decision", d)} options={HOME_DECISIONS} />
      </Field>
      {v.decision === "reject" && (
        <Field label="Reason" {...f.status("reason")}>
          <TextAreaField {...f.field("reason")} placeholder="Full street address" rows={3} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>Record Decision</Button>
      </FormFooter>
    </Card>
  );
}

/** The register between two dates as a workbook, emailed to the person asking. */
function ExportForm({ close, date, status }: { close: () => void; date: string; status: RegisterStatus | "all" }) {
  const f = useContractForm({ period: { from: `${date.slice(0, 8)}01`, to: date } }, {
    safeParse: (v: { period: { from: string; to: string } }) => {
      const r = attendance.RegisterExportRequest.safeParse({ from: v.period.from, to: v.period.to });
      return r.success ? r : { success: false, error: { issues: (r.error?.issues ?? []).map((i) => ({ ...i, path: ["period"] })) } };
    },
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!f.check()) return;
    setBusy(true);
    try {
      await api.call("POST /api/v1/attendance/export", { body: { from: f.values.period.from, to: f.values.period.to, ...(status !== "all" && { status }) } });
      close();
      toast("Export queued for your email");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Export not queued");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Field label="Period" {...f.status("period")}>
        <DateRangeField value={f.values.period} onChange={(p) => f.set("period", p)} max={todayIso()} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="download" busy={busy} onClick={() => submit()}>Export Register</Button>
      </FormFooter>
    </>
  );
}
