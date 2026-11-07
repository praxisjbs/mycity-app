import { useState, type ReactNode } from "react";
import type { PublicJob } from "@mycity/contract/contract.gen.ts";
import {
  Banner,
  Button,
  formatDate,
  formatMoney,
  HireSteps,
  IconList,
  PageMessage,
  Panel,
  Quote,
  RichText,
  RoleCard,
  RolePart,
  RoleTile,
  RoleTiles,
  SectionHead,
  ShareCard,
  Skeleton,
  SkylineHero,
  StickyColumns,
  type IconName,
} from "@mycity/ui";
import { api, ApiError } from "@/api/client";
import { useApi, usePaged } from "@/api/hooks";
import { siteUrl, useCopy } from "@/lib/copy";
import { useRouter } from "@/lib/router";
import { Page } from "@/shell/Page";
import { applicantsLine, EMPLOYMENT, factsOf, HIRING_STEP, PATTERN } from "./shared";

type Block = PublicJob["description"][number];

/** What the banner says for a role that takes no applications now. */
const NOT_OPEN: Record<Exclude<PublicJob["state"], "open">, { tone: "warn" | "info"; text: string }> = {
  paused: { tone: "warn", text: "This role is not taking applications right now. This link works again if it reopens." },
  closed: { tone: "info", text: "This role has closed. Our other open roles are on the careers page." },
  filled: { tone: "info", text: "This role has been filled. Thank you to everyone who applied." },
};

/** The words of a block, compared without case or spacing. */
const textOf = (b: Block | undefined) => (b && b.kind !== "bullets" && b.kind !== "numbered" ? b.spans.map((s) => s.text).join("").trim() : "");
const fold = (t: string) => t.toLowerCase().replace(/\s+/g, " ");
/** A description's own heading for how the role is measured (`## Key Performance Indicators (KPIs)`). */
const KPI = /key performance indicators/i;

/**
 * The description cut at its measures: the role's text up to its KPI heading, and the KPIs as their
 * own part (the heading as the role wrote it, its opening words, and each measure as a tile).
 */
function splitMeasures(blocks: Block[]) {
  const at = blocks.findIndex((b) => b.kind === "heading" && b.level === 2 && KPI.test(textOf(b)));
  if (at < 0) return { text: blocks, measures: null };
  const rest = blocks.slice(at + 1);
  const end = rest.findIndex((b) => b.kind === "heading" && b.level === 2);
  const own = end < 0 ? rest : rest.slice(0, end);
  const list = own.find((b): b is Extract<Block, { kind: "bullets" | "numbered" }> => b.kind === "bullets" || b.kind === "numbered");
  return {
    text: [...blocks.slice(0, at), ...(end < 0 ? [] : rest.slice(end))],
    measures: { title: textOf(blocks[at]), lead: own.filter((b) => b !== list), items: list ? list.items.map((spans) => spans.map((s) => s.text).join("")) : [] },
  };
}

/**
 * What We Are Looking For as the design states it: its first sentence large, the rest under it. A
 * text that does not open with a paragraph stays as it was written.
 */
function statement(blocks: Block[]): { lead: string; rest: Block[] } | null {
  const first = blocks[0];
  if (!first || first.kind !== "paragraph" || first.spans.some((s) => s.bold || s.italic || s.href)) return null;
  const words = textOf(first);
  const m = /^(.+?[.!?])\s+(.+)$/s.exec(words);
  const span = (text: string) => ({ text, bold: false, italic: false, href: null });
  if (!m) return { lead: words, rest: blocks.slice(1) };
  return { lead: m[1]!, rest: [{ kind: "paragraph", spans: [span(m[2]!)] }, ...blocks.slice(1)] };
}

/**
 * Vacancy (#81): one role at a readable, shareable slug, indexable while it is open. The role's hero
 * over Lagos's skyline (All Roles, its team, its facts, Apply for This Role and Share Role), then its
 * text part by part beside The Role card, both sticking with the shorter waiting; More Roles of its
 * team under them. On a phone the card comes first and Apply sits in the bar at the foot. A paused,
 * closed or filled role keeps its page and says so. About MyCityApp is the index's, not each role's.
 */
export function Vacancy({ slug }: { slug: string }) {
  const { navigate } = useRouter();
  const v = useApi("GET /api/public/v1/jobs/:slug", { params: { slug } });
  const code = v.data?.department_code ?? null;
  const more = usePaged("GET /api/public/v1/jobs", { filters: code ? { department: code } : {}, enabled: !!code });
  const [problem, setProblem] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  if (v.error)
    return (
      <Page title="Vacancy" layout="split">
        <Panel bare>
          {v.error.status === 404 ? (
            <PageMessage icon="brief" title="Role Not Found" action={<Button variant="primary" size="lg" onClick={() => navigate("/jobs")}>See Open Roles</Button>}>
              The link may be mistyped, or the role was never published.
            </PageMessage>
          ) : (
            <PageMessage title="This Role Did Not Load" action={<Button variant="primary" size="lg" onClick={v.reload}>Try Again</Button>}>
              {v.error.message}
            </PageMessage>
          )}
        </Panel>
      </Page>
    );
  const d = v.data;
  if (!d)
    return (
      <Page title="Vacancy">
        <div aria-busy="true" className="public-wrap py-12">
          <Skeleton lines={3} />
          <div className="mt-10">
            <Skeleton lines={8} />
          </div>
        </div>
      </Page>
    );

  const open = d.state === "open";
  const link = siteUrl(`/jobs/${d.slug}`);
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
  const closes = d.closes_at ? formatDate(d.closes_at) : null;
  const pay = d.salary_min && d.salary_max ? `${formatMoney(d.salary_min, { kobo: false })} to ${formatMoney(d.salary_max, { kobo: false })}` : null;
  const facts: Array<{ icon: IconName; text: string }> = [
    ...factsOf(d),
    ...(pay ? [{ icon: "wallet" as const, text: pay }] : []),
    ...(closes ? [{ icon: "calendar" as const, text: `Closes ${closes}` }] : []),
  ];
  const details = [
    { label: "Employment", value: d.employment_type ? EMPLOYMENT[d.employment_type] : null },
    { label: "Working Days", value: d.working_days },
    { label: "Experience", value: d.min_experience_years ? `At least ${d.min_experience_years} years` : null },
    { label: "Reports To", value: d.reports_to },
    { label: "Probation", value: d.probation_months ? `${d.probation_months} months` : null },
  ].filter((x): x is { label: string; value: string } => !!x.value);
  const notOpen = d.state === "open" ? null : NOT_OPEN[d.state];
  const { text, measures } = splitMeasures(own(d.description, "Role Overview") ?? []);
  const wanted = own(d.nice_to_have, "What We Are Looking For");
  const said = wanted ? statement(wanted) : null;
  const requirements = own(d.requirements, "Required Experience and Qualifications");
  const others = more.rows.filter((r) => r.slug !== d.slug).slice(0, 3);

  return (
    <Page
      title={d.title}
      index={open}
      bar={
        open ? (
          <>
            <p>
              {applicantsLine(d.applicants)}.{closes ? ` Closes ${closes}.` : ""}
            </p>
            <Button variant="primary" onClick={apply}>
              Apply
            </Button>
          </>
        ) : undefined
      }
    >
      <SkylineHero size="role" record back={{ label: "All Roles", href: "/jobs" }} eyebrow={d.department} title={d.title} facts={facts} note={open ? applicantsLine(d.applicants) : undefined}>
        {open && (
          <>
            <Button variant="primary" size="lg" onClick={apply}>
              Apply for This Role
            </Button>
            <Button variant="glass" size="lg" onClick={() => copy("hero", link)}>
              {copied === "hero" ? "Link Copied" : "Share Role"}
            </Button>
          </>
        )}
      </SkylineHero>
      {notOpen && (
        <div className="public-wrap mt-5">
          <Banner tone={notOpen.tone} action={<Button size="sm" onClick={() => navigate("/jobs")}>See Open Roles</Button>}>
            {notOpen.text}
          </Banner>
        </div>
      )}
      <div className="public-wrap pt-12 pb-8 phone:pt-14">
        <StickyColumns layout="side" phoneFirst={1}>
          <article className="min-w-0">
            {text.length > 0 && (
              <RolePart title="Role Overview">
                <RichText look="site" blocks={text} top={3} />
              </RolePart>
            )}
            {measures && (
              <RolePart title={measures.title} record>
                {measures.lead.length > 0 && <RichText look="site" blocks={measures.lead} top={3} />}
                {measures.items.length > 0 && <IconList icon="trend" label={measures.title} items={measures.items} />}
              </RolePart>
            )}
            {requirements && (
              <RolePart title="Required Experience and Qualifications">
                <RichText look="site" blocks={requirements} top={3} />
              </RolePart>
            )}
            {wanted && (
              <RolePart title="What We Are Looking For">
                {said ? (
                  <Quote look="feature" lead={said.lead}>
                    {said.rest.length > 0 ? <Paragraphs blocks={said.rest} /> : null}
                  </Quote>
                ) : (
                  <RichText look="site" blocks={wanted} top={3} />
                )}
              </RolePart>
            )}
            {d.how_we_hire.length > 0 && (
              <RolePart title="How We Hire">
                <HireSteps compact label="How We Hire" steps={d.how_we_hire.map((s) => ({ title: HIRING_STEP[s] }))} />
              </RolePart>
            )}
          </article>
          <aside>
            <RoleCard
              title="The Role"
              items={details}
              closing={closes ? `Closes ${closes}` : undefined}
              action={
                open ? (
                  <Button variant="primary" size="lg" block onClick={apply}>
                    Apply for This Role
                  </Button>
                ) : undefined
              }
              note={open ? applicantsLine(d.applicants) : undefined}
            >
              {problem && (
                <div className="px-6 pb-6">
                  <Banner tone="err">{problem}</Banner>
                </div>
              )}
            </RoleCard>
            {open && (
              <ShareCard
                title="Know Someone for This?"
                text="Send them this role. Their application comes straight to us."
                action={
                  <Button variant="line" size="sm" onClick={() => copy("share", link)}>
                    {copied === "share" ? "Link Copied" : "Copy Role Link"}
                  </Button>
                }
              />
            )}
          </aside>
        </StickyColumns>
      </div>
      {others.length > 0 && (
        <section aria-labelledby="more-title" className="public-wrap pt-20 phone:pt-16">
          <SectionHead align="split" size="m" title="More Roles" id="more-title" />
          <RoleTiles label="More Roles" start={0}>
            {others.map((r) => (
              <RoleTile key={r.slug} href={`/jobs/${r.slug}`} team={r.department} title={r.title} line={[r.location, r.work_pattern ? PATTERN[r.work_pattern] : null].filter(Boolean).join(". ") + "."} />
            ))}
          </RoleTiles>
        </section>
      )}
    </Page>
  );
}

/** The words of a few paragraphs, for the smaller lines of a statement. */
function Paragraphs({ blocks }: { blocks: Block[] }): ReactNode {
  return blocks.map((b, i) => <p key={i}>{textOf(b)}</p>);
}

/**
 * One part of the role's text without a first heading that repeats the part's own (a description
 * written as `## Role Overview`), so the heading shows once; null when the role has none.
 */
function own(all: Block[] | null, title: string): Block[] | null {
  const blocks = all && all[0]?.kind === "heading" && fold(textOf(all[0])) === fold(title) ? all.slice(1) : all;
  return blocks && blocks.length > 0 ? blocks : null;
}
