"use strict";
/**
 * Recruitment's staging seed end to end (seeds/staging/55_recruitment.js, docs/guides/recruitment.md
 * §3, §6): the real migrations, the Implementation Team's build account and a second team account,
 * MyCity's real staff from 10_staff.js as the runner loads them, Home's seed first (whose staging
 * vacancies this seed removes), then this seed twice. Through the services and the candidate's own
 * paths it saves Careers Settings, makes six roles in their states, sends eleven applications through
 * Apply, takes and marks sittings, closes one interview round with its report and leaves one open,
 * and keeps one candidate in the pool. Hiring managers and panelists are the Implementation Team's
 * accounts only; every candidate is @example.test; the second run changes nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/recruitment-staging-seed
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public schema.
 */
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const requestContext = require("../../src/config/request-context");
const { rebuild } = require("./helpers/schema");
const runner = require("../../scripts/db/seed");
const outbox = require("../../src/shared/events/outbox");
const workingWeek = require("../../src/shared/time/working-week");
const realtime = require("../../src/services/realtime/emitter");
const chromium = require("../../src/services/pdf/chromium");
const staffSeed = require("../../seeds/staging/10_staff");
const homeSeed = require("../../seeds/staging/60_home");
const seed = require("../../seeds/staging/55_recruitment");
const { HOME_STAGING_ROWS } = require("../../seeds/staging/lib/home-staging-rows");
const { realStaff } = require("../../seeds/staging/lib/staff");
const { atomically } = require("../../src/shared/db/tx");
const { createAdmin, BUILD_ACCOUNT } = require("../../scripts/db/create-admin");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);

const runFile = (fn, logs = [], extra = {}) =>
  requestContext.run({ requestId: "seed-staging", surface: "script" }, () =>
    fn({ pool, actor: runner.ACTOR, log: (m) => logs.push(m), ...extra }),
  );

/** Run the outbox until it is empty, as the worker would after the seed. */
async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    if ((await outbox.dispatchDue({ db: pool })).claimed === 0) return;
  }
}

const TABLES = ["vacancy", "vacancy_question", "candidate", "application", "assessment_definition", "application_assessment", "interview", "interview_round", "interview_feedback", "talent_pool_entry"];
async function counts() {
  const out = {};
  for (const table of TABLES) out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}

describeDb("Recruitment's staging seed against the real migrations", () => {
  let first;
  let second;
  let staff;
  const logs = [];

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    await q("INSERT INTO system_marker (environment) VALUES ('test')");
    workingWeek.invalidateCalendar();
    outbox.markReady();
    // Our own accounts, in the Implementation department, as on staging: the build account and a
    // teammate's, made before the roster so the loader gives the build account its line to the CTO.
    const team = [
      { ...BUILD_ACCOUNT, employee: { ...BUILD_ACCOUNT.employee, work_email: "build@jbspraxis.test" } },
      {
        ...BUILD_ACCOUNT,
        employee: { ...BUILD_ACCOUNT.employee, first_name: "Ada", middle_name: "Grace", last_name: "Builder", preferred_name: "Ada", work_email: "ada@jbspraxis.test" },
      },
      // A teammate without Recruitment (an Employee login): never a hiring manager or a panelist, or every
      // role they managed and every panel they sat on would be refused.
      {
        ...BUILD_ACCOUNT,
        role_code: "employee",
        employee: { ...BUILD_ACCOUNT.employee, first_name: "Obi", middle_name: "Chuka", last_name: "Helper", preferred_name: "Obi", work_email: "obi@jbspraxis.test" },
      },
    ];
    for (const account of team) {
      const client = await pool.connect();
      try {
        await atomically(client, () => createAdmin(client, account, "A-long-Test-password-1!", { allowAdditional: true }));
      } finally {
        client.release();
      }
    }
    await runFile(staffSeed);
    await runFile(homeSeed, [], { now: new Date() });
    await runFile(seed, logs);
    await settle();
    first = await counts();
    await runFile(seed, logs);
    await settle();
    second = await counts();
    staff = await realStaff(pool);
  }, 300_000);

  afterAll(async () => {
    await chromium.close();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("nothing it tried stopped", () => {
    expect(logs.filter((m) => m.includes("stopped"))).toEqual([]);
  });

  test("Home's staging vacancies are gone, and the six roles are made in their states", async () => {
    const homeIds = HOME_STAGING_ROWS.find((e) => e.table === "vacancy").ids;
    expect((await q("SELECT count(*)::int AS n FROM vacancy WHERE vacancy_id = ANY($1::uuid[])", [homeIds])).rows[0].n).toBe(0);
    const { rows } = await q("SELECT title, status::text AS status, close_reason::text AS close_reason, work_pattern::text AS work_pattern, location, slug::text AS slug FROM vacancy ORDER BY number");
    expect(rows.map((r) => [r.title, r.status])).toEqual([
      ["Head, Sales & Revenue", "open"],
      ["Graphics and Motion Designer", "open"],
      ["Content Producer", "open"],
      ["Customer Support Lead", "paused"],
      ["Backend Engineer", "draft"],
      ["Partnerships Associate", "closed"],
    ]);
    expect(rows[0]).toMatchObject({ work_pattern: "hybrid", location: expect.stringContaining("Lekki") });
    expect(rows[5].close_reason).toBe("filled");
  });

  test("Careers Settings hold MyCity's ten traits, and each role's card rates them", async () => {
    const { rows } = await q("SELECT value FROM setting WHERE key = 'recruitment.default_traits'");
    expect(rows[0].value).toEqual(seed.TRAITS);
    const sales = await q(
      `SELECT q.purpose::text AS purpose, q.prompt FROM vacancy_question q JOIN vacancy v ON v.vacancy_id = q.vacancy_id
        WHERE v.title = 'Head, Sales & Revenue' AND q.active ORDER BY q.purpose, q.display_order`,
    );
    expect(sales.rows.filter((r) => r.purpose === "application").map((r) => r.prompt)).toEqual([
      "Have you led a sales team of five or more?",
      "The largest deal you closed, and your part in it",
    ]);
    expect(sales.rows.filter((r) => r.purpose === "interview").map((r) => r.prompt)).toEqual([...seed.TRAITS]);
    const design = await q(
      `SELECT c.code::text AS code, c.active FROM recruitment_scorecard_criterion c JOIN vacancy v ON v.vacancy_id = c.vacancy_id WHERE v.title = 'Graphics and Motion Designer'`,
    );
    expect(design.rows.filter((p) => !p.active).map((p) => p.code).sort()).toEqual(["case_study", "psychometric"]);
  });

  test("hiring managers and panelists are the Implementation Team's accounts; every candidate is @example.test", async () => {
    const everyone = staff.everyone.filter((p) => p.department === "Implementation");
    expect(everyone).toHaveLength(3);
    const helper = everyone.find((p) => p.work_email === "obi@jbspraxis.test").employee_id;
    const team = everyone.map((p) => p.employee_id).filter((id) => id !== helper);
    const managers = (await q("SELECT DISTINCT hiring_manager_id FROM vacancy")).rows.map((r) => r.hiring_manager_id);
    expect(managers.every((id) => team.includes(id))).toBe(true);
    const panel = (await q("SELECT DISTINCT employee_id FROM interview_panelist")).rows.map((r) => r.employee_id);
    expect(panel.length).toBeGreaterThan(0);
    expect(panel.every((id) => team.includes(id))).toBe(true);
    // Six roles and three interviews, though one teammate holds no Recruitment.
    expect((await q("SELECT count(*)::int AS n FROM vacancy")).rows[0].n).toBe(6);
    expect((await q("SELECT count(*)::int AS n FROM interview")).rows[0].n).toBe(3);
    const emails = (await q("SELECT email::text AS email FROM candidate")).rows.map((r) => r.email);
    expect(emails).toHaveLength(11);
    expect(emails.every((e) => e.endsWith("@example.test"))).toBe(true);
  });

  test("applications came through Apply with a CV, and stand where the recruiter left them", async () => {
    const { rows } = await q(
      `SELECT k.first_name, a.stage::text AS stage, a.status::text AS status, a.source::text AS source, a.cv_document_id, a.provisional_score
         FROM application a JOIN candidate k ON k.candidate_id = a.candidate_id`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.first_name, r]));
    expect(rows.every((r) => r.cv_document_id && r.provisional_score !== null)).toBe(true);
    expect(by.Kunle.stage).toBe("shortlist");
    expect(by.Emeka.stage).toBe("assessment");
    expect(by.Chinedu.stage).toBe("application");
    expect(by.Femi).toMatchObject({ stage: "screening", status: "not_progressed" });
    const pool_ = await q("SELECT k.first_name FROM talent_pool_entry e JOIN candidate k ON k.candidate_id = e.candidate_id WHERE e.removed_at IS NULL");
    expect(pool_.rows.map((r) => r.first_name)).toEqual(["Femi"]);
  });

  test("sittings: one waiting to be marked, two scored, one not started", async () => {
    const { rows } = await q(
      `SELECT k.first_name, d.name, s.status::text AS status, s.score
         FROM application_assessment s JOIN application a ON a.application_id = s.application_id
         JOIN candidate k ON k.candidate_id = a.candidate_id JOIN assessment_definition d ON d.assessment_definition_id = s.assessment_definition_id`,
    );
    const at = (who, what) => rows.find((r) => r.first_name === who && r.name === what);
    expect(at("Ngozi", "Graphics and Motion Design Brief").status).toBe("submitted");
    expect(at("Emeka", "Sales Scenario Case Study")).toMatchObject({ status: "scored" });
    expect(Number(at("Emeka", "Sales Scenario Case Study").score)).toBeCloseTo(73.3, 1);
    expect(at("Emeka", "Work Style Profile").status).toBe("scored");
    expect(at("Segun", "Graphics and Motion Design Brief").status).toBe("sent");
  });

  test("a round closed with every card, its report and its form; one open with a card waiting; one to come", async () => {
    const { rows } = await q(
      `SELECT k.first_name, r.status::text AS round, r.report, r.form_document_id, r.interview_score,
              (SELECT count(*)::int FROM interview_panelist p JOIN interview_feedback f ON f.interview_panelist_id = p.interview_panelist_id
                WHERE p.interview_id = i.interview_id AND f.submitted_at IS NOT NULL) AS cards
         FROM interview i JOIN interview_round r ON r.interview_round_id = i.interview_round_id
         JOIN application a ON a.application_id = r.application_id JOIN candidate k ON k.candidate_id = a.candidate_id`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.first_name, r]));
    expect(by.Kunle).toMatchObject({ round: "closed", cards: 2 });
    expect(by.Kunle.report).toMatch(/proven sales leader/);
    expect(by.Kunle.form_document_id).toBeTruthy();
    expect(Number(by.Kunle.interview_score)).toBeGreaterThan(70);
    expect(by.Tobi).toMatchObject({ round: "open", cards: 1 });
    expect(by.Halima).toMatchObject({ round: "open", cards: 0 });
  });

  test("a second run adds nothing", () => {
    expect(second).toEqual(first);
  });

  // Last: it changes what the runs above made.
  test("a role renamed on staging is still the seed's, and a person's role with a seeded title is never taken for one", async () => {
    const c = require("@mycity/contract");
    const grantsCache = require("../../src/shared/rbac/grants-cache");
    const vacancies = require("../../src/modules/vacancies/vacancies.service");
    const lagos = require("../../src/shared/time/lagos");
    const at = async (title) => (await q("SELECT vacancy_id, department_id, hiring_manager_id FROM vacancy WHERE title = $1", [title])).rows;
    const [content] = await at("Content Producer");
    await q("UPDATE vacancy SET title = 'Content Producer, Video' WHERE vacancy_id = $1", [content.vacancy_id]);
    const [support] = await at("Customer Support Lead");
    const ops = { ...(await grantsCache.getAuthUser(pool, staff.operations.user_id)), ip: null };
    const theirs = await requestContext.run({ requestId: "a-person", surface: "api" }, () =>
      vacancies.create(
        ops,
        { scope: "all", scope_ids: null },
        c.vacancies.VacancyCreate.parse({
          title: "Customer Support Lead",
          department_id: support.department_id,
          hiring_manager_id: support.hiring_manager_id,
          positions: 1,
          employment_type: "full_time",
          work_pattern: "remote",
          description: "A second support lead, written by a person on staging, which the seed must leave alone.",
          requirements: "Four years in customer support.",
          closes_on: lagos.addDays(lagos.today(), 30),
        }),
      ),
    );
    const before = await counts();
    await runFile(seed, logs);
    await settle();
    const after = await counts();
    expect(after).toEqual(before);
    expect(await at("Content Producer")).toEqual([]);
    const apps = async (id) => (await q("SELECT count(*)::int AS n FROM application WHERE vacancy_id = $1", [id])).rows[0].n;
    expect(await apps(content.vacancy_id)).toBeGreaterThan(0);
    expect(await apps(theirs.vacancy_id)).toBe(0);
    expect((await q("SELECT status::text AS s FROM vacancy WHERE vacancy_id = $1", [theirs.vacancy_id])).rows[0].s).toBe("draft");
    expect((await q("SELECT status::text AS s FROM vacancy WHERE vacancy_id = $1", [support.vacancy_id])).rows[0].s).toBe("paused");
  });
});
