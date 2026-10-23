"use strict";
/**
 * What the tasks module records, and who it tells (docs/guides/workspace.md §7).
 *
 * Every change to a task is one event. The person who did it is never told (fanout);
 * the people a task concerns are its assignee and the person who set it, so a task a
 * manager set tells the assignee when it is set or cancelled, and tells the manager
 * when it is done or blocked. A task someone set for themselves tells nobody. The people
 * sharing a task (member_employee_ids) hear what its assignee, the lead, hears, and when
 * it is done; someone put on a task by an edit is told so.
 *
 * Watchers hear when the task is done, blocked, cancelled or commented on; the assignees of
 * tasks waiting on it hear when it is done; a ping goes to whoever it names; a reminder set on
 * a task comes back to its assignee through the shared reminder engine.
 *
 * Done and reopened tasks that count towards a KPI are recounted by the performance
 * module, which registers its own outbox handler on TASK_COMPLETED and TASK_REOPENED
 * (src/modules/targets/targets.events.js).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const reminders = require("../notifications/notifications.reminders");

const EVENTS = defineEvents("workspace", {
  "task.created": { summary: "A task was created" },
  "task.edited": { summary: "A task was changed" },
  "task.status_changed": { summary: "A task moved on the board" },
  "task.completed": { summary: "A task was done" },
  "task.reopened": { summary: "A done task was moved back" },
  "task.blocked": { summary: "A task was marked blocked" },
  "task.unblocked": { summary: "A task's blocker was cleared" },
  "task.cancelled": { summary: "A task was cancelled" },
  "task.commented": { summary: "Someone commented on a task" },
  "task.due_soon": { summary: "A task is due today or tomorrow" },
  "task.step_changed": { summary: "A task's steps changed" },
  "task.waiting_changed": { summary: "What a task waits on changed" },
  "task.watchers_changed": { summary: "Someone started or stopped watching a task" },
  "task.pinged": { summary: "Someone nudged the people on a task" },
  "task.reminder_due": { summary: "A reminder set on a task came due" },
});

/** The reminder engine's key for the reminders a person sets on a task (up to three). */
const REMINDER_KEY = "task_reminder";

/** The user ids of the employees named, who have a login. */
async function loginsOf(client, employeeIds) {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE employee_id = ANY($1::uuid[]) AND status = 'active'",
    [ids],
  );
  return rows.map((r) => r.user_id);
}

/** The people sharing the task beside its lead. */
const membersOf = (e) => e.payload.member_employee_ids || [];

/** Someone else set it: the assignee hears; and the people sharing it, whoever set it. */
const assigneeWhenSetByOther = (e, client) =>
  loginsOf(client, [
    ...(e.payload.set_by_employee_id && e.payload.set_by_employee_id !== e.payload.primary_assignee_id
      ? [e.payload.primary_assignee_id]
      : []),
    ...membersOf(e),
  ]);

/** A shared task: everyone on it (fanout leaves out whoever did it). */
const everyoneOnShared = (e, client) =>
  membersOf(e).length ? loginsOf(client, [e.payload.primary_assignee_id, ...membersOf(e)]) : [];

/** Someone else set it: the setter hears. */
const setterWhenOther = (e, client) =>
  e.payload.set_by_employee_id && e.payload.set_by_employee_id !== e.payload.primary_assignee_id
    ? loginsOf(client, [e.payload.set_by_employee_id])
    : [];

const both = (e, client) =>
  loginsOf(client, [e.payload.primary_assignee_id, e.payload.set_by_employee_id, ...membersOf(e)]);

/** The people watching the task. */
async function watchersOf(e, client) {
  const { rows } = await client.query("SELECT employee_id FROM task_watcher WHERE task_id = $1", [e.payload.task_id]);
  return loginsOf(client, rows.map((r) => r.employee_id));
}

/** The assignees of open tasks that wait on this one: it being done may let them start. */
async function waitingOnIt(e, client) {
  const { rows } = await client.query(
    `SELECT t.primary_assignee_id FROM task_dependency dp JOIN task t ON t.task_id = dp.task_id
      WHERE dp.depends_on_task_id = $1 AND t.status NOT IN ('done', 'cancelled')`,
    [e.payload.task_id],
  );
  return loginsOf(client, rows.map((r) => r.primary_assignee_id));
}

defineNotification(EVENTS.TASK_CREATED, {
  to: [{ users: assigneeWhenSetByOther }],
  title: (e) =>
    membersOf(e).length
      ? `${e.payload.set_by_name || "Someone"} shared a task with you`
      : `${e.payload.set_by_name || "Your manager"} set you a task`,
  body: (e) => `${e.payload.number}: ${e.payload.title}`,
});

defineNotification(EVENTS.TASK_COMPLETED, {
  to: [{ users: setterWhenOther }, { users: everyoneOnShared }, { users: watchersOf }, { users: waitingOnIt }],
  title: (e) => `${e.payload.assignee_name || "A task"} is done`,
  body: (e) => `${e.payload.number}: ${e.payload.title}`,
});

defineNotification(EVENTS.TASK_BLOCKED, {
  to: [{ users: both }, { users: watchersOf }],
  title: (e) => `Blocked: ${e.payload.title}`,
  body: (e) => e.payload.blocked_reason || "",
});

defineNotification(EVENTS.TASK_CANCELLED, {
  to: [{ users: both }, { users: watchersOf }],
  title: (e) => `Cancelled: ${e.payload.title}`,
  body: (e) => e.payload.cancel_reason || "",
});

defineNotification(EVENTS.TASK_COMMENTED, {
  to: [{ users: both }, { users: watchersOf }],
  title: (e) => `New comment on ${e.payload.number}`,
  body: (e) => e.payload.excerpt || "",
});

defineNotification(EVENTS.TASK_DUE_SOON, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.primary_assignee_id]) }],
  title: (e) => (e.payload.when === "today" ? "Due today" : "Due tomorrow"),
  body: (e) => `${e.payload.number}: ${e.payload.title}`,
  include_actor: true,
});

defineNotification(EVENTS.TASK_PINGED, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.ping_employee_ids || []) }],
  title: (e) => `${e.payload.sender_name || "Someone"} nudged you on ${e.payload.number}`,
  body: (e) => e.payload.message || e.payload.title,
});

defineNotification(EVENTS.TASK_WATCHERS_CHANGED, {
  to: [
    {
      users: (e, client) =>
        e.payload.change === "watcher_added" ? loginsOf(client, [e.payload.watcher_employee_id]) : [],
    },
  ],
  title: (e) => `You are watching ${e.payload.number}`,
  body: (e) => e.payload.title,
});

defineNotification(EVENTS.TASK_EDITED, {
  to: [{ users: (e, client) => loginsOf(client, e.payload.added_employee_ids || []) }],
  title: (e) => `${e.payload.editor_name || "Someone"} put you on a task`,
  body: (e) => `${e.payload.number}: ${e.payload.title}`,
});

defineNotification(EVENTS.TASK_REMINDER_DUE, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.primary_assignee_id, ...membersOf(e)]) }],
  title: (e) => `Reminder: ${e.payload.title}`,
  body: (e) => e.payload.number,
  include_actor: true,
});

/*
 * A reminder a person set on a task. It fires only while the task is open; the service is
 * required when the engine calls it, since it requires this file for its keys.
 */
reminders.defineReminder(REMINDER_KEY, {
  event: EVENTS.TASK_REMINDER_DUE,
  module: "workspace",
  check: (client, row) => require("./tasks.service").reminderCheck(client, row),
});

module.exports = { EVENTS, REMINDER_KEY, loginsOf };
