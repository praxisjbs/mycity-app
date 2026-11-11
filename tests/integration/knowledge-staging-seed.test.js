"use strict";
/**
 * The Knowledge Hub's staging seed end to end (seeds/staging/90_knowledge.js,
 * docs/guides/knowledge.md Appendix A PR 6): the real migrations, the Implementation Team's build
 * account and a second team account, MyCity's real staff from 10_staff.js as the runner loads them,
 * then the seed twice. Through the services it publishes two SOPs for each of MyCity's five
 * departments, quietly, one of them twice; builds and publishes the two real courses with their
 * videos, lessons, printed PDFs and links; and assigns NDPA to the Implementation department only.
 * The second run changes nothing.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/knowledge-staging-seed
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
const versions = require("../../src/modules/knowledge/knowledge.versions");
const staffSeed = require("../../seeds/staging/10_staff");
const seed = require("../../seeds/staging/90_knowledge");
const { SOPS } = require("../../seeds/staging/knowledge/sops");
const { COURSES } = require("../../seeds/staging/knowledge/courses");
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

const runFile = (fn, logs = []) =>
  requestContext.run({ requestId: "seed-staging", surface: "script" }, () => fn({ pool, actor: runner.ACTOR, log: (m) => logs.push(m) }));

/** Run the outbox until it is empty, as the worker would after the seed. */
async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    if ((await outbox.dispatchDue({ db: pool })).claimed === 0) return;
  }
}

const TABLES = ["sop", "sop_version", "sop_step", "training_course", "training_item", "training_assignment", "training_enrolment", "document", "task", "notification"];
async function counts() {
  const out = {};
  for (const table of TABLES) out[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return out;
}

describeDb("The Knowledge Hub's staging seed against the real migrations", () => {
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
    // Our own accounts, in the Implementation department, as on staging.
    const team = [
      { ...BUILD_ACCOUNT, employee: { ...BUILD_ACCOUNT.employee, work_email: "build@jbspraxis.test" } },
      {
        ...BUILD_ACCOUNT,
        employee: { ...BUILD_ACCOUNT.employee, first_name: "Ada", middle_name: "Grace", last_name: "Builder", preferred_name: "Ada", work_email: "ada@jbspraxis.test" },
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
    await settle();
    await q("DELETE FROM notification");
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

  test("runs without a part stopping", () => {
    expect(logs.filter((m) => /stopped|left out|nobody/.test(m) && !m.includes("nobody told"))).toEqual([]);
  });

  test("publishes two SOPs for each of MyCity's five departments, each by someone who may write it", async () => {
    const { rows } = await q(
      `SELECT d.name AS department, s.title, s.number, s.created_by, v.version, v.note, v.purpose
         FROM sop s JOIN department d ON d.department_id = s.department_id
         JOIN sop_version v ON v.sop_id = s.sop_id AND v.status = 'published'
        ORDER BY d.name, s.title, v.version`,
    );
    const sops = [...new Set(rows.map((r) => `${r.department}|${r.title}`))];
    expect(sops).toHaveLength(SOPS.length);
    expect(sops.sort()).toEqual(SOPS.map((s) => `${s.department}|${s.title}`).sort());
    const per = {};
    for (const s of SOPS) per[s.department] = (per[s.department] || 0) + 1;
    expect(Object.values(per)).toEqual([2, 2, 2, 2, 2]);
    expect(rows.every((r) => /^SOP-/.test(r.number) && r.purpose.length >= 10)).toBe(true);
    // A head writes their own department's; Operations & People (sops.manage) the rest.
    const writers = new Set(rows.map((r) => r.created_by));
    expect(writers.has(null)).toBe(false);
    expect(writers.has(staff.operations.user_id)).toBe(true);
  });

  test("publishes Leave Request Handling twice, so Versions has a history with its note", async () => {
    const { rows } = await q(
      `SELECT v.version, v.note, st.text
         FROM sop s JOIN sop_version v ON v.sop_id = s.sop_id AND v.status = 'published'
         JOIN sop_step st ON st.sop_version_id = v.sop_version_id AND st.position = 3
        WHERE s.title = 'Leave Request Handling' ORDER BY v.version`,
    );
    expect(rows.map((r) => Number(r.version))).toEqual([1, 2]);
    expect(rows[0].note).toBeNull();
    expect(rows[1].note).toMatch(/two working days/);
    expect(rows[0].text).toMatch(/three working days/);
    expect(rows[1].text).toMatch(/two working days/);
  });

  test("links steps to screens the route map knows, so they list under Procedures", async () => {
    const { rows } = await q("SELECT DISTINCT screen_key FROM sop_step WHERE screen_key IS NOT NULL");
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) expect(versions.screenOf(r.screen_key)).toBeTruthy();
    const knowledge = require("../../src/modules/knowledge/knowledge.service");
    const page = await knowledge.forScreen({ screen_key: "partnerships/leads", page: 1 });
    expect(page.data.map((s) => s.title)).toEqual(expect.arrayContaining(["Lead Outreach"]));
  });

  test("tells nobody of an SOP: staging sends real mail, and MyCity's staff are never its audience", async () => {
    const { rows } = await q("SELECT count(*)::int AS n FROM notification WHERE event_key = 'knowledge.sop.published'");
    expect(rows[0].n).toBe(0);
  });

  test("builds both courses with their videos, lessons, printed PDFs and links, published and in the Library", async () => {
    const { rows: courses } = await q(
      `SELECT title, status, library, proof_required, proof_prompt, signer_name, signature_document_id, training_course_id
         FROM training_course ORDER BY title`,
    );
    expect(courses.map((r) => [r.title, r.status, r.library, r.proof_required])).toEqual([
      ["NDPA Data Protection Essentials", "published", true, false],
      ["Partner Outreach", "published", true, true],
    ]);
    expect(courses.every((r) => r.signature_document_id && r.signer_name)).toBe(true);
    for (const plan of COURSES) {
      const course = courses.find((r) => r.title === plan.title);
      const { rows: items } = await q(
        `SELECT i.kind, i.title, i.url, i.lesson_markdown, d.mime, d.original_name, d.bytes
           FROM training_item i LEFT JOIN document d ON d.document_id = i.document_id
          WHERE i.training_course_id = $1 ORDER BY i.position`,
        [course.training_course_id],
      );
      expect(items.map((i) => [i.kind, i.title])).toEqual(plan.items.map((i) => [i.kind, i.title]));
      for (const i of items.filter((x) => x.kind === "video")) expect(i.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
      for (const i of items.filter((x) => x.kind === "lesson")) expect(i.lesson_markdown).toMatch(/^## /);
      const files = items.filter((x) => x.kind === "file");
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ mime: "application/pdf", original_name: `${plan.items.find((i) => i.kind === "file").pdf}.pdf` });
      expect(Number(files[0].bytes)).toBeGreaterThan(20_000);
    }
    const training = require("../../src/modules/training/training.service");
    const ndpa = await training.get(courses[0].training_course_id);
    expect(ndpa.items.filter((i) => i.kind === "video").map((i) => i.youtube_id)).toEqual(["D_jI9YNRoBs", "LfnlK-4viSo", "a8QqTOL7_ig", "JlQovysQBn0"]);
  });

  test("assigns NDPA to the Implementation department only, with a task and a notice to our own team", async () => {
    const { rows } = await q(
      `SELECT d.name AS department, e.due_on, t.task_id
         FROM training_enrolment e JOIN employee p ON p.employee_id = e.employee_id
         LEFT JOIN department d ON d.department_id = p.department_id
         LEFT JOIN task t ON t.entity_type = 'training_enrolment' AND t.entity_id = e.training_enrolment_id
        ORDER BY d.name`,
    );
    expect(rows).toHaveLength(2);
    expect([...new Set(rows.map((r) => r.department))]).toEqual([seed.AUDIENCE]);
    expect(rows.every((r) => r.due_on && r.task_id)).toBe(true);
    const team = new Set(staff.everyone.filter((p) => p.department === seed.AUDIENCE).map((p) => p.user_id));
    const { rows: told } = await q("SELECT DISTINCT user_id FROM notification");
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((r) => team.has(r.user_id))).toBe(true);
  });

  test("a second run adds nothing", () => {
    expect(second).toEqual(first);
  });
});
