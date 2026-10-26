"use strict";
/**
 * embed(): vectors for search on the Embeddings job (docs/guides/ai-control.md §6.6), without a
 * network or a database: governance first, the action's one model, a step per batch charged on
 * its input, nothing half-returned, and no run at all when no provider of the chain is set up.
 */
const ai = require("../../../src/services/ai/llm.service");
const jobs = require("../../../src/services/ai/jobs");
const skips = require("../../../src/services/ai/skips");
const prices = require("../../../src/services/ai/prices");
const governance = require("../../../src/services/ai/governance");
const ledger = require("../../../src/services/ai/ledger");
const integrations = require("../../../src/shared/integrations/settings");
const usage = require("../../../src/shared/integrations/usage");
const { AppError } = require("../../../src/shared/errors");

const db = { query: async () => ({ rows: [] }) };
const chainOf = (links) => ({
  scope: "action",
  key: "guide-search",
  stored: false,
  links: links.map((l, i) => ({ display_name: l.model, position: i + 1, state: "ready", until: null, ...l })),
});
const vector = (x) => Array.from({ length: ai.EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? x : 0));
const vectorsFor = (input) => ({ vectors: input.map((_, i) => vector(i)), usage: { input_tokens: 5 * input.length, output_tokens: 0 }, model: "text-embedding-3-small" });
const failure = (kind, extra = {}) => Object.assign(new Error(`${kind} failure`), { kind, ...extra });

let steps;
let finished;
beforeEach(async () => {
  steps = [];
  finished = [];
  usage.__reset();
  await skips.clear("openai");
  jest.spyOn(governance, "check").mockResolvedValue({ settings: {} });
  jest.spyOn(ledger, "startRun").mockResolvedValue("run-1");
  jest.spyOn(ledger, "recordStep").mockImplementation(async (_db, _id, s) => {
    steps.push([s.step_no, s.kind, s.outcome, s.usage ? s.usage.input_tokens : null]);
    return "0.01";
  });
  jest.spyOn(ledger, "finishRun").mockImplementation(async (_db, _id, f) => finished.push(f));
  jest.spyOn(ledger, "refused").mockResolvedValue("run-refused");
  jest.spyOn(jobs, "resolve").mockResolvedValue(chainOf([{ provider: "openai", model: "text-embedding-3-small" }]));
  jest.spyOn(prices, "forStep").mockResolvedValue(prices.zero());
  jest.spyOn(integrations, "secret").mockResolvedValue("key");
});
afterEach(() => jest.restoreAllMocks());

const call = (vendors, over = {}) => ai.embed({ purpose: "guide-search", module: "knowledge", actor: null, input: ["a", "b"], db, vendors, ...over });

test("one run, a step per batch of 96 charged on its input, the vectors in order, the size asked for", async () => {
  const embed = jest.fn(async ({ input }) => vectorsFor(input));
  const texts = Array.from({ length: 100 }, (_, i) => `passage ${i}`);
  const r = await call({ openai: { embed } }, { input: texts });
  expect(embed).toHaveBeenCalledTimes(2);
  expect(embed.mock.calls[0][0]).toMatchObject({ apiKey: "key", model: "text-embedding-3-small", dimensions: 1536 });
  expect(embed.mock.calls[0][0].input).toHaveLength(96);
  expect(embed.mock.calls[1][0].input).toHaveLength(4);
  expect(r.vectors).toHaveLength(100);
  expect(r.vectors[96][0]).toBe(0);
  expect(r).toMatchObject({ model: "text-embedding-3-small", vendor: "openai", run_id: "run-1", cost_ngn: "0.02" });
  expect(steps).toEqual([
    [1, "embedding", "ok", 480],
    [2, "embedding", "ok", 20],
  ]);
  expect(finished).toEqual([{ status: "ok", vendor: "openai", model: "text-embedding-3-small" }]);
  expect(prices.forStep).toHaveBeenCalledWith(db, expect.objectContaining({ embeddings: true }));
});

test("with no provider set up there are no vectors and no run, so a search goes by its words", async () => {
  jobs.resolve.mockResolvedValue(chainOf([{ provider: "openai", model: "text-embedding-3-small", state: "not_set_up" }]));
  const r = await call({ openai: { embed: jest.fn() } });
  expect(r).toMatchObject({ vectors: null, vendor: "stub", run_id: null });
  expect(ledger.startRun).not.toHaveBeenCalled();
  governance.check.mockResolvedValue({ settings: { forced_stub: true } });
  expect((await call({ openai: { embed: jest.fn() } })).vectors).toBeNull();
});

test("a model without embeddings in its vendor file is no model for this", async () => {
  jobs.resolve.mockResolvedValue(chainOf([{ provider: "gemini", model: "gemini-embedding-001" }]));
  expect((await call({ gemini: { complete: jest.fn() } })).vectors).toBeNull();
});

test("a refusal by governance is recorded and thrown", async () => {
  governance.check.mockRejectedValue(new AppError("AI_DISABLED", "AI is switched off.", 503));
  await expect(call({ openai: { embed: jest.fn() } })).rejects.toMatchObject({ code: "AI_DISABLED" });
  expect(ledger.refused).toHaveBeenCalledWith(db, expect.objectContaining({ purpose: "guide-search", module: "knowledge" }));
});

test("a model passed by (at its cap) fails the run without a call", async () => {
  jobs.resolve.mockResolvedValue(chainOf([{ provider: "openai", model: "text-embedding-3-small", state: "at_cap" }]));
  const embed = jest.fn();
  await expect(call({ openai: { embed } })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  expect(embed).not.toHaveBeenCalled();
  expect(finished[0]).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE" });
});

test("a failure is retried once, or not at all when a screen is waiting", async () => {
  const embed = jest.fn().mockRejectedValueOnce(failure("transient")).mockImplementation(async ({ input }) => vectorsFor(input));
  expect((await call({ openai: { embed } })).vectors).toHaveLength(2);
  expect(steps.map((s) => s[2])).toEqual(["failed", "ok"]);

  const once = jest.fn().mockRejectedValue(failure("timeout"));
  await expect(call({ openai: { embed: once } }, { retry: false })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  expect(once).toHaveBeenCalledTimes(1);
});

test("a wrong key is reported and not retried; a quota refusal skips the provider until it resets", async () => {
  const wrong = jest.fn().mockRejectedValue(failure("config", { status: 401 }));
  await expect(call({ openai: { embed: wrong } })).rejects.toMatchObject({ code: "AI_VENDOR_CONFIG" });
  expect(wrong).toHaveBeenCalledTimes(1);

  const spent = jest.fn().mockRejectedValue(failure("rate_limited", { retryAfterMs: 60_000 }));
  await expect(call({ openai: { embed: spent } })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  expect(spent).toHaveBeenCalledTimes(1);
  expect(await skips.until("openai")).toBeTruthy();
});

test("vectors of another size, or too few, are never handed back", async () => {
  const short = jest.fn(async ({ input }) => ({ vectors: input.map(() => [0.1, 0.2]), usage: { input_tokens: 1, output_tokens: 0 } }));
  await expect(call({ openai: { embed: short } })).rejects.toMatchObject({ code: "AI_BAD_OUTPUT" });
  expect(steps[0][2]).toBe("invalid");
  const fewer = jest.fn(async () => ({ vectors: [vector(1)], usage: { input_tokens: 1, output_tokens: 0 } }));
  await expect(call({ openai: { embed: fewer } })).rejects.toMatchObject({ code: "AI_BAD_OUTPUT" });
});

test("only the third generation of OpenAI's models is told the size", async () => {
  jobs.resolve.mockResolvedValue(chainOf([{ provider: "openai", model: "text-embedding-ada-002" }]));
  const embed = jest.fn(async ({ input }) => vectorsFor(input));
  await call({ openai: { embed } });
  expect(embed.mock.calls[0][0].dimensions).toBeUndefined();
});

test("a purpose and a module are checked before anything", async () => {
  await expect(ai.embed({ purpose: "Bad Purpose", module: "knowledge", input: "x", db })).rejects.toThrow(/kebab-case/);
  await expect(ai.embed({ purpose: "guide-search", module: "nowhere", input: "x", db })).rejects.toThrow(/not a module key/);
});
