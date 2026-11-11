/**
 * Recruitment · Analytics (docs/guides/recruitment.md §10): the tab's charts in one place, so the
 * working tabs hold their lists alone. Funnel, All Roles is how many candidates stand at each stage
 * now, across every role (GET /recruitment/vacancies/summary); Screening Scores is each candidate's
 * screening score in bands (GET /recruitment/candidates/summary). Both within the reader's scope.
 * Side by side on a computer, one under the other on a phone.
 */
import { useApi } from "@/api/hooks";
import { Bars, Card, CardHeader, ErrorState, Grid, HelpTerm, LoadingRows, PageHeader } from "@mycity/ui";
import { STAGE_LABEL } from "./shared";

const SCORES_HELP = "Each candidate's screening score: the AI read of the CV when there is one, otherwise the estimate from the form.";
const FUNNEL_HELP = "The candidates at each stage now, across every role.";

/** A bar's share of the largest (the funnel) or of the whole (the scores), as a whole percent. */
const share = (n: number, of: number) => (of ? Math.round((n * 100) / of) : 0);

export function Analytics() {
  const roles = useApi("GET /api/v1/recruitment/vacancies/summary");
  const people = useApi("GET /api/v1/recruitment/candidates/summary");
  const funnel = roles.data?.funnel;
  const scores = people.data?.distribution;
  const top = funnel ? Math.max(0, ...funnel.map((x) => x.count)) : 0;
  const total = scores ? scores.reduce((n, b) => n + b.count, 0) : 0;
  return (
    <>
      <PageHeader title="Analytics" />
      <Grid cols={2}>
        <Card>
          <CardHeader title={<HelpTerm help={FUNNEL_HELP}>Funnel, All Roles</HelpTerm>} />
          {roles.error ? (
            <ErrorState error={roles.error} onRetry={roles.reload} />
          ) : funnel ? (
            <Bars rows={funnel.map((x) => ({ label: STAGE_LABEL[x.stage], percent: share(x.count, top), value: String(x.count) }))} />
          ) : (
            <LoadingRows />
          )}
        </Card>
        <Card>
          <CardHeader title={<HelpTerm help={SCORES_HELP}>Screening Scores</HelpTerm>} />
          {people.error ? (
            <ErrorState error={people.error} onRetry={people.reload} />
          ) : scores ? (
            <Bars rows={scores.map((b) => ({ label: b.label, percent: share(b.count, total), value: String(b.count) }))} />
          ) : (
            <LoadingRows />
          )}
        </Card>
      </Grid>
    </>
  );
}
