/**
 * Performance (docs/guides/performance.md §2, §12): one file per tab, and the parts the tabs
 * open. Goals, Scorecards and KPIs are filled by PR 2; Reviews, ReviewPage and CheckIn by PR 3;
 * Commitments by PR 4; Analytics by PR 5.
 */
import type { ModuleScreenProps } from "@/shell/screens";
import { Analytics } from "./Analytics";
import { Goals } from "./Goals";
import { Kpis } from "./Kpis";
import { Reviews } from "./Reviews";
import { Scorecards } from "./Scorecards";

export default function Performance({ tab }: ModuleScreenProps) {
  if (tab === "targets") return <Scorecards />;
  if (tab === "kpis") return <Kpis />;
  if (tab === "reviews") return <Reviews />;
  if (tab === "analytics") return <Analytics />;
  return <Goals />;
}
