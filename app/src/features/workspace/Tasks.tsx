/**
 * My Workspace · Tasks (docs/guides/workspace.md §10.1): the board or the list, Mine or My Team.
 * Each column is its own server list of 25 with Load More, so a column of 200 never loads 200.
 */
import { useEffect, useRef, useState } from "react";
import type { Task } from "@mycity/contract/contract.gen.ts";
import { useApi, usePaged } from "@/api/hooks";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { useSearchParams } from "@/lib/router";
import { useOpenWhereNews, useViewNews, withNews, type ViewNews } from "@/features/notifications/marks";
import { useScreenAction, useUrlAction } from "@/shell/screen-action";
import { Button, CheckboxField, DataView, EmptyState, ErrorState, formatDate, IconButton, PageHeader, Pill, SearchInput, SegmentedControl, Toolbar, useModal, Who } from "@mycity/ui";
import { duePill, LABEL, PRIORITY, STATUS_TONE, useLiveTasks, useSetsForOthers } from "./shared";
import { useTaskPanel } from "./TaskPanel";
import { SendCommitmentsForm } from "./Commitment";
import { TaskForm } from "./TaskForms";
import { TaskBoard, usePaused } from "./TaskBoard";
import { LateReasons, useKeepsReasons } from "./LateReasons";

type Scope = "mine" | "team";
const WHOSE: Array<[Scope, string]> = [
  ["mine", "Mine"],
  ["team", "My Team"],
];

/** Two views' news as one: My Team holds the reader's own tasks and the rest. */
const both = (a?: ViewNews, b?: ViewNews): ViewNews | undefined =>
  a || b ? { unread: (a?.unread ?? 0) + (b?.unread ?? 0), urgent: Boolean(a?.urgent || b?.urgent) } : undefined;

export function Tasks({ openId = null }: { openId?: string | null }) {
  const others = useSetsForOthers();
  const modal = useModal();
  const [scope, setScope] = useState<Scope>("mine");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const sent = usePaused(q);
  const [cancelled, setCancelled] = useState(false);
  const summary = useApi("GET /api/v1/tasks/summary", { query: { scope } });
  const keeps = useKeepsReasons();
  useLiveTasks();
  const list = usePaged("GET /api/v1/tasks", { filters: { scope }, sort: "due_at", enabled: layout === "list" });
  const gone = usePaged("GET /api/v1/tasks", { filters: { status: "cancelled", scope }, enabled: cancelled });
  const panel = useTaskPanel();
  /* A task opened from a link (?id=): the bell, ⌘K, the Commitments view, a calendar date. */
  const [, setParams] = useSearchParams();
  const linked = openId;
  const { open: openPanel } = panel;
  useEffect(() => {
    if (!linked) return;
    openPanel(linked, "Task");
    setParams({ id: null }, { replace: true });
  }, [linked, openPanel, setParams]);
  // What waits on the reader: on Mine and My Team, in each column, and among the cancelled. The
  // board opens on My Team when only others' tasks hold it, and shows the cancelled when they do.
  const news = useViewNews();
  const at = (status: string) => (scope === "mine" ? news(`mine/${status}`) : both(news(`mine/${status}`), news(`others/${status}`)));
  useOpenWhereNews({ value: scope, onChange: setScope, values: others === undefined ? [] : others ? ["mine", "team"] : ["mine"], all: "team", skip: Boolean(openId) });
  const cancelledNews = at("cancelled");
  const cancelledWaits = Boolean(cancelledNews && (cancelledNews.unread > 0 || cancelledNews.urgent));
  const showedCancelled = useRef(false);
  useEffect(() => {
    if (showedCancelled.current || !cancelledWaits) return;
    showedCancelled.current = true;
    setCancelled(true);
  }, [cancelledWaits]);
  const add = () => modal.open({ title: "New Task", body: (close) => <TaskForm close={close} /> });
  const addCommitment = () => modal.open({ title: "New Commitment", body: (close) => <TaskForm close={close} commitment /> });
  const sendMonth = () => modal.open({ title: "Send Commitments", wide: true, body: (close) => <SendCommitmentsForm close={close} /> });
  const reasons = () => modal.open({ title: "Late Reasons", body: (close) => <LateReasons close={close} /> });
  useScreenAction({ label: "New Task", onSelect: add });
  useUrlAction("commitment", addCommitment);
  const search = (v: string) => {
    setQ(v);
    list.setQ(v);
  };
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Tasks"
        actions={
          <>
            <SegmentedControl label="Tasks Layout" value={layout} onChange={setLayout} options={[["board", "Board"], ["list", "List"]]} />
            {others && <SegmentedControl label="Whose Tasks" value={scope} onChange={setScope} options={withNews(news, WHOSE, { all: "team" })} />}
            {keeps && <IconButton icon="cog" label="Late Reasons" onClick={reasons} />}
            <Button icon="send" onClick={sendMonth}>Send Commitments</Button>
            <Button variant="primary" icon="plus" onClick={add}>New Task</Button>
          </>
        }
      />
      {summary.error && !s ? (
        <ErrorState error={summary.error} onRetry={summary.reload} className="mb-3" />
      ) : (
        s && (
          <KpiTiles
            mobileCols={2}
            items={[
              { key: "open", label: "Open", value: String(s.open) },
              { key: "week", label: "Due This Week", value: String(s.due_this_week) },
              { key: "over", label: "Overdue", value: String(s.overdue), tone: s.overdue ? "err" : undefined },
              { key: "done", label: "Completed, 30d", value: String(s.done_30d), tone: "ok" },
            ]}
          />
        )
      )}
      <Toolbar>
        <SearchInput value={q} onChange={search} placeholder="Search tasks" className="w-full md:w-64" />
        <CheckboxField label="Show Cancelled" value={cancelled} onChange={setCancelled} />
      </Toolbar>
      {layout === "board" ? (
        <TaskBoard
          filters={{ scope }}
          q={sent}
          onOpen={panel.open}
          newsOf={at}
          empty={<EmptyState title="No Tasks Yet" action={<Button variant="primary" icon="plus" onClick={add}>New Task</Button>} />}
        />
      ) : (
        <DataView<Task>
          list={list}
          rowKey={(t) => t.task_id}
          caption="Tasks"
          noun="task"
          onRowClick={(t) => panel.open(t.task_id, t.title)}
          empty={{ title: "No Tasks Yet" }}
          columns={[
            { key: "title", label: "Task", render: (t) => <span data-copy="content"><b className="font-semibold">{t.number}</b> {t.title}</span> },
            {
              key: "assignee",
              label: "Assignee",
              render: (t) =>
                t.assignee ? <Who name={t.assignee.display_name} role={t.assignee_left ? "Left" : t.members.length ? `+${t.members.length} More` : undefined} /> : "",
            },
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
          onReload={gone.reload}
          onRowClick={(t) => panel.open(t.task_id, t.title)}
          empty={{ title: "Nothing Cancelled" }}
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
