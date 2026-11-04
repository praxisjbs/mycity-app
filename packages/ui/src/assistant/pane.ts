/**
 * What the Assistant group's panes take (docs/guides/praxis-ai.md §6.13, decision 13): plain shapes
 * a screen fills from the API's answer (AiAnswer.overview, AiAnswer.reads, a read run again), so the
 * components know nothing of the contract or the client. The server draws every figure and every
 * row; the panes only show them.
 */

/** The pane's four views, in the order the tabs read. */
export type PaneTab = "overview" | "table" | "record" | "sources";

export const PANE_TABS: ReadonlyArray<{ value: PaneTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "table", label: "Table" },
  { value: "record", label: "Record" },
  { value: "sources", label: "Sources" },
];

/** One figure of an Overview: already a number or a string the server gave; `unit` says how to read it. */
export interface PaneFigure {
  key: string;
  label: string;
  value: string | number;
  /** `count`, `ngn`, `days`, `minutes`, `percent`, or null for a plain number. */
  unit: string | null;
}

/** A chart the server drew from a summary's own groups or series. */
export interface PaneChart {
  kind: "bar" | "stacked_bar" | "line" | "donut";
  title: string;
  labels: string[];
  series: Array<{ label: string; values: number[] }>;
}

/** The Overview: up to three figures and one chart, or nothing when no summary answered. */
export interface PaneOverview {
  title: string | null;
  figures: PaneFigure[];
  chart: PaneChart | null;
}

/** One read of an answer, as the Sources tab lists it. */
export interface PaneRead {
  /** Which read of the question, 1 first. */
  n: number;
  /** Its name in words (Leave Requests). */
  name: string;
  kind: "read" | "summary";
  /** `timed_out`: the read covered too much at once and the database cut it (praxis-ai.md §6.3 step 8). */
  outcome: "read" | "refused" | "invalid" | "failed" | "timed_out";
  /** The parameters it ran with, as label and value pairs. */
  filters: ReadonlyArray<readonly [string, string]>;
  /** Rows its page returned, and how many there are in all (null for one record, or nothing). */
  rows: number;
  total: number | null;
  /** The restricted fields emptied for the person on this read. */
  masked: string[];
  /** The Table can page this read again. */
  opens?: boolean;
}

/** The record behind a chip or a row: its cells as the person may see them, and where it opens. */
export interface PaneRecord {
  title: string;
  items: ReadonlyArray<readonly [string, string]>;
  link: string | null;
}

/** Words from a read's key or a field's name: "leave_requests" and "leave.requests" read Leave Requests. */
export function paneWords(key: string): string {
  return key
    .split(/[._]/)
    .filter((w) => w && w !== "list")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** A parameter's value as the Sources tab shows it. */
export function paneValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.map(paneValue).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
