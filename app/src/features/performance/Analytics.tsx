/**
 * Performance · Analytics: the interim screen, on the in-browser mock until its pull request lands.
 * PR 5 replaces this with Performance Analytics against GET /performance/analytics.
 */
import { useApi } from "@/api/hooks";
import "@/api/types/performance";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard } from "@/features/shared/sections";
import { AreaChart, Card, cn, DataView, Grid, LoadingRows, PageHeader } from "@mycity/ui";

export function Analytics() {
  const a = useApi("GET /api/v1/performance/analytics");
  if (!a.data) return (<><PageHeader title="Analytics" sub="Performance across the organisation" /><Card><LoadingRows count={6} /></Card></>);
  const d = a.data;
  return (
    <>
      <PageHeader title="Analytics" sub="Performance across the organisation" />
      <KpiTiles items={[{ label: "Goals On Track", value: d.goals_on_track, tone: "ok" }, { label: "Reviews Completed", value: d.reviews_completed }, { label: "Avg Self Rating", value: d.average_self }, { label: "Avg Manager Rating", value: d.average_manager }]} />
      <Grid cols={2}>
        <AreaChart title="Goal Completion by Month" values={d.completion.values} labels={d.completion.labels} />
        <BarsCard title="By Department" rows={d.by_department} />
      </Grid>
      <Grid cols={2}>
        <DataView
          title="Self vs Manager Rating"
          right={<span className="text-2xs text-subtle-foreground">{d.gap_cycle}</span>}
          rows={d.gap}
          rowKey={(r) => r.department}
          columns={[
            { key: "d", label: "Department", render: (r) => r.department },
            { key: "s", label: "Self", align: "n", render: (r) => r.self },
            { key: "m", label: "Manager", align: "n", render: (r) => r.manager },
            { key: "g", label: "Gap", align: "n", render: (r) => <span className={cn(Number(r.gap) <= -0.4 && "font-semibold text-warning")}>{r.gap.replace("-", "−")}</span> },
          ]}
        />
      </Grid>
    </>
  );
}
