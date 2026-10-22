/**
 * ESS · My Performance · My Reviews: the person's monthly and probation reviews, newest first
 * (GET /api/v1/ess/performance/reviews). A review opens the review itself: the person's own
 * check-in throughout, and the reviewer's scores and Download PDF once it is closed (A17;
 * docs/guides/performance.md §10).
 */
import type { MyReview } from "@mycity/contract/contract.gen.ts";
import { usePaged } from "@/api/hooks";
import { PagedTable } from "@/features/shared/sections";
import { formatMonth, StatusPill, useModal } from "@mycity/ui";
import { ReviewSheet } from "../ReviewPage";
import { rating, reviewStatus, score } from "../shared";

/** Opens one of the person's reviews full screen. */
export function useReviewOpener() {
  const modal = useModal();
  return (r: MyReview) => modal.open({ title: r.round_name ?? "Probation Review", wide: true, full: true, body: (close) => <ReviewSheet id={r.performance_review_id} close={close} /> });
}

/** The person's reviews, one page of 25 at a time. */
export function MyReviewsList() {
  const list = usePaged("GET /api/v1/ess/performance/reviews");
  const open = useReviewOpener();
  return (
    <PagedTable
      title="My Reviews"
      list={list}
      rowKey={(r) => r.performance_review_id}
      noun="review"
      onRowClick={open}
      empty={{ title: "No Reviews Yet" }}
      columns={[
        { key: "month", label: "Month", render: (r) => r.round_name ?? (r.month ? formatMonth(r.month) : "Probation") },
        { key: "score", label: "Score", align: "n", render: (r) => score(r.score_month) },
        { key: "rating", label: "Rating", render: (r) => <StatusPill s={rating(r.rating)} />, desktop: true },
        { key: "status", label: "Status", render: (r) => <StatusPill s={reviewStatus(r.status)} /> },
      ]}
    />
  );
}
