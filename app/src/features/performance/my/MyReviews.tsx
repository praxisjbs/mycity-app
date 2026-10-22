/**
 * ESS · My Performance · My Reviews: the person's reviews; a closed one shows its final scores.
 * Interim, on the in-browser mock. Performance PR 3 replaces it with GET /ess/performance/reviews
 * and the review PDF (docs/guides/performance.md §10).
 */
import type { MyPerformance } from "@/api/types/ess";
import { Card, CardHeader, DataView, KeyValue, Pill, TapList, useModal } from "@mycity/ui";

type Review = MyPerformance["reviews"][number];

/** Opens one review in a modal. */
export function useReviewOpener() {
  const modal = useModal();
  return (r: Review) =>
    modal.open({
      title: `Review, ${r.cycle}`,
      body: (
        <>
          <Card>
            <CardHeader title={r.cycle} />
            <KeyValue items={[["Your rating", r.self ?? "Not yet"], ["Manager", r.manager ?? "Not yet"], ["Second level", r.second ?? "Not yet"], ["Status", <Pill tone={r.status.tone}>{r.status.text}</Pill>]]} />
          </Card>
          {r.manager_comment && (
            <Card className="mt-3">
              <CardHeader title="Manager Comment" />
              <p className="text-2xs text-subtle-foreground">{r.manager_comment}</p>
            </Card>
          )}
        </>
      ),
    });
}

/** The reviews as a phone list. */
export function MyReviewsList({ p, onOpen }: { p: MyPerformance; onOpen: (r: Review) => void }) {
  return <TapList items={p.reviews.map((r) => ({ key: r.review_id, title: r.cycle, sub: `Self ${r.self ?? "not yet"} · Manager ${r.manager ?? "not yet"}`, right: <Pill tone={r.status.tone}>{r.status.text}</Pill>, onClick: () => onOpen(r) }))} />;
}

/** The reviews as a desktop table. */
export function MyReviewsTable({ p, onOpen }: { p: MyPerformance; onOpen: (r: Review) => void }) {
  return (
    <DataView
      title="My Reviews"
      rows={p.reviews}
      rowKey={(r) => r.review_id}
      onRowClick={onOpen}
      columns={[
        { key: "c", label: "Cycle", render: (r) => r.cycle },
        { key: "s", label: "Self Rating", render: (r) => r.self ?? "Not yet" },
        { key: "m", label: "Manager", render: (r) => r.manager ?? "Not yet" },
        { key: "x", label: "Second Level", render: (r) => r.second ?? "Not yet" },
        { key: "t", label: "Status", render: (r) => <Pill tone={r.status.tone}>{r.status.text}</Pill> },
      ]}
    />
  );
}
