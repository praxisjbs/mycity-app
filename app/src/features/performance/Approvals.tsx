/**
 * Performance · Goals, Waiting On You (docs/guides/performance.md §6.4, §6.7, §10): the plan stages
 * and target changes the reader decides, each opening its sheet, also from the bell, Need You and
 * ⌘K (?plan= and ?change=). A decision is the engine's (POST /workflow/instances/:id/approve, or
 * reject with a reason); the plan binds, or the target changes, when the outbox settles it.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { PerformanceApproval } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { ReasonForm } from "@/features/workspace/Commitment";
import { useSearchParams } from "@/lib/router";
import { Banner, Button, Chain, DataView, ErrorState, formatDateTime, formatMonth, FormFooter, KeyValue, LoadingRows, StatusPill, toast, useModal } from "@mycity/ui";
import { cardStatus, changeStatus, figureOf, person, planStatus } from "./shared";

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");

/** What a decision moves: the waiting lists, the bell and Need You, the plans and the tree. */
function refresh() {
  for (const prefix of [
    "/api/v1/workflow",
    "/api/v1/performance/approvals",
    "/api/v1/performance/plans",
    "/api/v1/performance/target-changes",
    "/api/v1/performance/key-results",
    "/api/v1/performance/okrs",
  ])
    invalidate(prefix);
}

/** A request in a word or two: the function's plan, or the target it changes. */
const requestOf = (r: PerformanceApproval) =>
  r.kind === "plan" ? `${r.department ?? "Company"} Plan` : `Target Change · ${r.key_result_code ?? r.line_title ?? ""}`;

/** Opens a plan's or a target change's sheet. */
export function useApprovalSheets() {
  const modal = useModal();
  return {
    openPlan: (id: string) => modal.open({ title: "Quarter Plan", wide: true, full: true, body: (close) => <PlanApprovalSheet id={id} close={close} /> }),
    openChange: (id: string) => modal.open({ title: "Target Change", wide: true, body: (close) => <TargetChangeSheet id={id} close={close} /> }),
  };
}

/**
 * A link from the bell, Need You or ⌘K opens its sheet once, then leaves the address, so the same
 * link followed again opens it again and a reload does not.
 */
export function useApprovalLinks() {
  const [params, setParams] = useSearchParams();
  const { openPlan, openChange } = useApprovalSheets();
  const plan = params.get("plan");
  const change = params.get("change");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const key = plan ? `plan:${plan}` : change ? `change:${change}` : null;
    if (!key) {
      opened.current = null;
      return;
    }
    if (opened.current === key) return;
    opened.current = key;
    setParams({ plan: null, change: null }, { replace: true });
    if (plan) openPlan(plan);
    else if (change) openChange(change);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, change]);
}

/** Waiting On You: the plan stages and target changes the reader decides; hidden when there are none. */
export function WaitingOnYou() {
  const list = usePaged("GET /api/v1/performance/approvals");
  const { openPlan, openChange } = useApprovalSheets();
  if ((list.page?.total ?? 0) === 0) return null;
  return (
    <DataView
      className="mb-3"
      title="Waiting On You"
      list={list}
      rowKey={(r) => r.workflow_instance_id}
      noun="request"
      onRowClick={(r) => (r.kind === "plan" ? openPlan(r.record_id) : openChange(r.record_id))}
      columns={[
        { key: "request", label: "Request", render: (r) => <span className="font-semibold">{requestOf(r)}</span> },
        { key: "from", label: "From", render: (r) => (r.requested_by ? person(r.requested_by) : "–") },
        { key: "stage", label: "Stage", render: (r) => <StatusPill s={{ tone: r.overdue ? "err" : "warn", text: r.stage_name }} /> },
        { key: "since", label: "Waiting Since", render: (r) => formatDateTime(r.waiting_since) },
      ]}
    />
  );
}

/** One plan stage: what the plan binds, where it stands; Request Changes or Approve Plan for its approver. */
function PlanApprovalSheet({ id, close }: { id: string; close: () => void }) {
  const modal = useModal();
  const plan = useApi("GET /api/v1/performance/plans/:id", { params: { id } });
  const p = plan.data;
  const instanceId = p?.status === "submitted" ? p.workflow_instance_id : null;
  const instance = useApi("GET /api/v1/workflow/instances/:id", { params: { id: instanceId ?? "" }, enabled: Boolean(instanceId) });
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  if (plan.error) return <ErrorState error={plan.error} onRetry={plan.reload} />;
  if (!p) return <LoadingRows count={6} />;
  const w = instanceId ? instance.data : undefined;
  const steps = (w?.route ?? [])
    .filter((s) => s.state !== "skipped")
    .map((s) => ({ label: s.name, state: s.state === "done" || s.state === "now" ? s.state : undefined }));
  const keyResults = p.objectives.reduce((n, o) => n + o.key_results.length, 0);
  const decide = async () => {
    if (!instanceId) return;
    try {
      const next = await approve.run({ params: { id: instanceId }, body: {} });
      refresh();
      close();
      toast(next.state === "pending" && next.stage_name ? `Sent on to ${next.stage_name}` : "Plan approved");
    } catch (e) {
      say(e);
    }
  };
  const sendBack = () =>
    instanceId &&
    modal.open({ title: "Request Changes", body: (done) => <ReasonForm instanceId={instanceId} close={() => (done(), refresh())} done="Plan sent back" /> });
  const items: Array<[string, ReactNode]> = [
    ["Function", p.department ?? "Company"],
    ["Quarter", p.period_name],
    ["Status", <StatusPill key="status" s={planStatus(p.status)} />],
    ["Stage", w?.stage_name ?? null],
    ["Sent By", p.submitted_by?.display_name ?? null],
    ["Sent On", p.submitted_at ? formatDateTime(p.submitted_at) : null],
    ["Objectives", String(p.objective_count)],
    ["Key Results", String(keyResults)],
    ["Scorecards", String(p.scorecard_count)],
  ];
  return (
    <>
      <KeyValue items={items} />
      {steps.length > 0 && <Chain className="mt-3" steps={steps} label="Plan approval" />}
      {p.returned_reason && (
        <Banner tone="err" className="mt-2">
          {p.returned_reason}
        </Banner>
      )}
      {p.problems.map((x) => (
        <Banner key={x.message} tone={x.blocking ? "err" : "warn"} className="mt-2">
          {x.message}
        </Banner>
      ))}
      <DataView
        className="mt-3"
        title="Objectives"
        rows={p.objectives}
        rowKey={(o) => o.okr_objective_id}
        noun="objective"
        columns={[
          { key: "code", label: "Code", render: (o) => <span className="font-semibold">{o.code}</span> },
          { key: "title", label: "Objective", render: (o) => o.title },
          { key: "krs", label: "Key Results", render: (o) => o.key_results.map((k) => k.code).join(", ") || "–" },
        ]}
      />
      {p.scorecards.length > 0 && (
        <DataView
          className="mt-3"
          title="Scorecards"
          rows={p.scorecards}
          rowKey={(c) => c.scorecard_id}
          noun="scorecard"
          columns={[
            { key: "person", label: "Person", render: (c) => person(c.employee) },
            { key: "reviewer", label: "Reviewer", render: (c) => c.reviewer?.display_name ?? c.reviewer_role ?? "–", desktop: true },
            { key: "lines", label: "Lines", align: "n", render: (c) => String(c.line_count), desktop: true },
            { key: "status", label: "Status", render: (c) => <StatusPill s={cardStatus(c.status)} /> },
          ]}
        />
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {w?.can_decide && <Button onClick={sendBack}>Request Changes</Button>}
        {w?.can_decide && (
          <Button variant="primary" onClick={decide}>
            Approve Plan
          </Button>
        )}
      </FormFooter>
    </>
  );
}

/** One target change: the target, from and to, its month and reason; Refuse Change or Approve Change for the CEO. */
function TargetChangeSheet({ id, close }: { id: string; close: () => void }) {
  const modal = useModal();
  const read = useApi("GET /api/v1/performance/target-changes/:id", { params: { id } });
  const c = read.data;
  const instanceId = c?.status === "pending" ? c.workflow_instance_id : null;
  const instance = useApi("GET /api/v1/workflow/instances/:id", { params: { id: instanceId ?? "" }, enabled: Boolean(instanceId) });
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!c) return <LoadingRows count={6} />;
  const w = instanceId ? instance.data : undefined;
  const figure = (value: string | null, text: string | null) => figureOf(value, text, c.unit);
  const decide = async () => {
    if (!instanceId) return;
    try {
      await approve.run({ params: { id: instanceId }, body: {} });
      refresh();
      close();
      toast("Change approved");
    } catch (e) {
      say(e);
    }
  };
  const refuse = () =>
    instanceId &&
    modal.open({
      title: "Refuse Change",
      body: (done) => <ReasonForm instanceId={instanceId} close={() => (done(), refresh())} done="Change refused" action="Refuse Change" />,
    });
  const items: Array<[string, ReactNode]> = [
    ...(c.key_result ? ([["Key Result", `${c.key_result.code} · ${c.key_result.statement}`]] as Array<[string, ReactNode]>) : []),
    ...(c.line
      ? ([
          ["Line", c.line.title],
          ["Person", c.line.employee.display_name],
        ] as Array<[string, ReactNode]>)
      : []),
    ["Function", c.department ?? "Company"],
    ["Quarter", c.period_name],
    ["Old Target", figure(c.from_value, c.from_text) ?? "Not set"],
    ["New Target", figure(c.to_value, c.to_text)],
    ["From Month", formatMonth(c.from_month)],
    ["Reason", c.reason],
    ["Asked By", c.requested_by?.display_name ?? null],
    ["Asked On", formatDateTime(c.created_at)],
    ["Status", <StatusPill key="status" s={changeStatus(c.status)} />],
  ];
  return (
    <>
      <KeyValue items={items} />
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {w?.can_decide && <Button onClick={refuse}>Refuse Change</Button>}
        {w?.can_decide && (
          <Button variant="primary" onClick={decide}>
            Approve Change
          </Button>
        )}
      </FormFooter>
    </>
  );
}
