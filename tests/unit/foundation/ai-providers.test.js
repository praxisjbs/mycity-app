"use strict";
/**
 * The AI providers without a network or a database (docs/guides/integrations.md §1.2): how each
 * vendor's failures are classified and when it asked us to come back, how a provider's model
 * list is sorted into what the ERP uses, each job's model until AI Control, and voice note
 * transcription through Groq, then Gemini, then the browser's captions.
 */
const http = require("../../../src/services/ai/vendors/http");
const groq = require("../../../src/services/ai/vendors/groq");
const anthropic = require("../../../src/services/ai/vendors/anthropic");
const catalogue = require("../../../src/services/ai/catalogue");
const jobs = require("../../../src/services/ai/jobs");
const skips = require("../../../src/services/ai/skips");
const prices = require("../../../src/services/ai/prices");
const governance = require("../../../src/services/ai/governance");
const ledger = require("../../../src/services/ai/ledger");
const transcription = require("../../../src/services/ai/transcription");
const integrations = require("../../../src/shared/integrations/settings");
const quota = require("../../../src/shared/integrations/quota");
const usage = require("../../../src/shared/integrations/usage");
const fx = require("../../../src/services/fx/exchangerate-api");

const headers = (h) => new Headers(h);

describe("a vendor's reply", () => {
  test("retry-after in seconds or as a date, Groq's reset durations, Anthropic's reset time, Google's RetryInfo", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(http.retryAfterOf(headers({ "retry-after": "37" }), null, now)).toBe(37_000);
    expect(http.retryAfterOf(headers({ "retry-after": "Tue, 20 Oct 2026 10:01:00 GMT" }), null, now)).toBe(60_000);
    expect(http.retryAfterOf(headers({ "x-ratelimit-reset-requests": "1h2m3.5s" }), null, now)).toBe(3_723_500);
    expect(http.retryAfterOf(headers({ "anthropic-ratelimit-requests-reset": "2026-10-20T10:00:30Z" }), null, now)).toBe(30_000);
    expect(http.retryAfterOf(headers({}), { error: { details: [{ retryDelay: "12s" }] } }, now)).toBe(12_000);
    expect(http.retryAfterOf(headers({}), null, now)).toBeNull();
  });

  test("a refused key is config, a quota is rate_limited with its wait, an overload is transient", async () => {
    const answer = (status, body, h = {}) => async () => new Response(JSON.stringify(body), { status, headers: h });
    await expect(http.request("groq", "https://x.test", { fetchImpl: answer(401, { error: { message: "Invalid API Key" } }) })).rejects.toMatchObject({
      kind: "config",
      status: 401,
      message: "groq 401: Invalid API Key",
    });
    await expect(
      http.request("groq", "https://x.test", { fetchImpl: answer(429, { error: { message: "Rate limit reached on audio seconds per day" } }, { "retry-after": "3600" }) }),
    ).rejects.toMatchObject({ kind: "rate_limited", retryAfterMs: 3_600_000 });
    await expect(http.request("anthropic", "https://x.test", { fetchImpl: answer(529, { error: { type: "overloaded_error" } }) })).rejects.toMatchObject({
      kind: "transient",
    });
    const slow = (_url, { signal }) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    await expect(http.request("gemini", "https://x.test", { fetchImpl: slow, timeoutMs: 20 })).rejects.toMatchObject({ kind: "timeout" });
  });

  test("Groq bills a recording as at least ten seconds; the file goes as multipart", async () => {
    let sent;
    const fetchImpl = async (url, init) => {
      sent = { url, init };
      return Response.json({ text: " Hello team. ", duration: 4.2 });
    };
    const res = await groq.transcribe({ apiKey: "k", model: "whisper-large-v3", audio: Buffer.from("x"), filename: "v.webm", mime: "audio/webm", fetchImpl });
    expect(res).toEqual({ text: "Hello team.", duration_s: 4.2, billed_s: 10, model: "whisper-large-v3" });
    expect(sent.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(sent.init.body.get("model")).toBe("whisper-large-v3");
    expect(sent.init.body.get("file").name).toBe("v.webm");
  });

  test("Anthropic: every page of its list, Sonnet and Haiku only; Opus is refused before any call", async () => {
    const pages = [
      { data: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }], has_more: true, last_id: "b" },
      { data: [{ id: "claude-fable-5-1" }, { id: "claude-haiku-5-5", capabilities: { image_input: { supported: true } } }], has_more: false },
    ];
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push([url, init.headers["anthropic-version"]]);
      return Response.json(pages.shift());
    };
    const list = await anthropic.listModels({ apiKey: "k", fetchImpl });
    expect(list.map((m) => m.id)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(seen[1][0]).toContain("after_id=b");
    expect(seen.every(([, v]) => v === "2023-06-01")).toBe(true);
    await expect(anthropic.complete({ apiKey: "k", model: "claude-opus-5-5", messages: [] })).rejects.toMatchObject({ kind: "config" });
  });
});

describe("a model list, sorted", () => {
  test("Gemini: speech out, images, live sessions left off; embeddings by method", () => {
    const g = (id, methods = ["generateContent"]) => catalogue.capabilitiesOf("gemini", { id, methods });
    expect(g("gemini-3.8-flash")).toEqual(["text", "image", "audio"]);
    expect(g("gemini-3.8-flash-tts")).toBeNull();
    expect(g("gemini-2.5-flash-image")).toBeNull();
    expect(g("gemini-live-2.5-flash")).toBeNull();
    expect(g("gemini-embedding-001", ["embedContent"])).toEqual(["embeddings"]);
    expect(g("gemma-3-27b-it")).toEqual(["text"]);
    expect(catalogue.capabilitiesOf("openai", { id: "text-embedding-3-small" })).toEqual(["embeddings"]);
    expect(catalogue.capabilitiesOf("openai", { id: "dall-e-3" })).toBeNull();
    expect(catalogue.capabilitiesOf("groq", { id: "whisper-large-v3" })).toEqual(["audio"]);
  });

  test("fewer models: no -latest alias, no Gemma, no snapshot of a model listed; a chained one stays", () => {
    const list = (ids) => ids.map((model) => ({ model }));
    const ids = (r) => r.map((m) => m.model);
    const g = catalogue.trim(
      "gemini",
      list([
        "gemini-3.8-flash",
        "gemini-flash-latest",
        "gemma-3-27b-it",
        "gemini-2.5-flash",
        "gemini-2.5-flash-preview-09-2025",
        "gemini-2.0-flash",
        "gemini-2.0-flash-001",
        "gemini-2.0-flash-exp-1206",
        "gemini-embedding-001",
        "gemini-3.5-pro-preview",
        "gemini-3.5-pro-preview-05-06",
      ]),
      new Set(["gemini:gemini-2.0-flash-001"]),
    );
    expect(ids(g.kept)).toEqual(["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-embedding-001", "gemini-3.5-pro-preview"]);
    expect(ids(g.dropped)).toEqual(["gemini-flash-latest", "gemma-3-27b-it", "gemini-2.5-flash-preview-09-2025", "gemini-2.0-flash-exp-1206", "gemini-3.5-pro-preview-05-06"]);
    // A snapshot with no base on the list is the only name the model has, so it stays.
    expect(ids(catalogue.trim("openai", list(["gpt-4o-2024-08-06", "gpt-4o-mini", "chatgpt-4o-latest"])).kept)).toEqual(["gpt-4o-2024-08-06", "gpt-4o-mini"]);
    expect(ids(catalogue.trim("anthropic", list(["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"])).kept)).toEqual(["claude-sonnet-4-5"]);
  });
});

describe("Find Prices' search", () => {
  const gemini = require("../../../src/services/ai/vendors/gemini");
  test("thinking kept low: a level from Gemini 3, a budget on 2.x, nothing for another model", () => {
    expect(gemini.thinkingOf("gemini-3.1-pro-preview")).toEqual({ thinkingConfig: { thinkingLevel: "low" } });
    expect(gemini.thinkingOf("models/gemini-2.5-pro")).toEqual({ thinkingConfig: { thinkingBudget: 1024 } });
    expect(gemini.thinkingOf("learnlm-2.0-flash")).toEqual({});
  });
});

describe("each job's model until AI Control", () => {
  const m = (model, capabilities = ["text", "image", "audio"], available = true) => ({ model, display_name: model, capabilities, available });

  test("the newest stable family member the key can use; a withdrawn model is passed over", () => {
    const gemini = [m("gemini-2.5-flash"), m("gemini-3.8-flash", undefined, false), m("gemini-3.9-flash-preview"), m("gemini-3.5-flash")];
    expect(jobs.chainFrom("default", { gemini })[0].model).toBe("gemini-3.5-flash");
    expect(jobs.chainFrom("embeddings", { openai: [m("text-embedding-3-large", ["embeddings"]), m("text-embedding-3-small", ["embeddings"])] })[0].model).toBe(
      "text-embedding-3-small",
    );
  });

  test("Transcription is Groq's Whisper, then Gemini; Top Tier is Gemini's Pro, then Sonnet; an unset provider is left out", () => {
    const by = {
      gemini: [m("gemini-3.8-flash"), m("gemini-2.5-pro")],
      groq: [m("whisper-large-v3-turbo", ["audio"]), m("whisper-large-v3", ["audio"])],
      anthropic: [m("claude-sonnet-5-5", ["text", "image"])],
    };
    expect(jobs.chainFrom("transcription", by).map((c) => [c.provider, c.model, c.position])).toEqual([
      ["groq", "whisper-large-v3", 1],
      ["gemini", "gemini-3.8-flash", 2],
    ]);
    expect(jobs.chainFrom("top_tier", by).map((c) => c.model)).toEqual(["gemini-2.5-pro", "claude-sonnet-5-5"]);
    expect(jobs.chainFrom("transcription", { gemini: by.gemini }).map((c) => c.provider)).toEqual(["gemini"]);
  });
});

describe("exchange rates", () => {
  test("every rate kept as a decimal string; a spent month and a refused key are named", async () => {
    let auth;
    const ok = await fx.latest({
      apiKey: "k",
      fetchImpl: async (url, init) => {
        auth = [url, init.headers.Authorization];
        return Response.json({ result: "success", base_code: "USD", time_last_update_unix: 1760918401, conversion_rates: { USD: 1, NGN: 1534.21, bad: 2 } });
      },
    });
    expect(ok.rates).toEqual({ USD: "1.0000000000", NGN: "1534.2100000000" });
    expect(auth).toEqual(["https://v6.exchangerate-api.com/v6/latest/USD", "Bearer k"]);
    const reply = (body, status = 200) => async () => Response.json(body, { status });
    await expect(fx.latest({ apiKey: "k", fetchImpl: reply({ result: "error", "error-type": "quota-reached" }) })).rejects.toMatchObject({ code: "OVER_QUOTA" });
    await expect(fx.latest({ apiKey: "k", fetchImpl: reply({ result: "error", "error-type": "invalid-key" }, 403) })).rejects.toMatchObject({
      code: "KEY_REFUSED",
    });
  });
});

describe("voice note transcription: Groq, then Gemini, then the browser", () => {
  const DOC = { mime: "audio/webm;codecs=opus", scan_status: "clean", storage_key: "k/voice.webm" };
  const db = { query: async () => ({ rows: [DOC] }) };
  const audio = {
    forGroq: async () => ({ audio: Buffer.from("w"), mime: "audio/webm", filename: "voice-note.webm" }),
    mp3: async () => Buffer.from("m"),
  };
  const CHAIN = [
    { provider: "groq", model: "whisper-large-v3" },
    { provider: "gemini", model: "gemini-3.8-flash" },
  ];
  const quotaError = () => Object.assign(new Error("groq 429: Rate limit reached"), { kind: "rate_limited", status: 429, retryAfterMs: 3_600_000 });
  /** The chain jobs.resolve answers: every model Ready, as AI Control would show it. */
  const chainOf = (links) => ({
    scope: "job",
    key: "transcription",
    stored: false,
    links: links.map((l, i) => ({ ...l, display_name: l.model, position: i + 1, state: "ready", until: null })),
  });
  let steps;
  let recorded;

  beforeEach(async () => {
    steps = [];
    recorded = [];
    usage.__reset();
    await skips.clear("groq");
    await skips.clear("gemini");
    jest.spyOn(governance, "check").mockResolvedValue({ settings: { input_ngn_per_million: "450.00", output_ngn_per_million: "3750.00" } });
    jest.spyOn(ledger, "startRun").mockResolvedValue("run-1");
    jest.spyOn(ledger, "recordStep").mockImplementation(async (_db, _id, s) => {
      steps.push([s.vendor, s.outcome]);
      recorded.push(s);
      return "0.00";
    });
    jest.spyOn(jobs, "resolve").mockResolvedValue(chainOf(CHAIN));
    jest.spyOn(prices, "forStep").mockResolvedValue(prices.zero());
    jest.spyOn(ledger, "finishRun").mockResolvedValue(undefined);
    jest.spyOn(ledger, "refused").mockResolvedValue("run-refused");
    jest.spyOn(integrations, "secret").mockResolvedValue("key");
    jest.spyOn(quota, "spent").mockResolvedValue(false);
  });
  afterEach(() => jest.restoreAllMocks());

  const vendorsWith = (g, m) => ({ groq: { transcribe: g }, gemini: { transcribe: m }, stub: { transcribe: async () => ({ text: "[AI placeholder]", usage: {} }) } });
  const run = (vendors, { chain, ...over } = {}) => {
    if (chain) jobs.resolve.mockResolvedValue(chainOf(chain));
    return transcription.transcribe({ document_id: "d1", module: "community", actor: null, db, audio, vendors, ...over });
  };

  test("Groq answers: the original recording goes, its billed seconds count toward its daily limit", async () => {
    const g = jest.fn(async () => ({ text: "All on track for Friday.", billed_s: 10, model: "whisper-large-v3" }));
    const m = jest.fn();
    const t = await run(vendorsWith(g, m));
    expect(t).toMatchObject({ text: "All on track for Friday.", draft: false, vendor: "groq", model: "whisper-large-v3" });
    expect(g.mock.calls[0][0]).toMatchObject({ mime: "audio/webm", filename: "voice-note.webm", timeoutMs: 30_000 });
    expect(m).not.toHaveBeenCalled();
    expect(usage.pending()).toEqual([expect.objectContaining({ code: "groq", kind: "transcribe", calls: 1, units: 10 })]);
    // The billed seconds are kept on the step, Free plan or not (ai-control.md decision 19).
    expect(recorded[0]).toMatchObject({ vendor: "groq", usage: { audio_seconds: 10 } });
    expect(jobs.resolve).toHaveBeenCalledWith("voice-note-transcription", expect.anything());
  });

  test("Groq's quota spent: Gemini answers from MP3, and Groq is skipped until its reset", async () => {
    const g = jest.fn(async () => {
      throw quotaError();
    });
    const m = jest.fn(async () => ({ text: "Na so e be.", usage: { input_tokens: 90, output_tokens: 5 }, model: "gemini-3.8-flash" }));
    const first = await run(vendorsWith(g, m));
    expect(first).toMatchObject({ text: "Na so e be.", vendor: "gemini", draft: false });
    expect(m.mock.calls[0][0]).toMatchObject({ mime: "audio/mp3", audio: Buffer.from("m") });
    expect(steps).toEqual([["groq", "failed"], ["gemini", "ok"]]);
    const until = await skips.until("groq");
    expect(until.getTime() - Date.now()).toBeGreaterThan(3_500_000);
    await run(vendorsWith(g, m));
    expect(g).toHaveBeenCalledTimes(1);
    expect(m).toHaveBeenCalledTimes(2);
  });

  test("a failure or a timeout moves on for this call only; Groq is asked again next time", async () => {
    const g = jest.fn(async () => {
      throw Object.assign(new Error("groq: no answer within 30000 ms"), { kind: "timeout" });
    });
    const m = jest.fn(async () => ({ text: "ok", usage: {} }));
    await run(vendorsWith(g, m));
    expect(await skips.until("groq")).toBeNull();
    await run(vendorsWith(g, m));
    expect(g).toHaveBeenCalledTimes(2);
  });

  test("a Free plan at its daily limit is passed over without a request", async () => {
    quota.spent.mockImplementation(async (code) => code === "groq");
    const g = jest.fn();
    const m = jest.fn(async () => ({ text: "ok", usage: {} }));
    await expect(run(vendorsWith(g, m))).resolves.toMatchObject({ vendor: "gemini" });
    expect(g).not.toHaveBeenCalled();
  });

  test("neither answers: the browser's captions come back as a draft; without them, AI_UNAVAILABLE", async () => {
    const fail = jest.fn(async () => {
      throw Object.assign(new Error("5xx"), { kind: "transient", status: 503 });
    });
    await expect(run(vendorsWith(fail, fail), { captions: "  all on track  " })).resolves.toEqual({
      text: "all on track",
      draft: true,
      provisional: true,
      run_id: "run-1",
      vendor: "browser",
      model: "browser",
    });
    await expect(run(vendorsWith(fail, fail))).rejects.toMatchObject({ code: "AI_UNAVAILABLE", status: 503 });
    expect(ledger.finishRun).toHaveBeenLastCalledWith(db, "run-1", expect.objectContaining({ status: "failed", error_code: "AI_UNAVAILABLE" }));
  });

  test("nothing set up: the captions as a draft, else the stub's placeholder, also a draft", async () => {
    const none = vendorsWith(jest.fn(), jest.fn());
    await expect(run(none, { chain: [], captions: "hello" })).resolves.toMatchObject({ text: "hello", draft: true, vendor: "browser" });
    await expect(run(none, { chain: [] })).resolves.toMatchObject({ text: "[AI placeholder]", draft: true, vendor: "stub" });
  });

  test("AI switched off: the refusal is recorded, and the captions still come back", async () => {
    const { AppError } = require("../../../src/shared/errors");
    governance.check.mockRejectedValue(new AppError("AI_DISABLED", "AI features are switched off.", 503));
    await expect(run(vendorsWith(jest.fn(), jest.fn()), { captions: "hello" })).resolves.toMatchObject({ draft: true, run_id: "run-refused" });
    await expect(run(vendorsWith(jest.fn(), jest.fn()))).rejects.toMatchObject({ code: "AI_DISABLED" });
  });

  test("not audio, or not scanned yet, is refused before any provider", async () => {
    const asDoc = (doc) => ({ query: async () => ({ rows: [doc] }) });
    await expect(run(vendorsWith(jest.fn(), jest.fn()), { db: asDoc({ ...DOC, mime: "image/png" }) })).rejects.toMatchObject({ code: "NOT_AUDIO" });
    await expect(run(vendorsWith(jest.fn(), jest.fn()), { db: asDoc({ ...DOC, scan_status: "pending" }) })).rejects.toMatchObject({ code: "NOT_READY" });
  });
});
