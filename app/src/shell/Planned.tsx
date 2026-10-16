import { Button, ComingSoon, formatDate, PageHeader, SegmentedControl } from "@mycity/ui";
import { plan } from "@/lib/plan";
import { COMING } from "./coming-soon";

/**
 * The Prototype View switch (mock mode only, laptops and CI; F14): Full Design
 * opens every screen, As Delivered at Mn shows Coming Soon for the screens
 * planned after the milestone being delivered now. Never in a live build.
 */
export function ViewBar() {
  const { view, setView } = plan.useView();
  const now = plan.currentMilestone();
  return (
    <div data-ui-ignore="prototype view switch" className="mb-2.5">
      <SegmentedControl<"full" | "delivered">
        label="Prototype View"
        small
        value={view}
        onChange={setView}
        options={[
          ["full", "Full Design"],
          ["delivered", `As Delivered ${now?.key ?? "M1"}`],
        ]}
      />
    </div>
  );
}

/**
 * A screen that is not open yet (F14): its milestone and date for staff, and
 * what it will do. In mock mode, See Full Design switches the view back.
 */
export function PlannedScreen({ moduleKey, tab, label, m, mock }: { moduleKey: string; tab: string; label: string; m: string; mock: boolean }) {
  const ms = plan.milestone(m);
  const name = ms ? `Milestone ${ms.n}` : m;
  return (
    <>
      <PageHeader title={label} />
      <ComingSoon
        milestone={`${name}${ms?.demo ? ` · ${formatDate(ms.demo)}` : ""}`}
        line={`Opens with ${name}${ms?.name ? `, ${ms.name}` : ""}.`}
        features={COMING[`${moduleKey}/${tab}`] ?? []}
        action={mock ? <Button onClick={() => plan.setView("full")}>See Full Design</Button> : undefined}
      />
    </>
  );
}
