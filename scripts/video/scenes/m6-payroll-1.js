"use strict";
/**
 * Milestone 6 handover, part 1 of 2: Payroll, running the month. docs/runbooks/training-videos.md
 * says how a scene is written and filmed, and §8 the plan.
 *
 * MyCity's own people, by their real names (JBS Praxis, 14/11/2026: an internal video for MyCity's
 * team), on a development database prepared by `prepare` below. November 2026 is MyCity's first run
 * in the hub. Cynthia Osakunih, Operations & People, opens and computes it, puts its problems right
 * on People · Employees, deals with three fines from upheld queries, records Aaron Agama's advance,
 * adds an adjustment, leaves the JBS Praxis Team's account out and sends the run to Ifeoma Mbonu,
 * the CEO, who approves it on her phone. Part 2 (`m6-payroll-2.js`) runs on the same database after
 * it: payslips, mail, Mark Paid, Configurations and My Payslips.
 *
 * Every salary is an example set for the video, said so on camera; the roster carries none. The
 * fines are invented, on real staff (JBS Praxis's choice, 14/11/2026), raised and upheld through
 * Queries & Sanctions as the people would.
 *
 * `prepare` is the ground both parts are filmed on: the staging seed without its payroll file (its
 * invented people and runs), then what Operations & People would have done before the first run,
 * each step through the module's own service as its screen makes it. Refused anywhere but a
 * development database; run once on a fresh one (`make.js m6-payroll-1 prepare`, runbook §4.1), then
 * start the worker so the fines' sanctions are issued.
 */
const path = require("node:path");

const src = (p) => require(path.join(__dirname, "..", "..", "..", "src", p));

/**
 * Example monthly pay by post, set for the video (never a name written here). A post left out has no
 * pay: Growth Officer - Imo, whose No Salary Set is put right on camera.
 */
const PAY = Object.freeze({
  "Chief Executive Officer": "1500000.00",
  "Chief Technology Officer": "1200000.00",
  "Program Manager": "900000.00",
  "Head, PR, Marketing & Brand Strategy": "800000.00",
  "Operations & People Lead": "700000.00",
  "Backend Operations Manager": "600000.00",
  "PR & Marketing Lead - MyLagosApp": "450000.00",
  "Marketing Lead - Abuja": "400000.00",
  "Marketing Lead - South West": "400000.00",
  "Social Media Manager": "350000.00",
  "Graphics Designer": "300000.00",
  "Content & Listing Associate": "220000.00",
  "Graphics Associate": "200000.00",
  "Growth Officer - Enugu": "180000.00",
  "Growth Officer - Abia": "180000.00",
  "Growth Officer - Kano": "180000.00",
});

/**
 * Start dates the roster does not carry, set for the video. The Program Manager's is left empty, as
 * the roster has it, so the run's No Start Date is put right on camera.
 */
const STARTED = Object.freeze({
  "Operations & People Lead": "2025-02-03",
  "Chief Technology Officer": "2024-06-03",
});

/**
 * The fines, each an upheld query on a real person (by post, never a name): raised by their line
 * manager (Management when they have none), answered, a Warning with a fine proposed by Management and
 * approved by Operations & People. On camera: the first accepted this month, the second spread over
 * three months, the third waived.
 */
const FINES = Object.freeze([
  {
    post: "Content & Listing Associate",
    subject: "Late Listing Updates",
    details: "Twelve partner listings due on Friday at 17:00 were updated on Tuesday, after two partners complained.",
    response: "<p>I accept the listings went up late. I was covering the Lekki visits and did not hand them over. I will flag it the same day next time.</p>",
    decision: "Twelve listings went up four days late, after two partners complained.",
    fine: "5000.00",
  },
  {
    post: "Growth Officer - Enugu",
    subject: "Missed Partner Visits",
    details: "Three of the week's five partner visits in Enugu were missed, and the partners were not told in advance.",
    response: "<p>Two visits clashed with a city event and I did not reschedule them in time. I have now visited all three partners.</p>",
    decision: "Three partner visits in Enugu were missed, with no notice to the partners.",
    fine: "15000.00",
  },
  {
    post: "Graphics Associate",
    subject: "Missed Design Deadline",
    details: "The Detty December poster set was due on Monday at 12:00 and reached the team on Wednesday.",
    response: "<p>The brief changed on Sunday night, and I started again from the new copy. I should have said so on Monday morning.</p>",
    decision: "The December poster set reached the team two days after its deadline.",
    fine: "5000.00",
  },
]);

/** An account number made from a name, the same every run (the roster never carries one). */
function accountOf(name) {
  let h = 11;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_000;
  return `0${String(h).padStart(9, "0")}`;
}

async function prepare({ log = console.log } = {}) {
  const { config } = src("config/env");
  require("../people").guard(config);
  const { pool } = src("config/db");
  const requestContext = src("config/request-context");
  const c = require("@mycity/contract");
  const grants = src("shared/rbac/grants-cache");
  const { atomically } = src("shared/db/tx");
  const runner = require("../../db/seed");
  const { realStaff } = require("../../../seeds/staging/lib/staff");
  const { signatureOf } = require("../../../seeds/staging/lib/signature");

  const { rows: had } = await pool.query("SELECT count(*)::int AS n FROM payroll_run");
  if (had[0].n) throw new Error("Payroll already has a run: prepare runs once, on a fresh database (runbook §4.1).");

  const inContext = (fn) => requestContext.run({ requestId: "video-m6", surface: "script" }, fn);
  /* The staging seed, every file but Payroll's own: its invented people and runs. */
  for (const file of runner.seedFiles("staging")) {
    if (path.basename(file) === "58_payroll.js") continue;
    await inContext(() => require(file)({ pool, actor: runner.ACTOR, log: (m) => log(`[seed] ${m}`) }));
    log(`[seed] ${path.basename(file)}`);
  }

  await inContext(async () => {
    const organisation = src("modules/organisation/organisation.service");
    const queries = src("modules/queries/queries.service");
    const response = src("modules/queries/queries.response");
    const visibility = src("modules/queries/queries.visibility");
    const sanctions = src("modules/sanctions/sanctions.service");

    const staff = await realStaff(pool);
    const as = async (person) => ({ ...(await grants.getAuthUser(pool, person.user_id)), ip: null });
    const ops = await as(staff.operations);
    const team = await as(staff.everyone.find((p) => p.job_title === "Implementation Partner"));
    const nameOf = (p) => `${p.first_name} ${p.last_name}`;

    /* Pay, bank and the missing start dates, as Operations & People enter them on People · Employees. */
    let paid = 0;
    for (const person of staff.everyone.filter((p) => p.job_title !== "Implementation Partner")) {
      const { rows } = await pool.query("SELECT bank_name FROM employee WHERE employee_id = $1", [person.employee_id]);
      const patch = {
        bank_name: rows[0].bank_name || "Providus Bank",
        account_number: accountOf(nameOf(person)),
        ...(PAY[person.job_title] ? { gross_monthly: PAY[person.job_title] } : {}),
        ...(STARTED[person.job_title] && !person.start_date ? { start_date: STARTED[person.job_title] } : {}),
      };
      // Nobody enters their own record: the Implementation Team enters Operations & People's.
      const by = person.employee_id === staff.operations.employee_id ? team : ops;
      const db = await pool.connect();
      try {
        await atomically(db, () => organisation.updateEmployee(db, person.employee_id, patch, by));
      } finally {
        db.release();
      }
      if (patch.gross_monthly) paid += 1;
    }
    log(`[m6] example pay for ${paid} people, bank details for everyone`);

    /* The fines: raised, answered, decided and approved; the worker issues each sanction after. */
    const all = { scope: "all", scope_ids: null };
    const proposerPerson = staff.management[0] || staff.ceo;
    const proposer = await as(proposerPerson);
    const reader = visibility.readerOf(all, ops);
    const { rows: steps } = await pool.query("SELECT consequence_step_id FROM consequence_step WHERE active AND name = 'Warning'");
    if (!steps[0]) throw new Error("No Warning on Chain Settings: the staging seed's queries file did not run.");
    for (const f of FINES) {
      const person = staff.everyone.find((p) => p.job_title === f.post && p.user_id);
      if (!person) throw new Error(`Nobody with a login is ${f.post}`);
      const manager = staff.everyone.find((p) => p.employee_id === person.line_manager_id && p.user_id);
      const lead = manager || proposerPerson;
      const raised = await queries.raise(await as(lead), all, c.queries.QueryCreate.parse({
        employee_id: person.employee_id,
        subject: f.subject,
        details: f.details,
        signature: signatureOf(nameOf(lead)),
      }));
      await response.respond(await as(person), person.employee_id, raised.employee_query_id, c.queries.QueryResponseCreate.parse({ body_html: f.response }));
      const decided = await queries.decide(proposer, all, raised.employee_query_id, c.queries.QueryDecision.parse({
        outcome: "sanction",
        consequence_step_id: steps[0].consequence_step_id,
        reason: f.decision,
        fine_amount: f.fine,
      }));
      await sanctions.approve(ops, reader, decided.sanction.sanction_id,
        c.sanctions.SanctionApprove.parse({ signature: signatureOf(nameOf(staff.operations)) }));
      log(`[m6] ${f.subject}: a Warning with a fine of ${f.fine} for ${nameOf(person)}`);
    }
  });
  await pool.end();
}

/* ------------------------------------------------------------------ *
 * The camera's hands
 * ------------------------------------------------------------------ */

const RUNS = "/payroll?tab=payroll-runs";
const DEDUCTIONS = "/payroll?tab=deductions";

/** A window by its name, never a help term's popup (runbook §6.16). */
const named = (s, name) => s.page.getByRole("dialog", { name }).last();
const inside = (s, name, label) => named(s, name).getByLabel(label, { exact: true }).first();
const button = (s, name, within) => (within || s.page).getByRole("button", { name, exact: true }).first();
const text = (s, words) => s.page.getByText(words, { exact: true }).first();
/** A KPI tile: a button named by its label and its figure ("Pending Fines 4 ₦30,000.00"). */
const tile = (s, label) => s.page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).first();
/** A table's row holding every one of `words`. */
const row = (s, ...words) => words.reduce((r, w) => r.filter({ hasText: w }), s.page.getByRole("row")).first();

/** Wait for a toast that starts with `start` (the branded Toaster's), up to `seconds`. */
async function toastOf(s, start, seconds = 20) {
  await s.page.getByText(new RegExp(`^${start}`)).first().waitFor({ state: "visible", timeout: seconds * 1000 }).catch(() => null);
}

/** The run's problem line ("2 blocking, 4 warnings"): an alert while anything blocks, a status after. */
const problemLine = (s) => s.page.getByRole("button", { name: /^\d+ blocking, \d+ warnings?$/ }).first();

/** Glide to `loc` when it shows within a few seconds. */
async function soft(s, loc, wait = 4000) {
  if (await loc.waitFor({ state: "visible", timeout: wait }).then(() => true, () => false)) await s.hover(loc);
}

/** Pick a person in a window's Employee search: type part of the name, then press them. */
async function pickPerson(s, windowName, typed, name) {
  await s.type(named(s, windowName).getByRole("searchbox", { name: "Employee" }), typed, { delay: 70 });
  await s.click(named(s, windowName).getByRole("option", { name: new RegExp(`^${name}`) }).first());
}

/** Open a person's record on People · Employees and press Edit Record. */
async function editRecord(s, name) {
  await s.click(text(s, name));
  await s.click(button(s, "Edit Record"));
}

module.exports = {
  id: "m6-payroll-1",
  file: "MyCity-M6-Payroll-Part-1-Running-the-Month",
  meta: { title: "MyCity App · Payroll, Part 1: Running the Month (Milestone 6)", artist: "JBS Praxis" },
  opening: {
    eyebrow: "Milestone 6 Handover · Part 1",
    title: "Payroll",
    subtitle: "Running the month, from New Run to approval",
    left: "A walkthrough of every screen and action",
  },
  closing: {
    eyebrow: "Milestone 6 · Payroll · Part 1",
    title: "Thank You",
    subtitle: "Every step is written up in the User Guide, in the Knowledge Hub",
    left: "hub.mycityapp.io",
  },
  prepare,
  people: {
    cynthia: (staff) => staff.operations.work_email,
    ifeoma: (staff) => staff.ceo.work_email,
  },
  chapters: [
    {
      name: "Welcome",
      shots: [
        {
          kind: "card",
          card: "opening",
          lines: [
            "Welcome to the walkthrough of Payroll, delivered in Milestone 6 of the MyCity hub.",
            "This first part runs a month, from New Run to the CEO's approval.",
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: RUNS,
          lines: [
            { say: "Payroll is in the menu, under People.", do: (s) => s.hover(s.page.getByRole("link", { name: "Payroll", exact: true })) },
            { say: "It has four tabs: Payroll Runs, Payslips, Deductions and Configurations.", do: async (s) => { for (const t of ["Payroll Runs", "Payslips", "Deductions", "Configurations"]) { await s.hover(s.page.getByRole("tab", { name: t, exact: true })); await s.wait(0.5); } } },
            "Operations and People run payroll. The CEO approves it. Each employee reads their own payslips in Self-Service.",
            "We follow Cynthia Osakunih, the Operations and People Lead, and Ifeoma Mbonu, the Chief Executive Officer.",
            { say: "Every salary in this video is an example, set for the walkthrough.", do: (s) => s.hover(s.page.getByRole("heading", { name: "This Run" })) },
            "November 2026 is MyCity's first run in the hub. Nothing is open yet.",
          ],
        },
      ],
    },
    {
      name: "Opening the Month",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: RUNS,
          lines: [
            { say: "Cynthia presses New Run.", do: (s) => s.click(button(s, "New Run")) },
            { say: "The Month starts on this one. A month never has two runs, and a month still to come can't be opened.", do: (s) => s.hover(named(s, "New Run").getByRole("button", { name: /^Month/ })) },
            { say: "Open Run. November's run is a Draft.", do: async (s) => { await s.click(button(s, "Open Run", named(s, "New Run"))); await toastOf(s, "Run opened"); } },
            { say: "Compute Run builds a payslip for everyone paid this month, from their pay and what attendance, fines and advances take.", do: async (s) => { await s.click(button(s, "Compute Run")); await toastOf(s, "Run computed"); } },
            { say: "The card shows Staff in Run, Gross, Deductions and Net.", do: (s) => s.hover(text(s, "Staff in Run")) },
            { say: "Under them, the run's five steps: Draft, Computed, Submitted, Approved and Paid.", do: (s) => s.hover(s.page.getByRole("list", { name: "November 2026 run" })) },
            "Draft and Computed can still change. Once approved, the run is locked for good.",
            { say: "Run History lists every month. Pressing one shows its run in the card.", do: (s) => s.hover(s.page.getByRole("heading", { name: "Run History" })) },
          ],
        },
      ],
    },
    {
      name: "Problems",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: RUNS,
          lines: [
            { say: "The red line counts the run's problems: two blocking, four warnings.", do: (s) => s.hover(problemLine(s)) },
            "A blocking problem stops Submit for Approval until it's fixed. A warning never does.",
            { say: "Cynthia presses Open. Run Problems names each person, the problem and the fix.", do: (s) => s.click(button(s, "Open", s.page.getByRole("alert"))) },
            { say: "Victor Esuk has No Salary Set: his pay was never entered.", do: (s) => s.hover(row(s, "No Salary Set for Victor Esuk")) },
            { say: "Etudor Edidiong has No Start Date. Without one, the run can't pay him.", do: (s) => s.hover(row(s, "No Start Date for Etudor Edidiong")) },
            { say: "Four people have a fine waiting. Those are warnings, dealt with on Deductions.", do: (s) => s.hover(row(s, "fine waits for payroll for Gideon Ekom")) },
            { say: "Exclude, on any row, would leave that person out of this run.", do: (s) => s.hover(row(s, "Victor Esuk").getByRole("button", { name: "Exclude" })), after: (s) => s.click(button(s, "Close", named(s, "Run Problems"))) },
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: "/people?tab=employees",
          lines: [
            { say: "Both are put right on the person's record, in People, under Employees.", do: (s) => s.hover(s.page.getByRole("heading", { name: "All Employees" })) },
            { say: "Cynthia opens Victor's record, and presses Edit Record.", do: (s) => editRecord(s, "Victor Esuk") },
            { say: "Gross Monthly is his pay each month. She enters 180,000 naira.", do: (s) => s.type(inside(s, "Edit Employee", "Gross Monthly"), "180,000", { delay: 70 }) },
            { say: "Save Record.", do: async (s) => { await s.click(button(s, "Save Record", named(s, "Edit Employee"))); await s.wait(1); } },
            { say: "Then Etudor's record, and his Start Date.", do: async (s) => { await s.click(button(s, "Back to Employees")); await editRecord(s, "Etudor Edidiong"); await s.type(inside(s, "Edit Employee", "Start Date"), "07/04/2025", { delay: 70 }); } },
            { say: "Save Record.", do: async (s) => { await s.click(button(s, "Save Record", named(s, "Edit Employee"))); await s.wait(1); } },
          ],
        },
        {
          kind: "desktop",
          as: "cynthia",
          start: RUNS,
          lines: [
            { say: "Back on Payroll Runs, she presses Compute Run again.", do: async (s) => { await s.click(button(s, "Compute Run")); await toastOf(s, "Run computed"); } },
            { say: "Victor and Etudor are paid now. Only the four warnings are left.", do: (s) => s.hover(problemLine(s)) },
            "Press Compute Run whenever something changes: a salary set, a fine accepted, a day waived.",
          ],
        },
      ],
    },
    {
      name: "Fines",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: DEDUCTIONS,
          lines: [
            "Deductions lists everything taken from pay: attendance deductions, fines and advances.",
            { say: ["Pending Fines counts four. Each comes from a query upheld in Queries and Sanctions,", "with a fine."].join(" "), do: (s) => s.hover(tile(s, "Pending Fines")) },
            { say: "Lateness and absence come here from attendance. Those are waived on People, under Attendance.", do: (s) => s.hover(tile(s, "Pending Attendance")) },
            { say: "Cynthia opens Tobiloba Dada's fine: 5,000 naira, for listings that went up four days late.", do: (s) => s.click(text(s, "Tobiloba Dada")) },
            { say: "Accept This Month takes it whole from November's pay. Tobiloba is told.", do: async (s) => { await s.click(button(s, "Accept This Month")); await toastOf(s, "Fine accepted"); } },
            { say: "Gideon Ekom's is 15,000 naira, for missed partner visits. Spread Over Months takes it in equal shares.", do: async (s) => { await s.click(text(s, "Gideon Ekom")); await s.click(button(s, "Spread Over Months")); } },
            { say: "Three months, from November: 5,000 naira a month.", do: (s) => s.hover(named(s, "Spread Fine").getByRole("combobox", { name: "Months" })) },
            { say: "Spread Fine.", do: async (s) => { await s.click(button(s, "Spread Fine", named(s, "Spread Fine"))); await toastOf(s, "Deduction scheduled"); } },
            { say: "Similoluwa Michael's poster brief changed the night before. Cynthia presses Waive.", do: async (s) => { await s.click(text(s, "Similoluwa Michael")); await s.click(button(s, "Waive")); } },
            { say: "She writes why, and presses Waive Fine. Nothing is taken, and Similoluwa is told.", do: async (s) => { await s.type(inside(s, "Waive Fine", "Reason"), "The brief changed after the work had started.", { delay: 26 }); await s.click(button(s, "Waive Fine", named(s, "Waive Fine"))); await s.wait(1); } },
            "Nobody can accept, waive or release their own fine.",
            { say: "Active lists what is being taken. Release puts a fine back to waiting, until a share of it is in a run.", do: (s) => s.click(button(s, "Active", s.page.getByRole("group", { name: "Status" }))) },
          ],
        },
      ],
    },
    {
      name: "An Advance",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: DEDUCTIONS,
          lines: [
            "An advance is pay the CEO sends someone before pay day, by bank transfer outside the hub.",
            "Yesterday Aaron Agama was sent 100,000 naira ahead of his November pay. Recording it recovers it from his payslips.",
            { say: "Cynthia presses Record Advance, and picks Aaron.", do: async (s) => { await s.click(button(s, "Record Advance")); await pickPerson(s, "Record Advance", "Aaron", "Aaron Agama"); } },
            { say: "Amount, 100,000 naira. Paid On, the day it was sent.", do: async (s) => { await s.type(inside(s, "Record Advance", "Amount"), "100,000", { delay: 70 }); await s.type(inside(s, "Record Advance", "Paid On"), "13/11/2026", { delay: 70 }); } },
            { say: "Months, two, from November: 50,000 naira comes off each payslip.", do: (s) => s.hover(named(s, "Record Advance").getByRole("combobox", { name: "Months" })) },
            { say: "The Reason, then Record Advance. Aaron is told.", do: async (s) => { await s.type(inside(s, "Record Advance", "Reason"), "Advance on salary for rent", { delay: 30 }); await s.click(button(s, "Record Advance", named(s, "Record Advance"))); await toastOf(s, "Advance recorded"); } },
            { say: "It's listed under Active, beside the two fines.", do: async (s) => { await s.click(button(s, "Active", s.page.getByRole("group", { name: "Status" }))); await soft(s, text(s, "Aaron Agama")); }, hold: 0.3 },
            "Cancel Advance takes one recorded in error off, until a share of it is in a run.",
          ],
        },
      ],
    },
    {
      name: "Adjustments and Left Out",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: RUNS,
          lines: [
            "An adjustment is a one-off earning or deduction, for one person, in this run.",
            { say: "Bassey Ekpe covered the Ikeja launch over the weekend. Cynthia presses Add Adjustment.", do: (s) => s.click(button(s, "Add Adjustment")) },
            { say: "She picks Bassey, and Earning.", do: async (s) => { await pickPerson(s, "Add Adjustment", "Bassey", "Bassey Ekpe"); await s.click(named(s, "Add Adjustment").getByRole("radio", { name: "Earning" })); } },
            { say: "The Label is what his payslip shows. Then the Amount, 25,000 naira, and the Reason.", do: async (s) => { await s.type(inside(s, "Add Adjustment", "Label"), "Launch weekend allowance", { delay: 30 }); await s.type(inside(s, "Add Adjustment", "Amount"), "25,000", { delay: 70 }); await s.type(inside(s, "Add Adjustment", "Reason"), "Covered the Ikeja launch on Saturday and Sunday", { delay: 22 }); } },
            { say: "Add Adjustment.", do: async (s) => { await s.click(button(s, "Add Adjustment", named(s, "Add Adjustment"))); await toastOf(s, "Adjustment added"); } },
            { say: "A month already locked is never changed. Its correction comes into the next run, as an adjustment.", do: (s) => soft(s, s.page.getByRole("heading", { name: "Adjustments" })) },
            { say: "Exclude leaves someone out of this run, with a reason.", do: (s) => s.click(button(s, "Exclude")) },
            { say: "The JBS Praxis Team's account is in the run. JBS Praxis is paid by invoice, not payroll.", do: async (s) => { await pickPerson(s, "Exclude Person", "JBS", "JBS Praxis Team"); await s.type(inside(s, "Exclude Person", "Reason"), "Paid by JBS Praxis invoice, not payroll", { delay: 26 }); } },
            { say: "Exclude Person. It's listed under Left Out, and Include would put it back.", do: async (s) => { await s.click(button(s, "Exclude Person", named(s, "Exclude Person"))); await s.wait(1.2); await soft(s, s.page.getByRole("heading", { name: "Left Out" })); } },
            { say: "Compute Run. The figures are ready to send.", do: async (s) => { await s.click(button(s, "Compute Run")); await toastOf(s, "Run computed"); await soft(s, text(s, "Net")); } },
          ],
        },
      ],
    },
    {
      name: "To the CEO",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: RUNS,
          lines: [
            { say: "Cynthia presses Submit for Approval. The run is computed again first.", do: async (s) => { await s.click(button(s, "Submit for Approval")); await toastOf(s, "Sent for approval"); } },
            "Had the totals changed since she last looked, she'd be shown the new ones, to submit again.",
            { say: "It reads Submitted, and Waiting On names the CEO, who is told.", do: (s) => s.hover(text(s, "Waiting On")) },
            "From here nothing in the run changes, unless the CEO sends it back.",
          ],
        },
        {
          kind: "phone",
          as: "ifeoma",
          start: "/home",
          label: { eyebrow: "On the CEO's phone", title: "Payroll Runs", subtitle: "Ifeoma Mbonu approves November" },
          lines: [
            { say: "Ifeoma Mbonu sees it in the bell, on her phone.", do: (s) => s.click(button(s, "Notifications")) },
            { say: "Approval needed: Payroll Run. She taps it.", do: (s) => s.click(s.page.getByRole("button", { name: /^Approval needed: Payroll Run/ }).first()) },
            { say: "The run opens: its figures, its steps, and who submitted it.", do: (s) => s.scroll(500, named(s, "Payroll Run")) },
            { say: "She presses Approve, and Approve Run to confirm.", do: async (s) => { await s.click(button(s, "Approve", named(s, "Payroll Run"))); await s.wait(0.6); await s.click(button(s, "Approve Run", s.page.getByRole("alertdialog", { name: "Approve Run" }))); await toastOf(s, "November 2026 approved"); } },
            { say: "November is locked. Every payslip is published, and each person is told their payslip is ready.", hold: 0.3 },
            "Send Back would return it to Cynthia with a reason, to correct and send again. Reject refuses it.",
          ],
        },
      ],
    },
    {
      name: "Wrapping Up",
      shots: [
        {
          kind: "desktop",
          as: "cynthia",
          start: RUNS,
          lines: [
            { say: "That's a month's payroll, from New Run to the CEO's approval.", do: (s) => s.hover(s.page.getByRole("list", { name: "November 2026 run" })) },
            "Part two follows the payslips: emailed, downloaded, paid, and read on a phone.",
          ],
        },
        {
          kind: "card",
          card: "closing",
          lines: ["Every step is also written up in the User Guide, in the Knowledge Hub. Thank you for watching."],
        },
      ],
    },
  ],
};
