import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/data";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHead } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { currentMilestone, milestone, useView } from "@/lib/plan";
import { COMING } from "./coming-soon";

/**
 * The prototype view switch (demo.html's ESS bar, on every screen): "Full
 * Design" or "As Delivered at Mn", Mn being the milestone delivered now
 * (lib/plan.ts currentMilestone). Never on production.
 */
export function ViewBar() {
  const { view, setView } = useView();
  const delivered = view !== "full";
  const now = currentMilestone();
  return (
    <div data-ui-ignore="prototype view switch" className="mb-2.5 flex items-center gap-2.5">
      <span className="text-[11.5px] text-subtle-foreground">Prototype View</span>
      <span className="inline-flex h-7 items-center overflow-hidden max-md:h-11 rounded-full border border-input bg-background">
        <button
          type="button"
          aria-pressed={!delivered}
          onClick={() => setView("full")}
          className={cn("h-full px-2.5 text-[11.5px] font-semibold", !delivered ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          Full Design
        </button>
        <button
          type="button"
          aria-pressed={delivered}
          onClick={() => setView("delivered")}
          className={cn("h-full border-l border-border px-2.5 text-[11.5px] font-semibold", delivered ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          As Delivered at {now?.key ?? "M1"}
        </button>
      </span>
    </div>
  );
}

/**
 * A screen that is not open yet: its milestone, the date, and what it will do
 * (the demo's "Coming Soon" card). On production there is no way round it; in
 * a preview, "See the Full Design" switches the view back.
 */
export function ComingSoon({ moduleKey, tab, label, m, production }: { moduleKey: string; tab: string; label: string; m: string; production: boolean }) {
  const { setView } = useView();
  const ms = milestone(m);
  const name = ms ? `Milestone ${ms.n}` : m;
  const lines = COMING[`${moduleKey}/${tab}`] ?? [];
  return (
    <>
      <PageHead title={label} sub={`Arrives with ${name}`} />
      <Card className="flex flex-col items-center py-8 text-center">
        <span className="mb-[11px] flex size-[46px] items-center justify-center rounded-[14px] bg-accent text-accent-foreground">
          <Icon name="clock" size="m" />
        </span>
        <div className="mb-2">
          <Pill tone="warn">
            {name}
            {ms?.demo ? ` · ${formatDate(ms.demo)}` : ""}
          </Pill>
        </div>
        <h3 data-ui="title" className="text-[16px]">Coming Soon</h3>
        <p className="mx-auto mt-1.5 max-w-[46ch] text-[12.5px] text-subtle-foreground">
          This screen opens when {name}
          {ms?.name ? `, ${ms.name},` : ""} is delivered.
        </p>
        {lines.length > 0 && (
          <ul className="mx-auto my-4 inline-flex list-none flex-col gap-[7px] p-0 text-left text-[12.5px] text-muted-foreground">
            {lines.map((l) => (
              <li key={l} className="flex items-start gap-2">
                <Icon name="ok" className="mt-[3px] size-[14px] text-success" />
                {l}
              </li>
            ))}
          </ul>
        )}
        {!production && (
          <div className={lines.length ? undefined : "mt-4"}>
            <Button onClick={() => setView("full")}>See the Full Design</Button>
          </div>
        )}
      </Card>
    </>
  );
}
