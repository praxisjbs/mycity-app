import { Button, ComingSoon, formatDate, SegmentedControl } from "@mycity/ui";
import { plan } from "@/lib/plan";
import { Page } from "./Page";

/** What each page will do, on its Coming Soon card. From the page as built and MILESTONES §9, §10. */
const COMING: Record<string, string[]> = {
  careers: ["Every open role at MyCity App, in one list", "Share a role's link anywhere", "Search by team or city"],
  vacancy: ["What the role is, what it asks for and how we hire", "The pay range from the role's grade", "Apply in one step, from any phone"],
  apply: ["Apply with your CV, from a link that is yours alone", "See your CV upload as it goes", "A reference you can quote, and a reply within five working days"],
  assess: ["Timed assessments, taken on any phone or laptop", "Every answer saved as you go", "Resume where you stopped if the connection drops"],
  sign: ["Read your offer and sign it with your finger", "The signed document locks and can be verified", "Decline with an optional reason"],
  verify: ["Check a signed MyCity App document by its reference", "Two checks: the wording, and the stored file", "No sign-in needed"],
};

/** The Prototype View switch, in mock mode only (laptops and CI; F14). */
export function ViewBar() {
  const { view, setView } = plan.useView();
  const now = plan.currentMilestone();
  return (
    <div className="mx-auto w-full max-w-176 px-6 pt-3 phone:px-4" data-ui-ignore="prototype view switch">
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
 * A page that is not open yet (F14): what it will do, and on staging or a
 * laptop its milestone and date. A stranger on production sees neither.
 */
export function PlannedPage({ page, title, m, production, mock }: { page: string; title: string; m: string; production: boolean; mock: boolean }) {
  const ms = plan.milestone(m);
  const name = ms ? `Milestone ${ms.n}` : m;
  return (
    <Page title={title}>
      <ComingSoon
        bare
        level={2}
        milestone={production ? undefined : `${name}${ms?.demo ? ` · ${formatDate(ms.demo)}` : ""}`}
        line={production ? `${title} opens here soon.` : `Opens with ${name}${ms?.name ? `, ${ms.name}` : ""}.`}
        features={COMING[page] ?? []}
        action={mock ? <Button onClick={() => plan.setView("full")}>See Full Design</Button> : undefined}
      />
    </Page>
  );
}
