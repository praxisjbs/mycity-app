/**
 * Recruitment · Analytics (docs/guides/recruitment.md §10): the tab's charts and figures in one
 * place, so the working tabs hold their lists alone. Four figures (open vacancies, candidates,
 * shortlisted, offers accepted this month), then four cards two by two: Funnel, All Roles (the
 * candidates at each stage now), Screening Scores (in bands), Assessment Averages (each assessment's
 * average, with the sittings awaiting marking) and Offers and Pool (where the offers stand and what
 * the Talent Pool holds). Every figure is a summary the other tabs already read, within the reader's
 * scope; the offers' only once Offers is open in this build (F14). One under another on a phone.
 */
import type { ReactNode } from "react";
import { useApi } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useScreenState } from "@/lib/plan";
import { Bars, Card, CardHeader, ErrorState, Grid, HelpTerm, KeyValue, LoadingRows, PageHeader } from "@mycity/ui";
import { STAGE_LABEL } from "./shared";

const FUNNEL_HELP = "The candidates at each stage now, across every role.";
const SCORES_HELP = "Each candidate's screening score: the AI read of the CV when there is one, otherwise the estimate from the form.";
const AVERAGES_HELP = "Each assessment's average score across the sittings marked so far.";

/** A bar's share of the largest (or of the whole), as a whole percent. */
const share = (n: number, of: number) => (of ? Math.round((n * 100) / of) : 0);
const counted = (n: number | undefined) => (n === undefined ? "–" : String(n));

/** A card's body: its error with Try Again, its rows while loading, or what it shows. */
function Body({ read, children }: { read: { error: unknown; reload: () => unknown; data: unknown }; children: () => ReactNode }) {
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  return read.data ? <>{children()}</> : <LoadingRows />;
}

export function Analytics() {
  const roles = useApi("GET /api/v1/recruitment/vacancies/summary");
  const people = useApi("GET /api/v1/recruitment/candidates/summary");
  const tests = useApi("GET /api/v1/recruitment/assessments/summary");
  const pool = useApi("GET /api/v1/recruitment/pool/summary");
  const offersOpen = useScreenState("recruitment", "offers").open;
  const offers = useApi("GET /api/v1/recruitment/offers/summary", { enabled: offersOpen });

  const funnel = roles.data?.funnel ?? [];
  const scores = people.data?.distribution ?? [];
  const top = Math.max(0, ...funnel.map((x) => x.count));
  const total = scores.reduce((n, b) => n + b.count, 0);
  const o = offers.data;
  const p = pool.data;
  return (
    <>
      <PageHeader title="Analytics" />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Open Vacancies", value: counted(roles.data?.open) },
          { label: "Candidates", value: counted(people.data?.candidates) },
          { label: "Shortlisted", value: counted(people.data?.shortlisted), tone: people.data?.shortlisted ? "ok" : undefined },
          offersOpen
            ? { label: "Accepted This Month", value: counted(o?.accepted_this_month) }
            : { label: "In Interview", value: counted(people.data?.in_interview) },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader title={<HelpTerm help={FUNNEL_HELP}>Funnel, All Roles</HelpTerm>} />
          <Body read={roles}>{() => <Bars rows={funnel.map((x) => ({ label: STAGE_LABEL[x.stage], percent: share(x.count, top), value: String(x.count) }))} />}</Body>
        </Card>
        <Card>
          <CardHeader title={<HelpTerm help={SCORES_HELP}>Screening Scores</HelpTerm>} />
          <Body read={people}>{() => <Bars rows={scores.map((b) => ({ label: b.label, percent: share(b.count, total), value: String(b.count) }))} />}</Body>
        </Card>
        <Card>
          <CardHeader
            title={<HelpTerm help={AVERAGES_HELP}>Assessment Averages</HelpTerm>}
            right={tests.data ? <span className="text-sm text-subtle-foreground">{`${tests.data.awaiting_marking} to mark`}</span> : undefined}
          />
          <Body read={tests}>
            {() =>
              tests.data!.by_assessment.length ? (
                <Bars rows={tests.data!.by_assessment.map((a) => ({ label: a.label, percent: Math.round(a.value), value: String(Math.round(a.value)) }))} />
              ) : (
                <p className="text-sm text-subtle-foreground">None marked yet</p>
              )
            }
          </Body>
        </Card>
        <Card>
          <CardHeader title="Offers and Pool" />
          <Body read={pool}>
            {() => (
              <KeyValue
                items={[
                  ...(offersOpen && o
                    ? ([
                        ["With Approval", String(o.with_approval)],
                        ["To Send", String(o.to_send)],
                        ["With Candidates", String(o.with_candidates)],
                      ] as Array<[string, string]>)
                    : []),
                  ["In the Pool", String(p!.in_pool)],
                  ["Invited Back", String(p!.invited_back)],
                  ["Hired From the Pool", String(p!.hired_from_pool)],
                ]}
              />
            )}
          </Body>
        </Card>
      </Grid>
    </>
  );
}
