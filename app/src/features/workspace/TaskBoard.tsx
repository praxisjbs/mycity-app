/**
 * The task board (docs/guides/workspace.md §10.1): To Do, In Progress, In Review and Done, each its
 * own server list of 25 with Load More, so a column of 200 never loads 200. Tasks shows the reader's
 * own or their team's; a project's page shows the project's tasks the reader can see. The screen
 * holding it follows other people's changes (useLiveTasks).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useInfinite } from "@/api/hooks";
import type { ViewNews } from "@/features/notifications/marks";
import { ErrorState, Kanban, useModal } from "@mycity/ui";
import { CardPills, COLS, type BoardStatus } from "./shared";
import { useMoveTask } from "./TaskForms";

/** Whose tasks a board holds: the reader's (`mine`), their team's, and one project's when named. */
export type BoardFilters = { scope: "mine" | "team"; project_id?: string };

/** One column: its own server list, more pages appended under it. */
function useColumn(status: BoardStatus, filters: BoardFilters, q: string) {
  return useInfinite("GET /api/v1/tasks", { filters: { status, ...filters }, q });
}

/** What is typed in the search, once the person pauses (as the paged lists wait), so four columns ask once. */
export function usePaused(q: string) {
  const [sent, setSent] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setSent(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  return sent;
}

export function TaskBoard({
  filters,
  q,
  onOpen,
  empty,
  newsOf,
}: {
  filters: BoardFilters;
  /** The search, already paused (usePaused). */
  q: string;
  onOpen: (taskId: string, title: string) => void;
  /** What an empty board shows when nothing is searched. */
  empty?: ReactNode;
  /** What waits on the reader in each column (docs/guides/notifications.md §6). */
  newsOf?: (status: BoardStatus) => ViewNews | undefined;
}) {
  const modal = useModal();
  const cols = {
    todo: useColumn("todo", filters, q),
    in_progress: useColumn("in_progress", filters, q),
    in_review: useColumn("in_review", filters, q),
    done: useColumn("done", filters, q),
  };
  // A waiting card asks first; its Open Task opens the task it waits on, as a card opens here.
  const move = useMoveTask(modal.open, onOpen);
  const columns = Object.values(cols);
  const all = columns.flatMap((c) => c.rows);
  // A column whose first page has not come yet is loading; one that failed is the board's error.
  const loading = columns.some((c) => !c.page && !c.error);
  const failed = columns.find((c) => c.error)?.error ?? null;
  const retry = () => Promise.all(columns.filter((c) => c.error).map((c) => c.reload()));
  if (failed) return <ErrorState error={failed} onRetry={retry} />;
  return (
    <Kanban
      reorder
      loading={loading}
      onMove={(card, _from, to, before) => {
        const t = all.find((x) => x.task_id === card);
        return t ? move(t, to as BoardStatus, before) : undefined;
      }}
      onOpen={(card) => {
        const t = all.find((x) => x.task_id === card);
        if (t) onOpen(t.task_id, t.title);
      }}
      empty={q ? undefined : empty}
      columns={COLS.map(([status, label, series]) => ({
        key: status,
        label,
        series,
        count: cols[status].page?.total,
        unread: newsOf?.(status)?.unread,
        urgent: newsOf?.(status)?.urgent,
        onMore: cols[status].page?.has_next ? cols[status].more : undefined,
        cards: cols[status].rows.map((t) => ({ key: t.task_id, title: t.title, meta: <CardPills t={t} />, owner: t.assignee?.display_name })),
      }))}
    />
  );
}
