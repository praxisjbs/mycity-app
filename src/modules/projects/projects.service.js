"use strict";
/**
 * Projects (docs/guides/workspace.md §3 step 14, §6 Projects): work that belongs together,
 * on a board of its own.
 *
 *   list(), getFor()   every project, with the open and done tasks in it the reader can see
 *   create()           anyone with `workspace` create; the caller owns it
 *   edit()             its owner, or a reader whose grant is `all`: words, due day, and
 *                      `status` (completed completes it, active reopens it)
 *   assertOpen()       what the tasks service asks before a task joins a project
 *
 * A project gives nobody a task: the board on its page is the tasks list filtered by
 * `project_id`, under the reader's own audience. Every change emits one event, in its
 * transaction.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const repo = require("./projects.repo");
const { EVENTS } = require("./projects.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);
const notFound = () => new AppError("NOT_FOUND", "That project does not exist", 404);
const invalid = (field, message) => new AppError("VALIDATION_FAILED", message, 422, { [field]: [message] });

/** May the reader change it: its owner, or a grant that reaches everyone. */
const mayEdit = (scope, row) => scope.scope === "all" || (Boolean(scope.employee_id) && row.owner_employee_id === scope.employee_id);

/** A repo row as the contract's Project. */
function toProject(row, scope) {
  return {
    project_id: row.project_id,
    number: row.number || "",
    name: row.name,
    description: row.description ?? null,
    owner: row.owner || null,
    due_on: row.due_on || null,
    status: row.status,
    completed_at: iso(row.completed_at),
    open: row.open || 0,
    done: row.done || 0,
    can_edit: mayEdit(scope, row),
    created_at: iso(row.created_at),
  };
}

async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  return { ...page, data: page.data.map((r) => toProject(r, scope)) };
}

async function getFor(id, scope, db = pool) {
  const row = await repo.get(db, id, scope);
  if (!row) throw notFound();
  return toProject(row, scope);
}

async function create(actor, scope, body) {
  if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee can start a project", 403);
  return tx(async (client) => {
    const { number } = await numbering.allocate(client, "project");
    const id = await repo.insert(client, {
      number,
      name: body.name,
      description: body.description || null,
      due_on: body.due_on || null,
      owner_employee_id: actor.employee_id,
      created_by: actor.user_id,
    });
    const after = await getFor(id, scope, client);
    await emit(client, {
      key: EVENTS.PROJECT_CREATED,
      entity: { type: "project", id },
      actor,
      after,
      payload: { project_id: id, number, name: body.name },
    });
    return after;
  });
}

async function edit(actor, scope, id, body) {
  return tx(async (client) => {
    const locked = await repo.lock(client, id);
    if (!locked) throw notFound();
    if (!mayEdit(scope, locked)) throw new AppError("FORBIDDEN", "Only its owner can change this project", 403);
    const before = await getFor(id, scope, client);
    const changes = {};
    for (const k of ["name", "due_on"]) if (k in body) changes[k] = body[k];
    if ("description" in body) changes.description = body.description || null;
    let key = EVENTS.PROJECT_EDITED;
    if (body.status && body.status !== locked.status) {
      changes.status = body.status;
      changes.completed_at = body.status === "completed" ? new Date() : null;
      key = body.status === "completed" ? EVENTS.PROJECT_COMPLETED : EVENTS.PROJECT_REOPENED;
    }
    if (!Object.keys(changes).length) return before;
    await repo.update(client, id, changes);
    const after = await getFor(id, scope, client);
    await emit(client, {
      key,
      entity: { type: "project", id },
      actor,
      before,
      after,
      payload: { project_id: id, number: after.number, name: after.name, status: after.status },
    });
    return after;
  });
}

/** A task joins only an open project: 422 on `project_id` otherwise. */
async function assertOpen(db, id) {
  const status = await repo.statusOf(db, id);
  if (!status) throw invalid("project_id", "No such project");
  if (status !== "active") throw invalid("project_id", "Project is closed");
}

module.exports = { list, getFor, create, edit, assertOpen, toProject };
