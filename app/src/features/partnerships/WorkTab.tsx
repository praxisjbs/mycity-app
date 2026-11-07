/**
 * The 360's Work tab (docs/guides/partnerships.md §6.2, §6.16, §10.1): the projects, tasks and events
 * connected to a partner or a lead that the reader may already see in My Workspace, one kind at a
 * time, and how many of each they may not ("2 more tasks you cannot see"). New Project, New Task and
 * New Event open My Workspace's own forms already connected. A row opens the work in My Workspace.
 * The Overview's Next Events card shows the 360's next three connected events.
 */
import { useState } from "react";
import type { EventBrief, PartnerWorkItem } from "@mycity/contract/contract.gen.ts";
import { useApi } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { hrefFor } from "@/lib/routes";
import { useRouter } from "@/lib/router";
import { Button, Card, CardHeader, DataView, formatDate, formatDateTime, KeyValue, SegmentedControl, useModal } from "@mycity/ui";
import { ProjectForm } from "@/features/workspace/Projects";
import { TaskForm } from "@/features/workspace/TaskForms";
import { EventForm } from "@/features/workspace/CalendarTab";
import { NO_LINK, type PartnerLinkValue } from "@/features/workspace/PartnerLink";

type Kind = PartnerWorkItem["kind"];
const KINDS: Array<[Kind, string]> = [
  ["task", "Tasks"],
  ["project", "Projects"],
  ["event", "Events"],
];
/** "1 more task you cannot see". */
const NOUN: Record<Kind, [string, string]> = { project: ["project", "projects"], task: ["task", "tasks"], event: ["event", "events"] };
const STATUS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  active: "Active",
  completed: "Completed",
  upcoming: "Upcoming",
  past: "Past",
};

/** Where a row of the Work tab opens: the task's panel, the project's page, the event on the calendar. */
const pathOf = (w: PartnerWorkItem) => hrefFor("workspace", w.kind === "event" ? "calendar" : `${w.kind}s`, { id: w.id });

export function WorkTab({ record, dealId = null, readOnly }: { record: { type: "partner" | "lead"; id: string }; dealId?: string | null; readOnly: boolean }) {
  const { navigate } = useRouter();
  const modal = useModal();
  const me = useMe();
  const [kind, setKind] = useState<Kind>("task");
  const [page, setPage] = useState(1);
  const filter = record.type === "partner" ? { partner_id: record.id } : { lead_id: record.id };
  const work = useApi("GET /api/v1/partnerships/work", { query: { ...filter, kind, page } });
  const link: PartnerLinkValue = { ...NO_LINK, ...filter, deal_id: dealId };
  const mayCreate = !readOnly && Boolean(me.grants.workspace?.includes("create"));
  const hidden = work.data?.hidden[`${kind}s` as "tasks" | "projects" | "events"] ?? 0;
  const [one, many] = NOUN[kind];
  const pick = (k: Kind) => {
    setKind(k);
    setPage(1);
  };
  const add = (title: string, body: (close: () => void) => JSX.Element) => modal.open({ title, body: (close) => body(() => (close(), work.reload())) });
  return (
    <Card>
      <CardHeader
        title="Work"
        actions={
          mayCreate ? (
            <>
              <Button size="sm" icon="plus" onClick={() => add("New Task", (close) => <TaskForm close={close} link={link} />)}>New Task</Button>
              <Button size="sm" onClick={() => add("New Project", (close) => <ProjectForm close={close} link={link} />)}>New Project</Button>
              <Button size="sm" onClick={() => add("New Event", (close) => <EventForm close={close} link={link} />)}>New Event</Button>
            </>
          ) : undefined
        }
      />
      <SegmentedControl label="Kind of Work" value={kind} onChange={pick} options={KINDS} />
      <DataView<PartnerWorkItem>
        className="mt-3"
        rows={work.data?.data ?? []}
        loading={work.loading}
        error={work.error}
        page={work.data?.page}
        onPage={setPage}
        onReload={work.reload}
        rowKey={(w) => w.id}
        noun={one}
        onRowClick={(w) => navigate(pathOf(w))}
        empty={{ title: `No ${KINDS.find(([k]) => k === kind)![1]} Yet` }}
        columns={[
          { key: "title", label: "Title", render: (w) => <span data-copy="content">{w.number ? <b className="font-semibold">{w.number} </b> : null}{w.title}</span> },
          { key: "status", label: "Status", render: (w) => STATUS[w.status] ?? w.status },
          { key: "due", label: kind === "event" ? "When" : "Due", render: (w) => (w.starts_at ? formatDateTime(w.starts_at) : w.due_on ? formatDate(w.due_on) : "No date") },
          { key: "owner", label: kind === "task" ? "Assignee" : "Owner", render: (w) => w.owner?.display_name ?? "Nobody", desktop: true },
        ]}
      />
      {hidden > 0 && <p className="mt-2 text-sm text-subtle-foreground">{`${hidden} more ${hidden === 1 ? one : many} you cannot see`}</p>}
    </Card>
  );
}

/** The Overview's next three connected events the reader may see. */
export function NextEvents({ events }: { events: EventBrief[] }) {
  if (!events.length) return null;
  return (
    <Card>
      <CardHeader title="Next Events" />
      <KeyValue items={events.map((e) => [formatDateTime(e.starts_at), <span key={e.calendar_event_id} data-copy="content">{e.title}</span>] as [string, JSX.Element])} />
    </Card>
  );
}
