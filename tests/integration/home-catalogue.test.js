"use strict";
/**
 * Home's KPI catalogue against the real migrations and reference seeds (docs/guides/home.md
 * §4.1, §6 Cards): who may see each card on the seeded roles, every live card's figure on an
 * empty organisation (a zero is a figure, never a missing card), the figures once records
 * exist in the M0 and M1 tables and in the forward tables the source adapters read, the
 * difference own, team and all scope make, money as Naira wire strings with other
 * currencies left out of a sum, and the records behind every card, paged at 25 and parsed
 * with the contract, holding the rows the figure counted.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/home-catalogue
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. Every person and record here is invented. "Today" is pinned to Wednesday 14 October
 * 2026 at noon in Lagos, so the figures do not move with the calendar; the week and the
 * public holidays are the seeded ones.
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { rebuild, sql } = require("./helpers/schema");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const leaveService = require("../../src/modules/leave/leave.service");
const attendanceRepo = require("../../src/modules/attendance/attendance.repo");
const reconcile = require("../../src/modules/attendance/attendance.reconcile");
const kpi = require("../../src/modules/dashboard/kpi-catalog");
const eligibility = require("../../src/modules/dashboard/kpi-catalog/eligibility");
const resolve = require("../../src/modules/dashboard/kpi-catalog/resolve");
const c = require("@mycity/contract");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0];

const TODAY = "2026-10-14";
const NOW = lagos.instant(TODAY, "12:00");
const DAY = 86_400_000;
const ago = (days) => new Date(NOW.getTime() - days * DAY);
const at = (date, hhmm) => lagos.instant(date, hhmm);

/** The cards with nothing to count until records exist: each must answer 0, never null. */
const ZERO_UNTIL_RECORDS = [
  "leave_pending",
  "vacancies_open",
  "attrition_90d",
  "confirmations_due",
  "documentation_pending",
  "reviews_due",
  "my_reviews_due",
  "tasks_overdue",
  "my_tasks_overdue",
  "approvals_awaiting_you",
  "alerts_high_open",
  "partnership_pipeline",
  "partnerships_active",
  "partnerships_quiet_30d",
  "proposals_out",
  "team_on_site",
  "team_remote",
  "team_flags",
];

describeDb("the KPI catalogue against the real migrations", () => {
  const people = {};
  const users = {};
  let headOffice;
  let numberSeq = 0;
  const number = (prefix) => `${prefix}-${String((numberSeq += 1)).padStart(4, "0")}`;

  async function person(key, first, last, manager = null) {
    const { employee_id: id } = await one(sql.employee, [first, last, manager ? people[manager] : null]);
    people[key] = id;
    return id;
  }

  async function login(key, role, { ceo = false } = {}) {
    const { user_id: id } = await one(sql.user, [people[key], `${key}@catalogue.mycity.test`, ceo]);
    if (role) await q("INSERT INTO user_role (user_id, role_id) SELECT $1, role_id FROM role WHERE code = $2", [id, role]);
    users[key] = await grantsCache.getAuthUser(pool, id);
  }

  /** What `key` may see, their reading context at the pinned noon, and every figure they may see. */
  async function reader(key) {
    const user = users[key];
    const { eligible, scopes } = await eligibility.forUser(pool, user);
    const ctx = kpi.context({ user, scopes, today: TODAY, now: NOW });
    const figures = await kpi.figuresFor(pool, [...eligible], ctx);
    return { user, eligible, ctx, figures };
  }

  /** Every record behind a card, page by page. */
  async function allRecords(id, ctx, query = {}) {
    const rows = [];
    for (let n = 1; ; n += 1) {
      const page = await kpi.detailPage(kpi.BY_ID.get(id), pool, { ...query, page: n }, ctx);
      expect(c.dashboard.HomeKpiDetailPage.parse(page)).toEqual(page);
      rows.push(...page.data);
      if (!page.page.has_next) return rows;
    }
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    workingWeek.invalidateCalendar();
    ({ worksite_id: headOffice } = await one(
      `INSERT INTO worksite (code, name, latitude, longitude, radius_m)
       VALUES ('HQ_CARDS', 'Head Office', 6.4281, 3.4219, 150) RETURNING worksite_id`,
    ));

    // Kemi manages Musa and Zainab. Bisi reports to nobody here; Tunde runs operations.
    await person("ceo", "Folake", "Adebayo");
    await person("ops", "Tunde", "Bakare");
    await person("mgr", "Kemi", "Alade");
    await person("staff", "Musa", "Danjuma", "mgr");
    await person("staff2", "Zainab", "Lawal", "mgr");
    await person("outsider", "Bisi", "Ade");
    await login("ceo", null, { ceo: true });
    await login("ops", "operations_people");
    await login("mgr", "manager");
    await login("staff", "employee");
    await login("outsider", "employee");
  });

  afterAll(async () => {
    await pool.end();
  });

  /* ---------------------------------------------------------------- *
   * Who may see which card, on the seeded roles
   * ---------------------------------------------------------------- */

  describe("who may see a card", () => {
    test("the CEO sees every live card, in every module at `all` (their own cards at `own`)", async () => {
      const { eligible, ctx } = await reader("ceo");
      expect([...eligible]).toEqual(kpi.LIVE_IDS);
      expect(ctx.scope("people").scope).toBe("all");
      expect(ctx.scope("ess")).toEqual({ scope: "own", scope_ids: [people.ceo], employee_id: people.ceo });
    });

    test("a member of staff: their own cards and their own records, no People, Team or alerts", async () => {
      const { eligible } = await reader("staff");
      for (const id of ["my_attendance_30d", "my_reviews_due", "my_leave_left", "my_tasks_overdue", "approvals_awaiting_you"])
        expect([id, eligible.has(id)]).toEqual([id, true]);
      for (const id of ["tasks_overdue", "partnerships_active", "expenses_pending", "reviews_due"])
        expect([id, eligible.has(id)]).toEqual([id, true]);
      for (const id of ["headcount", "attendance_today", "team_present", "alerts_high_open", "vacancies_open"])
        expect([id, eligible.has(id)]).toEqual([id, false]);
    });

    test("a line manager: People and the Team cards for their team, and the alerts they may clear", async () => {
      const { eligible, ctx } = await reader("mgr");
      for (const id of ["headcount", "attendance_today", "team_present", "team_flags", "alerts_high_open"])
        expect([id, eligible.has(id)]).toEqual([id, true]);
      expect(eligible.has("vacancies_open")).toBe(false);
      expect(ctx.scope("people").scope).toBe("team");
      expect([...ctx.scope("people").scope_ids].sort()).toEqual([people.mgr, people.staff, people.staff2].sort());
    });

    test("a role is offered exactly the cards its members are shown", async () => {
      const roleId = async (code) => (await one("SELECT role_id FROM role WHERE code = $1", [code])).role_id;
      expect([...(await eligibility.forRole(pool, await roleId("employee")))].sort()).toEqual(
        [...(await reader("staff")).eligible].sort(),
      );
      expect([...(await eligibility.forRole(pool, await roleId("manager")))].sort()).toEqual(
        [...(await reader("mgr")).eligible].sort(),
      );
    });

    test("the cards each Overview opens on, for the seeded roles", async () => {
      const pick = async (key, homeView) =>
        resolve.selectCards({ picks: null, roleCards: [], homeView, eligible: (await reader(key)).eligible });
      expect(await pick("ops", "operations")).toEqual({
        source: "view",
        ids: ["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active"],
      });
      expect(await pick("ceo", "ceo")).toEqual({
        source: "view",
        ids: ["approvals_awaiting_you", "partnerships_signed_value", "alerts_high_open", "attendance_today"],
      });
      expect(await pick("staff", "staff")).toEqual({
        source: "view",
        ids: ["my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "my_leave_left"],
      });
    });
  });

  /* ---------------------------------------------------------------- *
   * An empty organisation
   * ---------------------------------------------------------------- */

  describe("before anything is recorded", () => {
    test("every live card answers a figure, and a zero where nothing is recorded", async () => {
      const { figures } = await reader("ceo");
      for (const id of kpi.LIVE_IDS) expect([id, figures[id] === null]).toEqual([id, false]);
      for (const id of ZERO_UNTIL_RECORDS) expect([id, figures[id].value]).toEqual([id, 0]);
      expect(figures.expenses_pending).toEqual({ amount: "0.00", requests: 0 });
      expect(figures.partnerships_signed_value).toEqual({ amount: "0.00", agreements: 0 });
      expect(figures.budget_vs_actual).toEqual({ value: 0, denominator: 0 });
      expect(figures.headcount).toEqual({ value: 6 });
      expect(figures.attendance_today).toMatchObject({ value: 0, denominator: 6, late: 0 });
      expect(figures.team_present).toMatchObject({ value: 0, denominator: 6 });
      expect(figures.my_leave_left).toEqual({ value: 20, leave_type: "Annual" });
      // My Attendance counts the days the attendance module has recorded: none yet.
      expect(figures.my_attendance_30d).toMatchObject({ value: 0, denominator: 0 });
    });

    test("each card paints: zeros drawn, a ratio over nothing not measurable, money a string", async () => {
      const { figures } = await reader("ceo");
      for (const id of kpi.LIVE_IDS) {
        const card = kpi.cardOf(kpi.BY_ID.get(id), figures[id]);
        expect(c.dashboard.HomeKpiCard.parse(card)).toEqual(card);
      }
      expect(kpi.cardOf(kpi.BY_ID.get("budget_vs_actual"), figures.budget_vs_actual).measurable).toBe(false);
      expect(kpi.cardOf(kpi.BY_ID.get("expenses_pending"), figures.expenses_pending).amount).toBe("0.00");
    });

    test("the records behind every card are an empty page, not an error", async () => {
      const { ctx } = await reader("ceo");
      for (const id of ZERO_UNTIL_RECORDS) expect([id, (await allRecords(id, ctx)).length]).toEqual([id, 0]);
    });
  });

  /* ---------------------------------------------------------------- *
   * With records in the M0, M1 and forward tables
   * ---------------------------------------------------------------- */

  describe("with records", () => {
    beforeAll(async () => {
      const userOf = (key) => users[key].user_id;
      const { leave_type_id: annual } = await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'");
      const { expense_category_id: travel } = await one("SELECT expense_category_id FROM expense_category WHERE code = 'travel'");

      // The register: Ifeanyi left ten days ago, Zainab's confirmation is due in ten.
      await person("leaver", "Ifeanyi", "Obi", "mgr");
      await q("UPDATE employee SET status = 'left', left_on = $2 WHERE employee_id = $1", [
        people.leaver,
        lagos.addDays(TODAY, -10),
      ]);
      await q("UPDATE employee SET confirmation_due_on = $2, confirmed_on = NULL WHERE employee_id = $1", [
        people.staff2,
        lagos.addDays(TODAY, 10),
      ]);

      // Today: Musa in on time at the office, Bisi in late, Tunde on approved leave.
      // Yesterday Zainab clocked in and never out. Musa was late on Monday and on time on Tuesday.
      // A punch as the attendance service records one: the event on its work date, then the
      // day recalculated by the attendance module (attendance.reconcile.js recomputeDay).
      const punch = async (key, type, date, hhmm) => {
        await q(
          `INSERT INTO attendance_event (employee_id, event_type, occurred_at, work_date, worksite_id, source, validation_state)
           VALUES ($1, $2, $3, $4, $5, 'pwa', 'accepted')`,
          [people[key], type, at(date, hhmm), date, headOffice],
        );
        await reconcile.recomputeDay(pool, await attendanceRepo.person(pool, people[key]), date);
      };
      await punch("staff", "clock_in", TODAY, "08:50");
      await punch("outsider", "clock_in", TODAY, "09:30");
      await punch("staff2", "clock_in", "2026-10-13", "09:00");
      await punch("staff", "clock_in", "2026-10-12", "09:20");
      await punch("staff", "clock_in", "2026-10-13", "08:55");
      await punch("staff", "clock_out", "2026-10-13", "17:00");
      const approvedLeave = (key, from, to, days) =>
        q(
          `INSERT INTO leave_request (employee_id, leave_type_id, starts_on, ends_on, amount, status, submitted_at, decided_at)
           VALUES ($1, $2, $3, $4, $5, 'approved', now(), now())`,
          [people[key], annual, from, to, days],
        );
      await approvedLeave("ops", TODAY, TODAY, 1);
      await approvedLeave("staff", "2026-09-01", "2026-09-03", 3);

      // Musa asks for leave next year: it waits on Kemi, his line manager.
      const nextYear = Number(lagos.today().slice(0, 4)) + 1;
      await leaveService.request(users.staff, people.staff, {
        leave_type_id: annual,
        starts_on: `${nextYear}-03-02`,
        ends_on: `${nextYear}-03-03`,
        reason: "Family",
      });

      // Documents asked of Musa and Bisi; one more of Musa's was withdrawn.
      for (const [key, title, cancelled] of [
        ["staff", "Guarantor Form", null],
        ["outsider", "Degree Certificate", null],
        ["staff", "Birth Certificate", ago(1)],
      ])
        await q("INSERT INTO document_request (employee_id, title, cancelled_at) VALUES ($1, $2, $3)", [
          people[key],
          title,
          cancelled,
        ]);

      // Tasks (M2).
      const task = (title, assignee, due, extra = {}) =>
        q(
          `INSERT INTO task (title, status, created_by, primary_assignee_id, due_at, completed_at, archived_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [title, extra.status || "todo", userOf("ops"), assignee ? people[assignee] : null, due, extra.completed || null, extra.archived || null],
        );
      await task("Send the venue list", "staff", ago(1));
      await task("Book the hall", "outsider", new Date(NOW.getTime() - 2 * 3_600_000));
      await task("Print the badges", null, ago(3));
      await task("Already done", "staff", ago(1), { status: "done" });
      await task("Completed", "staff", ago(1), { completed: ago(0.5) });
      await task("Shelved", "staff", ago(1), { archived: ago(0.5) });
      await task("Due tomorrow", "staff", new Date(NOW.getTime() + DAY));

      // Reviews (M2): one cycle closes in ten days, the next in sixty.
      const cycle = async (name, closesInDays) =>
        (
          await one(
            `INSERT INTO performance_cycle (name, starts_on, ends_on, closes_at)
             VALUES ($1, '2026-07-01', '2026-12-31', $2) RETURNING performance_cycle_id`,
            [name, new Date(NOW.getTime() + closesInDays * DAY)],
          )
        ).performance_cycle_id;
      const soon = await cycle("2026 Second Half", 10);
      const later = await cycle("2027 First Half", 60);
      const review = (cycleId, of, by, type, submitted = null) =>
        q(
          `INSERT INTO performance_review (performance_cycle_id, employee_id, reviewer_employee_id, review_type, submitted_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [cycleId, people[of], people[by], type, submitted],
        );
      await review(soon, "staff", "mgr", "manager");
      await review(soon, "staff", "staff", "self");
      await review(soon, "staff2", "mgr", "manager", ago(1));
      await review(soon, "outsider", "ops", "manager");
      await review(later, "staff", "mgr", "designated");

      // Vacancies (M4).
      const vacancy = (title, status, manager) =>
        q(
          `INSERT INTO vacancy (number, title, slug, description, status, hiring_manager_id, created_by)
           VALUES ($1, $2, $3, 'A role.', $4, $5, $6)`,
          [number("VAC"), title, title.toLowerCase().replace(/\s+/g, "-"), status, people[manager], userOf("ops")],
        );
      await vacancy("Content Producer", "open", "mgr");
      await vacancy("Driver", "draft", "mgr");
      await vacancy("Accountant", "open", "outsider");

      // Partnerships (M7).
      const partner = async (name, status, owner, createdAt = ago(100)) =>
        (
          await one(
            `INSERT INTO partner (number, name, partner_type, status, owner_id, created_at)
             VALUES ($1, $2, 'government', $3, $4, $5) RETURNING partner_id`,
            [number("PAR"), name, status, people[owner], createdAt],
          )
        ).partner_id;
      const arts = await partner("Lagos Arts Council", "active", "staff");
      const trade = await partner("Kano Trade Council", "active", "outsider", ago(60));
      await partner("Abuja Film Board", "prospect", "staff");
      await q(
        `INSERT INTO partner_interaction (partner_id, interaction_type, subject, occurred_at)
         VALUES ($1, 'call', 'Festival plans', $2)`,
        [arts, ago(5)],
      );
      const opportunity = async (partnerId, title, status, owner) =>
        (
          await one(
            `INSERT INTO partnership_opportunity (number, partner_id, title, stage, status, owner_id, estimated_value, currency)
             VALUES ($1, $2, $3, 'proposal', $4, $5, 5000.00, 'NGN') RETURNING partnership_opportunity_id`,
            [number("POP"), partnerId, title, status, people[owner]],
          )
        ).partnership_opportunity_id;
      const festival = await opportunity(arts, "Festival Sponsorship", "open", "staff");
      const fair = await opportunity(trade, "Trade Fair Stand", "open", "outsider");
      const lapsed = await opportunity(arts, "Old Exhibition", "lost", "staff");
      const proposal = (opportunityId, sent, accepted) =>
        q(
          `INSERT INTO partnership_proposal (partnership_opportunity_id, number, status, created_by, sent_at, accepted_at, value, currency)
           VALUES ($1, $2, 'sent', $3, $4, $5, 2500.00, 'NGN')`,
          [opportunityId, number("PRP"), userOf("ops"), sent, accepted],
        );
      await proposal(festival, ago(3), null);
      await proposal(lapsed, ago(30), null);
      await proposal(fair, ago(9), ago(2));
      const agreement = (partnerId, status, startsOn, value, currency, owner) =>
        q(
          `INSERT INTO partnership_agreement (partner_id, number, title, status, starts_on, value, currency, owner_id)
           VALUES ($1, $2, 'Sponsorship', $3, $4, $5, $6, $7)`,
          [partnerId, number("AGR"), status, startsOn, value, currency, people[owner]],
        );
      await agreement(arts, "signed", "2026-03-01", "5000.00", "NGN", "staff");
      await agreement(trade, "active", "2026-06-01", "1000.00", "USD", "outsider");
      await agreement(arts, "draft", "2026-05-01", "700.00", "NGN", "staff");
      await agreement(arts, "signed", "2025-05-01", "900.00", "NGN", "staff");

      // Expenses and budgets (M8).
      const expense = (key, amount, currency, status) =>
        q(
          `INSERT INTO expense_request (number, employee_id, expense_category_id, purpose, amount, currency, status, submitted_at)
           VALUES ($1, $2, $3, 'Travel to the venue', $4, $5, $6, $7)`,
          [number("EXP"), people[key], travel, amount, currency, status, ago(2)],
        );
      await expense("staff", "1000.50", "NGN", "submitted");
      await expense("staff", "500.00", "USD", "submitted");
      await expense("outsider", "200.00", "NGN", "submitted");
      await expense("staff", "999.00", "NGN", "approved");
      const budget = async (owner, currency, from, to, approved, allocated, spent) => {
        const { budget_id: id } = await one(
          `INSERT INTO budget (number, name, owner_id, currency, starts_on, ends_on, approved_at)
           VALUES ($1, 'Programmes', $2, $3, $4, $5, $6) RETURNING budget_id`,
          [number("BUD"), people[owner], currency, from, to, approved ? ago(30) : null],
        );
        await q(
          "INSERT INTO budget_line (budget_id, expense_category_id, amount, spent_amount) VALUES ($1, $2, $3, $4)",
          [id, travel, allocated, spent],
        );
      };
      await budget("mgr", "NGN", "2026-01-01", "2026-12-31", true, "1000.00", "250.00");
      await budget("outsider", "USD", "2026-01-01", "2026-12-31", true, "100.00", "90.00");
      await budget("mgr", "NGN", "2025-01-01", "2025-12-31", true, "100.00", "100.00");
      await budget("mgr", "NGN", "2026-01-01", "2026-12-31", false, "100.00", "100.00");

      // Alerts (Home's own): a rule People approvers clear, and one for payroll.
      const rule = async (key, permission) =>
        (
          await one(
            `INSERT INTO home_alert_rule (key, name, metric, threshold, severity, permission_key)
             VALUES ($1, $2, 'late_arrivals', 3, 'high', $3) RETURNING home_alert_rule_id`,
            [key, key, permission],
          )
        ).home_alert_rule_id;
      const people_ = await rule("late_arrivals.people", "people.approve");
      const payroll = await rule("late_arrivals.payroll", "payroll.view");
      const alert = (ruleId, subject, severity, raisedDaysAgo, cleared = false) =>
        q(
          `INSERT INTO home_alert (home_alert_rule_id, subject_type, subject_id, subject_employee_id, title, trigger,
                                   severity, over_by, raised_at, cleared_at, outcome)
           VALUES ($1, $2, $3, $4, 'Late arrivals', 'Late three times', $5, 1, $6, $7, $8)`,
          [
            ruleId,
            subject ? "employee" : "partner",
            subject ? people[subject] : "kano-trade-council",
            subject ? people[subject] : null,
            severity,
            ago(raisedDaysAgo),
            cleared ? ago(1) : null,
            cleared ? "cleared" : null,
          ],
        );
      await alert(people_, "staff", "high", 1);
      await alert(people_, "outsider", "high", 1);
      await alert(people_, null, "high", 8);
      await alert(payroll, "staff", "low", 1);
      await alert(people_, "staff2", "high", 2, true);
      await alert(payroll, "staff2", "high", 10);
    });

    test("all scope counts the whole organisation", async () => {
      const { figures } = await reader("ops");
      expect(figures).toMatchObject({
        headcount: { value: 6 },
        attrition_90d: { value: 1 },
        confirmations_due: { value: 1 },
        documentation_pending: { value: 2 },
        leave_pending: { value: 1 },
        vacancies_open: { value: 2 },
        reviews_due: { value: 3 },
        my_reviews_due: { value: 1 },
        tasks_overdue: { value: 3 },
        partnership_pipeline: { value: 2 },
        partnerships_active: { value: 2 },
        partnerships_quiet_30d: { value: 1 },
        proposals_out: { value: 1 },
        alerts_high_open: { value: 4, aged: 2 },
        approvals_awaiting_you: { value: 0 },
      });
      expect(figures.attendance_today).toMatchObject({ value: 2, denominator: 5, late: 1, on_leave: 1, no_clock_out_yesterday: 1 });
      expect(figures.team_present).toMatchObject({ value: 2, denominator: 5 });
      expect(figures.team_on_site).toEqual({ value: 1 });
      expect(figures.team_remote).toEqual({ value: 0 });
      expect(figures.team_flags).toMatchObject({ value: 2, late: 1, no_clock_out_yesterday: 1 });
    });

    test("money: Naira wire strings, other currencies left out of the sum but not the count", async () => {
      const { figures } = await reader("ops");
      expect(figures.expenses_pending).toEqual({ amount: "1200.50", requests: 3 });
      expect(figures.partnerships_signed_value).toEqual({ amount: "5000.00", agreements: 2 });
      expect(figures.budget_vs_actual).toEqual({ value: 25, denominator: 1 });
      const card = kpi.cardOf(kpi.BY_ID.get("expenses_pending"), figures.expenses_pending);
      expect(card).toMatchObject({ amount: "1200.50", value: null, caption: "3 requests" });
      expect(typeof card.amount).toBe("string");
    });

    test("team scope counts the manager and everyone below them", async () => {
      const { figures } = await reader("mgr");
      expect(figures).toMatchObject({
        headcount: { value: 3 },
        attrition_90d: { value: 1 },
        confirmations_due: { value: 1 },
        documentation_pending: { value: 1 },
        leave_pending: { value: 1 },
        reviews_due: { value: 2 },
        my_reviews_due: { value: 1 },
        tasks_overdue: { value: 1 },
        partnership_pipeline: { value: 1 },
        partnerships_active: { value: 1 },
        partnerships_quiet_30d: { value: 0 },
        proposals_out: { value: 1 },
        alerts_high_open: { value: 1, aged: 0 },
        approvals_awaiting_you: { value: 1, overdue: 0 },
        expenses_pending: { amount: "1000.50", requests: 2 },
        partnerships_signed_value: { amount: "5000.00", agreements: 1 },
        budget_vs_actual: { value: 25, denominator: 1 },
      });
      expect(figures.attendance_today).toMatchObject({ value: 1, denominator: 3, late: 0, no_clock_out_yesterday: 1 });
      expect(figures.team_present).toMatchObject({ value: 1, denominator: 3 });
      expect(figures.team_flags).toMatchObject({ value: 1, late: 0, no_clock_out_yesterday: 1 });
    });

    test("own scope counts only the reader's own records", async () => {
      const staff = (await reader("staff")).figures;
      expect(staff).toMatchObject({
        tasks_overdue: { value: 1 },
        my_tasks_overdue: { value: 1 },
        reviews_due: { value: 2 },
        my_reviews_due: { value: 1 },
        partnerships_active: { value: 1 },
        partnerships_quiet_30d: { value: 0 },
        expenses_pending: { amount: "1000.50", requests: 2 },
        budget_vs_actual: { value: 0, denominator: 0 },
        approvals_awaiting_you: { value: 0 },
        my_leave_left: { value: 17, leave_type: "Annual" },
      });
      const outsider = (await reader("outsider")).figures;
      expect(outsider).toMatchObject({
        my_tasks_overdue: { value: 1 },
        partnerships_quiet_30d: { value: 1 },
        expenses_pending: { amount: "200.00", requests: 1 },
        partnerships_signed_value: { amount: "0.00", agreements: 1 },
        my_leave_left: { value: 20 },
      });
    });

    test("My Attendance: the reader's last 30 days, as the attendance module recorded them", async () => {
      const { figures } = await reader("staff");
      // On time Tuesday and today, late Monday. No day-close has run here, so no day is absent yet.
      expect(figures.my_attendance_30d).toMatchObject({
        value: 2,
        denominator: 3,
        late: 1,
        groups: { on_time: 2, late: 1, absent: 0, on_leave: 0 },
      });
      const mine = await attendanceRepo.daysSummary(pool, people.staff, lagos.addDays(TODAY, -29), TODAY);
      expect(mine).toMatchObject({ days_present: 3, late_days: 1, absent_days: 0, leave_days: 0 });
    });

    test("the records behind every card hold exactly what its figure counted, a cell for each column", async () => {
      for (const key of ["ops", "mgr", "staff"]) {
        const { figures, eligible, ctx } = await reader(key);
        for (const id of eligible) {
          const entry = kpi.BY_ID.get(id);
          const f = figures[id];
          const rows = await allRecords(id, ctx);
          const meta = kpi.metaOf(entry, f);
          expect(c.dashboard.HomeKpiDetailMeta.parse(meta)).toEqual(meta);
          const columns = meta.columns.map((col) => col.key).sort();
          for (const row of rows) expect([id, Object.keys(row.cells).sort()]).toEqual([id, columns]);
          const counted = {
            count: () => f.value,
            money: () => (id === "expenses_pending" ? f.requests : f.agreements),
            pct: () => f.denominator,
            pair: () => Object.entries(f.groups).reduce((n, [g, v]) => (g === "no_clock_out_yesterday" ? n : n + v), 0),
            days: () => rows.length,
          }[entry.unit]();
          expect([key, id, rows.length]).toEqual([key, id, counted]);
        }
      }
    });

    test("a chip keeps its own records; one the card does not have is refused", async () => {
      const { figures, ctx } = await reader("ops");
      const late = await allRecords("attendance_today", ctx, { group: "late" });
      expect(late.map((r) => r.cells.employee.person.employee_id)).toEqual([people.outsider]);
      expect(late[0].cells.status).toEqual({ kind: "pill", tone: "warn", text: "Late" });
      const noOut = await allRecords("attendance_today", ctx, { group: "no_clock_out_yesterday" });
      expect(noOut.length).toBe(figures.attendance_today.groups.no_clock_out_yesterday);
      const flags = await allRecords("team_flags", ctx, { group: "no_clock_out_yesterday" });
      expect(flags.map((r) => r.cells.employee.person.employee_id)).toEqual([people.staff2]);
      await expect(
        kpi.detailPage(kpi.BY_ID.get("attendance_today"), pool, { group: "absent" }, ctx),
      ).rejects.toMatchObject({ code: "KPI_GROUP_UNKNOWN" });
    });

    test("records in another currency are listed as written, Naira ones as money", async () => {
      const { ctx } = await reader("ops");
      const rows = await allRecords("expenses_pending", ctx);
      const amounts = rows.map((r) => r.cells.amount).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      expect(amounts).toEqual([
        { kind: "money", amount: "1000.50" },
        { kind: "money", amount: "200.00" },
        { kind: "text", text: "USD 500.00" },
      ]);
    });

    test("a record opens on its own screen; a person's own review on their own view", async () => {
      const staff = await reader("staff");
      const mine = await allRecords("reviews_due", staff.ctx);
      expect(mine.every((r) => r.link.startsWith("/ess?tab=my-performance"))).toBe(true);
      const ops = await reader("ops");
      const theirs = await allRecords("reviews_due", ops.ctx);
      const outsiders = theirs.filter((r) => r.cells.employee.person.employee_id === people.outsider);
      expect(outsiders[0].link).toMatch(/^\/performance\?tab=reviews&id=/);
      const overdue = await allRecords("tasks_overdue", ops.ctx);
      expect(overdue.map((r) => r.cells.task.text).sort()).toEqual(["Book the hall", "Print the badges", "Send the venue list"]);
    });

    test("the Overview paints the reader's cards in order with their figures", async () => {
      const { eligible, figures } = await reader("ops");
      const { ids } = resolve.selectCards({ picks: null, roleCards: [], homeView: "operations", eligible });
      const { cards, hidden } = resolve.paintCards(ids, figures);
      expect(hidden).toEqual([]);
      expect(cards.map((card) => [card.key, card.value, card.amount])).toEqual([
        ["attendance_today", 2, null],
        ["tasks_overdue", 3, null],
        ["expenses_pending", null, "1200.50"],
        ["partnerships_active", 2, null],
      ]);
      for (const card of cards) expect(c.dashboard.HomeKpiCard.parse(card)).toEqual(card);
    });
  });
});
