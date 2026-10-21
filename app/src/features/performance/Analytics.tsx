import { useApi } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard } from "@/features/shared/sections";
import { AreaChart, Card, DataView, ErrorState, Grid, HelpTerm, LoadingRows, monthName, PageHeader } from "@mycity/ui";
import { percent, rating } from "./status";

/**
 * Performance · Analytics (#33; docs/guides/performance.md §10): the year's goals and KPIs and
 * the current cycle's ratings, in the reader's scope.
 */
export function Analytics() {
  const a = useApi("GET /api/v1/performance/analytics");
  if (a.error) return <ErrorState error={a.error} onRetry={a.reload} />;
  if (!a.data) return (<><PageHeader title="Analytics" /><Card><LoadingRows count={6} /></Card></>);
  const d = a.data;
  const gap = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`);
  return (
    <>
      <PageHeader title="Analytics" sub={d.cycle ?? String(d.year)} />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Goals On Track", value: `${d.goals_on_track} of ${d.goals_total}`, tone: "ok" },
          { label: "Reviews Completed", value: `${d.reviews_completed} of ${d.reviews_total}` },
          { label: "Avg Self Rating", value: rating(d.average_self) ?? "" },
          { label: "Avg Manager Rating", value: rating(d.average_manager) ?? "" },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <AreaChart
          title="Goal Completion by Month"
          labels={d.completion.map((m) => monthName(Number(m.month.slice(5, 7)) - 1).slice(0, 3))}
          values={d.completion.map((m) => Math.round((m.attainment ?? 0) * 100))}
        />
        <BarsCard
          title="By Department"
          rows={d.by_department.map((r) => ({ label: r.department, pct: Math.round((r.attainment ?? 0) * 100), value: percent(r.attainment) ?? "" }))}
        />
      </Grid>
      <div className="mt-3">
        <DataView
          title="Self vs Manager Rating"
          rows={d.gap}
          rowKey={(r) => r.department_id}
          columns={[
            { key: "d", label: "Department", render: (r) => r.department },
            { key: "s", label: "Self", align: "n", render: (r) => r.self?.toFixed(1) ?? null },
            { key: "m", label: "Manager", align: "n", render: (r) => r.manager?.toFixed(1) ?? null },
            { key: "g", label: <HelpTerm help="Manager rating minus self rating.">Gap</HelpTerm>, align: "n", render: (r) => gap(r.gap) },
          ]}
        />
      </div>
    </>
  );
}
