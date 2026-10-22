/**
 * ESS · My Performance (docs/guides/performance.md §10, §12), composed of its parts in
 * features/performance/my/: the figures, a banner when something waits on the person, My
 * Scorecard, This Month's Check-In (features/performance/CheckIn.tsx), Rolls Up To, My Reviews and
 * My PIP while one is open. My Commitments joins with Performance PR 4.
 */
import { useEffect, useRef } from "react";
import type { MyPerformance } from "@mycity/contract/contract.gen.ts";
import { useApi } from "@/api/hooks";
import { CheckInSheet } from "@/features/performance/CheckIn";
import { MyReviewsList } from "@/features/performance/my/MyReviews";
import { MyScorecard, RollsUpTo } from "@/features/performance/my/MyScorecard";
import { rating, reviewStatus, score } from "@/features/performance/shared";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { useSearchParams } from "@/lib/router";
import { useScreenAction } from "@/shell/screen-action";
import { Banner, Button, Card, CardHeader, DesktopOnly, EmptyState, ErrorState, formatDate, Grid, HelpTerm, KeyValue, LoadingRows, PageHeader, StatusPill, useModal } from "@mycity/ui";

/** The check-in's state in a few words, for its figure and its card. */
const checkInText = (c: MyPerformance["check_in"]) => (!c ? "None Open" : c.status === "check_in" ? (c.due_on ? `Due ${formatDate(c.due_on)}` : "Open") : reviewStatus(c.status).text);

export function MyPerformancePage() {
  const modal = useModal();
  const [params, setParams] = useSearchParams();
  const { data: p, error, reload } = useApi("GET /api/v1/ess/performance");
  const card = p?.scorecard;
  const checkIn = p?.check_in;
  const due = checkIn?.status === "check_in";
  const toAgree = card?.status === "binding" && !card.employee_agreed_at;
  const startCheckIn = () => modal.open({ title: "This Month's Check-In", wide: true, full: true, body: (close) => <CheckInSheet close={() => (close(), reload())} /> });
  const openScorecard = () => card && modal.open({ title: "My Scorecard", wide: true, body: <MyScorecard id={card.scorecard_id} /> });
  useScreenAction(due ? { label: "Start Check-In", onSelect: startCheckIn } : null);

  // ⌘K's Start Check-In lands here with ?check_in=1: open it once, then drop the key.
  const asked = params.get("check_in") === "1";
  const opened = useRef(false);
  useEffect(() => {
    if (asked && p && !opened.current) {
      opened.current = true;
      setParams({ check_in: null }, { replace: true });
      startCheckIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, p]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return <LoadingRows count={6} />;
  const commitments = p.commitments ? `${p.commitments.delivered_on_time} of ${p.commitments.due}` : "–";
  const agreement = !card ? "–" : card.employee_agreed_at ? "Agreed" : card.status === "draft" ? "Draft" : "Not Yet";

  const checkInBody = (
    <>
      <KeyValue items={[["Status", checkIn ? <StatusPill key="s" s={reviewStatus(checkIn.status)} /> : null], ["Due", checkIn?.due_on ? formatDate(checkIn.due_on) : null]]} />
      {checkIn && (
        <Button className="mt-3" variant={due ? "primary" : "default"} onClick={startCheckIn}>
          {due ? "Start Check-In" : "View Check-In"}
        </Button>
      )}
    </>
  );
  const pipBody = p.open_pip ? <KeyValue items={[["Review On", formatDate(p.open_pip.review_on)]]} /> : null;

  return (
    <>
      <PageHeader title="My Performance" sub={[p.period?.name, card?.reviewer_name ? `reviewed by ${card.reviewer_name}` : null].filter(Boolean).join(" · ")} />
      {toAgree && (
        <Banner tone="warn" action={<Button size="sm" onClick={openScorecard}>Agree Scorecard</Button>}>
          Your scorecard waits for your agreement.
        </Banner>
      )}
      {!toAgree && due && checkIn?.due_on && (
        <Banner tone="info" action={<Button size="sm" onClick={startCheckIn}>Start Check-In</Button>}>
          {`Your check-in is due ${formatDate(checkIn.due_on)}.`}
        </Banner>
      )}
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Score to Date", value: <HelpTerm help="Your scored lines, weighted. December's is your quarter's final.">{score(card?.score_to_date)}</HelpTerm> },
          { label: "Rating", value: rating(card?.rating).text },
          { label: "This Month", value: checkInText(checkIn ?? null), tone: due ? "warn" : undefined },
          { label: "Commitments On Time", value: commitments },
          { label: "Agreement", value: agreement, tone: toAgree ? "warn" : undefined },
        ]}
      />
      <PhoneCards
        items={[
          ...(card ? [{ icon: "target" as const, title: "My Scorecard", sub: `${score(card.score_to_date)} · ${rating(card.rating).text}`, body: <MyScorecard id={card.scorecard_id} />, wide: true }] : []),
          { icon: "check" as const, title: "This Month's Check-In", sub: checkInText(checkIn ?? null), body: checkInBody },
          ...(card ? [{ icon: "up" as const, title: "Rolls Up To", sub: "To the company goals", body: <RollsUpTo id={card.scorecard_id} /> }] : []),
          { icon: "doc" as const, title: "My Reviews", sub: "Month by month", body: <MyReviewsList /> },
          ...(pipBody ? [{ icon: "flag" as const, title: "My PIP", sub: `Review ${formatDate(p.open_pip!.review_on)}`, body: pipBody }] : []),
        ]}
      />
      <DesktopOnly>
        {card ? (
          <Card className="mt-3">
            <CardHeader title="My Scorecard" />
            <MyScorecard id={card.scorecard_id} />
          </Card>
        ) : (
          <EmptyState title="No Scorecard Yet" />
        )}
        <Grid cols={2} className="mt-3">
          <Card>
            <CardHeader title="This Month's Check-In" />
            {checkInBody}
          </Card>
          {card && (
            <Card>
              <CardHeader title="Rolls Up To" />
              <RollsUpTo id={card.scorecard_id} />
            </Card>
          )}
          {pipBody && (
            <Card>
              <CardHeader title="My PIP" />
              {pipBody}
            </Card>
          )}
        </Grid>
        <div className="mt-3">
          <MyReviewsList />
        </div>
      </DesktopOnly>
    </>
  );
}
