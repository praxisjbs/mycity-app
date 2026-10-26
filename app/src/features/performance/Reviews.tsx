/**
 * Performance · Reviews (the `reviews` tab; docs/guides/performance.md §2, §3.3, §6.12, §10): the
 * month's round. Its figures, Waiting On You, every review in scope with its stage, and the PIPs;
 * Open Round and Close Round for Operations & People. A review opens in ReviewPage.tsx.
 */
import { useEffect, useRef, useState } from "react";
import reviewsContract from "@mycity/contract/schemas/reviews.js";
import type { Pip, Review, Round } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  DataView,
  DateField,
  DesktopOnly,
  Field,
  FilterSelect,
  formatDate,
  formatMonth,
  FormFooter,
  KeyValue,
  PageHeader,
  PhoneOnly,
  SegmentedControl,
  SelectField,
  StatusPill,
  Sub,
  TextAreaField,
  toast,
  Toolbar,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { ReviewSheet } from "./ReviewPage";
import { person, rating, reviewStatus, score, STAGE_OPTIONS, useQuarter } from "./shared";

const say = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Could not save");
const KIND_OPTIONS: Array<[string, string]> = [["", "All Kinds"], ["monthly", "Monthly"], ["probation", "Probation"]];
const PIP_STATUS: Record<Pip["status"], { tone: "ok" | "warn" | "err" | "neutral"; text: string }> = {
  open: { tone: "warn", text: "Open" },
  extended: { tone: "warn", text: "Extended" },
  passed: { tone: "ok", text: "Passed" },
  not_met: { tone: "err", text: "Not Met" },
};

/** What the reader does next on a review that waits on them: the button the review shows them. */
export const nextStep = (r: Pick<Review, "status" | "reviewer">, me: string | null) =>
  r.status === "with_reviewer" || r.status === "returned" ? (r.reviewer.employee_id === me ? "Score" : "Give Input") : r.status === "with_hr" ? "Close Review" : "Approve";

export function Reviews() {
  const me = useMe();
  const modal = useModal();
  const [params] = useSearchParams();
  const quarter = useQuarter();
  const manage = hasCapability(me, "performance.manage");
  const rounds = usePaged("GET /api/v1/performance/rounds", { filters: { period_id: quarter.periodId }, enabled: Boolean(quarter.periodId) });
  const [roundId, setRoundId] = useState("");
  // Another quarter's rounds: its months replace this one's.
  const pickQuarter = (id: string) => (quarter.setPeriodId(id), setRoundId(""));
  // The API lists rounds newest month first, so the newest round is the one shown until another is picked.
  const round: Round | undefined = rounds.rows.find((r) => r.performance_cycle_id === roundId) ?? rounds.rows[0];
  const departments = useApi("GET /api/v1/departments", { query: {} });
  const [view, setView] = useState<"reviews" | "pips">("reviews");
  const [dept, setDept] = useState("");
  const [stage, setStage] = useState("");
  // `?kind=probation` (People's Probation Ending) opens on the probation reviews.
  const [kind, setKind] = useState(params.get("kind") === "probation" ? "probation" : "");
  // A probation review belongs to no round: under Probation the round's filter is off.
  const probation = kind === "probation";
  const ready = Boolean(round) || probation;
  const base = round && !probation ? { round_id: round.performance_cycle_id } : {};
  const list = usePaged("GET /api/v1/performance/reviews", {
    filters: { ...base, ...(dept ? { department_id: dept } : {}), ...(stage ? { status: stage as Review["status"] } : {}), ...(kind ? { kind: kind as Review["review_kind"] } : {}) },
    enabled: ready,
  });
  // What waits on the reader, whatever its round, a probation review among it.
  const waiting = usePaged("GET /api/v1/performance/reviews", { filters: { waiting_on_me: "true" } });
  const pips = usePaged("GET /api/v1/performance/pips", { enabled: view === "pips" });
  const closeRound = useMutation("POST /api/v1/performance/rounds/:id/close");

  const reload = () => {
    invalidate("/api/v1/performance/reviews");
    invalidate("/api/v1/performance/rounds");
    invalidate("/api/v1/performance/pips");
  };
  const openReview = (id: string) => modal.open({ title: "Review", wide: true, full: true, body: (close) => <ReviewSheet id={id} close={() => (close(), reload())} /> });
  const openPip = (p: Pip) => modal.open({ title: "Improvement Plan", body: (close) => <PipSheet pip={p} manage={manage} close={() => (close(), reload())} /> });
  const openRound = () => modal.open({ title: "Open Round", body: (close) => <OpenRoundForm periodId={quarter.periodId} months={quarter.period?.months ?? []} taken={rounds.rows.map((r) => r.month)} close={close} onOpened={(r) => (setRoundId(r.performance_cycle_id), reload())} /> });
  const close = async () => {
    if (!round) return;
    try {
      await closeRound.run({ params: { id: round.performance_cycle_id }, body: {} });
      reload();
      toast(`${round.name} closed`);
    } catch (e) {
      say(e);
    }
  };
  // A month for Open Round: one of the quarter's with no round yet.
  const freeMonth = (quarter.period?.months ?? []).some((m) => !rounds.rows.some((r) => r.month === m));
  useScreenAction(manage && quarter.period && freeMonth ? { label: "Open Round", onSelect: openRound } : null);

  // A link to one review (a notification, ⌘K, Need You) opens it once.
  const linked = params.get("id");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (linked && opened.current !== linked) {
      opened.current = linked;
      openReview(linked);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  const c = round?.counts;
  const deptOptions: Array<[string, string]> = [["", "All Departments"], ...(departments.data?.data ?? []).filter((d) => d.active).map((d) => [d.department_id, d.name] as [string, string])];
  const monthOptions: Array<[string, string]> = rounds.rows.map((r) => [r.performance_cycle_id, r.name]);

  return (
    <>
      <PageHeader
        title="Reviews"
        sub={round ? `${round.name} · closes ${formatDate(round.close_due_on)}` : quarter.period?.name}
        actions={
          manage ? (
            <>
              {round?.status === "open" && <Button onClick={close}>Close Round</Button>}
              {quarter.period && freeMonth && <Button variant="primary" icon="plus" onClick={openRound}>Open Round</Button>}
            </>
          ) : undefined
        }
      />
      <Toolbar>
        <FilterSelect label="Quarter" value={quarter.periodId} onChange={pickQuarter} options={quarter.options} />
        <FilterSelect label="Month" value={round?.performance_cycle_id ?? ""} onChange={setRoundId} options={monthOptions} />
        <SegmentedControl label="Reviews or PIPs" value={view} onChange={setView} options={[["reviews", "Reviews"], ["pips", "PIPs"]]} />
      </Toolbar>
      {view === "reviews" && (
        <>
          {c && (
            <>
              <DesktopOnly>
                <KpiTiles
                  items={[
                    { label: "Check-Ins In", value: `${c.total - c.check_in} of ${c.total}` },
                    { label: "With Reviewers", value: String(c.with_reviewer), tone: c.with_reviewer ? "warn" : undefined },
                    { label: "Second Level", value: String(c.second_level) },
                    { label: "With HR", value: String(c.with_hr) },
                    { label: "Closed", value: String(c.closed), tone: c.closed ? "ok" : undefined },
                  ]}
                />
              </DesktopOnly>
              <PhoneOnly>
                <Sub>{`${c.total - c.check_in} of ${c.total} in · ${c.closed} closed`}</Sub>
              </PhoneOnly>
            </>
          )}
          {waiting.rows.length > 0 && (
            <DataView
              className="mt-3"
              title="Waiting On You"
              list={waiting}
              noun="review"
              rowKey={(r) => r.performance_review_id}
              onRowClick={(r) => openReview(r.performance_review_id)}
              columns={[
                { key: "employee", label: "Employee", render: (r) => person(r.employee) },
                { key: "stage", label: "Stage", render: (r) => <StatusPill s={reviewStatus(r.status)} /> },
                { key: "due", label: "Due", render: (r) => (r.due_on ? formatDate(r.due_on) : "–") },
                { key: "next", label: "Next", render: (r) => nextStep(r, me.employee_id ?? null), desktop: true },
              ]}
            />
          )}
          <Toolbar>
            <FilterSelect label="Department" value={dept} onChange={setDept} options={deptOptions} />
            <FilterSelect label="Stage" value={stage} onChange={setStage} options={STAGE_OPTIONS} />
            <FilterSelect label="Kind" value={kind} onChange={setKind} options={KIND_OPTIONS} />
          </Toolbar>
          <PagedTable
            title={round ? round.name : "Reviews"}
            list={list}
            search="Search People"
            rowKey={(r) => r.performance_review_id}
            noun="review"
            onRowClick={(r) => openReview(r.performance_review_id)}
            empty={{ title: round ? "No Reviews" : "No Round Yet" }}
            columns={[
              { key: "employee", label: "Employee", render: (r) => person(r.employee) },
              { key: "reviewer", label: "Reviewer", render: (r) => r.reviewer.display_name, desktop: true },
              { key: "stage", label: "Stage", render: (r) => <StatusPill s={reviewStatus(r.status)} /> },
              { key: "due", label: "Due", render: (r) => (r.due_on ? formatDate(r.due_on) : "–") },
              { key: "score", label: "Score", align: "n", render: (r) => score(r.score_month), desktop: true },
              { key: "rating", label: "Rating", render: (r) => <StatusPill s={rating(r.rating)} />, desktop: true },
            ]}
          />
        </>
      )}
      {view === "pips" && (
        <PagedTable
          title="Improvement Plans"
          list={pips}
          search="Search People"
          rowKey={(p) => p.improvement_plan_id}
          noun="plan"
          onRowClick={openPip}
          empty={{ title: "No Improvement Plans" }}
          columns={[
            { key: "employee", label: "Employee", render: (p) => person(p.employee) },
            { key: "starts", label: "Starts", render: (p) => formatDate(p.starts_on), desktop: true },
            { key: "review", label: "Review On", render: (p) => formatDate(p.review_on) },
            { key: "status", label: "Status", render: (p) => <StatusPill s={PIP_STATUS[p.status]} /> },
          ]}
        />
      )}
    </>
  );
}

/** Open Round: a month of the quarter that has ended and has no round yet. */
function OpenRoundForm({ periodId, months, taken, close, onOpened }: { periodId: string; months: string[]; taken: string[]; close: () => void; onOpened: (r: Round) => void }) {
  const free = months.filter((m) => !taken.includes(m));
  const f = useContractForm({ performance_period_id: periodId, month: free[0] ?? "" }, reviewsContract.RoundCreate);
  const save = useMutation("POST /api/v1/performance/rounds");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const r = await save.run({ body: f.values });
      close();
      onOpened(r);
      toast(`${r.name} opened`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Month" {...f.status("month")}>
        <SelectField options={free.map((m) => [m, formatMonth(m)] as [string, string])} {...f.field("month")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Open Round</Button>
      </FormFooter>
    </>
  );
}

/** One improvement plan: its dates and lines; Operations & People close it. */
function PipSheet({ pip, manage, close }: { pip: Pip; manage: boolean; close: () => void }) {
  const modal = useModal();
  const live = pip.status === "open" || pip.status === "extended";
  return (
    <>
      <KeyValue
        items={[
          ["Employee", pip.employee.display_name],
          ["Starts", formatDate(pip.starts_on)],
          ["Ends", formatDate(pip.ends_on)],
          ["Review On", formatDate(pip.review_on)],
          ["Status", <StatusPill key="s" s={PIP_STATUS[pip.status]} />],
          ...(pip.summary ? ([["Summary", pip.summary]] as Array<[string, string]>) : []),
          ...(pip.outcome_note ? ([["Outcome", pip.outcome_note]] as Array<[string, string]>) : []),
        ]}
      />
      <DataView
        className="mt-3"
        title="Lines"
        rows={pip.lines}
        rowKey={(l) => l.improvement_plan_line_id}
        columns={[
          { key: "text", label: "Line", render: (l) => l.text },
          { key: "target", label: "Target", render: (l) => l.target_text ?? "–" },
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {manage && live && <Button variant="primary" onClick={() => modal.open({ title: "Close Plan", body: (done) => <ClosePipForm pip={pip} close={() => (done(), close())} /> })}>Close Plan</Button>}
      </FormFooter>
    </>
  );
}

function ClosePipForm({ pip, close }: { pip: Pip; close: () => void }) {
  const f = useContractForm({ status: "passed", outcome_note: "", ends_on: "", review_on: "" }, reviewsContract.PipClose);
  const save = useMutation("POST /api/v1/performance/pips/:id/close");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: pip.improvement_plan_id }, body: { ...f.values, status: f.values.status as "passed" | "extended" | "not_met" } });
      close();
      toast(f.values.status === "extended" ? "Plan extended" : "Plan closed");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Outcome" {...f.status("status")}>
        <SelectField options={[["passed", "Passed"], ["extended", "Extended"], ["not_met", "Not Met"]]} {...f.field("status")} />
      </Field>
      {f.values.status === "extended" && (
        <>
          <Field label="Ends On" {...f.status("ends_on")}><DateField {...f.field("ends_on")} /></Field>
          <Field label="Review On" {...f.status("review_on")}><DateField {...f.field("review_on")} /></Field>
        </>
      )}
      <Field label="Note" {...f.status("outcome_note")}><TextAreaField {...f.field("outcome_note")} rows={3} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Close Plan</Button>
      </FormFooter>
    </>
  );
}
