/**
 * ESS · My Performance (docs/guides/performance.md §10, §12), composed of its parts in
 * features/performance/my/: My Scorecard and My Reviews (PR 3), My Commitments (PR 4), and the
 * check-in it opens (features/performance/CheckIn.tsx, PR 3).
 */
import { useApi } from "@/api/hooks";
import { MyCommitments, useMyCommitmentsLine } from "@/features/performance/my/MyCommitments";
import { MyKpisCard, RollsUpCard } from "@/features/performance/my/MyScorecard";
import { MyReviewsList, MyReviewsTable, useReviewOpener } from "@/features/performance/my/MyReviews";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { DesktopOnly, ErrorState, Grid, LoadingRows, PageHeader, StatStrip } from "@mycity/ui";

export function MyPerformancePage() {
  const { data: p, error, reload } = useApi("GET /api/v1/ess/performance");
  const open = useReviewOpener();
  const commitmentsLine = useMyCommitmentsLine();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return <LoadingRows count={6} />;
  return (
    <>
      <PageHeader title="My Performance" sub={`${p.period} · set by ${p.set_by}`} />
      <StatStrip items={p.stats} />
      <PhoneCards
        items={[
          { icon: "target", title: "My KPIs This Month", sub: `${p.stats[0].value} · ${p.stats[1].value} on track`, body: <MyKpisCard p={p} /> },
          { icon: "flag", title: "My Commitments", sub: commitmentsLine, body: <MyCommitments bare />, wide: true },
          { icon: "up", title: "Rolls Up To", sub: `${p.chain.length} levels, up to the CEO`, body: <RollsUpCard p={p} /> },
          {
            icon: "check",
            title: "My Reviews",
            sub: p.reviews[0].self ? `${p.reviews[0].cycle}: self ${p.reviews[0].self}, manager ${p.reviews[0].manager}` : "None yet",
            body: <MyReviewsList p={p} onOpen={open} />,
          },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2}>
          <MyKpisCard p={p} />
          <RollsUpCard p={p} />
        </Grid>
        <MyCommitments />
        <MyReviewsTable p={p} onOpen={open} />
      </DesktopOnly>
    </>
  );
}
