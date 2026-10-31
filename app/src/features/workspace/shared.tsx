/**
 * What the Workspace tabs share: the words for codes, a card's pills, Load More, the refresh after
 * a write, and following other people's changes as they happen (§6 The live board).
 */
import { useEffect, useRef, useState } from "react";
import type { Task } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, refresh as quietly, useApi, useInfinite, type PagedResult } from "@/api/hooks";
import { useRealtime } from "@/api/realtime";
import { formatDate, Pill, toast } from "@mycity/ui";

export type Status = Task["status"];
export type BoardStatus = Exclude<Status, "cancelled">;
export type LateReason = NonNullable<Task["late_reason"]>;
type Tone = "ok" | "warn" | "err" | "info" | "neutral";

export const LABEL: Record<Status, string> = { todo: "To Do", in_progress: "In Progress", in_review: "In Review", done: "Done", cancelled: "Cancelled" };
export const PRIORITY: Record<Task["priority"], string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
export const CADENCE: Record<string, string> = { daily: "Daily", weekly: "Weekly" };
/**
 * Why Late's reasons as a select offers them: those switched on, in their order (one page: the list
 * holds at most 25). Their keepers change them behind the settings icon on Tasks (LateReasons).
 */
export function useLateOptions(): { options: Array<[LateReason, string]>; ready: boolean } {
  const reasons = useInfinite("GET /api/v1/tasks/late-reasons", {});
  return { options: reasons.rows.map((r) => [r.code, r.label]), ready: Boolean(reasons.page) };
}

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
    return { tone: "err", text: `Overdue ${days} ${days === 1 ? "day" : "days"}` };
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
      {t.members.length > 0 && <Pill tone="info" dot={false}>{`Shared +${t.members.length}`}</Pill>}
      {t.assignee_left && <Pill tone="warn">Left</Pill>}
      {t.priority === "urgent" && <Pill tone="err">Urgent</Pill>}
      {t.priority === "high" && <Pill tone="warn">High</Pill>}
      {t.blocked_reason && <Pill tone="err">Blocked</Pill>}
      {t.waiting && <Pill tone="warn">Waiting</Pill>}
      {t.steps_total > 0 && <Pill tone={t.steps_done === t.steps_total ? "ok" : "neutral"} dot={false}>{`${t.steps_done}/${t.steps_total}`}</Pill>}
    </>
  );
}

/**
 * May the reader set tasks for anyone but themselves (their workspace scope reaches someone)?
 * Assign To, Lead, My Team and Team This Week show then; the API decides each write. Undefined
 * until the people read answers (a failed read is false), so a default can wait for it.
 */
export function useSetsForOthers(): boolean | undefined {
  const { data, error } = useApi("GET /api/v1/tasks/people", { query: {} });
  if (data) return data.page.total > 0;
  return error ? false : undefined;
}

/**
 * A server list read on with Load More: the pages so far, in order, each a page of 25 from the
 * server (usePaged holds one). `top` goes back to the first page, after a write that lands there.
 */
export function usePages<R>(list: PagedResult<R>, key: (row: R) => string) {
  const [pages, setPages] = useState<R[][]>([]);
  const { page, rows } = list;
  useEffect(() => {
    if (page) setPages((kept) => [...kept.slice(0, page.number - 1), rows]);
  }, [page, rows]);
  // A row a write moved onto the next page while it was read shows once.
  const seen = new Set<string>();
  const all = pages.flat().filter((r) => !seen.has(key(r)) && Boolean(seen.add(key(r))));
  return {
    rows: all,
    more: page?.has_next ? () => list.setPage(page.number + 1) : undefined,
    top: () => (list.pageNumber === 1 ? list.reload() : list.setPage(1)),
  };
}

/** The server's words for a refused write, or a plain fallback. */
export const say = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Not saved. Try again.");

/** Every Workspace read again, after a write. A project's counts follow its tasks. */
export const refresh = () => {
  invalidate("/api/v1/tasks");
  invalidate("/api/v1/workspace");
  invalidate("/api/v1/calendar");
  invalidate("/api/v1/projects");
};

/** The same reads again in place, settling once the last has landed: a moved card is held until its board shows the move. */
export const refreshed = () => quietly("/api/v1/tasks", "/api/v1/workspace", "/api/v1/calendar", "/api/v1/projects");

/**
 * Other people's changes, as they happen (§6 The live board): the server says a task changed, by its
 * id only, and what is on screen asks again in place. Several messages at once ask once.
 */
export function useLiveTasks() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useRealtime("task.changed", () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void refreshed(), 300);
  });
}
