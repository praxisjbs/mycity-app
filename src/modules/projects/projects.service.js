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
 *   setBudget()        Expenses · Projects' Set Budget (docs/guides/expenses.md §6.6 rule 6): the
 *                      project's optional budget, by an `expenses.finance` holder, whoever owns it
 *   cardRecords(), assertCardProject()   the project a Praxis AI card changes, named, and the
 *                      card's re-check: its owner, or a grant that reaches everyone
 *                      (docs/guides/praxis-ai.md §6.11)
 *
 * A project gives nobody a task: the board on its page is the tasks list filtered by
 * `project_id`, under the reader's own audience. Every change emits one event, in its
 * transaction.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const repo = require("./projects.repo");
const { EVENTS } = require("./projects.events");

/** Connect to Partner: Partnerships decides what work may be linked to (workspace.md §6). */
const links = () => require("../partners/partners.work");

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
    partner_link: links().viewOf(row),
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
    const link = { partner_id: body.partner_id || null, lead_id: body.lead_id || null, deal_id: body.deal_id || null };
    await links().checkLink(client, actor, link);
    const { number } = await numbering.allocate(client, "project");
    const id = await repo.insert(client, {
      ...link,
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
    // Connect to Partner: only what changes, checked (workspace.md §6).
    const relinked = links().merged(locked, body);
    if (relinked.changed) {
      if (relinked.link.partner_id || relinked.link.lead_id) await links().checkLink(client, actor, relinked.link);
      Object.assign(changes, relinked.link);
    }
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

/**
 * Set Budget on Expenses · Projects: a project's optional budget, or none (null). The route has
 * checked `expenses.finance`, so it is not held to the project's owner as edit() is.
 * @param {object} actor
 * @param {string} id
 * @param {string|null} amount  two places, or null to take it away
 */
async function setBudget(actor, id, amount) {
  return tx(async (client) => {
    const locked = await repo.lock(client, id);
    if (!locked) throw notFound();
    const before = locked.budget_amount ?? null;
    if (before === amount) return;
    await repo.update(client, id, { budget_amount: amount });
    await emit(client, {
      key: EVENTS.PROJECT_BUDGET_SET,
      entity: { type: "project", id },
      actor,
      before: { budget_amount: before },
      after: { budget_amount: amount },
      payload: { project_id: id, number: locked.number, name: locked.name, budget_amount: amount },
    });
  });
}

/** The project a card changes, by number and name; one that does not exist keeps its id alone, and the check refuses it. */
async function cardRecords(db, id, scope) {
  if (!c.common.uuid.safeParse(id).success) return [];
  const row = await repo.get(db, id, scope);
  return [{ type: "project", id, label: row ? `${row.number} ${row.name}` : null }];
}

/** The card's re-check (§6.11 step 5): the project exists and the person may change it. */
async function assertCardProject(db, id, scope) {
  const row = c.common.uuid.safeParse(id).success ? await repo.get(db, id, scope) : null;
  if (!row) throw new AppError("NOT_FOUND", "That project does not exist", 404, { project_id: ["No such project"] });
  if (!mayEdit(scope, row)) throw new AppError("FORBIDDEN", "Only its owner can change this project", 403, { project_id: ["Not yours to change"] });
}

/** The partner, lead and deal a project is for: a task made in it takes them (workspace.md §6). */
const linkOf = (db, id) => repo.linkOf(db, id);

/** The most recent active project connected to a deal, or null (partnerships.md §6.7). */
const ofDeal = (db, dealId) => repo.ofDeal(db, dealId);

/**
 * A lead's projects now its partner's (workspace.md §6, partnerships.md §6.4): in the conversion's own
 * transaction, one event for them all. Returns how many moved.
 */
async function relinkIn(client, actor, { lead_id: leadId, partner_id: partnerId }) {
  const moved = await repo.relinkLead(client, leadId, partnerId);
  if (!moved.length) return 0;
  await emit(client, {
    key: EVENTS.PROJECT_RELINKED,
    entity: { type: "lead", id: leadId },
    actor,
    payload: { lead_id: leadId, partner_id: partnerId, count: moved.length },
  });
  return moved.length;
}

/** A task joins only an open project: 422 on `project_id` otherwise. */
async function assertOpen(db, id) {
  const status = await repo.statusOf(db, id);
  if (!status) throw invalid("project_id", "No such project");
  if (status !== "active") throw invalid("project_id", "Project is closed");
}

/* ------------------------------------------------------------------ *
 * The assistant's summary (docs/guides/praxis-ai.md §6.13, Workspace, Knowledge Hub, Community, Home and Settings)
 * ------------------------------------------------------------------ */

const STATUS_WORDS = Object.freeze({ active: "Active", completed: "Completed" });
const TASK_PARTS = Object.freeze([
  { key: "done", label: "Done" },
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue", optional: true },
]);

/**
 * Every project in figures, its tasks only those the reader could open on Tasks (§6 Projects): every
 * project unless a status is asked, by project stacked Done, Open and Overdue, by status. Runs on the
 * client the assistant hands over.
 * @param {{query: Function}} client
 * @param {object} params   ProjectSummaryQuery, parsed
 * @param {object} actor    the asking person with their `workspace` scope
 */
async function aiSummary(client, params, actor, now = new Date()) {
  const { figure, group, stacked } = require("../../shared/ai/summary");
  const lagos = require("../../shared/time/lagos");
  const r = await repo.aiSummary(client, params, actor.scope, { now, today: lagos.today(now) });
  const p = r.projects;
  const t = r.tasks;
  const counted = new Map(r.by_status.map((x) => [x.key, x.value]));
  const groups = [
    group("project", "Tasks by project", stacked(r.by_project, TASK_PARTS)),
    group("status", "Projects by status", Object.keys(STATUS_WORDS).filter((k) => counted.has(k)).map((k) => ({ key: k, label: STATUS_WORDS[k], value: counted.get(k) }))),
  ];
  if (params.by === "status") groups.reverse();
  return {
    figures: [
      figure("projects", "Projects", p.projects || 0),
      figure("active", "Active", p.active || 0),
      figure("completed", "Completed", p.completed || 0),
      figure("past_due", "Active past their due day", p.past_due || 0),
      figure("tasks", "Tasks", t.tasks || 0),
      figure("open", "Tasks open", t.open || 0),
      figure("done", "Tasks done", t.done || 0),
      figure("overdue", "Tasks overdue", t.overdue || 0),
    ],
    groups,
    series: [],
    total: p.projects || 0,
  };
}

module.exports = { list, getFor, create, edit, setBudget, assertOpen, toProject, cardRecords, assertCardProject, linkOf, ofDeal, relinkIn, aiSummary };
