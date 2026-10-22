/**
 * Performance · Scorecards (the `targets` tab; docs/guides/performance.md §2, §3.3, §6.5, §6.6,
 * §10): each person's quarter scorecard. The list with its figures and filters; New Scorecard for
 * a manager; a scorecard's sections and lines with Edit Lines, Change Reviewer, Agree Scorecard and
 * Disagree With Reason, and Send Scorecard for one drafted after its plan bound (PR 3). The
 * Scorecards and Commitments switch opens the Commitments view beside it (Commitments.tsx;
 * `?view=commitments`, or `?set=` from an approval's link).
 */
import { useState } from "react";
import targetsContract from "@mycity/contract/schemas/targets.js";
import type { KeyResult, ScorecardDetail, ScorecardLine } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { EmployeePicker } from "@/features/shared/pickers";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  DataView,
  DateField,
  Field,
  FilterSelect,
  formatDate,
  FormFooter,
  HelpTerm,
  KeyValue,
  PageHeader,
  SegmentedControl,
  SelectField,
  StatusPill,
  TextField,
  toast,
  Toolbar,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { Commitments } from "./Commitments";
import { cardStatus, fieldMessage, monthShort, person, rating, score, SECTION_NAMES, useQuarter } from "./shared";

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");
const STATUS_OPTIONS: Array<[string, string]> = [["", "All Statuses"], ["draft", "Draft"], ["binding", "Awaiting Agreement"], ["agreed", "Agreed"], ["closed", "Closed"]];
const AUTO = new Set(["key_result", "team_result", "function_kpi", "commitments", "update_on_time", "team_reviews", "tasks"]);

/** The Scorecards and Commitments switch; the view lives in the address. */
function ViewSwitch({ view }: { view: "scorecards" | "commitments" }) {
  const [, setParams] = useSearchParams();
  return (
    <SegmentedControl
      value={view}
      onChange={(v) => setParams({ view: v === "commitments" ? "commitments" : null, set: null }, { replace: true })}
      options={[["scorecards", "Scorecards"], ["commitments", "Commitments"]]}
    />
  );
}

export function Scorecards() {
  const [params] = useSearchParams();
  const commitments = params.get("view") === "commitments" || Boolean(params.get("set"));
  if (commitments) return <Commitments switcher={<ViewSwitch view="commitments" />} />;
  return <ScorecardsView />;
}

function ScorecardsView() {
  const me = useMe();
  const modal = useModal();
  const quarter = useQuarter();
  const period = quarter.period;
  const departments = useApi("GET /api/v1/departments", { query: {} });
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState("");
  const filters = {
    ...(quarter.periodId ? { period_id: quarter.periodId } : {}),
    ...(dept ? { department_id: dept } : {}),
    ...(status ? { status: status as "draft" } : {}),
  };
  const list = usePaged("GET /api/v1/performance/scorecards", { filters, enabled: Boolean(quarter.periodId) });
  const all = usePaged("GET /api/v1/performance/scorecards", { filters: quarter.periodId ? { period_id: quarter.periodId } : {}, enabled: Boolean(quarter.periodId) });
  const agreed = usePaged("GET /api/v1/performance/scorecards", { filters: { ...(quarter.periodId ? { period_id: quarter.periodId } : {}), status: "agreed" }, enabled: Boolean(quarter.periodId) });
  const waiting = usePaged("GET /api/v1/performance/scorecards", { filters: { ...(quarter.periodId ? { period_id: quarter.periodId } : {}), status: "binding" }, enabled: Boolean(quarter.periodId) });
  const below = usePaged("GET /api/v1/performance/scorecards", { filters: { ...(quarter.periodId ? { period_id: quarter.periodId } : {}), rating: "below" }, enabled: Boolean(quarter.periodId) });
  const deptOptions: Array<[string, string]> = [["", "All Departments"], ...(departments.data?.data ?? []).filter((d) => d.active).map((d) => [d.department_id, d.name] as [string, string])];

  const mayDraft = (me.manages_people || hasCapability(me, "performance.manage")) && Boolean(me.grants.performance?.includes("create"));
  const newCard = () => modal.open({ title: "New Scorecard", body: (close) => <NewScorecardForm close={close} periodId={quarter.periodId} onOpen={openCard} /> });
  const openCard = (id: string) => modal.open({ title: "Scorecard", wide: true, body: (close) => <ScorecardSheet id={id} close={close} /> });
  useScreenAction(mayDraft && period ? { label: "New Scorecard", onSelect: newCard } : null);

  return (
    <>
      <PageHeader
        title="Scorecards"
        sub={period ? `${period.name} · ${formatDate(period.starts_on)} to ${formatDate(period.ends_on)}` : undefined}
        actions={
          <>
            <ViewSwitch view="scorecards" />
            {mayDraft && period && <Button variant="primary" icon="plus" onClick={newCard}>New Scorecard</Button>}
          </>
        }
      />
      <Toolbar>
        <FilterSelect label="Quarter" value={quarter.periodId} onChange={quarter.setPeriodId} options={quarter.options} />
        <FilterSelect label="Department" value={dept} onChange={setDept} options={deptOptions} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </Toolbar>
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Scorecards", value: String(all.page?.total ?? 0) },
          { label: "Agreed", value: String(agreed.page?.total ?? 0), tone: "ok" },
          { label: "Awaiting Agreement", value: String(waiting.page?.total ?? 0), tone: waiting.page?.total ? "warn" : undefined },
          { label: "Below Meets", value: String(below.page?.total ?? 0), tone: below.page?.total ? "err" : undefined },
        ]}
      />
      <PagedTable
        title="Scorecards"
        list={list}
        search="Search People"
        rowKey={(s) => s.scorecard_id}
        noun="scorecard"
        onRowClick={(s) => openCard(s.scorecard_id)}
        empty={{ title: "No Scorecards Yet" }}
        columns={[
          { key: "employee", label: "Employee", render: (s) => person(s.employee) },
          { key: "department", label: "Department", render: (s) => s.department ?? "–", desktop: true },
          { key: "reviewer", label: "Reviewer", render: (s) => s.reviewer?.display_name ?? s.reviewer_role ?? "–", desktop: true },
          { key: "status", label: "Status", render: (s) => <StatusPill s={cardStatus(s.status)} /> },
          { key: "score", label: "Score to Date", align: "n", render: (s) => score(s.score_to_date) },
          { key: "rating", label: "Rating", render: (s) => <StatusPill s={rating(s.rating)} /> },
        ]}
      />
    </>
  );
}

/** A manager drafts a scorecard for someone in their scope, copied from last quarter or blank. */
function NewScorecardForm({ close, periodId, onOpen }: { close: () => void; periodId: string; onOpen: (id: string) => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const f = useContractForm({ employee_id: "", performance_period_id: periodId, copy_from: "last_quarter" }, targetsContract.ScorecardCreate);
  const save = useMutation("POST /api/v1/performance/scorecards");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const card = await save.run({ body: f.values as { employee_id: string; performance_period_id: string; copy_from: "last_quarter" } });
      invalidate("/api/v1/performance/scorecards");
      close();
      toast("Scorecard drafted");
      onOpen(card.scorecard_id);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Employee" {...f.status("employee_id")}>
        <EmployeePicker
          value={who}
          onChange={(v) => {
            setWho(v);
            f.field("employee_id").onChange(v[0]?.employee_id ?? "");
          }}
        />
      </Field>
      <Field label="Lines From" {...f.status("copy_from")}>
        <SelectField options={[["last_quarter", "Last Quarter"], ["none", "Start Blank"]]} {...f.field("copy_from")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Draft Scorecard</Button>
      </FormFooter>
    </>
  );
}

/** One scorecard: who, the figures, its three sections and their lines; what the reader may do. */
function ScorecardSheet({ id, close }: { id: string; close: () => void }) {
  const me = useMe();
  const modal = useModal();
  const read = useApi("GET /api/v1/performance/scorecards/:id", { params: { id } });
  const period = useApi("GET /api/v1/performance/periods/:id", { params: { id: read.data?.performance_period_id ?? "" }, enabled: Boolean(read.data) });
  const agree = useMutation("POST /api/v1/performance/scorecards/:id/agree");
  const send = useMutation("POST /api/v1/performance/scorecards/:id/submit");
  const c = read.data;
  if (!c) return null;
  const months = period.data?.months ?? [];
  const mine = c.employee.employee_id === me.employee_id;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/performance/scorecards");
  };
  const agreeCard = async () => {
    try {
      await agree.run({ params: { id }, body: {} });
      reload();
      toast("Scorecard agreed");
    } catch (e) {
      say(e);
    }
  };
  // A scorecard drafted after its plan bound goes through the plan's flow on its own (§6.4).
  const sendCard = async () => {
    try {
      await send.run({ params: { id }, body: {} });
      reload();
      toast("Scorecard sent for approval");
    } catch (e) {
      say(e);
    }
  };
  const agreedText = c.employee_agreed_at && c.reviewer_agreed_at ? "Both" : c.employee_agreed_at ? "Employee" : c.reviewer_agreed_at ? "Reviewer" : "Not Yet";
  return (
    <>
      <KeyValue
        items={[
          ["Employee", c.employee.display_name],
          ["Designation", c.employee.job_title ?? "–"],
          ["Department", c.department ?? "–"],
          ["Reviewer", c.reviewer?.display_name ?? c.reviewer_role ?? "–"],
          ["Dotted Line", c.dotted?.display_name ?? "–"],
          ["Scope", c.scope_text ?? "–"],
        ]}
      />
      <KeyValue
        className="mt-3"
        items={[
          ["Status", cardStatus(c.status).text],
          ["Score to Date", score(c.score_to_date)],
          ["Rating", rating(c.rating).text],
          ["Weights", c.weight_problems.length ? "Check" : "100%"],
          ["Agreed", agreedText],
          ...(c.amendment_instance_id ? ([["Approval", "Awaiting Approval"]] as Array<[string, string]>) : []),
          ...(c.disagree_reason && c.disagreed_at ? ([["Disagreed", c.disagree_reason]] as Array<[string, string]>) : []),
        ]}
      />
      {c.weight_problems.map((w) => (
        <Banner key={w.section} tone="warn" className="mt-2">{`${SECTION_NAMES[w.section]} lines total ${w.total}, not ${w.expected}.`}</Banner>
      ))}
      {(["results", "kpis", "accountability"] as const).map((section) => (
        <SectionLines key={section} section={section} card={c} months={months} />
      ))}
      {c.contributions.length > 0 && (
        <DataView
          className="mt-3"
          title="Contribution"
          rows={c.contributions}
          rowKey={(x) => x.okr_key_result_id}
          columns={[
            { key: "kr", label: "Key Result", render: (x) => x.code },
            { key: "shares", label: "Shares", render: (x) => x.shares.map((s) => `${s.employee.display_name} ${s.share_value}`).join(", ") },
            { key: "target", label: "Target", align: "n", render: (x) => x.target_value ?? "–" },
            { key: "status", label: "Status", render: (x) => <StatusPill s={x.status === "ok" ? { tone: "ok", text: "OK" } : { tone: "err", text: "Rebalance" }} /> },
          ]}
        />
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {c.can_edit && <Button onClick={() => modal.open({ title: "Edit Lines", wide: true, body: (done) => <LinesForm card={c} close={() => (done(), reload())} /> })}>Edit Lines</Button>}
        {hasCapability(me, "performance.manage") && c.status !== "closed" && (
          <Button onClick={() => modal.open({ title: "Change Reviewer", body: (done) => <ReviewerForm id={id} close={() => (done(), reload())} /> })}>Change Reviewer</Button>
        )}
        {c.can_agree && mine && <Button onClick={() => modal.open({ title: "Disagree With Reason", body: (done) => <DisagreeForm id={id} close={() => (done(), reload())} /> })}>Disagree With Reason</Button>}
        {c.can_agree && <Button variant="primary" onClick={agreeCard}>Agree Scorecard</Button>}
        {c.can_send && <Button variant="primary" onClick={sendCard}>Send Scorecard</Button>}
      </FormFooter>
    </>
  );
}

function SectionLines({ section, card, months }: { section: ScorecardLine["section"]; card: ScorecardDetail; months: string[] }) {
  const lines = card.lines.filter((l) => l.section === section);
  const weight = card[`${section}_weight`];
  return (
    <DataView
      className="mt-3"
      title={`${SECTION_NAMES[section]} · ${weight}%`}
      rows={lines}
      rowKey={(l) => l.employee_target_id}
      empty={{ title: "No Lines" }}
      columns={[
        {
          key: "title",
          label: section === "kpis" ? "KPI" : "Goal",
          render: (l) => (
            <span className="flex flex-wrap items-center gap-1.5">
              {l.title}
              {AUTO.has(l.source) && <StatusPill s={{ tone: "info", text: "Auto" }} />}
            </span>
          ),
        },
        { key: "target", label: "Target", render: (l) => `${l.target_text ?? l.target_value ?? "–"}${l.unit && l.target_value ? (l.unit === "%" ? "%" : ` ${l.unit}`) : ""}` },
        {
          key: "linked",
          label: <HelpTerm help="The key result or KPI this line feeds. Its figures come from there.">Linked To</HelpTerm>,
          render: (l) => l.key_result?.code ?? l.kpi?.code ?? (l.team_key_results.map((k) => k.code).join(", ") || "–"),
          desktop: true,
        },
        { key: "due", label: "Due", render: (l) => (l.milestone_due_on ?? l.due_on ? formatDate((l.milestone_due_on ?? l.due_on)!) : "–"), desktop: true },
        { key: "weight", label: "Weight", align: "n", render: (l) => `${l.weight}%` },
        ...months.map((m) => ({ key: m, label: monthShort(m), align: "n" as const, desktop: true, render: (l: ScorecardLine) => score(l.months.find((x) => x.month === m)?.score) })),
        { key: "score", label: "Score", align: "n", render: (l) => score(l.score) },
      ]}
    />
  );
}

const MEASURES: Record<ScorecardLine["section"], Array<[ScorecardLine["measure"], string]>> = {
  results: [["numeric", "Numeric"], ["milestone", "Milestone"]],
  kpis: [["standard", "Standard"], ["binary", "Yes or No"]],
  accountability: [["standard", "Standard"], ["binary", "Yes or No"]],
};
/** The line fields Edit Lines marks on screen; any other a save refuses is said in a toast. */
const SHOWN = new Set(["title", "measure", "target_value", "target_text", "weight", "okr_key_result_id", "kpi_definition_id", "team_key_result_ids", "share_value", "milestone_due_on"]);
/** The number a target names ("≥97% of tickets" → "97"), kept beside its words. */
const numberIn = (text: string) => /^[^\d-]*(-?\d[\d,]*(?:\.\d+)?)/.exec(text)?.[1]?.replace(/,/g, "") ?? null;

/** A line as Edit Lines holds it: what it edits, and the rest of the line kept as it was. */
type LineRow = {
  employee_target_id: string;
  section: ScorecardLine["section"];
  title: string;
  measure: ScorecardLine["measure"];
  target: string;
  target_edited: boolean;
  weight: string;
  source: ScorecardLine["source"];
  okr_key_result_id: string;
  kpi_definition_id: string;
  due_on: string;
  kept: Pick<ScorecardLine, "direction" | "unit" | "frequency_text" | "share_value" | "target_value" | "target_text" | "okr_key_result_id" | "kpi_definition_id"> & {
    team_key_result_ids: string[];
  };
};

const rowOf = (l: ScorecardLine): LineRow => ({
  employee_target_id: l.employee_target_id,
  section: l.section,
  title: l.title,
  measure: l.measure,
  target: l.target_text ?? l.target_value ?? "",
  target_edited: false,
  weight: l.weight,
  source: l.source,
  okr_key_result_id: l.okr_key_result_id ?? "",
  kpi_definition_id: l.kpi_definition_id ?? "",
  // A milestone's date is its own; a line copied without one is asked for it, never given the quarter's end.
  due_on: (l.measure === "milestone" ? l.milestone_due_on : l.due_on) ?? "",
  kept: {
    direction: l.direction,
    unit: l.unit,
    frequency_text: l.frequency_text,
    share_value: l.share_value,
    target_value: l.target_value,
    target_text: l.target_text,
    okr_key_result_id: l.okr_key_result_id,
    kpi_definition_id: l.kpi_definition_id,
    team_key_result_ids: l.team_key_results.map((k) => k.okr_key_result_id),
  },
});

const NEW_LINE: LineRow = {
  employee_target_id: "",
  section: "results",
  title: "",
  measure: "numeric",
  target: "",
  target_edited: true,
  weight: "",
  source: "own",
  okr_key_result_id: "",
  kpi_definition_id: "",
  due_on: "",
  kept: { direction: "higher", unit: null, frequency_text: null, share_value: null, target_value: null, target_text: null, okr_key_result_id: null, kpi_definition_id: null, team_key_result_ids: [] },
};

/**
 * A row as the API takes a line. The target goes back as it was unless edited; edited words keep the
 * number they name beside them. A link the person cleared here goes back to their own figure; a line
 * that came without its link (copied from last quarter) still asks for one.
 */
function lineOf(r: LineRow) {
  const typed = r.target.trim();
  const target = r.target_edited
    ? typed
      ? /^-?\d+(\.\d+)?$/.test(typed)
        ? { target_value: typed }
        : { target_text: typed, ...(numberIn(typed) ? { target_value: numberIn(typed)! } : {}) }
      : {}
    : { ...(r.kept.target_value ? { target_value: r.kept.target_value } : {}), ...(r.kept.target_text ? { target_text: r.kept.target_text } : {}) };
  const linked: ScorecardLine["source"] | null = r.okr_key_result_id ? "key_result" : r.kpi_definition_id ? "function_kpi" : null;
  const cleared = (r.source === "key_result" && r.kept.okr_key_result_id) || (r.source === "function_kpi" && r.kept.kpi_definition_id);
  const source: ScorecardLine["source"] = linked ?? (cleared ? "own" : r.source);
  return {
    ...(r.employee_target_id ? { employee_target_id: r.employee_target_id } : {}),
    section: r.section,
    title: r.title,
    measure: r.measure,
    direction: r.kept.direction,
    ...(r.kept.unit ? { unit: r.kept.unit } : {}),
    ...(r.kept.frequency_text ? { frequency_text: r.kept.frequency_text } : {}),
    ...target,
    weight: r.weight,
    source,
    ...(r.okr_key_result_id ? { okr_key_result_id: r.okr_key_result_id } : {}),
    ...(r.kpi_definition_id ? { kpi_definition_id: r.kpi_definition_id } : {}),
    // A share is of one key result: moving the line to another leaves it behind.
    ...(r.okr_key_result_id && r.okr_key_result_id === r.kept.okr_key_result_id && r.kept.share_value ? { share_value: r.kept.share_value } : {}),
    team_key_result_ids: r.kept.team_key_result_ids,
    ...(r.due_on ? (r.measure === "milestone" ? { milestone_due_on: r.due_on } : { due_on: r.due_on }) : {}),
  };
}

/** Every line of a draft scorecard in one save: a line left out is removed. */
function LinesForm({ card, close }: { card: ScorecardDetail; close: () => void }) {
  const okrs = usePaged("GET /api/v1/performance/okrs", { filters: { period_id: card.performance_period_id, ...(card.department_id ? { department_id: card.department_id } : {}) } });
  const kpis = usePaged("GET /api/v1/performance/kpis", { filters: card.department_id ? { department_id: card.department_id } : {} });
  const [rows, setRows] = useState<LineRow[]>(card.lines.map(rowOf));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = useMutation("PUT /api/v1/performance/scorecards/:id/lines");
  const set = (i: number, patch: Partial<LineRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const krOptions: Array<[string, string]> = [["", "None"], ...okrs.rows.flatMap((o) => o.key_results.map((k: KeyResult) => [k.okr_key_result_id, `${k.code} · ${k.statement}`] as [string, string]))];
  const kpiOptions: Array<[string, string]> = [["", "None"], ...kpis.rows.map((k) => [k.kpi_definition_id, `${k.code} · ${k.name}`] as [string, string])];
  const submit = async () => {
    try {
      await save.run({ params: { id: card.scorecard_id }, body: { lines: rows.map(lineOf) } });
      close();
      toast("Lines saved");
    } catch (e) {
      if (!(e instanceof ApiError) || !Object.keys(e.fields).length) return say(e);
      setErrors(e.fields);
      // What no field shows is said in a toast, naming its line.
      const unshown = Object.entries(e.fields).find(([k]) => !/^lines\.\d+\./.test(k) || !SHOWN.has(k.split(".").slice(2).join(".")));
      if (unshown) {
        const at = /^lines\.(\d+)\./.exec(unshown[0]);
        toast(at ? `Line ${Number(at[1]) + 1}: ${unshown[1][0]}` : e.message);
      }
    }
  };
  const err = (i: number, ...keys: string[]) => keys.map((k) => errors[`lines.${i}.${k}`]?.[0]).find(Boolean);
  const mark = (i: number, short: string, ...keys: string[]) => {
    const message = fieldMessage(err(i, ...keys), short);
    return message ? { state: "bad" as const, message } : {};
  };
  return (
    <>
      {rows.map((r, i) => (
        <Card key={r.employee_target_id || `new-${i}`} className="mb-2">
          <CardHeader
            title={`Line ${i + 1}`}
            actions={
              <Button
                size="sm"
                icon="x"
                onClick={() => {
                  setRows(rows.filter((_, j) => j !== i));
                  setErrors({});
                }}
              >
                Remove Line
              </Button>
            }
          />
          <Field label="Section">
            <SelectField
              options={Object.entries(SECTION_NAMES)}
              value={r.section}
              onChange={(v) => {
                const section = v as LineRow["section"];
                if (section !== r.section) set(i, { section, measure: MEASURES[section][0][0], okr_key_result_id: "", kpi_definition_id: "" });
              }}
            />
          </Field>
          <Field label="Goal" {...mark(i, "Shorten the goal", "title")}><TextField value={r.title} onChange={(v) => set(i, { title: v })} /></Field>
          <Field label="Measure" {...mark(i, "Pick another measure", "measure")}>
            <SelectField
              options={MEASURES[r.section]}
              value={r.measure}
              onChange={(v) => set(i, { measure: v as LineRow["measure"], ...(v === "milestone" && r.measure !== "milestone" ? { due_on: "" } : {}) })}
            />
          </Field>
          <Field label="Target" optional {...mark(i, "Check the target", "target_value", "target_text")}><TextField value={r.target} onChange={(v) => set(i, { target: v, target_edited: true })} /></Field>
          {r.measure === "milestone" && (
            <Field label="Due Date" {...mark(i, "Pick a date", "milestone_due_on")}><DateField value={r.due_on} onChange={(v) => set(i, { due_on: v })} /></Field>
          )}
          <Field label="Weight" {...mark(i, "Check the weight", "weight")}><TextField value={r.weight} onChange={(v) => set(i, { weight: v.replace(/[^\d.]/g, "") })} inputMode="decimal" /></Field>
          {r.section === "kpis" ? (
            <Field label="KPI" optional {...mark(i, "Link a KPI", "kpi_definition_id")}><SelectField options={kpiOptions} value={r.kpi_definition_id} onChange={(v) => set(i, { kpi_definition_id: v })} /></Field>
          ) : (
            <Field label="Key Result" optional {...mark(i, "Link a key result", "okr_key_result_id", "team_key_result_ids", "share_value")}>
              <SelectField options={krOptions} value={r.okr_key_result_id} onChange={(v) => set(i, { okr_key_result_id: v })} />
            </Field>
          )}
        </Card>
      ))}
      <Button icon="plus" onClick={() => setRows([...rows, NEW_LINE])}>Add Line</Button>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Lines</Button>
      </FormFooter>
    </>
  );
}

function ReviewerForm({ id, close }: { id: string; close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const f = useContractForm({ reviewer_employee_id: "", reviewer_reason: "" }, targetsContract.ScorecardEdit);
  const save = useMutation("PATCH /api/v1/performance/scorecards/:id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: { reviewer_employee_id: f.values.reviewer_employee_id || null, reviewer_reason: f.values.reviewer_reason } });
      close();
      toast("Reviewer changed");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reviewer" {...f.status("reviewer_employee_id")}>
        <EmployeePicker
          value={who}
          onChange={(v) => {
            setWho(v);
            f.field("reviewer_employee_id").onChange(v[0]?.employee_id ?? "");
          }}
        />
      </Field>
      <Field label="Reason" {...f.status("reviewer_reason")}><TextField {...f.field("reviewer_reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Change Reviewer</Button>
      </FormFooter>
    </>
  );
}

function DisagreeForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ disagree_reason: "" }, targetsContract.DisagreeBody);
  const save = useMutation("POST /api/v1/performance/scorecards/:id/disagree");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      close();
      toast("Sent to your reviewer");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("disagree_reason")}><TextField {...f.field("disagree_reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Reason</Button>
      </FormFooter>
    </>
  );
}
