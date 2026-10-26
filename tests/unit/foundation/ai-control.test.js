"use strict";
/**
 * AI Control without a database (docs/guides/ai-control.md): where a chain comes from and each
 * model's state (§6.1), what a step is charged at (§6.3), the registry and its build check
 * (§6.5), and Find Prices' page rule (§6.4).
 */
const jobs = require("../../../src/services/ai/jobs");
const actions = require("../../../src/services/ai/actions");
const prices = require("../../../src/services/ai/prices");
const governance = require("../../../src/services/ai/governance");
const skips = require("../../../src/services/ai/skips");
const quota = require("../../../src/shared/integrations/quota");
const fx = require("../../../src/shared/money/fx");
const gate = require("../../../scripts/check/ai-actions");

const m = (provider, model, capabilities = ["text"], available = true) => ({ provider, model, display_name: model, capabilities, available });

/** A catalogue as jobs.catalogue() builds it. */
function cat({ keyed = ["gemini"], stored = {} } = {}) {
  const all = [
    m("gemini", "gemini-3.8-flash", ["text", "image", "audio"]),
    m("gemini", "gemini-2.5-pro", ["text", "image"]),
    m("gemini", "gemini-2.5-flash-lite"),
    m("groq", "whisper-large-v3", ["audio"]),
    m("anthropic", "claude-sonnet-5-5", ["text", "image"]),
    m("deepseek", "deepseek-v4-flash"),
    m("openai", "text-embedding-3-small", ["embeddings"]),
  ];
  const byProvider = {};
  for (const p of ["gemini", "groq", "openai", "anthropic", "deepseek"]) byProvider[p] = all.filter((r) => r.provider === p);
  const s = new Map(Object.entries(stored).map(([k, links]) => [k, { links, updated_by_name: "Femi Bello", updated_at: new Date() }]));
  return { byProvider, keyed: new Set(keyed), stored: s };
}

describe("where a chain comes from (§6.1 step 1)", () => {
  test("the action's saved chain, else the registry's, else the job's saved chain, else the job's in code", () => {
    const code = cat();
    expect(jobs.sourceOf(code, "action", "policy-tidy")).toMatchObject({ scope: "job", key: "default", stored: false });
    expect(jobs.sourceOf(code, "action", "policy-tidy").links.map((l) => l.model)).toEqual(["gemini-3.8-flash"]);
    expect(jobs.sourceOf(code, "action", "data-answers")).toMatchObject({ scope: "action", stored: false });
    expect(jobs.sourceOf(code, "action", "data-answers").links.map((l) => l.model)).toEqual(["gemini-3.8-flash", "gemini-2.5-pro"]);

    const jobSaved = cat({ stored: { "job:default": [{ position: 1, provider: "gemini", model: "GEMINI-2.5-PRO" }] } });
    const viaJob = jobs.sourceOf(jobSaved, "action", "policy-tidy");
    expect(viaJob).toMatchObject({ scope: "job", key: "default", stored: true, updated_by_name: "Femi Bello" });
    // Spelled as the provider spells it.
    expect(viaJob.links).toEqual([{ provider: "gemini", model: "gemini-2.5-pro", display_name: "gemini-2.5-pro", position: 1 }]);

    const own = cat({
      stored: {
        "job:default": [{ position: 1, provider: "gemini", model: "gemini-2.5-pro" }],
        "action:policy-tidy": [
          { position: 1, provider: "anthropic", model: "claude-sonnet-5-5" },
          { position: 2, provider: "gemini", model: "gemini-3.8-flash" },
        ],
      },
    });
    expect(jobs.sourceOf(own, "action", "policy-tidy")).toMatchObject({ scope: "action", key: "policy-tidy", stored: true });
    expect(() => jobs.sourceOf(own, "job", "nonsense")).toThrow(/no job/);
  });

  test("a chain in code still names a provider without a key, so the screen can show it Not Set Up", () => {
    expect(jobs.sourceOf(cat(), "job", "transcription").links.map((l) => l.provider)).toEqual(["groq", "gemini"]);
    // chainFrom, for the test before a save, keeps to the providers in hand.
    expect(jobs.chainFrom("transcription", { gemini: cat().byProvider.gemini }).map((l) => l.provider)).toEqual(["gemini"]);
  });
});

describe("each model's state (§6.1 step 2)", () => {
  const settings = require("../../../src/shared/integrations/settings");
  let capped;
  /** The database jobs.catalogue() reads: the model lists and the saved chains. */
  const fixture = cat();
  const models = Object.values(fixture.byProvider).flat();
  const chains = [
    ["action", "find-prices", 1, "anthropic", "claude-sonnet-5-5"],
    ["action", "find-prices", 2, "gemini", "gemini-2.5-pro"],
    ["job", "default", 1, "deepseek", "deepseek-v4-flash"],
    ["job", "default", 2, "groq", "whisper-large-v3"],
    ["job", "default", 3, "gemini", "gemini-0-gone"],
    ["job", "default", 4, "gemini", "gemini-3.8-flash"],
  ].map(([scope, key, position, provider, model]) => ({ scope, key, position, provider, model, updated_at: new Date(), updated_by_name: "Femi Bello" }));
  const db = { query: async (sql) => ({ rows: /FROM ai_chain/.test(sql) ? chains : /FROM ai_model/.test(sql) ? models : [] }) };
  beforeEach(() => {
    jobs.forget();
    capped = new Set();
    jest.spyOn(settings, "version").mockResolvedValue(null);
    jest.spyOn(settings, "secret").mockImplementation(async (code) => (["gemini", "deepseek", "anthropic"].includes(code) ? "key" : null));
    jest.spyOn(governance, "atCap").mockImplementation(async () => capped);
    jest.spyOn(quota, "spent").mockResolvedValue(false);
    jest.spyOn(skips, "until").mockResolvedValue(null);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jobs.forget();
  });

  test("personal data passes DeepSeek by; no key, Not Set Up; off the list, Not on Key; the rest Ready", async () => {
    const r = await jobs.resolve("policy-tidy", { db });
    expect(r.links.map((l) => [l.provider, l.state])).toEqual([
      ["deepseek", "personal_data"],
      ["groq", "not_set_up"],
      ["gemini", "not_on_key"],
      ["gemini", "ready"],
    ]);
    expect((await jobs.walk("policy-tidy", { db })).map((l) => l.model)).toEqual(["gemini-3.8-flash"]);
    // A job's own card has no action, so DeepSeek is Ready there.
    expect((await jobs.resolveJob("default", { db })).links[0].state).toBe("ready");
  });

  test("a search on a provider that cannot search; a cap; a Free plan's daily limit; a skip with its time", async () => {
    expect((await jobs.resolve("find-prices", { db })).links.map((l) => l.state)).toEqual(["cannot_search", "ready"]);
    capped.add("gemini");
    expect((await jobs.resolve("find-prices", { db })).links[1].state).toBe("at_cap");
    capped.clear();
    quota.spent.mockImplementation(async (code) => code === "gemini");
    expect((await jobs.resolve("find-prices", { db })).links[1].state).toBe("daily_limit");
    quota.spent.mockResolvedValue(false);
    const at = new Date(Date.now() + 60_000);
    skips.until.mockImplementation(async (p) => (p === "gemini" ? at : null));
    expect((await jobs.resolve("find-prices", { db })).links[1]).toMatchObject({ state: "skipped", until: at.toISOString() });
  });

  test("a purpose the registry does not hold answers on the Default job's chain", async () => {
    expect(await jobs.resolve("test-draft", { db })).toMatchObject({ scope: "job", key: "default" });
  });
});

describe("what a step is charged at (§6.3)", () => {
  const db = { query: jest.fn() };
  const row = (r) => db.query.mockResolvedValueOnce({ rows: r ? [r] : [] });
  beforeEach(() => {
    db.query.mockReset();
    jest.spyOn(fx, "newest").mockResolvedValue({ day: "2026-10-20", usd_ngn: "1534.2100000000" });
    jest.spyOn(quota, "plan").mockResolvedValue("paid");
    jest.spyOn(governance, "settings").mockResolvedValue({ input_ngn_per_million: "450.00", output_ngn_per_million: "3750.00" });
  });
  afterEach(() => jest.restoreAllMocks());

  test("dollars times the newest rate, to the kobo, with the rate kept", async () => {
    row({ input_usd_per_million: "0.3000", output_usd_per_million: "2.5000", audio_usd_per_million: "1.0000", usd_per_audio_hour: null, usd_per_thousand_searches: "14.0000" });
    expect(await prices.forStep(db, { provider: "gemini", model: "gemini-2.5-flash" })).toEqual({
      input_ngn_per_million: "460.26",
      output_ngn_per_million: "3835.53",
      ngn_per_audio_hour: null,
      ngn_per_search: "21.48",
      usd_ngn_rate: "1534.2100000000",
      rate_day: "2026-10-20",
    });
    row({ input_usd_per_million: "0.3000", output_usd_per_million: "2.5000", audio_usd_per_million: "1.0000", usd_per_audio_hour: null, usd_per_thousand_searches: null });
    // Audio in: the audio price.
    expect((await prices.forStep(db, { provider: "gemini", model: "gemini-2.5-flash", audio: true })).input_ngn_per_million).toBe("1534.21");
  });

  test("a Free plan pays nothing; a model with no price, or no rate yet, pays ai_setting's naira", async () => {
    quota.plan.mockResolvedValueOnce("free");
    expect(await prices.forStep(db, { provider: "groq", model: "whisper-large-v3" })).toEqual(prices.zero());
    row({ input_usd_per_million: null, output_usd_per_million: null, audio_usd_per_million: null, usd_per_audio_hour: null, usd_per_thousand_searches: null });
    expect(await prices.forStep(db, { provider: "gemini", model: "gemini-3.8-flash" })).toMatchObject({ input_ngn_per_million: "450.00", output_ngn_per_million: "3750.00", usd_ngn_rate: null });
    fx.newest.mockResolvedValueOnce(null);
    row({ input_usd_per_million: "0.3000", output_usd_per_million: "2.5000" });
    expect(await prices.forStep(db, { provider: "gemini", model: "gemini-2.5-flash" })).toMatchObject({ input_ngn_per_million: "450.00" });
    // A paid speech model: its hour is all there is.
    row({ input_usd_per_million: null, output_usd_per_million: null, audio_usd_per_million: null, usd_per_audio_hour: "0.1110", usd_per_thousand_searches: null });
    expect(await prices.forStep(db, { provider: "groq", model: "whisper-large-v3" })).toMatchObject({ ngn_per_audio_hour: "170.30", input_ngn_per_million: "0.00" });
  });

  test("a step's naira adds audio by the hour and searches by the one", () => {
    const cost = governance.costOf(
      { input_tokens: 1000, output_tokens: 200, audio_seconds: 36, searches: 2 },
      { input_ngn_per_million: "450.00", output_ngn_per_million: "3750.00", ngn_per_audio_hour: "170.30", ngn_per_search: "21.48" },
    );
    // 0.45 + 0.75 + 1.703 + 42.96
    expect(cost.toFixed(3)).toBe("45.863");
  });
});

describe("the registry and its check (§6.5)", () => {
  test("every action names a job, its personal data, who chose it and when; the connection test is direct", () => {
    for (const a of Object.values(actions.ACTIONS)) {
      expect(typeof a.personal_data).toBe("boolean");
      expect(a.chosen_by).toMatch(/^[A-Z]{2,3}$/);
    }
    expect(actions.listed().map((a) => a.key)).not.toContain("integration-test");
    expect(actions.of("integration-test")).toMatchObject({ direct: true, job: null });
    expect(() => actions.of("made-up")).toThrow(/not registered/);
  });

  test("the build passes as it stands, and fails a call that names no registered action", () => {
    expect(gate.check()).toEqual([]);
    const bad = gate.check({
      extra: [
        { rel: "src/modules/x/a.service.js", code: 'await ai.complete({ purpose: "made-up", module: "people" });' },
        { rel: "src/modules/x/b.service.js", code: "await ai.complete({ purpose: key, module: \"people\" });" },
        { rel: "src/modules/x/c.service.js", code: 'await ai.complete({ module: "people", input: { purpose: "policy-tidy" } });' },
        { rel: "src/modules/x/d.service.js", code: 'await transcription.transcribe({ purpose: "dictation", document_id });' },
        // A comment is not code.
        { rel: "src/modules/x/e.service.js", code: '// ai.complete({ purpose: "made-up" })' },
        { rel: "src/modules/x/f.service.js", code: 'await ai.embed({ purpose: "made-up-vectors", module: "knowledge", input });' },
        { rel: "src/modules/x/g.service.js", code: 'await ai.embed({ purpose: "guide-search", module: "knowledge", input });' },
      ],
    });
    expect(bad).toEqual([
      expect.stringMatching(/a\.service\.js:1: purpose "made-up" is not registered/),
      expect.stringMatching(/b\.service\.js:1: name the action as a literal string/),
      expect.stringMatching(/c\.service\.js:1: complete\(\) names no purpose/),
      expect.stringMatching(/d\.service\.js:1: purpose "dictation" is not registered/),
      expect.stringMatching(/f\.service\.js:1: purpose "made-up-vectors" is not registered/),
    ]);
  });
});

describe("Find Prices' pages (§6.4)", () => {
  const { sourceFor } = require("../../../src/modules/ai_governance/ai_governance.service");
  test("the model's page when it is on the provider's site, else the search's first, else the pricing page", () => {
    expect(sourceFor("https://ai.google.dev/gemini-api/docs/pricing", [], "gemini")).toBe("https://ai.google.dev/gemini-api/docs/pricing");
    expect(sourceFor("https://docs.claude.com/en/pricing", [], "anthropic")).toBe("https://docs.claude.com/en/pricing");
    expect(sourceFor("https://ai.google.dev.evil.example/x", [{ url: "https://vertexaisearch.cloud.google.com/r/1" }], "gemini")).toBe("https://vertexaisearch.cloud.google.com/r/1");
    expect(sourceFor("http://ai.google.dev/x", [], "gemini")).toBe("https://ai.google.dev/gemini-api/docs/pricing");
    expect(sourceFor(null, [], "deepseek")).toBe("https://api-docs.deepseek.com/quick_start/pricing");
  });
});
