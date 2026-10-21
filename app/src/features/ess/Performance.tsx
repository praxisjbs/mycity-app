import type { Review, ReviewDetail, ReviewSave } from "@mycity/contract/contract.gen.ts";
import { api } from "@/api/client";
import { invalidate, useApi } from "@/api/hooks";
import { PhoneCards } from "@/features/shared/PhoneCards";
import { ReviewPanel } from "@/features/performance/ReviewForm";
import { percent, rating, reviewStatus } from "@/features/performance/status";
import { useScreenAction } from "@/shell/screen-action";
import {
  Bars,
  Button,
  Card,
  CardHeader,
  DataView,
  DesktopOnly,
  EmptyState,
  ErrorState,
  formatDate,
  formatMonth,
  Grid,
  KpiCard,
  LoadingRows,
  PageHeader,
  StatusPill,
  TapList,
  useModal,
} from "@mycity/ui";

/**
 * ESS · My Performance (#10; docs/guides/performance.md §10): my KPIs this month and what they
 * roll up to, my reviews, and My Review while a cycle is open (A17, A18).
 */
const SCORE_HELP = "Your KPIs, weighted to 100%. It updates as the tasks against each KPI close.";

export function MyPerformancePage() {
  const { data: p, error, reload } = useApi("GET /api/v1/ess/performance");
  const modal = useModal();
  const startReview = () => modal.open({ title: "My Review", wide: true, full: true, body: () => <MyReview onDone={reload} /> });
  useScreenAction(p?.open_review_id ? { label: "Start My Review", onSelect: startReview } : null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return <LoadingRows count={6} />;

  const kpis = (
    <Card>
      <CardHeader title="My KPIs This Month" />
      {p.kpis.length ? (
        <Bars rows={p.kpis.map((k) => ({ label: `${k.title} · ${Number(k.weight)}%`, percent: Math.round((k.attainment ?? 0) * 100), value: percent(k.attainment) ?? "" }))} />
      ) : (
        <EmptyState bare title="No KPIs Yet" text="Your manager sets them each month." />
      )}
    </Card>
  );
  const chain = (
    <Card>
      <CardHeader title="Rolls Up To" />
      {p.traces.length ? (
        <TapList items={(p.traces[0]?.chain ?? []).map((g) => ({ key: g.organisational_goal_id, title: g.title, sub: g.code ?? undefined }))} />
      ) : (
        <EmptyState bare title="Nothing Yet" />
      )}
    </Card>
  );
  const openReview = (r: Review) => modal.open({ title: r.cycle, wide: true, full: true, body: () => <PastReview id={r.performance_review_id} /> });
  const reviews = (
    <DataView
      title="My Reviews"
      rows={p.reviews}
      rowKey={(r) => r.performance_review_id}
      onRowClick={openReview}
      empty={{ title: "No Reviews Yet" }}
      columns={[
        { key: "c", label: "Cycle", render: (r) => r.cycle },
        { key: "s", label: "Self Rating", align: "n", render: (r) => rating(r.self_rating) },
        { key: "m", label: "Manager", align: "n", render: (r) => rating(r.manager_rating) },
        { key: "x", label: "Second Level", render: (r) => r.waiting_on },
        { key: "t", label: "Status", render: (r) => <StatusPill s={reviewStatus(r.status)} /> },
      ]}
    />
  );

  return (
    <>
      <PageHeader
        title="My Performance"
        sub={p.set_by ? `${formatMonth(p.month)} · set by ${p.set_by}` : formatMonth(p.month)}
        actions={p.open_review_id && <Button variant="primary" icon="edit" onClick={startReview}>Start My Review</Button>}
      />
      <Grid cols="4m2">
        <KpiCard title="KPI Score" help={SCORE_HELP} value={percent(p.kpi_score) ?? "Not Yet"} />
        <KpiCard title="On Track" value={`${p.on_track} of ${p.kpi_count}`} tone={p.on_track ? "ok" : undefined} />
        <KpiCard title="Weight Assigned" value={`${Number(p.weight_assigned)}%`} tone={p.weight_assigned === "100.00" ? "ok" : undefined} />
        <KpiCard title="Last Review" value={rating(p.last_review) ?? "Not Yet"} />
        <KpiCard title="Next Cycle" value={p.next_cycle ? p.next_cycle.name : "None Yet"} caption={p.next_cycle?.closes_at ? `Closes ${formatDate(p.next_cycle.closes_at)}` : undefined} />
      </Grid>
      {p.open_review_id && (
        <div className="mt-3 md:hidden">
          <Button variant="primary" block onClick={startReview}>Start My Review</Button>
        </div>
      )}
      <PhoneCards
        items={[
          { icon: "target", title: "My KPIs This Month", sub: `${p.kpi_count} KPIs · ${p.on_track} on track`, body: kpis },
          { icon: "up", title: "Rolls Up To", sub: p.traces[0] ? `${p.traces[0].chain.length} levels` : "Nothing yet", body: chain },
          { icon: "check", title: "My Reviews", sub: p.reviews[0] ? p.reviews[0].cycle : "None yet", body: reviews },
        ]}
      />
      <DesktopOnly>
        <Grid cols={2} className="mt-3">
          {kpis}
          {chain}
        </Grid>
        <div className="mt-3">{reviews}</div>
      </DesktopOnly>
    </>
  );
}

const ESS_ROUTES = {
  save: (body: ReviewSave) => api.call("PUT /api/v1/ess/performance/review", { body }),
  submit: () => api.call("POST /api/v1/ess/performance/review/submit", { body: {} }),
  dictation: "/api/v1/ess/performance/review/dictation",
};

/** My open self review. */
function MyReview({ onDone }: { onDone: () => void }) {
  const r = useApi("GET /api/v1/ess/performance/review");
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingRows count={6} />;
  const changed = (next: ReviewDetail) => {
    r.set(next);
    invalidate("/api/v1/ess/performance");
    onDone();
  };
  return <ReviewPanel detail={r.data} routes={ESS_ROUTES} onChange={changed} />;
}

/** A past review of mine, as I may read it. */
function PastReview({ id }: { id: string }) {
  const r = useApi("GET /api/v1/performance/reviews/:id", { params: { id } });
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingRows count={6} />;
  return <ReviewPanel detail={r.data} routes={{ ...ESS_ROUTES }} onChange={r.set} />;
}

