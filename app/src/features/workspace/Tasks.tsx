/**
 * My Workspace · Tasks (docs/guides/workspace.md §10.1): the board or the list, Mine or My Team.
 * Each column is its own server list of 25 with Load More, so a column of 200 never loads 200.
 */
import { useEffect, useState } from "react";
import type { Task } from "@mycity/contract/contract.gen.ts";
import { useApi, useInfinite, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useSearchParams } from "@/lib/router";
import { useScreenAction, useUrlAction } from "@/shell/screen-action";
import { Button, CheckboxField, DataView, EmptyState, formatDate, Kanban, PageHeader, Pill, SearchInput, SegmentedControl, Toolbar, useModal, Who } from "@mycity/ui";
import { CardPills, COLS, duePill, LABEL, PRIORITY, STATUS_TONE, type BoardStatus } from "./shared";
import { useTaskPanel } from "./TaskPanel";
import { SendCommitmentsForm } from "./Commitment";
import { TaskForm, useMoveTask } from "./TaskForms";

type Scope = "mine" | "team";

/** One column: its own server list, more pages appended under it. */
function useColumn(status: BoardStatus, scope: Scope, q: string) {
  return useInfinite("GET /api/v1/tasks", { filters: { status, scope }, q });
}

export function Tasks({ openId = null }: { openId?: string | null }) {
  const me = useMe();
  const modal = useModal();
  const [scope, setScope] = useState<Scope>("mine");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const summary = useApi("GET /api/v1/tasks/summary", { query: { scope } });
  const cols = {
    todo: useColumn("todo", scope, q),
    in_progress: useColumn("in_progress", scope, q),
    in_review: useColumn("in_review", scope, q),
    done: useColumn("done", scope, q),
  };
  const list = usePaged("GET /api/v1/tasks", { filters: { scope }, sort: "due_at", enabled: layout === "list" });
  const gone = usePaged("GET /api/v1/tasks", { filters: { status: "cancelled", scope }, enabled: cancelled });
  const panel = useTaskPanel();
  const move = useMoveTask(modal.open);
  /* A task opened from a link (?id=): the bell, ⌘K, the Commitments view, a calendar date. */
  const [, setParams] = useSearchParams();
  const linked = openId;
  const { open: openPanel } = panel;
  useEffect(() => {
    if (!linked) return;
    openPanel(linked, "Task");
    setParams({ id: null }, { replace: true });
  }, [linked, openPanel, setParams]);
  const add = () => modal.open({ title: "New Task", body: (close) => <TaskForm close={close} /> });
  const addCommitment = () => modal.open({ title: "New Commitment", body: (close) => <TaskForm close={close} commitment /> });
  const sendMonth = () => modal.open({ title: "Send Commitments", wide: true, body: (close) => <SendCommitmentsForm close={close} /> });
  useScreenAction({ label: "New Task", onSelect: add });
  useUrlAction("commitment", addCommitment);
  const all = Object.values(cols).flatMap((c) => c.rows);
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Tasks"
        actions={
          <>
            <SegmentedControl label="Tasks Layout" value={layout} onChange={setLayout} options={[["board", "Board"], ["list", "List"]]} />
            {me.manages_people && <SegmentedControl label="Whose Tasks" value={scope} onChange={setScope} options={[["mine", "Mine"], ["team", "My Team"]]} />}
            <Button icon="send" onClick={sendMonth}>Send Commitments</Button>
            <Button variant="primary" icon="plus" onClick={add}>New Task</Button>
          </>
        }
      />
      {s && (
        <KpiTiles
          mobileCols={2}
          items={[
            { key: "open", label: "Open", value: String(s.open) },
            { key: "week", label: "Due This Week", value: String(s.due_this_week) },
            { key: "over", label: "Overdue", value: String(s.overdue), tone: s.overdue ? "err" : undefined },
            { key: "done", label: "Completed, 30d", value: String(s.done_30d), tone: "ok" },
          ]}
        />
      )}
      {layout === "board" ? (
        <>
          <Toolbar>
            <SearchInput value={q} onChange={setQ} placeholder="Search tasks" className="w-full md:w-64" />
            <CheckboxField label="Show Cancelled" value={cancelled} onChange={setCancelled} />
          </Toolbar>
          <Kanban
            reorder
            onMove={(card, _from, to, before) => {
              const t = all.find((x) => x.task_id === card);
              if (t) void move(t, to as BoardStatus, before);
            }}
            onOpen={(card) => {
              const t = all.find((x) => x.task_id === card);
              if (t) panel.open(t.task_id, t.title);
            }}
            empty={q ? undefined : <EmptyState title="No Tasks Yet" text="Add the first one for today" action={<Button variant="primary" icon="plus" onClick={add}>New Task</Button>} />}
            columns={COLS.map(([status, label, series]) => ({
              key: status,
              label,
              series,
              count: cols[status].page?.total,
              onMore: cols[status].page?.has_next ? cols[status].more : undefined,
              cards: cols[status].rows.map((t) => ({ key: t.task_id, title: t.title, meta: <CardPills t={t} />, owner: t.assignee?.display_name })),
            }))}
          />
        </>
      ) : (
        <DataView<Task>
          list={list}
          rowKey={(t) => t.task_id}
          caption="Tasks"
          noun="task"
          search="Search tasks"
          onRowClick={(t) => panel.open(t.task_id, t.title)}
          empty={{ title: "No Tasks Yet", text: "Add the first one for today" }}
          columns={[
            { key: "title", label: "Task", render: (t) => <span data-copy="content"><b className="font-semibold">{t.number}</b> {t.title}</span> },
            { key: "assignee", label: "Assignee", render: (t) => (t.assignee ? <Who name={t.assignee.display_name} /> : "") },
            { key: "status", label: "Status", render: (t) => <Pill tone={STATUS_TONE[t.status]}>{LABEL[t.status]}</Pill> },
            { key: "due_at", label: "Due", sortable: true, render: (t) => { const p = duePill(t); return <Pill tone={p.tone}>{p.text}</Pill>; } },
            { key: "priority", label: "Priority", sortable: true, render: (t) => PRIORITY[t.priority] },
          ]}
        />
      )}
      {cancelled && (
        <DataView
          title="Cancelled"
          rows={gone.rows}
          rowKey={(t) => t.task_id}
          loading={gone.loading}
          error={gone.error}
          page={gone.page}
          onPage={gone.setPage}
          onRowClick={(t) => panel.open(t.task_id, t.title)}
          empty={{ title: "Nothing Cancelled", text: "Cancelled tasks show here." }}
          columns={[
            { key: "n", label: "Task", render: (t) => t.title },
            { key: "a", label: "Assignee", render: (t) => t.assignee?.display_name ?? "" },
            { key: "w", label: "Cancelled", render: (t) => formatDate(t.cancelled_at) },
            { key: "r", label: "Reason", render: (t) => t.cancel_reason ?? "" },
          ]}
          className="mt-3"
        />
      )}
      {panel.panel}
    </>
  );
}
