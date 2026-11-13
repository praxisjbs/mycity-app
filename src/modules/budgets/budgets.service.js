"use strict";
/**
 * Budgets: the one write path for a department's budget for a year and its lines by category, and
 * Expenses · Projects' Set Budget through the projects service (docs/guides/expenses.md §3 step 7,
 * §6.6).
 *
 *   list(), get()       the budgets within the caller's `expenses` scope (on the department's head)
 *   create()            New Budget: one per department per year, numbered `budget`, set by an
 *                       `expenses.finance` holder, and in force from the moment it is saved
 *   update()            Edit Budget: the lines again, whole; each line it changed is in its event
 *   history()           Budget History: those changes, from the audit ledger, 25 a page
 *   projects()          Expenses · Projects: each project's budget, committed, spent, remaining
 *   setProjectBudget()  Set Budget: `project.budget_amount`, written by the projects service
 *   recountIn()         committed and spent on lines, worked out again from their requests, in the
 *                       transaction that moved a request (called by the expenses service)
 *   warnThresholds()    the daily budget-threshold sweep: a line 90% used tells the department's
 *                       head and Operations & People, once
 *
 * A budget saved counts the requests already sent in its year, department and categories (the
 * expenses service attaches them), and every request still deciding on its lines is flagged Over
 * Budget again against what the lines now hold.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const m = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const routeMap = require("../../shared/route-map");
const projectsService = require("../projects/projects.service");
const repo = require("./budgets.repo");
const { EVENTS } = require("./budgets.events");

/** A line is warned about once it is this share used, committed and spent (guide §6.6 rule 7). */
const THRESHOLD_PERCENT = "90";
const SWEEP_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Required when it runs: the expenses service requires this file for its recount. */
const expenses = () => require("../expenses/expenses.service");

const notFound = () => new AppError("NOT_FOUND", "That budget does not exist", 404, { budget_id: ["No such budget"] });
const invalid = (code, message, fields) => new AppError(code, message, 422, fields);

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** A repo row and its lines as the contract's Budget. */
function toBudget(row, lines) {
  return {
    budget_id: row.budget_id,
    number: row.number,
    name: row.name,
    department_id: row.department_id,
    department: row.department,
    owner: row.owner,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    status: row.status,
    allocated: row.allocated,
    committed: row.committed,
    spent: row.spent,
    remaining: row.remaining,
    lines: lines.map((l) => ({
      budget_line_id: l.budget_line_id,
      expense_category_id: l.expense_category_id,
      category: l.category,
      amount: l.amount,
      committed_amount: l.committed_amount,
      spent_amount: l.spent_amount,
      remaining: l.remaining,
    })),
    approved_at: row.approved_at instanceof Date ? row.approved_at.toISOString() : row.approved_at || null,
  };
}

const inScope = (scope, row) => scope.scope === "all" || (scope.scope_ids || []).includes(row.owner_id);

async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  const lines = await repo.linesOf(pool, page.data.map((r) => r.budget_id));
  return { ...page, data: page.data.map((r) => toBudget(r, lines.filter((l) => l.budget_id === r.budget_id))) };
}

async function get(id, scope, db = pool) {
  const row = await repo.get(db, id);
  if (!row || !inScope(scope, row)) throw notFound();
  return toBudget(row, await repo.linesOf(db, [id]));
}

async function history(id, scope, query) {
  const row = await repo.get(pool, id);
  if (!row || !inScope(scope, row)) throw notFound();
  return repo.history(pool, id, query);
}

/* ------------------------------------------------------------------ *
 * Setting and changing
 * ------------------------------------------------------------------ */

/** The lines as the form sends them, checked: each category once, each one that exists. */
async function linesOf(db, lines) {
  const ids = lines.map((l) => l.expense_category_id);
  if (new Set(ids).size !== ids.length) throw invalid("CATEGORY_TWICE", "Each category once", { lines: ["Each category once"] });
  const found = await repo.categories(db, ids);
  if (found.length !== ids.length) throw invalid("CATEGORY_UNKNOWN", "Pick a category from the list", { lines: ["Not a category"] });
  const names = new Map(found.map((c) => [c.expense_category_id, c.name]));
  for (const l of lines)
    if (m.isNegative(l.amount)) throw invalid("AMOUNT_NEGATIVE", "An amount is 0 or more", { lines: ["0 or more"] });
  return lines.map((l) => ({ expense_category_id: l.expense_category_id, category: names.get(l.expense_category_id), amount: m.toWire(l.amount) }));
}

/** After a save: the requests already sent count, the lines are recounted, the flags redone. */
async function settleLinesIn(client, budgetId) {
  await expenses().attachToBudgetIn(client, budgetId);
  const ids = await repo.lineIdsOf(client, budgetId);
  await repo.recount(client, ids);
  await expenses().refreshOverBudgetIn(client, ids);
}

/** New Budget: a department's year, by category. */
async function create(actor, body) {
  const id = await tx(async (client) => {
    const department = await repo.department(client, body.department_id);
    if (!department || department.active === false)
      throw invalid("DEPARTMENT_UNKNOWN", "Pick a department from the list", { department_id: ["Not a department"] });
    if (await repo.forDepartmentYear(client, body.department_id, body.year))
      throw new AppError("BUDGET_EXISTS", `${department.name} already has a ${body.year} budget`, 409, { year: ["Already set"] });
    const lines = await linesOf(client, body.lines);
    const startsOn = `${body.year}-01-01`;
    const { number } = await numbering.allocate(client, "budget", { date: startsOn });
    const budgetId = await repo.insertOnce(client, {
      number,
      name: `${department.name} ${body.year}`,
      department_id: department.department_id,
      owner_id: department.head_employee_id || null,
      starts_on: startsOn,
      ends_on: `${body.year}-12-31`,
      approved_by: actor.user_id || null,
    });
    if (!budgetId) throw new AppError("BUDGET_EXISTS", `${department.name} already has a ${body.year} budget`, 409, { year: ["Already set"] });
    for (const l of lines) await repo.insertLine(client, budgetId, l.expense_category_id, l.amount);
    await settleLinesIn(client, budgetId);
    await emit(client, {
      key: EVENTS.BUDGET_SET,
      entity: { type: "budget", id: budgetId },
      actor,
      after: { department_id: department.department_id, year: body.year, lines: lines.map((l) => ({ expense_category_id: l.expense_category_id, amount: l.amount })) },
      payload: { budget_id: budgetId, number, name: `${department.name} ${body.year}`, department_id: department.department_id },
      metadata: { changes: lines.map((l) => ({ category: l.category, before: null, after: l.amount })) },
    });
    return budgetId;
  });
  return get(id, { scope: "all", scope_ids: null });
}

/**
 * Edit Budget: the lines again, whole. A line left out is taken away, unless requests count
 * against it (it is then set to 0 instead: a request's line is never lost).
 */
async function update(actor, id, body) {
  await tx(async (client) => {
    const budget = await repo.lock(client, id);
    if (!budget) throw notFound();
    if (budget.status === "closed") throw new AppError("BUDGET_CLOSED", "This budget is closed", 409);
    const lines = await linesOf(client, body.lines);
    const stored = await repo.lockLines(client, id);
    const names = new Map((await repo.categories(client, stored.map((l) => l.expense_category_id))).map((c) => [c.expense_category_id, c.name]));
    const changes = [];
    for (const l of lines) {
      const was = stored.find((s) => s.expense_category_id === l.expense_category_id);
      if (!was) {
        await repo.insertLine(client, id, l.expense_category_id, l.amount);
        changes.push({ category: l.category, before: null, after: l.amount });
      } else if (m.compare(was.amount, l.amount) !== 0) {
        await repo.setLineAmount(client, was.budget_line_id, l.amount);
        changes.push({ category: l.category, before: m.toWire(was.amount), after: l.amount });
      }
    }
    for (const was of stored) {
      if (lines.some((l) => l.expense_category_id === was.expense_category_id)) continue;
      const gone = !(await repo.lineCounted(client, was.budget_line_id));
      if (gone) {
        // A request that no longer counts (rejected, cancelled, sent back) lets go of it first.
        await expenses().detachLineIn(client, was.budget_line_id);
        await repo.deleteLine(client, was.budget_line_id);
      } else await repo.setLineAmount(client, was.budget_line_id, "0.00");
      if (gone || m.compare(was.amount, "0.00") !== 0)
        changes.push({ category: names.get(was.expense_category_id) || null, before: m.toWire(was.amount), after: gone ? null : "0.00" });
    }
    if (!changes.length) return;
    await repo.touch(client, id);
    await settleLinesIn(client, id);
    await emit(client, {
      key: EVENTS.BUDGET_CHANGED,
      entity: { type: "budget", id },
      actor,
      before: { lines: stored.map((l) => ({ expense_category_id: l.expense_category_id, amount: m.toWire(l.amount) })) },
      after: { lines: lines.map((l) => ({ expense_category_id: l.expense_category_id, amount: l.amount })) },
      payload: {
        budget_id: id,
        number: budget.number,
        name: budget.name,
        changed: changes.length,
        head_user_id: await repo.userOf(client, (await repo.department(client, budget.department_id))?.head_employee_id || budget.owner_id),
      },
      metadata: { changes },
    });
  });
  return get(id, { scope: "all", scope_ids: null });
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

const allScope = (scope) => {
  if (scope.scope !== "all") throw new AppError("FORBIDDEN", "Projects' spend is read across the company", 403);
};

async function projects(query, scope) {
  allScope(scope);
  return repo.projects(pool, query);
}

/* ------------------------------------------------------------------ *
 * The assistant's summary (docs/guides/praxis-ai.md §6.13, Finance: Budgets; §6.19 item 2)
 * ------------------------------------------------------------------ */

/**
 * A row's parts for a stacked bar, as Decimals so nothing drifts: what was spent and committed within
 * the allocation, what remains, and what went past it (Over Budget). The parts sum to the allocation,
 * or to what was used when that is more; none is below zero.
 */
function stackOf(row, withOver) {
  const { part } = require("../../shared/ai/summary");
  const allocated = m.money(row.allocated || "0.00");
  const spent = m.money(row.spent || "0.00");
  const committed = m.money(row.committed || "0.00");
  const spentIn = m.Decimal.min(spent, allocated);
  const committedIn = m.Decimal.min(committed, allocated.minus(spentIn));
  const remaining = allocated.minus(spentIn).minus(committedIn);
  const over = m.Decimal.max(m.ZERO, spent.plus(committed).minus(allocated));
  const parts = [part("spent", "Spent", m.toWire(spentIn)), part("committed", "Committed", m.toWire(committedIn)), part("remaining", "Remaining", m.toWire(remaining))];
  if (withOver) parts.push(part("over", "Over Budget", m.toWire(over)));
  return { key: row.key, label: row.label, value: m.toWire(allocated.plus(over)), count: null, parts };
}

/** Whether a row used more than its allocation. */
const wentOver = (r) => m.compare(m.money(r.spent || "0.00").plus(m.money(r.committed || "0.00")), m.money(r.allocated || "0.00")) > 0;

/** One grouping of budget rows as stacked bars; Over Budget is a part only when a row went past. */
function stackedGroup(by, label, rows) {
  const { group } = require("../../shared/ai/summary");
  const withOver = rows.some(wentOver);
  return group(by, label, rows.map((r) => stackOf(r, withOver)));
}

/**
 * A year's budgets in figures (this Lagos year unless asked), within the reader's `expenses` scope:
 * the totals, by department and by category always, by project for a reader whose scope is all and
 * asked for it, and what was paid by month as a series.
 */
async function aiSummary(client, params, scope, now = new Date()) {
  const { figure, series } = require("../../shared/ai/summary");
  const year = params.year || Number(lagos.today(now).slice(0, 4));
  const byProject = params.by === "project" && scope.scope === "all";
  const r = await repo.aiSummary(client, { year, department_id: params.department_id, projects: byProject }, scope);
  const f = r.figures;
  const allocated = m.money(f.allocated || "0.00");
  const used = m.money(f.committed || "0.00").plus(m.money(f.spent || "0.00"));
  const usedShare = m.isZero(allocated) ? 0 : used.times(100).dividedBy(allocated).toDecimalPlaces(0).toNumber();
  const groups = [stackedGroup("department", "Budget by department", r.by_department), stackedGroup("category", "Budget by category", r.by_category)];
  if (byProject) groups.push(stackedGroup("project", "Budget by project", r.by_project));
  return {
    figures: [
      figure("allocated", "Allocated", m.toWire(allocated), "ngn"),
      figure("committed", "Committed", m.toWire(f.committed || "0.00"), "ngn"),
      figure("spent", "Spent", m.toWire(f.spent || "0.00"), "ngn"),
      figure("remaining", "Remaining", m.toWire(allocated.minus(used)), "ngn"),
      figure("used", "Used", usedShare, "percent"),
      figure("budgets", "Budgets", f.budgets || 0),
      figure("lines_over", "Lines over budget", f.lines_over || 0),
      figure("lines_past_80", "Lines at 80% or more", f.lines_past_80 || 0),
    ],
    groups,
    series: [series("spent", `Paid by month, ${year}`, r.paid.map((p) => ({ at: p.at, value: m.toWire(p.value) })))],
    total: f.budgets || 0,
  };
}

/** Set Budget on Expenses · Projects: through the projects service, which owns the table. */
async function setProjectBudget(actor, scope, id, body) {
  allScope(scope);
  const amount = body.budget_amount === null ? null : m.toWire(body.budget_amount);
  if (amount !== null && m.isNegative(amount)) throw invalid("AMOUNT_NEGATIVE", "An amount is 0 or more", { budget_amount: ["0 or more"] });
  await projectsService.setBudget(actor, id, amount);
  const row = await repo.project(pool, id);
  if (!row) throw new AppError("NOT_FOUND", "That project does not exist", 404, { project_id: ["No such project"] });
  return row;
}

/* ------------------------------------------------------------------ *
 * The recount and the threshold sweep
 * ------------------------------------------------------------------ */

/** Committed and spent on these lines, from their requests, in the caller's transaction. */
const recountIn = (client, lineIds) => repo.recount(client, lineIds);

/**
 * The budget-threshold sweep (daily, 07:00 Lagos): every line of a budget running today that is
 * 90% used, committed and spent, and not warned about before, tells the department's head and
 * Operations & People. One event per line, so a line is told once whatever the sweep's retries.
 * @param {string} [today]  a Lagos day, YYYY-MM-DD
 */
async function warnThresholds(today = lagos.today()) {
  let after = null;
  let warned = 0;
  for (;;) {
    const batch = await repo.linesPast(pool, { today, percent: THRESHOLD_PERCENT, after, size: SWEEP_BATCH, warnedKey: EVENTS.BUDGET_LINE_THRESHOLD_REACHED });
    for (const line of batch) {
      const userIds = await repo.warnedUsers(pool, line.head_employee_id);
      await tx((client) =>
        emit(client, {
          key: EVENTS.BUDGET_LINE_THRESHOLD_REACHED,
          entity: { type: "budget", id: line.budget_id },
          actor: null,
          payload: {
            budget_id: line.budget_id,
            budget_line_id: line.budget_line_id,
            number: line.number,
            name: line.name,
            category: line.category,
            used: line.used,
            amount: line.amount,
            used_amount: m.toWire(m.sum([line.committed_amount, line.spent_amount])),
            user_ids: userIds,
          },
          dedup_key: `budget.line_threshold_reached:${line.budget_line_id}`,
        }),
      );
      warned += 1;
    }
    if (batch.length < SWEEP_BATCH) break;
    after = batch[batch.length - 1].budget_line_id;
  }
  return { warned };
}

/* ------------------------------------------------------------------ *
 * Praxis AI's cards (docs/guides/praxis-ai.md §6.11): New Budget, Edit Budget and Set Budget,
 * each through the function its form's own button calls. Nothing here writes.
 * ------------------------------------------------------------------ */

const budgetLink = (id) => (routeMap.linkFor("budget", id) || {}).path || null;

const readback = (status) => (b) => [{ type: "budget", id: b.budget_id, label: `${b.number}, ${b.name}`, status, link: budgetLink(b.budget_id) }];

const projectReadback = (p) => [{ type: "project", id: p.project_id, label: `${p.number} ${p.name}`.trim(), status: p.budget_amount === null ? "budget taken away" : "budget set", link: routeMap.screenPath("expenses", "budgets") }];

/** The budget a card names, by number and name. */
async function cardBudget(db, id) {
  const row = db && UUID.test(String(id || "")) ? await repo.get(db, id) : null;
  return row ? [{ type: "budget", id, label: `${row.number}, ${row.name}` }] : [];
}

/** Edit Budget's re-check: the budget exists and is not closed. */
async function assertCardBudget(db, id) {
  const row = UUID.test(String(id || "")) ? await repo.get(db, id) : null;
  if (!row) throw notFound();
  if (row.status === "closed") throw new AppError("BUDGET_CLOSED", "This budget is closed", 409, { budget_id: ["Closed"] });
}

/** The department and categories a New Budget or Edit Budget card holds, by name. */
async function cardNames(db, values) {
  if (!db) return [];
  const out = [];
  if (UUID.test(String(values.department_id || ""))) {
    const d = await repo.department(db, values.department_id);
    if (d) out.push({ type: "department", id: d.department_id, label: d.name });
  }
  const ids = (values.lines || []).map((l) => l && l.expense_category_id).filter((v) => UUID.test(String(v || "")));
  if (ids.length) for (const c of await repo.categories(db, ids)) out.push({ type: "expense_category", id: c.expense_category_id, label: c.name });
  return out;
}

const names = (db) => repo.names(db);
const idOf = (db, value) => (UUID.test(String(value || "")) ? value : repo.idOf(db, value));

module.exports = {
  THRESHOLD_PERCENT,
  list,
  get,
  history,
  create,
  update,
  projects,
  setProjectBudget,
  aiSummary,
  recountIn,
  warnThresholds,
  readback,
  projectReadback,
  cardBudget,
  assertCardBudget,
  cardNames,
  names,
  idOf,
};
