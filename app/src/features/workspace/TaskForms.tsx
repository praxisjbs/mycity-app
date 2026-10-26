/** The forms a task opens: New and Edit Task, and the small ones its panel and the board ask. */
import { useEffect, useRef, useState } from "react";
import tasks from "@mycity/contract/schemas/tasks.js";
import type { Department, Task, TaskDetail } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { useApi, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { ColleaguePicker, DepartmentPicker, ProjectPicker, TaskPeoplePicker, type ProjectChoice } from "@/features/shared/pickers";
import { useAddressPrefill } from "@/shell/screen-action";
import { COMMITMENT_HELP, commitmentMonths, COUNTS_HELP, CountsTowardsField, type CountsChoice } from "./Commitment";
import { Button, CheckboxField, ChoiceField, DateField, Field, FormFooter, formatDateTime, formatMonth, LoadingRows, Pill, RecordPicker, SelectField, shortMessage, TextAreaField, TextField, toast, todayIso, useContractForm } from "@mycity/ui";
import { LABEL, refresh, refreshed, say, STATUS_TONE, useLateOptions, useSetsForOthers, type BoardStatus, type LateReason, type Status } from "./shared";

/** A 422's field marks on the form; anything else as a toast. */
/** The most people a shared task takes besides its lead (tasks.service: "At most 25 people"). */
const MAX_MEMBERS = 25;
/** Fields a task refusal may name that are pickers outside the form, by the label the form shows. */
const LOOSE: Record<string, string> = { employee_target_id: "Counts Towards", entity_id: "Counts Towards", project_id: "Project" };

const failed = (f: { setServerErrors: (e: Record<string, string[]>) => void }) => (e: unknown) => {
  if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
  else say(e);
};

/* ───────────── New and Edit Task ───────────── */

/** What a task counts towards, as the picker holds it. */
const choiceOf = (t?: TaskDetail): CountsChoice[] =>
  t?.counts_towards
    ? [{ kind: t.counts_towards.kind, employee_target_id: t.counts_towards.employee_target_id, okr_key_result_id: t.counts_towards.okr_key_result_id, title: t.counts_towards.title, sub: null }]
    : [];

export const LEAD_HELP = "Answers for the task, and it counts on their scorecard.";

type Kind = "individual" | "shared";
type ShareBy = "people" | "department";

/**
 * Which of the people picked the reader may set work for, and so may name as the lead of a task
 * shared with them (GET /tasks/people without `shared`; a colleague of their department is
 * sharable but not theirs to lead). The first page answers when it holds everyone; past it, a
 * person not on it is looked up by name, once.
 */
function useMayLead(people: PersonRef[]): (employeeId: string) => boolean {
  const first = useApi("GET /api/v1/tasks/people", { query: {} });
  const [found, setFound] = useState<Record<string, boolean>>({});
  const onFirst = new Set((first.data?.data ?? []).map((p) => p.employee_id));
  const past = Boolean(first.data?.page.has_next);
  const latest = useRef(people);
  latest.current = people;
  const ask = past
    ? people
        .filter((p) => !onFirst.has(p.employee_id) && !(p.employee_id in found))
        .map((p) => p.employee_id)
        .join(",")
    : "";
  useEffect(() => {
    if (!ask) return;
    let live = true;
    const todo = latest.current.filter((p) => ask.split(",").includes(p.employee_id));
    Promise.all(
      todo.map((p) =>
        api.call("GET /api/v1/tasks/people", { query: { q: p.display_name } }).then(
          (r) => [p.employee_id, r.data.some((x) => x.employee_id === p.employee_id)] as const,
          () => [p.employee_id, false] as const,
        ),
      ),
    ).then((pairs) => {
      if (live) setFound((f) => ({ ...f, ...Object.fromEntries(pairs) }));
    });
    return () => {
      live = false;
    };
  }, [ask]);
  return (employeeId) => onFirst.has(employeeId) || found[employeeId] === true;
}

/** New Task or Edit Task; `dueOn` starts a new one on that day (a day pressed on the calendar). */
export function TaskForm({
  close,
  task,
  commitment = false,
  dueOn,
  project: inProject,
}: {
  close: () => void;
  task?: TaskDetail;
  commitment?: boolean;
  dueOn?: string;
  /** New Task on a project's page: the task joins it unless changed. */
  project?: ProjectChoice;
}) {
  const me = useMe();
  const months = commitmentMonths();
  const filled = useAddressPrefill(tasks.TaskPrefill, !task);
  // Who it is for (Individual): the primary assignee, never the reader themselves.
  const [who, setWho] = useState<PersonRef[]>(task?.assignee && task.assignee.employee_id !== me.employee_id ? [task.assignee] : []);
  const others = useSetsForOthers();
  const sharable = useApi("GET /api/v1/tasks/people", { query: { shared: "true" } });
  const peopleView = Boolean(me.grants.people?.includes("view"));
  const [kind, setKind] = useState<Kind>(task?.members.length ? "shared" : "individual");
  const [by, setBy] = useState<ShareBy>("people");
  // Shared with People: the people picked, the lead among them (an existing lead shows as one of them).
  const [picks] = useState<PersonRef[]>(() =>
    task?.assignee && task.assignee.employee_id !== me.employee_id ? [task.assignee, ...task.members] : (task?.members ?? []),
  );
  const [members, setMembers] = useState<PersonRef[]>(picks);
  const [lead, setLead] = useState(task?.assignee?.employee_id ?? me.employee_id);
  const mayLead = useMayLead(members);
  // Shared with a Department: the department, searched on the server, and a lead picked from it.
  const [picked, setPicked] = useState<Department[]>([]);
  const department = picked[0]?.department_id ?? "";
  const [deptLead, setDeptLead] = useState<PersonRef[]>([]);
  const [shareMark, setShareMark] = useState<string | null>(null);
  const [leadMark, setLeadMark] = useState<string | null>(null);
  const shared = kind === "shared";
  const mayShare = (sharable.data?.page.total ?? 0) > 0 || Boolean(task?.members.length);
  // An assignee named in the address shows by name: the picker holds the person, not an id.
  const assignee = filled.primary_assignee_id && filled.primary_assignee_id !== me.employee_id ? filled.primary_assignee_id : undefined;
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
  // The project it is in: the task's own, the page it was added from, or one named in the address.
  const [project, setProject] = useState<ProjectChoice[]>(task?.project ? [task.project] : inProject ? [inProject] : []);
  const named = !task && !inProject ? filled.project_id : undefined;
  useEffect(() => {
    if (!named) return;
    let live = true;
    api.call("GET /api/v1/projects/:id", { params: { id: named } }).then(
      (p) => live && p.status === "active" && setProject((now) => (now.length ? now : [{ project_id: p.project_id, number: p.number, name: p.name }])),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [named]);
  /** The project as an edit sends it: only when it changed, `null` taking the task out. */
  const moved = () => {
    const now = project[0]?.project_id ?? null;
    return now !== (task?.project?.project_id ?? null) ? { project_id: now } : {};
  };
  const canAssign = !task || task.can_reassign;
  // An approved commitment keeps its person, mark, month and criteria; its date may still move.
  const fixed = Boolean(task?.is_commitment && task.original_due_at);
  // A commitment is its lead's: the people sharing a task leave the mark to the lead and whoever manages it.
  const mayMark = !fixed && (!task || (task.status !== "done" && (task.can_reassign || task.assignee?.employee_id === me.employee_id)));
  const initial = {
    title: task?.title ?? filled.title ?? "",
    cadence: task?.cadence ?? filled.cadence ?? "",
    due_on: task?.due_at ? task.due_at.slice(0, 10) : (dueOn ?? filled.due_on ?? ""),
    priority: (task?.priority ?? filled.priority ?? "normal") as string,
    description: task?.description ?? filled.description ?? "",
    is_commitment: task?.is_commitment ?? commitment,
    acceptance_criteria: task?.acceptance_criteria ?? "",
    commitment_month: task?.commitment_month ?? months[0][0],
  };
  type Values = typeof initial;
  /** The fields Edit Task holds, as the PATCH takes them: an empty choice clears it. */
  const editFields = (v: Values) => ({ title: v.title, cadence: v.cadence || null, due_on: v.due_on || null, priority: v.priority, description: v.description || null });
  /** The commitment's fields, when the reader may mark it: an approved one sends none, so its date may move. */
  const commitmentBody = (v: Values) =>
    mayMark
      ? v.is_commitment
        ? { is_commitment: true, acceptance_criteria: v.acceptance_criteria || null, commitment_month: v.commitment_month || null }
        : task?.is_commitment
          ? { is_commitment: false }
          : {}
      : {};
  // New Task is checked by TaskCreate; Edit Task by TaskEdit, on what it would send.
  const f = useContractForm(initial, task ? { safeParse: (v: unknown) => tasks.TaskEdit.safeParse({ ...editFields(v as Values), ...commitmentBody(v as Values) }) } : tasks.TaskCreate);
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
  /**
   * Who shares it, as the body names them: the people, a department, or nobody (Individual). An
   * edit names them only when they or the lead changed: someone on it the reader could no longer
   * add stays until the people are edited (§11).
   */
  const sharing = () => {
    if (!shared) return task?.members.length ? { member_ids: [] } : {};
    if (by === "department") return { department_id: department };
    const ids = members.map((p) => p.employee_id);
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));
    const unchanged = task && task.members.length > 0 && same(ids, picks.map((p) => p.employee_id)) && lead === (task.assignee?.employee_id ?? me.employee_id);
    return unchanged ? {} : { member_ids: ids };
  };
  /** Who leads it, when that changes: the Individual assignee, or a shared task's lead. */
  const leading = (): { primary_assignee_id?: string } => {
    if (fixed) return {};
    if (!shared) {
      if (who[0]) return who[0].employee_id !== task?.assignee?.employee_id ? { primary_assignee_id: who[0].employee_id } : {};
      // Assign To cleared on a task someone else holds: it comes back to the reader.
      return task?.assignee && task.assignee.employee_id !== me.employee_id ? { primary_assignee_id: me.employee_id } : {};
    }
    if (by === "department") return deptLead[0] ? { primary_assignee_id: deptLead[0].employee_id } : {};
    return lead !== (task?.assignee?.employee_id ?? me.employee_id) ? { primary_assignee_id: lead } : {};
  };
  /** The people picked; a lead who is no longer among them hands back to the reader. */
  const pickMembers = (p: PersonRef[]) => {
    // A shared task has at most 25 people besides its lead (tasks.service): the picker stops there.
    if (p.length > MAX_MEMBERS) return setShareMark(`At most ${MAX_MEMBERS} people`);
    setMembers(p);
    setShareMark(null);
    if (lead !== me.employee_id && !p.some((x) => x.employee_id === lead)) setLead(me.employee_id);
  };
  const submit = async () => {
    const missing = shared && (by === "department" ? !department : !members.length) ? (by === "department" ? "Pick a department" : "Pick people") : null;
    const noLead = shared && by === "department" && department && !fixed && !deptLead[0] ? "Pick a lead" : null;
    setShareMark(missing);
    setLeadMark(noLead);
    if (!f.check() || missing || noLead) return;
    const v = f.values;
    try {
      if (task) {
        const { title, cadence, due_on, priority, description } = editFields(v);
        const managed = task.can_reassign ? { title, cadence, due_on, ...leading(), ...sharing(), ...pointer(), ...moved() } : {};
        const body = { priority, description, ...managed, ...commitmentBody(v) };
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
            ...(project[0] && { project_id: project[0].project_id }),
            ...leading(),
            ...sharing(),
            ...(c?.kind === "line" && c.employee_target_id && { employee_target_id: c.employee_target_id }),
            ...(c?.kind === "key_result" && c.okr_key_result_id && { entity_type: "key_result" as const, entity_id: c.okr_key_result_id }),
            ...(isCommitment && { is_commitment: true, acceptance_criteria: v.acceptance_criteria, commitment_month: v.commitment_month }),
          },
        });
        toast(t.members.length ? `${t.number} shared with ${t.members.length + 1} people` : who[0] ? `${t.number} set for ${who[0].display_name}` : `${t.number} created`);
      }
      refresh();
      close();
    } catch (e) {
      const raw = e instanceof ApiError ? (e.fields.member_ids ?? e.fields.department_id)?.[0] : undefined;
      const mark = raw ? shortMessage({ type: "custom", message: raw }) : undefined;
      const onLead = e instanceof ApiError ? e.fields.primary_assignee_id?.[0] : undefined;
      // Counts Towards and Project are pickers outside the form: their refusal is said here.
      const loose = e instanceof ApiError ? Object.entries(e.fields).find(([k]) => k in LOOSE) : undefined;
      if (mark || onLead) {
        setShareMark(mark ?? null);
        setLeadMark(onLead ?? null);
      } else if (loose) toast.error(`${LOOSE[loose[0]]}: ${loose[1][0]}`);
      else if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  const assigneeId = !shared ? (who[0]?.employee_id ?? (task ? me.employee_id : null)) : by === "department" ? (deptLead[0]?.employee_id ?? null) : lead;
  // A scorecard line is one person's: a new assignee drops the line picked for the last.
  const lastAssignee = useRef(assigneeId);
  useEffect(() => {
    if (lastAssignee.current === assigneeId) return;
    lastAssignee.current = assigneeId;
    setCounts((c) => c.filter((x) => x.kind !== "line"));
  }, [assigneeId]);
  // You, or one of the people picked the reader may set work for; a shared task's present lead stays offered.
  const leadOptions: Array<[string, string]> = [
    [me.employee_id, "You"],
    ...members
      .filter((p) => p.employee_id !== me.employee_id && (p.employee_id === task?.assignee?.employee_id || mayLead(p.employee_id)))
      .map((p) => [p.employee_id, p.display_name] as [string, string]),
  ];
  const month = isCommitment && f.values.commitment_month ? String(f.values.commitment_month) : `${(f.values.due_on || todayIso()).slice(0, 7)}-01`;
  return (
    <>
      {canAssign && <Field label="Task" {...f.field("title")}><TextField {...f.field("title")} placeholder="Visit the venue" /></Field>}
      {canAssign && !fixed && mayShare && (
        <Field label="Type">
          <ChoiceField value={kind} onChange={(k) => setKind(k as Kind)} options={[["individual", "Individual"], ["shared", "Shared"]]} />
        </Field>
      )}
      {canAssign && !fixed && !shared && others && (
        <Field label="Assign To" optional state={leadMark ? "bad" : undefined} message={leadMark ?? undefined}>
          <TaskPeoplePicker value={who} onChange={setWho} />
        </Field>
      )}
      {canAssign && shared && peopleView && others && !fixed && (
        <Field label="Share With">
          <ChoiceField
            value={by}
            onChange={(b) => {
              setBy(b as ShareBy);
              setShareMark(null);
            }}
            options={[["people", "People"], ["department", "Department"]]}
          />
        </Field>
      )}
      {canAssign && shared && by === "people" && (
        <Field label="People" state={shareMark ? "bad" : undefined} message={shareMark ?? undefined}>
          <TaskPeoplePicker shared multiple value={members} onChange={pickMembers} />
        </Field>
      )}
      {canAssign && shared && by === "department" && (
        <Field label="Department" state={shareMark ? "bad" : undefined} message={shareMark ?? undefined}>
          <DepartmentPicker
            value={picked}
            onChange={(d) => {
              setPicked(d);
              setDeptLead([]);
              setShareMark(null);
            }}
          />
        </Field>
      )}
      {canAssign && shared && !fixed && others && by === "people" && (
        <Field label="Lead" help={LEAD_HELP} state={leadMark ? "bad" : undefined} message={leadMark ?? undefined}>
          <SelectField
            value={lead}
            onChange={(id) => {
              setLead(id);
              setLeadMark(null);
            }}
            options={leadOptions}
          />
        </Field>
      )}
      {canAssign && shared && !fixed && by === "department" && department && (
        <Field label="Lead" help={LEAD_HELP} state={leadMark ? "bad" : undefined} message={leadMark ?? undefined}>
          <TaskPeoplePicker
            key={department}
            department={department}
            value={deptLead}
            onChange={(p) => {
              setDeptLead(p);
              setLeadMark(null);
            }}
          />
        </Field>
      )}
      {canAssign && (
        <Field label="Project" optional>
          <ProjectPicker value={project} onChange={setProject} />
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

/* ───────────── Moving to Done after the due time ───────────── */

/** Why it is late, asked as an overdue task moves to Done; the move happens on Mark Done. */
export function DoneLateForm({ task, close, onMoved }: { task: Pick<Task, "task_id" | "late_reason">; close: () => void; onMoved?: () => void }) {
  const f = useContractForm({ late_reason: (task.late_reason ?? "") as string }, { late_reason: (v: string) => (!v ? "Pick a reason" : null) });
  const reasons = useLateOptions();
  const move = useMutation("POST /api/v1/tasks/:id/move");
  // With every reason switched off there is nothing to pick: the card moves without one.
  const none = reasons.ready && reasons.options.length === 0;
  const submit = async () => {
    if (!none && !f.check()) return;
    try {
      await move.run({ params: { id: task.task_id }, body: { status: "done", before_task_id: null, ...(!none && { late_reason: f.values.late_reason as LateReason }) } });
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
      {none ? <p className="text-sm text-muted-foreground">No late reasons are switched on</p> : reasons.ready ? <Field label="Why Late" {...f.field("late_reason")}><SelectField options={reasons.options} {...f.field("late_reason")} /></Field> : <LoadingRows count={1} />}
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
  const reasons = useLateOptions();
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
      {reasons.ready && reasons.options.length === 0 ? (
        <>
          <p className="text-sm text-muted-foreground">No late reasons are switched on</p>
          <FormFooter>
            <Button variant="primary" onClick={close}>Close</Button>
          </FormFooter>
        </>
      ) : (
        <>
          {reasons.ready ? <Field label="Why Late" {...f.field("late_reason")}><SelectField options={reasons.options} {...f.field("late_reason")} /></Field> : <LoadingRows count={1} />}
          <FormFooter>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={submit}>Save Reason</Button>
          </FormFooter>
        </>
      )}
    </>
  );
}

type OpenSpec = { title: string; body: (close: () => void) => React.ReactNode };

/**
 * What a waiting card waits on, asked as it leaves To Do (QA OBS-06): each task it waits on, with
 * Open Task, and Go Ahead for whoever plans it (the panel's own rule). Nothing moves until every
 * link is done or gone ahead on; then the card goes where it was moved (`proceed`). Close leaves
 * it in To Do. The API's TASK_WAITING refusal stays behind it, for a board read before a link.
 */
function WaitingSheet({ task, close, proceed, onOpenTask, openForm }: { task: TaskDetail; close: () => void; proceed: () => Promise<void>; onOpenTask?: (id: string, title: string) => void; openForm: (spec: OpenSpec) => void }) {
  const [t, setT] = useState(task);
  const blockers = t.waiting_on.filter((d) => !d.satisfied);
  // A link gone ahead on: the task read again; with none left, the move it was asked for.
  const wentAhead = async () => {
    try {
      const fresh = await api.call("GET /api/v1/tasks/:id", { params: { id: t.task_id } });
      if (fresh.waiting_on.some((d) => !d.satisfied)) return setT(fresh);
      close();
      await proceed();
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      {blockers.map((d) => (
        <div key={d.task_dependency_id} className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-b-0">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold" data-copy="content">{`${d.task.number} ${d.task.title}`}</span>
            {d.task.assignee && <span className="text-2xs text-subtle-foreground" data-copy="content">{d.task.assignee.display_name}</span>}
          </span>
          <Pill tone={STATUS_TONE[d.task.status as Status]}>{LABEL[d.task.status as Status]}</Pill>
          {d.task.visible && onOpenTask && (
            <Button
              size="sm"
              onClick={() => {
                close();
                onOpenTask(d.task.task_id, d.task.title);
              }}
            >
              Open Task
            </Button>
          )}
          {t.can_plan && (
            <Button size="sm" onClick={() => openForm({ title: "Go Ahead", body: (done) => <OverrideForm taskId={t.task_id} edgeId={d.task_dependency_id} close={done} onDone={wentAhead} /> })}>
              Go Ahead
            </Button>
          )}
        </div>
      ))}
      <FormFooter>
        <Button onClick={close}>Close</Button>
      </FormFooter>
    </>
  );
}

/**
 * Move a card (above `before`, or to the foot), asking what it waits on first when it leaves To Do
 * waiting (WaitingSheet), and why when it reaches Done late. It settles once the board has
 * reloaded, so the board holds the card until it shows where it went.
 */
export function useMoveTask(openModal: (spec: OpenSpec) => void, onOpenTask?: (id: string, title: string) => void) {
  const move = useMutation("POST /api/v1/tasks/:id/move");
  const moveTask = async (t: Pick<Task, "task_id" | "status" | "overdue" | "late_reason" | "waiting">, to: BoardStatus, before: string | null = null): Promise<void> => {
    if (t.waiting && t.status === "todo" && to !== "todo") {
      let detail: TaskDetail;
      try {
        detail = await api.call("GET /api/v1/tasks/:id", { params: { id: t.task_id } });
      } catch (e) {
        say(e);
        return;
      }
      if (detail.waiting_on.some((d) => !d.satisfied)) {
        openModal({ title: "Waiting On", body: (close) => <WaitingSheet task={detail} close={close} proceed={() => moveTask({ ...t, waiting: false }, to, before)} onOpenTask={onOpenTask} openForm={openModal} /> });
        return;
      }
    }
    if (to === "done" && t.status !== "done" && t.overdue) {
      openModal({ title: "Mark Done", body: (close) => <DoneLateForm task={t} close={close} /> });
      return;
    }
    try {
      await move.run({ params: { id: t.task_id }, body: { status: to, before_task_id: before } });
      toast(t.status === to ? "Order saved" : `Moved to ${LABEL[to]}`);
    } catch (e) {
      say(e);
    }
    await refreshed();
  };
  return moveTask;
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
      // Without watchers there is no Send To to mark ("Nobody else to tell"): say it here.
      if (!hasWatchers && e instanceof ApiError && e.fields.to?.length) toast.error(e.fields.to[0]);
      else failed(f)(e);
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
  // Pick a Day marks the weekdays; what the API refuses marks Repeat itself.
  const [dayMark, setDayMark] = useState<string | null>(null);
  const [repeatMark, setRepeatMark] = useState<string | null>(null);
  const save = useMutation("PATCH /api/v1/tasks/:id");
  const submit = async () => {
    const v = f.values;
    if (v.freq === "weekly" && !days.length) return setDayMark("Pick a day");
    const recurrence = !v.freq ? null : v.freq === "daily" ? { freq: "daily" as const } : v.freq === "weekly" ? { freq: "weekly" as const, days: [...days].sort() } : { freq: "monthly" as const, day_of_month: Number(v.day_of_month) };
    try {
      await save.run({ params: { id: task.task_id }, body: { recurrence } });
      onDone();
      close();
      toast(recurrence ? "Repeat set" : "Repeat stopped");
    } catch (e) {
      // A series counts from its due day: without one the API refuses any repeat (§6).
      if (e instanceof ApiError && e.fields.recurrence?.[0]) setRepeatMark(e.fields.recurrence[0]);
      else say(e);
    }
  };
  const freq = f.field("freq");
  return (
    <>
      <Field label="Repeat" state={repeatMark ? "bad" : undefined} message={repeatMark ?? undefined}>
        <SelectField options={[["", "Does Not Repeat"], ["daily", "Every Working Day"], ["weekly", "Weekly"], ["monthly", "Monthly"]]} {...freq} state={repeatMark ? "bad" : freq.state} onChange={(v) => (freq.onChange(v), setRepeatMark(null))} />
      </Field>
      {f.values.freq === "weekly" && (
        <Field label="On" state={dayMark ? "bad" : undefined} message={dayMark ?? undefined}>
          {WEEKDAYS.map(([d, name]) => (
            <CheckboxField key={d} label={name} value={days.includes(d)} onChange={(on) => (setDays((ds) => (on ? [...ds, d] : ds.filter((x) => x !== d))), setDayMark(null))} />
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
