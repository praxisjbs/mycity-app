import { useEffect, useState } from "react";
import calendar from "@mycity/contract/schemas/calendar.js";
import tasks from "@mycity/contract/schemas/tasks.js";
import type { CalendarItem, Task, TaskDetail } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { EmployeePicker } from "@/features/shared/pickers";
import { Link, useRouter, useSearchParams } from "@/lib/router";
import type { ModuleScreenProps } from "@/shell/screens";
import { useAddressPrefill, useScreenAction, useUrlAction } from "@/shell/screen-action";
import {
  COMMITMENT_HELP,
  CommitmentActions,
  commitmentItems,
  commitmentMonths,
  COUNTS_HELP,
  CountsTowardsField,
  type CountsChoice,
  SendCommitmentsForm,
} from "./Commitment";
import { MyWeekCard, TeamWeekCard } from "./Week";
import {
  AreaChart,
  Avatar,
  Bars,
  Button,
  Calendar,
  Card,
  CardHeader,
  CheckboxField,
  ChoiceField,
  DataView,
  DateField,
  ErrorState,
  Field,
  formatDate,
  formatDateTime,
  formatTime,
  FormFooter,
  Grid,
  HelpTerm,
  Kanban,
  KeyValue,
  formatMonth,
  LoadingRows,
  Modal,
  monthName,
  PageHeader,
  Pill,
  SearchInput,
  SegmentedControl,
  SelectField,
  TapList,
  TextAreaField,
  TextField,
  TimeField,
  Timeline,
  toast,
  todayIso,
  Toolbar,
  useContractForm,
  useModal,
} from "@mycity/ui";

/**
 * My Workspace: Today, Tasks, Calendar and Analytics (#4 to #7; docs/guides/workspace.md §10).
 * A manager sets the week and the day for their reporting line; the employee adds their own
 * beside it (A24). A month's priority tasks are commitments, sent and approved as a set; Today
 * carries the week (docs/guides/performance.md §6.11, §6.18). Every list is the server's page of 25.
 */
export default function Workspace({ tab, id }: ModuleScreenProps) {
  const [params, setParams] = useSearchParams();
  const modal = useModal();
  /*
   * Deep link from Home's New button or the assistant: /workspace?tab=tasks&new=1&title=… (&commitment=1).
   * The form reads its own fields from the address (TaskPrefill, CalendarEventPrefill).
   */
  useEffect(() => {
    if (params.get("new") !== "1") return;
    const commitment = params.get("commitment") === "1";
    setParams({ new: null, commitment: null }, { replace: true });
    if (tab === "calendar") modal.open({ title: "New Event", body: (close) => <EventForm close={close} /> });
    else modal.open({ title: commitment ? "New Commitment" : "New Task", body: (close) => <TaskForm close={close} commitment={commitment} /> });
  }, [params, setParams, modal, tab]);
  if (tab === "tasks") return <Tasks openId={id} />;
  if (tab === "calendar") return <CalendarTab />;
  if (tab === "analytics") return <Analytics />;
  return <Today />;
}

/* ───────────── Shared bits ───────────── */

type Status = Task["status"];
type BoardStatus = Exclude<Status, "cancelled">;
const LABEL: Record<Status, string> = { todo: "To Do", in_progress: "In Progress", in_review: "In Review", done: "Done", cancelled: "Cancelled" };
const PRIORITY: Record<Task["priority"], string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const CADENCE: Record<string, string> = { daily: "Daily", weekly: "Weekly" };

/** The pill a card shows for when it is due. */
function duePill(t: Task) {
  if (t.status === "done") return { tone: "ok" as const, text: "Done" };
  if (t.status === "cancelled") return { tone: "neutral" as const, text: "Cancelled" };
  if (!t.due_at) return { tone: "neutral" as const, text: "No Date" };
  const day = formatDate(t.due_at);
  const today = formatDate(new Date().toISOString());
  const tomorrow = formatDate(new Date(Date.now() + 86_400_000).toISOString());
  if (t.overdue) {
    const days = Math.max(1, Math.round((Date.now() - Date.parse(t.due_at)) / 86_400_000));
    return { tone: "err" as const, text: `Overdue ${days}d` };
  }
  if (day === today) return { tone: "warn" as const, text: "Today" };
  if (day === tomorrow) return { tone: "neutral" as const, text: "Tomorrow" };
  return { tone: "neutral" as const, text: day };
}

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Not saved. Try again.");
const refresh = () => {
  invalidate("/api/v1/tasks");
  invalidate("/api/v1/workspace");
  invalidate("/api/v1/calendar");
};

function TaskCard({ t, onClick }: { t: Task; onClick: () => void }) {
  const pill = duePill(t);
  const me = useMe();
  const setByOther = t.set_by && t.set_by.employee_id !== me.employee_id;
  return (
    <button type="button" onClick={onClick} className="mb-2 block w-full rounded-box border border-border bg-card p-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-2">
      <b className="mb-1.5 block text-xs leading-snug font-semibold" data-copy="content">{t.title}</b>
      <span className="flex flex-wrap items-center gap-1.5">
        <Pill tone={pill.tone}>{pill.text}</Pill>
        {t.is_commitment && <Pill tone="info">Commitment</Pill>}
        {t.blocked_reason && <Pill tone="err">Blocked</Pill>}
        {setByOther && t.set_by && <Avatar name={t.set_by.display_name} size={21} />}
      </span>
    </button>
  );
}

function useTaskPanel() {
  const modal = useModal();
  return (id: string, title: string) => modal.open({ title, body: (close) => <TaskPanel id={id} close={close} /> });
}

/* ───────────── The task panel ───────────── */

function TaskPanel({ id, close }: { id: string; close: () => void }) {
  const { data: t, error, reload } = useApi("GET /api/v1/tasks/:id", { params: { id } });
  const history = usePaged("GET /api/v1/tasks/:id/activity", { params: { id }, sort: "-created_at" });
  const modal = useModal();
  const [view, setView] = useState<"details" | "comments" | "history">("details");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!t) return <LoadingRows count={5} />;
  const items: Array<[React.ReactNode, React.ReactNode]> = [
    ["Number", t.number],
    ["Assignee", t.assignee?.display_name ?? "Nobody"],
    ["Set By", t.set_by?.display_name ?? "Nobody"],
    ["Due", t.due_at ? formatDateTime(t.due_at) : "No date"],
    ["Priority", PRIORITY[t.priority]],
    ["Status", LABEL[t.status]],
  ];
  if (t.cadence) items.push(["Cadence", CADENCE[t.cadence]]);
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
  if (t.blocked_reason) items.push(["Blocked", t.blocked_reason]);
  if (t.cancel_reason) items.push(["Cancelled", t.cancel_reason]);
  items.push(...commitmentItems(t));
  const changed = () => {
    reload();
    refresh();
  };
  return (
    <>
      <SegmentedControl value={view} onChange={setView} options={[["details", "Details"], ["comments", `Comments ${t.comment_count || ""}`.trim()], ["history", "History"]]} />
      <div className="mt-3">
        {view === "details" && (
          <>
            <KeyValue items={items} />
            {t.description && <p className="mt-3 text-xs text-muted-foreground" data-copy="content">{t.description}</p>}
            {t.link && !(t.counts_towards && t.counts_towards.kind === "key_result") && (
              <Link className="mt-3 inline-block text-xs font-semibold text-primary underline" to={t.link.path}>
                Open Record
              </Link>
            )}
          </>
        )}
        {view === "comments" && <Comments id={id} onAdded={changed} />}
        {view === "history" && (
          <Timeline
            items={history.rows.map((a) => ({
              title: `${a.actor?.display_name ?? "MyCity"} ${a.kind === "status_changed" && a.to_status ? `moved it to ${LABEL[a.to_status as Status]}` : a.kind.replace("_", " ")}`,
              when: formatDateTime(a.created_at),
            }))}
          />
        )}
      </div>
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {t.status !== "cancelled" && (
          <Button onClick={() => modal.open({ title: "Edit Task", body: (done) => <TaskForm close={() => (done(), changed())} task={t} /> })}>Edit Task</Button>
        )}
        {t.status !== "cancelled" && t.status !== "done" && (
          <BlockButton t={t} onDone={changed} />
        )}
        {t.can_cancel && (
          <Button variant="danger" onClick={() => modal.open({ title: "Cancel Task", body: (done) => <CancelForm id={t.task_id} close={() => (done(), close(), refresh())} /> })}>
            Cancel Task
          </Button>
        )}
        {t.is_commitment && <CommitmentActions t={t} onChanged={changed} />}
      </FormFooter>
    </>
  );
}

function BlockButton({ t, onDone }: { t: TaskDetail; onDone: () => void }) {
  const modal = useModal();
  const unblock = useMutation("POST /api/v1/tasks/:id/unblock");
  if (t.blocked_reason) {
    const clear = async () => {
      try {
        await unblock.run({ params: { id: t.task_id }, body: {} });
        onDone();
        toast("Blocker cleared");
      } catch (e) {
        say(e);
      }
    };
    return <Button onClick={clear}>Clear Blocker</Button>;
  }
  return <Button onClick={() => modal.open({ title: "Mark Blocked", body: (close) => <BlockForm id={t.task_id} close={() => (close(), onDone())} /> })}>Mark Blocked</Button>;
}

function BlockForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ blocked_reason: "" }, tasks.TaskBlock);
  const save = useMutation("POST /api/v1/tasks/:id/block");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      close();
      toast("Marked blocked");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="What Is Blocking It" {...f.field("blocked_reason")}><TextAreaField {...f.field("blocked_reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Mark Blocked</Button>
      </FormFooter>
    </>
  );
}

function CancelForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ cancel_reason: "" }, tasks.TaskCancel);
  const save = useMutation("POST /api/v1/tasks/:id/cancel");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      close();
      toast("Task cancelled");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.field("cancel_reason")}><TextAreaField {...f.field("cancel_reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Keep Task</Button>
        <Button variant="danger" onClick={submit}>Cancel Task</Button>
      </FormFooter>
    </>
  );
}

function Comments({ id, onAdded }: { id: string; onAdded: () => void }) {
  const list = usePaged("GET /api/v1/tasks/:id/comments", { params: { id }, sort: "created_at" });
  const f = useContractForm({ body: "" }, tasks.TaskCommentCreate);
  const save = useMutation("POST /api/v1/tasks/:id/comments");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      f.reset({ body: "" });
      list.reload();
      onAdded();
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      {list.rows.map((c) => (
        <div key={c.task_comment_id} className="border-b border-border py-2 last:border-b-0">
          <div className="flex items-baseline gap-2">
            <b className="text-xs">{c.author?.display_name ?? "MyCity"}</b>
            <span className="ml-auto text-2xs text-subtle-foreground">{formatDateTime(c.created_at)}</span>
          </div>
          <p className="mt-1 text-xs" data-copy="content">{c.body}</p>
        </div>
      ))}
      {!list.rows.length && !list.loading && <p className="text-2xs text-subtle-foreground">No comments yet.</p>}
      <Field label="Comment" {...f.field("body")}><TextAreaField {...f.field("body")} /></Field>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit}>Add Comment</Button>
      </div>
    </>
  );
}

/* ───────────── New and Edit Task ───────────── */

/** What a task counts towards, as the picker holds it. */
const choiceOf = (t?: TaskDetail): CountsChoice[] =>
  t?.counts_towards
    ? [{ kind: t.counts_towards.kind, employee_target_id: t.counts_towards.employee_target_id, okr_key_result_id: t.counts_towards.okr_key_result_id, title: t.counts_towards.title, sub: null }]
    : [];

export function TaskForm({ close, task, commitment = false }: { close: () => void; task?: TaskDetail; commitment?: boolean }) {
  const me = useMe();
  const months = commitmentMonths();
  const filled = useAddressPrefill(tasks.TaskPrefill, !task);
  const [who, setWho] = useState<PersonRef[]>(task?.assignee && task.assignee.employee_id !== me.employee_id ? [task.assignee] : []);
  // An assignee named in the address shows by name: a manager's picker holds the person, not an id.
  const assignee = me.manages_people && filled.primary_assignee_id !== me.employee_id ? filled.primary_assignee_id : undefined;
  useEffect(() => {
    if (!assignee) return;
    let live = true;
    api.call("GET /api/v1/community/people/:id/card", { params: { id: assignee } }).then(
      (card) => live && setWho((now) => (now.length ? now : [card.person])),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [assignee]);
  const [counts, setCounts] = useState<CountsChoice[]>(choiceOf(task));
  const canAssign = !task || task.can_reassign;
  // An approved commitment keeps its person, mark, month and criteria; its date may still move.
  const fixed = Boolean(task?.is_commitment && task.original_due_at);
  const mayMark = !fixed && (!task || task.status !== "done");
  const f = useContractForm(
    {
      title: task?.title ?? filled.title ?? "",
      cadence: task?.cadence ?? filled.cadence ?? "",
      due_on: task?.due_at ? task.due_at.slice(0, 10) : (filled.due_on ?? ""),
      priority: (task?.priority ?? filled.priority ?? "normal") as string,
      description: task?.description ?? filled.description ?? "",
      is_commitment: task?.is_commitment ?? commitment,
      acceptance_criteria: task?.acceptance_criteria ?? "",
      commitment_month: task?.commitment_month ?? months[0][0],
    },
    tasks.TaskCreate,
  );
  const createTask = useMutation("POST /api/v1/tasks");
  const editTask = useMutation("PATCH /api/v1/tasks/:id");
  const isCommitment = Boolean(f.values.is_commitment);
  /** Counts Towards as the body names it: a line, or a key result as the task's record. */
  const pointer = () => {
    const c = counts[0];
    if (c?.kind === "line") return { employee_target_id: c.employee_target_id, ...(task?.entity_type === "key_result" ? { entity_type: null, entity_id: null } : {}) };
    if (c?.kind === "key_result") return { employee_target_id: null, entity_type: "key_result" as const, entity_id: c.okr_key_result_id };
    return { employee_target_id: null, ...(task?.entity_type === "key_result" ? { entity_type: null, entity_id: null } : {}) };
  };
  const commitmentBody = () =>
    mayMark
      ? isCommitment
        ? { is_commitment: true, acceptance_criteria: f.values.acceptance_criteria || null, commitment_month: f.values.commitment_month || null }
        : task?.is_commitment
          ? { is_commitment: false }
          : {}
      : {};
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    try {
      if (task) {
        const managed = task.can_reassign
          ? {
              title: v.title,
              cadence: v.cadence || null,
              due_on: v.due_on || null,
              ...(who[0] && !fixed ? { primary_assignee_id: who[0].employee_id } : {}),
              ...pointer(),
            }
          : {};
        const body = { priority: v.priority, description: v.description || null, ...managed, ...commitmentBody() };
        await editTask.run({ params: { id: task.task_id }, body: body as never });
        toast("Task saved");
      } else {
        const c = counts[0];
        const t = await createTask.run({
          body: {
            title: v.title,
            priority: v.priority as Task["priority"],
            ...(v.cadence && { cadence: v.cadence as "daily" | "weekly" }),
            ...(v.due_on && { due_on: v.due_on }),
            ...(v.description && { description: v.description }),
            ...(who[0] && { primary_assignee_id: who[0].employee_id }),
            ...(c?.kind === "line" && c.employee_target_id && { employee_target_id: c.employee_target_id }),
            ...(c?.kind === "key_result" && c.okr_key_result_id && { entity_type: "key_result" as const, entity_id: c.okr_key_result_id }),
            ...(isCommitment && { is_commitment: true, acceptance_criteria: v.acceptance_criteria, commitment_month: v.commitment_month }),
          },
        });
        toast(who[0] ? `${t.number} set for ${who[0].display_name}` : `${t.number} created`);
      }
      refresh();
      close();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const assigneeId = who[0]?.employee_id ?? task?.assignee?.employee_id ?? null;
  const month = isCommitment && f.values.commitment_month ? String(f.values.commitment_month) : `${(f.values.due_on || todayIso()).slice(0, 7)}-01`;
  return (
    <>
      {canAssign && <Field label="Task" {...f.field("title")}><TextField {...f.field("title")} placeholder="Visit the venue" /></Field>}
      {me.manages_people && canAssign && !fixed && (
        <Field label="Assign To" optional>
          <EmployeePicker value={who} onChange={setWho} placeholder="Your team" />
        </Field>
      )}
      {canAssign && (
        <Field label="Cadence" optional help="Daily is due by the end of the day. Weekly is due by the end of the week.">
          <SelectField options={[["", "None"], ["daily", "Daily"], ["weekly", "Weekly"]]} {...f.field("cadence")} />
        </Field>
      )}
      {canAssign && (
        <Field label="Due" optional={!isCommitment} {...f.field("due_on")}>
          <DateField {...f.field("due_on")} min={task ? undefined : todayIso()} />
        </Field>
      )}
      <Field label="Priority"><SelectField options={[["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]]} {...f.field("priority")} /></Field>
      {canAssign && (
        <Field label="Counts Towards" optional help={COUNTS_HELP}>
          <CountsTowardsField assigneeId={assigneeId} month={month} value={counts} onChange={setCounts} />
        </Field>
      )}
      {mayMark && (
        <Field label="Commitment" help={COMMITMENT_HELP} optional>
          <CheckboxField label="Mark as Commitment" value={isCommitment} onChange={(on) => f.field("is_commitment").onChange(on)} />
        </Field>
      )}
      {mayMark && isCommitment && (
        <>
          <Field label="Acceptance Criteria" {...f.field("acceptance_criteria")}><TextAreaField {...f.field("acceptance_criteria")} /></Field>
          <Field label="Month" {...f.field("commitment_month")}>
            <ChoiceField
              value={String(f.values.commitment_month)}
              onChange={(m) => f.field("commitment_month").onChange(m)}
              options={task?.commitment_month && !months.some(([m]) => m === task.commitment_month) ? [[task.commitment_month, formatMonth(task.commitment_month)], ...months] : months}
            />
          </Field>
        </>
      )}
      <Field label="Notes" optional><TextAreaField {...f.field("description")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{task ? "Save Task" : "Create Task"}</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Today ───────────── */

function Today() {
  const me = useMe();
  const { data, error, reload } = useApi("GET /api/v1/workspace/today");
  const openTask = useTaskPanel();
  const modal = useModal();
  const add = () => modal.open({ title: "New Task", body: (close) => <TaskForm close={close} /> });
  useScreenAction({ label: "New Task", onSelect: add });
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <LoadingRows count={8} />;
  return (
    <>
      <PageHeader title="Today" sub={formatDate(data.date)} />
      <KpiTiles
        mobileCols={2}
        items={[
          { key: "due", label: "Due Today", value: String(data.due_today), tone: data.due_today ? "warn" : undefined },
          { key: "over", label: "Overdue", value: String(data.overdue), tone: data.overdue ? "err" : undefined },
          { key: "review", label: "In Review", value: String(data.in_review) },
          { key: "done", label: "Done This Week", value: String(data.done_this_week), tone: "ok" },
        ]}
      />
      <Grid cols={2}>
        <Card>
          <CardHeader title="Your Day" right={data.overdue ? <Pill tone="err">{`${data.overdue} overdue`}</Pill> : undefined} />
          {data.my_day.data.map((t) => <TaskCard key={t.task_id} t={t} onClick={() => openTask(t.task_id, t.title)} />)}
          {!data.my_day.data.length && <p className="text-2xs text-subtle-foreground">Nothing due today.</p>}
        </Card>
        <Card>
          <CardHeader title="Set by Your Manager" />
          {data.set_by_manager.data.map((t) => <TaskCard key={t.task_id} t={t} onClick={() => openTask(t.task_id, t.title)} />)}
          {!data.set_by_manager.data.length && <p className="text-2xs text-subtle-foreground">Nothing set for you.</p>}
          <Button className="mt-1 w-full" icon="plus" onClick={add}>Add Task</Button>
        </Card>
      </Grid>
      <Grid cols={2}>
        <Card>
          <CardHeader title="Diary" right={<span className="text-2xs text-subtle-foreground">Africa/Lagos</span>} />
          {data.diary.data.map((d) => (
            <div key={d.item_kind + d.item_id} className="flex items-start gap-2.5 border-b border-border py-2 last:border-b-0">
              <b className="w-11.5 flex-none text-xs font-bold">{d.all_day ? "All Day" : formatTime(d.starts_at)}</b>
              <span className="min-w-0 flex-1"><div className="text-xs font-semibold" data-copy="content">{d.title}</div>{d.location && <div className="text-2xs text-subtle-foreground">{d.location}</div>}</span>
              {d.my_response && <Pill tone={d.my_response === "accepted" ? "info" : "neutral"}>{d.my_response === "accepted" ? "Accepted" : d.my_response === "declined" ? "Declined" : "Pending"}</Pill>}
            </div>
          ))}
          {!data.diary.data.length && <p className="text-2xs text-subtle-foreground">Nothing in the diary.</p>}
        </Card>
        <Card>
          <CardHeader title="Since You Were Away" />
          <Timeline
            items={data.since.data.map((a) => ({
              title: `${a.actor?.display_name ?? "MyCity"} ${a.kind === "status_changed" && a.to_status ? `moved it to ${LABEL[a.to_status as Status]}` : a.kind.replace("_", " ")}`,
              when: formatDateTime(a.created_at),
              text: a.task_title,
            }))}
          />
          {!data.since.data.length && <p className="text-2xs text-subtle-foreground">Nothing new.</p>}
        </Card>
      </Grid>
      {me.manages_people ? (
        <Grid cols={2}>
          <MyWeekCard />
          <TeamWeekCard />
        </Grid>
      ) : (
        <MyWeekCard />
      )}
    </>
  );
}

/* ───────────── Tasks ───────────── */

const COLS: Array<[BoardStatus, string, string]> = [
  ["todo", "To Do", "var(--subtle-foreground)"],
  ["in_progress", "In Progress", "var(--chart-2)"],
  ["in_review", "In Review", "var(--chart-3)"],
  ["done", "Done", "var(--chart-1)"],
];

function Tasks({ openId }: { openId: string | null }) {
  const me = useMe();
  const modal = useModal();
  const [, setParams] = useSearchParams();
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [q, setQ] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const summary = useApi("GET /api/v1/tasks/summary", { query: { scope } });
  const cols = {
    todo: usePagedColumn("todo", scope, q),
    in_progress: usePagedColumn("in_progress", scope, q),
    in_review: usePagedColumn("in_review", scope, q),
    done: usePagedColumn("done", scope, q),
  };
  const gone = usePaged("GET /api/v1/tasks", { filters: { status: "cancelled", scope }, enabled: cancelled });
  const move = useMutation("POST /api/v1/tasks/:id/move");
  const openTask = useTaskPanel();
  const add = () => modal.open({ title: "New Task", body: (close) => <TaskForm close={close} /> });
  const addCommitment = () => modal.open({ title: "New Commitment", body: (close) => <TaskForm close={close} commitment /> });
  const sendMonth = () => modal.open({ title: "Send Commitments", wide: true, body: (close) => <SendCommitmentsForm close={close} /> });
  useScreenAction({ label: "New Task", onSelect: add });
  useUrlAction("commitment", addCommitment);
  const all = Object.values(cols).flatMap((c) => c.rows);

  const onMove = async (card: string, _from: string, to: string) => {
    try {
      await move.run({ params: { id: card }, body: { status: to as BoardStatus, before_task_id: null } });
      refresh();
      toast(`Moved to ${LABEL[to as BoardStatus]}`);
    } catch (e) {
      say(e);
      refresh();
    }
  };
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Tasks"
        actions={
          <>
            {me.manages_people && <SegmentedControl value={scope} onChange={setScope} options={[["mine", "Mine"], ["team", "My Team"]]} />}
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
            { key: "done", label: "Done This Week", value: String(s.done_this_week), tone: "ok" },
          ]}
        />
      )}
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search tasks" className="w-full md:w-64" />
        <CheckboxField label="Show Cancelled" value={cancelled} onChange={setCancelled} />
      </Toolbar>
      <Kanban
        onMove={onMove}
        onOpen={(card) => {
          const t = all.find((x) => x.task_id === card);
          if (t) openTask(t.task_id, t.title);
        }}
        columns={COLS.map(([status, label, color]) => ({
          key: status,
          label,
          color,
          count: cols[status].page?.total,
          cards: cols[status].rows.map((t) => {
            const pill = duePill(t);
            return {
              key: t.task_id,
              title: t.title,
              meta: (
                <>
                  <Pill tone={pill.tone}>{pill.text}</Pill>
                  {t.is_commitment && <Pill tone="info">Commitment</Pill>}
                  {t.blocked_reason && <Pill tone="err">Blocked</Pill>}
                </>
              ),
              owner: t.assignee?.display_name,
            };
          }),
        }))}
      />
      {cancelled && (
        <DataView
          title="Cancelled"
          rows={gone.rows}
          rowKey={(t) => t.task_id}
          loading={gone.loading}
          error={gone.error}
          page={gone.page}
          onPage={gone.setPage}
          onRowClick={(t) => openTask(t.task_id, t.title)}
          empty={{ title: "Nothing Cancelled", text: "Cancelled tasks show here." }}
          columns={[
            { key: "n", label: "Task", render: (t) => t.title },
            { key: "a", label: "Assignee", render: (t) => t.assignee?.display_name ?? "" },
            { key: "w", label: "Cancelled", render: (t) => formatDate(t.cancelled_at) },
            { key: "r", label: "Reason", render: (t) => t.cancel_reason ?? "" },
          ]}
        />
      )}
      {/* A task opened from a link (?id=): the Commitments view, the bell, a calendar date. */}
      <Modal open={Boolean(openId)} onClose={() => setParams({ id: null }, { replace: true })} title="Task">
        {(close) => (openId ? <TaskPanel id={openId} close={close} /> : null)}
      </Modal>
    </>
  );
}

/** One kanban column: its own server page, so a column of 200 never loads 200. */
function usePagedColumn(status: BoardStatus, scope: "mine" | "team", q: string) {
  const list = usePaged("GET /api/v1/tasks", { filters: { status, scope }, sort: "sort_order" });
  const { setQ } = list;
  useEffect(() => setQ(q), [q, setQ]);
  return list;
}

/* ───────────── Calendar ───────────── */

/** What a performance date is, as Coming Up names it (performance.md §10). */
const PERFORMANCE_DATES: Record<NonNullable<CalendarItem["performance_kind"]>, string> = {
  check_in_due: "Check-In Due",
  review_due: "Review Due",
  key_result_due: "Key Result Due",
  pip_review: "PIP Review",
};
/** What Coming Up says at the end of an item's row. */
function endOf(e: CalendarItem): string {
  if (e.performance_kind) return PERFORMANCE_DATES[e.performance_kind];
  if (e.item_kind === "task") return "Deadline";
  if (e.item_kind === "leave") return "Leave";
  return e.all_day ? "All Day" : formatTime(e.starts_at);
}
/** An item's day in Lagos: an all-day item starts at its midnight there, which is the day before in UTC. */
const dayOf = (e: CalendarItem) => (e.all_day ? new Date(Date.parse(e.starts_at) + 3600_000).toISOString().slice(0, 10) : e.starts_at.slice(0, 10));

function CalendarTab() {
  const now = todayIso();
  const [ym, setYm] = useState<[number, number]>([Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1]);
  const month = `${ym[0]}-${String(ym[1] + 1).padStart(2, "0")}`;
  const list = usePaged("GET /api/v1/calendar", { filters: { month }, sort: "starts_at" });
  const modal = useModal();
  const openTask = useTaskPanel();
  const step = (n: number) => setYm(([y, m]) => (m + n < 0 ? [y - 1, 11] : m + n > 11 ? [y + 1, 0] : [y, m + n]));
  const add = () => modal.open({ title: "New Event", body: (close) => <EventForm close={close} /> });
  useScreenAction({ label: "New Event", onSelect: add });
  const { navigate } = useRouter();
  const openItem = (i: CalendarItem) => {
    if (i.item_kind === "task") openTask(i.item_id, i.title);
    else if (i.item_kind === "event") modal.open({ title: i.title, body: (close) => <EventPanel id={i.item_id} close={close} /> });
    else if (i.item_kind === "performance" && i.link) navigate(i.link.path);
  };
  const upcoming = list.rows.filter((e) => dayOf(e) >= now);
  return (
    <>
      <PageHeader
        title="Calendar"
        sub={`${monthName(ym[1])} ${ym[0]}`}
        actions={
          <>
            <Button onClick={() => step(-1)} aria-label="Previous month" icon="left" />
            <Button onClick={() => setYm([Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1])}>Today</Button>
            <Button onClick={() => step(1)} aria-label="Next month" icon="right" />
            <Button variant="primary" icon="plus" onClick={add}>New Event</Button>
          </>
        }
      />
      <Grid cols="1.4/1">
        <Calendar
          year={ym[0]}
          month={ym[1]}
          events={list.rows.map((e) => ({ date: dayOf(e), label: e.title, highlight: e.item_kind === "task" || e.item_kind === "performance", onSelect: () => openItem(e) }))}
        />
        <Card>
          <CardHeader title="Coming Up" />
          <TapList
            flat
            label="Coming Up"
            items={upcoming.map((e) => ({
              key: e.item_kind + e.item_id,
              title: <span data-copy="content">{e.title}</span>,
              sub: formatDate(e.starts_at),
              end: endOf(e),
              onSelect: () => openItem(e),
            }))}
          />
          {!upcoming.length && <p className="text-2xs text-subtle-foreground">Nothing else this month.</p>}
        </Card>
      </Grid>
    </>
  );
}

function EventPanel({ id, close }: { id: string; close: () => void }) {
  const { data: e, reload } = useApi("GET /api/v1/calendar/:id", { params: { id } });
  const respond = useMutation("POST /api/v1/calendar/:id/respond");
  const cancel = useMutation("POST /api/v1/calendar/:id/cancel");
  if (!e) return <LoadingRows count={4} />;
  const answer = async (response: "accepted" | "declined") => {
    try {
      await respond.run({ params: { id }, body: { response } });
      reload();
      invalidate("/api/v1/calendar");
      toast(response === "accepted" ? "Accepted" : "Declined");
    } catch (err) {
      say(err);
    }
  };
  const callOff = async () => {
    try {
      await cancel.run({ params: { id }, body: {} });
      invalidate("/api/v1/calendar");
      close();
      toast("Event called off");
    } catch (err) {
      say(err);
    }
  };
  return (
    <>
      <KeyValue
        items={[
          ["When", e.all_day ? formatDate(e.starts_at) : `${formatDateTime(e.starts_at)} to ${formatTime(e.ends_at)}`],
          ["Organiser", e.owner?.display_name ?? ""],
          ...(e.location ? ([["Where", e.location]] as Array<[string, string]>) : []),
          ["Attendees", e.attendees.map((a) => a.employee.display_name).join(", ") || "Nobody invited"],
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {e.can_edit && <Button variant="danger" onClick={callOff}>Call Off</Button>}
        {e.my_response && e.my_response !== "declined" && <Button onClick={() => answer("declined")}>Decline</Button>}
        {e.my_response && e.my_response !== "accepted" && <Button variant="primary" onClick={() => answer("accepted")}>Accept</Button>}
      </FormFooter>
    </>
  );
}

/** Lagos wall clock on a day → the instant on the wire. */
const lagosInstant = (day: string, hm: string) => new Date(`${day}T${hm}:00+01:00`).toISOString();
/** An instant → its Lagos day and wall clock (Lagos keeps UTC+1 all year). */
const lagosParts = (iso: string, plusMinutes = 0) => {
  const t = new Date(Date.parse(iso) + (60 + plusMinutes) * 60_000).toISOString();
  return { day: t.slice(0, 10), time: t.slice(11, 16) };
};

function EventForm({ close }: { close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const filled = useAddressPrefill(calendar.CalendarEventPrefill);
  const starts = filled.starts_at ? lagosParts(filled.starts_at) : null;
  // A start with no end is an hour long.
  const ends = filled.ends_at ? lagosParts(filled.ends_at) : filled.starts_at ? lagosParts(filled.starts_at, 60) : null;
  const f = useContractForm({
    title: filled.title ?? "",
    day: starts?.day ?? "",
    start: starts?.time ?? "10:00",
    end: ends?.time ?? "11:00",
    event_type: filled.event_type ?? "meeting",
    location: filled.location ?? "",
    visibility: "attendees",
  }, {
    title: (v: string) => (!v.trim() ? "Name the event" : null),
    day: (v: string) => (!v ? "Pick a date" : null),
    end: (v: string, all: Record<string, unknown>) => (v && all.start && v <= String(all.start) ? "Ends before it starts" : null),
  });
  const save = useMutation("POST /api/v1/calendar");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    try {
      await save.run({
        body: {
          title: v.title.trim(),
          starts_at: lagosInstant(v.day, v.start),
          ends_at: lagosInstant(v.day, v.end),
          event_type: v.event_type as CalendarItem["event_type"] & string,
          visibility: v.visibility as "private" | "attendees" | "everyone",
          ...(v.location.trim() && { location: v.location.trim() }),
          attendee_ids: who.map((p) => p.employee_id),
        } as never,
      });
      invalidate("/api/v1/calendar");
      invalidate("/api/v1/workspace");
      close();
      toast("Added to the calendar");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors({ ...e.fields, ...(e.fields.ends_at ? { end: e.fields.ends_at } : {}) });
      else say(e);
    }
  };
  return (
    <>
      <Field label="Event" {...f.field("title")}><TextField {...f.field("title")} /></Field>
      <Field label="Date" {...f.field("day")}><DateField {...f.field("day")} /></Field>
      <Grid cols={2}>
        <Field label="Start" {...f.field("start")}><TimeField {...f.field("start")} /></Field>
        <Field label="End" {...f.field("end")}><TimeField {...f.field("end")} /></Field>
      </Grid>
      <Field label="Kind"><SelectField options={[["meeting", "Meeting"], ["deadline", "Deadline"], ["campaign", "Campaign"], ["event", "Event"]]} {...f.field("event_type")} /></Field>
      <Field label="Attendees" optional><EmployeePicker value={who} onChange={setWho} multiple /></Field>
      {/* address:none a meeting's room or call link, not a street address */}
      <Field label="Location" optional><TextField {...f.field("location")} /></Field>
      <Field label="Who Can See"><SelectField options={[["attendees", "Attendees"], ["everyone", "Everyone"], ["private", "Only Me"]]} {...f.field("visibility")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Add Event</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Analytics ───────────── */

function Analytics() {
  const me = useMe();
  const [scope, setScope] = useState<"mine" | "team">(me.manages_people ? "team" : "mine");
  const [period, setPeriod] = useState<"30d" | "90d" | "year">("30d");
  const { data, error, reload } = useApi("GET /api/v1/workspace/analytics", { query: { scope, period } });
  const max = Math.max(1, ...(data?.workload.map((w) => w.open) ?? [1]));
  const maxPrio = Math.max(1, ...(data?.by_priority.map((p) => p.open) ?? [1]));
  return (
    <>
      <PageHeader
        title="Analytics"
        sub={data ? `${formatDate(data.from)} to ${formatDate(data.to)}` : undefined}
        actions={
          <>
            {me.manages_people && <SegmentedControl value={scope} onChange={setScope} options={[["mine", "Mine"], ["team", "My Team"]]} />}
            <SegmentedControl value={period} onChange={setPeriod} options={[["30d", "30 Days"], ["90d", "90 Days"], ["year", "This Year"]]} />
          </>
        }
      />
      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <LoadingRows count={8} />}
      {data && (
        <>
          <KpiTiles
            mobileCols={2}
            items={[
              { key: "rate", label: "Completion Rate", value: data.completion_rate === null ? "None yet" : `${data.completion_rate}%` },
              { key: "over", label: "Overdue", value: String(data.overdue), tone: data.overdue ? "err" : undefined },
              { key: "avg", label: "Avg Completion Time", value: data.avg_completion_days === null ? "None yet" : `${data.avg_completion_days} days` },
              { key: "done", label: "Done", value: String(data.done), tone: "ok" },
            ]}
          />
          <Grid cols={2}>
            <AreaChart
              title="Tasks Completed per Week"
              help="Tasks done, out of those done or due in the period, gives the completion rate."
              values={data.completed_per_week.map((w) => w.count)}
              labels={data.completed_per_week.map((w) => formatDate(w.week_start))}
            />
            <Card>
              <CardHeader title="Workload by Person" />
              <Bars rows={data.workload.map((w) => ({ label: w.employee.display_name, percent: Math.round((w.open / max) * 100), value: `${w.open} open` }))} />
              {!data.workload.length && <p className="text-2xs text-subtle-foreground">No open tasks.</p>}
            </Card>
          </Grid>
          <Grid cols={2}>
            <Card>
              <CardHeader title="Tasks by Priority" />
              <Bars rows={data.by_priority.map((p) => ({ label: PRIORITY[p.priority], percent: Math.round((p.open / maxPrio) * 100), value: `${p.open} open`, ...(p.priority === "urgent" ? { series: 4 as const } : {}) }))} />
            </Card>
          </Grid>
        </>
      )}
    </>
  );
}
