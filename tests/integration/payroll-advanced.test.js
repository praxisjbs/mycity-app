"use strict";
/**
 * M6 PR 5 and PR 11, the advanced option end to end (docs/guides/payroll.md §3.5, §5, §6.11, §6.12, §6.14, §13.1 items
 * 39 to 46, Appendix A), on the real migrations, over HTTP with every response parsed by its contract (APP_ENV=test),
 * through the workflow engine and the outbox:
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/payroll-advanced
 *
 * THE FIGURES HERE ARE TEST FIGURES. Every rate, band, cap and wage below is invented for this file and labelled so;
 * their shapes follow §6.16, but none is Nigerian law, none is in any seed, and none may be copied into one (§6.12 rule 5).
 * They are round figures so the expected amounts can be worked by hand in the comments. Each version names a TEST SOURCE,
 * labelled so, or No Legal Source: no instrument says any of them.
 *
 * Configurations refuses a day in the past, so the configuration is entered with Lagos's "today" moved back (a spy on
 * shared/time/lagos.today), exactly as MyCity would enter it ahead of the month: the employee pension from 1 September
 * and the option switched on from that day, the rest from 1 October. The people's side is entered on the real day:
 * NHF chosen, States, a rent declaration, a Pay to Date. Then the runs are opened on the real day: August simple,
 * September advanced with no PAYE table (No Rates Set), October advanced in full once the earlier runs are sent, and
 * November reading October's year to date (with a PAYE Refund). Every person is invented.
 */
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const aiRegistry = require("../../src/shared/ai/registry");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const token = require("../../src/shared/places/token");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Adv-Anced9Test";
const AUG = "2026-08-01";
const SEP = "2026-09-01";
const OCT = "2026-10-01";
const NOV = "2026-11-01";

/** A TEST SOURCE, labelled: no instrument says any of the test rates (§6.12 rule 12 asks every version for one). */
const TEST_SOURCE = { source_title: "TEST SOURCE, not a law", source_section: "Test section 1", source_checked_on: "2026-08-01" };
const NO_SOURCE = { no_legal_source: true, no_source_reason: "Test rate for this file, not a law" };

/**
 * TEST FIGURES, invented for this file (never law, never seeded): a year's PAYE bands of 0% to 600,000.00, 10% to
 * 2,400,000.00 and 20% above, taken cumulatively with the bands scaled to the months elapsed (§6.12 rule 11); pension 5%
 * and 7%; NHF 2% of gross; ITF and NSITF 0.5%; rent relief 10% of the year's rent, at most 300,000.00; a minimum wage of
 * 50,000.00 a month, entered with No Legal Source to show one.
 */
const TEST_RATES = {
  pension_employee: { item: "pension_employee", rate: "5", ...TEST_SOURCE },
  pension_employer: { item: "pension_employer", rate: "7", ...TEST_SOURCE },
  nhf: { item: "nhf", rate: "2", ...TEST_SOURCE },
  itf: { item: "itf", rate: "0.5", ...TEST_SOURCE },
  nsitf: { item: "nsitf", rate: "0.5", ...TEST_SOURCE },
  rent_relief: { item: "rent_relief", rate: "10", flat_amount: "300000.00", ...TEST_SOURCE },
  minimum_wage: { item: "minimum_wage", flat_amount: "50000.00", ...NO_SOURCE },
  paye: {
    item: "paye",
    ...TEST_SOURCE,
    bands: [
      { band_from: "0.00", band_to: "600000.00", rate: "0" },
      { band_from: "600000.00", band_to: "2400000.00", rate: "10" },
      { band_from: "2400000.00", band_to: null, rate: "20" },
    ],
  },
};
/** A place as our search signs it: an address is picked, never typed (F27). */
const place = (formatted) => ({
  token: token.sign({ source: "search", formatted, lat: 6.45, lon: 3.42, provider_id: `test:${formatted}`, kind: "building", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false }),
});
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

describeDb("the advanced option against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const ids = {};
  const runs = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) => request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    del: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    stage: () =>
      request(app)
        .post("/api/v1/documents")
        .set("Authorization", `Bearer ${tokens[who]}`)
        .field("purpose", "document")
        .attach("file", pdf(), { filename: "test-source.pdf", contentType: "application/pdf" }),
  });
  const employeeId = (who) => ids[who] || people[who].employee.employee_id;

  /** Run `fn` with Lagos's today on `day`, the way MyCity enters configuration ahead of a month. */
  async function on(day, fn) {
    const spy = jest.spyOn(lagos, "today").mockReturnValue(day);
    try {
      return await fn();
    } finally {
      spy.mockRestore();
    }
  }

  async function hire(key, gross) {
    const dept = (await one("SELECT department_id FROM department ORDER BY name LIMIT 1")).department_id;
    const row = await one(
      `INSERT INTO employee (staff_number, first_name, last_name, work_email, job_title, department_id, employment_type, work_pattern,
                             status, start_date, gross_monthly, bank_name, account_number)
       VALUES ($1, $2, 'Tester', $3, 'Officer', $4, 'full_time', 'on_site', 'active', '2026-01-05', $5, 'Test Bank', '0123456789')
       RETURNING employee_id`,
      [`A${String(Object.keys(ids).length + 1).padStart(4, "0")}`, key[0].toUpperCase() + key.slice(1), `${key}@mycity.test`, dept, gross],
    );
    ids[key] = row.employee_id;
  }

  const lines = async (runId, who) =>
    (
      await q(
        `SELECT l.kind, l.code, l.label, l.detail, l.amount::text AS amount, l.base_amount::text AS base_amount
           FROM payslip_line l JOIN payslip s ON s.payslip_id = l.payslip_id
          WHERE s.payroll_run_id = $1 AND s.employee_id = $2 ORDER BY l.position`,
        [runId, employeeId(who)],
      )
    ).rows;
  const slip = (runId, who) =>
    one(
      `SELECT earnings_total::text AS earnings, deductions_total::text AS deductions, net_pay::text AS net, employer_total::text AS employer,
              taxable_pay::text AS taxable
         FROM payslip WHERE payroll_run_id = $1 AND employee_id = $2`,
      [runId, employeeId(who)],
    );
  const problemsOf = async (runId) => (await as("ops").get(`/payroll/runs/${runId}/problems`)).body.data;

  async function openAndCompute(period) {
    const made = await as("ops").post("/payroll/runs", { period });
    expect(made.status).toBe(201);
    const computed = await as("ops").post(`/payroll/runs/${made.body.payroll_run_id}/compute`);
    expect(computed.status).toBe(200);
    return computed.body;
  }

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    aiRegistry.load();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    // A role that may run payroll but not configure it: `payroll` edit without `payroll.configure`.
    await q(`INSERT INTO role (code, name) VALUES ('payroll_clerk', 'Payroll Clerk') ON CONFLICT (code) DO NOTHING`);
    await q(
      `INSERT INTO permission (role_id, module_key, can_view, can_create, can_edit, can_export, scope)
       SELECT role_id, 'payroll', true, true, true, true, 'all' FROM role WHERE code = 'payroll_clerk'`,
    );

    const make = (who, first, last, role, isCeo = false) =>
      tx(async (client) => {
        people[who] = await createAdmin(
          client,
          {
            employee: {
              first_name: first,
              last_name: last,
              work_email: `${who}@mycity.test`,
              phone: "08031234567",
              job_title: "Officer",
              department_name: "Programmes",
              start_date: "2026-01-05",
              employment_type: "full_time",
              work_pattern: "on_site",
            },
            role_code: role,
            is_ceo: isCeo,
          },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people");
    await make("ceo", "Amaka", "Eze", "management", true);
    await make("staff", "Musa", "Danjuma", "employee");
    await make("clerk", "Kemi", "Ade", "payroll_clerk");
    for (const [who, gross] of [["ops", "250000.00"], ["ceo", "500000.00"], ["staff", "200000.00"], ["clerk", "180000.00"]])
      await q("UPDATE employee SET gross_monthly = $2, bank_name = 'Test Bank', account_number = '0000111122' WHERE employee_id = $1", [employeeId(who), gross]);

    // The company week: Monday to Saturday (A22); no holiday in August or September 2026.
    await q("DELETE FROM working_week");
    for (let weekday = 1; weekday <= 7; weekday += 1)
      await q("INSERT INTO working_week (weekday, is_working_day, starts_at, ends_at) VALUES ($1, $2, $3, $4)", [
        weekday,
        weekday <= 6,
        weekday <= 6 ? "09:00" : null,
        weekday <= 6 ? "17:00" : null,
      ]);
    await q("INSERT INTO public_holiday (holiday_date, name) VALUES ('2026-10-01', 'Independence Day') ON CONFLICT (holiday_date) DO NOTHING");
    workingWeek.invalidateCalendar();

    await hire("ada", "450000.00");
    await hire("bola", "300000.00");
    // Paid exactly the TEST minimum wage: no PAYE, and NHF if they choose it (§13.1 items 44 and 45).
    await hire("chidi", "50000.00");

    await grantsCache.bumpTeamVersion();
    await drain();
    for (const who of ["ops", "ceo", "staff", "clerk"]) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.76.0.${ip}`)
        .send({ email: `${who}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("with nothing entered the run is simple, the pay day the default 30, and Salary Structure waits for the option", async () => {
    const s = await as("ops").get("/payroll/settings");
    expect(s.status).toBe(200);
    expect(s.body).toEqual({
      advanced_enabled: false,
      advanced_has_been_on: false,
      pay_day: 30,
      pay_day_is_default: true,
      require_bank_details: false,
      current: null,
      next: null,
    });
    expect((await as("ops").get("/statutory/rates")).body.data).toEqual([]);
    const items = (await as("ops").get("/statutory/items")).body.items;
    expect(items.map((i) => i.item)).toEqual(["paye", "pension_employee", "pension_employer", "nhf", "itf", "nsitf", "rent_relief", "minimum_wage"]);
    expect(items.every((i) => i.current === null && i.next === null)).toBe(true);
    expect((await as("ops").get("/salary-structure/grades")).body.error.code).toBe("ADVANCED_OFF");
    expect((await as("ops").get("/salary-structure/placements")).body.error.code).toBe("ADVANCED_OFF");
    expect((await as("ops").get(`/salary-structure/employees/${employeeId("ada")}/components`)).body.error.code).toBe("ADVANCED_OFF");
    expect((await as("staff").get("/payroll/settings")).status).toBe(403);
    expect(await q("SELECT count(*)::int AS n FROM statutory_rate").then((r) => r.rows[0].n)).toBe(0);
  });

  test("a change needs payroll.configure, never starts in the past, and the conventions are no longer asked", async () => {
    const clerk = await as("clerk").patch("/payroll/settings", { effective_from: lagos.today(), pay_day: 28 });
    expect(clerk.status).toBe(403);
    expect(clerk.body.error.code).toBe("CAPABILITY_REQUIRED");
    expect((await as("clerk").post("/statutory/rates", { ...TEST_RATES.nhf, effective_from: lagos.today() })).body.error.code).toBe("CAPABILITY_REQUIRED");
    expect((await as("ceo").get("/payroll/settings")).status).toBe(200);

    const past = await as("ops").post("/statutory/rates", { ...TEST_RATES.nhf, effective_from: "2026-01-01" });
    expect(past.status).toBe(422);
    expect(past.body.error).toMatchObject({ code: "EFFECTIVE_IN_THE_PAST", fields: { effective_from: ["Date too early"] } });

    const early = await as("ops").patch("/payroll/settings", { effective_from: "2026-01-01", pay_day: 28 });
    expect(early.body.error.code).toBe("EFFECTIVE_IN_THE_PAST");

    // The law settles the conventions (§6.12 rule 14): a change naming one is refused as a key the API does not take.
    const conventions = await as("ops").patch("/payroll/settings", { effective_from: lagos.today(), advanced_enabled: true, pension_reduces_taxable: true });
    expect([conventions.status, conventions.body.error.code]).toEqual([422, "VALIDATION_FAILED"]);

    const noRates = await as("ops").patch("/payroll/settings", { effective_from: lagos.today(), advanced_enabled: true });
    expect(noRates.status).toBe(409);
    expect(noRates.body.error.code).toBe("NO_RATES");
  });

  test("a version is checked as it is entered: bands one by one, each item's own shape and bases, the old relief refused", async () => {
    const gap = await as("ops").post("/statutory/rates", {
      item: "paye",
      effective_from: lagos.today(),
      ...TEST_SOURCE,
      bands: [
        { band_from: "0.00", band_to: "1000.00", rate: "10" },
        { band_from: "2000.00", band_to: null, rate: "20" },
      ],
    });
    expect(gap.status).toBe(422);
    expect(gap.body.error.fields).toMatchObject({ "bands.1.band_from": ["Start where last ends"] });
    const open = await as("ops").post("/statutory/rates", {
      item: "paye",
      effective_from: lagos.today(),
      ...TEST_SOURCE,
      bands: [
        { band_from: "0.00", band_to: null, rate: "10" },
        { band_from: "1000.00", band_to: null, rate: "20" },
      ],
    });
    expect(open.body.error.fields).toMatchObject({ "bands.0.band_to": ["Only the last is open"] });
    const rated = await as("ops").post("/statutory/rates", { item: "pension_employee", effective_from: lagos.today(), ...TEST_SOURCE, bands: TEST_RATES.paye.bands });
    expect(rated.status).toBe(422);
    expect(Object.keys(rated.body.error.fields)).toEqual(expect.arrayContaining(["bands", "rate"]));
    // NHF is on gross pay, never basic (§6.16); rent relief needs its cap; the minimum wage takes an amount, no rate.
    const basic = await as("ops").post("/statutory/rates", { item: "nhf", rate: "2", base: "basic", effective_from: lagos.today(), ...TEST_SOURCE });
    expect(basic.body.error.fields).toMatchObject({ base: ["Not a base for this"] });
    const noCap = await as("ops").post("/statutory/rates", { item: "rent_relief", rate: "10", effective_from: lagos.today(), ...TEST_SOURCE });
    expect(noCap.body.error.fields).toMatchObject({ flat_amount: ["Enter the cap"] });
    const wageRate = await as("ops").post("/statutory/rates", { item: "minimum_wage", rate: "1", flat_amount: "50000.00", effective_from: lagos.today(), ...TEST_SOURCE });
    expect(wageRate.body.error.fields).toMatchObject({ rate: ["Not for this item"] });
    // The Consolidated Relief Allowance's shape is retired (§13.1 item 41): it is refused on save.
    const relief = await as("ops").post("/statutory/rates", { item: "relief", rate: "10", flat_amount: "100000.00", effective_from: lagos.today(), ...NO_SOURCE });
    expect(relief.status).toBe(422);
    expect(Object.keys(relief.body.error.fields)).toEqual(["item"]);
  });

  test("the first rate is entered while the option is off, and the option switches on from a day with nothing more asked", async () => {
    await on("2026-08-20", async () => {
      const pension = await as("ops").post("/statutory/rates", { ...TEST_RATES.pension_employee, effective_from: SEP });
      expect(pension.status).toBe(201);
      expect(pension.body.data).toEqual([
        expect.objectContaining({ item: "pension_employee", kind: "employee", base: "pensionable", rate: "5", effective_from: SEP, effective_to: null }),
      ]);

      const on1 = await as("ops").patch("/payroll/settings", { effective_from: SEP, advanced_enabled: true, reason: "Test rates in place" });
      expect(on1.status).toBe(200);
      // It starts later: today is still simple, the next version is the advanced one.
      expect(on1.body).toMatchObject({ advanced_enabled: false, advanced_has_been_on: true, current: null });
      expect(on1.body.next).toMatchObject({ advanced_enabled: true, effective_from: SEP, changed_by_name: "Tunde Bakare" });
      expect(on1.body.next).not.toHaveProperty("paye_basis");

      // A second change for the same day joins that day's version.
      const payDay = await as("ops").patch("/payroll/settings", { effective_from: SEP, pay_day: 28 });
      expect(payDay.status).toBe(200);
      expect(payDay.body.next).toMatchObject({ advanced_enabled: true, pay_day: 28 });
      expect((await q("SELECT count(*)::int AS n FROM payroll_setting")).rows[0].n).toBe(1);
    });
    const audit = await one(`SELECT count(*)::int AS n FROM event_log WHERE event_key = 'payroll_setting.changed'`);
    expect(audit.n).toBe(2);
    // The convention columns stay in the table, unwritten (a merged migration is never edited).
    expect(await one("SELECT paye_basis, pension_reduces_taxable, nhf_reduces_taxable FROM payroll_setting")).toEqual({ paye_basis: null, pension_reduces_taxable: null, nhf_reduces_taxable: null });
  });

  test("the rest of the test figures from October, a PAYE table replaced on its own day, and nothing in any seed", async () => {
    await on("2026-09-15", async () => {
      for (const key of ["pension_employer", "nhf", "itf", "nsitf", "rent_relief", "minimum_wage"]) {
        const res = await as("ops").post("/statutory/rates", { ...TEST_RATES[key], effective_from: OCT });
        expect(res.status).toBe(201);
      }
      const first = await as("ops").post("/statutory/rates", {
        item: "paye",
        effective_from: OCT,
        ...TEST_SOURCE,
        bands: [
          { band_from: "0.00", band_to: "1000000.00", rate: "10" },
          { band_from: "1000000.00", band_to: null, rate: "20" },
        ],
      });
      expect(first.body.data).toHaveLength(2);
      const replaced = await as("ops").post("/statutory/rates", { ...TEST_RATES.paye, effective_from: OCT });
      expect(replaced.status).toBe(201);
      expect(replaced.body.data.map((r) => [r.position, r.band_from, r.band_to, r.rate])).toEqual([
        [1, "0.00", "600000.00", "0"],
        [2, "600000.00", "2400000.00", "10"],
        [3, "2400000.00", null, "20"],
      ]);
      // The pension from September carries on, alongside October's rows; nothing earlier is touched.
      const listed = (await as("ops").get("/statutory/rates")).body.data;
      expect(listed.map((r) => r.item)).toEqual(["paye", "paye", "paye", "pension_employee", "pension_employer", "nhf", "itf", "nsitf", "rent_relief", "minimum_wage"]);
      const september = (await as("ops").get(`/statutory/rates?as_of=${SEP}`)).body.data;
      expect(september.map((r) => r.item)).toEqual(["pension_employee"]);
      // The eight items in brief: the pension in force since September, the rest starting in October.
      const items = (await as("ops").get("/statutory/items")).body.items;
      const of = (item) => items.find((i) => i.item === item);
      expect(of("pension_employee")).toMatchObject({ kind: "employee", bases: ["pensionable", "gross"], current: { rate: "5", base: "pensionable", effective_from: SEP }, next: null });
      expect(of("paye")).toMatchObject({ current: null, next: { bands: 3, rate: null, base: "taxable", effective_from: OCT } });
      expect(of("nhf")).toMatchObject({ bases: ["gross"], next: { base: "gross", rate: "2" } });
      expect(of("rent_relief").next).toMatchObject({ rate: "10", flat_amount: "300000.00", base: "rent" });
      expect(of("minimum_wage").next).toMatchObject({ rate: null, flat_amount: "50000.00", base: "gross", no_legal_source: true });
      expect(of("itf")).toMatchObject({ kind: "employer", bases: ["annual_payroll"] });
    });
    expect((await q("SELECT count(*)::int AS n FROM statutory_rate WHERE item = 'paye'")).rows[0].n).toBe(3);

    // A relief row saved before PR 11 (the Consolidated Relief Allowance's shape) stays in the table, never shown.
    await q(
      `INSERT INTO statutory_rate (item, kind, base, rate, flat_amount, effective_from, no_legal_source, no_source_reason)
       VALUES ('relief', 'employee', 'gross', 10, 100000, '2026-09-01', true, 'Entered before PR 11 for this test')`,
    );
    expect((await as("ops").get("/statutory/rates")).body.data.map((r) => r.item)).not.toContain("relief");
    expect((await as("ops").get(`/statutory/rates?as_of=${OCT}`)).body.data.map((r) => r.item)).not.toContain("relief");
  });

  test("grades, placements and a pay split, each from a day; a split must add up to the gross", async () => {
    await on("2026-08-25", async () => {
      const g1 = await as("ops").post("/salary-structure/grades", { code: "t1", name: "Test Band One", minimum: "200000.00", maximum: "400000.00", effective_from: SEP });
      expect(g1.status).toBe(201);
      expect(g1.body).toMatchObject({ code: "T1", band_minimum: "200000.00", band_maximum: "400000.00", staff: 0 });
      const wrong = await as("ops").post("/salary-structure/grades", { code: "T2", name: "Upside Down", minimum: "500000.00", maximum: "400000.00", effective_from: SEP });
      expect(wrong.body.error.fields).toMatchObject({ maximum: ["Not below the minimum"] });

      const placedAda = await as("ops").put(`/salary-structure/placements/${employeeId("ada")}`, { salary_grade_id: g1.body.salary_grade_id, effective_from: SEP });
      expect(placedAda.status).toBe(200);
      expect(placedAda.body).toMatchObject({ grade_code: null, effective_from: null });
      const placedBola = await as("ops").put(`/salary-structure/placements/${employeeId("bola")}`, { salary_grade_id: g1.body.salary_grade_id, effective_from: SEP });
      expect(placedBola.status).toBe(200);

      const notGross = await as("ops").put(`/salary-structure/employees/${employeeId("ada")}/components`, {
        effective_from: SEP,
        components: [{ code: "basic", label: "Basic", amount: "250000.00", pensionable: true }],
      });
      expect(notGross.status).toBe(422);
      expect(notGross.body.error).toMatchObject({ code: "SPLIT_NOT_GROSS", fields: { components: ["Must equal the gross"] } });
      const noBasic = await as("ops").put(`/salary-structure/employees/${employeeId("ada")}/components`, {
        effective_from: SEP,
        components: [{ code: "housing", label: "Housing", amount: "450000.00", pensionable: true }],
      });
      expect(noBasic.body.error.fields).toMatchObject({ components: ["Add a basic component"] });

      const split = await as("ops").put(`/salary-structure/employees/${employeeId("ada")}/components`, {
        effective_from: SEP,
        components: [
          { code: "basic", label: "Basic", amount: "250000.00", pensionable: true },
          { code: "housing", label: "Housing", amount: "150000.00", pensionable: true },
          { code: "transport", label: "Transport", amount: "50000.00", pensionable: false },
        ],
      });
      expect(split.status).toBe(200);
      expect(split.body.current).toBeNull();
      expect(split.body.next.components.map((x) => [x.code, x.pay_amount, x.pensionable])).toEqual([
        ["basic", "250000.00", true],
        ["housing", "150000.00", true],
        ["transport", "50000.00", false],
      ]);
    });

    // On the real day both are placed: Ada above the band's maximum, Bola within it. Flagged, never blocked.
    const placements = (await as("ops").get("/salary-structure/placements")).body.data;
    const of = (name) => placements.find((p) => p.employee.display_name === name);
    expect(of("Ada Tester")).toMatchObject({ grade_code: "T1", band_position: "above", has_pay_split: true, gross_pay: "450000.00" });
    expect(of("Bola Tester")).toMatchObject({ grade_code: "T1", band_position: "within", has_pay_split: false });
    expect(of("Musa Danjuma")).toMatchObject({ grade_code: null, band_position: null });
    const above = (await as("ops").get("/salary-structure/placements?band_position=above")).body.data;
    expect(above.map((p) => p.employee.display_name)).toEqual(["Ada Tester"]);
    const grades = (await as("ops").get("/salary-structure/grades")).body.data;
    expect(grades).toEqual([expect.objectContaining({ code: "T1", staff: 2, above_maximum: 1, below_minimum: 0 })]);
  });

  test("each person's side through the organisation service: NHF by choice, the State, the tax numbers", async () => {
    const ada = await as("ops").patch(`/employees/${employeeId("ada")}`, { nhf_contributes: true, state_of_residence: "lagos", pension_pin: "PEN000000000TEST" });
    expect(ada.status).toBe(200);
    expect(ada.body).toMatchObject({ nhf_contributes: true, state_of_residence: "lagos", pension_pin: "PEN000000000TEST", nhf_number: null });
    expect((await as("ops").patch(`/employees/${employeeId("chidi")}`, { nhf_contributes: true })).status).toBe(200);
    const bola = await as("ops").patch(`/employees/${employeeId("bola")}`, { state_of_residence: "ogun", tax_id: "tin-0000-test" });
    expect(bola.body).toMatchObject({ nhf_contributes: false, state_of_residence: "ogun", tax_id: "TIN-0000-TEST" });
    expect((await as("ops").patch(`/employees/${employeeId("bola")}`, { state_of_residence: "atlantis" })).status).toBe(422);
    // NHF is off until chosen, for anyone added since.
    expect(await one("SELECT nhf_contributes, state_of_residence FROM employee WHERE employee_id = $1", [employeeId("staff")])).toEqual({ nhf_contributes: false, state_of_residence: null });

    // A role whose mask hides tax and pension may not set them, and reads them as null.
    const opsRole = await one("SELECT role_id FROM role WHERE code = 'operations_people'");
    await q("INSERT INTO field_visibility (role_id, field_key, visibility) VALUES ($1, 'employee.statutory', 'masked') ON CONFLICT (role_id, field_key) DO UPDATE SET visibility = 'masked'", [opsRole.role_id]);
    await grantsCache.invalidateGrants();
    try {
      const hidden = await as("ops").patch(`/employees/${employeeId("bola")}`, { nhf_contributes: true });
      expect([hidden.status, hidden.body.error.code]).toEqual([403, "FIELD_RESTRICTED"]);
      expect((await as("ops").get(`/employees/${employeeId("ada")}`)).body).toMatchObject({ nhf_contributes: null, state_of_residence: null, pension_pin: null });
      const rents = await as("ops").get(`/employees/${employeeId("ada")}/rent-declarations`);
      expect([rents.status, rents.body.error.code]).toEqual([403, "FIELD_RESTRICTED"]);
    } finally {
      await q("UPDATE field_visibility SET visibility = 'visible' WHERE role_id = $1 AND field_key = 'employee.statutory'", [opsRole.role_id]);
      await grantsCache.invalidateGrants();
    }
  });

  test("a rent declaration for the year, with its address picked and its evidence from the vault (§13.1 item 41)", async () => {
    const evidence = await as("ops").stage();
    expect(evidence.status).toBe(201);
    const body = {
      rent_paid: "1200000.00",
      covers_from: "2026-01-01",
      covers_to: "2026-12-01",
      tenant_name: "Ada Tester",
      landlord_name: "Test Landlord",
      landlord_phone: "08031234567",
      property_address: place("12 Test Street, Lagos"),
      evidence_document_id: evidence.body.document_id,
    };
    const year = Number(lagos.today().slice(0, 4));
    const path = `/employees/${employeeId("ada")}/rent-declarations`;
    // This year or the next; the months must reach the year; the landlord is named with a number, a Tax ID or a NIN.
    expect((await as("ops").put(`${path}/${year + 2}`, body)).body.error).toMatchObject({ code: "YEAR_NOT_ALLOWED", fields: { year: ["This year or next"] } });
    expect((await as("ops").put(`${path}/${year}`, { ...body, covers_from: "2025-01-01", covers_to: "2025-12-01" })).body.error.code).toBe("COVERS_OUTSIDE_YEAR");
    const { landlord_phone: _phone, ...noLandlordId } = body;
    expect((await as("ops").put(`${path}/${year}`, noLandlordId)).body.error.fields).toMatchObject({ landlord_phone: ["Give one landlord ID"] });
    expect((await as("ops").put(`${path}/${year}`, { ...body, property_address: { details: "Typed" } })).status).toBe(422);

    const saved = await as("ops").put(`${path}/${year}`, body);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ year, rent_paid: "1200000.00", year_rent: "1200000.00", property_address: "12 Test Street, Lagos", evidence_document_id: evidence.body.document_id, entered_by_name: "Tunde Bakare" });
    expect(saved.body.property_address_place).toMatchObject({ formatted: "12 Test Street, Lagos", verified: true });
    const doc = await one("SELECT doc_type, sensitivity, entity_type, entity_id, subject_employee_id FROM document WHERE document_id = $1", [evidence.body.document_id]);
    expect(doc).toEqual({ doc_type: "rent_evidence", sensitivity: "restricted", entity_type: "employee", entity_id: employeeId("ada"), subject_employee_id: employeeId("ada") });
    // Saved again with the same evidence, it is replaced, not doubled.
    expect((await as("ops").put(`${path}/${year}`, { ...body, landlord_name: "Test Landlord Two" })).body.landlord_name).toBe("Test Landlord Two");
    const listed = (await as("ops").get(path)).body;
    expect(listed.data).toHaveLength(1);
    expect(listed.page).toMatchObject({ size: 25, total: 1 });

    // A declaration made in error is taken away with its place.
    const bolaPath = `/employees/${employeeId("bola")}/rent-declarations/${year}`;
    const bolaDoc = await as("ops").stage();
    expect((await as("ops").put(bolaPath, { ...body, tenant_name: "Bola Tester", evidence_document_id: bolaDoc.body.document_id })).status).toBe(200);
    expect((await as("ops").del(bolaPath)).status).toBe(204);
    expect((await as("ops").del(bolaPath)).status).toBe(404);
    expect(await one("SELECT count(*)::int AS n FROM place WHERE owner = 'employee_rent_declaration.property_address'")).toEqual({ n: 1 });
    const events = (await q(`SELECT event_key, payload FROM event_log WHERE event_key LIKE 'employee.rent_%' ORDER BY occurred_at`)).rows;
    expect(events.map((e) => e.event_key)).toEqual(["employee.rent_declared", "employee.rent_declared", "employee.rent_declared", "employee.rent_declaration_removed"]);
    expect(JSON.stringify(events)).not.toMatch(/1200000/);
  });

  test("a Pay to Date for the year, entered with payroll.configure, its certificate claimed (§13.1 item 42)", async () => {
    const path = (who, y) => `/statutory/employees/${employeeId(who)}/pay-to-date${y ? `/${y}` : ""}`;
    const year = Number(lagos.today().slice(0, 4));
    expect((await as("clerk").put(path("bola", year), { taxable_pay: "2000000.00", tax_paid: "100000.00" })).body.error.code).toBe("CAPABILITY_REQUIRED");
    expect((await as("ops").put(path("bola", year + 2), { taxable_pay: "2000000.00", tax_paid: "100000.00" })).body.error.code).toBe("YEAR_NOT_ALLOWED");
    const saved = await as("ops").put(path("bola", year), { taxable_pay: "2000000.00", tax_paid: "100000.00" });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ year, taxable_pay: "2000000.00", tax_paid: "100000.00", document_id: null, entered_by_name: "Tunde Bakare" });
    // A previous employer's leaving certificate, from the upload engine (here with nothing to carry, so the figures stay).
    const cert = await as("ops").stage();
    expect((await as("ops").put(path("ada", year), { taxable_pay: "0.00", tax_paid: "0.00", document_id: cert.body.document_id })).status).toBe(200);
    expect(await one("SELECT doc_type, sensitivity, entity_type FROM document WHERE document_id = $1", [cert.body.document_id])).toEqual({
      doc_type: "leaving_certificate",
      sensitivity: "restricted",
      entity_type: "salary_structure",
    });
    expect((await as("ops").get(path("bola"))).body.data.map((r) => [r.year, r.taxable_pay])).toEqual([[year, "2000000.00"]]);
    expect((await as("staff").get(path("bola"))).status).toBe(403);
    expect((await as("ops").get("/statutory/employees/00000000-0000-4000-8000-000000000000/pay-to-date")).status).toBe(404);
    const event = await one(`SELECT payload FROM event_log WHERE event_key = 'pay_to_date.saved' ORDER BY occurred_at LIMIT 1`);
    expect(event.payload).toMatchObject({ employee_id: employeeId("bola"), year, created: true });
    expect(JSON.stringify(event.payload)).not.toMatch(/2000000|100000/);
  });

  test("the mode is the month's: August simple, September advanced with no PAYE table, October once the earlier runs are sent", async () => {
    const aug = await openAndCompute(AUG);
    runs.aug = aug.payroll_run_id;
    expect(aug.advanced).toBe(false);
    expect(await lines(runs.aug, "ada")).toEqual([
      { kind: "earning", code: "monthly_pay", label: "Monthly Pay", detail: null, amount: "450000.00", base_amount: null },
    ]);
    expect((await slip(runs.aug, "ada")).taxable).toBeNull();

    const sep = await openAndCompute(SEP);
    runs.sep = sep.payroll_run_id;
    expect(sep.advanced).toBe(true);
    // The split's lines and the one rate in force: 5% of the pensionable pay, never less than basic, housing and transport
    // (450,000.00, though Transport is not marked pensionable); no PAYE table yet, so nothing is taxed.
    expect((await lines(runs.sep, "ada")).map((l) => [l.code, l.label, l.amount, l.base_amount])).toEqual([
      ["monthly_pay", "Basic", "250000.00", null],
      ["monthly_pay", "Housing", "150000.00", null],
      ["monthly_pay", "Transport", "50000.00", null],
      ["pension_employee", "Pension", "22500.00", "450000.00"],
    ]);
    const problems = await problemsOf(runs.sep);
    // August is still open: September waits for it too (both blocking, weight first, then by code).
    expect(problems.filter((p) => p.severity === "blocking").map((p) => p.code)).toEqual(["EARLIER_RUN_OPEN", "NO_RATES"]);
    expect(problems.filter((p) => p.code === "NO_PAY_SPLIT").map((p) => p.employee.display_name)).toContain("Bola Tester");
    const refused = await as("ops").post(`/payroll/runs/${runs.sep}/submit`, {});
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("RUN_HAS_PROBLEMS");
    expect((await one(`SELECT config_snapshot FROM payroll_run WHERE payroll_run_id = $1`, [runs.sep])).config_snapshot.statutory_missing).toEqual(["paye"]);

    // October waits for the year's earlier runs: their PAYE is what it reads (§6.15).
    const first = await openAndCompute(OCT);
    runs.oct = first.payroll_run_id;
    const waiting = (await problemsOf(runs.oct)).find((p) => p.code === "EARLIER_RUN_OPEN");
    expect(waiting).toMatchObject({ severity: "blocking", employee: null, message: "2 earlier runs this year are still open" });
    const augTotals = (await as("ops").get(`/payroll/runs/${runs.aug}`)).body;
    const sent = await as("ops").post(`/payroll/runs/${runs.aug}/submit`, { expected_net_total: augTotals.net_pay });
    expect(sent.status).toBe(200);
    expect((await as("ceo").post(`/workflow/instances/${sent.body.workflow_instance_id}/approve`, {})).status).toBe(200);
    await drain();
    expect((await as("ops").del(`/payroll/runs/${runs.sep}`)).status).toBe(204);
    const oct = (await as("ops").post(`/payroll/runs/${runs.oct}/compute`)).body;
    expect(oct.advanced).toBe(true);
    expect((await problemsOf(runs.oct)).filter((p) => p.severity === "blocking")).toEqual([]);

    // Ada, the TEST FIGURES by hand: pension 5% and NHF 2% of 450,000.00 (22,500.00, 9,000.00); taxable 418,500.00; the
    // year starts at nothing here (§13.1 item 42) and the rent relief to date is 10% of 1,200,000.00 × 10/12 = 100,000.00,
    // so 318,500.00 against the 0% band × 10/12 (500,000.00): no PAYE this month. MyCity's 7% is 31,500.00; ITF and NSITF
    // 0.5% of 450,000.00, 2,250.00 each.
    expect((await lines(runs.oct, "ada")).map((l) => [l.kind, l.code, l.label, l.amount, l.base_amount])).toEqual([
      ["earning", "monthly_pay", "Basic", "250000.00", null],
      ["earning", "monthly_pay", "Housing", "150000.00", null],
      ["earning", "monthly_pay", "Transport", "50000.00", null],
      ["deduction", "pension_employee", "Pension", "22500.00", "450000.00"],
      ["deduction", "nhf", "NHF", "9000.00", "450000.00"],
      ["employer", "pension_employer", "Employer Pension", "31500.00", "450000.00"],
      ["employer", "itf", "ITF", "2250.00", "450000.00"],
      ["employer", "nsitf", "NSITF", "2250.00", "450000.00"],
    ]);
    expect(await slip(runs.oct, "ada")).toEqual({ earnings: "450000.00", deductions: "31500.00", net: "418500.00", employer: "36000.00", taxable: "418500.00" });
    // Bola: no split, no NHF chosen, a Pay to Date of 2,000,000.00 and 100,000.00. Pension 15,000.00; taxable 285,000.00;
    // to date 2,285,000.00 against the bands × 10/12: 150,000.00 + 57,000.00 = 207,000.00, less 100,000.00: PAYE 107,000.00.
    expect((await lines(runs.oct, "bola")).map((l) => [l.kind, l.code, l.amount, l.base_amount])).toEqual([
      ["earning", "monthly_pay", "300000.00", null],
      ["deduction", "pension_employee", "15000.00", "300000.00"],
      ["deduction", "paye", "107000.00", "285000.00"],
      ["employer", "pension_employer", "21000.00", "300000.00"],
      ["employer", "itf", "1500.00", "300000.00"],
      ["employer", "nsitf", "1500.00", "300000.00"],
    ]);
    expect(await slip(runs.oct, "bola")).toEqual({ earnings: "300000.00", deductions: "122000.00", net: "178000.00", employer: "24000.00", taxable: "285000.00" });
    // Chidi is paid the TEST minimum wage: no PAYE and the month kept out of the year to date; NHF, chosen, at the wage.
    expect((await lines(runs.oct, "chidi")).map((l) => [l.code, l.amount])).toEqual([
      ["monthly_pay", "50000.00"],
      ["pension_employee", "2500.00"],
      ["nhf", "1000.00"],
      ["pension_employer", "3500.00"],
      ["itf", "250.00"],
      ["nsitf", "250.00"],
    ]);
    expect((await slip(runs.oct, "chidi")).taxable).toBeNull();
    const run = await as("ops").get(`/payroll/runs/${runs.oct}`);
    expect(run.body.employer_cost).toBe(
      (await one(`SELECT sum(employer_total)::text AS s FROM payslip WHERE payroll_run_id = $1 AND status <> 'excluded'`, [runs.oct])).s,
    );
    const snapshot = (await one(`SELECT config_snapshot FROM payroll_run WHERE payroll_run_id = $1`, [runs.oct])).config_snapshot;
    expect(snapshot).toMatchObject({ advanced: true, paye_method: "cumulative", statutory_missing: [] });
    expect(snapshot).not.toHaveProperty("conventions");
    expect(snapshot.statutory_rates.filter((r) => r.item === "paye")).toHaveLength(3);
    expect(snapshot.statutory_rates.map((r) => r.item)).not.toContain("relief");
    expect(snapshot.statutory_rates.find((r) => r.item === "nhf")).toMatchObject({ source_title: "TEST SOURCE, not a law", source_section: "Test section 1", no_legal_source: false });
    expect(snapshot.statutory_rates.find((r) => r.item === "minimum_wage")).toMatchObject({ flat_amount: "50000.00", no_legal_source: true, no_source_reason: NO_SOURCE.no_source_reason });
  });

  test("a past month keeps its figures when a new version starts later, and switching off waits for its day", async () => {
    const raised = await as("ops").post("/statutory/rates", { ...TEST_RATES.pension_employee, rate: "8", effective_from: "2026-12-01" });
    expect(raised.status).toBe(201);
    await as("ops").post(`/payroll/runs/${runs.oct}/compute`);
    expect((await lines(runs.oct, "ada")).find((l) => l.code === "pension_employee").amount).toBe("22500.00");
    expect((await as("ops").del("/statutory/rates/pension_employee/versions/2026-12-01")).status).toBe(204);
    const off = await as("ops").patch("/payroll/settings", { effective_from: "2026-12-01", advanced_enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ advanced_enabled: true, advanced_has_been_on: true });
    expect(off.body.next).toMatchObject({ advanced_enabled: false, pay_day: 28, effective_from: "2026-12-01" });
    expect((await as("ops").del("/payroll/settings/versions/2026-12-01")).status).toBe(204);
    // The Salary Structure stays reachable: the option has been on.
    expect((await as("ops").get("/salary-structure/grades")).status).toBe(200);
  });

  test("October approved, the statutory report prints the bases, the sources, the remittances and PAYE by State", async () => {
    // A report waits for the approval: the run's figures are locked first.
    expect((await as("ops").post(`/payroll/runs/${runs.oct}/statutory-report`)).body.error.code).toBe("NOT_APPROVED");
    const totals = (await as("ops").get(`/payroll/runs/${runs.oct}`)).body;
    const submitted = await as("ops").post(`/payroll/runs/${runs.oct}/submit`, { expected_net_total: totals.net_pay });
    expect(submitted.status).toBe(200);
    const approved = await as("ceo").post(`/workflow/instances/${submitted.body.workflow_instance_id}/approve`, {});
    expect(approved.status).toBe(200);
    await drain();
    expect((await as("ops").get(`/payroll/runs/${runs.oct}`)).body.status).toBe("approved");

    expect((await as("staff").post(`/payroll/runs/${runs.oct}/statutory-report`)).status).toBe(403);
    const report = await as("ops").post(`/payroll/runs/${runs.oct}/statutory-report`);
    expect(report.status).toBe(202);
    const doc = await one(`SELECT doc_type, sensitivity, render_status, render_html FROM document WHERE document_id = $1`, [report.body.document_id]);
    expect(doc).toMatchObject({ doc_type: "statutory_report", sensitivity: "restricted", render_status: "pending" });
    const html = doc.render_html;
    expect(html).toContain("Statutory Report");
    expect(html).toContain("TIN-0000-TEST");
    expect(html).toContain("PEN000000000TEST");
    expect(html).toContain("Not Set");
    expect(html).toContain("₦107,000.00");
    expect(html).toContain("₦285,000.00");
    expect(html).toContain('<p class="sr-group">Ogun</p>');
    expect(html).toContain("Remit: By 10/11/2026");
    expect(html).toContain("On the year to date, the year&#39;s bands scaled to the months elapsed");
    expect(html).not.toContain("PAYE Basis");
    // Each item's source as the run kept it, rent relief's and the minimum wage's in the box (§6.12 rules 6 and 12).
    expect(html).toContain("Source: TEST SOURCE, not a law, Test section 1. Checked 01/08/2026");
    expect(html).toContain("rent declared, at most ₦300,000.00");
    expect(html).toContain("₦50,000.00 a month: no PAYE at or below it. Source: No Legal Source: Test rate for this file, not a law");
    const event = await one(`SELECT payload FROM event_log WHERE event_key = 'payroll_run.statutory_report_requested' ORDER BY occurred_at DESC LIMIT 1`);
    expect(event.payload).toMatchObject({ payroll_run_id: runs.oct, document_id: report.body.document_id });
    expect(JSON.stringify(event.payload)).not.toMatch(/107000|285000/);
  });

  test("November reads October's year to date: PAYE on the cumulative figures, and a corrected Pay to Date refunded", async () => {
    // Bola's previous figures were wrong: 180,000.00 of tax, not 100,000.00. A run already sent keeps what it read.
    const year = Number(lagos.today().slice(0, 4));
    expect((await as("ops").put(`/statutory/employees/${employeeId("bola")}/pay-to-date/${year}`, { taxable_pay: "2000000.00", tax_paid: "180000.00" })).status).toBe(200);
    const nov = await openAndCompute(NOV);
    runs.nov = nov.payroll_run_id;
    expect(nov.advanced).toBe(true);
    // Ada: to date 2 × 418,500.00 = 837,000.00, less rent relief × 11/12 (110,000.00) = 727,000.00; the bands × 11/12
    // tax 10% above 550,000.00: 17,700.00, and nothing deducted before.
    expect((await lines(runs.nov, "ada")).find((l) => l.code === "paye")).toMatchObject({ amount: "17700.00", base_amount: "418500.00" });
    // Bola: to date 2,000,000.00 + 2 × 285,000.00 = 2,570,000.00; the bands × 11/12: 165,000.00 + 74,000.00 = 239,000.00,
    // less 180,000.00 and October's 107,000.00 = -48,000.00: a PAYE Refund, an earning (reg 4(2)).
    expect((await lines(runs.nov, "bola")).map((l) => [l.kind, l.code, l.amount])).toEqual([
      ["earning", "monthly_pay", "300000.00"],
      ["earning", "paye_refund", "48000.00"],
      ["deduction", "pension_employee", "15000.00"],
      ["employer", "pension_employer", "21000.00"],
      ["employer", "itf", "1500.00"],
      ["employer", "nsitf", "1500.00"],
    ]);
    expect(await slip(runs.nov, "bola")).toMatchObject({ earnings: "348000.00", deductions: "15000.00", net: "333000.00" });
    // October's run, approved, is untouched.
    expect((await lines(runs.oct, "bola")).find((l) => l.code === "paye").amount).toBe("107000.00");
  });

  test("a simple run has no statutory report", async () => {
    const report = await as("ops").post(`/payroll/runs/${runs.aug}/statutory-report`);
    expect(report.status).toBe(409);
    expect(report.body.error.code).toBe("ADVANCED_OFF");
  });

  test("every version names its source or No Legal Source: SOURCE_REQUIRED on the field, a document from the vault", async () => {
    const at = { item: "nhf", rate: "3", effective_from: "2027-02-01" };
    const none = await as("ops").post("/statutory/rates", at);
    expect(none.status).toBe(422);
    expect(none.body.error).toMatchObject({
      code: "SOURCE_REQUIRED",
      fields: { source_title: ["Name the source"], source_section: ["Name the section"], source_checked_on: ["Pick the day checked"] },
    });
    const noReason = await as("ops").post("/statutory/rates", { ...at, no_legal_source: true });
    expect(noReason.body.error).toMatchObject({ code: "SOURCE_REQUIRED", fields: { no_source_reason: ["Give a reason"] } });
    const both = await as("ops").post("/statutory/rates", { ...at, ...TEST_SOURCE, ...NO_SOURCE });
    expect(both.body.error).toMatchObject({ code: "VALIDATION_FAILED", fields: { source_title: ["Not with No Source"] } });
    const later = await as("ops").post("/statutory/rates", { ...at, ...TEST_SOURCE, source_checked_on: "2099-01-01" });
    expect(later.status).toBe(422);
    expect(later.body.error).toMatchObject({ code: "CHECKED_IN_THE_FUTURE", fields: { source_checked_on: ["Not after today"] } });

    // The instrument goes through the upload engine and is claimed by the save; a file someone else staged is refused.
    const theirs = await as("clerk").stage();
    expect(theirs.status).toBe(201);
    const stolen = await as("ops").post("/statutory/rates", { ...at, ...TEST_SOURCE, source_document_id: theirs.body.document_id });
    expect([stolen.status, stolen.body.error.fields]).toEqual([422, { source_document_id: ["Upload it again"] }]);
    const mine = await as("ops").stage();
    const saved = await as("ops").post("/statutory/rates", {
      ...at,
      ...TEST_SOURCE,
      source_url: "https://example.test/test-source.pdf",
      source_document_id: mine.body.document_id,
    });
    expect(saved.status).toBe(201);
    expect(saved.body.data).toEqual([
      expect.objectContaining({
        item: "nhf",
        effective_from: "2027-02-01",
        source_title: "TEST SOURCE, not a law",
        source_section: "Test section 1",
        source_url: "https://example.test/test-source.pdf",
        source_document_id: mine.body.document_id,
        source_checked_on: "2026-08-01",
        no_legal_source: false,
        no_source_reason: null,
      }),
    ]);
    const doc = await one("SELECT doc_type, sensitivity, entity_type FROM document WHERE document_id = $1", [mine.body.document_id]);
    expect(doc).toEqual({ doc_type: "statutory_source", sensitivity: "restricted", entity_type: "statutory_return" });
    // Restricted: payroll edit opens it, an employee does not even learn it exists.
    expect((await as("ops").get(`/documents/${mine.body.document_id}`)).status).toBe(200);
    expect((await as("staff").get(`/documents/${mine.body.document_id}`)).status).toBe(404);

    // One law serves many versions: a later one names the same document again.
    const again = await as("ops").post("/statutory/rates", { item: "nhf", rate: "4", effective_from: "2027-03-01", ...TEST_SOURCE, source_document_id: mine.body.document_id });
    expect(again.status).toBe(201);
    const noSource = await as("ops").post("/statutory/rates", { item: "itf", rate: "1", effective_from: "2027-02-01", ...NO_SOURCE });
    expect(noSource.status).toBe(201);
    expect(noSource.body.data[0]).toMatchObject({ no_legal_source: true, no_source_reason: NO_SOURCE.no_source_reason, source_title: null });

    // The items carry the source back, current and next.
    const items = (await as("ops").get("/statutory/items")).body.items;
    const nhf = items.find((i) => i.item === "nhf");
    expect(nhf.current).toMatchObject({ effective_from: OCT, source_title: "TEST SOURCE, not a law", no_legal_source: false });
    expect(nhf.next).toMatchObject({ effective_from: "2027-02-01", source_document_id: mine.body.document_id });
    expect(items.find((i) => i.item === "minimum_wage").current).toMatchObject({ no_legal_source: true, source_title: null });

    // The table holds a row to one or the other, whoever writes it.
    const bare = q(
      `INSERT INTO statutory_rate (item, kind, base, rate, effective_from, effective_to) VALUES ('nsitf', 'employer', 'annual_payroll', 1, '2020-01-01', '2020-02-01')`,
    );
    await expect(bare).rejects.toMatchObject({ code: "23514", constraint: "statutory_rate_source_check" });
    const event = await one(`SELECT payload FROM event_log WHERE event_key = 'statutory_rate.saved' ORDER BY occurred_at DESC LIMIT 1`);
    expect(event.payload).toMatchObject({ item: "itf", no_legal_source: true });
    expect(JSON.stringify(event.payload)).not.toMatch(/"rate"/);
  });

  test("Remove Change takes back a version still waiting, and the version before it runs on; one in force stays", async () => {
    const nhfRows = async () =>
      (await q(`SELECT rate::text AS rate, effective_from::text AS f, effective_to::text AS t FROM statutory_rate WHERE item = 'nhf' ORDER BY effective_from`)).rows;
    expect(await nhfRows()).toEqual([
      { rate: "2.000000", f: OCT, t: "2027-02-01" },
      { rate: "3.000000", f: "2027-02-01", t: "2027-03-01" },
      { rate: "4.000000", f: "2027-03-01", t: null },
    ]);
    expect((await as("clerk").del("/statutory/rates/nhf/versions/2027-02-01")).body.error.code).toBe("CAPABILITY_REQUIRED");

    // The middle version goes: October runs on to March's first day.
    const middle = await as("ops").del("/statutory/rates/nhf/versions/2027-02-01");
    expect(middle.status).toBe(204);
    expect(await nhfRows()).toEqual([
      { rate: "2.000000", f: OCT, t: "2027-03-01" },
      { rate: "4.000000", f: "2027-03-01", t: null },
    ]);
    // The last goes: October is open again.
    expect((await as("ops").del("/statutory/rates/nhf/versions/2027-03-01")).status).toBe(204);
    expect(await nhfRows()).toEqual([{ rate: "2.000000", f: OCT, t: null }]);
    const nhf = (await as("ops").get("/statutory/items")).body.items.find((i) => i.item === "nhf");
    expect(nhf).toMatchObject({ current: { effective_from: OCT }, next: null });

    // A version in force is history; a day no version starts on is not found.
    const inForce = await as("ops").del(`/statutory/rates/nhf/versions/${OCT}`);
    expect(inForce.status).toBe(409);
    expect(inForce.body.error).toMatchObject({ code: "VERSION_IN_FORCE", fields: { effective_from: ["Already in force"] } });
    expect((await as("ops").del("/statutory/rates/nhf/versions/2027-05-01")).status).toBe(404);
    expect((await as("ops").del("/statutory/rates/nhf/versions/not-a-day")).status).toBe(422);

    // A PAYE table goes whole, and the table before it, three bands, is open again.
    const table = await as("ops").post("/statutory/rates", {
      item: "paye",
      effective_from: "2027-02-01",
      ...TEST_SOURCE,
      bands: [
        { band_from: "0.00", band_to: "500000.00", rate: "5" },
        { band_from: "500000.00", band_to: "2000000.00", rate: "15" },
        { band_from: "2000000.00", band_to: null, rate: "25" },
      ],
    });
    expect(table.status).toBe(201);
    expect((await as("ops").del("/statutory/rates/paye/versions/2027-02-01")).status).toBe(204);
    const paye = (await q(`SELECT position, effective_from::text AS f, effective_to::text AS t FROM statutory_rate WHERE item = 'paye' ORDER BY position`)).rows;
    expect(paye).toEqual([
      { position: 1, f: OCT, t: null },
      { position: 2, f: OCT, t: null },
      { position: 3, f: OCT, t: null },
    ]);
    const removed = (await q(`SELECT payload FROM event_log WHERE event_key = 'statutory_rate.removed' ORDER BY occurred_at`)).rows.map((r) => r.payload);
    expect(removed.map((p) => [p.item, p.effective_from, p.rows])).toEqual([
      ["pension_employee", "2026-12-01", 1],
      ["nhf", "2027-02-01", 1],
      ["nhf", "2027-03-01", 1],
      ["paye", "2027-02-01", 3],
    ]);
    expect(removed[1].runs_on).toEqual({ effective_from: OCT, rows: 1 });
    expect(JSON.stringify(removed)).not.toMatch(/"rate"/);
  });

  test("Remove Change on the setting, and on a version a run sent for approval was computed with", async () => {
    const later = await as("ops").patch("/payroll/settings", { effective_from: "2027-02-01", pay_day: 31 });
    expect(later.body.next).toMatchObject({ pay_day: 31, effective_from: "2027-02-01" });
    expect((await as("clerk").del("/payroll/settings/versions/2027-02-01")).body.error.code).toBe("CAPABILITY_REQUIRED");
    expect((await as("ops").del("/payroll/settings/versions/2027-02-01")).status).toBe(204);
    const now = (await as("ops").get("/payroll/settings")).body;
    expect(now.next).toBeNull();
    expect(now.current).toMatchObject({ effective_from: SEP, effective_to: null, advanced_enabled: true, pay_day: 28 });
    expect((await as("ops").del(`/payroll/settings/versions/${SEP}`)).body.error.code).toBe("VERSION_IN_FORCE");
    const audit = await one(
      `SELECT l.payload, a.before FROM event_log l JOIN audit_ledger a ON a.event_id = l.event_id
        WHERE l.event_key = 'payroll_setting.removed' ORDER BY l.occurred_at DESC LIMIT 1`,
    );
    expect(audit.payload).toMatchObject({ effective_from: "2027-02-01" });
    expect(audit.before).toMatchObject({ pay_day: 31 });

    // November's run, advanced, is sent and approved with a pay day and a pension rate waiting from 20 November.
    await on("2026-11-11", async () => {
      expect((await as("ops").patch("/payroll/settings", { effective_from: "2026-11-20", pay_day: 31 })).status).toBe(200);
      expect((await as("ops").post("/statutory/rates", { ...TEST_RATES.pension_employee, rate: "9", effective_from: "2026-11-20" })).status).toBe(201);
      const submitted = await as("ops").post(`/payroll/runs/${runs.nov}/submit`, {});
      expect(submitted.status).toBe(200);
      expect((await as("ceo").post(`/workflow/instances/${submitted.body.workflow_instance_id}/approve`, {})).status).toBe(200);
      await drain();
      expect((await as("ops").get(`/payroll/runs/${runs.nov}`)).body.status).toBe("approved");
      // The run read the pay day at its month's end, so that change stays...
      const read = await as("ops").del("/payroll/settings/versions/2026-11-20");
      expect(read.status).toBe(409);
      expect(read.body.error).toMatchObject({ code: "VERSION_IN_FORCE", fields: { effective_from: ["A run uses it"] } });
      // ...and so did the pension rate from that day, which it was computed with.
      const rate = await as("ops").del("/statutory/rates/pension_employee/versions/2026-11-20");
      expect(rate.body.error).toMatchObject({ code: "VERSION_IN_FORCE", fields: { effective_from: ["A run uses it"] } });
    });
  });

  test("the contract carries no rate: every figure on the wire came from a row entered here", () => {
    expect(c.statutory.ITEM_KIND).toMatchObject({ paye: "employee", pension_employer: "employer", itf: "employer", nsitf: "employer", rent_relief: "employee", minimum_wage: "employee" });
  });
});
