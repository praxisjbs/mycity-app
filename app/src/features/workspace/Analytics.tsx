/** My Workspace · Analytics (docs/guides/workspace.md §10.1): how work is moving, mine or my team's. */
import { useState } from "react";
import { useApi } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { AreaChart, Bars, Card, CardHeader, DataView, ErrorState, formatDate, Grid, KeyValue, LoadingRows, PageHeader, SegmentedControl, useIsPhone } from "@mycity/ui";
import { LATE, PRIORITY, type LateReason } from "./shared";
import { useTaskPanel } from "./TaskPanel";

const BAND: Record<string, string> = { "1_3": "1 to 3 Days", "4_7": "4 to 7 Days", "8_14": "8 to 14 Days", "15_plus": "15 Days or More" };
const days = (n: number | null, none = "None yet") => (n === null ? none : `${n} days`);

export function Analytics() {
  const me = useMe();
  const phone = useIsPhone();
  const [scope, setScope] = useState<"mine" | "team">(me.manages_people ? "team" : "mine");
  const [period, setPeriod] = useState<"30d" | "90d" | "year">("30d");
  const [allLoad, setAllLoad] = useState(false);
  const { data, error, reload } = useApi("GET /api/v1/workspace/analytics", { query: { scope, period } });
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
            {me.manages_people && <SegmentedControl label="Whose Work" value={scope} onChange={setScope} options={[["mine", "Mine"], ["team", "My Team"]]} />}
            <SegmentedControl label="Period" value={period} onChange={setPeriod} options={[["30d", "30 Days"], ["90d", "90 Days"], ["year", "This Year"]]} />
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
              empty={{ title: "Nothing Overdue", text: "Every open task is on time." }}
              columns={[
                { key: "reason", label: "Reason", render: (r) => (r.reason ? LATE[r.reason as LateReason] : "No Reason Recorded") },
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
              empty={{ title: "Nothing Blocked", text: "No task is held right now." }}
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
