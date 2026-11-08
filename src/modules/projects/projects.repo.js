"use strict";
/**
 * Projects: the SQL (docs/guides/workspace.md §4, §6 Projects). Reads and writes `project`;
 * counts the tasks in a project the reader can see with the tasks repo's own audience, so a
 * project never shows a task its reader could not open on Tasks. Never emits.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const { scopeClause } = require("../../shared/rbac/scope");

/** The SQL for each field ProjectListQuery allow-lists. The first is the default order. */
const SORTS = {
  name: "p.name",
  due_on: "p.due_on",
  created_at: "p.created_at",
};

/**
 * The tasks of project `p` the reader may see, as a WHERE over task `t`: led by someone in their
 * scope, or set or shared by them (tasks.repo audience under `team`). Pushes what it names.
 */
function seen(scope, params) {
  params.push(scope.employee_id || null);
  const me = `$${params.length}::uuid`;
  const mine = `(t.set_by_employee_id = ${me} OR t.primary_assignee_id = ${me}
    OR EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.task_id AND ta.employee_id = ${me}))`;
  const s = scopeClause(scope, { column: "t.primary_assignee_id" }, params);
  return s.and ? `(${s.and.slice(4)} OR ${mine})` : `(true OR ${mine})`;
}

const COLUMNS = (who) => `p.project_id, p.number::text AS number, p.name, p.description,
         to_char(p.due_on, 'YYYY-MM-DD') AS due_on, p.status, p.completed_at, p.created_at,
         p.owner_employee_id, p.partner_id, p.lead_id, p.deal_id, ${personJson("oe", "od")} AS owner,
         (SELECT count(*)::int FROM task t
           WHERE t.project_id = p.project_id AND t.archived_at IS NULL
             AND t.status NOT IN ('done', 'cancelled') AND ${who}) AS open,
         (SELECT count(*)::int FROM task t
           WHERE t.project_id = p.project_id AND t.archived_at IS NULL
             AND t.status = 'done' AND ${who}) AS done`;

const FROM = `FROM project p
    LEFT JOIN employee oe ON oe.employee_id = p.owner_employee_id
    LEFT JOIN department od ON od.department_id = oe.department_id`;

/** One page of projects. */
function list(db, query, scope) {
  const params = [query.status || "active", query.q || null, query.partner_id || null, query.lead_id || null];
  const who = seen(scope, params);
  return pageQuery(
    db,
    `SELECT ${COLUMNS(who)}, ${TOTAL_COL}
       ${FROM}
      WHERE p.status = $1
        AND ($2::text IS NULL OR search_fold(p.name || ' ' || p.number::text) LIKE '%' || search_fold($2) || '%')
        AND ($3::uuid IS NULL OR p.partner_id = $3)
        AND ($4::uuid IS NULL OR p.lead_id = $4)
      ORDER BY ${orderBy(query, SORTS, "p.project_id")}`,
    params,
    query,
  );
}

/** One project, with its counts for the reader. */
async function get(db, id, scope) {
  const params = [id];
  const who = seen(scope, params);
  const { rows } = await db.query(`SELECT ${COLUMNS(who)} ${FROM} WHERE p.project_id = $1`, params);
  return rows[0] || null;
}

/** Lock a project's row for a change; its status, for a task joining it. */
async function lock(client, id) {
  const { rows } = await client.query(
    "SELECT project_id, number, name, status, owner_employee_id, budget_amount, partner_id, lead_id, deal_id FROM project WHERE project_id = $1 FOR UPDATE",
    [id],
  );
  return rows[0] || null;
}

async function statusOf(db, id) {
  const { rows } = await db.query("SELECT status FROM project WHERE project_id = $1", [id]);
  return rows[0] ? rows[0].status : null;
}

async function insert(client, row) {
  const { rows } = await client.query(
    `INSERT INTO project (number, name, description, due_on, owner_employee_id, created_by, status, partner_id, lead_id, deal_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9) RETURNING project_id`,
    [row.number, row.name, row.description, row.due_on, row.owner_employee_id, row.created_by, row.partner_id || null, row.lead_id || null, row.deal_id || null],
  );
  return rows[0].project_id;
}

const WRITABLE = ["name", "description", "due_on", "status", "completed_at", "budget_amount", "partner_id", "lead_id", "deal_id"];

async function update(client, id, changes) {
  const keys = Object.keys(changes).filter((k) => WRITABLE.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await client.query(`UPDATE project SET ${sets} WHERE project_id = $1`, [id, ...keys.map((k) => changes[k])]);
}

/** The partner, lead and deal a project is for (its tasks take them, workspace.md §6). */
async function linkOf(db, id) {
  const { rows } = await db.query("SELECT partner_id, lead_id, deal_id FROM project WHERE project_id = $1", [id]);
  return rows[0] || { partner_id: null, lead_id: null, deal_id: null };
}

/** The most recent active project connected to a deal, or null: where its deliverables go (partnerships.md §6.7). */
async function ofDeal(db, dealId) {
  const { rows } = await db.query(
    "SELECT project_id FROM project WHERE deal_id = $1 AND status = 'active' ORDER BY created_at DESC, project_id LIMIT 1",
    [dealId],
  );
  return rows[0] ? rows[0].project_id : null;
}

/** A lead's projects now its partner's, in the conversion's transaction. Returns the projects moved. */
async function relinkLead(client, leadId, partnerId) {
  const { rows } = await client.query("UPDATE project SET partner_id = $2, lead_id = NULL WHERE lead_id = $1 RETURNING project_id", [leadId, partnerId]);
  return rows.map((r) => r.project_id);
}

module.exports = { list, get, lock, statusOf, insert, update, linkOf, ofDeal, relinkLead };
