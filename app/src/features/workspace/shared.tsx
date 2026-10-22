/** What the Workspace tabs share: the words for codes, a card's pills, and the refresh after a write. */
import type { Task } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { formatDate, Pill, toast } from "@mycity/ui";

export type Status = Task["status"];
export type BoardStatus = Exclude<Status, "cancelled">;
export type LateReason = NonNullable<Task["late_reason"]>;
type Tone = "ok" | "warn" | "err" | "info" | "neutral";

export const LABEL: Record<Status, string> = { todo: "To Do", in_progress: "In Progress", in_review: "In Review", done: "Done", cancelled: "Cancelled" };
export const PRIORITY: Record<Task["priority"], string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
export const CADENCE: Record<string, string> = { daily: "Daily", weekly: "Weekly" };
export const LATE: Record<LateReason, string> = {
  waiting_on_others: "Waiting on Others",
  underestimated: "Underestimated",
  deprioritised: "Deprioritised",
  other: "Other",
};
export const LATE_OPTIONS = Object.entries(LATE) as Array<[LateReason, string]>;

/** The board's four columns, left to right, each with its series. */
export const COLS: Array<[BoardStatus, string, 1 | 2 | 3 | 4]> = [
  ["todo", "To Do", 4],
  ["in_progress", "In Progress", 2],
  ["in_review", "In Review", 3],
  ["done", "Done", 1],
];

export const STATUS_TONE: Record<Status, Tone> = { todo: "neutral", in_progress: "info", in_review: "warn", done: "ok", cancelled: "neutral" };

/** The pill a card shows for when it is due. */
export function duePill(t: Pick<Task, "status" | "due_at" | "overdue">): { tone: Tone; text: string } {
  if (t.status === "done") return { tone: "ok", text: "Done" };
  if (t.status === "cancelled") return { tone: "neutral", text: "Cancelled" };
  if (!t.due_at) return { tone: "neutral", text: "No Date" };
  const day = formatDate(t.due_at);
  if (t.overdue) {
    const days = Math.max(1, Math.round((Date.now() - Date.parse(t.due_at)) / 86_400_000));
    return { tone: "err", text: `Overdue ${days}d` };
  }
  if (day === formatDate(new Date().toISOString())) return { tone: "warn", text: "Today" };
  if (day === formatDate(new Date(Date.now() + 86_400_000).toISOString())) return { tone: "neutral", text: "Tomorrow" };
  return { tone: "neutral", text: day };
}

/** The pills under a card's title: when it is due, its priority when it matters, and what holds it. */
export function CardPills({ t }: { t: Task }) {
  const due = duePill(t);
  return (
    <>
      <Pill tone={due.tone}>{due.text}</Pill>
      {t.is_commitment && <Pill tone="info">Commitment</Pill>}
      {t.priority === "urgent" && <Pill tone="err">Urgent</Pill>}
      {t.priority === "high" && <Pill tone="warn">High</Pill>}
      {t.blocked_reason && <Pill tone="err">Blocked</Pill>}
      {t.waiting && <Pill tone="warn">Waiting</Pill>}
      {t.steps_total > 0 && <Pill tone={t.steps_done === t.steps_total ? "ok" : "neutral"} dot={false}>{`${t.steps_done}/${t.steps_total}`}</Pill>}
    </>
  );
}

/** The server's words for a refused write, or a plain fallback. */
export const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Not saved. Try again.");

/** Every Workspace read again, after a write. */
export const refresh = () => {
  invalidate("/api/v1/tasks");
  invalidate("/api/v1/workspace");
  invalidate("/api/v1/calendar");
};
