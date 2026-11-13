"use strict";
/**
 * Staging demonstration data: Payroll (M6; docs/guides/payroll.md §3, §13.1 item 19, §13.2 item 46, F13).
 *
 * Payroll is shown on invented test people only. Staging sends real mail (A4) and a payslip is a
 * person's pay, so none of MyCity's real staff is paid, changed or emailed here. Everything goes
 * through the modules' own services, as the screens would:
 *
 *   people          six invented people in the Implementation department (the Implementation Team's
 *                   own, so no MyCity department gains anyone), each at an `@example.test` address,
 *                   which the mailer never hands to a mail server, and none with a login: four paid
 *                   since four months ago, a joiner of this month with pay (prorated), and a joiner
 *                   whose pay People have not entered (No Salary Set: set it on People · Employees and
 *                   Compute again)
 *   last month      opened, computed and submitted by the Implementation Team, approved by the CEO and
 *                   so locked, its payslips published to the test people ("Your payslip is ready" goes
 *                   nowhere: the addresses are reserved). Not marked paid, so Mark Paid can be shown
 *   this month      opened and computed: the joiners, and the advance's first instalment
 *   an advance      ₦100,000.00 recorded for one test person, recovered over this month and next
 *   everyone else   every person who is not a test person (MyCity's staff, the Implementation Team) is
 *                   left out of both runs, "Not in the demonstration", so no real pay is ever computed;
 *                   leaving a person out tells them nothing
 *
 * The pending fine is the queries seed's (50_queries.js: a Warning with a ₦5,000.00 fine on an
 * Implementation Team account, issued by the worker after the seeds): it waits on Deductions,
 * untouched. Nothing statutory: no rate, band or relief, and the advanced option stays off (MyCity
 * applies none yet; Operations & People enter each figure with its source when they start, §13.1
 * item 38). Email All is never pressed.
 *
 * The CEO's login approves last month's run, the one approval payroll has (§13.1 item 7), as the
 * expenses seed's CEO authorises a requisition: the engine tells the CEO of the waiting approval and
 * the submitter of the decision, as it tells any approver (asked in M6 PR 8's chat, 13/11/2026).
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 50_queries.js; no seed reads payroll's tables. Idempotent: a test person is found by work email; the
 * runs and the advance are made only while the database has no run at all, so a second run, or a run
 * after MyCity has made its own, adds nothing. With no Implementation Team login or no CEO login,
 * no run is made.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { atomically } = require("../../src/shared/db/tx");
const lagos = require("../../src/shared/time/lagos");
const { realStaff } = require("./lib/staff");

const src = (p) => require(path.join(__dirname, "..", "..", "src", p));

/** The department the test people join, and whose accounts run the payroll. */
const DEPARTMENT = "Implementation";

/** Why everyone who is not a test person is left out of a run. */
const LEFT_OUT = "Not in the demonstration";

/** A name reserved so that it never takes mail (RFC 6761); the mailer drops it (system-mail.service). */
const DOMAIN = "example.test";

/**
 * The test people. `since`: started on the first of the month that many months back. `joins`: started
 * this month, on that day. A `gross` of null is a person People have not yet given pay.
 */
const PEOPLE = Object.freeze([
  { key: "adaeze", first: "Adaeze", last: "Okonkwo", job: "Field Officer", type: "contractor", since: 4, gross: "250000.00", bank: "GTBank" },
  { key: "tunde", first: "Tunde", last: "Ogunleye", job: "Content Writer", type: "consultant", since: 4, gross: "180000.00", bank: "Access Bank" },
  { key: "ngozi", first: "Ngozi", last: "Ibe", job: "Community Manager", type: "full_time", since: 4, gross: "320000.00", bank: "Zenith Bank" },
  { key: "musa", first: "Musa", last: "Danjuma", job: "Driver", type: "contractor", since: 4, gross: "120000.00", bank: "First Bank" },
  { key: "chiamaka", first: "Chiamaka", last: "Nwosu", job: "Listings Assistant", type: "contractor", joins: 10, gross: "200000.00", bank: "UBA" },
  { key: "segun", first: "Segun", last: "Alabi", job: "Events Assistant", type: "contractor", joins: 10, gross: null, bank: null },
]);

/** The advance: paid by the CEO outside the system a few days ago, recovered over this month and next. */
const ADVANCE = Object.freeze({
  person: "adaeze",
  amount: "100000.00",
  months: 2,
  paid_days_ago: 3,
  reason: "Advance on salary for rent, paid by the CEO",
});

const emailOf = (p) => `${p.first}.${p.last}`.toLowerCase().replace(/[^a-z.]/g, "") + `@${DOMAIN}`;

/** An invented number, as the recruitment seed's candidates have; the system sends a phone nothing. */
const phoneOf = (n) => `0803${String(2000000 + n * 3917).slice(0, 7)}`;

/** The first day of the month `offset` months from the one `day` is in. */
function monthStart(day, offset = 0) {
  const [y, m] = day.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}

/** A ten-digit account number made from a name, so a run again writes the same one. */
function accountOf(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
  return `0${String(h).padStart(9, "0")}`;
}

/** A person as a service's caller (req.user), or null when they have no login. */
async function callerOf(db, person) {
  if (!person || !person.user_id) return null;
  const user = await grantsCache.getAuthUser(db, person.user_id);
  return user ? { ...user, ip: null } : null;
}

/** The test people's records, as the employee service would write them for Add Employee. */
function recordOf(p, n, { today, departmentId, managerId }) {
  const start = p.joins ? `${monthStart(today).slice(0, 8)}${String(p.joins).padStart(2, "0")}` : monthStart(today, -p.since);
  return c.organisation.EmployeeCreate.parse({
    first_name: p.first,
    last_name: p.last,
    work_email: emailOf(p),
    phone: phoneOf(n),
    job_title: p.job,
    start_date: start,
    employment_type: p.type,
    work_pattern: "remote",
    department_id: departmentId,
    ...(managerId ? { line_manager_id: managerId } : {}),
    ...(p.gross ? { gross_monthly: p.gross } : {}),
    ...(p.bank ? { bank_name: p.bank, account_number: accountOf(`${p.first} ${p.last}`) } : {}),
  });
}

module.exports = async function seed({ pool, log = () => {} }) {
  const organisation = src("modules/organisation/organisation.service");
  const payroll = src("modules/payroll/payroll.service");
  const deductions = src("modules/deductions/deductions.service");
  const workflow = src("modules/workflow/workflow.service");

  const staff = await realStaff(pool);
  const team = staff.everyone.filter((p) => p.department === DEPARTMENT && p.user_id);
  const runner = await callerOf(pool, team[0]);
  const ceo = await callerOf(pool, staff.ceo);
  if (!runner || !ceo) {
    log(`payroll: no ${DEPARTMENT} login or no CEO login, nothing added`);
    return;
  }
  const today = lagos.today();

  /* The test people, found by work email; made only when absent. */
  const emails = PEOPLE.map(emailOf);
  const known = async () =>
    new Map((await pool.query("SELECT employee_id, lower(work_email::text) AS email FROM employee WHERE lower(work_email::text) = ANY($1)", [emails])).rows.map((r) => [r.email, r.employee_id]));
  let found = await known();
  let made = 0;
  for (const [n, p] of PEOPLE.entries()) {
    if (found.has(emailOf(p))) continue;
    const client = await pool.connect();
    try {
      await atomically(client, () =>
        organisation.createEmployee(client, recordOf(p, n, { today, departmentId: team[0].department_id, managerId: team[0].employee_id }), runner),
      );
      made += 1;
    } catch (err) {
      log(`payroll: ${p.first} ${p.last} stopped: ${err.message}`);
    } finally {
      client.release();
    }
  }
  if (made) log(`payroll: ${made} test people added`);
  found = await known();
  const testIds = [...found.values()];
  const idOf = (key) => found.get(emailOf(PEOPLE.find((p) => p.key === key)));

  /* The runs and the advance, only while there is no run at all. */
  const { rows: runs } = await pool.query("SELECT count(*)::int AS n FROM payroll_run");
  if (runs[0].n) {
    log("payroll: runs already exist, none added");
    return;
  }

  /** Leave out everyone in the run who is not a test person, then compute it. */
  async function computeTestPeopleOnly(runId) {
    await payroll.computeRun(runner, runId);
    const { rows } = await pool.query(
      "SELECT employee_id FROM payslip WHERE payroll_run_id = $1 AND status <> 'excluded' AND NOT (employee_id = ANY($2::uuid[]))",
      [runId, testIds],
    );
    for (const r of rows) await payroll.excludePerson(runner, runId, c.payroll.PayrollRunExclude.parse({ employee_id: r.employee_id, reason: LEFT_OUT }));
    return payroll.computeRun(runner, runId);
  }

  /* Last month: computed, submitted, approved by the CEO and so locked. */
  try {
    const last = await payroll.createRun(runner, c.payroll.PayrollRunCreate.parse({ period: monthStart(today, -1) }));
    const computed = await computeTestPeopleOnly(last.payroll_run_id);
    const seen = computed.net_pay ? { expected_net_total: computed.net_pay } : {};
    const submitted = await payroll.submitRun(runner, last.payroll_run_id, c.payroll.PayrollRunSubmit.parse(seen));
    const instanceId = submitted.workflow_instance_id;
    await workflow.decide(ceo, instanceId, "approve");
    const { rows } = await pool.query("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [instanceId]);
    // The worker copies the decision onto the run after commit; here it is copied at once, which is safe twice.
    await payroll.settle(last.payroll_run_id, rows[0].state, instanceId);
    log(`payroll: ${last.number} approved and locked`);
  } catch (err) {
    log(`payroll: last month's run stopped: ${err.message}`);
    return;
  }

  /* This month: opened, the advance recorded from it, then computed. */
  try {
    const current = await payroll.createRun(runner, c.payroll.PayrollRunCreate.parse({ period: monthStart(today) }));
    const person = idOf(ADVANCE.person);
    if (person) {
      await deductions.recordAdvance(
        runner,
        c.deductions.AdvanceRecord.parse({
          employee_id: person,
          amount: ADVANCE.amount,
          granted_on: lagos.addDays(today, -ADVANCE.paid_days_ago),
          months: ADVANCE.months,
          start_period: current.period,
          reason: ADVANCE.reason,
        }),
      );
    }
    await computeTestPeopleOnly(current.payroll_run_id);
    log(`payroll: ${current.number} computed`);
  } catch (err) {
    log(`payroll: this month's run stopped: ${err.message}`);
  }
};

module.exports.PEOPLE = PEOPLE;
module.exports.ADVANCE = ADVANCE;
module.exports.LEFT_OUT = LEFT_OUT;
module.exports.emailOf = emailOf;
