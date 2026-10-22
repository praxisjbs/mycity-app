"use strict";
/**
 * AI Control end to end (docs/guides/ai-control.md): who may open it, the jobs and actions with
 * their chains and each model's state, Edit Chain with its checks, Make First, an action's own
 * chain and Use Job Chain, the walk a call takes (a chain saved here, a provider at its cap),
 * each step charged at its model's price and the day's rate, Edit Price, Find Prices through a
 * fake Google Search answer with Accept and Dismiss, and Spend with its caps.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-control
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the public
 * schema. No provider is reached: Gemini answers through a fake vendor or a fake fetch; the keys
 * are invented.
 */
// A key in the server file, so Gemini is set up; nothing else is.
process.env.GEMINI_API_KEY = "test-key";
const fs = require("node:fs");
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
const lagos = require("../../src/shared/time/lagos");
const settings = require("../../src/shared/integrations/settings");
const usage = require("../../src/shared/integrations/usage");
const ai = require("../../src/services/ai/llm.service");
const jobs = require("../../src/services/ai/jobs");
const governance = require("../../src/services/ai/governance");
const ledger = require("../../src/services/ai/ledger");
const prices = require("../../src/services/ai/prices");
const repo = require("../../src/modules/ai_governance/ai_governance.repo");
require("../../src/modules/ai_governance/ai_governance.events");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = { ceo: "Chief#Officer26", ops: "Opera!ions2026", admin: "Admin#Pass2026x", staff: "Staff#Member2026" };

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

/** The ai-find-prices jobs the outbox queued, run here as the worker would; returns how many ran. */
async function runFindPricesJobs() {
  const queues = require("../../src/jobs/queues");
  const job = require("../../src/jobs/handlers/ai-find-prices");
  const due = queues.enqueue.mock.calls.filter(([queue]) => queue === "ai-find-prices");
  queues.enqueue.mockClear();
  for (const [, , data, opts] of due) {
    expect(opts).toMatchObject({ jobId: `ai-find-prices-${data.ai_price_run_id}`, attempts: 1 });
    await job({ data });
  }
  return due.length;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A fake Gemini for complete(): every answer `text`, recording the model it was asked. */
function fakeGemini(text = "Tidied.") {
  const calls = [];
  return {
    calls,
    complete: async (r) => {
      calls.push(r);
      return { text, usage: { input_tokens: 1000, output_tokens: 200 }, model: r.model, finish_reason: "stop" };
    },
  };
}

/** Google Search's answer to Find Prices, as Gemini's native endpoint sends it. */
let FOUND = {
  prices: [
    // Priced already, so not asked about: left alone.
    { model: "gemini-2.5-flash", input_usd_per_million: "0.25", output_usd_per_million: "2.00", source_url: "https://ai.google.dev/gemini-api/docs/pricing" },
    // A number, and a page off Google's site: the price is kept, the page replaced by the search's.
    { model: "gemini-3.8-flash", input_usd_per_million: 0.5, output_usd_per_million: 3, source_url: "https://example.com/gemini-prices" },
    // Not ours: not proposed.
    { model: "gemini-9-ultra", input_usd_per_million: "9.00", output_usd_per_million: "90.00", source_url: "https://ai.google.dev/x" },
    // Asked about, and the page prices nothing: Not Listed.
    { model: "gemini-3.5-flash-lite", input_usd_per_million: null, output_usd_per_million: null, source_url: "https://ai.google.dev/x" },
  ],
};
const searched = [];
async function fakeFetch(input, init) {
  const url = new URL(String(input));
  if (url.hostname === "generativelanguage.googleapis.com" && url.pathname.endsWith(":generateContent")) {
    searched.push({ url, body: JSON.parse(init.body) });
    return Response.json({
      candidates: [
        {
          content: { parts: [{ text: typeof FOUND === "string" ? FOUND : JSON.stringify(FOUND) }] },
          finishReason: "STOP",
          groundingMetadata: {
            webSearchQueries: ["gemini api pricing", "gemini 3.8 flash price"],
            groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "ai.google.dev" } }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 400 },
      modelVersion: "gemini-2.5-pro",
    });
  }
  return new Response("{}", { status: 404 });
}

describeDb("AI Control against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.71.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
      delete: (path) => auth(request(app).delete(`/api/v1${path}`)),
    };
  };
  const modelId = async (provider, model) => (await one("SELECT ai_model_id FROM ai_model WHERE provider = $1 AND model = $2", [provider, model])).ai_model_id;
  const fresh = async () => {
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
      people.admin = await make(client, "admin", "Femi", "Bello", "femi@mycity.test", "Systems Officer", "administrator");
      people.staff = await make(client, "staff", "Tunde", "Ade", "tunde@mycity.test", "Field Officer", "employee");
    });
    await drain();
    for (const [who, email] of [["ceo", "ceo@mycity.test"], ["ops", "ops@mycity.test"], ["admin", "femi@mycity.test"], ["staff", "tunde@mycity.test"]]) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD[who] });
      expect(res.status).toBe(200);
      tokens[who] = res.body.access_token;
    }
    await fresh();
  });

  beforeEach(fresh);
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    usage.__reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  describe("who may open it (§8)", () => {
    test("IT edits; Operations & People see every tab and change nothing; staff see nothing", async () => {
      expect((await as("admin").get("/ai-control/jobs")).status).toBe(200);
      expect((await as("ceo").get("/ai-control/spend")).status).toBe(200);
      for (const path of ["/ai-control/jobs", "/ai-control/actions", "/ai-control/models", "/ai-control/spend"])
        expect((await as("ops").get(path)).status).toBe(200);
      expect((await as("ops").put("/ai-control/cap").send({ monthly_cap_ngn: "1000.00" })).status).toBe(403);
      expect((await as("ops").post("/ai-control/prices/find").send({})).status).toBe(403);
      expect((await as("staff").get("/ai-control/jobs")).status).toBe(403);
    });
  });

  describe("jobs and actions (§2, §6.1)", () => {
    test("the seven jobs, each chain from code with each model's state", async () => {
      const res = await as("admin").get("/ai-control/jobs");
      expect(res.body.data.map((j) => j.job)).toEqual(["default", "fast", "deep_reasoning", "image_reading", "transcription", "embeddings", "top_tier"]);
      const by = Object.fromEntries(res.body.data.map((j) => [j.job, j]));
      expect(by.default.chain).toMatchObject({ scope: "job", key: "default", stored: false });
      expect(by.default.chain.links).toEqual([expect.objectContaining({ provider: "gemini", model: "gemini-3.8-flash", state: "ready", position: 1 })]);
      // Groq and OpenAI have no key here: shown, and passed by.
      expect(by.transcription.chain.links.map((l) => [l.provider, l.state])).toEqual([
        ["groq", "not_set_up"],
        ["gemini", "ready"],
      ]);
      expect(by.embeddings.chain.links.map((l) => [l.model, l.state])).toEqual([["text-embedding-3-small", "not_set_up"]]);
      expect(by.top_tier.chain.links.map((l) => l.model)).toEqual(["gemini-2.5-pro", "claude-sonnet-5-5"]);
      expect(by.default.actions).toBe(1); // Tidy Policy; Data Answers has its own chain
    });

    test("the registered actions: their job, personal data, own chain and today's calls", async () => {
      const res = await as("admin").get("/ai-control/actions");
      expect(res.body.data.map((a) => a.key)).toEqual(["voice-note-transcription", "policy-tidy", "data-answers", "praxis-ai-voice", "find-prices"]);
      const by = Object.fromEntries(res.body.data.map((a) => [a.key, a]));
      expect(by["data-answers"]).toMatchObject({ job: "default", built: true, own_chain: true, personal_data: true, chosen_by: "TB" });
      expect(by["data-answers"].chain.links.map((l) => l.model)).toEqual(["gemini-3.8-flash", "gemini-2.5-pro"]);
      expect(by["policy-tidy"]).toMatchObject({ own_chain: false, chain: expect.objectContaining({ scope: "job", key: "default" }) });
      expect(by["find-prices"]).toMatchObject({ job: "deep_reasoning", personal_data: false });
      // A question spoken on Praxis AI · Ask (docs/guides/praxis-ai.md §6.6): on Transcription's chain, never DeepSeek.
      expect(by["praxis-ai-voice"]).toMatchObject({ job: "transcription", personal_data: true, built: false, own_chain: false });
      expect((await as("admin").get("/ai-control/actions?job=transcription")).body.data.map((a) => a.key)).toEqual(["voice-note-transcription", "praxis-ai-voice"]);
    });
  });

  describe("Edit Chain, Make First, Use Job Chain (§3 step 4, §6.2)", () => {
    test("a chain is checked whole: on the list, able to do the job, allowed, once; Embeddings one model", async () => {
      const save = (scope, key, links) => as("admin").put(`/ai-control/chains/${scope}/${key}`).send({ links });
      let res = await save("job", "transcription", [{ provider: "anthropic", model: "claude-haiku-5-5" }]);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: "MODEL_CANNOT_DO_JOB", fields: { "links.0.model": ["Cannot do this job"] } });
      res = await save("job", "default", [{ provider: "gemini", model: "gemini-0-nonsense" }]);
      expect(res.body.error.code).toBe("MODEL_NOT_LISTED");
      res = await save("action", "policy-tidy", [
        { provider: "gemini", model: "gemini-2.5-flash" },
        { provider: "deepseek", model: "deepseek-v4-flash" },
      ]);
      expect(res.body.error).toMatchObject({ code: "DEEPSEEK_PERSONAL_DATA", fields: { "links.1.model": ["Carries personal data"] } });
      res = await save("job", "default", [
        { provider: "gemini", model: "gemini-2.5-flash" },
        { provider: "gemini", model: "GEMINI-2.5-FLASH" },
      ]);
      expect(res.body.error.fields).toEqual({ "links.1.model": ["Picked twice"] });
      res = await save("job", "embeddings", [
        { provider: "openai", model: "text-embedding-3-small" },
        { provider: "openai", model: "text-embedding-3-large" },
      ]);
      expect(res.body.error.code).toBe("ONE_EMBEDDING_MODEL");
      jest.spyOn(repo, "embeddingsIndexed").mockResolvedValue(true);
      res = await save("job", "embeddings", [{ provider: "openai", model: "text-embedding-3-large" }]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EMBEDDINGS_LOCKED");
      expect((await save("job", "nonsense", [{ provider: "gemini", model: "gemini-2.5-flash" }])).status).toBe(404);
      expect((await save("action", "integration-test", [{ provider: "gemini", model: "gemini-2.5-flash" }])).status).toBe(404);
    });

    test("Top Tier's two swap in one press, audited; the chain is saved", async () => {
      const res = await as("admin").post("/ai-control/chains/job/top_tier/first").send({ position: 2 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ scope: "job", key: "top_tier", stored: true, updated_by_name: "Femi Bello" });
      expect(res.body.links.map((l) => [l.position, l.model, l.state])).toEqual([
        [1, "claude-sonnet-5-5", "not_set_up"],
        [2, "gemini-2.5-pro", "ready"],
      ]);
      const audit = await one("SELECT event_key, payload FROM event_log WHERE event_key = 'ai_control.chain_changed' ORDER BY occurred_at DESC LIMIT 1");
      expect(audit.payload).toMatchObject({ scope: "job", key: "top_tier", made_first: { provider: "anthropic", model: "claude-sonnet-5-5" } });
      // And back.
      await as("admin").post("/ai-control/chains/job/top_tier/first").send({ position: 2 });
      expect((await jobs.resolveJob("top_tier")).links.map((l) => l.provider)).toEqual(["gemini", "anthropic"]);
      expect((await as("admin").post("/ai-control/chains/job/default/first").send({ position: 2 })).status).toBe(422);
    });

    test("an action given its own chain keeps it until Use Job Chain; the call follows the chain", async () => {
      const g = fakeGemini();
      const tidy = () => ai.complete({ purpose: "policy-tidy", module: "knowledge", actor: people.admin.user_id, input: { policy_markdown: "x" }, vendors: { gemini: g, stub: require("../../src/services/ai/vendors/stub") } });
      await tidy();
      expect(g.calls.at(-1).model).toBe("gemini-3.8-flash");

      const res = await as("admin").put("/ai-control/chains/action/policy-tidy").send({ links: [{ provider: "gemini", model: "gemini-2.5-pro" }, { provider: "gemini", model: "gemini-2.5-flash" }] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ scope: "action", key: "policy-tidy", stored: true });
      const r = await tidy();
      expect(g.calls.at(-1).model).toBe("gemini-2.5-pro");
      expect(await one("SELECT purpose, vendor, model FROM ai_run WHERE run_id = $1", [r.run_id])).toEqual({ purpose: "policy-tidy", vendor: "gemini", model: "gemini-2.5-pro" });
      const listed = (await as("admin").get("/ai-control/actions")).body.data.find((a) => a.key === "policy-tidy");
      expect(listed).toMatchObject({ own_chain: true, calls_today: 2 });

      expect((await as("admin").delete("/ai-control/chains/action/policy-tidy")).status).toBe(204);
      await tidy();
      expect(g.calls.at(-1).model).toBe("gemini-3.8-flash");
      expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'ai_control.chain_reset'")).toEqual({ n: 1 });
    });
  });

  describe("prices and caps on the walk (§6.1, §6.3)", () => {
    const tidy = (g) => ai.complete({ purpose: "policy-tidy", module: "knowledge", actor: null, input: { policy_markdown: "x" }, vendors: { gemini: g, stub: require("../../src/services/ai/vendors/stub") } });

    test("a step is charged at its model's dollar price times the day's rate, kept on the step", async () => {
      await q("INSERT INTO exchange_rate (day, base, currency, rate) VALUES ($1, 'USD', 'NGN', 1500), ($1, 'USD', 'USD', 1)", [lagos.today()]);
      const id = await modelId("gemini", "gemini-2.5-flash");
      let res = await as("admin").put(`/ai-control/models/${id}/prices`).send({
        input_usd_per_million: "0.30",
        output_usd_per_million: "2.50",
        audio_usd_per_million: "1.00",
        usd_per_audio_hour: "",
        usd_per_thousand_searches: "",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ input_usd_per_million: "0.3000", input_ngn_per_million: "450.00", output_ngn_per_million: "3750.00", plan: "paid", proposed: false });
      res = await as("admin").put("/ai-control/chains/job/default").send({ links: [{ provider: "gemini", model: "gemini-2.5-flash" }] });
      expect(res.status).toBe(200);
      const r = await tidy(fakeGemini());
      // 1,000 input tokens at ₦450 per million + 200 output at ₦3,750 per million.
      expect(r.cost_ngn).toBe("1.20");
      expect(await one("SELECT input_ngn_per_million::text AS i, usd_ngn_rate::text AS rate, to_char(rate_day, 'YYYY-MM-DD') AS day FROM ai_run_step WHERE run_id = $1", [r.run_id])).toEqual({
        i: "450.00",
        rate: "1500.0000000000",
        day: lagos.today(),
      });
      const models = (await as("ops").get("/ai-control/models?provider=gemini")).body.data;
      expect(models.find((m) => m.model === "gemini-2.5-flash").in_chains).toEqual(expect.arrayContaining([{ scope: "job", key: "default", label: null, position: 1 }]));
      expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'ai_control.price_set'")).toEqual({ n: 1 });
    });

    test("a paid provider at its cap is passed by until the month ends; a Free one has no cap", async () => {
      let res = await as("admin").put("/ai-control/caps/gemini").send({ monthly_cap_ngn: "0.00" });
      expect(res.status).toBe(200);
      expect(res.body.providers.find((p) => p.provider === "gemini")).toMatchObject({ cap_ngn: "0.00", at_cap: true, plan: "paid", set_up: true });
      expect((await jobs.resolve("policy-tidy")).links.map((l) => l.state)).toEqual(["at_cap"]);
      await expect(tidy(fakeGemini())).rejects.toMatchObject({ code: "AI_UNAVAILABLE", status: 503 });
      const failed = await one("SELECT status, error_code, error FROM ai_run ORDER BY started_at DESC LIMIT 1");
      expect(failed).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE", error: expect.stringContaining("at_cap") });

      res = await as("admin").put("/ai-control/caps/gemini").send({ monthly_cap_ngn: "" });
      expect(res.body.providers.find((p) => p.provider === "gemini")).toMatchObject({ cap_ngn: null, at_cap: false });
      await expect(tidy(fakeGemini())).resolves.toMatchObject({ vendor: "gemini" });

      res = await as("admin").put("/ai-control/caps/groq").send({ monthly_cap_ngn: "500.00" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("NOT_PAID");
    });

    test("Spend: this month per provider, all AI against its cap, by day and by action", async () => {
      const res = await as("admin").put("/ai-control/cap").send({ monthly_cap_ngn: "250000.00" });
      expect(res.status).toBe(200);
      expect(res.body.overall).toMatchObject({ cap_ngn: "250000.00", at_cap: false });
      expect(res.body.providers.map((p) => p.provider)).toEqual(["gemini", "groq", "openai", "anthropic", "deepseek"]);
      expect(res.body.month).toBe(`${lagos.today().slice(0, 7)}-01`);
      expect(res.body.days.at(-1).day).toBe(lagos.today());
      expect(res.body.rate).toEqual({ usd_ngn: "1500.0000000000", day: lagos.today() });
      const gemini = res.body.providers.find((p) => p.provider === "gemini");
      expect(Number(gemini.spent_ngn)).toBeGreaterThan(0);
      expect(res.body.overall.spent_ngn).toBe(await governance.spentThisMonth(pool));
      const byAction = (await as("ops").get("/ai-control/spend/actions")).body;
      expect(byAction.data.find((a) => a.key === "policy-tidy")).toMatchObject({ label: "Tidy Policy", job: "default" });
      expect(byAction.page.size).toBe(25);
    });

    test("a voice note kept before the registry, under its old key, counts as Voice Note Transcription (10220)", async () => {
      const old = await ledger.startRun(pool, { purpose: "transcription", module: "community", actor: null, vendor: "groq", model: "whisper-large-v3" });
      await ledger.recordStep(pool, old, {
        step_no: 1,
        kind: "transcription",
        vendor: "groq",
        model: "whisper-large-v3",
        usage: { input_tokens: 0, output_tokens: 0, audio_seconds: 12 },
        prices: prices.zero(),
        latency_ms: 900,
        outcome: "ok",
      });
      await ledger.finishRun(pool, old, { status: "ok" });
      const byAction = async () => (await as("ops").get("/ai-control/spend/actions")).body.data;
      expect((await byAction()).find((a) => a.key === "transcription")).toMatchObject({ label: "transcription", job: null });

      const migration = fs.readFileSync(require.resolve("../../migrations/10220_ai_run_registered_purpose.sql"), "utf8");
      const up = migration.slice(migration.indexOf("-- UP"), migration.indexOf("-- DOWN"));
      const down = migration.slice(migration.indexOf("-- DOWN"));
      await q(up);
      await q(up);
      const after = await byAction();
      expect(after.map((a) => a.key)).not.toContain("transcription");
      expect(after.find((a) => a.key === "voice-note-transcription")).toMatchObject({ label: "Voice Note Transcription", job: "transcription", calls: 1 });
      expect(await one("SELECT purpose, original_purpose FROM ai_run WHERE run_id = $1", [old])).toEqual({ purpose: "voice-note-transcription", original_purpose: "transcription" });

      // DOWN puts back exactly the key each run was recorded under.
      await q(down);
      expect(await one("SELECT purpose FROM ai_run WHERE run_id = $1", [old])).toEqual({ purpose: "transcription" });
      await q(up);
    });
  });

  describe("Find Prices (§6.4)", () => {
    const summary = async () => (await as("admin").get("/ai-control/models/summary")).body;

    test("the unpriced models, in the worker, proposed with their pages; one the page leaves out is Not Listed", async () => {
      jest.spyOn(global, "fetch").mockImplementation(fakeFetch);
      // Gemini's seeded models with no price: 3.8 Flash and 3.5 Flash-Lite.
      expect(await summary()).toMatchObject({ finding: false, run: null, to_price: 2, not_listed: 0 });
      const res = await as("admin").post("/ai-control/prices/find").send({});
      expect(res.status).toBe(202);
      expect(await summary()).toMatchObject({ finding: true, run: { status: "running", batches_done: 0 }, proposals: 0 });
      expect((await as("admin").post("/ai-control/prices/find").send({})).status).toBe(409);
      await drain();
      expect(await runFindPricesJobs()).toBe(1);

      // One grounded request for Gemini, the provider set up, through Deep Reasoning's Pro,
      // asking only about the two with no price, with thinking kept low.
      expect(searched).toHaveLength(1);
      expect(searched[0].url.pathname).toContain("gemini-2.5-pro");
      expect(searched[0].body.tools).toEqual([{ google_search: {} }]);
      expect(searched[0].body.generationConfig).toMatchObject({ maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 1024 } });
      const asked = JSON.stringify(searched[0].body.contents);
      expect(asked).toContain("gemini-3.8-flash");
      expect(asked).toContain("gemini-3.5-flash-lite");
      expect(asked).not.toContain("gemini-2.5");
      // Delivered again (at least once): the run is claimed, nothing is asked twice.
      const runId = (await one("SELECT ai_price_run_id FROM ai_price_run ORDER BY started_at DESC LIMIT 1")).ai_price_run_id;
      await require("../../src/jobs/handlers/ai-find-prices")({ data: { ai_price_run_id: runId, actor: null } });
      expect(searched).toHaveLength(1);
      const step = await one("SELECT r.purpose, r.status, s.kind, s.searches FROM ai_run r JOIN ai_run_step s ON s.run_id = r.run_id WHERE r.purpose = 'find-prices'");
      expect(step).toEqual({ purpose: "find-prices", status: "ok", kind: "search", searches: 2 });

      expect(await summary()).toMatchObject({
        finding: false,
        run: { status: "done", batches_total: 1, batches_done: 1, proposals: 1, not_listed: 1, error_code: null, finished_at: expect.any(String) },
        last_found_at: expect.any(String),
        proposals: 1,
        to_price: 0,
        not_listed: 1,
      });
      const proposals = (await as("ops").get("/ai-control/prices")).body.data;
      expect(proposals.map((p) => [p.model, p.input_usd_per_million, p.source_url])).toEqual([
        ["gemini-3.8-flash", "0.5000", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc"],
      ]);
      const models = (await as("ops").get("/ai-control/models?provider=gemini")).body.data;
      expect(models.find((m) => m.model === "gemini-3.5-flash-lite")).toMatchObject({ not_listed: true, proposed: false });
      expect(models.find((m) => m.model === "gemini-3.8-flash")).toMatchObject({ not_listed: false, proposed: true });
      expect(models.find((m) => m.model === "gemini-2.5-flash")).toMatchObject({ input_usd_per_million: "0.3000" });

      // Accept, edited: the model takes IT's prices.
      const accepted = await as("admin")
        .post(`/ai-control/prices/${proposals[0].ai_price_proposal_id}/accept`)
        .send({ input_usd_per_million: "0.45", output_usd_per_million: "3.00", audio_usd_per_million: "", usd_per_audio_hour: "", usd_per_thousand_searches: "14.00" });
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ model: "gemini-3.8-flash", input_usd_per_million: "0.4500", usd_per_thousand_searches: "14.0000", proposed: false });
      const audit = await one("SELECT payload FROM event_log WHERE event_key = 'ai_control.price_set' ORDER BY occurred_at DESC LIMIT 1");
      expect(audit.payload).toMatchObject({ source: "proposal_edited", model: "gemini-3.8-flash" });
      expect((await as("admin").post(`/ai-control/prices/${proposals[0].ai_price_proposal_id}/accept`).send({})).status).toBe(404);
      expect((await as("admin").get("/ai-control/prices")).body.data).toEqual([]);
    });

    test("an unreadable answer fails the run with its reason; Find More asks again; Accept All saves the lot", async () => {
      jest.spyOn(global, "fetch").mockImplementation(fakeFetch);
      // A week on, the Not Listed mark lapses and the model is asked about again.
      await q("UPDATE ai_model SET price_not_listed_at = now() - interval '8 days' WHERE model = 'gemini-3.5-flash-lite'");
      expect(await summary()).toMatchObject({ to_price: 1, not_listed: 0 });

      FOUND = "The prices are on the page.";
      expect((await as("admin").post("/ai-control/prices/find").send({})).status).toBe(202);
      await drain();
      expect(await runFindPricesJobs()).toBe(1);
      expect(await summary()).toMatchObject({ run: { status: "failed", error_code: "ANSWER_UNREADABLE", batches_done: 1, proposals: 0 }, to_price: 1 });

      FOUND = { prices: [{ model: "gemini-3.5-flash-lite", input_usd_per_million: "0.10", output_usd_per_million: "0.40", audio_usd_per_million: "0.30", source_url: "https://ai.google.dev/gemini-api/docs/pricing" }] };
      expect((await as("admin").post("/ai-control/prices/find").send({})).status).toBe(202);
      await drain();
      expect(await runFindPricesJobs()).toBe(1);
      expect(await summary()).toMatchObject({ run: { status: "done", proposals: 1, not_listed: 0 }, proposals: 1, to_price: 0 });

      expect((await as("ops").post("/ai-control/prices/accept-all").send({})).status).toBe(403);
      const all = await as("admin").post("/ai-control/prices/accept-all").send({});
      expect(all.status).toBe(200);
      expect(all.body).toEqual({ accepted: 1 });
      const lite = (await as("ops").get("/ai-control/models?provider=gemini&q=3.5 flash-lite")).body.data[0];
      expect(lite).toMatchObject({ model: "gemini-3.5-flash-lite", input_usd_per_million: "0.1000", audio_usd_per_million: "0.3000", proposed: false });
      const audit = await one("SELECT payload FROM event_log WHERE event_key = 'ai_control.price_set' ORDER BY occurred_at DESC LIMIT 1");
      expect(audit.payload).toMatchObject({ source: "proposal", model: "gemini-3.5-flash-lite", source_url: "https://ai.google.dev/gemini-api/docs/pricing" });
      expect((await as("admin").post("/ai-control/prices/accept-all").send({})).body).toEqual({ accepted: 0 });
      expect(await summary()).toMatchObject({ proposals: 0, to_price: 0 });
    });

    test("a Not Listed model priced by hand is no longer counted; a run is lost only after 15 minutes without progress", async () => {
      const lite = await modelId("gemini", "gemini-3.5-flash-lite");
      await q("UPDATE ai_model SET input_usd_per_million = NULL, output_usd_per_million = NULL, audio_usd_per_million = NULL, price_not_listed_at = now() WHERE ai_model_id = $1", [lite]);
      expect(await summary()).toMatchObject({ to_price: 0, not_listed: 1 });
      const res = await as("admin").put(`/ai-control/models/${lite}/prices`).send({
        input_usd_per_million: "0.10",
        output_usd_per_million: "0.40",
        audio_usd_per_million: "",
        usd_per_audio_hour: "",
        usd_per_thousand_searches: "",
      });
      expect(res.body).toMatchObject({ not_listed: false });
      expect(await summary()).toMatchObject({ not_listed: 0 });

      // Started 20 minutes ago and still moving: running. No progress for 16 minutes: lost.
      await q("UPDATE ai_price_run SET started_at = started_at - interval '1 day'");
      const run = await one("INSERT INTO ai_price_run (status, batches_total, batches_done, started_at, claimed_at) VALUES ('running', 6, 4, now() - interval '20 minutes', now() - interval '20 minutes') RETURNING ai_price_run_id");
      expect((await summary()).run).toMatchObject({ status: "running", batches_done: 4 });
      expect((await as("admin").post("/ai-control/prices/find").send({})).status).toBe(409);
      await q("ALTER TABLE ai_price_run DISABLE TRIGGER ai_price_run_set_updated_at");
      await q("UPDATE ai_price_run SET updated_at = now() - interval '16 minutes' WHERE ai_price_run_id = $1", [run.ai_price_run_id]);
      await q("ALTER TABLE ai_price_run ENABLE TRIGGER ai_price_run_set_updated_at");
      expect(await summary()).toMatchObject({ finding: false, run: { status: "failed", error_code: "LOST" } });

      // Find Prices again: the lost run is ended, so its job, if it wakes, writes nothing more.
      expect((await as("admin").post("/ai-control/prices/find").send({})).status).toBe(202);
      expect(await one("SELECT status, error_code FROM ai_price_run WHERE ai_price_run_id = $1", [run.ai_price_run_id])).toEqual({ status: "failed", error_code: "LOST" });
      await drain();
      expect(await runFindPricesJobs()).toBe(1);
      expect(await summary()).toMatchObject({ run: { status: "done", batches_total: 0 } });

      // A run ended while its request was out (taken as lost, pressed again) keeps nothing from it.
      await q("UPDATE ai_model SET input_usd_per_million = NULL, output_usd_per_million = NULL, price_not_listed_at = NULL WHERE ai_model_id = $1", [lite]);
      expect((await as("admin").post("/ai-control/prices/find").send({})).status).toBe(202);
      const ended = (await one("SELECT ai_price_run_id FROM ai_price_run WHERE status = 'running'")).ai_price_run_id;
      const service = require("../../src/modules/ai_governance/ai_governance.service");
      const llm = {
        search: async () => {
          await q("UPDATE ai_price_run SET status = 'failed', error_code = 'LOST', finished_at = now() WHERE ai_price_run_id = $1", [ended]);
          return { text: JSON.stringify({ prices: [{ model: "gemini-3.5-flash-lite", input_usd_per_million: "0.10", output_usd_per_million: "0.40", source_url: "https://ai.google.dev/x" }] }), sources: [], run_id: null };
        },
      };
      await service.runFindPrices({ runId: ended, llm });
      expect(await one("SELECT status, error_code, batches_done, proposals FROM ai_price_run WHERE ai_price_run_id = $1", [ended])).toEqual({ status: "failed", error_code: "LOST", batches_done: 0, proposals: 0 });
      expect((await as("admin").get("/ai-control/prices")).body.data).toEqual([]);
      require("../../src/jobs/queues").enqueue.mockClear();
    });

    test("a run ended mid-way asks nothing more, on an answer or an error; a late job ends its run; one run at a time", async () => {
      const service = require("../../src/modules/ai_governance/ai_governance.service");
      const { AppError } = require("../../src/shared/errors");
      // 21 more unpriced Gemini models: two requests' worth.
      await q(
        "INSERT INTO ai_model (provider, model, display_name, capabilities, source) SELECT 'gemini', 'gemini-zz-' || n, 'Gemini ZZ ' || n, ARRAY['text'], 'added' FROM generate_series(1, 21) n",
      );
      const ask = async (onSearch) => {
        expect((await as("admin").post("/ai-control/prices/find").send({})).status).toBe(202);
        const id = (await one("SELECT ai_price_run_id FROM ai_price_run WHERE status = 'running'")).ai_price_run_id;
        const end = () => q("UPDATE ai_price_run SET status = 'failed', error_code = 'LOST', finished_at = now() WHERE ai_price_run_id = $1", [id]);
        let calls = 0;
        await service.runFindPrices({
          runId: id,
          llm: {
            search: async () => {
              calls += 1;
              await end();
              return onSearch();
            },
          },
        });
        return { calls, run: await one("SELECT status, error_code, batches_total, batches_done, proposals FROM ai_price_run WHERE ai_price_run_id = $1", [id]) };
      };
      const answered = await ask(() => ({ text: JSON.stringify({ prices: [] }), sources: [], run_id: null }));
      expect(answered).toEqual({ calls: 1, run: { status: "failed", error_code: "LOST", batches_total: 2, batches_done: 0, proposals: 0 } });
      const refused = await ask(() => {
        throw new AppError("AI_UNAVAILABLE", "No model answered", 503);
      });
      expect(refused).toEqual({ calls: 1, run: { status: "failed", error_code: "LOST", batches_total: 2, batches_done: 0, proposals: 0 } });

      // A job that comes after 15 minutes without progress ends its run as LOST and asks nothing.
      await q("UPDATE ai_price_run SET started_at = started_at - interval '1 day'");
      const late = await one("INSERT INTO ai_price_run (status) VALUES ('running') RETURNING ai_price_run_id");
      await q("ALTER TABLE ai_price_run DISABLE TRIGGER ai_price_run_set_updated_at");
      await q("UPDATE ai_price_run SET updated_at = now() - interval '16 minutes' WHERE ai_price_run_id = $1", [late.ai_price_run_id]);
      await q("ALTER TABLE ai_price_run ENABLE TRIGGER ai_price_run_set_updated_at");
      const never = { search: async () => Promise.reject(new Error("a late job must not search")) };
      await service.runFindPrices({ runId: late.ai_price_run_id, llm: never });
      expect(await one("SELECT status, error_code, claimed_at FROM ai_price_run WHERE ai_price_run_id = $1", [late.ai_price_run_id])).toEqual({ status: "failed", error_code: "LOST", claimed_at: null });

      // A run left running under a newer one (two presses in one instant): the second press is refused.
      await q("INSERT INTO ai_price_run (status, started_at) VALUES ('running', now() - interval '2 days')");
      await q("INSERT INTO ai_price_run (status, finished_at) VALUES ('done', now())");
      const twice = await as("admin").post("/ai-control/prices/find").send({});
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe("ALREADY_FINDING");

      await q("DELETE FROM ai_price_run WHERE status = 'running'");
      await q("DELETE FROM ai_model WHERE model LIKE 'gemini-zz-%'");
      require("../../src/jobs/queues").enqueue.mockClear();
    });

    test("the models open on those in a chain; Show picks the usable, those not on the key, or all", async () => {
      await q("UPDATE ai_model SET available = false WHERE provider = 'gemini' AND model = 'gemini-3.5-flash-lite'");
      // In no chain, and first by name: it still comes after every chained model.
      await q("INSERT INTO ai_model (provider, model, display_name, capabilities, source) VALUES ('gemini', 'gemini-aa-mini', 'Gemini AA Mini', ARRAY['text'], 'provider')");
      const list = async (path) => (await as("ops").get(path)).body.data;
      const usable = await list("/ai-control/models?provider=gemini");
      const firstFree = usable.findIndex((m) => m.in_chains.length === 0);
      expect(usable[firstFree].model).toBe("gemini-aa-mini");
      expect(firstFree).toBeGreaterThan(0);
      expect(usable.slice(firstFree).every((m) => m.in_chains.length === 0)).toBe(true);
      expect(usable.map((m) => m.model)).not.toContain("gemini-3.5-flash-lite");
      expect((await list("/ai-control/models?provider=gemini&show=not_on_key")).map((m) => m.model)).toEqual(["gemini-3.5-flash-lite"]);
      expect((await list("/ai-control/models?provider=gemini&show=all")).map((m) => m.model)).toContain("gemini-3.5-flash-lite");
      expect((await as("ops").get("/ai-control/models?show=some")).status).toBe(422);
      await q("UPDATE ai_model SET available = NULL WHERE provider = 'gemini' AND model = 'gemini-3.5-flash-lite'");
      await q("DELETE FROM ai_model WHERE model = 'gemini-aa-mini'");
    });
  });
});
