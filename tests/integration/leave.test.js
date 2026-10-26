"use strict";
/**
 * Leave end to end (docs/guides/ess.md §3 step 5, §5, §6): the real migrations on a
 * throwaway database, the whole app through HTTP, every response parsed with its
 * contract (APP_ENV=test). My Leave asks, the approval flow decides, People see and
 * record within their scope.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/leave
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema. Every person here is invented. Requests are made for next year, so the
 * dates are in the future whenever the suite runs; the week is the seeded one (Monday
 * to Saturday, A22).
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

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const PASSWORD = "Leave-Days9Test";
const Y = Number(lagos.today().slice(0, 4)) + 1;
const d = (mmdd) => `${Y}-${mmdd}`;

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

describeDb("leave against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  const types = {};
  let ip = 0;

  const as = (who) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`),
    post: (path, body = {}) =>
      request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
    patch: (path, body = {}) =>
      request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  });

  const ask = (who, leaveType, from, to, reason) =>
    as(who).post("/ess/leave", { leave_type_id: types[leaveType], starts_on: from, ends_on: to, reason });

  const statusInDb = async (id) =>
    (await q("SELECT status FROM leave_request WHERE leave_request_id = $1", [id])).rows[0].status;

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
    const make = (key, first, last, role, job, department = "Programmes") =>
      tx(async (client) => {
        people[key] = await createAdmin(
          client,
          { employee: sample(first, last, `${key}@mycity.test`, job, department), role_code: role, is_ceo: false },
          PASSWORD,
          { allowAdditional: true },
        );
      });
    await make("ops", "Tunde", "Bakare", "operations_people", "Operations Lead", "Operations");
    await make("manager", "Kemi", "Alade", "manager", "Programme Lead");
    await make("staff", "Musa", "Danjuma", "employee", "Field Officer");
    await make("other", "Zainab", "Lawal", "employee", "Field Officer");
    await make("outsider", "Bisi", "Ade", "employee", "Accounts Officer", "Finance");
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [
      people.manager.employee.employee_id,
      people.staff.employee.employee_id,
    ]);
    await require("../../src/shared/rbac/grants-cache").bumpTeamVersion();
    await drain();

    for (const key of Object.keys(people)) {
      ip += 1;
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", `10.61.0.${ip}`)
        .send({ email: `${key}@mycity.test`, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("signed out, the leave routes answer 401", async () => {
    expect((await request(app).get("/api/v1/ess/leave")).status).toBe(401);
    expect((await request(app).get("/api/v1/leave/requests")).status).toBe(401);
  });

  test("the four types are seeded; People add, change and delete others; staff cannot", async () => {
    const seeded = await as("staff").get("/leave/types?active=true&sort=name");
    expect(seeded.status).toBe(200);
    expect(seeded.body.page.size).toBe(25);
    expect(seeded.body.data.map((t) => [t.code, t.days_per_year])).toEqual([
      ["annual", 20],
      ["compassionate", 5],
      ["sick", 12],
      ["unpaid", null],
    ]);
    for (const t of seeded.body.data) types[t.code] = t.leave_type_id;

    const study = await as("ops").post("/leave/types", { code: "Study", name: "Study", days_per_year: 3 });
    expect(study.status).toBe(201);
    expect(study.body).toMatchObject({ code: "study", name: "Study", days_per_year: 3, active: true });
    expect((await as("ops").post("/leave/types", { code: "annual", name: "Again" })).status).toBe(409);
    expect((await as("staff").post("/leave/types", { code: "exam", name: "Exam" })).status).toBe(403);

    const renamed = await as("ops").patch(`/leave/types/${study.body.leave_type_id}`, { name: "Study Leave", days_per_year: null });
    expect(renamed.body).toMatchObject({ name: "Study Leave", days_per_year: null });
    const retired = await as("ops").patch(`/leave/types/${study.body.leave_type_id}`, { active: false });
    expect(retired.body.active).toBe(false);
    expect((await as("staff").get("/leave/types?active=true")).body.data.map((t) => t.code)).not.toContain("study");

    // Nothing has used it, so it can go.
    expect((await request(app).delete(`/api/v1/leave/types/${study.body.leave_type_id}`).set("Authorization", `Bearer ${tokens.manager}`)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/leave/types/${study.body.leave_type_id}`).set("Authorization", `Bearer ${tokens.ops}`)).status).toBe(204);
    expect((await as("ops").get("/leave/types")).body.data.map((t) => t.code)).not.toContain("study");
  });

  test("a request is counted in working days and waits on the line manager", async () => {
    // Monday to Wednesday: three working days.
    const res = await ask("staff", "annual", d("02-01"), d("02-03"), "Family visit");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      days: 3,
      status: "submitted",
      waiting_on: "Line Manager",
      recorded: false,
      leave_type_name: "Annual",
      employee: { display_name: "Musa Danjuma", department: "Programmes" },
    });
    expect(res.body.workflow_instance_id).toBeTruthy();

    const mine = await as("staff").get(`/ess/leave?year=${Y}`);
    expect(mine.body.page.total).toBe(1);

    const year = await as("staff").get(`/ess/leave/balances?year=${Y}`);
    expect(year.body.year).toBe(Y);
    expect(year.body.balances.find((b) => b.code === "annual")).toMatchObject({
      entitled: 20,
      taken: 0,
      booked: 0,
      pending: 3,
      remaining: 17,
    });
    expect(year.body.balances.find((b) => b.code === "unpaid")).toMatchObject({ entitled: null, remaining: null });
    expect(year.body.balances.find((b) => b.code === "sick")).toMatchObject({ entitled: 12, remaining: 12 });

    const waiting = await as("manager").get("/workflow/mine");
    expect(waiting.body.data.map((r) => r.entity_id)).toContain(res.body.leave_request_id);
  });

  test("the checks: overlap, the past, New Year, no working days, the allowance", async () => {
    const overlap = await ask("staff", "annual", d("02-03"), d("02-04"));
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe("LEAVE_OVERLAP");

    const past = await ask("staff", "annual", "2020-03-02", "2020-03-03");
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe("LEAVE_IN_THE_PAST");

    // The contract refuses New Year itself, so the form says it as the Last Day is typed (fault #1, 21/10/2026).
    const newYear = await ask("staff", "annual", d("12-30"), `${Y + 1}-01-04`);
    expect([newYear.status, newYear.body.error.code, newYear.body.error.fields]).toEqual([
      422,
      "VALIDATION_FAILED",
      { ends_on: ["Ends in another year"] },
    ]);
    // A Sunday on its own.
    expect((await ask("staff", "annual", d("02-07"), d("02-07"))).body.error.code).toBe("LEAVE_NO_WORKING_DAYS");
    expect((await ask("staff", "annual", d("02-05"), d("02-04"))).status).toBe(422);

    // 17 left: four weeks of six working days is 24, less the public holidays in them
    // (seeds/reference/0448), which depend on the year the test runs in.
    const { rows: off } = await q(
      `SELECT count(*)::int AS n FROM public_holiday
        WHERE holiday_date BETWEEN $1 AND $2 AND date_part('isodow', holiday_date) <> 7`,
      [d("03-01"), d("03-27")],
    );
    const tooMuch = await ask("staff", "annual", d("03-01"), d("03-27"));
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.code).toBe("LEAVE_ALLOWANCE_EXCEEDED");
    // A type with no allowance has no ceiling.
    const unpaid = await ask("staff", "unpaid", d("03-01"), d("03-27"));
    expect(unpaid.status).toBe(201);
    expect(unpaid.body.days).toBe(24 - off[0].n);
    expect((await as("staff").post(`/ess/leave/${unpaid.body.leave_request_id}/cancel`, {})).body.status).toBe("cancelled");
  });

  test("approved by the line manager: the request says so at once, and again once settled", async () => {
    const req = (await as("staff").get(`/ess/leave?year=${Y}&status=submitted`)).body.data.find(
      (r) => r.starts_on === d("02-01"),
    );
    const ok = await as("manager").post(`/workflow/instances/${req.workflow_instance_id}/approve`, {});
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe("approved");

    // Before the worker copies the outcome, the read already takes it from the approval.
    expect(await statusInDb(req.leave_request_id)).toBe("submitted");
    const now = await as("staff").get(`/ess/leave/${req.leave_request_id}`);
    expect(now.body).toMatchObject({ status: "approved", waiting_on: null });
    expect(now.body.decided_at).toBeTruthy();

    await drain();
    expect(await statusInDb(req.leave_request_id)).toBe("approved");
    const year = await as("staff").get(`/ess/leave/balances?year=${Y}`);
    expect(year.body.balances.find((b) => b.code === "annual")).toMatchObject({ booked: 3, pending: 0, remaining: 17 });

    const { rows } = await q("SELECT title FROM notification WHERE user_id = $1 AND entity_id = $2", [
      people.staff.user.user_id,
      req.leave_request_id,
    ]);
    expect(rows.map((r) => r.title)).toContain("Leave Request: Approved");
  });

  test("over five days: Operations & People decide after the line manager; a rejection settles too", async () => {
    // Monday to the next Tuesday: six days, then two.
    const long = await ask("staff", "annual", d("04-05"), d("04-13"));
    expect(long.body.days).toBe(8);
    const id = long.body.workflow_instance_id;
    await as("manager").post(`/workflow/instances/${id}/approve`, {});
    expect((await as("staff").get(`/ess/leave/${long.body.leave_request_id}`)).body.waiting_on).toBe(
      "Operations & People",
    );
    const no = await as("ops").post(`/workflow/instances/${id}/reject`, { reason: "Programme launch that week" });
    expect(no.body.state).toBe("rejected");
    await drain();
    expect(await statusInDb(long.body.leave_request_id)).toBe("rejected");
  });

  test("my own cancellations: while it waits, and once granted until it starts", async () => {
    const waiting = await ask("staff", "annual", d("05-03"), d("05-04"));
    const gone = await as("staff").post(`/ess/leave/${waiting.body.leave_request_id}/cancel`, { reason: "Plans changed" });
    expect(gone.status).toBe(200);
    expect(gone.body.status).toBe("cancelled");
    const instance = await q("SELECT state FROM workflow_instance WHERE workflow_instance_id = $1", [
      waiting.body.workflow_instance_id,
    ]);
    expect(instance.rows[0].state).toBe("cancelled");
    await drain();
    expect(await statusInDb(waiting.body.leave_request_id)).toBe("cancelled");

    expect((await as("staff").post(`/ess/leave/${waiting.body.leave_request_id}/cancel`, {})).status).toBe(409);
    // The days are free again.
    expect((await ask("staff", "annual", d("05-03"), d("05-04"))).status).toBe(201);

    const granted = await ask("staff", "annual", d("08-02"), d("08-03"));
    await as("manager").post(`/workflow/instances/${granted.body.workflow_instance_id}/approve`, {});
    const back = await as("staff").post(`/ess/leave/${granted.body.leave_request_id}/cancel`, {});
    expect(back.status).toBe(200);
    expect(back.body.status).toBe("cancelled");
  });

  test("a request withdrawn from My Approvals is settled as cancelled", async () => {
    const r = await ask("staff", "annual", d("06-07"), d("06-08"));
    const out = await as("staff").post(`/workflow/instances/${r.body.workflow_instance_id}/withdraw`, {});
    expect(out.status).toBe(200);
    expect((await as("staff").get(`/ess/leave/${r.body.leave_request_id}`)).body.status).toBe("cancelled");
    await drain();
    expect(await statusInDb(r.body.leave_request_id)).toBe("cancelled");
  });

  test("my leave is mine: another employee's request is a 404", async () => {
    const mine = (await as("staff").get(`/ess/leave?year=${Y}`)).body.data[0];
    expect((await as("other").get(`/ess/leave/${mine.leave_request_id}`)).status).toBe(404);
    expect((await as("other").post(`/ess/leave/${mine.leave_request_id}/cancel`, {})).status).toBe(404);
    expect((await as("other").get(`/ess/leave?year=${Y}`)).body.page.total).toBe(0);
    expect((await as("staff").get("/leave/requests")).status).toBe(403);
  });

  test("People record leave, approved at once, and the person is told", async () => {
    const rec = await as("ops").post("/leave/requests", {
      employee_id: people.other.employee.employee_id,
      leave_type_id: types.sick,
      starts_on: d("02-02"),
      ends_on: d("02-02"),
      reason: "Called in sick",
    });
    expect(rec.status).toBe(201);
    expect(rec.body).toMatchObject({ status: "approved", recorded: true, workflow_instance_id: null, days: 1 });
    await drain();
    const { rows } = await q("SELECT title FROM notification WHERE user_id = $1 AND entity_id = $2", [
      people.other.user.user_id,
      rec.body.leave_request_id,
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Leave recorded"]);

    // The same day again names the person People recorded it for, not the reader.
    const again = await as("ops").post("/leave/requests", {
      employee_id: people.other.employee.employee_id,
      leave_type_id: types.sick,
      starts_on: d("02-02"),
      ends_on: d("02-02"),
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "LEAVE_OVERLAP", message: "They already have leave on some of those days" });

    // A line manager holds people view and approve, not create.
    const refused = await as("manager").post("/leave/requests", {
      employee_id: people.staff.employee.employee_id,
      leave_type_id: types.sick,
      starts_on: d("07-05"),
      ends_on: d("07-05"),
    });
    expect(refused.status).toBe(403);
  });

  test("scope: a line manager sees their team; Operations & People see everyone, and the clashes", async () => {
    const team = await as("manager").get(`/leave/requests?from=${d("01-01")}&to=${d("12-31")}`);
    expect(team.status).toBe(200);
    const names = new Set(team.body.data.map((r) => r.employee.display_name));
    expect(names).toEqual(new Set(["Musa Danjuma"]));
    expect(team.body.data.every((r) => r.employee.photo_url === null)).toBe(true);

    const recorded = (await as("ops").get(`/leave/requests?employee_id=${people.other.employee.employee_id}`)).body.data[0];
    expect((await as("manager").get(`/leave/requests/${recorded.leave_request_id}`)).status).toBe(404);

    const febLeave = (await as("ops").get(`/leave/requests?status=approved&from=${d("02-01")}&to=${d("02-03")}&sort=starts_on`)).body.data;
    expect(febLeave.map((r) => r.employee.display_name)).toEqual(["Musa Danjuma", "Zainab Lawal"]);

    // The Leave Calendar's `live`: waiting and approved only, never rejected or cancelled.
    const live = (await as("ops").get(`/leave/requests?live=true&from=${d("01-01")}&to=${d("12-31")}`)).body.data;
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((r) => r.status === "submitted" || r.status === "approved")).toBe(true);

    const clashes = await as("ops").get(`/leave/requests/${febLeave[0].leave_request_id}/clashes`);
    expect(clashes.status).toBe(200);
    expect(clashes.body.data.map((r) => r.employee.display_name)).toEqual(["Zainab Lawal"]);
    // The manager's scope does not reach Zainab, so her leave is not a clash they can see.
    expect((await as("manager").get(`/leave/requests/${febLeave[0].leave_request_id}/clashes`)).body.data).toEqual([]);

    const summary = await as("ops").get("/leave/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.pending).toBeGreaterThanOrEqual(1);

    const found = await as("ops").get("/leave/requests?q=zainab");
    expect(found.body.data.every((r) => r.employee.display_name === "Zainab Lawal")).toBe(true);
  });

  test("People cancel granted leave; a waiting request is decided in My Approvals", async () => {
    const recorded = (await as("ops").get(`/leave/requests?employee_id=${people.other.employee.employee_id}`)).body.data[0];
    const out = await as("ops").post(`/leave/requests/${recorded.leave_request_id}/cancel`, { reason: "Recorded on the wrong day" });
    expect(out.status).toBe(200);
    expect(out.body.status).toBe("cancelled");

    const waiting = (await as("ops").get(`/leave/requests?status=submitted`)).body.data[0];
    const refused = await as("ops").post(`/leave/requests/${waiting.leave_request_id}/cancel`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("LEAVE_AWAITING_APPROVAL");
  });

  test("a type with leave on record is retired, never deleted", async () => {
    const res = await request(app).delete(`/api/v1/leave/types/${types.annual}`).set("Authorization", `Bearer ${tokens.ops}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LEAVE_TYPE_IN_USE");
  });

  test("People set one person's allowance for a year; null goes back to the type's", async () => {
    const staffId = people.staff.employee.employee_id;
    const before = await as("ops").get(`/leave/balances?employee_id=${staffId}&year=${Y}`);
    expect(before.status).toBe(200);
    const annual = () => (b) => b.code === "annual";
    expect(before.body.balances.find(annual())).toMatchObject({ entitled: 20 });

    const set = await request(app)
      .put("/api/v1/leave/balances")
      .set("Authorization", `Bearer ${tokens.ops}`)
      .send({ employee_id: staffId, leave_type_id: types.annual, year: Y, days: 25 });
    expect(set.status).toBe(200);
    expect(set.body.balances.find(annual())).toMatchObject({ entitled: 25 });
    expect((await as("staff").get(`/ess/leave/balances?year=${Y}`)).body.balances.find(annual()).entitled).toBe(25);
    await drain();
    const told = await q("SELECT title FROM notification WHERE user_id = $1 AND event_key = 'leave_balance.set'", [people.staff.user.user_id]);
    expect(told.rows.map((r) => r.title)).toEqual(["Leave allowance changed"]);

    // A line manager reads their team's year but cannot change it; nobody reads outside their scope.
    expect((await as("manager").get(`/leave/balances?employee_id=${staffId}&year=${Y}`)).status).toBe(200);
    expect((await as("manager").get(`/leave/balances?employee_id=${people.other.employee.employee_id}`)).status).toBe(404);
    const refused = await request(app)
      .put("/api/v1/leave/balances")
      .set("Authorization", `Bearer ${tokens.manager}`)
      .send({ employee_id: staffId, leave_type_id: types.annual, year: Y, days: 30 });
    expect(refused.status).toBe(403);

    const back = await request(app)
      .put("/api/v1/leave/balances")
      .set("Authorization", `Bearer ${tokens.ops}`)
      .send({ employee_id: staffId, leave_type_id: types.annual, year: Y, days: null });
    expect(back.body.balances.find(annual())).toMatchObject({ entitled: 20 });
  });

  test("the people in a request are found with ⌘K by whoever may see it", async () => {
    const hit = await as("ops").get("/search?q=danjuma");
    expect(hit.status).toBe(200);
    const groups = hit.body.groups || [];
    const leave = groups.find((g) => g.type === "leave_request");
    expect(leave && leave.items.length).toBeGreaterThan(0);
  });

  test("the leave calendar: your own, everyone under you, or everyone for Operations & People", async () => {
    for (const who of ["staff", "other", "manager", "outsider"])
      expect((await ask(who, "unpaid", d("09-07"), d("09-08"))).status).toBe(201);
    const id = (k) => people[k].employee.employee_id;
    const whose = async (who) => {
      const res = await as(who).get(`/ess/leave/calendar?month=${Y}-09&sort=starts_on`);
      expect(res.status).toBe(200);
      return res.body.data.map((r) => r.employee.employee_id).sort();
    };
    expect(await whose("staff")).toEqual([id("staff")]);
    expect(await whose("manager")).toEqual([id("manager"), id("staff")].sort());
    expect(await whose("ops")).toEqual(["staff", "other", "manager", "outsider"].map(id).sort());
    expect((await as("staff").get("/ess/leave/calendar?month=2026-13")).status).toBe(422);
  });
});
