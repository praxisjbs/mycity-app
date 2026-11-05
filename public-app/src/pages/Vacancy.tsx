import { useState } from "react";
import type { PublicJob } from "@mycity/contract/contract.gen.ts";
import { Banner, Button, Card, CardHeader, Chain, DesktopOnly, formatDate, formatMoney, Icon, KeyValue, PageMessage, PhoneOnly, RichText, Skeleton, SkylineHero, Sub, type IconName } from "@mycity/ui";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { Link, useRouter } from "@/lib/router";
import { Page } from "@/shell/Page";
import { applicantsLine, EMPLOYMENT, factsOf, HIRING_STEP } from "./shared";

type Block = PublicJob["description"][number];

/** What the banner says for a role that takes no applications now. */
const NOT_OPEN: Record<Exclude<PublicJob["state"], "open">, { tone: "warn" | "info"; text: string }> = {
  paused: { tone: "warn", text: "This role is not taking applications right now. This link works again if it reopens." },
  closed: { tone: "info", text: "This role has closed. Our other open roles are on the careers page." },
  filled: { tone: "info", text: "This role has been filled. Thank you to everyone who applied." },
};

/**
 * Vacancy (#81): one role at a readable, shareable slug. Indexable while it is open. The role's
 * text arrives as blocks from the server's one Markdown renderer and is drawn with RichText. Apply
 * for This Role mints a one-time Apply link and opens it: beside the text on desktop, in a bar at
 * the foot on a phone. A paused, closed or filled role keeps its page and says so.
 */
export function Vacancy({ slug }: { slug: string }) {
  const { navigate } = useRouter();
  const v = useApi("GET /api/public/v1/jobs/:slug", { params: { slug } });
  const [problem, setProblem] = useState<string | null>(null);

  if (v.error)
    return (
      <Page title="Role Not Found">
        {v.error.status === 404 ? (
          <PageMessage icon="brief" title="Role Not Found" action={<Button variant="primary" onClick={() => navigate("/jobs")}>See Open Roles</Button>}>
            The link may be mistyped, or the role was never published.
          </PageMessage>
        ) : (
          <PageMessage title="This Role Did Not Load" action={<Button variant="primary" onClick={v.reload}>Try Again</Button>}>
            {v.error.message}
          </PageMessage>
        )}
      </Page>
    );
  const d = v.data;
  if (!d)
    return (
      <Page title="Careers" layout="open">
        <div aria-busy="true" className="rounded-sheet bg-deep p-8 phone:rounded-none phone:p-4">
          <Skeleton lines={3} />
        </div>
        <div className="mt-8 phone:px-4">
          <Skeleton lines={8} />
        </div>
      </Page>
    );

  const open = d.state === "open";
  const apply = async () => {
    setProblem(null);
    try {
      const { token } = await api.call("POST /api/public/v1/jobs/:slug/apply", { params: { slug } });
      navigate(`/apply/${encodeURIComponent(token)}`);
    } catch (e) {
      /* The role stopped taking applications since the page opened: read it again so the page says so. */
      if (e instanceof ApiError && e.status === 404) return v.reload();
      setProblem(e instanceof ApiError ? e.message : "The application did not start. Try again.");
    }
  };
  const pay = d.salary_min && d.salary_max ? `${formatMoney(d.salary_min, { kobo: false })} to ${formatMoney(d.salary_max, { kobo: false })}` : null;
  const facts: Array<{ icon: IconName; text: string }> = [...factsOf(d), ...(pay ? [{ icon: "wallet" as const, text: pay }] : [])];
  const details = [
    { label: "Employment Type", value: d.employment_type ? EMPLOYMENT[d.employment_type] : null },
    { label: "Working Days", value: d.working_days },
    { label: "Experience", value: d.min_experience_years ? `At least ${d.min_experience_years} years` : null },
    { label: "Probation", value: d.probation_months ? `${d.probation_months} months` : null },
    { label: "Reports To", value: d.reports_to },
    { label: "Closing Date", value: d.closes_at ? formatDate(d.closes_at) : null },
  ].filter((x): x is { label: string; value: string } => !!x.value);
  const notOpen = d.state === "open" ? null : NOT_OPEN[d.state];
  const applyButton = (
    <Button variant="primary" block onClick={apply}>
      Apply for This Role
    </Button>
  );

  return (
    <Page title={d.title} index={open} layout="open">
      <Link to="/jobs" className="mb-3 inline-flex min-h-tap items-center gap-1.5 text-sm font-strong text-muted-foreground no-underline hover:text-foreground phone:px-4">
        <Icon name="left" />
        All Roles
      </Link>
      <SkylineHero size="m" eyebrow={d.department} title={d.title} facts={facts} />
      {notOpen && (
        <Banner tone={notOpen.tone} className="mt-5 phone:mx-4" action={<Button size="sm" onClick={() => navigate("/jobs")}>See Open Roles</Button>}>
          {notOpen.text}
        </Banner>
      )}
      <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-3 phone:mt-5 phone:gap-6 phone:px-4 phone:pb-24">
        <article className="flex min-w-0 flex-col gap-9 md:col-span-2 phone:gap-7">
          <TextSection title="About MyCityApp" blocks={d.about_company} />
          <TextSection title="Role Overview" blocks={d.description} />
          <TextSection title="Required Experience and Qualifications" blocks={d.requirements} />
          <TextSection title="What We Are Looking For" blocks={d.nice_to_have} />
          {d.how_we_hire.length > 0 && (
            <section aria-labelledby="how-we-hire">
              <h2 id="how-we-hire" className="mb-3 font-heading text-xl">
                How We Hire
              </h2>
              <Chain label="How We Hire" steps={d.how_we_hire.map((s) => ({ label: HIRING_STEP[s] }))} />
            </section>
          )}
        </article>
        <aside className="phone:order-first">
          <Card as="section" className="flex flex-col gap-4 md:sticky md:top-6">
            <CardHeader title="The Role" />
            {details.length > 0 && <KeyValue layout="stacked" items={details} />}
            {open && (
              <DesktopOnly className="flex flex-col gap-2 border-t border-border pt-4">
                {applyButton}
                <Sub as="p" className="text-center">
                  {applicantsLine(d.applicants)}
                </Sub>
              </DesktopOnly>
            )}
            {problem && <Banner tone="err">{problem}</Banner>}
          </Card>
        </aside>
      </div>
      {open && (
        <PhoneOnly className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-background/95 px-4 pt-3 pb-safe-3 backdrop-blur">
          <Sub as="p" className="min-w-0 flex-1">
            {applicantsLine(d.applicants)}
          </Sub>
          <div className="flex-none">{applyButton}</div>
        </PhoneOnly>
      )}
    </Page>
  );
}

/** One part of the role's text under its heading; nothing at all when the role has none. */
function TextSection({ title, blocks }: { title: string; blocks: Block[] | null }) {
  if (!blocks || blocks.length === 0) return null;
  const id = `part-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 font-heading text-xl">
        {title}
      </h2>
      <RichText blocks={blocks} top={3} />
    </section>
  );
}
