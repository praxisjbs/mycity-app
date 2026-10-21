import { useState } from "react";
import targets from "@mycity/contract/schemas/targets.js";
import type { Plan, Target } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, PagedTable, TrailCard } from "@/features/shared/sections";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  Chain,
  ErrorState,
  Field,
  FormFooter,
  formatDateTime,
  formatMonth,
  Grid,
  KeyValue,
  LoadingRows,
  PageHeader,
  SelectField,
  StatusPill,
  TextField,
  toast,
  todayIso,
  useContractForm,
  useModal,
  Who,
} from "@mycity/ui";
import { ApprovalCard } from "./approval";
import { goalStatus, percent, shiftMonth } from "./status";

/**
 * Performance · Targets (#30; docs/guides/performance.md §10): a month's departmental targets,
 * each department's month sent to Management, Operations & People and the CEO as one, and the
 * month's results and trail.
 */
const planStatus = (p: Plan) =>
  ({
    draft: { tone: "neutral" as const, text: "Draft" },
    pending_approval: { tone: "warn" as const, text: p.waiting_on ?? "Pending" },
    active: { tone: "ok" as const, text: "Approved" },
    returned: { tone: "err" as const, text: "Returned" },
  })[p.status];

export function Targets() {
  const me = useMe();
  const modal = useModal();
  const current = todayIso().slice(0, 7);
  const [month, setMonth] = useState(current);
  const s = useApi("GET /api/v1/performance/targets/summary", { query: { month } });
  const list = usePaged("GET /api/v1/performance/targets", { filters: { month } });
  const submit = useMutation("POST /api/v1/performance/plans/:department_id/:month/submit");
  const canSet = hasCapability(me, "goals.department");
  const setTargets = () => modal.open({ title: "Set Targets", body: (close) => <TargetForm close={close} month={month} /> });
  const openPlan = (planId: string) => modal.open({ title: "Department Month", wide: true, full: true, body: () => <PlanPanel id={planId} month={month} /> });
  useScreenAction(canSet ? { label: "Set Targets", onSelect: setTargets } : null);
  const mine = s.data?.my_plan;

  return (
    <>
      <PageHeader
        title="Targets"
        sub={formatMonth(month)}
        actions={
          <>
            <Button icon="left" onClick={() => setMonth(shiftMonth(month, -1))}>Previous Month</Button>
            {month !== current && <Button onClick={() => setMonth(current)}>This Month</Button>}
            <Button iconRight="right" onClick={() => setMonth(shiftMonth(month, 1))}>Next Month</Button>
            {mine?.can_submit && (
              <Button
                onClick={async () => {
                  try {
                    await submit.run({ params: { department_id: mine.department_id, month }, body: {} });
                    invalidate("/api/v1/performance");
                    toast("Month sent for approval");
                  } catch (e) {
                    if (e instanceof ApiError) toast(e.fields?.weights?.[0] ?? e.message);
                  }
                }}
              >
                Submit Month
              </Button>
            )}
            {canSet && <Button variant="primary" icon="plus" onClick={setTargets}>Set Targets</Button>}
          </>
        }
      />
      {s.error && <ErrorState error={s.error} onRetry={s.reload} />}
      {s.data && (
        <>
          <KpiTiles
            mobileCols={2}
            items={[
              { label: "Departments", value: String(s.data.departments) },
              { label: "Approved", value: String(s.data.approved), tone: "ok" },
              { label: "Awaiting Approval", value: String(s.data.awaiting), tone: s.data.awaiting ? "warn" : undefined },
            ]}
          />
          <Card className="mt-3 max-md:hidden">
            <CardHeader title="Approval Chain" />
            <Chain steps={s.data.chain.map((c) => ({ label: c.waiting ? `${c.name} · ${c.waiting}` : c.name, state: c.waiting ? "now" : undefined }))} />
          </Card>
        </>
      )}
      <div className="mt-3">
        <PagedTable<Target>
          title="Departmental Targets"
          list={list}
          search="Search targets"
          rowKey={(t) => t.organisational_goal_id}
          onRowClick={(t) => t.performance_plan_id && openPlan(t.performance_plan_id)}
          noun="target"
          wide
          empty={{ title: "No Targets Yet", text: "Heads set them for their month." }}
          columns={[
            { key: "dept", label: "Department", render: (t) => <span className="font-semibold">{t.department}</span> },
            { key: "title", label: "Target", render: (t) => t.title },
            { key: "up", label: "Rolls Up To", desktop: true, render: (t) => t.rolls_up_to.title },
            { key: "by", label: "Set By", desktop: true, render: (t) => <Who name={t.owner.display_name} /> },
            { key: "measure", label: "Measure", desktop: true, render: (t) => t.success_measure },
            { key: "progress", label: "Progress", align: "n", render: (t) => percent(t.progress.attainment) },
            { key: "status", label: "Status", render: (t) => <StatusPill s={goalStatus(t.status)} /> },
            {
              key: "act",
              label: "",
              render: (t) =>
                t.can_decide && t.performance_plan_id ? (
                  <Button size="sm" variant="primary" onClick={() => openPlan(t.performance_plan_id!)}>Review Month</Button>
                ) : null,
            },
          ]}
        />
      </div>
      {s.data && (
        <Grid cols={2} className="mt-3 max-md:hidden">
          <BarsCard
            title="Last Month's Results"
            rows={s.data.last_month.map((r) => ({ label: r.department, pct: Math.round((r.attainment ?? 0) * 100), value: percent(r.attainment) ?? "" }))}
          />
          <TrailCard
            title="Approval Trail"
            items={s.data.trail.map((d) => ({
              title: `${d.department}: ${d.decision === "approve" ? "approved" : d.decision === "cancel" ? "withdrawn" : "returned"} by ${d.actor_name ?? "the system"}`,
              when: formatDateTime(d.decided_at),
              text: d.reason,
              tone: d.decision === "approve" ? "ok" : null,
            }))}
          />
        </Grid>
      )}
    </>
  );
}

/** One department's month: what it holds, where it stands, Approve or Return. */
function PlanPanel({ id, month }: { id: string; month: string }) {
  const s = useApi("GET /api/v1/performance/targets/summary", { query: { month } });
  const decide = useMutation("POST /api/v1/performance/plans/:id/decide");
  const [plan, setPlan] = useState<Plan | null>(null);
  if (s.error) return <ErrorState error={s.error} onRetry={s.reload} />;
  const p = plan ?? s.data?.plans.find((x) => x.performance_plan_id === id);
  if (!p) return <LoadingRows count={4} />;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader title={p.department} right={<StatusPill s={planStatus(p)} />} />
        <KeyValue
          items={[
            ["Month", formatMonth(p.month)],
            ["Targets", String(p.targets)],
            ["KPIs", String(p.kpis)],
            ["Submitted By", p.submitted_by?.display_name],
            ["Submitted", p.submitted_at && formatDateTime(p.submitted_at)],
          ]}
        />
      </Card>
      <ApprovalCard
        route={p.route}
        decisions={[]}
        canDecide={p.can_decide}
        noun="Month"
        decide={async (body) => {
          const next = await decide.run({ params: { id }, body });
          setPlan(next);
          invalidate("/api/v1/performance");
          toast(body.decision === "approve" ? "Month approved" : "Month returned");
        }}
      />
    </div>
  );
}

function TargetForm({ close, month }: { close: () => void; month: string }) {
  const me = useMe();
  const goals = usePaged("GET /api/v1/performance/goals", { filters: { level: "monthly", status: "active", month } });
  const depts = useApi("GET /api/v1/departments", { query: {}, enabled: me.is_ceo });
  const f = useContractForm({ title: "", success_measure: "", month, parent_goal_id: "", department_id: undefined as string | undefined }, targets.TargetCreate);
  const save = useMutation("POST /api/v1/performance/targets");
  const submit = f.submit(async (v) => {
    try {
      await save.run({ body: v });
      invalidate("/api/v1/performance");
      close();
      toast("Target set");
    } catch (e) {
      if (e instanceof ApiError && e.fields) f.setServerErrors(e.fields);
      else if (e instanceof ApiError) toast(e.message);
    }
  });
  return (
    <>
      {me.is_ceo && (
        <Field label="Department" optional {...f.status("department_id")}>
          <SelectField
            value={f.values.department_id ?? ""}
            onChange={(v) => f.set("department_id", v || undefined)}
            placeholder="Your department"
            options={(depts.data?.data ?? []).map((d) => [d.department_id, d.name])}
          />
        </Field>
      )}
      <Field label="Target" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder="6 school sessions" />
      </Field>
      <Field label="Measure" optional {...f.status("success_measure")}>
        <TextField {...f.field("success_measure")} placeholder="Sessions held" />
      </Field>
      <Field label="Rolls Up To" {...f.status("parent_goal_id")}>
        <SelectField
          {...f.field("parent_goal_id")}
          placeholder="Monthly goal"
          options={goals.rows.map((g) => [g.organisational_goal_id, g.code ? `${g.code} ${g.title}` : g.title])}
        />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Set Target</Button>
      </FormFooter>
    </>
  );
}
