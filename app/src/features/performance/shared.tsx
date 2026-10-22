/** What the Performance tabs share: the quarter switcher, the words for codes, a person in a cell. */
import { useState } from "react";
import type { PerformancePeriod } from "@mycity/contract/contract.gen.ts";
import { useApi, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { formatMonth, Who } from "@mycity/ui";

type Tone = "ok" | "warn" | "err" | "info" | "neutral";

/** A person in a table cell: their name, and their department beneath it. */
export const person = (p: PersonRef) => <Who name={p.display_name} sub={p.department ?? undefined} />;

/** The quarter the screen shows: the current one until another is picked. */
export function useQuarter(): {
  period: PerformancePeriod | null;
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
    options: list.rows.map((p) => [p.performance_period_id, p.name] as [string, string]),
    periodId: period?.performance_period_id ?? "",
    setPeriodId: setPicked,
    loading: current.loading && list.loading,
  };
}

/** The month a report made today is for: the month just ended, within the quarter (its first month until its second begins). */
export function reportingMonth(months: string[], today = new Date().toISOString().slice(0, 10)): string {
  const first = `${today.slice(0, 7)}-01`;
  return months.filter((m) => m < first).at(-1) ?? months[0] ?? "";
}

/** A field's error as a form shows it: the API's words when they fit in four, else the short form given. */
export const fieldMessage = (message: string | undefined, short: string) =>
  message === undefined ? undefined : message.trim().split(/\s+/).length <= 4 ? message : short;

/** A month's short name for a column ("Oct"), from its first day. */
export const monthShort = (m: string) => formatMonth(m).slice(0, 3);

/** A score from 0 to 1 as people read it, two places; a dash when there is none. */
export const score = (s: string | null | undefined) => (s === null || s === undefined ? "–" : Number(s).toFixed(2));

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

/** A line's target as people read it: its words, or its figure and unit. */
export const targetOf = (l: { target_text: string | null; target_value: string | null; unit: string | null }) =>
  l.target_text ?? (l.target_value === null ? "–" : `${l.target_value}${l.unit ? (l.unit === "%" ? "%" : ` ${l.unit}`) : ""}`);
