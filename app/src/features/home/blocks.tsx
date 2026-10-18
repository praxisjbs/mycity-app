import type { HomeKpi } from "@/api/types/home";
import { toTrend } from "@/features/shared/wire";
import { useKpiDetail } from "./KpiDetail";
import { Grid, KpiCard } from "@mycity/ui";

/**
 * The frame Reports still draws on its INTERIM shapes (@/api/types/home); its own PR moves it
 * onto the contract as the Overview, Team and Alerts did.
 */

/** KPI tiles; each opens the records behind its number. */
export function KpiRow({ items, mobileCols = 1 }: { mobileCols?: 1 | 2; items: HomeKpi[] }) {
  const open = useKpiDetail();
  return (
    <Grid cols={mobileCols === 2 ? "4m2" : 4}>
      {items.map((k) => (
        <KpiCard key={k.key} title={k.label} value={k.value} tone={k.tone} caption={k.trend?.text} trend={toTrend(k.trend?.dir)} onOpen={() => open(k.key, k.label)} />
      ))}
    </Grid>
  );
}
