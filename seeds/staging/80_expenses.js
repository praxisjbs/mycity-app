"use strict";
/**
 * Staging demonstration data: Expenses & Budget Control (M8; docs/guides/expenses.md §3, F13).
 *
 * Everything goes through the modules' own services, as the screens would, in the three steps
 * lib/home-staging-rows.js asks of the milestone that builds a table Home seeded first:
 *
 *   1. Home's demonstration requests, budgets and budget lines, and the alerts Home raised about
 *      them, are taken away (removeHomeStagingRows) before anything is written;
 *   2. lib/forward-rows.js writes none of them any more (their ids stay in the manifest);
 *   3. Home's seed tests read these rows instead.
 *
 * Then 8099's five categories go where nothing names them any more (the reference seed 8101 left
 * them while Home's rows did), and:
 *
 *   categories    the twelve suggested ones, Add Suggested Categories pressed by Operations &
 *                 People, only while there are none (A26: MyCity's own afterwards)
 *   budgets       this year's, for three departments by category (A25: examples on staging)
 *   projects      two Workspace projects, each with a budget on Expenses · Projects
 *   requests      raised by the Implementation Team's own accounts (staging sends real mail, so a
 *                 notice about a request reaches only them and the people who decide it, TB,
 *                 27/10/2026), modelled on MyCity's expenditure sheet (activations, Dedicated Task
 *                 Team pay, printing, data, transport; never its rows or amounts, decision 11), and
 *                 walked as the people would: waiting on the line manager, on Operations & People,
 *                 approved, in a requisition with the CEO, authorised, paid with and without the
 *                 bank's reference, sent back, rejected, and a draft
 *
 * Every decision is the approval's own (workflow.service decide), as the Approve, Send Back and
 * Reject buttons make it; the outcome each one copies onto the request after commit is copied here
 * at once through the same handler (expenses.service settle and sentBack, requisitions.service
 * settle), which is safe to run again when the worker copies it too.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 60_home.js. Idempotent: a request is found by its requester and purpose, a budget by its
 * department and year, a project by its name; a second run adds nothing. With nobody to raise a
 * request or nobody to decide one, no request is added.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { atomically } = require("../../src/shared/db/tx");
const lagos = require("../../src/shared/time/lagos");
const { realStaff } = require("./lib/staff");
const { removeHomeStagingRows } = require("./lib/home-staging-rows");

const src = (p) => require(path.join(__dirname, "..", "..", "src", p));

/** The tables this seed takes from Home (step 1). */
const EXPENSE_TABLES = Object.freeze(["expense_request", "budget_line", "budget"]);

/** The department whose people raise the requests: the Implementation Team's accounts. */
const REQUESTERS = "Implementation";

/**
 * 8099's five, taken out once nothing names them (8101 does the same on production), with 8101's
 * guard: only one still as 8099 wrote it, its code and name and no description (audit F25).
 */
const SEEDED = Object.freeze([
  ["travel", "Travel"],
  ["office", "Office Supplies"],
  ["training", "Training"],
  ["utilities", "Utilities"],
  ["professional_services", "Professional Services"],
]);

/** The two projects requests are raised under, and their budgets. */
const PROJECTS = Object.freeze([
  { name: "Ember to Remember", description: "Year-end activation series in Lagos.", budget: "2500000.00" },
  { name: "Enugu City Launch", description: "MyCity's launch in Enugu.", budget: "1800000.00" },
]);

/**
 * This year's budgets, by department, read from the organogram: the departments of Operations &
 * People, the Head of Department and the line manager (the first three distinct). Amounts by
 * category; the first department's events line is set so that what is paid takes it past 90%.
 */
const BUDGET_LINES = Object.freeze([
  [
    { category: "Events and Activations", amount: "1000000.00" },
    { category: "Data Airtime and Subscriptions", amount: "100000.00" },
  ],
  [
    { category: "Branded Items and Printing", amount: "900000.00" },
    { category: "Travel and Transport", amount: "450000.00" },
    { category: "Advertising and Media", amount: "1500000.00" },
  ],
  [
    { category: "Office and Admin", amount: "600000.00" },
    { category: "Accommodation and Meals", amount: "300000.00" },
  ],
]);

/**
 * The requests, in turn over the Implementation department's people. `walk` is how far each is
 * taken; `dept` which budget department (0 to 2) it is charged to; `project` one of PROJECTS.
 */
const REQUESTS = Object.freeze([
  { walk: "paid", dept: 0, project: 0, purpose: "Ember to Remember, stage and sound", category: "Events and Activations", payee: "vendor", name: "Stagecraft Nigeria Ltd", bank: "GTBank", lines: [["Stage hire, two days", "1", "450000.00"], ["Sound and lights", "1", "150000.00"]], reference: "GT2610150012" },
  { walk: "paid", dept: 0, project: 0, purpose: "Ember to Remember, Dedicated Task Team", category: "Events and Activations", payee: "task_team", name: "Ikeja Activation DTT", bank: "Opay", lines: [["Ushers, 10 for 2 days", "20", "15000.00"], ["Supervisors, 2 for 2 days", "4", "25000.00"]], reference: null },
  { walk: "authorised", dept: 1, project: 1, purpose: "Enugu launch flyers and roll-up banners", category: "Branded Items and Printing", payee: "vendor", name: "Print Hub Enugu", bank: "Zenith Bank", lines: [["A5 flyers", "5000", "45.00"], ["Roll-up banners", "4", "35000.00"]] },
  { walk: "in_requisition", dept: 1, project: 1, purpose: "Enugu launch, team transport", category: "Travel and Transport", payee: "vendor", name: "GUO Transport", bank: "First Bank", lines: [["Lagos to Enugu, return", "6", "32000.00"]] },
  { walk: "in_requisition", dept: 0, project: 0, purpose: "Field team data bundles, November", category: "Data Airtime and Subscriptions", payee: "staff", lines: [["Data bundle, 20GB", "6", "8000.00"]] },
  { walk: "approved", dept: 2, project: null, purpose: "Printer toner and paper", category: "Office and Admin", payee: "vendor", name: "Chuks Stores", bank: "Access Bank", lines: [["Toner cartridge", "2", "38000.00"], ["A4 paper, box", "3", "12500.00"]] },
  { walk: "approved", dept: 1, project: null, purpose: "Radio slots, November campaign", category: "Advertising and Media", payee: "vendor", name: "Wazobia FM", bank: "UBA", lines: [["30-second slot", "12", "45000.00"]] },
  { walk: "with_operations", dept: 2, project: null, purpose: "Partner lunch, ProvidusBank", category: "Accommodation and Meals", payee: "staff", lines: [["Lunch for six", "1", "96000.00"]] },
  { walk: "with_manager", dept: 1, project: 1, purpose: "Enugu launch, hotel for the crew", category: "Accommodation and Meals", payee: "vendor", name: "Nike Lake Resort", bank: "Providus Bank", lines: [["Room, 3 nights", "4", "65000.00"]] },
  { walk: "with_manager", dept: 0, project: 0, purpose: "Prizes for the Ikeja walk", category: "Prizes and Giveaways", payee: "vendor", name: "Slot Systems", bank: "GTBank", lines: [["Phone prize", "2", "120000.00"], ["Branded caps", "50", "2500.00"]] },
  { walk: "sent_back", dept: 2, project: null, purpose: "Office chairs", category: "Equipment", payee: "vendor", name: "Office Mart", bank: "Stanbic IBTC", lines: [["Swivel chair", "4", "85000.00"]], reason: "Send the invoice with the delivery cost on it." },
  { walk: "rejected", dept: 1, project: null, purpose: "Influencer post, unplanned", category: "Influencers and PR", payee: "partner", name: "Lagos Lifestyle Media", bank: "Wema Bank", lines: [["Sponsored post", "1", "350000.00"]], reason: "Not in this quarter's plan." },
  { walk: "draft", dept: 2, project: null, purpose: "Courier, Abuja documents", category: "Office and Admin", payee: "vendor", name: "GIG Logistics", bank: "Zenith Bank", lines: [["Courier, Lagos to Abuja", "1", "12500.00"]] },
]);

const ALL = Object.freeze({ scope: "all", scope_ids: null });

/** A person as a service's caller (req.user), or null when they have no login. */
async function callerOf(db, person) {
  if (!person || !person.user_id) return null;
  const user = await grantsCache.getAuthUser(db, person.user_id);
  return user ? { ...user, ip: null } : null;
}

/** A ten-digit account number made from a payee's name, so a run again writes the same one. */
function accountOf(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
  return `0${String(h).padStart(9, "0")}`;
}

module.exports = async function seed({ pool, log = () => {} }) {
  const categories = src("modules/expense_categories/expense_categories.service");
  const budgets = src("modules/budgets/budgets.service");
  const projects = src("modules/projects/projects.service");
  const expenses = src("modules/expenses/expenses.service");
  const requisitions = src("modules/requisitions/requisitions.service");
  const disbursements = src("modules/disbursements/disbursements.service");
  const workflow = src("modules/workflow/workflow.service");

  /* Steps 1 and 2: Home's rows away, then 8099's five where nothing names them. */
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      const gone = await removeHomeStagingRows(client, EXPENSE_TABLES);
      if (gone.rows) log(`expenses: ${gone.rows} of Home's rows and ${gone.alerts} of their alerts taken away`);
      const { rowCount } = await client.query(
        `DELETE FROM expense_category c
          USING unnest($1::text[], $2::text[]) AS seeded (code, name)
          WHERE c.code = seeded.code
            AND c.name = seeded.name
            AND c.description IS NULL
            AND NOT EXISTS (SELECT 1 FROM expense_request er WHERE er.expense_category_id = c.expense_category_id)
            AND NOT EXISTS (SELECT 1 FROM budget_line bl WHERE bl.expense_category_id = c.expense_category_id)`,
        [SEEDED.map(([code]) => code), SEEDED.map(([, name]) => name)],
      );
      if (rowCount) log(`expenses: 8099's ${rowCount} seeded categories taken out`);
    });
  } finally {
    client.release();
  }

  const staff = await realStaff(pool);
  const ops = await callerOf(pool, staff.operations);
  const ceo = await callerOf(pool, staff.ceo);
  if (!ops || !ceo) {
    log("expenses: no Operations & People or CEO login, nothing added");
    return;
  }

  /* Categories: the suggested twelve, only while there are none. */
  const { rows: had } = await pool.query("SELECT count(*)::int AS n FROM expense_category");
  if (!had[0].n) {
    await categories.addSuggested(ops);
    log("expenses: the twelve suggested categories added");
  }
  const { rows: cats } = await pool.query("SELECT expense_category_id, name FROM expense_category WHERE active");
  const cat = new Map(cats.map((r) => [r.name, r.expense_category_id]));

  /* Budgets: this year's, for three departments of the organogram. */
  const year = Number(lagos.today().slice(0, 4));
  const departments = [];
  for (const p of [staff.operations, staff.head, staff.manager, ...staff.management])
    if (p && p.department_id && !departments.includes(p.department_id)) departments.push(p.department_id);
  for (const [i, lines] of BUDGET_LINES.entries()) {
    const departmentId = departments[i];
    if (!departmentId) break;
    const { rows } = await pool.query(
      "SELECT 1 FROM budget WHERE department_id = $1 AND date_part('year', starts_on)::int = $2",
      [departmentId, year],
    );
    if (rows.length) continue;
    const known = lines.filter((l) => cat.has(l.category));
    if (!known.length) continue;
    try {
      await budgets.create(ops, c.budgets.BudgetCreate.parse({ department_id: departmentId, year, lines: known.map((l) => ({ expense_category_id: cat.get(l.category), amount: l.amount })) }));
    } catch (err) {
      log(`expenses: a budget stopped: ${err.message}`);
    }
  }

  /* Projects: two of Workspace's, each with a budget. */
  const projectIds = [];
  for (const p of PROJECTS) {
    const { rows } = await pool.query("SELECT project_id FROM project WHERE name = $1 LIMIT 1", [p.name]);
    let id = rows[0] ? rows[0].project_id : null;
    if (!id) id = (await projects.create(ops, ALL, { name: p.name, description: p.description })).project_id;
    const { rows: b } = await pool.query("SELECT budget_amount FROM project WHERE project_id = $1", [id]);
    if (b[0].budget_amount === null) await projects.setBudget(ops, id, p.budget);
    projectIds.push(id);
  }

  /* Requests: raised by the Implementation department's people, each decided by whom its stage names. */
  const requesters = staff.everyone.filter((p) => p.department === REQUESTERS && p.user_id && p.line_manager_id);
  if (!requesters.length) {
    log(`expenses: nobody in ${REQUESTERS} with a line manager, no requests added`);
    return;
  }
  const lineOf = async (person) => callerOf(pool, staff.everyone.find((p) => p.employee_id === person.line_manager_id));
  const decide = async (who, instanceId, decision, reason = null) => workflow.decide(who, instanceId, decision, reason);
  const instanceOf = async (id) => (await pool.query("SELECT workflow_instance_id FROM expense_request WHERE expense_request_id = $1", [id])).rows[0].workflow_instance_id;
  const stateOf = async (instanceId) => (await pool.query("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [instanceId])).rows[0].state;

  /** Decide the request's approval up to Operations & People's approval (or the first stage only). */
  async function approveThrough(request, person, { onlyManager = false } = {}) {
    let instanceId = await instanceOf(request.expense_request_id);
    const manager = await lineOf(person);
    const current = (await pool.query("SELECT current_stage FROM workflow_instance WHERE workflow_instance_id = $1", [instanceId])).rows[0].current_stage;
    if (current !== "operations_people" && manager) await decide(manager, instanceId, "approve");
    if (onlyManager) return;
    instanceId = await instanceOf(request.expense_request_id);
    if ((await stateOf(instanceId)) === "pending") await decide(ops, instanceId, "approve");
    await expenses.settle(request.expense_request_id, await stateOf(instanceId), instanceId);
  }

  const toGroup = [];
  const toAuthorise = [];
  const toPay = [];
  let added = 0;
  for (const [n, plan] of REQUESTS.entries()) {
    const person = requesters[n % requesters.length];
    const caller = await callerOf(pool, person);
    if (!caller || !cat.has(plan.category)) continue;
    const { rows: found } = await pool.query("SELECT expense_request_id FROM expense_request WHERE employee_id = $1 AND purpose = $2", [person.employee_id, plan.purpose]);
    if (found.length) continue;
    const staffPayee = plan.payee === "staff";
    try {
      const made = await expenses.create(caller, c.expenses.ExpenseCreate.parse({
        purpose: plan.purpose,
        expense_category_id: cat.get(plan.category),
        project_id: plan.project === null ? undefined : projectIds[plan.project],
        department_id: departments[plan.dept] || undefined,
        lines: plan.lines.map(([description, quantity, unitPrice]) => ({ description, quantity, unit_price: unitPrice })),
        payee_type: plan.payee,
        uses_profile_account: staffPayee && Boolean(person.account_number),
        ...(staffPayee && person.account_number
          ? {}
          : { payee_name: plan.name || `${person.first_name} ${person.last_name}`, bank_name: plan.bank || "GTBank", account_name: plan.name || `${person.first_name} ${person.last_name}`, account_number: accountOf(plan.name || person.employee_id) }),
        submit: plan.walk !== "draft",
      }));
      added += 1;
      const id = made.expense_request_id;
      if (plan.walk === "draft" || plan.walk === "with_manager") continue;
      if (plan.walk === "sent_back" || plan.walk === "rejected") {
        const manager = await lineOf(person);
        const instanceId = await instanceOf(id);
        const who = manager || ops;
        await decide(who, instanceId, plan.walk === "sent_back" ? "request_changes" : "reject", plan.reason);
        if (plan.walk === "sent_back") await expenses.sentBack(id, { instance_id: instanceId, reason: plan.reason });
        else await expenses.settle(id, await stateOf(instanceId), instanceId);
        continue;
      }
      if (plan.walk === "with_operations") {
        await approveThrough(made, person, { onlyManager: true });
        continue;
      }
      await approveThrough(made, person);
      if (plan.walk === "approved") continue;
      if (plan.walk === "in_requisition") toGroup.push(id);
      else toAuthorise.push({ id, plan });
    } catch (err) {
      log(`expenses: ${plan.purpose} stopped: ${err.message}`);
    }
  }

  /* Requisitions: one the CEO authorised and paid from, one still with the CEO. */
  const group = async (ids) => (ids.length ? requisitions.create(ops, c.requisitions.RequisitionCreate.parse({ expense_request_ids: ids })) : null);
  try {
    const authorised = await group(toAuthorise.map((r) => r.id));
    if (authorised) {
      await decide(ceo, authorised.workflow_instance_id, "approve");
      await requisitions.settle(authorised.requisition_id, await stateOf(authorised.workflow_instance_id));
      for (const r of toAuthorise) if (r.plan.walk === "paid") toPay.push(r);
    }
    await group(toGroup);
  } catch (err) {
    log(`expenses: a requisition stopped: ${err.message}`);
  }

  /* Disbursements: paid with the bank's reference, and one saved without it (Reference Missing). */
  for (const [n, r] of toPay.entries()) {
    try {
      await disbursements.create(ops, c.disbursements.DisbursementCreate.parse({
        expense_request_id: r.id,
        paid_on: lagos.addDays(lagos.today(), -(n + 1)),
        ...(r.plan.reference ? { payment_reference: r.plan.reference } : { confirm_without_reference: true }),
      }));
    } catch (err) {
      log(`expenses: paying ${r.plan.purpose} stopped: ${err.message}`);
    }
  }
  log(`expenses: ${added} requests raised`);
};

module.exports.EXPENSE_TABLES = EXPENSE_TABLES;
module.exports.REQUESTS = REQUESTS;
