"use strict";
/**
 * Praxis AI end to end on the real migrations (docs/guides/praxis-ai.md): a question answered
 * from the reads the asking person may run, with their scope and field mask; a read they may not
 * run refused as not available; a change asked for answered with the owning screen and nothing
 * written; the conversation saved, continued and reminded of its reads; History the person's own
 * (turns, the summary, feedback, Delete Conversation, Clear History, ⌘K); the runs kept for the
 * spend; AI switched off; one press, one answer; a spoken question transcribed on Voice
 * Question's chain and its recording removed, and the sweep for one left behind.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/assistant
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. No provider is reached: Gemini answers from a script; the key is invented.
 */
// A key in the server file, so Gemini is set up; nothing else is.
process.env.GEMINI_API_KEY = "test-key";
const request = require("supertest");
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
const usage = require("../../src/shared/integrations/usage");
const jobs = require("../../src/services/ai/jobs");
const governance = require("../../src/services/ai/governance");
const gemini = require("../../src/services/ai/vendors/gemini");
const transcription = require("../../src/services/ai/transcription");
const authorise = require("../../src/shared/ai/authorise");
const vault = require("../../src/shared/documents/vault");
const suggestions = require("../../src/modules/assistant/assistant.suggestions");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const assistant = require("../../src/modules/assistant/assistant.service");
const { VOICE_QUESTION } = require("../../src/modules/assistant/assistant.events");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = { ceo: "Chief#Officer26", ops: "Opera!ions2026", staff: "Staff#Member2026" };

/** A short WebM header: enough for the type sniffer to call it audio. */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("\x42\x82\x84webm"), Buffer.alloc(64)]);

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
const say = (draft) => ({ text: JSON.stringify({ table: null, route: null, prefill: null, more: false, ...draft }), toolCalls: [], finish_reason: "stop" });

describeDb("Praxis AI against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.72.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      delete: (path) => auth(request(app).delete(`/api/v1${path}`)),
    };
  };
  const userOf = (who) => ({ user_id: people[who].user_id, employee_id: people[who].employee_id, role_ids: people[who].role_ids, is_ceo: who === "ceo" });
  const fresh = () => {
    jobs.forget();
    governance.forgetCaps();
    settings.forget();
  };

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
      const u = await one("SELECT u.user_id, u.employee_id, array_agg(ur.role_id) AS role_ids FROM app_user u JOIN user_role ur ON ur.user_id = u.user_id WHERE u.email = $1 GROUP BY u.user_id", [email]);
      people[who] = { ...people[who], ...u };
    }
    fresh();
  });

  beforeEach(fresh);
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    usage.__reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  let opsConversation;
  let opsAnswer;

  test("Operations asks: their reads are offered, the read runs in their scope, the answer is saved with its records", async () => {
    const sent = script(
      callRead("employees__list", { page: 1 }),
      say({ text: "Three people work here.", table: { read: 1, fields: ["display_name", "job_title", "start_date"], labels: ["Name", "Job Title", "Started"] } }),
    );
    const res = await as("ops").post("/ai/ask").send({ question: "Who works here?" });
    expect(res.status).toBe(200);
    const names = sent[0].tools.map((t) => t.function.name);
    expect(names).toContain("employees__list");
    expect(sent[0].messages[0].content).toContain("Asking: Ada Obi, Operations & People Lead, in HR & Operations");
    // The read's page went back as data; the answer's table is the read's own rows.
    const toolTurn = sent[1].messages.find((m) => m.role === "tool");
    expect(JSON.parse(toolTurn.content)).toMatchObject({ read: 1, key: "employees.list", total: 3 });
    expect(res.body).toMatchObject({ content: "Three people work here.", declined: null, more: false, provisional: true, reads: [{ key: "employees.list", rows: 3, total: 3 }] });
    expect(res.body.table.columns).toEqual(["Name", "Job Title", "Started"]);
    expect(res.body.table.rows.map((r) => r[0]).sort()).toEqual(["Ada Obi", "Amaka Eze", "Tunde Ade"]);
    expect(res.body.table.rows[0][2]).toBe("05/01/2026");
    expect(res.body.citations).toHaveLength(3);
    expect(res.body.citations[0]).toMatchObject({ entity_type: "employee", read_key: "employees.list", link: expect.stringMatching(/^\/people\?/) });
    opsConversation = res.body.ai_conversation_id;
    opsAnswer = res.body.ai_message_id;

    const list = await as("ops").get("/ai/conversations");
    expect(list.body.data).toEqual([expect.objectContaining({ ai_conversation_id: opsConversation, title: "Who works here?", questions: 1, rows_read: 3 })]);
    const turns = await as("ops").get(`/ai/conversations/${opsConversation}/turns`);
    expect(turns.body.data).toHaveLength(1);
    expect(turns.body.data[0]).toEqual(res.body);
    const run = await one("SELECT r.purpose, r.module_key, r.status FROM ai_run r JOIN ai_message m ON m.ai_run_id = r.run_id WHERE m.ai_message_id = $1", [opsAnswer]);
    expect(run).toEqual({ purpose: "data-answers", module_key: "praxis_ai", status: "ok" });
    const ev = await one("SELECT payload FROM event_log WHERE event_key = 'assistant.answered' AND entity_id = $1", [opsAnswer]);
    expect(ev.payload).toMatchObject({ reads: ["employees.list"] });
    expect(JSON.stringify(ev.payload)).not.toContain("Who works here");
  });

  test("the conversation continues: the model is reminded of the earlier turn and what it read", async () => {
    const sent = script(say({ text: "Ada Obi leads Operations & People." }));
    const res = await as("ops").post("/ai/ask").send({ question: "And who leads operations?", ai_conversation_id: opsConversation });
    expect(res.status).toBe(200);
    const msgs = sent[0].messages;
    expect(msgs[1]).toEqual({ role: "user", content: "Who works here?" });
    expect(msgs[2].content).toBe('Three people work here.\n[Read: employees.list {"page":1}: 3 row(s) of 3]');
    expect(msgs[3]).toEqual({ role: "user", content: "And who leads operations?" });
    expect((await one("SELECT questions FROM ai_conversation WHERE ai_conversation_id = $1", [opsConversation])).questions).toBe(2);
  });

  test("a member of staff is never offered People's reads; a call to one anyway is not available to them", async () => {
    const sent = script(callRead("employees__list", {}), say({ text: "That is not available to you." }));
    const res = await as("staff").post("/ai/ask").send({ question: "List everyone's start dates" });
    expect(res.status).toBe(200);
    expect(sent[0].tools.map((t) => t.function.name)).not.toContain("employees__list");
    expect(JSON.parse(sent[1].messages.find((m) => m.role === "tool").content)).toEqual({ read: 1, key: "employees.list", error: "not_available" });
    expect(res.body).toMatchObject({ declined: "not_available", citations: [], citations_total: 0, table: null });
  });

  test("asked for a change, the answer offers the owning screen with its prefill checked, and nothing is written", async () => {
    const before = (await one("SELECT count(*)::int AS n FROM employee")).n;
    script(say({ text: "Add her on Employees.", route: "add an employee", prefill: { first_name: "Kemi", salary: "1000000.00" } }));
    const res = await as("ops").post("/ai/ask").send({ question: "Add Kemi Bello as a new employee" });
    expect(res.status).toBe(200);
    expect(res.body.declined).toBe("change");
    expect(res.body.link.label).toBe("Open Employees");
    expect(res.body.link.path).toMatch(/^\/people\?tab=employees/);
    expect(res.body.link.path).toContain("new=1");
    expect(res.body.link.path).toContain("first_name=Kemi");
    expect(res.body.link.path).not.toContain("salary");
    expect((await one("SELECT count(*)::int AS n FROM employee")).n).toBe(before);
  });

  test("History is the person's own: another's conversation and answer read as missing, and ⌘K finds only one's own", async () => {
    expect((await as("staff").get(`/ai/conversations/${opsConversation}/turns`)).status).toBe(404);
    expect((await as("staff").post("/ai/ask").send({ question: "Continue this", ai_conversation_id: opsConversation })).status).toBe(404);
    expect((await as("staff").delete(`/ai/conversations/${opsConversation}`)).status).toBe(404);
    expect((await as("staff").post(`/ai/answers/${opsAnswer}/feedback`).send({ feedback: "down" })).status).toBe(404);
    // The CEO's grant reaches everything; History still does not.
    expect((await as("ceo").get(`/ai/conversations/${opsConversation}/turns`)).status).toBe(404);
    const mine = await as("ops").get("/search?q=works");
    expect(JSON.stringify(mine.body)).toContain(opsConversation);
    const theirs = await as("ceo").get("/search?q=works");
    expect(JSON.stringify(theirs.body)).not.toContain(opsConversation);
  });

  test("Helpful and Not Helpful are kept on the answer, and can be taken back", async () => {
    expect((await as("ops").post(`/ai/answers/${opsAnswer}/feedback`).send({ feedback: "up" })).status).toBe(204);
    let turns = await as("ops").get(`/ai/conversations/${opsConversation}/turns`);
    expect(turns.body.data.find((t) => t.ai_message_id === opsAnswer).feedback).toBe("up");
    expect((await as("ops").post(`/ai/answers/${opsAnswer}/feedback`).send({ feedback: null })).status).toBe(204);
    turns = await as("ops").get(`/ai/conversations/${opsConversation}/turns`);
    expect(turns.body.data.find((t) => t.ai_message_id === opsAnswer).feedback).toBeNull();
  });

  test("this month's summary counts the person's own questions, by the module first read", async () => {
    const res = await as("ops").get("/ai/history/summary");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ questions_this_month: 3, conversations: 2, rows_read_this_month: 3 });
    expect(res.body.by_module).toEqual(expect.arrayContaining([{ module_key: "people", label: "People", questions: 1 }, { module_key: null, label: "Other", questions: 2 }]));
  });

  test("Try Asking offers only what the person's reads can answer, and a capability's question only to its holders", async () => {
    const staff = (await as("staff").get("/ai/suggestions")).body.questions;
    expect(staff).toContain("What happened today?");
    // team.today is every login's read but answers only with home.team; leave requests are People's.
    expect(staff).not.toContain("Who is in today, and who is late?");
    expect(staff).not.toContain("Which leave requests are waiting?");
    expect((await as("ceo").get("/ai/suggestions")).body.questions[0]).toBe("Who is in today, and who is late?");
    for (const who of ["staff", "ops", "ceo"]) {
      const res = await as(who).get("/ai/suggestions");
      expect(res.status).toBe(200);
      const capabilities = await grantsCache.getCapabilities(pool, people[who].user_id);
      expect(res.body.questions).toEqual(suggestions.forReads(await authorise.allowedReads(userOf(who)), { capabilities, is_ceo: who === "ceo" }));
    }
  });

  test("one press, one answer: the same Idempotency-Key gives the same answer and asks the model once", async () => {
    const sent = script(say({ text: "Once." }), say({ text: "Twice." }));
    const key = "6f1c2a0e-1111-4c2b-9a77-0a7e8f3c1d22";
    const first = await as("staff").post("/ai/ask").set("Idempotency-Key", key).send({ question: "Say once" });
    const again = await as("staff").post("/ai/ask").set("Idempotency-Key", key).send({ question: "Say once" });
    expect(again.body.ai_message_id).toBe(first.body.ai_message_id);
    expect(sent).toHaveLength(1);
  });

  test("AI switched off: the question is refused and nothing is saved", async () => {
    await q("INSERT INTO ai_setting (enabled, vendor, model) VALUES (false, 'gemini', 'gemini-3.8-flash')");
    fresh();
    const before = (await one("SELECT count(*)::int AS n FROM ai_message")).n;
    const res = await as("ops").post("/ai/ask").send({ question: "Who is in today?" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_DISABLED");
    expect((await one("SELECT count(*)::int AS n FROM ai_message")).n).toBe(before);
    await q("DELETE FROM ai_setting");
    fresh();
  });

  test("a reply kept for a repeated press goes with its conversation: deleted, the words are not kept there either", async () => {
    script(say({ text: "Kept once." }), say({ text: "Asked again." }));
    const key = "6f1c2a0e-2222-4c2b-9a77-0a7e8f3c1d22";
    const kept = async () => (await one("SELECT count(*)::int AS n FROM idempotency_key WHERE key = $1", [key])).n;
    const first = await as("ops").post("/ai/ask").set("Idempotency-Key", key).send({ question: "Keep this" });
    expect(first.status).toBe(200);
    expect(await kept()).toBe(1);
    expect((await as("ops").delete(`/ai/conversations/${first.body.ai_conversation_id}`)).status).toBe(204);
    expect(await kept()).toBe(0);
    const again = await as("ops").post("/ai/ask").set("Idempotency-Key", key).send({ question: "Keep this" });
    expect(again.body.ai_message_id).not.toBe(first.body.ai_message_id);
    expect((await as("ops").delete(`/ai/conversations/${again.body.ai_conversation_id}`)).status).toBe(204);
  });

  test("Delete Conversation and Clear History remove the words; the runs, holding no words, stay for the spend", async () => {
    const runs = (await one("SELECT count(*)::int AS n FROM ai_run WHERE purpose = 'data-answers'")).n;
    expect((await as("ops").delete(`/ai/conversations/${opsConversation}`)).status).toBe(204);
    expect((await one("SELECT count(*)::int AS n FROM ai_message WHERE ai_conversation_id = $1", [opsConversation])).n).toBe(0);
    expect((await as("ops").delete("/ai/history")).status).toBe(204);
    expect((await as("ops").get("/ai/conversations")).body.data).toEqual([]);
    expect((await one("SELECT count(*)::int AS n FROM ai_conversation c JOIN app_user u ON u.user_id = c.user_id WHERE u.email = 'ops@mycity.test'")).n).toBe(0);
    expect((await one("SELECT count(*)::int AS n FROM ai_run WHERE purpose = 'data-answers'")).n).toBe(runs);
    expect((await as("staff").get("/ai/conversations")).body.data.length).toBeGreaterThan(0);
    const keys = (
      await q(
        "SELECT event_key FROM event_log WHERE (event_key = 'assistant.conversation_deleted' AND entity_id::text = $1) OR event_key = 'assistant.history_cleared'",
        [opsConversation],
      )
    ).rows.map((r) => r.event_key);
    expect(keys.sort()).toEqual(["assistant.conversation_deleted", "assistant.history_cleared"]);
  });

  test("a spoken question: transcribed on Voice Question's chain, and its recording removed", async () => {
    jest.spyOn(transcription.DEFAULT_AUDIO, "mp3").mockResolvedValue(Buffer.from("mp3"));
    const heard = jest.spyOn(gemini, "transcribe").mockResolvedValue({ text: "Who is late today?", usage: { input_tokens: 50, output_tokens: 6 }, model: "gemini-3.8-flash" });
    const res = await as("staff").post("/ai/transcribe").attach("file", WEBM, "question.webm");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ document_id: expect.any(String), text: "Who is late today?", draft: false });
    expect(heard).toHaveBeenCalledTimes(1);
    expect((await one("SELECT purpose, module_key FROM ai_run WHERE purpose = 'praxis-ai-voice'"))).toEqual({ purpose: "praxis-ai-voice", module_key: "praxis_ai" });
    expect((await one("SELECT count(*)::int AS n FROM document WHERE doc_type = 'ai_voice_question'")).n).toBe(0);
  });

  test("a recording whose request never finished is the speaker's alone, and swept once it is an hour old", async () => {
    const doc = await tx((client) =>
      vault.store(client, {
        file: { buffer: WEBM, originalname: "q.webm" },
        purpose: "voice_note",
        doc_type: VOICE_QUESTION,
        entity: { type: VOICE_QUESTION, id: people.staff.user_id },
        actor: null,
      }),
    );
    // History is one's own whatever the grant (decision 7): the CEO and an `all` holder read no one's recording.
    const stored = await vault.get(pool, doc.document_id);
    expect(await vault.canRead(pool, userOf("staff"), stored)).toBe(true);
    expect(await vault.canRead(pool, userOf("ceo"), stored)).toBe(false);
    expect(await vault.canRead(pool, userOf("ops"), stored)).toBe(false);
    // Transient: no derived file is queued for it, and the vault's sweep removes it once an hour old.
    expect(await one("SELECT payload->'needs' AS needs FROM event_log WHERE entity_type = 'document' AND entity_id = $1", [doc.document_id])).toEqual({ needs: [] });
    await vault.purgeTransient();
    expect(await one("SELECT document_id FROM document WHERE document_id = $1", [doc.document_id])).not.toBeNull();
    await q("UPDATE document SET created_at = now() - interval '61 minutes' WHERE document_id = $1", [doc.document_id]);
    expect((await vault.purgeTransient()).removed).toBeGreaterThanOrEqual(1);
    expect(await one("SELECT document_id FROM document WHERE document_id = $1", [doc.document_id])).toBeNull();
  });
});
