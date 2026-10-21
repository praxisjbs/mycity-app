import type { ModuleScreenProps } from "@/shell/screens";
import { Analytics } from "./Analytics";
import { Goals } from "./Goals";
import { Kpis } from "./Kpis";
import { Reviews } from "./Reviews";
import { Targets } from "./Targets";

/**
 * Performance Management (#29 to #33; docs/guides/performance.md): the goal cascade, a
 * department's month, each person's KPIs, review cycles and Analytics, on the real API.
 */
export default function Performance({ tab }: ModuleScreenProps) {
  if (tab === "targets") return <Targets />;
  if (tab === "kpis") return <Kpis />;
  if (tab === "reviews") return <Reviews />;
  if (tab === "analytics") return <Analytics />;
  return <Goals />;
}
