import type { ReactNode } from "react";
import type { Tone } from "@/api/types/common";
import { Grid, KpiCard } from "@mycity/ui";
import { toTrend } from "@/features/shared/wire";

/** A row of plain KPI tiles (no drill-down), four across. */
export function KpiTiles({ items, mobileCols = 1 }: { items: Array<{ key?: string; label: string; value: ReactNode; tone?: Tone; sub?: string; trend?: string; dir?: "up" | "dn" | "fl" }>; mobileCols?: 1 | 2 }) {
  return (
    <Grid cols={mobileCols === 2 ? "4m2" : 4}>
      {items.map((k) => (
        <KpiCard key={k.key ?? k.label} title={k.label} value={k.value} tone={k.tone} caption={k.trend ?? k.sub} trend={toTrend(k.dir)} />
      ))}
    </Grid>
  );
}
