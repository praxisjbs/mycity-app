import type { ReactNode } from "react";
import type { HomeKpi } from "@/api/types/home";
import { toTrend } from "@/features/shared/wire";
import { useKpiDetail } from "./KpiDetail";
import { Card, CardHeader, Grid, KpiCard } from "@mycity/ui";

/**
 * The frames Team, Alerts and Reports still draw on their INTERIM shapes
 * (@/api/types/home); each tab's own PR moves it onto the contract as the Overview did.
 */

/** A card with a title, the common frame of Home's blocks. `info` makes the title a help term (§5.2). */
export function InfoCard({ title, info, right, children }: { title: string; info?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} help={info} right={right} />
      {children}
    </Card>
  );
}

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
