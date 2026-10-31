/**
 * A task's panel (docs/guides/workspace.md §10.1): its details, what it waits on and holds up,
 * its watchers and reminders, its hold; its steps; its comments; its history. A SidePanel on
 * desktop, a full-screen sheet on a phone. The small forms open over it in the shared modal.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import tasks from "@mycity/contract/schemas/tasks.js";
import type { TaskDependency, TaskDetail } from "@mycity/contract/contract.gen.ts";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import { useMe } from "@/auth/AuthProvider";
import { Link } from "@/lib/router";
import { hrefFor } from "@/lib/routes";
import {
  Button,
  ErrorState,
  Field,
  formatDate,
  formatDateTime,
  HelpTerm,
  IconButton,
  KeyValue,
  LoadingRows,
  Menu,
  Pill,
  SegmentedControl,
  SidePanel,
  TextAreaField,
  Tick,
  Timeline,
  toast,
  useContractForm,
  useModal,
  Who,
} from "@mycity/ui";
import { CADENCE, LABEL, PRIORITY, STATUS_TONE, refresh, say, usePages, type Status } from "./shared";
import { CommitmentActions, commitmentItems, COUNTS_HELP } from "./Commitment";
import { BlockForm, CancelForm, LateReasonForm, LEAD_HELP, OverrideForm, PingForm, RemindersForm, RepeatForm, repeatText, StepForm, TaskForm, UnblockForm, WaitingForm, WatcherForm } from "./TaskForms";

type View = "details" | "steps" | "comments" | "history";

/** The panel's state for a screen: open(id) and the element to render once. */
export function useTaskPanel() {
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null);
  const panel = (
    <SidePanel open={!!open} onClose={() => setOpen(null)} title={open?.title ?? "Task"} size="wide">
      {open && <TaskPanel key={open.id} id={open.id} onOpenTask={(id, title) => setOpen({ id, title })} close={() => setOpen(null)} />}
    </SidePanel>
  );
  const show = useCallback((id: string, title: string) => setOpen({ id, title }), []);
  return { open: show, panel };
}

/** A heading inside the panel, with what sits at its right. */
function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold">{title}</h3>
        <span className="ml-auto flex items-center gap-1.5">{right}</span>
      </div>
      {children}
    </section>
  );
}

const minutes = (m: number | null) => {
  if (m === null) return "At a set time";
  if (m === 0) return "At due time";
  if (m < 60) return `${m} minutes before`;
  if (m < 1440) return `${m / 60} hour${m === 60 ? "" : "s"} before`;
  return `${m / 1440} day${m === 1440 ? "" : "s"} before`;
};

export function TaskPanel({ id, close, onOpenTask }: { id: string; close: () => void; onOpenTask: (id: string, title: string) => void }) {
  const { data: t, error, reload } = useApi("GET /api/v1/tasks/:id", { params: { id } });
  const [view, setView] = useState<View>("details");
  const modal = useModal();
  // A task the reader cannot see, or one that is gone: the board stays, with no panel (§11).
  const gone = error?.status === 404;
  useEffect(() => {
    if (gone) close();
  }, [gone, close]);
  if (gone) return null;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!t) return <LoadingRows count={6} />;
  const changed = () => {
    reload();
    refresh();
  };
  const form = (title: string, body: (done: () => void) => ReactNode) => modal.open({ title, body });
  const open = t.status !== "cancelled";
  // A lead time needs a due time to count back from; without one only reminders already set can change.
  const remindable = t.can_plan && t.status !== "done" && (Boolean(t.due_at) || t.reminders.length > 0);
  const more = [
    { label: "Send Nudge", icon: "bell" as const, onSelect: () => form("Send Nudge", (done) => <PingForm id={t.task_id} hasWatchers={t.watchers.length > 0} close={done} />) },
    ...(remindable ? [{ label: "Set Reminders", icon: "clock" as const, onSelect: () => form("Set Reminders", (done) => <RemindersForm task={t} close={done} onDone={changed} />) }] : []),
    ...(t.can_reassign ? [{ label: t.recurrence ? "Change Repeat" : "Set Repeat", icon: "refresh" as const, onSelect: () => form("Repeat", (done) => <RepeatForm task={t} close={done} onDone={changed} />) }] : []),
    ...(t.overdue ? [{ label: "Say Why Late", icon: "alert" as const, onSelect: () => form("Why Late", (done) => <LateReasonForm task={t} close={done} onSaved={changed} />) }] : []),
    ...(t.can_cancel ? [{ label: "Cancel Task", icon: "x" as const, danger: true, onSelect: () => form("Cancel Task", (done) => <CancelForm id={t.task_id} close={() => (done(), close())} />) }] : []),
  ];
  return (
    <>
      <SegmentedControl
        label="Task View"
        value={view}
        onChange={setView}
        options={[
          ["details", "Details"],
          ["steps", t.steps_total ? `Steps ${t.steps_done}/${t.steps_total}` : "Steps"],
          ["comments", `Comments ${t.comment_count || ""}`.trim()],
          ["history", "History"],
        ]}
      />
      <div className="mt-3">
        {view === "details" && <TaskDetails t={t} changed={changed} form={form} onOpenTask={onOpenTask} />}
        {view === "steps" && <Steps t={t} changed={changed} form={form} />}
        {view === "comments" && <Comments id={id} onAdded={changed} />}
        {view === "history" && <History id={id} />}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Button onClick={close}>Close</Button>
        {open && <Button onClick={() => form("Edit Task", (done) => <TaskForm close={() => (done(), changed())} task={t} />)}>Edit Task</Button>}
        {open && t.status !== "done" && !t.blocked_reason && (
          <Button onClick={() => form("Mark Blocked", (done) => <BlockForm id={t.task_id} close={done} onDone={changed} />)}>Mark Blocked</Button>
        )}
        {t.blocked_reason && <Button onClick={() => form("Clear Blocker", (done) => <UnblockForm task={t} close={done} onDone={changed} />)}>Clear Blocker</Button>}
        {t.is_commitment && <CommitmentActions t={t} onChanged={changed} />}
        {open && <Menu label="More Actions" items={more} trigger={(p) => <IconButton {...p} icon="dots" label="More Actions" />} />}
      </div>
    </>
  );
}

function TaskDetails({ t, changed, form, onOpenTask }: { t: TaskDetail; changed: () => void; form: (title: string, body: (done: () => void) => ReactNode) => void; onOpenTask: (id: string, title: string) => void }) {
  const me = useMe();
  const watch = useMutation("POST /api/v1/tasks/:id/watchers");
  const unwatch = useMutation("DELETE /api/v1/tasks/:id/watchers/:child_id");
  const unlink = useMutation("DELETE /api/v1/tasks/:id/waiting-on/:child_id");
  const items: Array<[ReactNode, ReactNode]> = [
    ["Number", t.number],
    [
      t.members.length ? <HelpTerm key="lead" help={LEAD_HELP}>Lead</HelpTerm> : "Assignee",
      <span key="a" data-copy="content">
        {t.assignee?.display_name ?? "Nobody"}
        {t.assignee_left && <Pill tone="warn" className="ml-2">Left</Pill>}
      </span>,
    ],
    ...(t.members.length
      ? [["Shared With", <span key="sw" data-copy="content">{t.members.map((p) => p.display_name).join(", ")}</span>] as [ReactNode, ReactNode]]
      : []),
    ...(t.project
      ? [["Project", <Link key="pj" className="font-semibold text-primary underline" to={hrefFor("workspace", "projects", { id: t.project.project_id })} data-copy="content">{t.project.name}</Link>] as [ReactNode, ReactNode]]
      : []),
    ["Set By", t.set_by?.display_name ?? "Nobody"],
    ["Due", t.due_at ? formatDateTime(t.due_at) : "No date"],
    ["Priority", PRIORITY[t.priority]],
    ["Status", <Pill key="s" tone={STATUS_TONE[t.status]}>{LABEL[t.status]}</Pill>],
  ];
  if (t.cadence) items.push(["Cadence", CADENCE[t.cadence]]);
  if (t.recurrence) items.push(["Repeats", repeatText(t.recurrence)]);
  if (t.counts_towards)
    items.push([
      <HelpTerm key="ct" help={COUNTS_HELP}>Counts Towards</HelpTerm>,
      <span key="cv" data-copy="content">
        {t.counts_towards.title}
        {t.counts_towards.link && (
          <Link className="ml-2 text-xs font-semibold text-primary underline" to={t.counts_towards.link.path}>Open</Link>
        )}
      </span>,
    ]);
  if (t.late_reason) items.push(["Why Late", t.late_reason_label ?? t.late_reason]);
  if (t.cancel_reason) items.push(["Cancelled", t.cancel_reason]);
  items.push(...commitmentItems(t));
  const run = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      changed();
      toast(done);
    } catch (e) {
      say(e);
    }
  };
  const edge = (d: TaskDependency, mine: boolean) => (
    <div key={d.task_dependency_id} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
      <button type="button" disabled={!d.task.visible} onClick={() => onOpenTask(d.task.task_id, d.task.title)} className="min-h-tap min-w-0 flex-1 text-left">
        <span className="block truncate text-xs font-semibold" data-copy="content">{`${d.task.number} ${d.task.title}`}</span>
        <span className="text-2xs text-subtle-foreground">{d.task.assignee?.display_name ?? ""}</span>
      </button>
      <Pill tone={d.satisfied ? "ok" : STATUS_TONE[d.task.status as Status]}>{d.overridden_at ? "Overridden" : LABEL[d.task.status as Status]}</Pill>
      {mine && t.can_plan && !d.satisfied && (
        <Button size="sm" onClick={() => form("Go Ahead", (done) => <OverrideForm taskId={t.task_id} edgeId={d.task_dependency_id} close={done} onDone={changed} />)}>Go Ahead</Button>
      )}
      {mine && t.can_plan && (
        <IconButton size="sm" icon="x" label={`Stop Waiting on ${d.task.number}`} onClick={() => run(() => unlink.run({ params: { id: t.task_id, child_id: d.task_dependency_id } }), "Link removed")} />
      )}
    </div>
  );
  return (
    <>
      {t.blockage && (
        <div className="mb-3 rounded-box border border-border bg-muted p-2.5">
          <div className="flex items-center gap-2">
            <Pill tone="err">Blocked</Pill>
            <span className="ml-auto text-2xs text-subtle-foreground">{`${t.blockage.blocked_days} days`}</span>
          </div>
          <p className="mt-1.5 text-xs" data-copy="content">{t.blockage.note}</p>
          {t.blockage.estimated_resolve_on && <p className="mt-1 text-2xs text-subtle-foreground">{`Expected clear ${formatDate(t.blockage.estimated_resolve_on)}`}</p>}
        </div>
      )}
      <KeyValue items={items} />
      {t.description && <p className="mt-3 text-xs text-muted-foreground" data-copy="content">{t.description}</p>}
      {t.link && !(t.counts_towards && t.counts_towards.kind === "key_result") && (
        <Link className="mt-3 inline-block text-xs font-semibold text-primary underline" to={t.link.path}>
          Open Record
        </Link>
      )}
      <Section
        title="Waiting On"
        right={t.can_plan && t.status !== "cancelled" ? <Button size="sm" icon="plus" onClick={() => form("Wait On Task", (done) => <WaitingForm task={t} close={done} onDone={changed} />)}>Add Link</Button> : undefined}
      >
        {t.waiting_on.map((d) => edge(d, true))}
        {!t.waiting_on.length && <p className="text-2xs text-subtle-foreground">Not waiting on anything.</p>}
      </Section>
      {t.holding_up.length > 0 && <Section title="Holding Up">{t.holding_up.map((d) => edge(d, false))}</Section>}
      <Section
        title="Watchers"
        right={
          <>
            {t.watching ? (
              <Button size="sm" onClick={() => run(() => unwatch.run({ params: { id: t.task_id, child_id: me.employee_id! } }), "Stopped watching")}>Stop Watching</Button>
            ) : (
              <Button size="sm" icon="eye" onClick={() => run(() => watch.run({ params: { id: t.task_id }, body: {} }), "Watching")}>Watch</Button>
            )}
            {t.can_plan && <IconButton size="sm" icon="plus" label="Add Watcher" onClick={() => form("Add Watcher", (done) => <WatcherForm id={t.task_id} close={done} onDone={changed} />)} />}
          </>
        }
      >
        {t.watchers.map((p) => (
          <div key={p.employee_id} className="flex items-center gap-2 py-1">
            <Who name={p.display_name} sub={p.job_title ?? undefined} />
            {t.can_plan && p.employee_id !== me.employee_id && (
              <IconButton size="sm" icon="x" label={`Remove ${p.display_name}`} className="ml-auto" onClick={() => run(() => unwatch.run({ params: { id: t.task_id, child_id: p.employee_id } }), "Watcher removed")} />
            )}
          </div>
        ))}
        {!t.watchers.length && <p className="text-2xs text-subtle-foreground">Nobody is watching.</p>}
      </Section>
      {t.reminders.length > 0 && (
        <Section title="Reminders">
          {t.reminders.map((r) => (
            <div key={r.slot} className="flex items-center gap-2 py-1 text-xs">
              <span className="flex-1">{minutes(r.minutes_before)}</span>
              <span className="text-2xs text-subtle-foreground">{formatDateTime(r.remind_at)}</span>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

function Steps({ t, changed, form }: { t: TaskDetail; changed: () => void; form: (title: string, body: (done: () => void) => ReactNode) => void }) {
  const tick = useMutation("PATCH /api/v1/tasks/:id/steps/:child_id");
  const remove = useMutation("DELETE /api/v1/tasks/:id/steps/:child_id");
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      changed();
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      {t.steps.map((s) => (
        <div key={s.task_step_id} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
          <Tick checked={Boolean(s.done_at)} label={`Done: ${s.title}`} onChange={(done) => run(() => tick.run({ params: { id: t.task_id, child_id: s.task_step_id }, body: { done } }))} disabled={t.status === "cancelled"} />
          <span className="min-w-0 flex-1">
            <span className={s.done_at ? "block text-xs text-subtle-foreground line-through" : "block text-xs font-semibold"} data-copy="content">{s.title}</span>
            {(s.due_on || s.done_by) && <span className="text-2xs text-subtle-foreground">{s.done_by ? `Done by ${s.done_by.display_name}` : `Due ${formatDate(s.due_on!)}`}</span>}
          </span>
          {t.can_plan && <IconButton size="sm" icon="trash" label={`Remove ${s.title}`} onClick={() => run(() => remove.run({ params: { id: t.task_id, child_id: s.task_step_id } }))} />}
        </div>
      ))}
      {!t.steps.length && <p className="text-2xs text-subtle-foreground">No steps yet.</p>}
      {t.can_plan && t.steps.length < 25 && (
        <Button className="mt-2 w-full" icon="plus" onClick={() => form("Add Step", (done) => <StepForm id={t.task_id} close={done} onDone={changed} />)}>Add Step</Button>
      )}
    </>
  );
}

/** Load More under a list the server holds more of; it spins while the next page comes. */
function More({ more, loading }: { more?: () => void; loading: boolean }) {
  if (!more) return null;
  return (
    <Button size="sm" block icon="down" busy={loading} onClick={more} className="mt-2">
      Load More
    </Button>
  );
}

/** The comments, newest first, the box to add one above them, and older ones under Load More. */
function Comments({ id, onAdded }: { id: string; onAdded: () => void }) {
  const list = usePaged("GET /api/v1/tasks/:id/comments", { params: { id }, sort: "-created_at" });
  const read = usePages(list, (c) => c.task_comment_id);
  const f = useContractForm({ body: "" }, tasks.TaskCommentCreate);
  const save = useMutation("POST /api/v1/tasks/:id/comments");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      f.reset({ body: "" });
      await read.top();
      onAdded();
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="Comment" {...f.field("body")}><TextAreaField {...f.field("body")} /></Field>
      <div className="mb-2 flex justify-end">
        <Button size="sm" onClick={submit}>Add Comment</Button>
      </div>
      {list.error && !read.rows.length ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <>
          {read.rows.map((c) => (
            <div key={c.task_comment_id} className="border-b border-border py-2 last:border-b-0">
              <div className="flex items-baseline gap-2">
                <b className="text-xs">{c.author?.display_name ?? "MyCity"}</b>
                <span className="ml-auto text-2xs text-subtle-foreground">{formatDateTime(c.created_at)}</span>
              </div>
              <p className="mt-1 text-xs" data-copy="content">{c.body}</p>
            </div>
          ))}
          {!read.rows.length && list.loading && <LoadingRows count={3} />}
          {!read.rows.length && !list.loading && <p className="text-2xs text-subtle-foreground">No comments yet.</p>}
          <More more={read.more} loading={list.loading} />
        </>
      )}
    </>
  );
}

/** What a history line says happened. */
export function happened(a: { kind: string; to_status: string | null; detail?: string | null }) {
  if (a.kind === "status_changed" && a.to_status) return `moved it to ${LABEL[a.to_status as Status]}`;
  const words: Record<string, string> = {
    created: "created it",
    assigned: "reassigned it",
    edited: "changed it",
    blocked: "marked it blocked",
    unblocked: "cleared the blocker",
    cancelled: "cancelled it",
    commented: "commented",
    step_added: "added a step",
    step_done: "ticked a step",
    step_reopened: "unticked a step",
    step_removed: "removed a step",
    waiting_added: "linked a task it waits on",
    waiting_removed: "removed a link",
    waiting_overridden: "went ahead without a task",
    watcher_added: "added a watcher",
    watcher_removed: "removed a watcher",
    pinged: "sent a nudge",
    reminders_set: "set reminders",
  };
  return words[a.kind] ?? a.kind.replace("_", " ");
}

/** The history, newest first, then the holds it has had; older lines of each under Load More. */
function History({ id }: { id: string }) {
  const history = usePaged("GET /api/v1/tasks/:id/activity", { params: { id }, sort: "-created_at" });
  const lines = usePages(history, (a) => a.task_activity_id);
  const holds = usePaged("GET /api/v1/tasks/:id/blockages", { params: { id }, sort: "-raised_at" });
  const held = usePages(holds, (b) => b.task_blockage_id);
  if (history.error && !lines.rows.length) return <ErrorState error={history.error} onRetry={history.reload} />;
  if (!lines.rows.length && history.loading) return <LoadingRows count={4} />;
  return (
    <>
      <Timeline
        items={lines.rows.map((a) => ({
          title: `${a.actor?.display_name ?? "MyCity"} ${happened(a)}`,
          when: formatDateTime(a.created_at),
          text: a.detail ?? undefined,
        }))}
      />
      <More more={lines.more} loading={history.loading} />
      {held.rows.length > 0 && (
        <Section title="Blocked Before">
          <Timeline
            label="Holds"
            items={held.rows.map((b) => ({
              title: b.note,
              when: `${formatDate(b.raised_at)}, ${b.blocked_days} days`,
              text: [b.resolve_note, b.due_shift_days ? `Due moved ${b.due_shift_days} days` : null].filter(Boolean).join(". ") || undefined,
              tone: b.resolved_at ? ("done" as const) : ("now" as const),
            }))}
          />
          <More more={held.more} loading={holds.loading} />
        </Section>
      )}
    </>
  );
}
