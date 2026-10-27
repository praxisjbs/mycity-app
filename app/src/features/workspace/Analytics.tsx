/**
 * My Workspace · Analytics (docs/guides/workspace.md §10.1): how work is moving, mine or my team's,
 * over This Week, 30 or 90 days, This Year, or the reader's own dates (Custom Period). Export, for
 * holders of `workspace` export on a computer, makes a file of the figures through Home's reports
 * engine (POST /workspace/analytics/export): numbered, and downloaded here once it is made.
 */
import { useState } from "react";
import reports from "@mycity/contract/schemas/reports.js";
import type { HomeReportFormat } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { saveRun } from "@/api/exports";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import {
  AreaChart,
  Bars,
  Button,
  Card,
  CardHeader,
  DataView,
  DateRangeField,
  ErrorState,
  Field,
  Form,
  formatDate,
  FormatButton,
  FormFooter,
  Grid,
  KeyValue,
  LoadingRows,
  PageHeader,
  SegmentedControl,
  todayIso,
  toast,
  useContractForm,
  useIsPhone,
  useModal,
} from "@mycity/ui";
import { PRIORITY, useSetsForOthers } from "./shared";
import { useTaskPanel } from "./TaskPanel";

const BAND: Record<string, string> = { "1_3": "1 to 3 Days", "4_7": "4 to 7 Days", "8_14": "8 to 14 Days", "15_plus": "15 Days or More" };
const days = (n: number | null, none = "None yet") => (n === null ? none : `${n} days`);

type Period = "week" | "30d" | "90d" | "year" | "custom";
type Scope = "mine" | "team";
type Dates = { from: string; to: string };
/** What the screen reads and an Export makes: whose work, the period, a custom period's days. */
type Query = { scope: Scope; period: Period } & Partial<Dates>;

const PERIODS: Array<[Period, string]> = [
  ["week", "This Week"],
  ["30d", "30 Days"],
  ["90d", "90 Days"],
  ["year", "This Year"],
  ["custom", "Custom"],
];

/** Custom Period: From and To, checked as filled by the contract's own rule (at most 366 days, in order). */
function CustomPeriodForm({ initial, close, onPick }: { initial: Dates; close: () => void; onPick: (d: Dates) => void }) {
  const f = useContractForm(
    { period: initial },
    {
      safeParse: (v: { period: Dates }) => {
        const r = reports.WorkspaceAnalyticsExport.safeParse({ period: "custom", from: v.period.from || undefined, to: v.period.to || undefined, format: "xlsx" });
        return r.success ? r : { success: false, error: { issues: (r.error?.issues ?? []).map((i) => ({ ...i, path: ["period"] })) } };
      },
    },
  );
  const show = () => {
    if (!f.check()) return;
    onPick(f.values.period);
    close();
  };
  return (
    <Form onSubmit={show}>
      <Field label="Period" {...f.status("period")}>
        <DateRangeField value={f.values.period} onChange={(p) => f.set("period", p)} onProblem={f.field("period").onProblem} max={todayIso()} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          Show Period
        </Button>
      </FormFooter>
    </Form>
  );
}

/** Each format's choice under Export, as the Overview's Export words it. */
const EXPORT_AS: Record<HomeReportFormat, string> = { pdf: "Export PDF", xlsx: "Export XLSX" };

/**
 * Export: the figures as the screen reads them, in the format chosen, waited on and downloaded
 * here, toasted with its run's number. Desktop only (§10.2).
 */
function ExportAnalytics({ query }: { query: Query }) {
  const exporting = useMutation("POST /api/v1/workspace/analytics/export");
  const run = async (format: HomeReportFormat) => {
    try {
      const { run: done, saved } = await saveRun(
        exporting.run({ body: { ...query, format }, idempotencyKey: crypto.randomUUID() }),
        (id) => api.call("GET /api/v1/workspace/analytics/export/:id", { params: { id } }),
      );
      invalidate("/api/v1/home/report-runs");
      if (saved) toast(`${done.number} downloaded`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed. Try again.");
    }
  };
  return <FormatButton label="Export" formats={["pdf", "xlsx"]} busy={exporting.pending} onRun={run} item={(format) => EXPORT_AS[format]} size="md" />;
}

export function Analytics() {
  const others = useSetsForOthers();
  const phone = useIsPhone();
  const me = useMe();
  const modal = useModal();
  // My Team first for whoever may set work for others, once that is known; the person's choice after.
  const [picked, setScope] = useState<Scope | null>(null);
  const scope = picked ?? (others === undefined ? null : others ? "team" : "mine");
  const [period, setPeriod] = useState<Period>("30d");
  // A custom period's days, kept once picked; the screen reads Custom only with them.
  const [dates, setDates] = useState<Dates | null>(null);
  const [allLoad, setAllLoad] = useState(false);
  const query: Query = { scope: scope ?? "mine", period, ...(period === "custom" && dates ? dates : {}) };
  const { data, error, reload } = useApi("GET /api/v1/workspace/analytics", { query, enabled: scope !== null });
  const mayExport = me.grants.workspace?.includes("export") ?? false;
  // Custom asks for its days first; Cancel leaves the period as it was.
  const pickDates = () =>
    modal.open({
      title: "Custom Period",
      body: (close) => (
        <CustomPeriodForm
          initial={dates ?? { from: data?.from ?? "", to: data?.to ?? todayIso() }}
          close={close}
          onPick={(d) => {
            setDates(d);
            setPeriod("custom");
          }}
        />
      ),
    });
  const choosePeriod = (v: Period) => (v === "custom" ? pickDates() : setPeriod(v));
  const panel = useTaskPanel();
  const max = Math.max(1, ...(data?.workload.map((w) => w.open) ?? [1]));
  const maxPrio = Math.max(1, ...(data?.by_priority.map((p) => p.open) ?? [1]));
  const maxAge = Math.max(1, ...(data?.overdue_aging.map((a) => a.count) ?? [1]));
  const reasonsTotal = data?.overdue_by_reason.reduce((n, r) => n + r.count, 0) ?? 0;
  const load = data ? (phone && !allLoad ? data.workload.slice(0, 5) : data.workload) : [];
  return (
    <>
      <PageHeader
        title="Analytics"
        sub={data ? `${formatDate(data.from)} to ${formatDate(data.to)}` : undefined}
        actions={
          <>
            {others && scope && <SegmentedControl label="Whose Work" value={scope} onChange={setScope} options={[["mine", "Mine"], ["team", "My Team"]]} />}
            <SegmentedControl label="Period" value={period} onChange={choosePeriod} options={PERIODS} />
            {period === "custom" && <Button onClick={pickDates}>Change Dates</Button>}
            {mayExport && !phone && scope && <ExportAnalytics query={query} />}
          </>
        }
      />
      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <LoadingRows count={8} />}
      {data && (
        <>
          <KpiTiles
            mobileCols={2}
            items={[
              { key: "rate", label: "Completion Rate", value: data.completion_rate === null ? "None yet" : `${data.completion_rate}%` },
              { key: "over", label: "Overdue", value: String(data.overdue), tone: data.overdue ? "err" : undefined },
              { key: "avg", label: "Avg Completion", value: days(data.avg_completion_days) },
              { key: "open", label: "Open Tasks", value: String(data.open) },
            ]}
          />
          <Grid cols={2}>
            <AreaChart
              title="Tasks Completed per Week"
              help="Tasks done, out of those done or due in the period, gives the completion rate."
              values={data.completed_per_week.map((w) => w.count)}
              labels={data.completed_per_week.map((w) => formatDate(w.week_start))}
            />
            <Card>
              <CardHeader title="Workload by Person" right={phone && !allLoad && data.workload.length > 5 ? <button type="button" className="min-h-tap text-xs font-semibold text-primary" onClick={() => setAllLoad(true)}>View All</button> : undefined} />
              <Bars rows={load.map((w) => ({ label: w.employee.display_name, percent: Math.round((w.open / max) * 100), value: `${w.open} open` }))} />
              {!data.workload.length && <p className="text-2xs text-subtle-foreground">No open tasks.</p>}
            </Card>
          </Grid>
          <Grid cols={2}>
            <Card>
              <CardHeader title="Tasks by Priority" />
              <Bars rows={data.by_priority.map((p) => ({ label: PRIORITY[p.priority], percent: Math.round((p.open / maxPrio) * 100), value: `${p.open} open`, ...(p.priority === "urgent" ? { series: 4 as const } : {}) }))} />
            </Card>
            <DataView
              title="Overdue Tasks by Reason"
              rows={data.overdue_by_reason}
              rowKey={(r) => r.reason ?? "none"}
              empty={{ title: "Nothing Overdue" }}
              columns={[
                { key: "reason", label: "Reason", render: (r) => (r.reason ? (r.label ?? r.reason) : "No Reason Recorded") },
                { key: "count", label: "Count", align: "n", render: (r) => r.count },
                { key: "share", label: "Share", align: "n", render: (r) => `${Math.round((r.count / Math.max(1, reasonsTotal)) * 100)}%` },
              ]}
            />
          </Grid>
          <Grid cols={2}>
            <Card>
              <CardHeader title="Overdue Aging" />
              <Bars rows={data.overdue_aging.map((a) => ({ label: BAND[a.band] ?? a.band, percent: Math.round((a.count / maxAge) * 100), value: String(a.count), ...(a.band === "15_plus" ? { series: 4 as const } : {}) }))} />
              <KeyValue
                className="mt-3"
                items={[
                  ["Done", String(data.done)],
                  ["Cancelled", String(data.cancelled)],
                  ["Avg Cycle Time", days(data.cycle_days)],
                ]}
              />
            </Card>
            <DataView
              title="Blocked Work"
              rows={data.blocked.data}
              rowKey={(b) => b.task.task_id}
              onRowClick={(b) => b.task.visible && panel.open(b.task.task_id, b.task.title)}
              empty={{ title: "Nothing Blocked" }}
              columns={[
                { key: "task", label: "Task", render: (b) => <span data-copy="content">{`${b.task.number} ${b.task.title}`}</span> },
                { key: "note", label: "Blocked By", render: (b) => <span data-copy="content">{b.note}</span> },
                { key: "days", label: "Held For", align: "n", render: (b) => `${b.blocked_days} days` },
              ]}
            />
          </Grid>
        </>
      )}
      {panel.panel}
    </>
  );
}
