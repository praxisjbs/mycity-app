"use strict";
/**
 * What the tasks module records, and who it tells (docs/guides/workspace.md §7).
 *
 * Every change to a task is one event. The person who did it is never told (fanout);
 * the people a task concerns are its assignee and the person who set it, so a task a
 * manager set tells the assignee when it is set or cancelled, and tells the manager
 * when it is done or blocked. A task someone set for themselves tells nobody.
 *
 * Done and reopened tasks that count towards a KPI are recounted by the performance
 * module, which registers its own outbox handler on TASK_COMPLETED and TASK_REOPENED
 * (src/modules/targets/targets.events.js).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");

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
});

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

/** Someone else set it: the assignee hears. */
const assigneeWhenSetByOther = (e, client) =>
  e.payload.set_by_employee_id && e.payload.set_by_employee_id !== e.payload.primary_assignee_id
    ? loginsOf(client, [e.payload.primary_assignee_id])
    : [];

/** Someone else set it: the setter hears. */
const setterWhenOther = (e, client) =>
  e.payload.set_by_employee_id && e.payload.set_by_employee_id !== e.payload.primary_assignee_id
    ? loginsOf(client, [e.payload.set_by_employee_id])
    : [];

const both = (e, client) =>
  loginsOf(client, [e.payload.primary_assignee_id, e.payload.set_by_employee_id]);

defineNotification(EVENTS.TASK_CREATED, {
  to: [{ users: assigneeWhenSetByOther }],
  title: (e) => `${e.payload.set_by_name || "Your manager"} set you a task`,
  body: (e) => `${e.payload.number}: ${e.payload.title}`,
});

defineNotification(EVENTS.TASK_COMPLETED, {
  to: [{ users: setterWhenOther }],
  title: (e) => `${e.payload.assignee_name || "A task"} is done`,
  body: (e) => `${e.payload.number}: ${e.payload.title}`,
});

defineNotification(EVENTS.TASK_BLOCKED, {
  to: [{ users: both }],
  title: (e) => `Blocked: ${e.payload.title}`,
  body: (e) => e.payload.blocked_reason || "",
});

defineNotification(EVENTS.TASK_CANCELLED, {
  to: [{ users: both }],
  title: (e) => `Cancelled: ${e.payload.title}`,
  body: (e) => e.payload.cancel_reason || "",
});

defineNotification(EVENTS.TASK_COMMENTED, {
  to: [{ users: both }],
  title: (e) => `New comment on ${e.payload.number}`,
  body: (e) => e.payload.excerpt || "",
});

defineNotification(EVENTS.TASK_DUE_SOON, {
  to: [{ users: (e, client) => loginsOf(client, [e.payload.primary_assignee_id]) }],
  title: (e) => (e.payload.when === "today" ? "Due today" : "Due tomorrow"),
  body: (e) => `${e.payload.number}: ${e.payload.title}`,
  include_actor: true,
});

module.exports = { EVENTS, loginsOf };
