import { Button, cn, formatDate, Icon, Pill } from "@mycity/ui";
import { currentMilestone, milestone, useView } from "@/lib/plan";
import { Page } from "./Layout";
import { Sub } from "./ui";

/** What each page will do, on its Coming Soon card. From the page as built and MILESTONES §9, §10. */
const COMING: Record<string, string[]> = {
  careers: ["Every open role at MyCity App, in one list", "Share a role's link anywhere", "Search by team or city"],
  vacancy: ["What the role is, what it asks for and how we hire", "The pay range from the role's grade", "Apply in one step, from any phone"],
  apply: ["Apply with your CV, from a link that is yours alone", "See your CV upload as it goes", "A reference you can quote, and a reply within five working days"],
  assess: ["Timed assessments, taken on any phone or laptop", "Every answer saved as you go", "Resume where you stopped if the connection drops"],
  sign: ["Read your offer and sign it with your finger", "The signed document locks and can be verified", "Decline with an optional reason"],
  verify: ["Check a signed MyCity App document by its reference", "Two checks: the wording, and the stored file", "No sign-in needed"],
};

/** The prototype view switch, as in demo.html. Never on production (lib/plan.ts). */
export function ViewBar() {
  const { view, setView } = useView();
  const delivered = view !== "full";
  const now = currentMilestone();
  return (
    <div className="mx-auto flex w-full max-w-[704px] items-center gap-2.5 px-[22px] pt-3 max-md:px-4">
      <span className="text-[11.5px] text-subtle-foreground">Prototype View</span>
      <span className="inline-flex h-7 items-center overflow-hidden rounded-full border border-input bg-background">
        <button type="button" aria-pressed={!delivered} onClick={() => setView("full")} className={cn("h-full px-2.5 text-[11.5px] font-semibold", !delivered ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}>
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
 * A page that is not open yet: what it will do, and, in a preview, its
 * milestone and date. Production shows strangers no milestone or date.
 */
export function ComingSoon({ page, title, m, production }: { page: string; title: string; m: string; production: boolean }) {
  const { setView } = useView();
  const ms = milestone(m);
  const name = ms ? `Milestone ${ms.n}` : m;
  const lines = COMING[page] ?? [];
  return (
    <Page title={title}>
      <div className="py-4 text-center">
        <span className="mx-auto mb-[11px] flex size-[46px] items-center justify-center rounded-[14px] bg-accent text-accent-foreground">
          <Icon name="clock" size="m" />
        </span>
        {/* A stranger is not shown the project's milestones or dates; a preview is. */}
        {!production && (
        <div className="mb-2">
          <Pill tone="warn">
            {name}
            {ms?.demo ? ` · ${formatDate(ms.demo)}` : ""}
          </Pill>
        </div>
        )}
        <h1 className="text-[16px]">Coming Soon</h1>
        <Sub className="mx-auto mt-1.5 max-w-[46ch]">{production ? `${title} opens here soon.` : `This page opens when ${name}${ms?.name ? `, ${ms.name},` : ""} is delivered.`}</Sub>
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
          <div>
            <Button onClick={() => setView("full")}>See the Full Design</Button>
          </div>
        )}
      </div>
    </Page>
  );
}
