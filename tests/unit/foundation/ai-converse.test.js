"use strict";
/**
 * Every text model answers, tools included (docs/guides/ai-control.md decision 34,
 * docs/guides/praxis-ai.md §6.7), without a network or a database: each vendor file sends tools
 * and answers in one shape, and converse() keeps one run for a question, a step per round, the
 * model that answered last, and hands the same conversation down the chain when a model fails.
 */
const http = require("../../../src/services/ai/vendors/http");
const anthropic = require("../../../src/services/ai/vendors/anthropic");
const deepseek = require("../../../src/services/ai/vendors/deepseek");
const groq = require("../../../src/services/ai/vendors/groq");
const openai = require("../../../src/services/ai/vendors/openai");
const gemini = require("../../../src/services/ai/vendors/gemini");
const ai = require("../../../src/services/ai/llm.service");
const jobs = require("../../../src/services/ai/jobs");
const skips = require("../../../src/services/ai/skips");
const prices = require("../../../src/services/ai/prices");
const governance = require("../../../src/services/ai/governance");
const ledger = require("../../../src/services/ai/ledger");
const integrations = require("../../../src/shared/integrations/settings");
const usage = require("../../../src/shared/integrations/usage");
const aiActions = require("../../../scripts/check/ai-actions");

const TOOL = {
  type: "function",
  function: {
    name: "leave__requests",
    description: "Leave requests waiting on someone",
    parameters: { type: "object", properties: { page: { type: "integer" } } },
  },
};

/** A conversation one tool round in: the question, the call, what the read returned. */
const CONVERSATION = [
  { role: "system", content: "You answer from reads." },
  { role: "user", content: "Whose leave waits on me?" },
  {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "fc:1", type: "function", function: { name: "leave__requests", arguments: '{"page":1}' }, extra_content: { google: { thought_signature: "sig" } } }],
  },
  { role: "tool", tool_call_id: "fc:1", content: '{"data":[{"employee":"Ada Obi"}]}' },
];

/** A fetch that keeps what was sent and answers `reply`. */
function capture(reply) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return Response.json(reply);
  };
  return { sent, fetchImpl };
}

describe("every vendor file sends tools and answers in one shape", () => {
  test("Anthropic: calls become tool_use, results a tool_result in the user turn after, ids made safe, stop reasons in OpenAI's words", async () => {
    const { sent, fetchImpl } = capture({
      content: [
        { type: "text", text: "Reading leave." },
        { type: "tool_use", id: "toolu_2", name: "leave__requests", input: { page: 2 } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 40, output_tokens: 9 },
      model: "claude-sonnet-5-5",
    });
    const res = await anthropic.complete({
      apiKey: "k",
      model: "claude-sonnet-5-5",
      system: "You answer from reads.",
      messages: CONVERSATION.slice(1),
      tools: [TOOL],
      fetchImpl,
    });
    const body = sent[0].body;
    expect(body.tools).toEqual([{ name: "leave__requests", description: "Leave requests waiting on someone", input_schema: TOOL.function.parameters }]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Whose leave waits on me?" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "fc_1", name: "leave__requests", input: { page: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "fc_1", content: '{"data":[{"employee":"Ada Obi"}]}' }] },
    ]);
    expect(res).toMatchObject({
      text: "Reading leave.",
      toolCalls: [{ id: "toolu_2", type: "function", function: { name: "leave__requests", arguments: '{"page":2}' } }],
      finish_reason: "tool_calls",
      usage: { input_tokens: 40, output_tokens: 9 },
    });
  });

  test("Anthropic: a cut-off answer reads as length, a plain one as stop", async () => {
    const reply = (stop_reason) => capture({ content: [{ type: "text", text: "Two." }], stop_reason, usage: {} }).fetchImpl;
    const ask = (stop) => anthropic.complete({ apiKey: "k", model: "claude-haiku-5-5", messages: [{ role: "user", content: "Hi" }], fetchImpl: reply(stop) });
    expect((await ask("max_tokens")).finish_reason).toBe("length");
    expect((await ask("end_turn")).finish_reason).toBe("stop");
    expect((await ask("end_turn")).toolCalls).toEqual([]);
  });

  test("Groq and OpenAI answer text with tools; OpenAI's ceiling is max_completion_tokens and only GPT-4 gets a temperature", async () => {
    const reply = {
      choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "leave__requests", arguments: "{}" } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    };
    const g = capture(reply);
    const gr = await groq.complete({ apiKey: "k", model: "llama-4-scout", messages: CONVERSATION, tools: [TOOL], maxTokens: 900, fetchImpl: g.fetchImpl });
    expect(g.sent[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(g.sent[0].body).toMatchObject({ model: "llama-4-scout", tools: [TOOL], tool_choice: "auto", max_tokens: 900, temperature: 0.2 });
    expect(gr).toMatchObject({ toolCalls: [{ id: "c1", function: { name: "leave__requests", arguments: "{}" } }], finish_reason: "tool_calls", usage: { input_tokens: 12, output_tokens: 3 } });

    const o = capture(reply);
    await openai.complete({ apiKey: "k", model: "gpt-5-mini", messages: CONVERSATION, tools: [TOOL], json: false, maxTokens: 900, fetchImpl: o.fetchImpl });
    expect(o.sent[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(o.sent[0].body.max_completion_tokens).toBe(900);
    expect(o.sent[0].body).not.toHaveProperty("temperature");
    expect(o.sent[0].body).not.toHaveProperty("max_tokens");
    const o4 = capture(reply);
    await openai.complete({ apiKey: "k", model: "gpt-4.1", messages: CONVERSATION, json: true, fetchImpl: o4.fetchImpl });
    expect(o4.sent[0].body).toMatchObject({ temperature: 0.2, response_format: { type: "json_object" } });
  });

  test("a conversation Gemini began goes to another provider without Gemini's own fields; Gemini gets its thought signature back", async () => {
    const reply = { choices: [{ message: { content: "Ada Obi." }, finish_reason: "stop" }], usage: {} };
    const d = capture(reply);
    await deepseek.complete({ apiKey: "k", model: "deepseek-chat", messages: CONVERSATION, tools: [TOOL], fetchImpl: d.fetchImpl });
    expect(d.sent[0].body.messages[2].tool_calls[0]).toEqual({ id: "fc:1", type: "function", function: { name: "leave__requests", arguments: '{"page":1}' } });
    expect(d.sent[0].body.tools).toEqual([TOOL]);

    const m = capture(reply);
    await gemini.complete({ apiKey: "k", model: "gemini-3.8-flash", messages: CONVERSATION, tools: [TOOL], fetchImpl: m.fetchImpl });
    expect(m.sent[0].body.messages[2].tool_calls[0].extra_content).toEqual({ google: { thought_signature: "sig" } });
  });

  test("a reply's tool calls keep what the vendor attached, and a call without an id is given one", () => {
    const res = http.chatResult(
      { choices: [{ message: { tool_calls: [{ type: "function", function: { name: "a__b", arguments: { x: 1 } }, extra_content: { s: 1 } }, { function: {} }] } }] },
      "m",
    );
    expect(res.toolCalls).toEqual([{ id: "call_1", type: "function", function: { name: "a__b", arguments: '{"x":1}' }, extra_content: { s: 1 } }]);
  });
});

describe("converse(): one run for a question, a step per round, the chain walked once", () => {
  const db = { query: async () => ({ rows: [] }) };
  const CHAIN = [
    { provider: "gemini", model: "gemini-3.8-flash" },
    { provider: "anthropic", model: "claude-sonnet-5-5" },
  ];
  const chainOf = (links) => ({
    scope: "action",
    key: "data-answers",
    stored: false,
    links: links.map((l, i) => ({ ...l, display_name: l.model, position: i + 1, state: l.state || "ready", until: null })),
  });
  const answer = (text, toolCalls = []) => ({ text, toolCalls, usage: { input_tokens: 10, output_tokens: 2 }, model: undefined, finish_reason: toolCalls.length ? "tool_calls" : "stop" });
  const failure = (kind, extra = {}) => Object.assign(new Error(`${kind} failure`), { kind, ...extra });
  let steps;
  let finished;

  beforeEach(async () => {
    steps = [];
    finished = [];
    usage.__reset();
    await skips.clear("gemini");
    await skips.clear("anthropic");
    jest.spyOn(governance, "check").mockResolvedValue({ settings: {} });
    jest.spyOn(ledger, "startRun").mockResolvedValue("run-1");
    jest.spyOn(ledger, "recordStep").mockImplementation(async (_db, _id, s) => {
      steps.push([s.step_no, s.vendor, s.kind, s.outcome]);
      return "1.50";
    });
    jest.spyOn(ledger, "finishRun").mockImplementation(async (_db, _id, f) => {
      finished.push(f);
    });
    jest.spyOn(ledger, "refused").mockResolvedValue("run-refused");
    jest.spyOn(jobs, "resolve").mockResolvedValue(chainOf(CHAIN));
    jest.spyOn(prices, "forStep").mockResolvedValue(prices.zero());
    jest.spyOn(integrations, "secret").mockResolvedValue("key");
  });
  afterEach(() => jest.restoreAllMocks());

  const talk = (vendors, over = {}) => ai.converse({ purpose: "data-answers", module: "praxis_ai", actor: null, db, vendors, prompt: "integration-test", ...over });

  test("the first choice answers every round; one run, a step a round, closed once as answered", async () => {
    const g = jest.fn().mockResolvedValueOnce(answer("", CONVERSATION[2].tool_calls)).mockResolvedValueOnce(answer('{"text":"Ada Obi."}'));
    const a = jest.fn();
    const t = await talk({ gemini: { complete: g }, anthropic: { complete: a }, stub: { complete: jest.fn() } });
    const r1 = await t.round({ messages: CONVERSATION.slice(0, 2), tools: [TOOL] });
    expect(r1).toMatchObject({ provider: "gemini", toolCalls: [expect.objectContaining({ id: "fc:1" })] });
    expect(g.mock.calls[0][0]).toMatchObject({ tools: [TOOL], model: "gemini-3.8-flash" });
    await t.round({ messages: CONVERSATION });
    await t.finish();
    expect(a).not.toHaveBeenCalled();
    expect(steps).toEqual([[1, "gemini", "completion", "ok"], [2, "gemini", "completion", "ok"]]);
    expect(finished).toEqual([{ status: "ok", vendor: "gemini", model: "gemini-3.8-flash" }]);
    expect(t.cost()).toBe("3.00");
    expect(ledger.startRun).toHaveBeenCalledTimes(1);
  });

  test("the first choice fails mid-question: the fallback gets the same conversation and keeps the rest of it", async () => {
    const g = jest.fn().mockResolvedValueOnce(answer("", CONVERSATION[2].tool_calls)).mockRejectedValue(failure("transient"));
    const a = jest.fn().mockResolvedValue(answer('{"text":"Ada Obi."}'));
    const t = await talk({ gemini: { complete: g }, anthropic: { complete: a }, stub: { complete: jest.fn() } });
    await t.round({ messages: CONVERSATION.slice(0, 2), tools: [TOOL] });
    const r2 = await t.round({ messages: CONVERSATION, tools: [TOOL] });
    expect(r2).toMatchObject({ provider: "anthropic", text: '{"text":"Ada Obi."}' });
    // Anthropic was handed the whole conversation so far, the read's result included.
    expect(a.mock.calls[0][0].messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(a.mock.calls[0][0].system).toBe("You answer from reads.");
    await t.round({ messages: CONVERSATION });
    expect(g).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenCalledTimes(2);
    expect(steps.map((s) => s.slice(1, 4))).toEqual([
      ["gemini", "completion", "ok"],
      ["gemini", "completion", "failed"],
      ["anthropic", "completion", "ok"],
      ["anthropic", "completion", "ok"],
    ]);
  });

  test("a quota refusal with a reset skips the provider until then; every model failing closes the run as AI_UNAVAILABLE", async () => {
    const g = jest.fn().mockRejectedValue(failure("rate_limited", { status: 429, retryAfterMs: 60_000 }));
    const a = jest.fn().mockRejectedValue(failure("timeout"));
    const t = await talk({ gemini: { complete: g }, anthropic: { complete: a }, stub: { complete: jest.fn() } });
    await expect(t.round({ messages: CONVERSATION.slice(0, 2), tools: [TOOL] })).rejects.toMatchObject({ code: "AI_UNAVAILABLE", status: 503 });
    expect(await skips.until("gemini")).not.toBeNull();
    expect(finished).toEqual([expect.objectContaining({ status: "failed", error_code: "AI_UNAVAILABLE" })]);
    await expect(t.round({ messages: CONVERSATION.slice(0, 2) })).rejects.toThrow(/already closed/);
  });

  test("a wrong key as the last word is AI_VENDOR_CONFIG", async () => {
    const g = jest.fn().mockRejectedValue(failure("transient"));
    const a = jest.fn().mockRejectedValue(failure("config", { status: 401 }));
    const t = await talk({ gemini: { complete: g }, anthropic: { complete: a }, stub: { complete: jest.fn() } });
    await expect(t.round({ messages: CONVERSATION.slice(0, 2) })).rejects.toMatchObject({ code: "AI_VENDOR_CONFIG" });
  });

  test("the person's words and the reads' rows leave redacted; the system turn and the model's own do not", async () => {
    const g = jest.fn().mockResolvedValue(answer("ok"));
    const t = await talk({ gemini: { complete: g }, anthropic: { complete: jest.fn() }, stub: { complete: jest.fn() } });
    await t.round({
      messages: [
        { role: "system", content: "Rule: BVN 12345678901 is an example." },
        { role: "user", content: "Is BVN 22233344455 Ada's?" },
        { role: "tool", tool_call_id: "c", content: '{"bvn":"BVN 99988877766"}' },
      ],
    });
    const sentMsgs = g.mock.calls[0][0].messages;
    expect(sentMsgs[0].content).toContain("12345678901");
    expect(sentMsgs[1].content).not.toContain("22233344455");
    expect(sentMsgs[2].content).not.toContain("99988877766");
  });

  test("no provider set up: the stub answers; governance's refusal is recorded and nothing is asked", async () => {
    jobs.resolve.mockResolvedValue(chainOf(CHAIN.map((l) => ({ ...l, state: "not_set_up" }))));
    const stub = { complete: jest.fn().mockResolvedValue(answer("[AI placeholder]")) };
    const t = await talk({ gemini: { complete: jest.fn() }, anthropic: { complete: jest.fn() }, stub });
    expect(t.stub).toBe(true);
    expect((await t.round({ messages: CONVERSATION.slice(0, 2) })).provider).toBe("stub");

    const { AppError } = require("../../../src/shared/errors");
    governance.check.mockRejectedValue(new AppError("AI_DISABLED", "AI is switched off.", 403));
    await expect(talk({ stub })).rejects.toMatchObject({ code: "AI_DISABLED" });
    expect(ledger.refused).toHaveBeenCalledWith(db, expect.objectContaining({ purpose: "data-answers" }));
  });
});

describe("the registry check reads converse() too", () => {
  test("an unregistered or non-literal purpose on converse() fails the build", () => {
    const problems = aiActions.check({
      extra: [
        { rel: "src/modules/x/a.service.js", code: 'await ai.converse({ purpose: "made-up", module: "praxis_ai" });' },
        { rel: "src/modules/x/b.service.js", code: 'await ai.converse({ purpose: key, module: "praxis_ai" });' },
        { rel: "src/modules/x/c.service.js", code: 'await ai.converse({ purpose: "data-answers", module: "praxis_ai" });' },
      ],
    });
    expect(problems.filter((p) => p.startsWith("src/modules/x/"))).toEqual([
      expect.stringContaining('a.service.js:1: purpose "made-up" is not registered'),
      expect.stringContaining("b.service.js:1: name the action as a literal string"),
    ]);
  });
});
