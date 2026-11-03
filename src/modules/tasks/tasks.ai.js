"use strict";
/**
 * What the assistant may read and do about tasks: the board within the asker's own
 * `workspace` scope (their own, and their reporting line's for a manager), one page of
 * 25 at a time, and one task as its panel shows it (tasks.get); the board counted
 * (tasks.summary: by status, assignee, priority, due window or cadence; figures, never rows,
 * docs/guides/praxis-ai.md §6.13); and, as cards the person confirms (§6.11), every form of the
 * board and the panel (decision 33): setting a task and changing one, marking tasks done,
 * commenting, adding a step and changing one, making a task wait on another, and Late Reasons for
 * their keepers, each through the same service function the screen's own button calls. Cancelling
 * stays on the task's panel.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./tasks.service");
const reasons = require("./tasks.reasons");

const taskLink = (id) => (routeMap.linkFor("task", id) || {}).path || null;

/**
 * When is it due? answered with a tap (docs/guides/praxis-ai.md §1.3 decision 29): today, tomorrow,
 * the coming Friday (the next one when Friday is today or tomorrow), or no due day. The model reads
 * the word against today's date, which the system turn gives it.
 */
function dueChoices({ today }) {
  const day = today ? new Date(`${today}T12:00:00Z`).getUTCDay() : null;
  const toFriday = day === null ? 3 : (5 - day + 7) % 7;
  return ["Today", "Tomorrow", toFriday <= 1 ? "Next Friday" : "Friday", "No Due Day"];
}

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): a task on the asker's own board, set by
 * them for themselves, and one on an outsider's board, set by the outsider; the list must return the
 * first and never the second, and a card naming the second is refused by the module's own check.
 */
/** Each card's values for one task, built by whoever set it (a step to tick, a second task to wait on). */
const VALUES = {
  "tasks.complete": (t) => ({ task_ids: [t.task_id] }),
  "tasks.comment": (t) => ({ task_id: t.task_id, body: "A note from the matrix" }),
  "tasks.edit": (t) => ({ task_id: t.task_id, priority: "high" }),
  "tasks.add_step": (t) => ({ task_id: t.task_id, title: "A step from the matrix" }),
  "tasks.edit_step": async (t, who, scope) => ({ task_id: t.task_id, task_step_id: (await service.addStep(who, scope, t.task_id, { title: "A step to tick" })).task_step_id, done: true }),
  "tasks.wait_on": async (t, who, scope) => ({ task_id: t.task_id, depends_on_task_id: (await service.create(who, scope, { title: "The task it waits on" })).task_id }),
};
/** A probe's answer for one task: the card's values as the tool being probed takes them (a read takes none). */
const forTask = async (ctx, t, who, scope) => ({ type: "task", id: t.task_id, values: VALUES[ctx.key] ? await VALUES[ctx.key](t, who, scope) : {} });
const probe = {
  inside: async (ctx) => forTask(ctx, await service.create(ctx.actor, ctx.actor.scope, { title: `Matrix task for ${ctx.role}` }), ctx.actor, ctx.actor.scope),
  outside: async (ctx) => forTask(ctx, await service.create(ctx.outsider.user, ctx.outsider.scope, { title: `Outsider's task, seen by ${ctx.role}` }), ctx.outsider.user, ctx.outsider.scope),
};

/** The task a card acts on, named by number and title, as the person may see it. */
const theTask = (values, actor, db) => (values.task_id ? (db ? service.cardRecords(db, [values.task_id], actor.scope) : [{ type: "task", id: values.task_id }]) : []);
/** The task a card made or changed, read back as a line that opens it. */
const taskLine = (status) => (task) => [{ type: "task", id: task.task_id, label: `${task.number} ${task.title}`, status, link: taskLink(task.task_id) }];

module.exports = defineManifest({
  module: "workspace",
  actions: [
    {
      key: "tasks.create",
      description: "Set a task: title, notes, due day, priority, lead; share it with people (member_ids) or a department (department_id), never both; watchers see it and hear when it moves",
      input: c.tasks.TaskCreate,
      permission: ["workspace", "create"],
      risk: "standard",
      suggest: true,
      // New Task's own fields (decision 31): commitments, repeats, Counts Towards and a record stay on the form.
      fields: ["title", "description", "primary_assignee_id", "member_ids", "department_id", "watcher_ids", "watcher_department_id", "due_on", "priority", "cadence", "project_id"],
      picks: { primary_assignee_id: "task_assignee", member_ids: "task_member", department_id: "department", watcher_ids: "colleague", watcher_department_id: "department", project_id: "project" },
      // Nothing is acted on but the task it makes; the people, departments and project on it are named.
      names: (values, _actor, db) => (db ? service.cardNames(db, values) : []),
      asks: [
        { field: "title", question: "What is the task?" },
        { field: "due_on", question: "When is it due?", choices: dueChoices, none: true },
        { field: "priority", question: "How urgent is it?", choices: ["Low", "Normal", "High", "Urgent"] },
      ],
      // The same function the screen's Create Task calls, with the scope the grant gives (§6).
      run: (values, actor) => service.create(actor, actor.scope, values),
      readback: (task) => [{ type: "task", id: task.task_id, label: `${task.number} ${task.title}`, status: "created", link: taskLink(task.task_id) }],
      labels: { title: "Title", description: "Notes", priority: "Priority", cadence: "Cadence", due_on: "Due Day", primary_assignee_id: "For", member_ids: "Shared With", department_id: "Department", watcher_ids: "Watchers", watcher_department_id: "Watching Department", project_id: "Project" },
    },
    {
      key: "tasks.complete",
      label: "Mark Done",
      matrix: probe,
      description: "Mark one or more of my tasks done, with the late reason the board asks for an overdue one",
      input: c.tasks.TaskComplete,
      permission: ["workspace", "edit"],
      risk: "standard",
      bulk: 25,
      // Mark Done is a button on the task's panel; its late reason is asked in a sheet. The card names the tasks and takes the reason.
      form: "none: Mark Done is a button on the task's panel, its late reason asked in a sheet; the card names the tasks",
      records: (values, _actor, db) => (db ? service.cardRecords(db, values.task_ids, _actor.scope) : (values.task_ids || []).map((id) => ({ type: "task", id }))),
      check: (client, values, actor) => service.assertCardTasks(client, values.task_ids, actor.scope),
      // Each task moved to Done through the board's own move, one after another (§6).
      run: (values, actor) => service.completeMany(actor, actor.scope, values),
      readback: (r) => r.lines.map((l) => ({ ...l, link: taskLink(l.id) })),
      labels: { task_ids: "Tasks", late_reason: "Late Reason" },
    },
    {
      key: "tasks.comment",
      label: "Add Comment",
      matrix: probe,
      description: "Comment on a task I can see: the task and the words",
      input: c.tasks.TaskCommentAdd,
      permission: ["workspace", "edit"],
      risk: "standard",
      // The panel's comment box validates with TaskCommentCreate alone: the panel is the task. The card names it too.
      form: "none: a comment is typed on the task's panel, whose form never names the task; the card must",
      records: theTask,
      check: (client, values, actor) => service.assertCardTasks(client, [values.task_id], actor.scope),
      run: (values, actor) => service.comment(actor, actor.scope, values.task_id, { body: values.body }),
      readback: (comment) => [{ type: "task", id: comment.task_id, label: "Comment added", status: "commented", link: taskLink(comment.task_id) }],
      labels: { task_id: "Task", body: "Comment" },
    },
    {
      key: "tasks.edit",
      label: "Save Task",
      matrix: probe,
      description: "Change a task I can see: its title, notes, due day, priority, cadence, whom it is for, who shares it or its project; only what changes",
      input: c.tasks.TaskChange,
      permission: ["workspace", "edit"],
      risk: "standard",
      form: "none: Edit Task's form changes the task open on its panel and never names it; the card must",
      // Edit Task's own fields (decision 31): a commitment, a repeat, Counts Towards and a record stay on the panel.
      fields: ["task_id", "title", "description", "due_on", "priority", "cadence", "primary_assignee_id", "member_ids", "department_id", "project_id"],
      picks: { primary_assignee_id: "task_assignee", member_ids: "task_member", department_id: "department", project_id: "project" },
      names: (values, _actor, db) => (db ? service.cardNames(db, values) : []),
      records: theTask,
      check: (client, values, actor) => service.assertCardTasks(client, [values.task_id], actor.scope),
      // The same function Save Task calls: the setter's fields refused to the people sharing it, as on the panel (§6).
      run: (values, actor) => {
        const { task_id: id, ...changes } = values;
        return service.edit(actor, actor.scope, id, changes);
      },
      readback: taskLine("saved"),
      labels: { task_id: "Task", title: "Title", description: "Notes", due_on: "Due Day", priority: "Priority", cadence: "Cadence", primary_assignee_id: "For", member_ids: "Shared With", department_id: "Department", project_id: "Project" },
    },
    {
      key: "tasks.add_step",
      label: "Add Step",
      matrix: probe,
      description: "Add a step to a task I lead or set: the task, the step's words and its due day",
      input: c.tasks.TaskStepAdd,
      permission: ["workspace", "edit"],
      risk: "standard",
      form: "none: Add Step's form sits on the task's panel and never names the task; the card must",
      fields: ["task_id", "title", "due_on"],
      asks: [{ field: "title", question: "What is the step?" }],
      records: theTask,
      check: (client, values, actor) => service.assertCardTasks(client, [values.task_id], actor.scope),
      run: (values, actor) => service.addStep(actor, actor.scope, values.task_id, { title: values.title, due_on: values.due_on }),
      readback: (step) => [{ type: "task", id: step.task_id, label: step.title, status: "step added", link: taskLink(step.task_id) }],
      labels: { task_id: "Task", title: "Step", due_on: "Due Day" },
    },
    {
      key: "tasks.edit_step",
      label: "Save Step",
      matrix: probe,
      description: "Tick or untick a step of a task, or change its words or due day: the task and the step (its id, or its words)",
      input: c.tasks.TaskStepChange,
      permission: ["workspace", "edit"],
      risk: "standard",
      form: "none: a step is ticked, renamed or re-dated on the task's panel, which never names the task; the card must",
      fields: ["task_id", "task_step_id", "done", "title", "due_on"],
      // The step may be written by its words: matched among the steps of the card's own task (decision 32).
      resolve: { task_step_id: (value, actor, db, values) => service.stepIdOf(db, values.task_id, value, actor.scope) },
      names: (values, actor, db) => (db ? service.cardStep(db, values.task_id, values.task_step_id, actor.scope) : []),
      records: theTask,
      check: (client, values, actor) => service.assertCardStep(client, values.task_id, values.task_step_id, actor.scope),
      run: (values, actor) => {
        const { task_id: id, task_step_id: stepId, ...changes } = values;
        return service.editStep(actor, actor.scope, id, stepId, changes);
      },
      readback: (step) => [{ type: "task", id: step.task_id, label: step.title, status: step.done_at ? "ticked" : "saved", link: taskLink(step.task_id) }],
      labels: { task_id: "Task", task_step_id: "Step", done: "Done", title: "New Words", due_on: "Due Day" },
    },
    {
      key: "tasks.wait_on",
      label: "Add Link",
      matrix: probe,
      description: "Make a task wait on another task I can see, so it stays in To Do until that one is done",
      input: c.tasks.TaskWaitOn,
      permission: ["workspace", "edit"],
      risk: "standard",
      form: "none: Wait On Task's form sits on the task's panel and never names the task; the card must",
      fields: ["task_id", "depends_on_task_id"],
      picks: { depends_on_task_id: "task" },
      // The task it waits on is named, never counted: the press changes the first task alone.
      names: async (values, actor, db) => (db && values.depends_on_task_id ? (await service.cardRecords(db, [values.depends_on_task_id], actor.scope)).filter((r) => r.label) : []),
      records: theTask,
      check: (client, values, actor) => service.assertCardTasks(client, [values.task_id], actor.scope),
      // Never itself, never a loop, a task the person can see: addWaiting's own rules, on the field.
      run: (values, actor) => service.addWaiting(actor, actor.scope, values.task_id, { depends_on_task_id: values.depends_on_task_id }),
      readback: taskLine("waiting"),
      labels: { task_id: "Task", depends_on_task_id: "Waits On" },
    },
    {
      key: "late_reasons.add",
      label: "Add Reason",
      description: "Add a reason Why Late offers on an overdue task: its words",
      input: c.tasks.LateReasonCreate,
      permission: ["workspace", "edit"],
      // As the route: POST /tasks/late-reasons asks requireCapability("workspace.late_reasons").
      capability: reasons.CAPABILITY,
      risk: "standard",
      asks: [{ field: "label", question: "What is the reason?" }],
      run: (values, actor) => reasons.add(actor, values),
      readback: (row) => [{ type: "task_late_reason", id: row.task_late_reason_id, label: row.label, status: "added", link: null }],
      labels: { label: "Reason" },
    },
    {
      key: "late_reasons.switch",
      label: "Switch Reason",
      description: "Switch a reason Why Late offers off or on: the reason (its words) and on or off; a reason is never deleted",
      input: c.tasks.LateReasonSwitch,
      permission: ["workspace", "edit"],
      capability: reasons.CAPABILITY,
      risk: "standard",
      form: "none: a reason is switched off or on with its toggle on Late Reasons; the card names the reason",
      fields: ["task_late_reason_id", "active"],
      resolve: { task_late_reason_id: (value, _actor, db) => reasons.idOf(db, value) },
      records: (values, _actor, db) => (db ? reasons.cardRecords(db, values.task_late_reason_id) : []),
      run: (values, actor) => reasons.setActive(actor, values.task_late_reason_id, { active: values.active }),
      readback: (row) => [{ type: "task_late_reason", id: row.task_late_reason_id, label: row.label, status: row.active ? "switched on" : "switched off", link: null }],
      labels: { task_late_reason_id: "Reason", active: "On" },
    },
  ],
  // The panel's own forms, each reached through the card that names its task (gate 23, praxis-ai.md decision 33).
  not_offered: {
    TaskEdit: "via tasks.edit: Edit Task's own form, which never names its task; the card is TaskChange",
    TaskStepCreate: "via tasks.add_step: Add Step's own form, which never names its task; the card is TaskStepAdd",
    TaskStepEdit: "via tasks.edit_step: the panel's step, ticked or changed in place; the card is TaskStepChange",
    TaskCommentCreate: "via tasks.comment: the panel's own comment form, which never names its task; the card is TaskCommentAdd",
    TaskDependencyCreate: "via tasks.wait_on: Wait On Task's own form, which never names its task; the card is TaskWaitOn",
    LateReasonEdit: "via late_reasons.switch: Late Reasons' toggle, which never names its reason; the card is LateReasonSwitch",
  },
  summaries: [
    {
      key: "tasks.summary",
      description: "Task counts for me or my team: open, overdue, due today or this week, done, by status, assignee, priority, due window or cadence",
      params: c.tasks.TaskCountsQuery,
      permission: ["workspace", "view"],
      run: (client, params, actor) => service.aiCounts(client, params, actor.scope),
    },
  ],
  reads: [
    {
      key: "tasks.list",
      description: "List tasks: status, due date, priority, who it is for and who set it; mine or my team's, overdue, due today or this week",
      params: c.tasks.TaskListQuery,
      permission: ["workspace", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite: (row) => ({ type: "task", id: row.task_id, label: `${row.number} ${row.title}` }),
      matrix: probe,
    },
    {
      key: "tasks.get",
      description: "One task I can see, as its panel shows it: its steps (each with its id), what it waits on and holds up, its watchers and hold",
      params: c.common.IdParams,
      permission: ["workspace", "view"],
      run: (_client, params, actor) => service.getFor(params.id, actor.scope, actor),
      cite: (row) => ({ type: "task", id: row.task_id, label: `${row.number} ${row.title}` }),
    },
  ],
  routes: [
    { intent: "create a task", screen: "workspace.tasks", params: { new: "1" }, prefill: c.tasks.TaskPrefill },
    { intent: "set my commitments", screen: "workspace.tasks", params: { new: "1", commitment: "1" } },
    { intent: "see my tasks", screen: "workspace.tasks" },
  ],
});
