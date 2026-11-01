"use strict";
/**
 * Action cards end to end on the real migrations (docs/guides/praxis-ai.md §6.11; the handoff's
 * decisions 10, 11, 16, 20): a question asked from a screen that draws cards comes back with
 * the task as a card and nothing written; the card is read, edited, pressed, and the task
 * exists, created by the same service function the screen calls; a second press, an expired
 * card, a cancelled one, one whose grant was removed since, one over its bulk limit, a sensitive
 * class without a fresh sign-in, and a refusal the person can fix each do what §6.11 says; the
 * reads of an answer are kept and one is run again, 25 a page (§6.12); a screen that draws no
 * cards is offered no action.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-cards
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. No provider is reached: Gemini answers from a script; the key is invented.
 */
process.env.GEMINI_API_KEY = "test-key";
const request = require("supertest");
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const settings = require("../../src/shared/integrations/settings");
const jobs = require("../../src/services/ai/jobs");
const governance = require("../../src/services/ai/governance");
const gemini = require("../../src/services/ai/vendors/gemini");
const registry = require("../../src/shared/ai/registry");
const { defineManifest } = require("../../src/shared/ai/manifest");
const grantsCache = require("../../src/shared/rbac/grants-cache");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = { ceo: "Chief#Officer26", ops: "Opera!ions2026", staff: "Staff#Member2026" };

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Gemini answering from a script, one reply a call, keeping what it was sent. */
function script(...replies) {
  const sent = [];
  jest.spyOn(gemini, "complete").mockImplementation(async (r) => {
    sent.push(r);
    const next = replies.shift();
    if (!next) throw new Error("the script ran out");
    return { usage: { input_tokens: 300, output_tokens: 40 }, model: r.model, ...next };
  });
  return sent;
}
const callRead = (name, args = {}, id = "call-1") => ({ text: "", toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }], finish_reason: "tool_calls" });
const say = (draft) => ({ text: JSON.stringify({ table: null, route: null, prefill: null, more: false, action: null, overview: null, ...draft }), toolCalls: [], finish_reason: "stop" });

/** A manifest added beside the modules' for the cases tasks.create cannot show: bulk, a sensitive class, a failing run. */
const EXTRA = defineManifest({
  module: "workspace",
  actions: [
    {
      key: "sample.bulk",
      description: "A sample action that names more records than it may touch",
      input: c.common.EmptyBody,
      permission: ["workspace", "create"],
      risk: "standard",
      bulk: 2,
      records: () => [1, 2, 3].map((i) => ({ type: "task", id: `00000000-0000-4000-8000-00000000000${i}` })),
      run: async () => ({}),
    },
    {
      key: "sample.approve",
      description: "A sample approval, which needs a fresh sign-in before it runs",
      input: c.common.EmptyBody,
      permission: ["workspace", "approve"],
      risk: "approval",
      run: async () => ({ ok: true }),
      readback: () => [{ type: "sample", id: "s1", label: "Approved", status: "approved" }],
    },
    {
      key: "sample.explode",
      description: "A sample action whose service falls over while it runs",
      input: c.common.EmptyBody,
      permission: ["workspace", "create"],
      risk: "standard",
      run: async () => {
        throw new Error("the service fell over");
      },
    },
  ],
});

describeDb("Praxis AI action cards against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.73.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
    };
  };
  const fresh = () => {
    jobs.forget();
    governance.forgetCaps();
    settings.forget();
  };
  const ask = (who, body) => as(who).post("/ai/ask").set("Idempotency-Key", `ask-${Date.now()}-${Math.random()}`).send(body);
  const press = (who, id, body = {}) => as(who).post(`/ai/cards/${id}/confirm`).set("Idempotency-Key", `press-${Date.now()}-${Math.random()}`).send(body);

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "HR & Operations",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "remote",
    });
    const make = (client, who, first, last, email, job, role_code, is_ceo = false) =>
      createAdmin(client, { employee: sample(first, last, email, job), role_code, is_ceo }, PASSWORD[who], { allowAdditional: true });
    await tx(async (client) => {
      people.ceo = await make(client, "ceo", "Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer", "management", true);
      people.ops = await make(client, "ops", "Ada", "Obi", "ops@mycity.test", "Operations & People Lead", "operations_people");
      people.staff = await make(client, "staff", "Tunde", "Ade", "tunde@mycity.test", "Field Officer", "employee");
    });
    await drain();
    for (const [who, email] of [["ceo", "ceo@mycity.test"], ["ops", "ops@mycity.test"], ["staff", "tunde@mycity.test"]]) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD[who] });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
      const u = await one("SELECT u.user_id, u.employee_id FROM app_user u WHERE u.email = $1", [email]);
      people[who] = { ...people[who], ...u };
    }
    registry.load({ extra: [{ folder: "sample", manifest: EXTRA }] });
    fresh();
  }, 120_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fresh();
  });

  /** A question from a screen that draws cards, answered with a task card after one read. */
  async function cardFor(who, values = { title: "Send the weekly report", priority: "high", due_on: "2026-11-06" }, extra = {}) {
    const sent = script(callRead("tasks__list", {}), say({ text: "Here is the task as a card.", action: { key: "tasks.create", values, suggested: false } }));
    const res = await ask(who, { question: "Create a task for me to send the weekly report on Friday.", shows: ["cards", "pane"], context: { module: "workspace", tab: "tasks" }, ...extra });
    expect(res.status).toBe(200);
    return { res, sent, body: res.body };
  }

  test("a question from a screen that draws cards: the actions offered, the card drawn and kept, nothing written, the reads kept (§6.11 steps 1 and 2, §6.12)", async () => {
    const before = (await one("SELECT count(*)::int AS n FROM task")).n;
    const { body, sent } = await cardFor("staff");
    expect(sent[0].messages[0].content).toMatch(/Actions you may draft as a card[\s\S]*- tasks\.create: /);
    expect(sent[0].messages[0].content).toMatch(/Asked from the screen: Tasks \(workspace\.tasks\)/);
    expect(c.assistant.AiAnswer.safeParse(body).success).toBe(true);
    expect(body.card).toMatchObject({
      action_key: "tasks.create",
      module_key: "workspace",
      label: "Create Task",
      schema: "tasks.TaskCreate",
      risk: "standard",
      confirm: "press",
      bulk: 1,
      values: { title: "Send the weekly report", priority: "high", due_on: "2026-11-06", is_commitment: false },
      problems: {},
      records: [],
      suggested: false,
      status: "shown",
      result: null,
    });
    expect(body.card.fields.find((f) => f.name === "due_on")).toEqual({ name: "due_on", label: "Due Day", kind: "date", required: false, options: null });
    expect(body.context).toEqual({ module: "workspace", tab: "tasks" });
    expect(body.reads).toEqual([{ n: 1, key: "tasks.list", kind: "read", module_key: "workspace", params: {}, outcome: "read", rows: 0, total: 0, first: 1 }]);
    expect((await one("SELECT count(*)::int AS n FROM task")).n).toBe(before);
    const draft = await one("SELECT status, user_id, expires_at > now() AS open FROM ai_action_draft WHERE ai_action_draft_id = $1", [body.card.ai_action_draft_id]);
    expect(draft).toEqual({ status: "shown", user_id: people.staff.user_id, open: true });
    expect(await one("SELECT n, read_key, kind, outcome, params FROM ai_message_read WHERE ai_message_id = $1", [body.ai_message_id])).toEqual({ n: 1, read_key: "tasks.list", kind: "read", outcome: "read", params: {} });
    expect(await one("SELECT context FROM ai_message WHERE ai_message_id = $1", [body.ai_message_id])).toEqual({ context: { module: "workspace", tab: "tasks" } });
    expect(await one("SELECT opened_from FROM ai_conversation WHERE ai_conversation_id = $1", [body.ai_conversation_id])).toEqual({ opened_from: { module: "workspace", tab: "tasks" } });
    expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'assistant.card_drafted' AND entity_id = $1", [body.card.ai_action_draft_id])).toEqual({ n: 1 });
    // The card is the asker's own: read by them, missing to anyone else; it comes back with the turn.
    const mine = await as("staff").get(`/ai/cards/${body.card.ai_action_draft_id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.status).toBe("shown");
    expect((await as("ops").get(`/ai/cards/${body.card.ai_action_draft_id}`)).status).toBe(404);
    const turns = await as("staff").get(`/ai/conversations/${body.ai_conversation_id}/turns`);
    expect(turns.status).toBe(200);
    expect(turns.body.data[0].card.ai_action_draft_id).toBe(body.card.ai_action_draft_id);
  });

  test("a screen that draws no cards is offered no action and gets none, whatever the model says", async () => {
    const sent = script(say({ text: "Open Tasks to set it.", route: "create a task", prefill: { title: "Send the weekly report" }, action: { key: "tasks.create", values: { title: "Send the weekly report" }, suggested: false } }));
    const res = await ask("staff", { question: "Create a task for me to send the weekly report." });
    expect(res.status).toBe(200);
    expect(sent[0].messages[0].content).toMatch(/- none: offer a route instead/);
    expect(res.body.card).toBeNull();
    expect(res.body.overview).toBeNull();
    expect(res.body.link).toMatchObject({ label: "Open Tasks" });
    expect((await one("SELECT count(*)::int AS n FROM ai_action_draft")).n).toBe(1);
  });

  test("edited, then pressed: the values re-validated, the task created by the module's own service, the result line, the run and the audit; a second press refused (§6.11 steps 3 to 6)", async () => {
    const { body } = await cardFor("staff");
    const id = body.card.ai_action_draft_id;
    const bad = await as("staff").put(`/ai/cards/${id}`).send({ values: { title: "" } });
    expect(bad.status).toBe(200);
    expect(bad.body.problems).toEqual({ title: [expect.any(String)] });
    expect(bad.body.status).toBe("shown");
    const good = await as("staff").put(`/ai/cards/${id}`).send({ values: { title: "Send the weekly report to Ada", priority: "high" } });
    expect(good.body.problems).toEqual({});
    expect(good.body.values).toMatchObject({ title: "Send the weekly report to Ada", priority: "high" });

    const res = await press("staff", id);
    expect(res.status).toBe(200);
    expect(c.assistant.AiActionResult.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ status: "done", error_code: null, message: null });
    expect(res.body.lines).toEqual([{ type: "task", id: expect.any(String), label: expect.stringMatching(/Send the weekly report to Ada$/), ok: true, message: "created", link: expect.stringMatching(/^\/workspace\?tab=tasks&id=/) }]);
    const task = await one("SELECT title, priority, primary_assignee_id, set_by_employee_id, created_by FROM task WHERE task_id = $1", [res.body.lines[0].id]);
    expect(task).toEqual({ title: "Send the weekly report to Ada", priority: "high", primary_assignee_id: people.staff.employee_id, set_by_employee_id: people.staff.employee_id, created_by: people.staff.user_id });
    expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [id])).toEqual({ status: "done" });
    expect(await one("SELECT status, confirmed_how, error_code FROM ai_action_run WHERE ai_action_run_id = $1", [res.body.ai_action_run_id])).toEqual({ status: "done", confirmed_how: "click", error_code: null });
    expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'assistant.action_confirmed' AND entity_id = $1", [id])).toEqual({ n: 1 });
    expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'task.created' AND entity_id = $1", [res.body.lines[0].id])).toEqual({ n: 1 });
    const shown = await as("staff").get(`/ai/cards/${id}`);
    expect(shown.body.status).toBe("done");
    expect(shown.body.result.ai_action_run_id).toBe(res.body.ai_action_run_id);

    const again = await press("staff", id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CARD_DONE");
    expect((await as("staff").put(`/ai/cards/${id}`).send({ values: { title: "x" } })).body.error.code).toBe("CARD_NOT_OPEN");
  });

  test("a refusal the person can fix comes back on the fields and the card stays open; a service that falls over is recorded as failed", async () => {
    const { body } = await cardFor("staff", { title: "Shared task", department_id: "00000000-0000-4000-8000-000000000099" });
    const id = body.card.ai_action_draft_id;
    const res = await press("staff", id);
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({ primary_assignee_id: ["Pick a lead"] });
    expect(await one("SELECT status, problems FROM ai_action_draft WHERE ai_action_draft_id = $1", [id])).toEqual({ status: "shown", problems: { primary_assignee_id: ["Pick a lead"] } });
    expect(await one("SELECT status, error_code FROM ai_action_run WHERE ai_action_draft_id = $1", [id])).toMatchObject({ status: "failed" });

    const sent = script(say({ text: "A sample.", action: { key: "sample.explode", values: {}, suggested: false } }));
    const asked = await ask("staff", { question: "Run the sample.", shows: ["cards"] });
    expect(asked.body.card.action_key).toBe("sample.explode");
    expect(sent.length).toBe(1);
    const fell = await press("staff", asked.body.card.ai_action_draft_id);
    expect(fell.status).toBe(200);
    expect(fell.body).toMatchObject({ status: "failed", error_code: "AI_ACTION_FAILED", message: "the service fell over", lines: [] });
    expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [asked.body.card.ai_action_draft_id])).toEqual({ status: "failed" });
    expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'assistant.action_failed' AND entity_id = $1", [asked.body.card.ai_action_draft_id])).toEqual({ n: 1 });
  });

  test("expired, cancelled, over its bulk limit, and refused after the grant was removed (§6.11 limits; decision 16)", async () => {
    const { body } = await cardFor("staff");
    const id = body.card.ai_action_draft_id;
    await q("UPDATE ai_action_draft SET expires_at = now() - interval '1 minute' WHERE ai_action_draft_id = $1", [id]);
    expect((await as("staff").get(`/ai/cards/${id}`)).body.status).toBe("expired");
    const late = await press("staff", id);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("CARD_EXPIRED");

    const second = await cardFor("staff");
    const cancelled = await as("staff").post(`/ai/cards/${second.body.card.ai_action_draft_id}/cancel`).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect((await press("staff", second.body.card.ai_action_draft_id)).body.error.code).toBe("CARD_CANCELLED");

    script(say({ text: "Three at once.", action: { key: "sample.bulk", values: {}, suggested: false } }));
    const bulk = await ask("staff", { question: "Do the sample on three.", shows: ["cards"] });
    expect(bulk.status).toBe(200);
    expect(bulk.body.card).toBeNull();

    const third = await cardFor("staff");
    const staffRole = await one("SELECT role_id FROM role WHERE code = 'employee'");
    await q("UPDATE permission SET can_create = false WHERE role_id = $1 AND module_key = 'workspace'", [staffRole.role_id]);
    await grantsCache.invalidateGrants();
    await grantsCache.invalidateUser(people.staff.user_id);
    try {
      const gone = await press("staff", third.body.card.ai_action_draft_id);
      expect(gone.status).toBe(403);
      expect(gone.body.error.code).toBe("AI_ACTION_FORBIDDEN");
      expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [third.body.card.ai_action_draft_id])).toEqual({ status: "shown" });
      // And the model is not offered it any more.
      const sent = script(say({ text: "Nothing to offer." }));
      await ask("staff", { question: "Create a task.", shows: ["cards"] });
      expect(sent[0].messages[0].content).toMatch(/- none: offer a route instead/);
    } finally {
      await q("UPDATE permission SET can_create = true WHERE role_id = $1 AND module_key = 'workspace'", [staffRole.role_id]);
      await grantsCache.invalidateGrants();
      await grantsCache.invalidateUser(people.staff.user_id);
    }
  });

  test("a sensitive class needs Confirm It's You within five minutes: refused past it, pressed once confirmed (decision 11)", async () => {
    script(say({ text: "Approve the sample?", action: { key: "sample.approve", values: {}, suggested: true } }));
    const asked = await ask("ops", { question: "Approve the sample.", shows: ["cards"] });
    expect(asked.body.card).toMatchObject({ action_key: "sample.approve", risk: "approval", confirm: "fresh_sign_in", suggested: true });
    const id = asked.body.card.ai_action_draft_id;
    await q("UPDATE user_session SET issued_at = now() - interval '10 minutes', reauthenticated_at = NULL WHERE user_id = $1", [people.ops.user_id]);
    const stale = await press("ops", id);
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe("REAUTH_REQUIRED");
    const confirmed = await as("ops").post("/security/confirm").send({ method: "password", password: PASSWORD.ops });
    expect(confirmed.status).toBe(200);
    const done = await press("ops", id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "done", lines: [{ type: "sample", id: "s1", label: "Approved", ok: true, message: "approved" }] });
    expect(await one("SELECT confirmed_how FROM ai_action_run WHERE ai_action_run_id = $1", [done.body.ai_action_run_id])).toEqual({ confirmed_how: "fresh_sign_in" });
  });

  test("a read of an answer run again, 25 a page, with the person's rights now; a read that was not made is missing (§6.12)", async () => {
    await tx(async (client) => {
      const tasks = require("../../src/modules/tasks/tasks.service");
      const user = await grantsCache.getAuthUser(client, people.ops.user_id);
      const { scopeFor } = require("../../src/middleware/rbac");
      const scope = await scopeFor(user, "workspace", "create");
      for (let i = 0; i < 3; i += 1) await tasks.create(user, scope, { title: `Replay task ${i + 1}` }, { client });
    });
    script(callRead("tasks__list", { q: "Replay" }), say({ text: "Three tasks.", table: { read: 1, fields: ["title", "status"], labels: ["Task", "Status"] } }));
    const res = await ask("ops", { question: "Which replay tasks do I have?", shows: ["pane"] });
    expect(res.status).toBe(200);
    expect(res.body.table.columns).toEqual(["Task", "Status"]);
    const page = await as("ops").get(`/ai/answers/${res.body.ai_message_id}/reads/1?page=1`);
    expect(page.status).toBe(200);
    expect(c.assistant.AiReadRows.safeParse(page.body).success).toBe(true);
    expect(page.body).toMatchObject({ n: 1, key: "tasks.list", columns: ["Task", "Status"], numeric: [] });
    expect(page.body.rows.map((r) => r[0]).sort()).toEqual(["Replay task 1", "Replay task 2", "Replay task 3"]);
    expect(page.body.links.every((l) => /^\/workspace\?tab=tasks&id=/.test(l))).toBe(true);
    expect(page.body.page).toMatchObject({ number: 1, size: 25, total: 3 });
    expect((await as("ops").get(`/ai/answers/${res.body.ai_message_id}/reads/2?page=1`)).status).toBe(404);
    expect((await as("staff").get(`/ai/answers/${res.body.ai_message_id}/reads/1?page=1`)).status).toBe(404);
  });
});
