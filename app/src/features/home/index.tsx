import { useEffect, useState } from "react";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { AlertRule, HomeAlert, HomeReport } from "@/api/types/home";
import { useMe } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Bars, KV, Pill, Tile } from "@/components/ui/data";
import { Card, Grid, PageHead } from "@/components/ui/layout";
import { Grow, useModal } from "@/components/ui/Modal";
import { Chips, ErrorBlock, LoadingRows, Pager, Table } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { Who } from "@/components/ui/data";
import { formatDateTime } from "@/lib/format";
import { hrefFor, useRouter, useSearchParams } from "@/lib/router";
import type { ModuleScreenProps } from "@/shell/screens";
import { Block, InfoCard, KpiRow, toBars } from "./blocks";
import { Field, FormRow, Input, rules, Select, ToggleRow, useForm } from "@/components/form";

export default function Home({ tab, id }: ModuleScreenProps) {
  if (tab === "team") return <Team />;
  if (tab === "alerts") return <Alerts openId={id} />;
  if (tab === "reports") return <Reports />;
  return <Overview />;
}

function Overview() {
  const { data, error, reload } = useApi("GET /api/v1/home/overview");
  const { navigate } = useRouter();
  const me = useMe();
  if (error) return <ErrorBlock error={error} onRetry={reload} />;
  if (!data) return <LoadingRows count={8} />;
  const canNew = me.grants.workspace?.includes("create");
  return (
    <>
      <PageHead
        title={data.greeting}
        sub={data.subtitle}
        actions={
          <>
            <Button icon="doc" onClick={() => toast("Export queued. The file arrives in your Mailbox.")}>Export</Button>
            {canNew && (
              <Button variant="primary" icon="plus" onClick={() => navigate(hrefFor("workspace", "tasks", { new: "1" }))}>
                New
              </Button>
            )}
          </>
        }
      />
      {data.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </>
  );
}

function Team() {
  const summary = useApi("GET /api/v1/home/team/summary");
  const [status, setStatus] = useState("all");
  const list = usePaged("GET /api/v1/home/team", { filters: status === "all" ? {} : { status } });
  const { navigate } = useRouter();
  if (summary.error) return <ErrorBlock error={summary.error} onRetry={summary.reload} />;
  return (
    <>
      <PageHead title="Team" sub={`Who is in, where they are, and how they are tracking${summary.data ? ` · ${summary.data.scope_label}` : ""}`} />
      {summary.data && <KpiRow items={summary.data.kpis} />}
      <Chips
        value={status}
        onChange={setStatus}
        options={[["all", "Everyone"], ["late", "Late"], ["remote", "Remote"], ["leave", "On leave"], ["no_clockout", "No clock-out"]]}
      />
      <Table
        title="Team Roster"
        right={list.page && <Pill>{`${list.page.total} people`}</Pill>}
        rows={list.rows}
        rowKey={(r) => r.employee.employee_id}
        loading={list.loading}
        error={list.error}
        onRowClick={(r) => navigate(hrefFor("people", "employees", { id: r.employee.employee_id }))}
        columns={[
          { key: "e", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.job_title} /> },
          { key: "d", label: "Department", desktop: true, render: (r) => r.employee.department },
          { key: "t", label: "Today", render: (r) => <Pill tone={r.today.tone}>{r.today.text}</Pill> },
          { key: "c", label: "Clock-in", render: (r) => r.clock_in ?? "None" },
          { key: "k", label: "KPI", desktop: true, render: (r) => `${r.kpi_pct}%` },
          { key: "o", label: "Open Tasks", align: "n", desktop: true, render: (r) => r.open_tasks },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="person" nounPlural="people" />}
      />
      <Grid cols={2} className="mt-3">
        {summary.data && (
          <InfoCard title="Attendance This Month by Person" info="Click a KPI card above to see exactly who is on site, remote, late or missing a clock-out.">
            <Bars rows={toBars(summary.data.attendance_bars)} />
          </InfoCard>
        )}
        <InfoCard title="How the Team View Reads" info="The same attendance and task data the other screens use, filtered to the people you manage. Today's status is read from today's punches.">
          <KV items={[["Source", "Attendance and tasks, live"], ["Scope", "The people you manage"], ["A name", "Opens that person's record"]]} />
        </InfoCard>
      </Grid>
    </>
  );
}

const SEV = { high: ["err", "High"], medium: ["warn", "Medium"], low: ["info", "Low"] } as const;

function Alerts({ openId }: { openId: string | null }) {
  const me = useMe();
  const modal = useModal();
  const [, setParams] = useSearchParams();
  const summary = useApi("GET /api/v1/home/alerts/summary");
  const [cat, setCat] = useState("all");
  const list = usePaged("GET /api/v1/home/alerts", { filters: cat === "all" ? {} : { category: cat } });
  const manage = me.grants.home?.includes("edit") ?? false;

  const openAlert = (a: HomeAlert) => modal.open({ title: "Alert", body: (close) => <AlertDetail alert={a} close={close} />, onClose: () => setParams({ id: null }, { replace: true }) });
  useEffect(() => {
    if (!openId) return;
    const a = list.rows.find((r) => r.home_alert_id === openId);
    if (a) openAlert(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, list.rows.length]);

  return (
    <>
      <PageHead
        title="Alerts"
        sub="Rules that have crossed a threshold and nobody has cleared yet"
        actions={
          manage && (
            <>
              <Button onClick={() => modal.open({ title: "Alert Rules", wide: true, body: <RuleList /> })}>Alert Rules</Button>
              <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Alert Rule", body: (close) => <RuleForm close={close} /> })}>
                New Rule
              </Button>
            </>
          )
        }
      />
      {summary.data && <KpiRow items={summary.data.kpis} />}
      {summary.data && (
        <Chips value={cat} onChange={setCat} options={[["all", `All ${summary.data.categories.reduce((a, c) => a + c.count, 0)}`], ...summary.data.categories.map((c) => [c.value, c.label] as [string, string])]} />
      )}
      <Table
        title="Open Alerts"
        right={list.page && <Pill tone="warn">{`${list.page.total} open`}</Pill>}
        rows={list.rows}
        rowKey={(r) => r.home_alert_id}
        loading={list.loading}
        error={list.error}
        onRowClick={(a) => (setParams({ id: a.home_alert_id }, { replace: true }), openAlert(a))}
        empty={{ title: "No open alerts", text: "Everything that needed action has been dealt with." }}
        columns={[
          { key: "a", label: "Alert", render: (r) => r.title },
          { key: "t", label: "Trigger", desktop: true, render: (r) => r.trigger },
          { key: "w", label: "Who Can Clear", desktop: true, render: (r) => r.who_clears },
          { key: "g", label: "Age", render: (r) => r.age },
          { key: "o", label: "Over By", render: (r) => <span className="inline-block rounded-full bg-warning-soft px-[9px] py-0.5 text-[11px] font-semibold whitespace-nowrap text-warning">{r.over_by}</span> },
          { key: "s", label: "Severity", render: (r) => <Pill tone={SEV[r.severity][0]}>{SEV[r.severity][1]}</Pill> },
        ]}
        footer={<Pager page={list.page} onPage={list.setPage} noun="alert" />}
      />
      <Grid cols={2} className="mt-3">
        {summary.data && (
          <InfoCard title="Where Alerts Come From, Last 30 Days" info="Every one of these is a configured threshold, not code. Changing a number needs no deploy.">
            <Bars rows={toBars(summary.data.sources)} />
          </InfoCard>
        )}
        <InfoCard
          title="Alerts Are Not Notifications"
          info="A notification is something that happened to you. It is read once and gone. An alert is something nobody has done; it sits here until a person with the right permission clears it, and it ages while it waits."
        >
          <KV items={[["Escalation", "High severity goes to the CEO after 14 days"], ["Clearing", "Needs the permission the rule names"], ["Audit", "Who cleared it and when is logged"]]} />
        </InfoCard>
      </Grid>
    </>
  );
}

function AlertDetail({ alert, close }: { alert: HomeAlert; close: () => void }) {
  const clear = useMutation("POST /api/v1/home/alerts/:id/clear");
  const { navigate } = useRouter();
  const act = async (outcome: "cleared" | "dismissed") => {
    await clear.run({ params: { id: alert.home_alert_id }, body: { outcome } });
    invalidate("/api/v1/home/alerts");
    close();
    toast(outcome === "cleared" ? "Alert cleared, logged against you." : "Alert dismissed, logged against you.");
  };
  return (
    <>
      <h3 className="mb-2 text-[15px]">{alert.title}</h3>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Pill tone={SEV[alert.severity][0]}>{SEV[alert.severity][1]}</Pill>
        <Pill>{alert.trigger}</Pill>
        <Pill tone="warn">{`Over ${alert.over_by}`}</Pill>
      </div>
      <Card>
        <KV items={[["Trigger", alert.trigger], ["Who can clear", alert.who_clears], ["Raised", formatDateTime(alert.raised_at)], ["Over threshold", alert.over_by]]} />
      </Card>
      <div className="-mx-[18px] mt-4 -mb-4 flex flex-wrap justify-end gap-2 border-t border-border px-[18px] py-3">
        {alert.link && <Button onClick={() => (close(), navigate(alert.link!))}>Open Record</Button>}
        <Grow />
        <Button disabled={clear.pending} onClick={() => act("dismissed")}>Dismiss</Button>
        <Button variant="primary" disabled={clear.pending} onClick={() => act("cleared")}>
          Clear This Alert
        </Button>
      </div>
    </>
  );
}

function RuleList() {
  const list = usePaged("GET /api/v1/home/alert-rules");
  const patch = useMutation("PATCH /api/v1/home/alert-rules/:id");
  const toggle = async (r: AlertRule, enabled: boolean) => {
    await patch.run({ params: { id: r.home_alert_rule_id }, body: { enabled } });
    list.reload();
    toast(enabled ? "Rule enabled" : "Rule disabled, its alerts stop");
  };
  if (list.error) return <ErrorBlock error={list.error} />;
  return (
    <>
      {list.rows.map((r) => (
        <ToggleRow key={r.home_alert_rule_id} title={r.name} text={r.example} checked={r.enabled} onChange={(v) => toggle(r, v)} />
      ))}
      <Pager page={list.page} onPage={list.setPage} noun="rule" className="px-0" />
    </>
  );
}

const METRICS: Array<[string, string]> = [["late_arrivals", "Late arrivals"], ["inactivity", "Partnership inactivity"], ["approval_ageing", "Approval ageing"], ["document_expiry", "Document expiry"], ["budget", "Budget threshold"]];

function RuleForm({ close }: { close: () => void }) {
  const f = useForm(
    { name: "", metric: "late_arrivals", threshold: "", window_days: "30", severity: "medium" },
    { name: rules.required("Name the rule"), threshold: (v) => (/^\d+$/.test(v) ? null : "A whole number"), window_days: (v) => (/^\d+$/.test(v) && Number(v) > 0 ? null : "Days, above 0") },
  );
  const save = useMutation("POST /api/v1/home/alert-rules");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { name: f.values.name, metric: f.values.metric, threshold: Number(f.values.threshold), window_days: Number(f.values.window_days), severity: f.values.severity as "medium" } });
      invalidate("/api/v1/home/alert-rules");
      close();
      toast("Alert rule created. It runs on the next cycle.");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <FormRow>
        <Field label="Rule Name" {...f.field("name")} htmlFor="rn">
          <Input id="rn" placeholder="3 lates monthly" {...f.field("name")} />
        </Field>
        <Field label="Metric">
          <Select options={METRICS} {...f.field("metric")} />
        </Field>
      </FormRow>
      <FormRow>
        <Field label="Threshold" {...f.field("threshold")}>
          <Input inputMode="numeric" placeholder="3" {...f.field("threshold")} />
        </Field>
        <Field label="Window, Days" {...f.field("window_days")}>
          <Input inputMode="numeric" {...f.field("window_days")} />
        </Field>
      </FormRow>
      <Field label="Severity" info="High severity escalates to the CEO after 14 days.">
        <Select options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} {...f.field("severity")} />
      </Field>
      <div className="-mx-[18px] mt-2 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>
          Create Rule
        </Button>
      </div>
    </>
  );
}

const RSTATUS = { scheduled: ["ok", "Scheduled"], paused: ["neutral", "Paused"], on_demand: ["info", "On demand"] } as const;

function Reports() {
  const modal = useModal();
  const summary = useApi("GET /api/v1/home/reports/summary");
  const reports = usePaged("GET /api/v1/home/reports");
  const runs = usePaged("GET /api/v1/home/report-runs");
  const run = useMutation("POST /api/v1/home/reports/:id/run");
  const runNow = async (r: HomeReport) => {
    const res = await run.run({ params: { id: r.home_report_id }, body: { format: "pdf" } });
    invalidate("/api/v1/home/report-runs");
    toast(`${res.number} generated. Download it from Recent Runs.`);
  };
  return (
    <>
      <PageHead title="Reports" sub="Scheduled and on demand · Managers and the CEO" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Report", body: (close) => <ReportForm close={close} /> })}>New Report</Button>} />
      {summary.data && <KpiRow items={summary.data.kpis} />}
      {reports.error && <ErrorBlock error={reports.error} onRetry={reports.reload} />}
      <Grid cols={3}>
        {reports.rows.map((r) => (
          <Tile key={r.home_report_id} title={r.name} text={r.cadence}>
            <Pill tone={RSTATUS[r.status][0]}>{RSTATUS[r.status][1]}</Pill>
            <Pill>{r.audience}</Pill>
            <Button size="sm" className="ml-auto" disabled={run.pending} onClick={() => runNow(r)}>
              Run Now
            </Button>
          </Tile>
        ))}
      </Grid>
      <Pager page={reports.page} onPage={reports.setPage} noun="report" className="px-0" />
      <Grid cols={2} className="mt-3">
        <Table
          title="Recent Runs"
          rows={runs.rows}
          rowKey={(r) => r.run_id}
          loading={runs.loading}
          onRowClick={(r) => toast(`${r.number} downloading`)}
          columns={[
            { key: "r", label: "Report", render: (r) => r.report },
            { key: "l", label: "Last Run", render: (r) => formatDateTime(r.run_at) },
            { key: "p", label: "Recipients", desktop: true, render: (r) => r.recipients },
            { key: "f", label: "Format", render: (r) => r.formats },
          ]}
          footer={<Pager page={runs.page} onPage={runs.setPage} noun="run" />}
        />
        <InfoCard
          title="How a Report Is Built"
          info="Reports are permission gated. A card only renders for a role that may see it, and a report is generated as its recipient, so nobody receives a row they could not open."
        >
          <KV items={[["Source", "The same queries the screens use"], ["Formats", "PDF to read, XLSX to work, day-first dates"], ["Delivery", "Email on a schedule, or on demand"], ["Retention", "Every file is kept and re-downloadable"]]} />
        </InfoCard>
      </Grid>
    </>
  );
}

function ReportForm({ close }: { close: () => void }) {
  const f = useForm({ name: "", source: "attendance", schedule: "Every weekday at 18:00", recipients: "" }, { name: rules.required("Name the report"), recipients: rules.required("Who receives it") });
  const save = useMutation("POST /api/v1/home/reports");
  const submit = async () => {
    if (!f.check()) return;
    await save.run({ body: { ...f.values, formats: ["pdf"] } });
    invalidate("/api/v1/home/reports");
    close();
    toast("Report scheduled");
  };
  return (
    <>
      <Field label="Report Name" {...f.field("name")}>
        <Input {...f.field("name")} placeholder="Weekly leave summary" />
      </Field>
      <Field label="Source" info="The query the report runs: the same one its screen uses, so a report never disagrees with a page.">
        <Select options={[["attendance", "Attendance"], ["tasks", "Tasks"], ["expenses", "Expenses"], ["recruitment", "Recruitment"], ["partnerships", "Partnerships"]]} {...f.field("source")} />
      </Field>
      <Field label="Schedule">
        <Select options={[["Every weekday at 18:00", "Every weekday at 18:00"], ["Mondays at 08:00", "Mondays at 08:00"], ["First working day of the month", "First working day of the month"], ["On demand", "On demand only"]]} {...f.field("schedule")} />
      </Field>
      <Field label="Recipients" {...f.field("recipients")}>
        <Input {...f.field("recipients")} placeholder="Operations, CEO" />
      </Field>
      <div className="-mx-[18px] mt-2 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>
          Schedule Report
        </Button>
      </div>
    </>
  );
}
