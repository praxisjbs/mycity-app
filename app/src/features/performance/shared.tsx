/** What the Performance tabs share: the quarter switcher, the words for codes, a person in a cell. */
import { useState } from "react";
import type { KpiUnit, PerformancePeriod } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useApi, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { ComboField, formatMonth, formatNumber, plural, shortMessage, todayIso, Who, type ComboFieldProps, type ContractSchema, type ServerFields } from "@mycity/ui";

type Tone = "ok" | "warn" | "err" | "info" | "neutral";

/**
 * The Unit field of a KPI and of a key result: it suggests the units already in use, 25 at a time, narrowed as
 * it is typed, and a unit it does not know is kept as typed and offered from then on (§5).
 */
export function UnitField(binding: Omit<ComboFieldProps<KpiUnit>, "list" | "option" | "sub" | "placeholder">) {
  const units = usePaged("GET /api/v1/performance/kpis/units", { filters: {} });
  return <ComboField {...binding} list={units} option={(u) => u.unit} sub={(u) => plural(u.uses, "use")} placeholder="users" />;
}

/** A person in a table cell: their name, and their department beneath it. */
export const person = (p: PersonRef) => <Who name={p.display_name} sub={p.department ?? undefined} />;

/**
 * The company (`department_id` null) and the functions the reader may set goals and KPIs for, as
 * the server's goals.authority answers (GET /performance/functions), each with its plan's status
 * in the quarter when one is given. New Objective and New KPI offer only these (§6.4).
 */
export function useSettableFunctions(periodId: string | null) {
  const list = usePaged("GET /api/v1/performance/functions", { filters: periodId ? { period_id: periodId } : {} });
  return { rows: list.rows.filter((f) => f.may_set), loading: list.loading, error: list.error, reload: list.reload };
}

/**
 * The Department (or Function) filter of a list that shows people: the `all` choice, then the
 * departments the reader's `performance` scope reaches (GET /performance/departments, the server's
 * answer: everyone's for a reader who sees everyone, else their own, their team's and those they
 * review or head). `pick` is false when there is nothing to choose between, so the select is left
 * off; `value` is the picked department while it is still one of the choices, else none.
 */
export function useDepartmentFilter(all: string, picked: string) {
  const list = usePaged("GET /api/v1/performance/departments");
  const options: Array<[string, string]> = [["", all], ...list.rows.map((d) => [d.department_id, d.name] as [string, string])];
  const known = list.loading || list.rows.some((d) => d.department_id === picked);
  return { options, pick: list.rows.length > 1, value: known ? picked : "" };
}

/** The quarter the screen shows: the current one until another is picked. */
export function useQuarter(): {
  period: PerformancePeriod | null;
  /** The quarters set up, newest first: the latest is the one a new quarter copies. */
  periods: PerformancePeriod[];
  options: Array<[string, string]>;
  periodId: string;
  setPeriodId: (id: string) => void;
  loading: boolean;
} {
  const list = usePaged("GET /api/v1/performance/periods");
  const current = useApi("GET /api/v1/performance/periods/current");
  const [picked, setPicked] = useState("");
  const period = list.rows.find((p) => p.performance_period_id === picked) ?? current.data ?? list.rows[0] ?? null;
  return {
    period,
    periods: [...list.rows].sort((a, b) => b.starts_on.localeCompare(a.starts_on)),
    options: list.rows.map((p) => [p.performance_period_id, p.name] as [string, string]),
    periodId: period?.performance_period_id ?? "",
    setPeriodId: setPicked,
    loading: current.loading && list.loading,
  };
}

/**
 * A contract schema for a form whose fields are flat: the form's values become the request's body
 * (`toBody`), the contract checks that body, and each problem lands on the field `fieldOf` names for
 * its path. The frontend declares no rule of its own (FRONTEND_GUIDE §8.3).
 */
export function bodySchema<T>(schema: ContractSchema, toBody: (values: T) => unknown, fieldOf: (path: PropertyKey[]) => string = (path) => String(path[0] ?? "")): ContractSchema {
  return {
    safeParse(values: unknown) {
      const r = schema.safeParse(toBody(values as T));
      if (r.success) return r;
      return { success: false, error: { issues: (r.error?.issues ?? []).map((i) => ({ ...i, path: [fieldOf(i.path)] })) } };
    },
  };
}

/** The month a report made today is for: the month just ended, within the quarter (its first month until its second begins). */
export function reportingMonth(months: string[], today = new Date().toISOString().slice(0, 10)): string {
  const first = `${today.slice(0, 7)}-01`;
  return months.filter((m) => m < first).at(-1) ?? months[0] ?? "";
}

/**
 * A refused save, said in the form that sent it (FRONTEND_GUIDE §8.3): each mark on the field the
 * server named, and the server's sentence on the form's error line (FormError) when it names no
 * field here or refuses rather than checks (a plan already binding, a function that is not the
 * reader's). A toast alone was gone before it was read, leaving the form open with no reason.
 */
export function sayRefusal(e: unknown, form: { values: object; setServerErrors: (fields: ServerFields) => void }, setProblem: (problem: string | null) => void) {
  if (!(e instanceof ApiError)) return setProblem("Not saved. Try again.");
  const keys = Object.keys(e.fields);
  if (keys.length) form.setServerErrors(e.fields);
  const onFields = keys.length > 0 && keys.every((k) => k in form.values);
  setProblem(onFields && e.status === 422 ? null : e.message);
}

/** A field's error as a form shows it: the API's words when they fit in four, else the short form given. */
export const fieldMessage = (message: string | undefined, short: string) => {
  if (message === undefined) return undefined;
  // Zod's own sentences read as their limit ("Required", "At most 200 characters"); a short message as it is.
  const said = shortMessage({ type: "custom", message });
  return said && said !== "Check this value" ? said : short;
};

/** A month's short name for a column ("Oct"), from its first day. */
export const monthShort = (m: string) => formatMonth(m).slice(0, 3);

/** A quarter's months as a choice ("October 2026"): a target change's From Month, never a day. */
export const monthChoices = (months: string[]): Array<[string, string]> => months.map((m) => [m, formatMonth(m)]);

/** The From Month a change starts on: this month while it is in the quarter, else the quarter's first. */
export const startMonth = (months: string[]) => months.find((m) => m.slice(0, 7) === todayIso().slice(0, 7)) ?? months[0] ?? "";

/** A score from 0 to 1 as people read it, two places; a dash when there is none. */
export const score = (s: string | null | undefined) => (s === null || s === undefined ? "–" : Number(s).toFixed(2));

/** A line's score in each month of its quarter, as a line's sheet lists them (the phone's only place for them, §10.2). */
export const monthScores = (line: { months: Array<{ month: string; score: string | null }> }, months: string[]): Array<[string, string]> =>
  months.map((m) => [formatMonth(m), score(line.months.find((x) => x.month === m)?.score)]);

/** A key result's band as a pill's tone and word. */
export function band(b: "good" | "watch" | "recovery" | null | undefined): { tone: Tone; text: string } {
  if (b === "good") return { tone: "ok", text: "Good" };
  if (b === "watch") return { tone: "warn", text: "Watch" };
  if (b === "recovery") return { tone: "err", text: "Recovery" };
  return { tone: "neutral", text: "Not Scored" };
}

const KR_STATUS: Record<string, [string, Tone]> = {
  not_started: ["Not Started", "neutral"],
  on_track: ["On Track", "ok"],
  at_risk: ["At Risk", "warn"],
  off_track: ["Off Track", "err"],
  done: ["Done", "ok"],
  missed: ["Missed", "err"],
};

/** A key result's monthly status as a pill. */
export const krStatus = (s: string | null | undefined) => {
  const [text, tone] = KR_STATUS[s ?? ""] ?? ["Awaiting Report", "neutral"];
  return { tone, text };
};

export const KR_STATUS_OPTIONS: Array<[string, string]> = Object.entries(KR_STATUS).map(([k, [v]]) => [k, v]);

const PLAN: Record<string, [string, Tone]> = {
  draft: ["Draft", "neutral"],
  submitted: ["Awaiting Approval", "warn"],
  binding: ["Binding", "ok"],
  returned: ["Returned", "err"],
  // Unbound: live and open for changes; revising: its changes are with the CEO (§6.22).
  unbound: ["Unbound", "info"],
  revising: ["Awaiting Approval", "warn"],
};

/** A plan's status as a pill. */
export const planStatus = (s: string) => {
  const [text, tone] = PLAN[s] ?? [s, "neutral"];
  return { tone, text };
};

const CHANGE: Record<string, [string, Tone]> = {
  pending: ["Awaiting Approval", "warn"],
  approved: ["Approved", "ok"],
  rejected: ["Refused", "err"],
};

/** A target change's status as a pill. */
export const changeStatus = (s: string) => {
  const [text, tone] = CHANGE[s] ?? [s, "neutral"];
  return { tone, text };
};

const CARD: Record<string, [string, Tone]> = {
  draft: ["Draft", "neutral"],
  binding: ["Awaiting Agreement", "warn"],
  agreed: ["Agreed", "ok"],
  closed: ["Closed", "neutral"],
};

/** A scorecard's status as a pill. */
export const cardStatus = (s: string) => {
  const [text, tone] = CARD[s] ?? [s, "neutral"];
  return { tone, text };
};

const RATING: Record<string, [string, Tone]> = {
  exceeds: ["Exceeds", "ok"],
  meets: ["Meets", "ok"],
  partly_meets: ["Partly Meets", "warn"],
  below: ["Below", "err"],
};

/** A rating as a pill; null before the first review closes. */
export const rating = (r: string | null | undefined) => {
  if (!r) return { tone: "neutral" as Tone, text: "Not Rated" };
  const [text, tone] = RATING[r] ?? [r, "neutral"];
  return { tone, text };
};

export const SECTION_NAMES: Record<string, string> = { results: "Results", kpis: "KPIs", accountability: "Accountability" };

/** A KPI month's result as a pill. */
export const kpiResult = (r: string | null | undefined) =>
  r === "met" ? { tone: "ok" as Tone, text: "Met" } : r === "not_met" ? { tone: "err" as Tone, text: "Not Met" } : r === "na" ? { tone: "neutral" as Tone, text: "N/A" } : { tone: "neutral" as Tone, text: "Awaiting Actual" };

const REVIEW: Record<string, [string, Tone]> = {
  check_in: ["Checking In", "neutral"],
  with_reviewer: ["With Reviewer", "warn"],
  returned: ["Returned", "err"],
  second_level: ["Second Level", "info"],
  with_hr: ["With HR", "info"],
  closed: ["Closed", "ok"],
  withdrawn: ["Withdrawn", "neutral"],
};

/** A review's stage as a pill. */
export const reviewStatus = (s: string) => {
  const [text, tone] = REVIEW[s] ?? [s, "neutral"];
  return { tone, text };
};

/** The stages a list filters by; Returned sits with With Reviewer. */
export const STAGE_OPTIONS: Array<[string, string]> = [["", "All Stages"], ["check_in", "Checking In"], ["with_reviewer", "With Reviewer"], ["second_level", "Second Level"], ["with_hr", "With HR"], ["closed", "Closed"], ["withdrawn", "Withdrawn"]];

/** A target, actual or KPI figure as people read it: its words, else its number with its unit (64,000 users; 40%); null for none. */
export const figureOf = (value: string | null | undefined, text?: string | null, unit?: string | null) =>
  text ?? (value === null || value === undefined || value === "" ? null : formatNumber(value, unit));

/** A line's target as people read it: its words, or its figure and unit. */
export const targetOf = (l: { target_text: string | null; target_value: string | null; unit: string | null }) => figureOf(l.target_value, l.target_text, l.unit) ?? "–";
