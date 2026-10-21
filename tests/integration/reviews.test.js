"use strict";
/**
 * Performance · Reviews end to end (A17; docs/guides/performance.md §3 steps 8 to 10, §6, §8):
 * the real migrations on a throwaway database, the whole app through HTTP, every response
 * parsed with its contract. Operations & People open a cycle with its questions; everyone gets
 * a self review and their manager a manager review; the manager sees nothing until the self
 * review is in; their KPI ratings come prefilled from progress; the manager's own manager then
 * Operations & People approve, a return goes back with its reason, and HR's approval closes it,
 * after which the employee reads the manager's review. Nobody else reads its content.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/reviews
 *
 * Refuses to run unless the database name ends in "_test". Every person here is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const lagos = require("../../src/shared/time/lagos");
const reviews = require("../../src/modules/reviews/reviews.service");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Self-First9Test";
const today = lagos.today();
const month = today.slice(0, 7);

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

describeDb("review cycles against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    put: (path, body = {}) =>
      request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });
  const emp = (who) => people[who].employee.employee_id;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const sample = (first, last, email, job, department) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: department,
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    const make = (key, first, last, role, job, department, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: isCeo },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ceo", "Cynthia", "Okafor", "management", "Chief Executive", "Leadership", true);
    await make("ops", "Ngozi", "Eze", "operations_people", "Operations Lead", "Operations");
    await make("head", "Ifeoma", "Chukwu", "head_of_department", "Head of Programmes", "Programmes");
    await make("lead", "Tunde", "Bello", "manager", "Programme Lead", "Programmes");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer", "Programmes");
    await make("peer", "Zainab", "Lawal", "employee", "Field Officer", "Programmes");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("ceo"), emp("head")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("head"), emp("lead")]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = ANY($2::uuid[])", [emp("lead"), [emp("staff"), emp("peer")]]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [emp("ceo"), emp("ops")]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();

    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.66.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }

    // An approved KPI for the month, 3 of 4 done, so the manager's rating can be prefilled.
    await q(
      `INSERT INTO employee_target (employee_id, title, month, target_value, actual_value, weight, status, set_by_employee_id)
       VALUES ($1, 'Sessions delivered', $2::date, 4, 3, 100, 'active', $3)`,
      [emp("staff"), `${month}-01`, emp("lead")],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  let cycle;
  let selfId;
  let managerId;

  test("Operations & People open a cycle with its questions; everyone gets their reviews", async () => {
    const body = {
      name: "October Check-In",
      starts_on: `${month}-01`,
      ends_on: lagos.monthBounds(today).last,
      opens_on: today,
      closes_on: lagos.addDays(today, 14),
      questions: ["What went well this month?", "What will you do differently?"],
    };
    expect((await as("lead").post("/performance/cycles", body)).status).toBe(403);
    const r = await as("ops").post("/performance/cycles", body);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("open");
    expect(r.body.questions.map((x) => x.position)).toEqual([1, 2]);
    cycle = r.body;

    const rows = await q(
      `SELECT employee_id, reviewer_employee_id, review_type, performance_review_id FROM performance_review
        WHERE performance_cycle_id = $1`,
      [cycle.performance_cycle_id],
    );
    const of = (who, type) => rows.rows.find((x) => x.employee_id === emp(who) && x.review_type === type);
    expect(of("staff", "self")).toBeTruthy();
    expect(of("staff", "manager").reviewer_employee_id).toBe(emp("lead"));
    expect(of("head", "manager").reviewer_employee_id).toBe(emp("ceo"));
    expect(of("ceo", "self")).toBeTruthy();
    expect(of("ceo", "manager")).toBeUndefined();
    selfId = of("staff", "self").performance_review_id;
    managerId = of("staff", "manager").performance_review_id;

    // Opening twice makes nothing twice.
    expect((await reviews.openDue(new Date())).opened).toBe(0);
  });

  test("the manager sees nothing until the self review is in", async () => {
    const waiting = await as("lead").get(`/performance/reviews/${managerId}`);
    expect(waiting.status).toBe(200);
    expect(waiting.body.waiting_for_self).toBe(true);
    expect(waiting.body.form).toBeNull();
    expect(waiting.body.can_edit).toBe(false);
    const early = await as("lead").put(`/performance/reviews/${managerId}`, { overall_score: 4 });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("SELF_REVIEW_FIRST");
    expect((await as("lead").get(`/performance/reviews/${selfId}`)).status).toBe(404);
  });

  test("the employee rates themselves first and hands it in", async () => {
    const page = await as("staff").get("/ess/performance");
    expect(page.status).toBe(200);
    expect(page.body.open_review_id).toBe(selfId);
    expect(page.body.kpi_count).toBe(1);
    expect(page.body.weight_assigned).toBe("100.00");
    expect(page.body.next_cycle.name).toBe("October Check-In");
    const mine = await as("staff").get("/ess/performance/review");
    expect(mine.status).toBe(200);
    expect(mine.body.performance_review_id).toBe(selfId);
    expect(mine.status).toBe(200);
    const [q1, q2] = mine.body.form.answers;
    const kpi = mine.body.form.items[0];
    expect(kpi.score).toBeNull();
    expect(kpi.attainment).toBe(0.75);

    const draft = await as("staff").put("/ess/performance/review", {
      overall_score: 4,
      items: [{ employee_target_id: kpi.employee_target_id, score: 4, comment: "Three of four sessions" }],
      answers: [
        { performance_cycle_question_id: q1.performance_cycle_question_id, answer_text: "The school sessions" },
        { performance_cycle_question_id: q2.performance_cycle_question_id, answer_text: "Book venues earlier" },
      ],
    });
    expect(draft.status).toBe(200);
    expect(draft.body.form.answers.map((a) => a.answer_text)).toEqual(["The school sessions", "Book venues earlier"]);
    expect((await as("peer").get(`/performance/reviews/${selfId}`)).status).toBe(404);

    // Dictate the first answer (A18): the recording is kept and transcribed, the text untouched.
    const wav = Buffer.alloc(44 + 1600);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + 1600, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(1600, 40);
    const spoken = await request(app)
      .post("/api/v1/ess/performance/review/dictation")
      .set("Authorization", `Bearer ${tokens.staff}`)
      .field("performance_cycle_question_id", q1.performance_cycle_question_id)
      .field("duration_s", "4")
      .attach("file", wav, { filename: "answer.wav", contentType: "audio/wav" });
    expect(spoken.status).toBe(200);
    expect(spoken.body.transcript.length).toBeGreaterThan(0);
    const kept = await q(
      "SELECT answer_text, dictation_document_id, transcript FROM performance_review_answer WHERE performance_review_id = $1 AND performance_cycle_question_id = $2",
      [selfId, q1.performance_cycle_question_id],
    );
    expect(kept.rows[0].dictation_document_id).toBe(spoken.body.dictation_id);
    expect(kept.rows[0].answer_text).toBe("The school sessions");
    const used = await as("staff").put("/ess/performance/review", {
      answers: [
        {
          performance_cycle_question_id: q1.performance_cycle_question_id,
          answer_text: spoken.body.tidied || spoken.body.transcript,
          dictation_id: spoken.body.dictation_id,
        },
      ],
    });
    expect(used.body.form.answers[0].dictated).toBe(true);
    const typed = await as("staff").put("/ess/performance/review", {
      answers: [{ performance_cycle_question_id: q1.performance_cycle_question_id, answer_text: "The school sessions" }],
    });
    expect(typed.body.form.answers[0].dictated).toBe(false);

    const sent = await as("staff").post("/ess/performance/review/submit");
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("submitted");
    expect(sent.body.can_edit).toBe(false);
    const none = await as("staff").get("/ess/performance/review");
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe("NO_OPEN_REVIEW");
  });

  test("the manager sees the self review beside a form prefilled from progress, and hands it in", async () => {
    const open = await as("lead").get(`/performance/reviews/${managerId}`);
    expect(open.body.waiting_for_self).toBe(false);
    expect(open.body.other.overall_score).toBe(4);
    expect(open.body.form.items[0].score).toBe(3);
    expect(open.body.can_submit).toBe(true);

    expect((await as("lead").post(`/performance/reviews/${managerId}/submit`)).status).toBe(422);
    await as("lead").put(`/performance/reviews/${managerId}`, { overall_score: 3, summary: "Steady month" });
    const sent = await as("lead").post(`/performance/reviews/${managerId}/submit`);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("second_level");
    expect(sent.body.route.map((s) => [s.key, s.state])).toEqual([
      ["second_level", "now"],
      ["operations_people", "todo"],
    ]);

    // Until it closes the employee does not read their manager's rating.
    const list = await as("staff").get(`/performance/reviews?performance_cycle_id=${cycle.performance_cycle_id}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].self_rating).toBe(4);
    expect(list.body.data[0].manager_rating).toBeNull();
    const asStaff = await as("staff").get(`/performance/reviews/${managerId}`);
    expect(asStaff.body.form).toBeNull();
  });

  test("the second level returns it with a reason; resubmitted, Operations & People close it", async () => {
    expect((await as("peer").post(`/performance/reviews/${managerId}/decide`, { decision: "approve" })).status).toBe(403);
    const back = await as("head").post(`/performance/reviews/${managerId}/decide`, {
      decision: "return",
      reason: "Say what the fourth session needed",
    });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe("returned");

    const again = await as("lead").post(`/performance/reviews/${managerId}/submit`);
    expect(again.body.status).toBe("second_level");
    const second = await as("head").post(`/performance/reviews/${managerId}/decide`, { decision: "approve" });
    expect(second.body.status).toBe("with_hr");
    const hr = await as("ops").post(`/performance/reviews/${managerId}/decide`, { decision: "approve" });
    expect(hr.status).toBe(200);
    expect(hr.body.status).toBe("closed");

    await drain();
    const told = await q(
      `SELECT n.title FROM notification n JOIN app_user u ON u.user_id = n.user_id WHERE u.employee_id = $1`,
      [emp("staff")],
    );
    expect(told.rows.map((r) => r.title)).toContain("Your manager's review is ready");

    const month1 = await as("staff").get("/ess/performance");
    expect(month1.body.last_review).toBe(3);
    expect(month1.body.reviews[0].manager_rating).toBe(3);
    const read = await as("staff").get(`/performance/reviews/${selfId}`);
    expect(read.body.status).toBe("closed");
    expect(read.body.document).not.toBeNull();
    expect(read.body.document.mime_type).toMatch(/html|pdf/);
    expect(read.body.other.overall_score).toBe(3);
    expect(read.body.other.summary).toBe("Steady month");

    const summary = await as("ops").get("/performance/reviews/summary");
    expect(summary.body.closed).toBe(1);
    expect(summary.body.average_rating).toBe(3);
  });

  test("Analytics reads the cycle and the year back, within the reader's scope", async () => {
    const all = await as("ops").get(`/performance/analytics?performance_cycle_id=${cycle.performance_cycle_id}`);
    expect(all.status).toBe(200);
    expect(all.body.cycle).toBe("October Check-In");
    expect(all.body.reviews_completed).toBe(1);
    expect(all.body.average_self).toBe(4);
    expect(all.body.average_manager).toBe(3);
    expect(all.body.completion).toHaveLength(12);
    expect(all.body.completion.find((m) => m.month === month).attainment).toBe(0.75);
    const programmes = all.body.gap.find((g) => g.department === "Programmes");
    expect(programmes.gap).toBe(-1);

    const lead = await as("lead").get("/performance/analytics");
    expect(lead.body.by_department.map((d) => d.department)).toEqual(["Programmes"]);
    const peer = await as("peer").get("/performance/analytics");
    expect(peer.body.by_department).toEqual([]);
    expect(peer.body.reviews_total).toBe(1);
  });
});
