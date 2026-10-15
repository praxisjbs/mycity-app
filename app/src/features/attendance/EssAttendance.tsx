import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { AttendanceEvent, LocationRequestBody, LocationRequest } from "@/api/types/attendance";
import { useMe } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { AreaChart } from "@/components/ui/charts";
import { Banner, EmptyState, KV, Pill } from "@/components/ui/data";
import { Card, CardHeader, DesktopOnly, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { ErrorBlock, LoadingRows, Pager, Table } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { formatDate, formatDateTime, formatMonth, formatTime, todayIso } from "@/lib/format";
import { hrefFor, useRouter } from "@/lib/router";
import { DEVICE_TONE } from "./Devices";
import { CASE_TONE, REQ_TONE } from "./PeopleAttendance";
import { DateField, Field, FormFooter, rules, SelectField, TextAreaField, TextField, useContractForm } from "@/components/form";

const STATUS: Record<AttendanceEvent["status"], { tone: "ok" | "warn" | "err" | "info" | "neutral"; text: string }> = {
  on_time: { tone: "ok", text: "On Time" }, late: { tone: "warn", text: "Late" }, absent: { tone: "err", text: "Absent" }, leave: { tone: "info", text: "On Leave" },
  review: { tone: "warn", text: "Under Review" }, remote: { tone: "ok", text: "Remote" }, weekend: { tone: "ok", text: "Saturday" },
};
const hours = (m: number | null) => (m == null ? "None" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

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

export function MyAttendancePage() {
  const me = useMe();
  const month = todayIso().slice(0, 7);
  const today = useApi("GET /api/v1/attendance/me/today");
  const summary = useApi("GET /api/v1/attendance/me/summary", { query: { month } });
  const list = usePaged("GET /api/v1/attendance/me");
  const t = today.data;
  const chartRows = [...list.rows].reverse().filter((r) => r.worked_minutes != null);
  const todayCard = t && (
    <Card>
      <CardHeader title={`Today, ${formatDate(t.date)}`} right={<Pill tone={t.state === "clocked_in" || t.state === "complete" ? "ok" : t.state === "unavailable" ? "info" : "neutral"}>{t.state === "clocked_in" ? "Clocked in" : t.state === "complete" ? "Complete" : t.state === "unavailable" ? "On Leave" : "Not clocked in"}</Pill>} />
      <KV items={[["Expected location", t.location_label], ["Schedule", `${t.work_pattern} · ${t.shift_start} to ${t.shift_end}`], ["Clock in", t.clock_in_at ? formatTime(t.clock_in_at) : "None"], ["Clock out", t.clock_out_at ? formatTime(t.clock_out_at) : "None"]]} />
    </Card>
  );
  const chart = chartRows.length > 1 ? <AreaChart title="Net Hours per Day" values={chartRows.map((r) => Math.round((r.worked_minutes ?? 0) / 6) / 10)} labels={chartRows.map((r) => formatDate(r.date))} note="Saturdays run 09:00 to 15:00, so they show shorter." /> : <EmptyState icon="chart" title="Not Enough Days Yet" text="The chart appears after two complete days." />;
  const events = (
    <Table
      title="My Clock Events"
      right={<Button onClick={() => toast(`${formatMonth(month)} exported. It arrives in your Mailbox.`)}>Export Month</Button>}
      rows={list.rows}
      rowKey={(r) => r.event_id}
      loading={list.loading}
      columns={[
        { key: "d", label: "Date", render: (r) => formatDate(r.date) },
        { key: "i", label: "Clock In", render: (r) => (r.clock_in_at ? formatTime(r.clock_in_at) : "None") },
        { key: "o", label: "Clock Out", render: (r) => (r.clock_out_at ? formatTime(r.clock_out_at) : "None") },
        { key: "l", label: "Location", desktop: true, render: (r) => r.location },
        { key: "h", label: "Hours", align: "n", render: (r) => hours(r.worked_minutes) },
        { key: "s", label: "Status", render: (r) => <Pill tone={STATUS[r.status].tone}>{r.status === "late" ? `Late ${r.late_minutes}m` : STATUS[r.status].text}</Pill> },
      ]}
      footer={<Pager page={list.page} onPage={list.setPage} noun="day" />}
    />
  );
  const cases = summary.data?.open_cases ?? [];
  const casesTable = cases.length > 0 && (
    <Table
      title="My Corrections and Exceptions"
      rows={cases}
      rowKey={(c) => c.case_id}
      columns={[
        { key: "n", label: "Case", render: (c) => c.number },
        { key: "t", label: "Type", render: (c) => c.type },
        { key: "d", label: "Date", render: (c) => formatDate(c.date) },
        { key: "s", label: "Status", render: (c) => <Pill tone={CASE_TONE[c.status]}>{c.status}</Pill> },
      ]}
    />
  );
  if (today.error) return <ErrorBlock error={today.error} onRetry={today.reload} />;
  return (
    <>
      <PageHead title="My Attendance" sub={`${formatMonth(month)} · ${me.display_name}${t ? ` · ${t.work_pattern.split(" · ")[0]}` : ""}`} />
      <AckBanner />
      {summary.data && <KpiTiles items={summary.data.kpis} mobileCols={2} />}
      <PhoneCards
        items={[
          ...(todayCard ? [{ icon: "clock" as const, title: "Today", sub: t?.clock_in_at ? `In at ${formatTime(t.clock_in_at)}` : "Not clocked in", body: todayCard }] : []),
          { icon: "chart", title: "My Net Hours", sub: `${chartRows.length} days`, body: chart },
          { icon: "clock", title: "My Clock Events", sub: `${list.page?.total ?? 0} records`, body: events, wide: true },
          ...(casesTable ? [{ icon: "alert" as const, title: "My Corrections", sub: `${cases.length} open`, body: casesTable }] : []),
        ]}
      />
      <DesktopOnly>
        <Grid cols="1.4/1">{todayCard ?? <LoadingRows />}{chart}</Grid>
        {events}
        {casesTable && <div className="mt-3">{casesTable}</div>}
      </DesktopOnly>
    </>
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
          <KV items={[["Type", r.type], ["Dates", `${formatDate(r.from)} to ${formatDate(r.to)}`], ["Location", `${r.area} · ${r.radius_m} m`], ["Reason", r.reason], ["Status", <Pill tone={REQ_TONE[r.status]}>{r.status}</Pill>], ["People's note", r.hr_note ?? "None"]]} />
          <div className="mt-3 border-t border-border pt-3">
            {r.history.map((h, i) => <p key={i} className="text-[11.5px] text-subtle-foreground">{formatDateTime(h.at)} · {h.by} · {h.text}</p>)}
          </div>
        </>
      ),
    });
  return (
    <>
      <PageHead title="Work Location Requests" sub="Temporary clock-in locations" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Request", body: (close) => <RequestForm close={close} /> })}>New Request</Button>} />
      <AckBanner />
      <Grid cols={2}>
        {s ? (
          <Card>
            <CardHeader title="Your Location Today" />
            <KV items={[["Arrangement", <><Pill>{s.arrangement}</Pill> {s.profile.split(" · policy")[0]}</>], ["Permanent home", s.home_area ? `Approved home · ${s.home_area} · fixed 100 m geofence` : "None on file"], ["Temporary location", <Pill tone={s.temporary_location.tone}>{s.temporary_location.text}</Pill>], ["Field assignment today", s.field_assignment_today ?? "None"], ["Office", s.office]]} />
          </Card>
        ) : <Card><LoadingRows /></Card>}
      </Grid>
      <Table
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

export function MyDevicesPage() {
  const modal = useModal();
  const list = usePaged("GET /api/v1/attendance/devices", { filters: { scope: "own" } });
  const active = list.rows.filter((d) => d.status === "Enrolled" || d.status === "Pending Review").length;
  return (
    <>
      <PageHead title="My Devices" sub="Phones and laptops you clock in from" actions={<Button variant="primary" icon="plus" disabled={active >= 3} onClick={() => modal.open({ title: "Register This Device", body: (close) => <DeviceForm close={close} /> })}>Register This Device</Button>} />
      <AckBanner />
      {active >= 3 && <Banner tone="info" icon="info">You have three devices. Ask People to remove one before registering another.</Banner>}
      <Table
        title="My Devices"
        rows={list.rows}
        rowKey={(d) => d.device_id}
        loading={list.loading}
        empty={{ icon: "lock", title: "No Devices Yet", text: "The device you clock in from is recorded on your first punch." }}
        columns={[
          { key: "n", label: "Device", render: (d) => d.name },
          { key: "f", label: "First Seen", render: (d) => formatDate(d.first_seen) },
          { key: "l", label: "Last Punch", desktop: true, render: (d) => (d.last_punch ? formatDateTime(d.last_punch) : "None") },
          { key: "s", label: "Status", render: (d) => <Pill tone={DEVICE_TONE[d.status]}>{d.status}</Pill> },
          { key: "e", label: "Next Punch", render: (d) => <Pill tone={d.effect.tone}>{d.effect.text}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="device" />}
      />
    </>
  );
}

function DeviceForm({ close }: { close: () => void }) {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const guess = `${/iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android phone" : /Mac/.test(ua) ? "Mac" : "This computer"} · ${/Edg\//.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Browser"}`;
  const f = useContractForm({ name: guess, why: "" }, { name: rules.required("Name the device") });
  const save = useMutation("POST /api/v1/attendance/devices");
  return (
    <>
      <Field label="Device Name" {...f.field("name")}><TextField {...f.field("name")} /></Field>
      <Field label="Reason" optional><TextField {...f.field("why")} placeholder="Replaced broken phone" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={async () => { if (!f.check()) return; try { await save.run({ body: { name: f.values.name, reason: f.values.why } }); invalidate("/api/v1/attendance/devices"); close(); toast("Sent to People for review"); } catch { toast(save.error?.message ?? "Not registered"); } }}>Send for Review</Button>
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
  if (cur.error) return <ErrorBlock error={cur.error} onRetry={cur.reload} />;
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
              <KV items={p.settings.filter((s) => s.section === sec).map((s) => [s.label, String(typeof s.value === "boolean" ? (s.value ? "On" : "Off") : s.kind === "mode" ? { record: "Record only", warn: "Warn", block: "Block" }[s.value as string] : s.value)])} />
            </Card>
          ))}
        </>
      ),
    });
  return (
    <>
      <PageHead title="Policy Updates" sub={`Attendance policy · ${me.display_name}`} />
      <div className="mb-3 rounded-card border border-border bg-background px-[15px] py-[13px]">
        <h4 data-ui="title" className="text-[14.5px]">Policy v{p.version}</h4>
        <div data-copy="content">
          <p className="mt-[5px] text-[13px] leading-normal text-muted-foreground">{p.summary}</p>
          <ul className="mt-2 list-disc pl-5 text-[12.5px] text-muted-foreground">{p.changes.map((c) => <li key={c}>{c}</li>)}</ul>
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
          <KV items={[["Current version", `v${p.version}`], ["Published", formatDate(p.published_at)], ["Published by", p.published_by], ["Clock-in while pending", p.settings.find((s) => s.key === "ack_blocks")?.value ? "Blocked until acknowledged" : "Allowed, with a reminder"]]} />
        </Card>
        <Card>
          <CardHeader title="Full Policy" />
          <KV items={p.settings.filter((s) => ["grace", "mode_remote", "mode_office", "dev_warn_new", "late_rule"].includes(s.key)).map((s) => [s.label, String(typeof s.value === "boolean" ? (s.value ? "On" : "Off") : s.kind === "mode" ? { record: "Record only", warn: "Warn", block: "Block" }[s.value as string] : s.value)])} />
        </Card>
      </Grid>
      <Table
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
