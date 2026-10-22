/** The forms a task opens: New and Edit Task, and the small ones its panel and the board ask. */
import { useState } from "react";
import tasks from "@mycity/contract/schemas/tasks.js";
import type { Task, TaskDetail } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { ColleaguePicker, EmployeePicker } from "@/features/shared/pickers";
import { Button, CheckboxField, DateField, Field, FormFooter, formatDateTime, RecordPicker, SelectField, TextAreaField, TextField, toast, todayIso, useContractForm } from "@mycity/ui";
import { LABEL, LATE_OPTIONS, refresh, say, type BoardStatus, type LateReason } from "./shared";

/** A 422's field marks on the form; anything else as a toast. */
const failed = (f: { setServerErrors: (e: Record<string, string[]>) => void }) => (e: unknown) => {
  if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
  else say(e);
};

/* ───────────── New and Edit Task ───────────── */

export function TaskForm({ close, title = "", task }: { close: () => void; title?: string; task?: TaskDetail }) {
  const me = useMe();
  const [who, setWho] = useState<PersonRef[]>(task?.assignee && task.assignee.employee_id !== me.employee_id ? [task.assignee] : []);
  const canAssign = !task || task.can_reassign;
  const f = useContractForm(
    {
      title: task?.title ?? title,
      cadence: task?.cadence ?? "",
      due_on: task?.due_at ? task.due_at.slice(0, 10) : "",
      priority: (task?.priority ?? "normal") as string,
      description: task?.description ?? "",
    },
    tasks.TaskCreate,
  );
  const createTask = useMutation("POST /api/v1/tasks");
  const editTask = useMutation("PATCH /api/v1/tasks/:id");
  const submit = async () => {
    if (!f.check()) return;
    const v = f.values;
    try {
      if (task) {
        const body = task.can_reassign
          ? { title: v.title, priority: v.priority, cadence: v.cadence || null, due_on: v.due_on || null, description: v.description || null, ...(who[0] ? { primary_assignee_id: who[0].employee_id } : {}) }
          : { priority: v.priority, description: v.description || null };
        await editTask.run({ params: { id: task.task_id }, body: body as never });
        toast("Task saved");
      } else {
        const t = await createTask.run({
          body: {
            title: v.title,
            priority: v.priority as Task["priority"],
            ...(v.cadence && { cadence: v.cadence as "daily" | "weekly" }),
            ...(v.due_on && { due_on: v.due_on }),
            ...(v.description && { description: v.description }),
            ...(who[0] && { primary_assignee_id: who[0].employee_id }),
          },
        });
        toast(who[0] ? `${t.number} set for ${who[0].display_name}` : `${t.number} created`);
      }
      refresh();
      close();
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      {canAssign && <Field label="Task" {...f.field("title")}><TextField {...f.field("title")} placeholder="Visit the venue" /></Field>}
      {me.manages_people && canAssign && (
        <Field label="Assign To" optional>
          <EmployeePicker value={who} onChange={setWho} placeholder="Your team" />
        </Field>
      )}
      {canAssign && (
        <Field label="Cadence" optional help="Daily is due by the end of the day. Weekly is due by the end of the week.">
          <SelectField options={[["", "None"], ["daily", "Daily"], ["weekly", "Weekly"]]} {...f.field("cadence")} />
        </Field>
      )}
      {canAssign && <Field label="Due" optional {...f.field("due_on")}><DateField {...f.field("due_on")} min={todayIso()} /></Field>}
      <Field label="Priority"><SelectField options={[["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]]} {...f.field("priority")} /></Field>
      <Field label="Notes" optional><TextAreaField {...f.field("description")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{task ? "Save Task" : "Create Task"}</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Moving to Done after the due time ───────────── */

/** Why it is late, asked as an overdue task moves to Done; the move happens on Mark Done. */
export function DoneLateForm({ task, close, onMoved }: { task: Pick<Task, "task_id" | "late_reason">; close: () => void; onMoved?: () => void }) {
  const f = useContractForm({ late_reason: (task.late_reason ?? "") as string }, { late_reason: (v: string) => (!v ? "Pick a reason" : null) });
  const move = useMutation("POST /api/v1/tasks/:id/move");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await move.run({ params: { id: task.task_id }, body: { status: "done", before_task_id: null, late_reason: f.values.late_reason as LateReason } });
      refresh();
      onMoved?.();
      close();
      toast("Moved to Done");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Why Late" {...f.field("late_reason")}><SelectField options={LATE_OPTIONS} {...f.field("late_reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Mark Done</Button>
      </FormFooter>
    </>
  );
}

/** The late reason on an overdue task, set from its panel. */
export function LateReasonForm({ task, close, onSaved }: { task: TaskDetail; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ late_reason: (task.late_reason ?? "") as string }, { late_reason: (v: string) => (!v ? "Pick a reason" : null) });
  const save = useMutation("PATCH /api/v1/tasks/:id");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: task.task_id }, body: { late_reason: f.values.late_reason as LateReason } });
      onSaved();
      close();
      toast("Reason saved");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Why Late" {...f.field("late_reason")}><SelectField options={LATE_OPTIONS} {...f.field("late_reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Reason</Button>
      </FormFooter>
    </>
  );
}

/** Move a card (above `before`, or to the foot), asking why first when it reaches Done late. */
export function useMoveTask(openModal: (spec: { title: string; body: (close: () => void) => React.ReactNode }) => void) {
  const move = useMutation("POST /api/v1/tasks/:id/move");
  return async (t: Pick<Task, "task_id" | "status" | "overdue" | "late_reason">, to: BoardStatus, before: string | null = null) => {
    if (to === "done" && t.status !== "done" && t.overdue) {
      openModal({ title: "Mark Done", body: (close) => <DoneLateForm task={t} close={close} /> });
      return;
    }
    try {
      await move.run({ params: { id: t.task_id }, body: { status: to, before_task_id: before } });
      refresh();
      toast(t.status === to ? "Order saved" : `Moved to ${LABEL[to]}`);
    } catch (e) {
      say(e);
      refresh();
    }
  };
}

/* ───────────── Holds ───────────── */

export function BlockForm({ id, close, onDone }: { id: string; close: () => void; onDone: () => void }) {
  const f = useContractForm({ blocked_reason: "", estimated_resolve_on: "" }, tasks.TaskBlock);
  const save = useMutation("POST /api/v1/tasks/:id/block");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: { blocked_reason: f.values.blocked_reason, ...(f.values.estimated_resolve_on && { estimated_resolve_on: f.values.estimated_resolve_on }) } });
      onDone();
      close();
      toast("Marked blocked");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="What Is Blocking It" {...f.field("blocked_reason")}><TextAreaField {...f.field("blocked_reason")} /></Field>
      <Field label="Expected Clear" optional {...f.field("estimated_resolve_on")}><DateField {...f.field("estimated_resolve_on")} min={todayIso()} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Mark Blocked</Button>
      </FormFooter>
    </>
  );
}

export function UnblockForm({ task, close, onDone }: { task: TaskDetail; close: () => void; onDone: () => void }) {
  const f = useContractForm({ resolve_note: "" }, { resolve_note: (v: string) => (v.length > 500 ? "Too long" : null) });
  const [push, setPush] = useState(true);
  const save = useMutation("POST /api/v1/tasks/:id/unblock");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const t = await save.run({ params: { id: task.task_id }, body: { push_due: push, ...(f.values.resolve_note.trim() && { resolve_note: f.values.resolve_note.trim() }) } });
      onDone();
      close();
      toast(push && t.due_at !== task.due_at ? "Cleared, due date moved" : "Blocker cleared");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="How It Cleared" optional {...f.field("resolve_note")}><TextAreaField {...f.field("resolve_note")} /></Field>
      {task.due_at && (
        <Field label="Due Date" help="The due date moves on by the days the task was blocked.">
          <CheckboxField label="Move it on" value={push} onChange={setPush} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Clear Blocker</Button>
      </FormFooter>
    </>
  );
}

export function CancelForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ cancel_reason: "" }, tasks.TaskCancel);
  const save = useMutation("POST /api/v1/tasks/:id/cancel");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      refresh();
      close();
      toast("Task cancelled");
    } catch (e) {
      failed(f)(e);
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

/* ───────────── Steps, waiting on, watchers, pings, reminders ───────────── */

export function StepForm({ id, close, onDone }: { id: string; close: () => void; onDone: () => void }) {
  const f = useContractForm({ title: "", due_on: "" }, tasks.TaskStepCreate);
  const save = useMutation("POST /api/v1/tasks/:id/steps");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: { title: f.values.title, ...(f.values.due_on && { due_on: f.values.due_on }) } });
      onDone();
      close();
      toast("Step added");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Step" {...f.field("title")}><TextField {...f.field("title")} placeholder="Order banners" /></Field>
      <Field label="Due" optional {...f.field("due_on")}><DateField {...f.field("due_on")} min={todayIso()} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Add Step</Button>
      </FormFooter>
    </>
  );
}

/** Pick a task this one waits on, from the tasks the reader can see. */
export function WaitingForm({ task, close, onDone }: { task: TaskDetail; close: () => void; onDone: () => void }) {
  const list = usePaged("GET /api/v1/tasks", { filters: { scope: "team" } });
  const [picked, setPicked] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation("POST /api/v1/tasks/:id/waiting-on");
  const taken = new Set([task.task_id, ...task.waiting_on.map((d) => d.task.task_id)]);
  const submit = async () => {
    if (!picked[0]) return setError("Pick a task");
    try {
      await save.run({ params: { id: task.task_id }, body: { depends_on_task_id: picked[0].task_id } });
      onDone();
      close();
      toast(`Waiting on ${picked[0].number}`);
    } catch (e) {
      if (e instanceof ApiError && e.fields.depends_on_task_id?.[0]) setError(e.fields.depends_on_task_id[0]);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Waits On" state={error ? "bad" : undefined} message={error ?? undefined}>
        <RecordPicker
          list={{ rows: list.rows.filter((t: Task) => !taken.has(t.task_id)), page: list.page, loading: list.loading, error: list.error, q: list.q, setQ: list.setQ }}
          value={picked}
          onChange={(v) => (setPicked(v), setError(null))}
          id={(t: Task) => t.task_id}
          title={(t: Task) => `${t.number} ${t.title}`}
          sub={(t: Task) => `${LABEL[t.status]}${t.assignee ? `, ${t.assignee.display_name}` : ""}`}
          placeholder="Search tasks"
        />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Add Link</Button>
      </FormFooter>
    </>
  );
}

export function OverrideForm({ taskId, edgeId, close, onDone }: { taskId: string; edgeId: string; close: () => void; onDone: () => void }) {
  const f = useContractForm({ override_reason: "" }, tasks.TaskDependencyOverride);
  const save = useMutation("POST /api/v1/tasks/:id/waiting-on/:child_id/override");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: taskId, child_id: edgeId }, body: { ...(f.values.override_reason.trim() && { override_reason: f.values.override_reason.trim() }) } });
      onDone();
      close();
      toast("Going ahead");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Reason" optional {...f.field("override_reason")}><TextAreaField {...f.field("override_reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Go Ahead</Button>
      </FormFooter>
    </>
  );
}

export function WatcherForm({ id, close, onDone }: { id: string; close: () => void; onDone: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation("POST /api/v1/tasks/:id/watchers");
  const submit = async () => {
    if (!who[0]) return setError("Pick someone");
    try {
      await save.run({ params: { id }, body: { employee_id: who[0].employee_id } });
      onDone();
      close();
      toast(`${who[0].display_name} is watching`);
    } catch (e) {
      if (e instanceof ApiError && e.fields.employee_id?.[0]) setError(e.fields.employee_id[0]);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Watcher" state={error ? "bad" : undefined} message={error ?? undefined}>
        <ColleaguePicker value={who} onChange={(v) => (setWho(v), setError(null))} placeholder="Search staff" />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Add Watcher</Button>
      </FormFooter>
    </>
  );
}

export function PingForm({ id, hasWatchers, close }: { id: string; hasWatchers: boolean; close: () => void }) {
  const f = useContractForm({ message: "", to: "assignee" as string }, tasks.TaskPing);
  const save = useMutation("POST /api/v1/tasks/:id/ping");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: { message: f.values.message, to: f.values.to as "assignee" | "watchers" | "everyone" } });
      close();
      toast("Nudge sent");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Message" {...f.field("message")}><TextAreaField {...f.field("message")} /></Field>
      {hasWatchers && (
        <Field label="Send To" {...f.field("to")}>
          <SelectField options={[["assignee", "Assignee"], ["watchers", "Watchers"], ["everyone", "Everyone"]]} {...f.field("to")} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Nudge</Button>
      </FormFooter>
    </>
  );
}

const WEEKDAYS: Array<[number, string]> = [[1, "Monday"], [2, "Tuesday"], [3, "Wednesday"], [4, "Thursday"], [5, "Friday"], [6, "Saturday"]];
const MONTH_DAYS: Array<[string, string]> = Array.from({ length: 28 }, (_, i) => [String(i + 1), `Day ${i + 1}`]);

/** How a task repeats, as the panel says it. */
export function repeatText(r: TaskDetail["recurrence"]) {
  if (!r) return null;
  if (r.freq === "daily") return "Every working day";
  if (r.freq === "monthly") return `Monthly, day ${r.day_of_month}`;
  return `Weekly, ${WEEKDAYS.filter(([d]) => r.days.includes(d)).map(([, n]) => n.slice(0, 3)).join(", ")}`;
}

/** How the task repeats: every working day, chosen weekdays, or a day of the month. */
export function RepeatForm({ task, close, onDone }: { task: TaskDetail; close: () => void; onDone: () => void }) {
  const r = task.recurrence;
  const f = useContractForm(
    {
      freq: (r?.freq ?? "") as string,
      day_of_month: r?.freq === "monthly" ? String(r.day_of_month) : String(Math.min(28, Number((task.due_at ?? "").slice(8, 10)) || 1)),
    },
    {},
  );
  const [days, setDays] = useState<number[]>(r?.freq === "weekly" ? r.days : [1]);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation("PATCH /api/v1/tasks/:id");
  const submit = async () => {
    const v = f.values;
    if (v.freq === "weekly" && !days.length) return setError("Pick a day");
    const recurrence = !v.freq ? null : v.freq === "daily" ? { freq: "daily" as const } : v.freq === "weekly" ? { freq: "weekly" as const, days: [...days].sort() } : { freq: "monthly" as const, day_of_month: Number(v.day_of_month) };
    try {
      await save.run({ params: { id: task.task_id }, body: { recurrence } });
      onDone();
      close();
      toast(recurrence ? "Repeat set" : "Repeat stopped");
    } catch (e) {
      if (e instanceof ApiError && e.fields.recurrence?.[0]) setError(e.fields.recurrence[0]);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Repeat" state={error && !f.values.freq ? "bad" : undefined} message={error && f.values.freq !== "weekly" ? error : undefined}>
        <SelectField options={[["", "Does Not Repeat"], ["daily", "Every Working Day"], ["weekly", "Weekly"], ["monthly", "Monthly"]]} {...f.field("freq")} />
      </Field>
      {f.values.freq === "weekly" && (
        <Field label="On" state={error ? "bad" : undefined} message={error ?? undefined}>
          {WEEKDAYS.map(([d, name]) => (
            <CheckboxField key={d} label={name} value={days.includes(d)} onChange={(on) => (setDays((ds) => (on ? [...ds, d] : ds.filter((x) => x !== d))), setError(null))} />
          ))}
        </Field>
      )}
      {f.values.freq === "monthly" && <Field label="On Day"><SelectField options={MONTH_DAYS} {...f.field("day_of_month")} /></Field>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Repeat</Button>
      </FormFooter>
    </>
  );
}

const LEAD: Array<[string, string]> = [["", "None"], ["0", "At Due Time"], ["15", "15 Minutes Before"], ["60", "1 Hour Before"], ["1440", "1 Day Before"], ["2880", "2 Days Before"]];

/** Up to three reminders to the assignee, each a lead time before the due time; a fixed one stays as it was. */
export function RemindersForm({ task, close, onDone }: { task: TaskDetail; close: () => void; onDone: () => void }) {
  const slot = (i: number) => {
    const r = task.reminders[i];
    if (!r) return "";
    return r.minutes_before === null ? `at:${r.remind_at}` : String(r.minutes_before);
  };
  const f = useContractForm({ one: slot(0), two: slot(1), three: slot(2) }, {});
  const save = useMutation("PUT /api/v1/tasks/:id/reminders");
  const options = (v: string): Array<[string, string]> => (v.startsWith("at:") ? [...LEAD, [v, formatDateTime(v.slice(3))]] : LEAD);
  const submit = async () => {
    const picked = [f.values.one, f.values.two, f.values.three].filter(Boolean);
    try {
      await save.run({
        params: { id: task.task_id },
        body: { reminders: [...new Set(picked)].map((v) => (v.startsWith("at:") ? { remind_at: v.slice(3) } : { minutes_before: Number(v) })) },
      });
      onDone();
      close();
      toast(picked.length ? "Reminders set" : "Reminders cleared");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <Field label="First Reminder"><SelectField options={options(f.values.one)} {...f.field("one")} /></Field>
      <Field label="Second Reminder" optional><SelectField options={options(f.values.two)} {...f.field("two")} /></Field>
      <Field label="Third Reminder" optional><SelectField options={options(f.values.three)} {...f.field("three")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Set Reminders</Button>
      </FormFooter>
    </>
  );
}
