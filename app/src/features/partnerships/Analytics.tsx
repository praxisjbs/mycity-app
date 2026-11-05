import { useApi } from "@/api/hooks";
import "@/api/types/partnerships";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard } from "@/features/shared/sections";
import { AreaChart, Card, DataView, formatMonth, Grid, LoadingRows, Meter, PageHeader, Who } from "@mycity/ui";

/** Partnerships · Analytics (#55), on the mock until M7 PR 8 (docs/guides/partnerships.md §6.18, §10). */
export function Analytics() {
  const a = useApi("GET /api/v1/partnerships/analytics");
  const d = a.data;
  if (!d) return (<><PageHeader title="Analytics" sub="Monthly partnership performance by lead owner" /><Card><LoadingRows count={6} /></Card></>);
  return (
    <>
      <PageHeader title="Analytics" sub="Monthly partnership performance by lead owner" />
      <KpiTiles items={[{ label: "Prospects This Month", value: String(d.prospects) }, { label: "Meetings Held", value: String(d.meetings) }, { label: "Proposals Sent", value: String(d.proposals) }, { label: "Signed", value: String(d.signed), tone: "ok" }]} />
      <DataView
        title={formatMonth(d.period)}
        rows={d.by_owner}
        rowKey={(r) => r.owner.employee_id}
        columns={[
          { key: "o", label: "Lead Owner", render: (r) => <Who name={r.owner.display_name} sub={r.owner.department ?? undefined} /> },
          { key: "p", label: "Prospects", align: "n", render: (r) => r.prospects },
          { key: "m", label: "Meetings", align: "n", render: (r) => r.meetings, desktop: true },
          { key: "pr", label: "Proposals", align: "n", render: (r) => r.proposals },
          { key: "s", label: "Signed", align: "n", render: (r) => r.signed },
          { key: "a", label: "Active", align: "n", render: (r) => r.active, desktop: true },
          { key: "d", label: "Downloads", align: "n", render: (r) => r.downloads.toLocaleString("en-NG"), desktop: true },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <AreaChart title="Signed Partnerships per Month" values={d.signed_per_month.values} labels={d.signed_per_month.labels} />
        <BarsCard title="Downloads Attributed by Partner" rows={d.downloads} note="Only a live partnership attributes anything." />
      </Grid>
      <Grid cols={2}>
        <DataView
          title="Six Months"
          rows={d.months}
          rowKey={(r) => r.month}
          columns={[
            { key: "m", label: "Month", render: (r) => r.month },
            { key: "p", label: "Prospects", align: "n", render: (r) => r.prospects },
            { key: "pr", label: "Proposals", align: "n", render: (r) => r.proposals },
            { key: "s", label: "Signed", align: "n", render: (r) => r.signed },
            { key: "c", label: "Conversion", render: (r) => <span className="block w-32"><Meter pct={r.conversion_pct} label={`${r.conversion_pct}%`} /></span> },
          ]}
        />
      </Grid>
    </>
  );
}
