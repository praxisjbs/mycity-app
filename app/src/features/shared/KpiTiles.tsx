import type { ReactNode } from "react";
import type { Tone } from "@/api/types/common";
import { Kpi } from "@/components/ui/data";
import { Grid } from "@/components/ui/layout";

/** A row of plain KPI tiles (no drill-down), four across. */
export function KpiTiles({ items, mobileCols = 1 }: { items: Array<{ key?: string; label: string; value: ReactNode; tone?: Tone; sub?: string; trend?: string; dir?: "up" | "dn" | "fl" }>; mobileCols?: 1 | 2 }) {
  return (
    <Grid cols={mobileCols === 2 ? "4m2" : 4}>
      {items.map((k) => (
        <Kpi key={k.key ?? k.label} label={k.label} value={k.value} tone={k.tone} trend={k.trend ?? k.sub} trendDir={k.dir ?? "fl"} />
      ))}
    </Grid>
  );
}
