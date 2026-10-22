/**
 * ESS · My Performance · My Scorecard: the person's quarter at a glance. Interim, on the in-browser
 * mock: the KPIs this month and what they roll up to. Performance PR 3 replaces it with the
 * scorecard's sections, score to date, rating and Agree Scorecard (docs/guides/performance.md §10).
 */
import type { MyPerformance } from "@/api/types/ess";
import { toBars } from "@/features/shared/wire";
import { Bars, Card, CardHeader, cn } from "@mycity/ui";

/** The KPIs this month, weighted. */
export function MyKpisCard({ p }: { p: MyPerformance }) {
  return (
    <Card>
      <CardHeader title="My KPIs This Month" />
      <Bars rows={toBars(p.kpis)} note="Weighted by KPI" />
    </Card>
  );
}

/** What the person's work rolls up to, to the top. */
export function RollsUpCard({ p }: { p: MyPerformance }) {
  return (
    <Card>
      <CardHeader title="Rolls Up To" />
      <div className="tl">
        {p.chain.map((c) => (
          <div key={c.title} className={cn("tl-dot relative pb-3.5 last:pb-0", c.top && "hi", c.mine && "ok")}>
            <b className="block text-xs font-semibold">{c.title}</b>
            <span className="text-2xs text-subtle-foreground">{c.level}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
