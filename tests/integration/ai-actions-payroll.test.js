"use strict";
/**
 * Praxis AI and ⌘K for payroll, and the notices a run sends, on the real migrations (docs/guides/payroll.md §7, §9;
 * docs/guides/praxis-ai.md §6.11, decision 33). The reads (`payroll.runs`, `payslips.list`, `deductions.list` for a Payroll
 * reader, masked as the screen is; `payslips.mine` and `deductions.mine` for the person, their own pay never masked from
 * them) and the summary `payroll.month`; the six cards, each through the service function its screen's button calls and
 * each a risk the person confirms (New Run, Submit for Approval, Add Adjustment, Accept Deduction, Waive Fine, Record
 * Advance); ⌘K finding a payslip (a person only their own), a deduction and the New Run action; and a submitted run telling
 * the CEO by the bell, by push and by email, each link opening the same screen; and each person's payslip and deduction
 * notices emailing the link their bell gives them (My Payslips without `payroll`, Payroll · Payslips with it).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-payroll
 *
 * Refuses to run unless the database name ends in "_test": it rebuilds the public schema. Every person is invented.
 */
process.env.GEMINI_API_KEY = "test-key";
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));
const queues = require("../../src/jobs/queues");

const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const registry = require("../../src/shared/ai/registry");
const authorise = require("../../src/shared/ai/authorise");
const fieldMask = require("../../src/shared/rbac/field-mask");
const routeMap = require("../../src/shared/route-map");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const systemMail = require("../../src/services/mail/system-mail.service");
const notificationsService = require("../../src/modules/notifications/notifications.service");
const deductionsService = require("../../src/modules/deductions/deductions.service");
const lock = require("../../src/modules/payroll/payroll.lock");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const OCT = "2026-10-01";
const SIX = ["payroll_runs.create", "payroll_runs.submit", "payroll_adjustments.add", "deductions.accept", "deductions.waive", "advances.record"];

describeDb("Praxis AI and ⌘K for payroll against the real migrations", () => {
  let app;
  let h;
  let run;
  const made = {};

  const actor = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
  const read = async (who, key, params = {}) => authorise.runRead(pool, await actor(who), key, params);
  const summary = async (who, key, params = {}) => authorise.runSummary(pool, await actor(who), key, params);
  const employeeOf = (who) => h.people[who].employee_id;

  /** The model drafts this card, as Gemini would: nothing is run until the person presses it. */
  const card = async (who, key, values, question = "Draft it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect([key, asked.status, asked.body.error]).toEqual([key, 200, undefined]);
    return asked.body.card;
  };

  /** A person's fine, waiting for payroll, with its query and sanction. */
  async function fineFor(who, amount = "9000.00") {
    const n = (await one("SELECT count(*)::int AS n FROM employee_query")).n + 1;
    const number = `QRY-${String(n).padStart(4, "0")}`;
    const query = await one(`INSERT INTO employee_query (number, employee_id, subject, details) VALUES ($1, $2, 'Subject', 'Details') RETURNING employee_query_id`, [number, employeeOf(who)]);
    const sanction = await one(
      `INSERT INTO sanction (employee_query_id, employee_id, sanction_type, reason, decided_by, effective_on, ends_on, status, number)
       VALUES ($1, $2, 'fine', 'Test', $3, '2026-09-01', '2026-09-01', 'issued', $4) RETURNING sanction_id`,
      [query.employee_query_id, employeeOf(who), h.people.ops.user_id, `SAN-T-${n}`],
    );
    const fine = await one(`INSERT INTO sanction_fine (sanction_id, amount_ngn, settlement_status) VALUES ($1, $2, 'pending') RETURNING sanction_fine_id`, [sanction.sanction_id, amount]);
    return { id: fine.sanction_fine_id, number };
  }

  /** The role of a person, for the mask the tests switch on and off. */
  const roleOf = async (who) => (await one("SELECT role_id FROM role WHERE code = $1", [who]));

  /** A person's one notice of this event, as the fan-out wrote it. */
  const noticeOf = async (who, eventKey) => {
    const rows = (await q("SELECT * FROM notification WHERE user_id = $1 AND event_key = $2 ORDER BY created_at DESC", [h.people[who].user_id, eventKey])).rows;
    expect([eventKey, rows.length]).toEqual([eventKey, 1]);
    return rows[0];
  };
  /** The notice's link in that person's bell. */
  const bellLinkOf = async (who, notice) =>
    (await h.as(who).get("/notifications")).body.data.find((n) => n.notification_id === notice.notification_id).link;
  /** The address the notice's email opens (Open in MyCity App), sent through the delivery job itself; null for none. */
  async function emailLinkOf(notice) {
    const deliver = require("../../src/jobs/handlers/notification-deliver");
    systemMail.__reset();
    const out = await deliver({ data: { event: { key: notice.event_key }, notifications: [notice], push: null }, updateData: async () => undefined });
    expect(out).toMatchObject({ email: 1 });
    const mail = systemMail.capturedMail().find((m) => m.template === "notification");
    const button = /<a href="([^"]+)"[^>]*>Open in MyCity App<\/a>/.exec(mail.html || "");
    return button ? button[1].replace(/&amp;/g, "&") : null;
  }
  /** The email opens the screen the bell does, for the same person: one link on every channel (notifications.md §6). */
  async function expectEmailOpensBellScreen(who, notice, screen) {
    const bell = await bellLinkOf(who, notice);
    expect(bell).toMatchObject(screen);
    expect(await emailLinkOf(notice)).toBe(new URL(bell.path, config.STAFF_ORIGIN).href);
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Tunde", last: "Bakare", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "staff", first: "Musa", last: "Danjuma", email: "staff@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
      { who: "other", first: "Zainab", last: "Lawal", email: "other@mycity.test", job: "Field Officer", role: "employee", password: "Field#Officer2026", department: "Programmes" },
    ]);
    for (const [who, gross] of [["ceo", "500000.00"], ["ops", "250000.00"], ["staff", "200000.00"], ["other", "180000.00"]])
      await q("UPDATE employee SET gross_monthly = $2, bank_name = 'Test Bank', account_number = '0123456789' WHERE employee_id = $1", [employeeOf(who), gross]);
    // The company week, Monday to Saturday (A22), so a full month is paid in full.
    await q("DELETE FROM working_week");
    for (let weekday = 1; weekday <= 7; weekday += 1)
      await q("INSERT INTO working_week (weekday, is_working_day, starts_at, ends_at) VALUES ($1, $2, $3, $4)", [weekday, weekday <= 6, weekday <= 6 ? "09:00" : null, weekday <= 6 ? "17:00" : null]);
    workingWeek.invalidateCalendar();
    await grantsCache.bumpTeamVersion();
    await drain();
    registry.load();
    fresh();
  }, 180_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    fresh();
  });

  /* ---------------------------------------------------------------- *
   * Who is offered what
   * ---------------------------------------------------------------- */

  test("Operations & People are offered all six cards and the payroll reads; a member of staff only their own two reads", async () => {
    const ops = await actor("ops");
    expect((await authorise.allowedActions(ops)).map((a) => a.key)).toEqual(expect.arrayContaining(SIX));
    expect((await authorise.allowedReads(ops)).map((r) => r.key)).toEqual(expect.arrayContaining(["payroll.runs", "payslips.list", "deductions.list"]));
    expect((await authorise.allowedSummaries(ops)).map((s) => s.key)).toContain("payroll.month");

    const staff = await actor("staff");
    expect((await authorise.allowedActions(staff)).map((a) => a.key).filter((k) => SIX.includes(k))).toEqual([]);
    const reads = (await authorise.allowedReads(staff)).map((r) => r.key);
    expect(reads).toEqual(expect.arrayContaining(["payslips.mine", "deductions.mine"]));
    expect(reads.filter((k) => ["payroll.runs", "payslips.list", "deductions.list"].includes(k))).toEqual([]);
    expect((await authorise.allowedSummaries(staff)).map((s) => s.key)).not.toContain("payroll.month");
    for (const key of SIX) await expect(authorise.checkAction(staff, key, {})).rejects.toMatchObject({ code: "AI_ACTION_FORBIDDEN" });
    for (const key of ["payroll.runs", "payslips.list", "deductions.list"]) await expect(authorise.runRead(pool, staff, key, {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
    await expect(authorise.runSummary(pool, staff, "payroll.month", {})).rejects.toMatchObject({ code: "AI_READ_FORBIDDEN" });
  });

  /* ---------------------------------------------------------------- *
   * payroll_runs.create, then the reads of a run
   * ---------------------------------------------------------------- */

  test("payroll_runs.create: New Run's card opens the month as a draft, once, after Confirm It's You; the reads and the summary then show it, masked as the screen is", async () => {
    const drafted = await card("ops", "payroll_runs.create", { period: OCT });
    expect(drafted).toMatchObject({ action_key: "payroll_runs.create", label: "New Run", risk: "payroll", values: { period: OCT }, problems: {} });
    await h.stale("ops");
    expect((await h.press("ops", drafted.ai_action_draft_id)).body.error.code).toBe("REAUTH_REQUIRED");
    await h.confirmPassword("ops");
    const pressed = await h.press("ops", drafted.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "payroll_run", label: "PAY-2026-10, October 2026", ok: true })]);
    run = (await one("SELECT payroll_run_id FROM payroll_run WHERE period = $1", [OCT])).payroll_run_id;
    // A second press of the same card, or a second card for the month, never opens a second run.
    const again = await card("ops", "payroll_runs.create", { period: OCT });
    expect((await h.press("ops", again.ai_action_draft_id)).status).toBe(409);
    expect((await one("SELECT count(*)::int AS n FROM payroll_run")).n).toBe(1);

    expect((await h.as("ops").post(`/payroll/runs/${run}/compute`).send({})).status).toBe(200);

    const runs = await read("ops", "payroll.runs");
    expect(runs.data).toEqual([expect.objectContaining({ number: "PAY-2026-10", status: "computed", headcount: 4, gross_pay: "1130000.00", net_pay: "1130000.00" })]);
    expect(runs.citations).toEqual([expect.objectContaining({ type: "payroll_run", id: run, label: "PAY-2026-10, October 2026", link: expect.stringContaining("payroll-runs") })]);
    const month = await summary("ops", "payroll.month");
    expect(month.result.figures).toEqual([
      expect.objectContaining({ key: "headcount", value: 4 }),
      expect.objectContaining({ key: "gross", value: "1130000.00" }),
      expect.objectContaining({ key: "deductions", value: "0.00" }),
      expect.objectContaining({ key: "net", value: "1130000.00" }),
    ]);
    expect(month.result.total).toBe(4);
    // A month with no run has no figures, and names none.
    expect((await summary("ops", "payroll.month", { period: "2026-09-01" })).result).toMatchObject({ figures: [], total: 0 });

    // A reader whose role hides pay sees the headcount and Restricted for money, in a read and in the summary alike.
    const role = await roleOf("operations_people");
    await q("INSERT INTO field_visibility (role_id, field_key, visibility) VALUES ($1, 'employee.salary', 'masked') ON CONFLICT (role_id, field_key) DO UPDATE SET visibility = 'masked'", [role.role_id]);
    await grantsCache.invalidateGrants();
    try {
      expect((await read("ops", "payroll.runs")).data[0]).toMatchObject({ headcount: 4, gross_pay: null, total_deductions: null, net_pay: null, employer_cost: null });
      const hidden = await summary("ops", "payroll.month");
      expect(hidden.result.figures.map((f) => f.key)).toEqual(["headcount"]);
      expect(JSON.stringify(hidden.result)).not.toMatch(/1130000/);
    } finally {
      await q("UPDATE field_visibility SET visibility = 'visible' WHERE role_id = $1 AND field_key = 'employee.salary'", [role.role_id]);
      await grantsCache.invalidateGrants();
    }
  });

  /* ---------------------------------------------------------------- *
   * payroll_adjustments.add
   * ---------------------------------------------------------------- */

  test("payroll_adjustments.add: a one-off earning on a person's payslip, the run written by its month, through Add Adjustment's own service; the run goes back to a draft", async () => {
    const drafted = await card("ops", "payroll_adjustments.add", {
      payroll_run_id: "October 2026",
      employee_id: employeeOf("staff"),
      kind: "earning",
      label: "Transport Bonus",
      amount: "20000.00",
      reason: "Extra field days in October",
    });
    expect(drafted).toMatchObject({ action_key: "payroll_adjustments.add", label: "Add Adjustment", risk: "payroll", values: { payroll_run_id: run, kind: "earning", amount: "20000.00" }, problems: {} });
    expect(drafted.records).toEqual([expect.objectContaining({ type: "payroll_run", id: run, label: "PAY-2026-10, October 2026" })]);
    expect(drafted.names).toEqual([expect.objectContaining({ type: "employee", id: employeeOf("staff"), label: "Musa Danjuma" })]);
    await h.stale("ops");
    expect((await h.press("ops", drafted.ai_action_draft_id)).body.error.code).toBe("REAUTH_REQUIRED");
    await h.confirmPassword("ops");
    const pressed = await h.press("ops", drafted.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "payroll_run", label: "Transport Bonus, Musa Danjuma", ok: true })]);
    expect(await one("SELECT kind, label, amount::text AS amount FROM payroll_adjustment WHERE payroll_run_id = $1", [run])).toEqual({ kind: "earning", label: "Transport Bonus", amount: "20000.00" });
    expect((await one("SELECT status FROM payroll_run WHERE payroll_run_id = $1", [run])).status).toBe("draft");

    // A draft run is not one Submit may be asked for by its month: it is not computed, so the card cannot name it.
    const early = await card("ops", "payroll_runs.submit", { payroll_run_id: "October 2026" });
    expect(early.problems).toHaveProperty("payroll_run_id");
    expect(early.ok).not.toBe(true);
  });

  /* ---------------------------------------------------------------- *
   * payroll_runs.submit, and what a submitted run tells the approver
   * ---------------------------------------------------------------- */

  test("payroll_runs.submit: a changed total is told before anything is frozen; the right total sends the run to the CEO; a second card for it is refused", async () => {
    expect((await h.as("ops").post(`/payroll/runs/${run}/compute`).send({})).status).toBe(200);
    const net = (await one("SELECT net_total::text AS net FROM payroll_run WHERE payroll_run_id = $1", [run])).net;
    expect(net).toBe("1150000.00");

    // The net the person saw is not the net now: RUN_CHANGED, nothing frozen, the run still computed.
    const stale = await card("ops", "payroll_runs.submit", { payroll_run_id: "PAY-2026-10", expected_net_total: "1130000.00" });
    expect(stale).toMatchObject({ action_key: "payroll_runs.submit", label: "Submit for Approval", risk: "payroll", values: { payroll_run_id: run }, problems: {} });
    expect(stale.records).toEqual([expect.objectContaining({ type: "payroll_run", id: run })]);
    await h.confirmPassword("ops");
    const refused = await h.press("ops", stale.ai_action_draft_id);
    expect([refused.status, refused.body.error.code]).toEqual([409, "RUN_CHANGED"]);
    expect((await one("SELECT status, workflow_instance_id FROM payroll_run WHERE payroll_run_id = $1", [run]))).toEqual({ status: "computed", workflow_instance_id: null });

    const drafted = await card("ops", "payroll_runs.submit", { payroll_run_id: "October 2026", expected_net_total: net });
    await h.confirmPassword("ops");
    const pressed = await h.press("ops", drafted.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "payroll_run", label: "PAY-2026-10, October 2026", ok: true })]);
    expect(await one("SELECT status, (workflow_instance_id IS NOT NULL) AS opened FROM payroll_run WHERE payroll_run_id = $1", [run])).toEqual({ status: "submitted", opened: true });

    // Sent already: a card drawn for the run is refused when it is pressed, with the move's own words, and nothing changes.
    const late = await card("ops", "payroll_runs.submit", { payroll_run_id: run });
    const lateRefusal = await h.press("ops", late.ai_action_draft_id);
    expect([lateRefusal.status, lateRefusal.body.error.code]).toEqual([409, "RUN_NOT_COMPUTED"]);
    // And a run that is out cannot take an adjustment either.
    const locked = await card("ops", "payroll_adjustments.add", { payroll_run_id: run, employee_id: employeeOf("staff"), kind: "deduction", label: "Late Fix", amount: "1000.00", reason: "Too late to change" });
    expect([(await h.press("ops", locked.ai_action_draft_id)).body.error.code]).toEqual(["RUN_NOT_EDITABLE"]);
    expect((await one("SELECT count(*)::int AS n FROM payroll_adjustment WHERE payroll_run_id = $1", [run])).n).toBe(1);
  });

  test("a submitted run tells the CEO by the bell, by push and by email, and each link opens Payroll Runs on the run", async () => {
    await drain();
    const ceo = await actor("ceo");
    const rows = (
      await q(`SELECT * FROM notification WHERE user_id = $1 AND event_key = 'workflow.opened' AND entity_type = 'payroll_run' AND entity_id = $2`, [h.people.ceo.user_id, run])
    ).rows;
    expect(rows).toHaveLength(1);
    const notice = rows[0];
    expect(notice.title).toMatch(/^Approval needed/);
    expect(notice.channels).toEqual(expect.arrayContaining(["in_app", "push", "email"]));
    // Nobody else is asked to decide it: the person who submitted it is not told it waits on them.
    expect((await q(`SELECT user_id FROM notification WHERE event_key = 'workflow.opened' AND entity_id = $1`, [run])).rows.map((r) => r.user_id)).toEqual([h.people.ceo.user_id]);

    const open = routeMap.linkFor("payroll_run", run);
    expect(open).toMatchObject({ module: "payroll", tab: "payroll-runs" });
    // The bell, and the push, which carries the bell's own link.
    const bell = (await h.as("ceo").get("/notifications")).body.data.find((n) => n.notification_id === notice.notification_id);
    expect(bell.link).toEqual({ module: "payroll", tab: "payroll-runs", path: open.path });
    const [pushed] = await notificationsService.present([notice], notificationsService.opener(ceo));
    expect(pushed.link.path).toBe(open.path);
    // The email, and the push job the delivery queues, through the delivery job itself.
    const deliver = require("../../src/jobs/handlers/notification-deliver");
    systemMail.__reset();
    queues.enqueue.mockClear();
    const out = await deliver({ data: { event: { key: "workflow.opened" }, notifications: [notice], push: null }, updateData: async () => undefined });
    expect(out).toMatchObject({ in_app: 1, email: 1, push_queued: 1 });
    expect(queues.enqueue.mock.calls.filter(([queue, , data]) => queue === "notification-push" && data.notification_id === notice.notification_id)).toHaveLength(1);
    const mail = systemMail.capturedMail().find((m) => m.template === "notification");
    expect(mail.to).toEqual([expect.objectContaining({ address: "ceo@mycity.test" })]);
    expect(`${mail.html} ${mail.text}`).toContain(new URL(open.path, config.STAFF_ORIGIN).href);
  });

  /* ---------------------------------------------------------------- *
   * The approval locks the run: payslips, their notices and the person's own reads
   * ---------------------------------------------------------------- */

  test("the CEO approves; each person is told their payslip is ready on My Payslips, and reads only their own pay, never masked from them", async () => {
    const instance = (await one("SELECT workflow_instance_id FROM payroll_run WHERE payroll_run_id = $1", [run])).workflow_instance_id;
    const approved = await h.as("ceo").post(`/workflow/instances/${instance}/approve`).send({});
    expect([approved.status, approved.body.error]).toEqual([200, undefined]);
    await drain();
    expect((await one("SELECT status FROM payroll_run WHERE payroll_run_id = $1", [run])).status).toBe("approved");

    // The notice is each person's, and opens their own screen: an employee cannot open Payroll · Payslips.
    const notices = (await h.as("staff").get("/notifications")).body.data.filter((n) => n.title === "Your payslip is ready");
    expect(notices).toHaveLength(1);
    expect(notices[0].link).toMatchObject({ module: "ess", tab: "my-payslips" });
    expect(notices[0].channels || ["in_app"]).not.toContain("push");

    // The premise: the Employee role hides salaries, and the person's own payslip is theirs whatever their role says.
    expect(await fieldMask.maskedKeysFor(pool, await actor("staff"))).toContain("employee.salary");
    const mine = await read("staff", "payslips.mine");
    expect(mine.data).toEqual([expect.objectContaining({ number: expect.stringMatching(/^PAY-2026-10-\d{4}$/), month: "October 2026", status: "Approved", gross: "220000.00", net: "220000.00", deductions: "0.00", has_deduction: false })]);
    expect(Object.keys(mine.data[0])).not.toEqual(expect.arrayContaining(["gross_pay", "net_pay"]));
    made.staffPayslip = mine.data[0];
    expect(mine.citations).toEqual([expect.objectContaining({ type: "payroll_own_payslip", id: made.staffPayslip.payslip_id, link: `/ess?tab=my-payslips&id=${made.staffPayslip.payslip_id}` })]);
    // Somebody else's is never in it.
    const theirs = await read("other", "payslips.mine");
    expect(theirs.data).toHaveLength(1);
    expect(theirs.data[0]).toMatchObject({ gross: "180000.00", net: "180000.00" });
    expect(theirs.data[0].payslip_id).not.toBe(made.staffPayslip.payslip_id);
    // A year with none is an empty page, not another year's.
    expect((await read("staff", "payslips.mine", { year: 2030 })).data).toEqual([]);
  });

  test("each payslip notice's email opens the screen its bell does: My Payslips without payroll, Payroll · Payslips for a Payroll reader", async () => {
    const staffs = await noticeOf("staff", "payslip.published");
    expect(staffs.channels).toContain("email");
    expect(routeMap.linkFor("payslip", staffs.entity_id)).toMatchObject({ module: "payroll", tab: "payslips" });
    await expectEmailOpensBellScreen("staff", staffs, { module: "ess", tab: "my-payslips", path: `/ess?tab=my-payslips&id=${staffs.entity_id}` });
    const ops = await noticeOf("ops", "payslip.published");
    await expectEmailOpensBellScreen("ops", ops, { module: "payroll", tab: "payslips", path: `/payroll?tab=payslips&id=${ops.entity_id}` });
  });

  test("payslips.list: Payroll readers read a month's payslips as Payroll · Payslips lists them, masked for a role that hides pay", async () => {
    const list = await read("ops", "payslips.list", { run_id: run });
    expect(list.page.total).toBe(4);
    expect(list.data.find((p) => p.employee.employee_id === employeeOf("staff"))).toMatchObject({ status: "published", gross_pay: "220000.00", net_pay: "220000.00" });
    expect(list.citations[0]).toMatchObject({ type: "payslip", link: expect.stringContaining("payslips") });
    expect((await read("ops", "payslips.list", { run_id: run, q: "Danjuma" })).data).toHaveLength(1);

    const role = await roleOf("operations_people");
    await q("INSERT INTO field_visibility (role_id, field_key, visibility) VALUES ($1, 'employee.salary', 'masked') ON CONFLICT (role_id, field_key) DO UPDATE SET visibility = 'masked'", [role.role_id]);
    await grantsCache.invalidateGrants();
    try {
      const hidden = await read("ops", "payslips.list", { run_id: run });
      expect(hidden.data.every((p) => p.gross_pay === null && p.net_pay === null && p.total_deductions === null)).toBe(true);
      expect(hidden.page.total).toBe(4);
    } finally {
      await q("UPDATE field_visibility SET visibility = 'visible' WHERE role_id = $1 AND field_key = 'employee.salary'", [role.role_id]);
      await grantsCache.invalidateGrants();
    }
  });

  /* ---------------------------------------------------------------- *
   * deductions.accept, deductions.waive, advances.record, and the reads of deductions
   * ---------------------------------------------------------------- */

  test("deductions.accept: a fine is accepted over three months from a month written in words, through the sheet's own service, and the person is told", async () => {
    made.fine = await fineFor("staff", "9000.00");
    made.waiting = await fineFor("staff", "4000.00");
    made.own = await fineFor("ops", "2000.00");

    const waiting = await read("ops", "deductions.list", { status: "pending", source: "fine" });
    expect(waiting.data.map((r) => r.sanction_fine_id).sort()).toEqual([made.fine.id, made.waiting.id, made.own.id].sort());
    expect(waiting.citations).toEqual(expect.arrayContaining([expect.objectContaining({ type: "deduction", id: made.fine.id, label: `Musa Danjuma, ${made.fine.number}` })]));

    const [first] = await deductionsService.startMonthChoices(pool);
    const open = await lock.openPeriod(pool);
    const drafted = await card("ops", "deductions.accept", { sanction_fine_id: made.fine.id, months: 3, start_period: first });
    expect(drafted).toMatchObject({ action_key: "deductions.accept", label: "Accept Deduction", risk: "payroll", values: { sanction_fine_id: made.fine.id, months: 3, start_period: open }, problems: {} });
    expect(drafted.records).toEqual([expect.objectContaining({ type: "deduction", id: made.fine.id, label: `Musa Danjuma, ${made.fine.number}` })]);
    await h.stale("ops");
    expect((await h.press("ops", drafted.ai_action_draft_id)).body.error.code).toBe("REAUTH_REQUIRED");
    await h.confirmPassword("ops");
    const pressed = await h.press("ops", drafted.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "deduction", id: made.fine.id, ok: true })]);
    const d = await one("SELECT payroll_deduction_id, instalments, start_period::text AS start FROM payroll_deduction WHERE sanction_fine_id = $1", [made.fine.id]);
    expect(d).toMatchObject({ instalments: 3, start: open });
    expect((await q("SELECT amount::text FROM payroll_deduction_instalment WHERE payroll_deduction_id = $1 ORDER BY period", [d.payroll_deduction_id])).rows.map((r) => r.amount)).toEqual(["3000.00", "3000.00", "3000.00"]);
    expect((await one("SELECT settlement_status FROM sanction_fine WHERE sanction_fine_id = $1", [made.fine.id])).settlement_status).toBe("accepted");
    await drain();
    expect((await h.as("staff").get("/notifications")).body.data.map((n) => n.title)).toContain("Deduction Scheduled");

    // The fine is no longer waiting: a second card for it is refused at the press, and nothing changes.
    const twice = await card("ops", "deductions.accept", { sanction_fine_id: made.fine.id, months: 1, start_period: first });
    expect([(await h.press("ops", twice.ai_action_draft_id)).body.error.code]).toEqual(["FINE_NOT_MOVABLE"]);
    expect((await one("SELECT count(*)::int AS n FROM payroll_deduction WHERE sanction_fine_id = $1", [made.fine.id])).n).toBe(1);
    // A start month before the open one is refused by the service's own rule, as the screen's form is.
    const early = await card("ops", "deductions.accept", { sanction_fine_id: made.waiting.id, months: 1, start_period: "2026-01-01" });
    const earlyRefusal = await h.press("ops", early.ai_action_draft_id);
    expect([earlyRefusal.status, earlyRefusal.body.error.code]).toEqual([422, "START_NOT_ALLOWED"]);
  });

  test("deductions.waive: a waiting fine is waived with its reason and the person is told; never the asker's own fine", async () => {
    const drafted = await card("ops", "deductions.waive", { sanction_fine_id: made.waiting.id, reason: "It was raised in error and the query was withdrawn" });
    expect(drafted).toMatchObject({ action_key: "deductions.waive", label: "Waive Fine", risk: "payroll", problems: {} });
    await h.confirmPassword("ops");
    const pressed = await h.press("ops", drafted.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "deduction", id: made.waiting.id, ok: true })]);
    expect((await one("SELECT settlement_status FROM sanction_fine WHERE sanction_fine_id = $1", [made.waiting.id])).settlement_status).toBe("waived");
    expect((await one("SELECT count(*)::int AS n FROM payroll_deduction WHERE sanction_fine_id = $1", [made.waiting.id])).n).toBe(0);
    await drain();
    expect((await h.as("staff").get("/notifications")).body.data.map((n) => n.title)).toContain("Fine Waived");

    // Their own fine is settled by someone else (§6.6 rule 8): the card is drawn, and the press is refused with nothing changed.
    const own = await card("ops", "deductions.waive", { sanction_fine_id: made.own.id, reason: "I would rather not pay it" });
    const refused = await h.press("ops", own.ai_action_draft_id);
    expect([refused.status, refused.body.error.code]).toEqual([403, "OWN_RECORD"]);
    const ownAccept = await card("ops", "deductions.accept", { sanction_fine_id: made.own.id, months: 1, start_period: (await deductionsService.startMonthChoices(pool))[0] });
    expect((await h.press("ops", ownAccept.ai_action_draft_id)).body.error.code).toBe("OWN_RECORD");
    expect((await one("SELECT settlement_status FROM sanction_fine WHERE sanction_fine_id = $1", [made.own.id])).settlement_status).toBe("pending");
  });

  test("Deduction Scheduled and Fine Waived email a person without payroll a link to My Payslips, as their bell does, never to Payroll · Deductions", async () => {
    for (const key of ["payroll_deduction.accepted", "payroll_deduction.waived"]) {
      const notice = await noticeOf("staff", key);
      expect(notice).toMatchObject({ entity_type: "deduction" });
      expect(notice.channels).toContain("email");
      await expectEmailOpensBellScreen("staff", notice, { module: "ess", tab: "my-payslips", path: `/ess?tab=my-payslips&id=${notice.entity_id}` });
    }
  });

  test("advances.record: an advance paid outside the system is recorded over two months, through Record Advance's own service; never the asker's own", async () => {
    const [first] = await deductionsService.startMonthChoices(pool);
    const open = await lock.openPeriod(pool);
    const drafted = await card("ops", "advances.record", {
      employee_id: employeeOf("other"),
      amount: "60000.00",
      granted_on: lagos.today(),
      months: 2,
      start_period: first,
      reason: "School fees advance paid by the CEO",
    });
    expect(drafted).toMatchObject({ action_key: "advances.record", label: "Record Advance", risk: "payroll", values: { months: 2, start_period: open }, problems: {} });
    expect(drafted.names).toEqual([expect.objectContaining({ type: "employee", id: employeeOf("other"), label: "Zainab Lawal" })]);
    await h.stale("ops");
    expect((await h.press("ops", drafted.ai_action_draft_id)).body.error.code).toBe("REAUTH_REQUIRED");
    await h.confirmPassword("ops");
    const pressed = await h.press("ops", drafted.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "deduction", label: "Zainab Lawal, salary advance", ok: true })]);
    const advance = await one("SELECT payroll_deduction_id, total_amount::text AS total, instalments FROM payroll_deduction WHERE source = 'salary_advance'");
    expect(advance).toMatchObject({ total: "60000.00", instalments: 2 });
    await drain();
    expect((await h.as("other").get("/notifications")).body.data.map((n) => n.title)).toContain("Deduction Scheduled");

    const own = await card("ops", "advances.record", { employee_id: employeeOf("ops"), amount: "10000.00", granted_on: lagos.today(), months: 1, start_period: first, reason: "An advance for myself" });
    const refused = await h.press("ops", own.ai_action_draft_id);
    expect([refused.status, refused.body.error.code]).toEqual([403, "OWN_RECORD"]);
    expect((await one("SELECT count(*)::int AS n FROM payroll_deduction WHERE source = 'salary_advance'")).n).toBe(1);
  });

  test("deductions.mine: the person reads their own instalments with their amounts, though their role hides pay; never another's", async () => {
    const mine = await read("other", "deductions.mine");
    expect(await fieldMask.maskedKeysFor(pool, await actor("other"))).toContain("employee.salary");
    expect(mine.page.total).toBe(2);
    // Newest month first, as My Payslips lists them.
    expect(mine.data).toEqual([
      expect.objectContaining({ source: "advance", reason: "School fees advance paid by the CEO", instalment: "2 of 2", amount: "30000.00", status: "scheduled" }),
      expect.objectContaining({ source: "advance", instalment: "1 of 2", amount: "30000.00", status: "scheduled" }),
    ]);
    expect(Object.keys(mine.data[0])).not.toContain("pay_amount");
    expect(mine.citations[0]).toMatchObject({ type: "payroll_own_deduction", link: expect.stringContaining("my-payslips") });
    // The fine's three instalments are Musa's, with its query; Zainab's read holds none of them.
    const staffs = await read("staff", "deductions.mine");
    expect(staffs.data.map((r) => [r.source, r.instalment, r.amount, r.query_number])).toEqual([
      ["fine", "3 of 3", "3000.00", made.fine.number],
      ["fine", "2 of 3", "3000.00", made.fine.number],
      ["fine", "1 of 3", "3000.00", made.fine.number],
    ]);
    // A Payroll reader reads the union, advances and fines alike, as the tab lists them.
    const union = await read("ops", "deductions.list", { source: "advance" });
    expect(union.data).toEqual([expect.objectContaining({ source: "advance", status: "active", instalments: 2, pay_amount: "60000.00" })]);
  });

  /* ---------------------------------------------------------------- *
   * ⌘K
   * ---------------------------------------------------------------- */

  test("⌘K finds a payslip: a Payroll reader any, by number or name and never with an amount; a person only their own, opening My Payslips", async () => {
    const own = made.staffPayslip;
    const staff = await h.as("staff").get(`/search?q=${own.number}`);
    const mine = (staff.body.groups || []).find((g) => g.type === "payroll_own_payslip");
    expect(mine.items).toEqual([expect.objectContaining({ ref: own.number, link: `/ess?tab=my-payslips&id=${own.payslip_id}` })]);
    expect((staff.body.groups || []).map((g) => g.type)).not.toContain("payslip");
    // Another person finds nothing of Musa's: neither by number nor by name.
    for (const term of [own.number, "Danjuma"]) {
      const other = await h.as("other").get(`/search?q=${encodeURIComponent(term)}`);
      expect((other.body.groups || []).flatMap((g) => g.items).filter((i) => i.ref === own.number || /Danjuma/.test(i.title))).toEqual([]);
    }

    const ops = await h.as("ops").get("/search?q=Danjuma");
    const readers = (ops.body.groups || []).find((g) => g.type === "payslip");
    expect(readers.items).toEqual([expect.objectContaining({ ref: own.number, title: "Musa Danjuma" })]);
    expect(JSON.stringify(readers)).not.toMatch(/220000|220,000|₦/);
    // A Payroll reader's own payslip is also theirs, found as My Payslips beside the register.
    const theirOwn = await h.as("ops").get("/search?q=Bakare");
    expect((theirOwn.body.groups || []).map((g) => g.type)).toEqual(expect.arrayContaining(["payslip"]));
  });

  test("⌘K finds a deduction for a Payroll reader only, the screens and the New Run action by what they are called", async () => {
    const ops = await h.as("ops").get("/search?q=Musa");
    const group = (ops.body.groups || []).find((g) => g.type === "deduction");
    expect(group.items).toEqual([expect.objectContaining({ ref: "Fine", title: "Musa Danjuma" })]);
    expect((await h.as("staff").get("/search?q=Musa")).body.groups.map((g) => g.type)).not.toContain("deduction");
    expect((await h.as("ops").get("/search?q=Zainab")).body.groups.find((g) => g.type === "deduction").items).toEqual([expect.objectContaining({ ref: "Advance" })]);

    const titles = async (who, term) => ((await h.as(who).get(`/search?q=${encodeURIComponent(term)}`)).body.groups || []).flatMap((g) => g.items).map((i) => i.title);
    expect(await titles("ops", "new run")).toContain("New Run");
    expect(await titles("staff", "new run")).not.toContain("New Run");
    expect(await titles("ops", "advanced payroll")).toContain("Configurations");
    expect(await titles("ops", "record advance")).toContain("Record Advance");
  });

  test("Home's Payroll In Progress card still counts the approved run, opening it, until it is marked paid", async () => {
    const before = (await h.as("ops").get("/home/kpi/payroll_run_state")).body.data;
    expect(before.map((r) => [r.cells.run.text, r.cells.status.text, r.cells.month.text])).toEqual([["PAY-2026-10", "Approved", "October 2026"]]);
    expect(before[0].link).toContain("payroll-runs");
    expect((await h.as("staff").get("/home/kpi/payroll_run_state")).status).toBe(404);
    const paid = await h.as("ops").post(`/payroll/runs/${run}/mark-paid`).send({ paid_on: lagos.today() });
    expect([paid.status, paid.body.error]).toEqual([200, undefined]);
    expect((await h.as("ops").get("/home/kpi/payroll_run_state")).body.data).toEqual([]);
  });

  test("the routes the assistant offers open the screens they name", () => {
    const routes = Object.fromEntries(registry.routes().filter((r) => r.owner === "payroll").map((r) => [r.intent, r]));
    expect(routes["run payroll"]).toMatchObject({ screen: "payroll.payroll-runs", params: { action: "new" } });
    expect(routes["turn on advanced payroll"]).toMatchObject({ screen: "payroll.configurations" });
    expect(routes["record a salary advance"]).toMatchObject({ screen: "payroll.deductions", params: { action: "advance" } });
    expect(routes["my payslip"]).toMatchObject({ screen: "ess.my-payslips" });
  });
});
