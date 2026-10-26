/**
 * Performance · Goals (docs/guides/performance.md §2, §3.1, §3.2, §3.5, §10): the quarter's OKR
 * tree. Organisational goals, each opening its sheet (Edit Goal, Delete Goal for the CEO); the
 * company's and each function's objectives with their key results, edited and deleted while their
 * plan is draft or returned; the function's plan and its approval; Waiting On You, the plan stages
 * and target changes the reader decides (./Approvals); Report Month for the head, Confirm Score for
 * the CEO, Set Target on a TBC target before its lock date and Change Target after it; Set Up
 * Quarter and Edit Quarter (./Quarter) for whoever runs the cycle. ⌘K opens a goal (?goal=), an
 * objective (?objective=) and a key result (?id=). Everyone sees the whole tree.
 */
import { useEffect, useRef, useState } from "react";
import goalsContract from "@mycity/contract/schemas/goals.js";
import scoring from "@mycity/contract/schemas/scoring.js";
import type { KeyResult, KeyResultMonth, Objective, OrganisationalGoalDetail, PerformancePeriod } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { EmployeePicker } from "@/features/shared/pickers";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { hasCapability } from "@/shell/access";
import { useScreenAction, useUrlAction } from "@/shell/screen-action";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  DataView,
  DateField,
  EmptyState,
  ErrorState,
  Field,
  FilterSelect,
  formatDate,
  formatMonth,
  FormFooter,
  IconButton,
  KeyValue,
  LoadingRows,
  Menu,
  NumberField,
  PageHeader,
  Pager,
  SelectField,
  StatusPill,
  TextAreaField,
  TextField,
  toast,
  Toolbar,
  useConfirm,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { useApprovalLinks, WaitingOnYou } from "./Approvals";
import { KeyResultForm, KR_TYPES, SetTargetForm } from "./KeyResultForm";
import { QuarterWizard } from "./Quarter";
import { band, bodySchema, fieldMessage, figureOf, krStatus, KR_STATUS_OPTIONS, planStatus, reportingMonth, score, useQuarter } from "./shared";

type KrMonthStatus = KeyResultMonth["status"];
const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");

export function Goals() {
  const me = useMe();
  const modal = useModal();
  const quarter = useQuarter();
  const period = quarter.period;
  const departments = useApi("GET /api/v1/departments", { query: {} });
  const [dept, setDept] = useState("");
  const okrs = usePaged("GET /api/v1/performance/okrs", {
    filters: { ...(quarter.periodId ? { period_id: quarter.periodId } : {}), ...(dept ? { department_id: dept } : {}) },
    enabled: Boolean(quarter.periodId),
  });
  const goals = usePaged("GET /api/v1/performance/goals", { filters: period ? { plan_year: Number(period.starts_on.slice(0, 4)) } : {} });
  const plans = usePaged("GET /api/v1/performance/plans", { filters: quarter.periodId ? { period_id: quarter.periodId } : {}, enabled: Boolean(quarter.periodId) });
  const plan = dept ? plans.rows.find((p) => (dept === "company" ? p.department_id === null : p.department_id === dept)) : undefined;

  const summary = useApi("GET /api/v1/performance/okrs/summary", {
    query: { period_id: quarter.periodId, ...(dept ? { department_id: dept } : {}) },
    enabled: Boolean(quarter.periodId),
  });
  const counted = (n: number | undefined) => (n === undefined ? "–" : String(n));
  const tiles = [
    { label: "Company Score", value: score(summary.data?.company_score) },
    { label: "On Track", value: counted(summary.data?.on_track), tone: "ok" as const },
    { label: "In Recovery", value: counted(summary.data?.in_recovery), tone: "err" as const },
    { label: "Awaiting Report", value: counted(summary.data?.awaiting_report) },
  ];
  const functions: Array<[string, string]> = (departments.data?.data ?? []).filter((d) => d.active).map((d) => [d.department_id, d.name] as [string, string]);
  const chips: Array<[string, string]> = [["", "All Functions"], ["company", "Company"], ...functions];

  const mayGoal = hasCapability(me, "goals.organisation") || hasCapability(me, "goals.company") || hasCapability(me, "goals.function");
  const manage = hasCapability(me, "performance.manage");
  const newGoal = () => modal.open({ title: "New Goal", full: true, body: (close) => <NewGoalForm close={close} period={period} objectives={okrs.rows} /> });
  const latest = quarter.periods[0];
  const setUpQuarter = () =>
    modal.open({ title: "Set Up Quarter", wide: true, full: true, body: (close) => <QuarterWizard close={close} latest={latest} onSaved={(p) => quarter.setPeriodId(p.performance_period_id)} /> });
  const editQuarter = () =>
    period && modal.open({ title: "Edit Quarter", wide: true, full: true, body: (close) => <QuarterWizard close={close} period={period} /> });
  // Report Month is one function's: the one picked, else the reader's own, else the first.
  const ownFunction = functions.find(([, name]) => name === me.department)?.[0];
  const report = () =>
    modal.open({
      title: "Report Month",
      wide: true,
      body: (close) => <ReportMonthForm close={close} period={period} functions={functions} initial={(dept !== "company" && dept) || ownFunction || functions[0]?.[0] || ""} />,
    });
  useScreenAction(mayGoal && period ? { label: "New Goal", onSelect: newGoal } : null);
  useUrlAction("report", hasCapability(me, "goals.function") && period && departments.data ? report : null);
  useUrlAction("quarter", manage && !quarter.loading ? setUpQuarter : null);
  useApprovalLinks();
  const openKrId = (id: string, code = "Key Result") => modal.open({ title: code, wide: true, body: (close) => <KeyResultSheet id={id} close={close} /> });
  const openKr = (kr: KeyResult) => openKrId(kr.okr_key_result_id, kr.code);
  const openGoal = (id: string) => modal.open({ title: "Organisational Goal", wide: true, body: (close) => <GoalSheet id={id} close={close} /> });
  const openObjective = (id: string) => modal.open({ title: "Objective", wide: true, body: (close) => <ObjectiveSheet id={id} close={close} onOpen={openKr} /> });
  useRecordLinks({ id: openKrId, goal: openGoal, objective: openObjective });
  const quarterMenu = manage ? (
    <Menu
      label="Manage Quarters"
      trigger={(p) => <Button {...p} icon="calendar">Manage Quarters</Button>}
      items={[
        { label: "Set Up Quarter", icon: "plus", onSelect: setUpQuarter },
        ...(period && period.status !== "closed" ? [{ label: "Edit Quarter", icon: "edit" as const, onSelect: editQuarter }] : []),
      ]}
    />
  ) : null;

  return (
    <>
      <PageHeader
        title="Goals"
        sub={period ? `${period.name} · ${formatDate(period.starts_on)} to ${formatDate(period.ends_on)}` : undefined}
        actions={
          (period && (mayGoal || hasCapability(me, "goals.function"))) || quarterMenu ? (
            <>
              {quarterMenu}
              {period && hasCapability(me, "goals.function") && <Button icon="check" onClick={report}>Report Month</Button>}
              {period && mayGoal && <Button variant="primary" icon="plus" onClick={newGoal}>New Goal</Button>}
            </>
          ) : undefined
        }
      />
      <Toolbar>
        <FilterSelect label="Quarter" value={quarter.periodId} onChange={quarter.setPeriodId} options={quarter.options} />
        <FilterSelect label="Function" value={dept} onChange={setDept} options={chips} />
      </Toolbar>
      <KpiTiles items={tiles} mobileCols={2} />
      <WaitingOnYou />
      {plan && <PlanCard id={plan.performance_plan_id} />}
      <PagedTable
        title="Organisational Goals"
        list={goals}
        rowKey={(g) => g.organisational_goal_id}
        onRowClick={(g) => openGoal(g.organisational_goal_id)}
        noun="goal"
        columns={[
          { key: "code", label: "Goal ID", render: (g) => <span className="font-semibold">{g.code ?? "–"}</span> },
          { key: "theme", label: "Strategic Theme", render: (g) => g.strategic_theme ?? "–", desktop: true },
          { key: "goal", label: "Goal", render: (g) => g.title },
          { key: "measure", label: "Success Measure", render: (g) => g.success_measure ?? "–", desktop: true },
        ]}
      />
      {okrs.rows.map((o) => (
        <ObjectiveCard key={o.okr_objective_id} objective={o} onOpen={openKr} />
      ))}
      {!okrs.loading && okrs.rows.length === 0 && <EmptyState className="mt-3" title="No Objectives Yet" />}
      {okrs.rows.length > 0 && <Pager page={okrs.page} onPage={okrs.setPage} noun="objective" label="Objectives" />}
    </>
  );
}

/**
 * A link from ⌘K, the bell or another screen opens its record once, then leaves the address: a key
 * result's panel (?id=), an organisational goal's sheet (?goal=), an objective's sheet (?objective=).
 */
function useRecordLinks(open: { id: (id: string) => void; goal: (id: string) => void; objective: (id: string) => void }) {
  const [params, setParams] = useSearchParams();
  const asked = (["id", "goal", "objective"] as const).map((k) => [k, params.get(k)] as const).find(([, v]) => v);
  const key = asked ? `${asked[0]}:${asked[1]}` : null;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!asked || !key) {
      opened.current = null;
      return;
    }
    if (opened.current === key) return;
    opened.current = key;
    setParams({ id: null, goal: null, objective: null }, { replace: true });
    open[asked[0]](asked[1] as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Edit Objective and Delete Objective, while its plan is draft or returned and the reader sets its goals. */
function useObjectiveActions(objective: Objective, done?: () => void) {
  const modal = useModal();
  const confirm = useConfirm();
  const del = useMutation("DELETE /api/v1/performance/objectives/:id");
  const edit = () => modal.open({ title: "Edit Objective", body: (close) => <ObjectiveForm close={close} objective={objective} onSaved={done} /> });
  const remove = async () => {
    if (!(await confirm({ title: "Delete Objective", body: `${objective.code} · ${objective.title}`, confirmLabel: "Delete Objective", destructive: true }))) return;
    try {
      await del.run({ params: { id: objective.okr_objective_id } });
      invalidate("/api/v1/performance/okrs");
      invalidate("/api/v1/performance/plans");
      toast(`${objective.code} deleted`);
      done?.();
    } catch (e) {
      say(e);
    }
  };
  return { edit, remove };
}

function ObjectiveCard({ objective, onOpen }: { objective: Objective; onOpen: (kr: KeyResult) => void }) {
  const { edit, remove } = useObjectiveActions(objective);
  return (
    <Card className="mt-3">
      <CardHeader
        title={`${objective.code} · ${objective.title}`}
        record
        actions={
          <span className="flex items-center gap-2">
            <span className="text-xs font-semibold">{score(objective.score)}</span>
            {objective.can_edit && (
              <Menu
                label="Objective Actions"
                trigger={(p) => <IconButton {...p} icon="dots" label={`${objective.code} Actions`} size="sm" />}
                items={[
                  { label: "Edit Objective", icon: "edit", onSelect: edit },
                  "sep",
                  { label: "Delete Objective", icon: "trash", danger: true, onSelect: remove },
                ]}
              />
            )}
          </span>
        }
      />
      <DataView
        bare
        caption={objective.code}
        rows={objective.key_results}
        rowKey={(k) => k.okr_key_result_id}
        onRowClick={onOpen}
        columns={[
          { key: "code", label: "Code", render: (k) => <span className="font-semibold">{k.code}</span> },
          { key: "kr", label: "Key Result", render: (k) => k.statement },
          { key: "owner", label: "Owner", render: (k) => k.accountable?.display_name ?? k.accountable_note ?? "–", desktop: true },
          { key: "finish", label: "Finish", render: (k) => (k.finishes_on ? formatDate(k.finishes_on) : "–"), desktop: true },
          { key: "status", label: "Status", render: (k) => <StatusPill s={k.target_provisional ? { tone: "info", text: "TBC" } : krStatus(k.latest?.status)} /> },
          { key: "score", label: "Score", align: "n", render: (k) => score(k.latest?.score) },
        ]}
      />
    </Card>
  );
}

/** An objective opened from ⌘K: what it serves and its key results; Edit Objective and Delete Objective while its plan is a draft. */
function ObjectiveSheet({ id, close, onOpen }: { id: string; close: () => void; onOpen: (kr: KeyResult) => void }) {
  const read = useApi("GET /api/v1/performance/objectives/:id", { params: { id } });
  const o = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!o) return <LoadingRows count={4} />;
  return <ObjectiveDetail objective={o} close={close} onOpen={onOpen} />;
}

function ObjectiveDetail({ objective: o, close, onOpen }: { objective: Objective; close: () => void; onOpen: (kr: KeyResult) => void }) {
  const { edit, remove } = useObjectiveActions(o, close);
  return (
    <>
      <KeyValue
        items={[
          ["Objective", `${o.code} · ${o.title}`],
          ["Function", o.department ?? "Company"],
          ["Plan", planStatus(o.plan_status).text],
          ["Score", score(o.score)],
        ]}
      />
      <DataView
        className="mt-3"
        title="Key Results"
        rows={o.key_results}
        rowKey={(k) => k.okr_key_result_id}
        onRowClick={(k) => {
          close();
          onOpen(k);
        }}
        empty={{ title: "No Key Results Yet" }}
        columns={[
          { key: "code", label: "Code", render: (k) => <span className="font-semibold">{k.code}</span> },
          { key: "kr", label: "Key Result", render: (k) => k.statement },
          { key: "score", label: "Score", align: "n", render: (k) => score(k.latest?.score) },
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {o.can_edit && <Button variant="danger" onClick={remove}>Delete Objective</Button>}
        {o.can_edit && <Button variant="primary" onClick={edit}>Edit Objective</Button>}
      </FormFooter>
    </>
  );
}

/** An organisational goal: its theme, measure, baseline, description and quarterly targets; Edit Goal and Delete Goal for the CEO. */
function GoalSheet({ id, close }: { id: string; close: () => void }) {
  const me = useMe();
  const modal = useModal();
  const confirm = useConfirm();
  const read = useApi("GET /api/v1/performance/goals/:id", { params: { id } });
  const del = useMutation("DELETE /api/v1/performance/goals/:id");
  const g = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!g) return <LoadingRows count={6} />;
  const mine = hasCapability(me, "goals.organisation");
  const remove = async () => {
    if (!(await confirm({ title: "Delete Goal", body: `${g.code ? `${g.code} · ` : ""}${g.title}`, confirmLabel: "Delete Goal", destructive: true }))) return;
    try {
      await del.run({ params: { id } });
      invalidate("/api/v1/performance/goals");
      close();
      toast("Goal deleted");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <KeyValue
        items={[
          ["Goal", `${g.code ? `${g.code} · ` : ""}${g.title}`],
          ["Strategic Theme", g.strategic_theme ?? "–"],
          ["Success Measure", g.success_measure ?? "–"],
          ["Baseline", g.baseline ?? "–"],
          ["Description", g.detail ?? "–"],
          ...g.targets.map((t) => [`${t.period_name} Target`, figureOf(t.target_value, t.target_text) ?? "–"] as [string, string]),
          ["Objectives", g.objectives.map((o) => o.code).join(", ") || "–"],
          ["Progress", score(g.progress)],
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {mine && <Button variant="danger" onClick={remove}>Delete Goal</Button>}
        {mine && (
          <Button variant="primary" onClick={() => modal.open({ title: "Edit Goal", body: () => <GoalEditForm goal={g} close={() => modal.open({ title: "Organisational Goal", wide: true, body: (c) => <GoalSheet id={id} close={c} /> })} /> })}>
            Edit Goal
          </Button>
        )}
      </FormFooter>
    </>
  );
}

/** Edit Goal: its title, description and a target in words for each quarter of its plan year. */
function GoalEditForm({ goal, close }: { goal: OrganisationalGoalDetail; close: () => void }) {
  const year = Number((goal.plan_year_starts_on ?? goal.starts_on).slice(0, 4));
  // A plan year holds at most four quarters: the whole list, in quarter order.
  const periods = usePaged("GET /api/v1/performance/periods", { filters: { plan_year: year } });
  if (periods.loading && !periods.rows.length) return <LoadingRows count={4} />;
  return <GoalFields goal={goal} periods={[...periods.rows].sort((a, b) => a.starts_on.localeCompare(b.starts_on)).slice(0, 4)} close={close} />;
}

function GoalFields({ goal, periods, close }: { goal: OrganisationalGoalDetail; periods: PerformancePeriod[]; close: () => void }) {
  type Values = Record<string, string>;
  const held = (p: PerformancePeriod) => goal.targets.find((t) => t.performance_period_id === p.performance_period_id);
  const toBody = (v: Values) => ({
    title: v.title,
    detail: v.detail,
    // A quarter's target in words; its figure is kept as it was. A quarter with neither is left out.
    targets: periods
      .map((p, i) => ({ performance_period_id: p.performance_period_id, target_text: v[`target_${i}`] ?? "", target_value: held(p)?.target_value ?? "" }))
      .filter((t, i) => t.target_text || held(periods[i]!)),
  });
  const fieldOf = (path: PropertyKey[]) => (path[0] === "targets" ? `target_${String(path[1])}` : String(path[0] ?? ""));
  const initial: Values = { title: goal.title, detail: goal.detail ?? "", ...Object.fromEntries(periods.map((p, i) => [`target_${i}`, held(p)?.target_text ?? ""])) };
  const f = useContractForm(initial, bodySchema<Values>(goalsContract.OrganisationalGoalEdit, toBody, fieldOf));
  const save = useMutation("PATCH /api/v1/performance/goals/:id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: goal.organisational_goal_id }, body: toBody(f.values as Values) });
      invalidate("/api/v1/performance/goals");
      close();
      toast("Goal saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Goal" {...f.status("title")}><TextField {...f.field("title")} /></Field>
      <Field label="Description" optional {...f.status("detail")}><TextAreaField {...f.field("detail")} rows={3} /></Field>
      {periods.map((p, i) => (
        <Field key={p.performance_period_id} label={`${p.name} Target`} optional {...f.status(`target_${i}`)}>
          <TextField {...f.field(`target_${i}`)} placeholder="64,000 users" />
        </Field>
      ))}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Goal</Button>
      </FormFooter>
    </>
  );
}

/** The selected function's plan: where it stands, what stops it, Send Plan. */
function PlanCard({ id }: { id: string }) {
  const plan = useApi("GET /api/v1/performance/plans/:id", { params: { id } });
  const send = useMutation("POST /api/v1/performance/plans/:id/submit");
  const p = plan.data;
  if (!p) return null;
  const submit = async () => {
    try {
      await send.run({ params: { id }, body: {} });
      invalidate("/api/v1/performance/plans");
      plan.reload();
      toast("Plan sent for approval");
    } catch (e) {
      say(e);
    }
  };
  return (
    <Card className="mb-3">
      <CardHeader title="Plan Approval" actions={<StatusPill s={planStatus(p.status)} />} />
      <KeyValue
        items={[
          ["Objectives", String(p.objective_count)],
          ["Scorecards", String(p.scorecard_count)],
          ...(p.returned_reason ? ([["Returned", p.returned_reason]] as Array<[string, string]>) : []),
        ]}
      />
      {p.problems.map((x) => (
        <Banner key={x.message} tone={x.blocking ? "err" : "warn"} className="mt-2">
          {x.message}
        </Banner>
      ))}
      {p.can_submit && (
        <div className="mt-3">
          <Button variant="primary" onClick={submit}>Send Plan</Button>
        </div>
      )}
    </Card>
  );
}

/** A key result's panel: its facts, this month, its history; Change Target and Confirm Score. */
function KeyResultSheet({ id, close }: { id: string; close: () => void }) {
  const me = useMe();
  const modal = useModal();
  const kr = useApi("GET /api/v1/performance/key-results/:id", { params: { id } });
  const confirm = useMutation("POST /api/v1/performance/key-results/:id/confirm");
  const del = useMutation("DELETE /api/v1/performance/key-results/:id");
  const ask = useConfirm();
  const k = kr.data;
  if (kr.error) return <ErrorState error={kr.error} onRetry={kr.reload} />;
  if (!k) return null;
  const latest = k.latest;
  const reload = () => {
    kr.reload();
    invalidate("/api/v1/performance/okrs");
  };
  const remove = async () => {
    if (!(await ask({ title: "Delete Key Result", body: `${k.code} · ${k.statement}`, confirmLabel: "Delete Key Result", destructive: true }))) return;
    try {
      await del.run({ params: { id } });
      invalidate("/api/v1/performance/okrs");
      close();
      toast(`${k.code} deleted`);
    } catch (e) {
      say(e);
    }
  };
  const figure = (value: string | null | undefined, text: string | null | undefined) => figureOf(value, text, k.unit);
  // One modal at a time: a form opened from the panel comes back to it, read again, when it closes.
  const back = () => {
    invalidate("/api/v1/performance/key-results");
    modal.open({ title: k.code, wide: true, body: (c) => <KeyResultSheet id={id} close={c} /> });
  };
  const confirmScore = async () => {
    if (!latest?.score) return;
    try {
      await confirm.run({ params: { id }, body: { month: latest.month, score: latest.score } });
      kr.reload();
      invalidate("/api/v1/performance/okrs");
      toast("Score confirmed");
    } catch (e) {
      say(e);
    }
  };
  const was = k.target_history.filter((c) => c.status === "approved").at(0);
  const waiting = k.target_history.find((c) => c.status === "pending");
  return (
    <>
      <KeyValue
        items={[
          ["Key Result", k.statement],
          ["Type", KR_TYPES[k.kr_type ?? ""] ?? "–"],
          ["Owner", k.accountable?.display_name ?? k.accountable_note ?? "–"],
          ["Start", k.starts_on ? formatDate(k.starts_on) : "–"],
          ["Finish", k.finishes_on ? formatDate(k.finishes_on) : "–"],
          ["Baseline", k.baseline_text ?? "–"],
          ["Target", `${figure(k.target_value, k.target_text) ?? "–"}${k.target_provisional ? " · TBC" : ""}${was ? ` · Was ${figure(was.from_value, was.from_text) ?? "not set"}` : ""}`],
          ...(waiting
            ? ([["Change Waiting", `${figure(waiting.to_value, waiting.to_text) ?? "–"} from ${formatMonth(waiting.from_month)}`]] as Array<[string, string]>)
            : []),
          ["Feeds", k.linked_company_key_results.map((c) => c.code).join(", ") || "–"],
          ["Fed By", k.contributing.map((c) => c.code).join(", ") || "–"],
          ["Rolls Up To", k.trace.steps.filter((s) => s.kind !== "key_result").map((s) => s.code ?? s.title).join(" › ") || "–"],
        ]}
      />
      <Card className="mt-3">
        <CardHeader title="This Month" actions={<StatusPill s={band(latest?.band)} />} />
        <KeyValue
          items={[
            ["Status", krStatus(latest?.status).text],
            ["Actual", figure(latest?.actual_value, latest?.actual_text) ?? "–"],
            ["Source", latest?.actual_source ?? "–"],
            ["Update", latest?.update_text ?? "–"],
            ["Proposed", score(latest?.proposed_score)],
            ["Confirmed", score(latest?.confirmed_score)],
          ]}
        />
      </Card>
      {k.months.length > 1 && (
        <DataView
          className="mt-3"
          title="History"
          rows={k.months}
          rowKey={(m) => m.okr_key_result_month_id}
          columns={[
            { key: "m", label: "Month", render: (m) => formatMonth(m.month) },
            { key: "s", label: "Status", render: (m) => <StatusPill s={krStatus(m.status)} /> },
            { key: "a", label: "Actual", render: (m) => figure(m.actual_value, m.actual_text) ?? "–", desktop: true },
            { key: "sc", label: "Score", align: "n", render: (m) => score(m.score) },
          ]}
        />
      )}
      {k.initiatives.length > 0 && (
        <DataView
          title="Initiatives"
          rows={k.initiatives}
          rowKey={(t) => t.task_id}
          columns={[
            { key: "t", label: "Task", render: (t) => t.title },
            { key: "d", label: "Due", render: (t) => (t.due_at ? formatDate(t.due_at.slice(0, 10)) : "–") },
          ]}
        />
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {k.can_edit && <Button variant="danger" onClick={remove}>Delete Key Result</Button>}
        {k.can_set_target && (
          <Button onClick={() => modal.open({ title: "Set Target", body: () => <SetTargetForm keyResult={k} close={back} onSaved={reload} /> })}>Set Target</Button>
        )}
        {k.can_change_target && (
          <Button onClick={() => modal.open({ title: "Change Target", body: () => <ChangeTargetForm keyResultId={id} close={back} /> })}>Change Target</Button>
        )}
        {k.can_edit && (
          <Button variant="primary" onClick={() => modal.open({ title: "Edit Key Result", wide: true, full: true, body: () => <KeyResultForm keyResult={k} close={back} onSaved={reload} /> })}>
            Edit Key Result
          </Button>
        )}
        {hasCapability(me, "goals.confirm") && latest?.score && !latest.confirmed && (
          <Button variant="primary" onClick={confirmScore}>Confirm Score</Button>
        )}
      </FormFooter>
    </>
  );
}

function ChangeTargetForm({ keyResultId, close }: { keyResultId: string; close: () => void }) {
  const next = new Date();
  const month = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const f = useContractForm({ okr_key_result_id: keyResultId, to_value: "", from_month: month, reason: "" }, goalsContract.TargetChangeCreate);
  const save = useMutation("POST /api/v1/performance/target-changes");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      close();
      toast("Sent to the CEO");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="New Target" {...f.status("to_value")}><NumberField decimal signed {...f.field("to_value")} /></Field>
      <Field label="From Month" {...f.status("from_month")}><DateField {...f.field("from_month")} /></Field>
      <Field label="Reason" {...f.status("reason")}><TextField {...f.field("reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Change</Button>
      </FormFooter>
    </>
  );
}

/** Report Month: one function's month, the function picked at the top. */
function ReportMonthForm({ close, period, functions, initial }: { close: () => void; period: PerformancePeriod | null; functions: Array<[string, string]>; initial: string }) {
  const [fn, setFn] = useState(initial);
  if (!period || !functions.length)
    return (
      <>
        <EmptyState bare title="Nothing To Report" />
        <FormFooter><Button onClick={close}>Cancel</Button></FormFooter>
      </>
    );
  return (
    <>
      <Field label="Function"><SelectField options={functions} value={fn} onChange={setFn} /></Field>
      <ReportFunction key={fn} close={close} period={period} departmentId={fn} />
    </>
  );
}

type ReportRow = { status: KrMonthStatus; actual_value: string; update_text: string; recovery: PersonRef[]; recovery_due_on: string };
const RECOVERY_STATUSES = new Set<KrMonthStatus>(["missed", "at_risk", "off_track"]);

/** A key result's row for a month: what that month already holds when it is the latest, else blank. */
const prefill = (k: KeyResult, month: string): ReportRow => {
  const m = k.latest && k.latest.month === month ? k.latest : null;
  return { status: m?.status ?? "on_track", actual_value: m?.actual_value ?? "", update_text: m?.update_text ?? "", recovery: [], recovery_due_on: m?.recovery_due_on ?? "" };
};

/** Does this row ask for a recovery owner and date: by its status, or because its score falls under Watch (which the API refuses without them)? */
function recoveryOf(k: KeyResult, r: ReportRow, watch: number): { shown: boolean; required: boolean } {
  // The score the API proposes: none for a TBC target not yet locked; the actual against the target; else Done 1 and Missed 0.
  const proposed =
    k.target_provisional && !k.target_locked_at
      ? null
      : k.measure === "numeric"
        ? scoring.numericScore({ actual: r.actual_value || null, target: k.target_value, direction: k.direction ?? "higher" })
        : r.status === "done"
          ? 1
          : r.status === "missed"
            ? 0
            : null;
  const required = proposed !== null && proposed < watch;
  return { shown: required || RECOVERY_STATUSES.has(r.status), required };
}

/**
 * The function's binding objectives, a page at a time, for its month. Only the rows a person changes
 * are sent (the month keeps the rest), and they are kept while the pages turn.
 */
function ReportFunction({ close, period, departmentId }: { close: () => void; period: PerformancePeriod; departmentId: string }) {
  const okrs = usePaged("GET /api/v1/performance/okrs", { filters: { period_id: period.performance_period_id, department_id: departmentId, status: "binding" } });
  const months = period.months;
  const watch = period.rules.key_results.band_watch;
  const [month, setMonth] = useState(reportingMonth(months));
  const [edits, setEdits] = useState<Record<string, ReportRow>>({});
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const save = useMutation("POST /api/v1/performance/reports");
  const keyResults = okrs.rows.flatMap((o) => o.key_results);
  const rowOf = (k: KeyResult) => edits[k.okr_key_result_id] ?? prefill(k, month);
  const set = (k: KeyResult, patch: Partial<ReportRow>) => setEdits((e) => ({ ...e, [k.okr_key_result_id]: { ...(e[k.okr_key_result_id] ?? prefill(k, month)), ...patch } }));
  const changeMonth = (m: string) => {
    setMonth(m);
    setEdits({});
    setErrors({});
  };
  const mark = (id: string, key: string, short: string) => {
    const message = fieldMessage(errors[id]?.[key], short);
    return message ? { state: "bad" as const, message } : {};
  };
  /** An actual the contract refuses (two points, a fifth decimal), checked on its field so it never reaches the server. */
  const actualProblem = (id: string, value: string) =>
    goalsContract.KeyResultReport.safeParse({ okr_key_result_id: id, status: "on_track", actual_value: value }).error?.issues.find((i) => i.path[0] === "actual_value")?.message;
  const markActual = (id: string, value: string) =>
    setErrors((e) => {
      const { actual_value: _was, ...rest } = e[id] ?? {};
      const problem = actualProblem(id, value);
      return { ...e, [id]: problem ? { ...rest, actual_value: problem } : rest };
    });
  const submit = async () => {
    const ids = Object.keys(edits);
    if (!ids.length) {
      toast("Change a key result first");
      return;
    }
    const refused = ids.filter((id) => actualProblem(id, edits[id].actual_value));
    if (refused.length) {
      refused.forEach((id) => markActual(id, edits[id].actual_value));
      return;
    }
    try {
      await save.run({
        body: {
          month,
          department_id: departmentId,
          key_results: ids.map((id) => {
            const r = edits[id];
            return {
              okr_key_result_id: id,
              status: r.status,
              ...(r.actual_value ? { actual_value: r.actual_value } : {}),
              ...(r.update_text ? { update_text: r.update_text } : {}),
              ...(r.recovery[0] ? { recovery_employee_id: r.recovery[0].employee_id } : {}),
              ...(r.recovery_due_on ? { recovery_due_on: r.recovery_due_on } : {}),
            };
          }),
          kpis: [],
        },
      });
      invalidate("/api/v1/performance/okrs");
      close();
      toast("Month reported");
    } catch (e) {
      const rowErrors = e instanceof ApiError ? Object.entries(e.fields).filter(([key]) => /^key_results\.\d+\./.test(key)) : [];
      if (!rowErrors.length) return say(e);
      const byId: Record<string, Record<string, string>> = {};
      for (const [key, messages] of rowErrors) {
        const [, at, field] = key.split(".");
        const id = ids[Number(at)];
        if (id) byId[id] = { ...byId[id], [field]: messages[0] };
      }
      setErrors(byId);
    }
  };
  return (
    <>
      <Field label="Month"><SelectField options={months.map((m) => [m, formatMonth(m)] as [string, string])} value={month} onChange={changeMonth} /></Field>
      {!okrs.loading && !keyResults.length && <EmptyState bare title="Nothing To Report" />}
      {!okrs.loading &&
        keyResults.map((k) => {
          const id = k.okr_key_result_id;
          const r = rowOf(k);
          const recovery = recoveryOf(k, r, watch);
          const flagged = Boolean(errors[id]?.recovery_employee_id || errors[id]?.recovery_due_on);
          return (
            <Card key={id} className="mb-2">
              <CardHeader title={<span>{`${k.code} · ${k.statement}`}</span>} record />
              <Field label="Status" {...mark(id, "status", "Pick a status")}><SelectField options={KR_STATUS_OPTIONS} value={r.status} onChange={(v) => set(k, { status: v as KrMonthStatus })} /></Field>
              <Field label="Actual" optional {...mark(id, "actual_value", "Enter a number")}>
                <NumberField
                  decimal
                  signed
                  value={r.actual_value}
                  onChange={(v) => {
                    set(k, { actual_value: v });
                    if (errors[id]?.actual_value !== undefined) markActual(id, v);
                  }}
                  onBlur={() => markActual(id, r.actual_value)}
                />
              </Field>
              <Field label="Update" optional {...mark(id, "update_text", "Shorten the update")}><TextField value={r.update_text} onChange={(v) => set(k, { update_text: v })} /></Field>
              {(recovery.shown || flagged) && (
                <>
                  <Field label="Recovery Owner" optional={!recovery.required && !flagged} {...mark(id, "recovery_employee_id", "Name owner and date")}>
                    <EmployeePicker value={r.recovery} onChange={(v) => set(k, { recovery: v })} />
                  </Field>
                  <Field label="Recovery Date" optional={!recovery.required && !flagged} {...mark(id, "recovery_due_on", "Pick a date")}>
                    <DateField value={r.recovery_due_on} onChange={(v) => set(k, { recovery_due_on: v })} />
                  </Field>
                </>
              )}
            </Card>
          );
        })}
      {okrs.page && okrs.page.pages > 1 && <Pager page={okrs.page} onPage={okrs.setPage} noun="objective" label="Objectives" />}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Report Month</Button>
      </FormFooter>
    </>
  );
}

/** New Goal: an organisational goal (the CEO), an objective or a key result, as the reader may. */
function NewGoalForm({ close, period, objectives }: { close: () => void; period: PerformancePeriod | null; objectives: Objective[] }) {
  const me = useMe();
  const kinds: Array<[string, string]> = [
    ...(hasCapability(me, "goals.organisation") ? ([["goal", "Organisational Goal"]] as Array<[string, string]>) : []),
    ...(hasCapability(me, "goals.company") || hasCapability(me, "goals.function") ? ([["objective", "Objective"], ["key_result", "Key Result"]] as Array<[string, string]>) : []),
  ];
  const [kind, setKind] = useState(kinds[0]?.[0] ?? "objective");
  return (
    <>
      <Field label="What"><SelectField options={kinds} value={kind} onChange={setKind} /></Field>
      {kind === "goal" && <GoalForm close={close} period={period} />}
      {kind === "objective" && <ObjectiveForm close={close} period={period} />}
      {kind === "key_result" && <KeyResultForm close={close} objectives={objectives.filter((o) => o.can_edit)} />}
    </>
  );
}

function GoalForm({ close, period }: { close: () => void; period: PerformancePeriod | null }) {
  const year = period ? `${period.starts_on.slice(0, 4)}-01-01` : `${new Date().getUTCFullYear()}-01-01`;
  const f = useContractForm({ code: "", title: "", strategic_theme: "", success_measure: "", baseline: "", plan_year_starts_on: year }, goalsContract.OrganisationalGoalCreate);
  const save = useMutation("POST /api/v1/performance/goals");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      invalidate("/api/v1/performance/goals");
      close();
      toast("Goal recorded");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Goal ID" optional {...f.status("code")}><TextField {...f.field("code")} /></Field>
      <Field label="Goal" {...f.status("title")}><TextField {...f.field("title")} /></Field>
      <Field label="Strategic Theme" optional {...f.status("strategic_theme")}><TextField {...f.field("strategic_theme")} /></Field>
      <Field label="Success Measure" optional {...f.status("success_measure")}><TextField {...f.field("success_measure")} /></Field>
      <Field label="Baseline" optional {...f.status("baseline")}><TextField {...f.field("baseline")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Record Goal</Button>
      </FormFooter>
    </>
  );
}

/** New Objective, or Edit Objective (`objective`): its title and the organisational goal it serves. */
function ObjectiveForm({ close, period, objective, onSaved }: { close: () => void; period?: PerformancePeriod | null; objective?: Objective; onSaved?: () => void }) {
  if (objective) return <ObjectiveEditForm close={close} objective={objective} onSaved={onSaved} />;
  return <ObjectiveNewForm close={close} period={period ?? null} />;
}

/** The organisational goals an objective may serve: its quarter's plan year when it is known. */
function useGoalOptions(period: PerformancePeriod | null): Array<[string, string]> {
  const goals = usePaged("GET /api/v1/performance/goals", { filters: period ? { plan_year: Number(period.starts_on.slice(0, 4)) } : {} });
  return [["", "None"], ...goals.rows.map((g) => [g.organisational_goal_id, `${g.code ?? ""} ${g.title}`.trim()] as [string, string])];
}

function ObjectiveNewForm({ close, period }: { close: () => void; period: PerformancePeriod | null }) {
  const me = useMe();
  const departments = useApi("GET /api/v1/departments", { query: { active: "true" } });
  const goalOptions = useGoalOptions(period);
  const options: Array<[string, string]> = [
    ...(hasCapability(me, "goals.company") ? ([["", "Company"]] as Array<[string, string]>) : []),
    ...(departments.data?.data ?? []).map((d) => [d.department_id, d.name] as [string, string]),
  ];
  const f = useContractForm({ performance_period_id: period?.performance_period_id ?? "", department_id: "", title: "", organisational_goal_id: "" }, goalsContract.ObjectiveCreate);
  const save = useMutation("POST /api/v1/performance/objectives");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const o = await save.run({ body: f.values });
      invalidate("/api/v1/performance/okrs");
      close();
      toast(`${o.code} set`);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Function" {...f.status("department_id")}><SelectField options={options} {...f.field("department_id")} /></Field>
      <Field label="Objective" {...f.status("title")}><TextField {...f.field("title")} /></Field>
      <Field label="Organisational Goal" optional {...f.status("organisational_goal_id")}>
        <SelectField placeholder="None" options={goalOptions} {...f.field("organisational_goal_id")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Set Objective</Button>
      </FormFooter>
    </>
  );
}

function ObjectiveEditForm({ close, objective, onSaved }: { close: () => void; objective: Objective; onSaved?: () => void }) {
  const quarter = useApi("GET /api/v1/performance/periods/:id", { params: { id: objective.performance_period_id } });
  const goalOptions = useGoalOptions(quarter.data ?? null);
  const f = useContractForm({ title: objective.title, organisational_goal_id: objective.organisational_goal_id ?? "" }, goalsContract.ObjectiveEdit);
  const save = useMutation("PATCH /api/v1/performance/objectives/:id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: objective.okr_objective_id }, body: f.values });
      invalidate("/api/v1/performance/okrs");
      invalidate("/api/v1/performance/objectives");
      close();
      toast(`${objective.code} saved`);
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Objective" {...f.status("title")}><TextField {...f.field("title")} /></Field>
      <Field label="Organisational Goal" optional {...f.status("organisational_goal_id")}>
        <SelectField placeholder="None" options={goalOptions} {...f.field("organisational_goal_id")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Objective</Button>
      </FormFooter>
    </>
  );
}
