import type { Cycle, Goal, Kpi, Review } from "@mycity/contract/contract.gen.ts";

/**
 * How Performance words its codes (docs/guides/performance.md §10). The API sends the
 * contract's codes; the words and tones are the screen's.
 */
export type Tone = "ok" | "warn" | "err" | "info" | "neutral";
export interface Status {
  tone: Tone;
  text: string;
}

const s = (tone: Tone, text: string): Status => ({ tone, text });

export const goalStatus = (v: Goal["status"]): Status =>
  ({
    draft: s("neutral", "Draft"),
    pending_approval: s("warn", "Pending"),
    active: s("ok", "Active"),
    returned: s("err", "Returned"),
    completed: s("info", "Completed"),
    cancelled: s("neutral", "Cancelled"),
  })[v];

export const kpiStatus = (v: Kpi["status"]): Status =>
  v === "met" ? s("ok", "Met") : goalStatus(v);

export type ProgressStatus = NonNullable<Kpi["progress_status"]>;
export const progressStatus = (v: ProgressStatus | null): Status | null =>
  v === null
    ? null
    : ({ on_track: s("ok", "On Track"), at_risk: s("warn", "At Risk"), behind: s("err", "Behind"), met: s("ok", "Met") })[v];

export const reviewStatus = (v: Review["status"]): Status =>
  ({
    draft: s("neutral", "Draft"),
    submitted: s("info", "Submitted"),
    second_level: s("warn", "Second Level"),
    with_hr: s("warn", "With HR"),
    closed: s("ok", "Closed"),
    returned: s("err", "Returned"),
  })[v];

export const cycleStatus = (v: Cycle["status"]): Status =>
  ({ draft: s("neutral", "Draft"), scheduled: s("info", "Scheduled"), open: s("ok", "Open"), closed: s("neutral", "Closed") })[v];

export const LEVEL_NAME = { organisation: "Organisational", annual: "Annual", monthly: "Monthly", department: "Departmental" } as const;

/** 0.4 → "40%"; null when there is nothing to count yet. */
export const percent = (v: number | null | undefined) => (v === null || v === undefined ? null : `${Math.round(v * 100)}%`);

/** A rating out of 5, or null. */
export const rating = (v: number | null | undefined) => (v === null || v === undefined ? null : `${Number(v).toFixed(v % 1 ? 1 : 0)} of 5`);

/** "2026-10" moved by n months. */
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
