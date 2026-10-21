import { useState } from "react";
import goals from "@mycity/contract/schemas/goals.js";
import type { Goal, GoalDetail } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { BarsCard, PagedTable } from "@/features/shared/sections";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  ChoiceField,
  ErrorState,
  Field,
  FormFooter,
  formatDate,
  formatMonth,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  PageHeader,
  SelectField,
  StatusPill,
  TapList,
  TextField,
  toast,
  todayIso,
  useContractForm,
  useModal,
  Who,
} from "@mycity/ui";
import { ApprovalCard } from "./approval";
import { goalStatus, LEVEL_NAME, percent, progressStatus } from "./status";

/**
 * Performance · Goals (#29; docs/guides/performance.md §10): the CEO's organisational goals,
 * Management's annual and monthly goals under them, each traced up to the goal it serves and
 * approved by Management, Operations & People and the CEO before it binds (A16).
 */
const PENDING_HELP = "Waiting on Management, Operations & People, then the CEO.";

export function Goals() {
  const me = useMe();
  const modal = useModal();
  const year = Number(todayIso().slice(0, 4));
  const summary = useApi("GET /api/v1/performance/goals/summary", { query: { year } });
  const org = usePaged("GET /api/v1/performance/goals", { filters: { level: "organisation", year } });
  const annual = usePaged("GET /api/v1/performance/goals", { filters: { level: "annual", year } });
  const monthly = usePaged("GET /api/v1/performance/goals", { filters: { level: "monthly", year } });
  const canSet = hasCapability(me, "goals.organisation") || hasCapability(me, "goals.company");
  const newGoal = () => modal.open({ title: "New Goal", body: (close) => <GoalForm close={close} year={year} /> });
  const open = (g: Goal) => modal.open({ title: g.code ?? "Goal", wide: true, full: true, body: () => <GoalPanel id={g.organisational_goal_id} /> });
  useScreenAction(canSet ? { label: "New Goal", onSelect: newGoal } : null);

  const status = { key: "status", label: <HelpTerm help={PENDING_HELP}>Status</HelpTerm>, render: (g: Goal) => <StatusPill s={goalStatus(g.status)} /> };
  const progress = { key: "progress", label: "Progress", align: "n" as const, render: (g: Goal) => percent(g.progress.attainment) };
  const owner = { key: "owner", label: "Owner", desktop: true, render: (g: Goal) => <Who name={g.owner.display_name} sub={g.owner.job_title ?? undefined} /> };
  const upTo = { key: "up", label: "Rolls Up To", render: (g: Goal) => g.rolls_up_to?.title };

  return (
    <>
      <PageHeader title="Goals" sub={String(year)} actions={canSet && <Button variant="primary" icon="plus" onClick={newGoal}>New Goal</Button>} />
      <PagedTable<Goal>
        title="Organisational Goals"
        list={org}
        rowKey={(g) => g.organisational_goal_id}
        onRowClick={open}
        noun="goal"
        wide
        columns={[
          { key: "code", label: "Goal ID", render: (g) => <span className="font-semibold">{g.code}</span> },
          { key: "theme", label: "Strategic Theme", render: (g) => g.strategic_theme },
          { key: "title", label: "Goal", render: (g) => g.title },
          { key: "measure", label: "Success Measure", desktop: true, render: (g) => g.success_measure },
          { key: "baseline", label: "Baseline", desktop: true, render: (g) => g.baseline },
          owner,
          status,
        ]}
      />
      <Grid cols={2} className="mt-3">
        <PagedTable<Goal> title="Annual Goals" list={annual} rowKey={(g) => g.organisational_goal_id} onRowClick={open} noun="goal" columns={[{ key: "title", label: "Goal", render: (g) => g.title }, upTo, owner, progress, status]} />
        <PagedTable<Goal> title="Monthly Goals" list={monthly} rowKey={(g) => g.organisational_goal_id} onRowClick={open} noun="goal" columns={[{ key: "title", label: "Goal", render: (g) => g.title }, upTo, { key: "month", label: "Month", desktop: true, render: (g) => formatMonth(g.starts_on.slice(0, 7)) }, progress, status]} />
      </Grid>
      <div className="mt-3 max-md:hidden">
        {summary.data ? (
          <BarsCard
            title="Goal Progress"
            rows={summary.data.progress.map((p) => ({ label: p.code ? `${p.code} ${p.title}` : p.title, pct: Math.round((p.attainment ?? 0) * 100), value: percent(p.attainment) ?? "" }))}
          />
        ) : (
          <Card><LoadingRows /></Card>
        )}
      </div>
    </>
  );
}

/** A goal: its fields, cascade, what it rolls up to, what hangs from it, and its approval. */
function GoalPanel({ id }: { id: string }) {
  const g = useApi("GET /api/v1/performance/goals/:id", { params: { id } });
  const submit = useMutation("POST /api/v1/performance/goals/:id/submit");
  const decide = useMutation("POST /api/v1/performance/goals/:id/decide");
  if (g.error) return <ErrorState error={g.error} onRetry={g.reload} />;
  if (!g.data) return <LoadingRows count={6} />;
  const d: GoalDetail = g.data;
  const after = (next: GoalDetail, words: string) => {
    g.set(next);
    invalidate("/api/v1/performance/goals");
    toast(words);
  };
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader title={LEVEL_NAME[d.level]} right={<StatusPill s={goalStatus(d.status)} />} />
        <KeyValue
          items={[
            ["Goal", d.title],
            ["Strategic Theme", d.strategic_theme],
            ["Success Measure", d.success_measure],
            ["Baseline", d.baseline],
            ["Period", `${formatDate(d.starts_on)} to ${formatDate(d.ends_on)}`],
            ["Owner", d.owner.display_name],
            ["Progress", d.progress.attainment === null ? null : <span className="inline-flex items-center gap-2">{percent(d.progress.attainment)} <StatusPill s={progressStatus(d.progress.progress_status)} /></span>],
          ]}
        />
        {d.can_submit && (
          <Button
            variant="primary"
            className="mt-3"
            onClick={async () => after(await submit.run({ params: { id }, body: {} }), "Sent for approval")}
          >
            Submit for Approval
          </Button>
        )}
      </Card>
      {d.quarters.length > 0 && (
        <Card>
          <CardHeader title="Quarterly Cascade" />
          <KeyValue items={d.quarters.map((q) => [`Quarter ${q.quarter}`, q.milestone])} />
        </Card>
      )}
      {d.trace.length > 0 && (
        <Card>
          <CardHeader title="Rolls Up To" />
          <TapList items={d.trace.map((t) => ({ key: t.organisational_goal_id, title: t.title, sub: `${LEVEL_NAME[t.level]}${t.code ? ` · ${t.code}` : ""}` }))} />
        </Card>
      )}
      {d.children.length > 0 && (
        <Card>
          <CardHeader title="Children" />
          <TapList items={d.children.map((t) => ({ key: t.organisational_goal_id, title: t.title, sub: LEVEL_NAME[t.level], right: <StatusPill s={goalStatus(t.status)} /> }))} />
        </Card>
      )}
      <ApprovalCard
        route={d.route}
        decisions={d.decisions}
        canDecide={d.can_decide}
        noun="Goal"
        decide={async (body) => after(await decide.run({ params: { id }, body }), body.decision === "approve" ? "Goal approved" : "Goal returned")}
      />
    </div>
  );
}

/** The next twelve months, this one first. */
function monthOptions(): Array<[string, string]> {
  const [y, m] = todayIso().slice(0, 7).split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7);
    return [d, formatMonth(d)];
  });
}

type Level = "organisation" | "annual" | "monthly";

function GoalForm({ close, year }: { close: () => void; year: number }) {
  const me = useMe();
  const levels: Array<[Level, string]> = [
    ...(hasCapability(me, "goals.organisation") ? ([["organisation", "Organisational"]] as Array<[Level, string]>) : []),
    ...(hasCapability(me, "goals.company") ? ([["annual", "Annual"], ["monthly", "Monthly"]] as Array<[Level, string]>) : []),
  ];
  const [level, setLevel] = useState<Level>(levels[0]?.[0] ?? "annual");
  const parentLevel = level === "annual" ? "organisation" : "annual";
  const parents = usePaged("GET /api/v1/performance/goals", { filters: { level: parentLevel, status: "active", year }, enabled: level !== "organisation" });
  const f = useContractForm(
    { level: level as Level, title: "", strategic_theme: "", success_measure: "", baseline: "", year, month: "", parent_goal_id: "" },
    goals.GoalCreate,
  );
  const [quarters, setQuarters] = useState(["", "", "", ""]);
  const save = useMutation("POST /api/v1/performance/goals");
  const pick = (v: Level) => {
    setLevel(v);
    f.set("level", v);
    f.set("parent_goal_id", "");
  };
  const submit = f.submit(async (v) => {
    try {
      const g = await save.run({
        body: {
          ...v,
          ...(v.level === "monthly" ? { year: undefined } : { month: undefined }),
          ...(v.level === "organisation"
            ? { parent_goal_id: undefined, quarters: quarters.flatMap((m, i) => (m.trim() ? [{ quarter: i + 1, milestone: m.trim() }] : [])) }
            : {}),
        },
      });
      invalidate("/api/v1/performance/goals");
      close();
      toast(g.status === "active" ? `${g.code} is active` : `${g.code} saved as a draft`);
    } catch (e) {
      if (e instanceof ApiError && e.fields) f.setServerErrors(e.fields);
      else if (e instanceof ApiError) toast(e.message);
    }
  });
  return (
    <>
      {levels.length > 1 && (
        <Field label="Level">
          <ChoiceField value={level} onChange={pick} options={levels} />
        </Field>
      )}
      <Field label="Goal" {...f.status("title")}>
        <TextField {...f.field("title")} placeholder="12 cities live" />
      </Field>
      {level === "organisation" && (
        <>
          <Field label="Strategic Theme" optional {...f.status("strategic_theme")}>
            <TextField {...f.field("strategic_theme")} placeholder="Expansion" />
          </Field>
          <Field label="Success Measure" optional {...f.status("success_measure")}>
            <TextField {...f.field("success_measure")} placeholder="Cities live" />
          </Field>
          <Field label="Baseline" optional {...f.status("baseline")}>
            <TextField {...f.field("baseline")} placeholder="8 cities" />
          </Field>
          {quarters.map((m, i) => (
            <Field key={i} label={`Quarter ${i + 1}`} optional>
              <TextField value={m} onChange={(v) => setQuarters(quarters.map((x, j) => (j === i ? v : x)))} aria-label={`Quarter ${i + 1}`} />
            </Field>
          ))}
        </>
      )}
      {level !== "organisation" && (
        <Field label="Rolls Up To" {...f.status("parent_goal_id")}>
          <SelectField
            {...f.field("parent_goal_id")}
            placeholder={level === "annual" ? "Organisational goal" : "Annual goal"}
            options={parents.rows.map((p) => [p.organisational_goal_id, p.code ? `${p.code} ${p.title}` : p.title])}
          />
        </Field>
      )}
      {level === "monthly" && (
        <Field label="Month" {...f.status("month")}>
          <SelectField {...f.field("month")} placeholder="Month" options={monthOptions()} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Create Goal</Button>
      </FormFooter>
    </>
  );
}
