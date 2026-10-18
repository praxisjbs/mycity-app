import attendance from "@mycity/contract/schemas/attendance.js";
import devices from "@mycity/contract/schemas/devices.js";
import type { AttendanceDay, AttendanceEvent, AttendanceException, MyDevice } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { LocationRequest, LocationRequestBody } from "@/api/types/attendance";
import { useMe } from "@/auth/AuthProvider";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import { hrefFor, useRouter, useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { MonthPicker } from "@/features/shared/MonthPicker";
import { useClock } from "./ClockButton";
import { DEVICE_STATUS, DEVICE_STATUS_HELP, EXCEPTION_TYPE, PUNCH_STATE, VERDICT, dayStatus, hours, lateBy, recentMonths } from "./labels";
import { Banner, BarChart, Button, Card, CardHeader, DataView, DateField, ErrorState, ExportButton, Field, formatDate, formatDateTime, formatMonth, formatTime, FormFooter, Grid, HelpTerm, KeyValue, KpiCard, LoadingRows, PageHeader, Pager, Pill, rules, SegmentedControl, SelectField, TextAreaField, TextField, toast, todayIso, useConfirm, useContractForm, useModal } from "@mycity/ui";

/**
 * ESS · My Attendance (#9), My Devices (#88), and the two attendance screens still on INTERIM
 * shapes, Work Location Requests (#87) and Policy Updates (#89) (docs/guides/attendance.md §10).
 * Everything here is the caller's own: the routes take no employee id.
 */

export const REQ_TONE: Record<LocationRequest["status"], "ok" | "warn" | "err" | "neutral" | "info"> = { Approved: "ok", Rejected: "err", "Awaiting manager": "warn", "Awaiting HR": "info", Draft: "neutral", Expired: "neutral" };

/* ------------------------------------------------------------------ *
 * My Attendance
 * ------------------------------------------------------------------ */

export function MyAttendancePage() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const modal = useModal();
  const clock = useClock();
  const months = recentMonths(todayIso());
  const [month, setMonth] = useState(months[0]);
  const summary = useApi("GET /api/v1/attendance/me/summary", { query: { month } });
  const days = usePaged("GET /api/v1/attendance/me", { filters: { month } });
  const [view, setView] = useState<"table" | "chart">("table");
  const open = usePaged("GET /api/v1/attendance/me/exceptions", { filters: { status: "open" } });
  const t = clock.today;
  const s = summary.data;

  const openDay = (date: string, d?: AttendanceDay) => modal.open({ title: formatDate(date), wide: true, body: <MyDay date={date} day={d} /> });
  const link = useApi("GET /api/v1/attendance/me/records/:id", { params: { id: id ?? "" }, enabled: !!id });
  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (link.data && linked.current !== link.data.attendance_day_id) {
      linked.current = link.data.attendance_day_id;
      openDay(link.data.date, days.rows.find((d) => d.attendance_day_id === link.data?.attendance_day_id));
    }
  });
  const openFigure = (status: FigureStatus) =>
    modal.open({ title: `${FIGURE[status]}, ${formatMonth(month)}`, wide: true, body: <FigureDays month={month} status={status} /> });
  const explain = (x: AttendanceException) => modal.open({ title: EXCEPTION_TYPE[x.exception_type], body: (close) => <ExplainForm x={x} close={close} /> });

  const todayCard = t && (
    <Card>
      <CardHeader
        title="Today"
        right={
          <Pill tone={t.state === "clocked_in" ? (t.review ? "warn" : "ok") : t.state === "unavailable" ? "info" : "neutral"}>
            {t.state === "clocked_in" ? (t.review ? "Review Required" : "Clocked In") : t.state === "clocked_out" ? "Clocked Out" : t.state === "unavailable" ? "On Leave" : "Not Clocked In"}
          </Pill>
        }
      />
      <KeyValue
        items={[
          ["Clock In", t.clock_in_at ? formatTime(t.clock_in_at) : null],
          ["Clock Out", t.clock_out_at ? formatTime(t.clock_out_at) : null],
          ["Location", t.location.kind === "worksite" ? t.location.name : t.location.kind === "remote" ? "Remote" : "No Worksite"],
        ]}
      />
      {clock.ready && !clock.unavailable && (
        <div className="mt-3 flex justify-end">
          <Button variant="primary" icon="clock" onClick={clock.open}>{clock.label}</Button>
        </div>
      )}
    </Card>
  );

  const viewSwitch = <SegmentedControl label="Show" value={view} onChange={(v) => setView(v as "table" | "chart")} options={[["table", "Table"], ["chart", "Chart"]]} />;

  if (summary.error && !s) return <ErrorState error={summary.error} onRetry={summary.reload} />;
  return (
    <>
      <PageHeader
        title="My Attendance"
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} min={`${Number(months[0].slice(0, 4)) - 2}-01`} max={months[0]} className="phone:flex-1" />
            <ExportButton message="Export queued for your email" onExport={() => api.call("POST /api/v1/attendance/me/export", { body: { month } })}>Export Month</ExportButton>
          </>
        }
      />
      {todayCard}
      <Grid cols="4m2" className="mt-3">
        <KpiCard title="Days Present" value={s ? String(s.days_present) : ""} onOpen={() => openFigure("present")} />
        <KpiCard
          title="Late Days"
          value={s ? String(s.late_days) : ""}
          tone={s && s.late_days > 0 ? "warn" : undefined}
          caption={s && s.days_present > 0 ? `${Math.round((s.late_days / s.days_present) * 100)}% of days present` : undefined}
          onOpen={() => openFigure("late")}
        />
        <KpiCard title="Absent" value={s ? String(s.absent_days) : ""} tone={s && s.absent_days > 0 ? "err" : undefined} onOpen={() => openFigure("absent")} />
        <KpiCard title="Hours Worked" value={s ? hours(s.worked_minutes) : ""} help="From the first clock-in to the last clock-out of each day." />
      </Grid>
      {open.rows.length > 0 && (
        <DataView
          title="Open Exceptions"
          list={open}
          rowKey={(x) => x.attendance_exception_id}
          onRowClick={explain}
          noun="exception"
          columns={[
            { key: "t", label: "Exception", render: (x) => EXCEPTION_TYPE[x.exception_type] },
            { key: "d", label: "Date", render: (x) => formatDate(x.work_date) },
            { key: "w", label: "Detail", desktop: true, render: (x) => x.detail },
            { key: "n", label: "Your Note", render: (x) => (x.employee_note ? <Pill tone="ok">Sent</Pill> : <Pill tone="warn">Explain</Pill>) },
          ]}
        />
      )}
      {view === "table" ? (
        <DataView
          title="My Days"
          actions={viewSwitch}
          list={days}
          rowKey={(d) => d.attendance_day_id}
          onRowClick={(d) => openDay(d.attendance_date, d)}
          noun="day"
          empty={{ icon: "clock", title: "No Days Yet", text: "Your clock-ins this month appear here." }}
          columns={[...DAY_COLUMNS, { key: "r", label: "Review", desktop: true, render: (d) => (d.open_exceptions ? <Pill tone="warn">{`${d.open_exceptions} Open`}</Pill> : null) }]}
        />
      ) : (
        <>
          <BarChart
            className="mt-3"
            title="My Days"
            actions={viewSwitch}
            caption="Hours worked; late days stand out"
            format={(v) => `${v} hours`}
            bars={[...days.rows]
              .sort((a, b) => a.attendance_date.localeCompare(b.attendance_date))
              .map((d) => ({ label: formatDate(d.attendance_date).slice(0, 6), value: Math.round(d.worked_minutes / 6) / 10, series: d.status === "late" ? 3 : 1 }))}
          />
          <Pager page={days.page} onPage={days.setPage} noun="day" />
        </>
      )}
    </>
  );
}

/** A day's columns, as My Days and a figure's days show them. */
const DAY_COLUMNS: Array<{ key: string; label: string; sortable?: boolean; align?: "n"; desktop?: boolean; render: (d: AttendanceDay) => ReactNode }> = [
  { key: "attendance_date", label: "Date", sortable: true, render: (d) => formatDate(d.attendance_date) },
  { key: "i", label: "Clock In", render: (d) => (d.first_clock_in_at ? formatTime(d.first_clock_in_at) : null) },
  { key: "o", label: "Clock Out", render: (d) => (d.last_clock_out_at ? formatTime(d.last_clock_out_at) : null) },
  { key: "h", label: "Hours", align: "n", render: (d) => (d.worked_minutes ? hours(d.worked_minutes) : null) },
  { key: "s", label: "Status", render: (d) => <Pill tone={dayStatus(d).tone}>{dayStatus(d).text}</Pill> },
];

type FigureStatus = "present" | "late" | "absent";
const FIGURE: Record<FigureStatus, string> = { present: "Days Present", late: "Late Days", absent: "Absent Days" };

/** The days behind one of My Attendance's figures, paged at 25. */
function FigureDays({ month, status }: { month: string; status: FigureStatus }) {
  const list = usePaged("GET /api/v1/attendance/me", { filters: { month, status } });
  return <DataView bare caption={FIGURE[status]} list={list} rowKey={(d) => d.attendance_day_id} noun="day" empty={{ icon: "clock", title: "No Days", text: "None this month." }} columns={DAY_COLUMNS} />;
}

/** One of my days: its punches with what the server decided about each. */
function MyDay({ date, day }: { date: string; day?: AttendanceDay }) {
  const events = usePaged("GET /api/v1/attendance/me/events", { filters: { date } });
  return (
    <>
      {day && (
        <KeyValue
          items={[
            ["Status", <Pill key="s" tone={dayStatus(day).tone}>{dayStatus(day).text}</Pill>],
            ["Hours", day.worked_minutes ? hours(day.worked_minutes) : null],
            ...(day.late_minutes ? ([["Late By", lateBy(day.late_minutes)]] as Array<[string, string]>) : []),
          ]}
        />
      )}
      <DataView
        className="mt-3"
        title="Punches"
        list={events}
        rowKey={(e) => e.attendance_event_id}
        noun="punch"
        nounPlural="punches"
        columns={[
          { key: "t", label: "Punch", render: (e: AttendanceEvent) => (e.event_type === "clock_in" ? "Clock In" : "Clock Out") },
          { key: "a", label: "Time", render: (e: AttendanceEvent) => formatTime(e.occurred_at) },
          { key: "l", label: "Location", render: (e: AttendanceEvent) => (e.worksite_name ? `${VERDICT[e.geofence]}${e.distance_m !== null ? `, ${e.distance_m} m` : ""}` : VERDICT[e.geofence]) },
          { key: "d", label: "Device", desktop: true, render: (e: AttendanceEvent) => e.device_label },
          { key: "r", label: "Result", render: (e: AttendanceEvent) => <Pill tone={e.excluded ? "err" : PUNCH_STATE[e.validation_state].tone}>{e.excluded ? "Not Counted" : PUNCH_STATE[e.validation_state].text}</Pill> },
        ]}
      />
    </>
  );
}

/** Say why an exception happened; People read it when they decide. */
function ExplainForm({ x, close }: { x: AttendanceException; close: () => void }) {
  const f = useContractForm({ employee_note: x.employee_note ?? "" }, attendance.ExceptionExplanation);
  const save = useMutation("POST /api/v1/attendance/me/exceptions/:id/explanation");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: x.attendance_exception_id }, body: { employee_note: f.values.employee_note.trim() } });
      invalidate("/api/v1/attendance");
      close();
      toast("Note sent to People");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Note not sent");
    }
  };
  return (
    <>
      <KeyValue items={[["Date", formatDate(x.work_date)], ["Detail", x.detail]]} />
      <Field label="Your Note" className="mt-3" {...f.status("employee_note")}>
        <TextAreaField {...f.field("employee_note")} placeholder="Client visit" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" busy={save.pending} onClick={() => void submit()}>Send Note</Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * My Devices
 * ------------------------------------------------------------------ */

export function MyDevicesPage() {
  const [params] = useSearchParams();
  const id = params.get("id");
  const modal = useModal();
  const confirm = useConfirm();
  const list = usePaged("GET /api/v1/devices/mine");
  const today = useApi("GET /api/v1/attendance/me/today");
  const remove = useMutation("POST /api/v1/devices/mine/:id/remove");
  const d = today.data?.device;
  const thisRegistered = d?.state === "registered";
  const full = !!d && !thisRegistered && !d.can_register;
  const register = () => modal.open({ title: "Register This Device", body: (close) => <RegisterForm close={close} /> });
  useScreenAction(d && !thisRegistered && d.can_register ? { label: "Register This Device", onSelect: register } : null);

  const drop = async (row: MyDevice) => {
    if (!(await confirm({ title: "Remove Device", body: `${row.label} will no longer count as registered.`, confirmLabel: "Remove Device", destructive: true }))) return;
    try {
      await remove.run({ params: { id: row.attendance_device_id }, body: {} });
      invalidate("/api/v1/devices");
      invalidate("/api/v1/attendance/me/today");
      toast("Device removed");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Device not removed");
    }
  };
  const open = (row: MyDevice) =>
    modal.open({
      title: row.label,
      body: (close) => (
        <>
          <KeyValue
            items={[
              ["Status", <Pill key="s" tone={DEVICE_STATUS[row.status].tone}>{DEVICE_STATUS[row.status].text}</Pill>],
              ["First Seen", formatDateTime(row.first_seen_at)],
              ["Last Punch", row.last_punch_at ? formatDateTime(row.last_punch_at) : null],
              ["Registered", row.registered_at ? formatDate(row.registered_at) : null],
              ["This Device", row.this_device ? "Yes" : "No"],
            ]}
          />
          <FormFooter>
            {row.status !== "removed" && (
              <Button variant="danger" icon="trash" busy={remove.pending} onClick={() => (close(), void drop(row))}>Remove Device</Button>
            )}
            <Button variant="primary" onClick={close}>Close</Button>
          </FormFooter>
        </>
      ),
    });

  const linked = useRef<string | null>(null);
  useEffect(() => {
    const row = id ? list.rows.find((r) => r.attendance_device_id === id) : undefined;
    if (row && linked.current !== id) {
      linked.current = id ?? null;
      open(row);
    }
  });

  return (
    <>
      <PageHeader
        title="My Devices"
        sub="Up to three registered"
        actions={d && !thisRegistered && d.can_register ? <Button variant="primary" icon="plus" onClick={register}>Register This Device</Button> : undefined}
      />
      {full && <Banner tone="info" icon="info">You have three registered devices. Remove one to add this one.</Banner>}
      <DataView
        title="Devices"
        list={list}
        rowKey={(r) => r.attendance_device_id}
        onRowClick={open}
        noun="device"
        empty={{ icon: "lock", title: "No Devices Yet", text: "The device you clock in from appears here." }}
        columns={[
          { key: "n", label: "Device", render: (r) => (r.this_device ? <>{r.label} <Pill tone="info">This Device</Pill></> : r.label) },
          { key: "s", label: <HelpTerm help={DEVICE_STATUS_HELP}>Status</HelpTerm>, render: (r) => <Pill tone={DEVICE_STATUS[r.status].tone}>{DEVICE_STATUS[r.status].text}</Pill> },
          { key: "f", label: "First Seen", render: (r) => formatDate(r.first_seen_at) },
          { key: "l", label: "Last Punch", desktop: true, render: (r) => (r.last_punch_at ? formatDateTime(r.last_punch_at) : null) },
        ]}
      />
    </>
  );
}

/** Register the device this session is on. A recent sign-in is asked for first when it has lapsed. */
function RegisterForm({ close }: { close: () => void }) {
  const fresh = useFreshSignIn();
  const f = useContractForm({ label: "" }, devices.DeviceRegister);
  const save = useMutation("POST /api/v1/devices/mine");
  const submit = async () => {
    if (!f.check()) return;
    const label = f.values.label.trim();
    try {
      const r = await fresh.guard(() => save.run({ body: label ? { label } : {} }));
      if (!r) return;
      invalidate("/api/v1/devices");
      invalidate("/api/v1/attendance/me/today");
      close();
      toast("Device registered");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Device not registered");
    }
  };
  return (
    <>
      <Field label="Device Name" optional {...f.status("label")}>
        <TextField {...f.field("label")} placeholder="Work Phone" maxLength={80} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={() => void submit()}>Register Device</Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * INTERIM: Work Location Requests (#87) and Policy Updates (#89)
 * ------------------------------------------------------------------ */

/** Shows the acknowledgment banner while the latest policy version waits on this person. */
function AckBanner() {
  const { data: p } = useApi("GET /api/v1/attendance/policies/current");
  const { navigate } = useRouter();
  if (!p || p.acknowledged_at) return null;
  return (
    <Banner tone="warn" icon="doc" actions={<Button onClick={() => navigate(hrefFor("ess", "policy-updates"))}>Read and Acknowledge</Button>}>
      <b>Attendance policy v{p.version} needs your acknowledgment.</b> {p.summary}
    </Banner>
  );
}


const TYPES: Array<[LocationRequestBody["type"], string]> = [["Temporary home-location change", "Temporary home-location change"], ["Remote day", "One-day remote-work exception"], ["Client visit", "Client-site visit"], ["Field correction", "Field-assignment correction"]];

export function WorkLocationRequestsPage() {
  const me = useMe();
  const modal = useModal();
  const setup = useApi("GET /api/v1/attendance/setup/:employee_id", { params: { employee_id: me.employee_id } });
  const list = usePaged("GET /api/v1/attendance/location-requests", { filters: { scope: "own" } });
  const s = setup.data;
  const open = (r: LocationRequest) =>
    modal.open({
      title: r.number,
      body: (
        <>
          <KeyValue items={[["Type", r.type], ["Dates", `${formatDate(r.from)} to ${formatDate(r.to)}`], ["Location", `${r.area} · ${r.radius_m} m`], ["Reason", r.reason], ["Status", <Pill tone={REQ_TONE[r.status]}>{r.status}</Pill>], ["People's note", r.hr_note ?? "None"]]} />
          <div className="mt-3 border-t border-border pt-3">
            {r.history.map((h, i) => <p key={i} className="text-2xs text-subtle-foreground">{formatDateTime(h.at)} · {h.by} · {h.text}</p>)}
          </div>
        </>
      ),
    });
  return (
    <>
      <PageHeader title="Work Location Requests" sub="Temporary clock-in locations" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Request", body: (close) => <RequestForm close={close} /> })}>New Request</Button>} />
      <AckBanner />
      <Grid cols={2}>
        {s ? (
          <Card>
            <CardHeader title="Your Location Today" />
            <KeyValue items={[["Arrangement", <><Pill>{s.arrangement}</Pill> {s.profile.split(" · policy")[0]}</>], ["Permanent home", s.home_area ? `Approved home · ${s.home_area} · fixed 100 m geofence` : "None on file"], ["Temporary location", <Pill tone={s.temporary_location.tone}>{s.temporary_location.text}</Pill>], ["Field assignment today", s.field_assignment_today ?? "None"], ["Office", s.office]]} />
          </Card>
        ) : <Card><LoadingRows /></Card>}
      </Grid>
      <DataView
        title="My Requests"
        rows={list.rows}
        rowKey={(r) => r.request_id}
        loading={list.loading}
        onRowClick={open}
        empty={{ icon: "target", title: "No Requests Yet", text: "Use New Request to ask for a temporary home, a one-day remote day, a client-site visit or a correction." }}
        columns={[
          { key: "n", label: "Request", render: (r) => r.number },
          { key: "t", label: "Type", render: (r) => r.type },
          { key: "d", label: "Dates", render: (r) => (r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} to ${formatDate(r.to)}`) },
          { key: "l", label: "Location", desktop: true, render: (r) => r.area },
          { key: "r", label: "Radius", align: "n", desktop: true, render: (r) => `${r.radius_m} m` },
          { key: "s", label: "Status", render: (r) => <Pill tone={REQ_TONE[r.status]}>{r.status}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="request" />}
      />
    </>
  );
}

function RequestForm({ close }: { close: () => void }) {
  const f = useContractForm(
    { type: "Remote day", from: "", to: "", address: "", reason: "", evidence: "" },
    { from: rules.required("Pick the first day"), to: (v, a) => (!v ? "Pick the last day" : v < (a.from as string) ? "Ends before it starts" : null), address: rules.min(6, "Enter the address"), reason: rules.min(10, "At least 10 characters") },
  );
  const save = useMutation("POST /api/v1/attendance/location-requests");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const r = await save.run({ body: { type: f.values.type as LocationRequestBody["type"], from: f.values.from, to: f.values.to, address: f.values.address, reason: f.values.reason, ...(f.values.evidence && { evidence: f.values.evidence }) } });
      invalidate("/api/v1/attendance");
      close();
      toast(`${r.number} sent to your line manager`);
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <Field label="Type"><SelectField options={TYPES} {...f.field("type")} /></Field>
      <Field label="From" {...f.field("from")}><DateField {...f.field("from")} min={todayIso()} /></Field>
      <Field label="To" {...f.field("to")}><DateField {...f.field("to")} min={f.values.from || todayIso()} /></Field>
      <Field label="Address" {...f.field("address")} info="Homes always use a fixed 100 m geofence. You cannot choose the radius."><TextField {...f.field("address")} placeholder="Street, area, city" /></Field>
      <Field label="Reason" {...f.field("reason")}><TextAreaField {...f.field("reason")} placeholder="Visiting a client" /></Field>
      <Field label="Evidence Label"><TextField {...f.field("evidence")} placeholder="tenancy-letter.pdf" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Submit Request</Button>
      </FormFooter>
    </>
  );
}

export function PolicyUpdatesPage() {
  const me = useMe();
  const cur = useApi("GET /api/v1/attendance/policies/current");
  const versions = usePaged("GET /api/v1/attendance/policies");
  const ack = useMutation("POST /api/v1/attendance/policies/:version/acknowledge");
  const modal = useModal();
  const p = cur.data;
  if (cur.error) return <ErrorState error={cur.error} onRetry={cur.reload} />;
  if (!p) return <LoadingRows count={6} />;
  const read = () =>
    modal.open({
      title: `Attendance Policy v${p.version}`,
      wide: true,
      body: (
        <>
          {[...new Set(p.settings.map((s) => s.section))].map((sec) => (
            <Card key={sec} className="mb-3">
              <CardHeader title={sec} />
              <KeyValue items={p.settings.filter((s) => s.section === sec).map((s) => [s.label, String(typeof s.value === "boolean" ? (s.value ? "On" : "Off") : s.kind === "mode" ? { record: "Record only", warn: "Warn", block: "Block" }[s.value as string] : s.value)])} />
            </Card>
          ))}
        </>
      ),
    });
  return (
    <>
      <PageHeader title="Policy Updates" sub={`Attendance policy · ${me.display_name}`} />
      <div className="mb-3 rounded-card border border-border bg-background px-3.5 py-3">
        <h2 data-ui="title" className="text-base">Policy v{p.version}</h2>
        <div data-copy="content">
          <p className="mt-1 text-sm leading-normal text-muted-foreground">{p.summary}</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">{p.changes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={read}>Read Full Policy</Button>
          {!p.acknowledged_at && (
            <Button variant="primary" icon="ok" busy={ack.pending} onClick={async () => (await ack.run({ params: { version: String(p.version) }, body: {} }), invalidate("/api/v1/attendance"), toast(`Policy v${p.version} acknowledged`))}>
              Acknowledge
            </Button>
          )}
        </div>
      </div>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Acknowledgment" right={p.acknowledged_at ? <Pill tone="ok">{`Acknowledged ${formatDate(p.acknowledged_at)}`}</Pill> : <Pill tone="err">Pending</Pill>} />
          <KeyValue items={[["Current version", `v${p.version}`], ["Published", formatDate(p.published_at)], ["Published by", p.published_by], ["Clock-in while pending", p.settings.find((s) => s.key === "ack_blocks")?.value ? "Blocked until acknowledged" : "Allowed, with a reminder"]]} />
        </Card>
        <Card>
          <CardHeader title="Full Policy" />
          <KeyValue items={p.settings.filter((s) => ["grace", "mode_remote", "mode_office", "dev_warn_new", "late_rule"].includes(s.key)).map((s) => [s.label, String(typeof s.value === "boolean" ? (s.value ? "On" : "Off") : s.kind === "mode" ? { record: "Record only", warn: "Warn", block: "Block" }[s.value as string] : s.value)])} />
        </Card>
      </Grid>
      <DataView
        title="All Versions"
        rows={versions.rows}
        rowKey={(v) => String(v.version)}
        loading={versions.loading}
        columns={[
          { key: "v", label: "Version", render: (v) => `v${v.version}` },
          { key: "p", label: "Published", render: (v) => formatDate(v.published_at) },
          { key: "s", label: "Summary", render: (v) => v.summary },
          { key: "a", label: "Your Acknowledgment", render: (v) => (v.acknowledged_at ? <Pill tone="ok">{formatDate(v.acknowledged_at)}</Pill> : <Pill tone="warn">Pending</Pill>) },
        ]}
        footer={<Pager page={versions.page} onPage={versions.setPage} noun="version" />}
      />
    </>
  );
}
