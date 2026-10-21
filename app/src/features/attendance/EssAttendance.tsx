import attendance from "@mycity/contract/schemas/attendance.js";
import devices from "@mycity/contract/schemas/devices.js";
import type { AttendanceDay, AttendanceEvent, AttendanceException, AttendanceToday, FieldAssignment, MyDevice, PayItem, TemporarySite } from "@mycity/contract/contract.gen.ts";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { saveExport } from "@/api/exports";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useFreshSignIn } from "@/auth/FreshSignIn";
import { hrefFor, useRouter, useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { MonthPicker } from "@/features/shared/MonthPicker";
import { useClock } from "./ClockButton";
import { HomeLocationCard } from "./HomeLocation";
import { AssignmentView, MyFieldAssignments, useAssignmentLink } from "./FieldAssignments";
import { DEVICE_STATUS, DEVICE_STATUS_HELP, EXCEPTION_TYPE, PAY_KIND, PUNCH_STATE, UNCLEAR_HELP, dayStatus, hours, lateBy, locationShown, recentMonths } from "./labels";
import { payColumns, payDetails } from "./PayItems";
import { Banner, BarChart, Button, Card, CardHeader, DataView, ErrorState, ExportButton, Field, type FieldBinding, formatDate, formatDateTime, formatMonth, formatTime, FormFooter, Grid, HelpTerm, KeyValue, KpiCard, PageHeader, Pager, Pill, SegmentedControl, TextAreaField, TextField, TimeField, toast, todayIso, useConfirm, useContractForm, useIsPhone, useModal } from "@mycity/ui";
import { DayRoute, MyTemporarySites } from "./TemporarySites";

/**
 * ESS · My Attendance (#9, with the person's temporary sites, each day's route of check-ins, and the
 * field assignments made before PR 4) and My Devices (#88)
 * (docs/guides/attendance.md §10). Work Location Requests (#87) is WorkLocationRequests.tsx, Policy
 * Updates (#89) features/policies/PolicyUpdates.tsx.
 * Everything here is the caller's own: the routes take no employee id.
 */

/** A clock-out's time, and System Clock-Out when the system made it after the shift ended (§6.14). */
function clockOutOf(at: string | null, automatic: boolean): ReactNode {
  if (!at) return null;
  if (!automatic) return formatTime(at);
  return (
    <span className="inline-flex items-center gap-1.5">
      {formatTime(at)}
      <Pill tone="info">System Clock-Out</Pill>
    </span>
  );
}

/** Today's place as the Today card names it; a worksite and an approved request's day by their own name. */
const LOCATION_NAME: Partial<Record<AttendanceToday["location"]["kind"], string>> = {
  home: "Approved Home",
  temporary_home: "Temporary Home",
  remote: "Remote",
  none: "No Worksite",
};

/* ------------------------------------------------------------------ *
 * My Attendance
 * ------------------------------------------------------------------ */

export function MyAttendancePage() {
  const [params] = useSearchParams();
  const { navigate } = useRouter();
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
  const openAssignment = useCallback((a: FieldAssignment) => modal.open({ title: a.number, wide: true, body: (close) => <AssignmentView a={a} close={close} /> }), [modal]);
  useAssignmentLink(params.get("assignment"), openAssignment, { mine: true });
  // A site opens where the person's sites are kept, with its approval and Withdraw Submission.
  const openSite = (site: TemporarySite) => navigate(hrefFor("ess", "work-location-requests", { site: site.temporary_site_id }));
  const openFigure = (status: FigureStatus) =>
    modal.open({ title: `${FIGURE[status]}, ${formatMonth(month)}`, wide: true, body: <FigureDays month={month} status={status} /> });
  const explain = (x: AttendanceException) => modal.open({ title: EXCEPTION_TYPE[x.exception_type], body: (close) => <ExplainForm x={x} close={close} /> });
  // A reminder's notice (`?clock=`) opens the clock panel, once.
  const clockLink = params.get("clock");
  const clockOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!clockLink || !clock.today || clockOpened.current === clockLink) return;
    clockOpened.current = clockLink;
    if (clock.ready && !clock.unavailable) clock.open();
  }, [clockLink, clock]);

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
          ["Clock Out", clockOutOf(t.clock_out_at, t.clock_out_automatic)],
          ["Location", LOCATION_NAME[t.location.kind] ?? t.location.name],
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
            <ExportButton onExport={() => saveExport(api.call("POST /api/v1/attendance/me/export", { body: { month } }))}>Export Month</ExportButton>
          </>
        }
      />
      <HomeLocationCard openOnLoad={params.get("home") === "set"} />
      {todayCard}
      <MyTemporarySites openSite={openSite} />
      <MyFieldAssignments open={openAssignment} />
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
        <KpiCard title="Hours Worked" value={s ? hours(s.worked_minutes) : ""} help="From the first clock-in to the last clock-out. A System Clock-Out counts to the shift's end." />
      </Grid>
      <MyPayItems month={month} group="deductions" />
      <MyPayItems month={month} group="overtime" />
      {open.rows.length > 0 && (
        <DataView
          title="Open Exceptions"
          list={open}
          rowKey={(x) => x.attendance_exception_id}
          onRowClick={explain}
          noun="exception"
          columns={[
            { key: "t", label: "Exception", render: (x) => (x.exception_type === "location_unverified" ? <HelpTerm help={UNCLEAR_HELP}>{EXCEPTION_TYPE[x.exception_type]}</HelpTerm> : EXCEPTION_TYPE[x.exception_type]) },
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
              .map((d) => ({ label: formatDate(d.attendance_date).slice(0, 5), value: Math.round(d.worked_minutes / 6) / 10, series: d.status === "late" ? 3 : 1 }))}
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
  { key: "o", label: "Clock Out", render: (d) => clockOutOf(d.last_clock_out_at, d.clock_out_automatic) },
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

/** One of my days: its punches with what the server decided about each, and Give Real Time on a System Clock-Out. */
function MyDay({ date, day }: { date: string; day?: AttendanceDay }) {
  const modal = useModal();
  const events = usePaged("GET /api/v1/attendance/me/events", { filters: { date } });
  const checkIns = usePaged("GET /api/v1/attendance/me/check-ins", { filters: { date } });
  const automatic = events.rows.find((e) => e.source === "system" && e.event_type === "clock_out" && !e.excluded);
  const giveTime = (e: AttendanceEvent) => modal.open({ title: "Give Real Time", body: (close) => <GiveRealTime e={e} close={close} /> });
  return (
    <>
      {day && (
        <KeyValue
          items={[
            ["Status", <Pill key="s" tone={dayStatus(day).tone}>{dayStatus(day).text}</Pill>],
            ["Hours", day.worked_minutes ? hours(day.worked_minutes) : null],
            ...(day.late_minutes ? ([["Late By", lateBy(day.late_minutes)]] as Array<[string, string]>) : []),
            ...(day.early_minutes ? ([["Left Early By", lateBy(day.early_minutes)]] as Array<[string, string]>) : []),
            ...(day.overtime_minutes ? ([["Overtime", lateBy(day.overtime_minutes)]] as Array<[string, string]>) : []),
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
          { key: "l", label: "Location", render: (e: AttendanceEvent) => locationShown(e) },
          { key: "d", label: "Device", desktop: true, render: (e: AttendanceEvent) => e.device_label },
          {
            key: "r",
            label: "Result",
            render: (e: AttendanceEvent) =>
              e.excluded ? <Pill tone="err">Not Counted</Pill> : e.source === "system" ? <Pill tone="info">System Clock-Out</Pill> : <Pill tone={PUNCH_STATE[e.validation_state].tone}>{PUNCH_STATE[e.validation_state].text}</Pill>,
          },
        ]}
      />
      <DayRoute className="mt-3" punches={events.rows} checkIns={checkIns.rows} />
      {automatic && (
        <FormFooter>
          <Button className="phone:w-full" icon="clock" onClick={() => giveTime(automatic)}>Give Real Time</Button>
        </FormFooter>
      )}
    </>
  );
}

/** Give the real leaving time of a System Clock-Out, with a note; People keep or correct it (§6.8, §6.14). */
function GiveRealTime({ e, close }: { e: AttendanceEvent; close: () => void }) {
  const f = useContractForm({ real_time: "", employee_note: "" }, attendance.RealTimeGiven);
  const save = useMutation("POST /api/v1/attendance/me/events/:id/explanation");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: e.attendance_event_id }, body: { real_time: f.values.real_time, employee_note: f.values.employee_note.trim() } });
      invalidate("/api/v1/attendance");
      close();
      toast("Time sent to People");
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) f.setServerErrors(err.fields);
      else toast(err instanceof ApiError ? err.message : "Time not sent");
    }
  };
  return (
    <>
      <KeyValue items={[["Date", formatDate(e.work_date)], ["System Clock-Out", formatTime(e.occurred_at)]]} />
      <Field label="Real Time" className="mt-3" {...f.status("real_time")}>
        <TimeField {...(f.field("real_time") as FieldBinding<string> & { name: string })} />
      </Field>
      <Field label="Your Note" {...f.status("employee_note")}>
        <TextAreaField {...f.field("employee_note")} placeholder="Left at 16:00" rows={3} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" busy={save.pending} onClick={() => submit()}>Send Time</Button>
      </FormFooter>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * My deductions and overtime for the month (§6.17)
 * ------------------------------------------------------------------ */

/** The month's deductions, or its overtime, as cards under the figures; nothing when there are none. */
function MyPayItems({ month, group }: { month: string; group: "deductions" | "overtime" }) {
  const modal = useModal();
  const list = usePaged("GET /api/v1/attendance/me/pay-items", { filters: { month, group } });
  const phone = useIsPhone();
  if (list.rows.length === 0) return null;
  const open = (x: PayItem) =>
    modal.open({
      title: PAY_KIND[x.kind],
      body: (close) => (
        <>
          <KeyValue items={payDetails(x)} />
          <FormFooter>
            <Button variant="primary" onClick={close}>Close</Button>
          </FormFooter>
        </>
      ),
    });
  return (
    <DataView
      className="mt-3"
      title={group === "deductions" ? "Deductions" : "Overtime"}
      list={list}
      rowKey={(x) => x.attendance_pay_item_id}
      onRowClick={open}
      noun={group === "deductions" ? "deduction" : "overtime item"}
      columns={payColumns({ person: false, kind: group === "deductions", phone })}
    />
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
        <Button variant="primary" icon="send" busy={save.pending} onClick={() => submit()}>Send Note</Button>
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
              <Button variant="danger" icon="trash" busy={remove.pending} onClick={() => (close(), drop(row))}>Remove Device</Button>
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
        <Button variant="primary" busy={save.pending} onClick={() => submit()}>Register Device</Button>
      </FormFooter>
    </>
  );
}
