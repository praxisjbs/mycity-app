import { useState } from "react";
import reviews from "@mycity/contract/schemas/reviews.js";
import type { Review, ReviewDetail } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  Chain,
  DateField,
  ErrorState,
  Field,
  formatDate,
  FormFooter,
  IconButton,
  LoadingRows,
  PageHeader,
  StatusPill,
  TextField,
  toast,
  todayIso,
  useContractForm,
  useModal,
  Who,
} from "@mycity/ui";
import { ReviewPanel } from "./ReviewForm";
import { cycleStatus, rating, reviewStatus } from "./status";

/**
 * Performance · Reviews (#32; docs/guides/performance.md §10): the current cycle, Review History
 * in the reader's scope, and a review's form. Self first, then the manager, the manager's own
 * line manager and HR (A17).
 */
export function Reviews() {
  const me = useMe();
  const modal = useModal();
  const s = useApi("GET /api/v1/performance/reviews/summary");
  const cycle = s.data?.cycle ?? null;
  const list = usePaged("GET /api/v1/performance/reviews", { filters: cycle ? { performance_cycle_id: cycle.performance_cycle_id } : {}, enabled: !s.loading });
  const close = useMutation("POST /api/v1/performance/cycles/:id/close");
  const canRun = hasCapability(me, "reviews.cycles");
  const openCycle = () => modal.open({ title: "Open Cycle", body: (done) => <CycleForm close={done} /> });
  const open = (r: Review) => modal.open({ title: "Review", wide: true, full: true, body: () => <ReviewLoader id={r.performance_review_id} /> });
  useScreenAction(canRun ? { label: "Open Cycle", onSelect: openCycle } : null);

  return (
    <>
      <PageHeader
        title="Reviews"
        sub={cycle ? `${cycle.name} · ${formatDate(cycle.starts_on)} to ${formatDate(cycle.ends_on)}` : undefined}
        actions={
          <>
            {canRun && cycle && cycle.status !== "closed" && (
              <Button
                onClick={async () => {
                  await close.run({ params: { id: cycle.performance_cycle_id }, body: {} });
                  invalidate("/api/v1/performance/reviews");
                  toast(`${cycle.name} closed`);
                }}
              >
                Close Cycle
              </Button>
            )}
            {canRun && <Button variant="primary" icon="plus" onClick={openCycle}>Open Cycle</Button>}
          </>
        }
      />
      {s.error && <ErrorState error={s.error} onRetry={s.reload} />}
      {s.data && (
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Cycle", value: cycle ? <StatusPill s={cycleStatus(cycle.status)} /> : "None Yet" },
            { label: "Opens", value: cycle?.self_review_opens_at ? formatDate(cycle.self_review_opens_at) : "" },
            { label: "Closes", value: cycle?.closes_at ? formatDate(cycle.closes_at) : "" },
            { label: "Average Rating", value: rating(s.data.average_rating) ?? "" },
          ]}
        />
      )}
      {s.data && cycle && (
        <Card className="mt-3 max-md:hidden">
          <CardHeader title="Review Chain" />
          <Chain
            steps={[
              { label: `Self · ${s.data.self_done}`, state: s.data.self_done ? "done" : "now" },
              { label: `Manager · ${s.data.manager_done}`, state: s.data.manager_done ? "done" : undefined },
              { label: "Second Level" },
              { label: `HR · ${s.data.closed}`, state: s.data.closed ? "done" : undefined },
            ]}
          />
        </Card>
      )}
      <div className="mt-3">
        <PagedTable<Review>
          title="Review History"
          list={list}
          search="Search people"
          rowKey={(r) => r.performance_review_id}
          onRowClick={open}
          noun="review"
          empty={{ title: "No Reviews Yet", text: "They appear when a cycle opens." }}
          columns={[
            { key: "emp", label: "Employee", render: (r) => <Who name={r.employee.display_name} sub={r.employee.department ?? undefined} /> },
            { key: "c", label: "Cycle", desktop: true, render: (r) => r.cycle },
            { key: "self", label: "Self Rating", align: "n", render: (r) => rating(r.self_rating) },
            { key: "mgr", label: "Manager", align: "n", render: (r) => rating(r.manager_rating) },
            { key: "sec", label: "Second Level", desktop: true, render: (r) => r.waiting_on },
            { key: "s", label: "Status", render: (r) => <StatusPill s={reviewStatus(r.status)} /> },
          ]}
        />
      </div>
    </>
  );
}

/** A review from the list: loaded, then its panel with the Performance routes. */
function ReviewLoader({ id }: { id: string }) {
  const r = useApi("GET /api/v1/performance/reviews/:id", { params: { id } });
  if (r.error) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <LoadingRows count={6} />;
  const done = (next: ReviewDetail) => {
    r.set(next);
    invalidate("/api/v1/performance/reviews");
    return next;
  };
  return (
    <ReviewPanel
      detail={r.data}
      onChange={done}
      routes={{
        save: (body) => api.call("PUT /api/v1/performance/reviews/:id", { params: { id }, body }),
        submit: () => api.call("POST /api/v1/performance/reviews/:id/submit", { params: { id }, body: {} }),
        decide: (body) => api.call("POST /api/v1/performance/reviews/:id/decide", { params: { id }, body }),
        dictation: `/api/v1/performance/reviews/${id}/dictation`,
      }}
    />
  );
}

/** Open Cycle: its name, the period it reviews, when it opens and closes, and its questions. */
function CycleForm({ close }: { close: () => void }) {
  const today = todayIso();
  const f = useContractForm({ name: "", starts_on: "", ends_on: "", opens_on: today, closes_on: "" }, reviews.CycleCreate.innerType().omit({ questions: true }));
  const [questions, setQuestions] = useState<string[]>([""]);
  const save = useMutation("POST /api/v1/performance/cycles");
  const submit = f.submit(async (v) => {
    const body = { ...v, questions: questions.map((x) => x.trim()).filter(Boolean) };
    const parsed = reviews.CycleCreate.safeParse(body);
    if (!parsed.success) {
      f.setServerErrors(Object.fromEntries(parsed.error.issues.map((x) => [String(x.path[0]), [x.message]])));
      return;
    }
    try {
      const c = await save.run({ body });
      invalidate("/api/v1/performance/reviews");
      close();
      toast(c.status === "open" ? `${c.name} is open` : `${c.name} opens ${formatDate(v.opens_on)}`);
    } catch (e) {
      if (e instanceof ApiError && e.fields) f.setServerErrors(e.fields);
      else if (e instanceof ApiError) toast(e.message);
    }
  });
  return (
    <>
      <Field label="Cycle" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Q4 Check-In" />
      </Field>
      <Field label="Period Starts" {...f.status("starts_on")}><DateField {...f.field("starts_on")} /></Field>
      <Field label="Period Ends" {...f.status("ends_on")}><DateField {...f.field("ends_on")} /></Field>
      <Field label="Opens On" {...f.status("opens_on")}><DateField {...f.field("opens_on")} /></Field>
      <Field label="Closes On" {...f.status("closes_on")}><DateField {...f.field("closes_on")} /></Field>
      {questions.map((q, i) => (
        <Field key={i} label={`Question ${i + 1}`} optional>
          <span className="flex items-center gap-2">
            <TextField value={q} onChange={(v) => setQuestions(questions.map((x, j) => (j === i ? v : x)))} aria-label={`Question ${i + 1}`} />
            {questions.length > 1 && <IconButton icon="x" label={`Remove Question ${i + 1}`} onClick={() => setQuestions(questions.filter((_, j) => j !== i))} />}
          </span>
        </Field>
      ))}
      {questions.length < 12 && <Button size="sm" icon="plus" onClick={() => setQuestions([...questions, ""])}>Add Question</Button>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Open Cycle</Button>
      </FormFooter>
    </>
  );
}
