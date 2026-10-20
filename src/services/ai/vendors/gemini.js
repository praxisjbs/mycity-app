"use strict";
/**
 * Gemini, through Google's OpenAI-compatible endpoint
 * (generativelanguage.googleapis.com/v1beta/openai). The only file in src/ that talks to
 * a model vendor; scripts/check/ai-vendor-imports.js fails the build on any other.
 * Called by services/ai/llm.service.js only, never by a module.
 *
 * Plain HTTPS with fetch, no vendor SDK: the request is one JSON POST and the SDK
 * would be a dependency that can call out on its own.
 *
 * Request shaping:
 *  - Thinking. Gemini 2.5 models think by default and the thinking counts against the
 *    output ceiling, so a long JSON answer can come back cut off or empty. Flash and
 *    Flash-Lite accept `reasoning_effort: "none"`; Pro and later models refuse "none",
 *    so they get "low".
 *  - Tool schemas (the M10 assistant's reads) take an OpenAPI subset: keywords outside
 *    it (`exclusiveMinimum`, most string formats, `additionalProperties`) fail the whole
 *    request, so they are dropped from what the model is shown. The real Zod schema
 *    still checks the arguments before any read runs.
 *  - `finish_reason: "length"` means the answer was cut off at the ceiling; it is
 *    returned so the ledger records it.
 *
 * Errors carry a `kind` (vendors/http.js): "config" (400, 401, 403, 404: the key or model is
 * wrong, retrying cannot help), "rate_limited" (429, with how long Google asked us to wait),
 * "timeout", or "transient" (5xx, network).
 *
 * The model list and transcription use Google's own API beside the compatible one: its list says
 * what each model does and its display name, and it takes audio inline as MP3.
 */
const { VendorError, classify, request, retryAfterOf } = require("./http");

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const NATIVE_URL = "https://generativelanguage.googleapis.com/v1beta";

function reasoningEffort(model) {
  return /^(models\/)?gemini-2\.5-flash/i.test(String(model || ""))
    ? "none"
    : "low";
}

const STRING_FORMATS = new Set(["date-time", "enum"]);
const NUMBER_FORMATS = new Set(["float", "double", "int32", "int64"]);

/** A JSON Schema reduced to the subset Gemini accepts for function parameters. */
function toolSchema(node) {
  if (Array.isArray(node)) return node.map(toolSchema);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([p, s]) => [p, toolSchema(s)]),
      );
    } else if (k === "exclusiveMinimum" || k === "exclusiveMaximum") {
      const inc = k === "exclusiveMinimum" ? "minimum" : "maximum";
      if (typeof v === "number" && node[inc] === undefined) out[inc] = v;
    } else if (k === "format") {
      if ((node.type === "string" ? STRING_FORMATS : NUMBER_FORMATS).has(v))
        out.format = v;
    } else if (k !== "$schema" && k !== "additionalProperties") {
      out[k] = toolSchema(v);
    }
  }
  return out;
}

/**
 * One chat completion.
 * @param {object} req
 * @param {string} req.apiKey
 * @param {string} req.model
 * @param {Array<{role: string, content: string}>} req.messages
 * @param {boolean} [req.json]       ask for one JSON object
 * @param {Array<object>} [req.tools]  OpenAI-style function tools
 * @param {number} [req.temperature]
 * @param {number} [req.maxTokens]
 * @param {number} [req.timeoutMs]
 * @param {typeof fetch} [req.fetchImpl]  tests
 * @returns {Promise<{text: string, toolCalls: Array, usage: {input_tokens: number, output_tokens: number}, model: string, finish_reason: string|null}>}
 */
async function complete({
  apiKey,
  model,
  messages,
  json = false,
  tools = null,
  temperature = 0.2,
  maxTokens,
  timeoutMs = 60_000,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new VendorError("gemini: no API key", "config");
  const body = {
    model,
    messages,
    temperature,
    reasoning_effort: reasoningEffort(model),
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (json) body.response_format = { type: "json_object" };
  if (tools && tools.length) {
    body.tools = tools.map((t) =>
      t.function && t.function.parameters
        ? {
            ...t,
            function: {
              ...t.function,
              parameters: toolSchema(t.function.parameters),
            },
          }
        : t,
    );
    body.tool_choice = "auto";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError")
      throw new VendorError(
        `gemini: no answer within ${timeoutMs} ms`,
        "timeout",
      );
    throw new VendorError(`gemini: ${err && err.message}`, "transient");
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail =
      (data && data.error && (data.error.message || data.error.status)) ||
      raw.slice(0, 300);
    throw new VendorError(
      `gemini ${res.status}: ${detail}`,
      classify(res.status),
      res.status,
      { retryAfterMs: res.status === 429 ? retryAfterOf(res.headers, data) : null },
    );
  }
  if (!data)
    throw new VendorError(
      "gemini: the reply is not JSON",
      "transient",
      res.status,
    );

  const choice = (data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  const usage = data.usage || {};
  return {
    text: typeof msg.content === "string" ? msg.content : "",
    toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    usage: {
      input_tokens: Number(usage.prompt_tokens) || 0,
      output_tokens: Number(usage.completion_tokens) || 0,
    },
    model: data.model || model,
    finish_reason: choice.finish_reason || null,
  };
}

/**
 * The models a key may use (GET /models). It costs nothing, so Settings · Integrations checks
 * a key with it (docs/guides/integrations.md §6.3). Errors as complete(): a VendorError with
 * the status (Google answers 400 to a key that is not valid).
 * @param {{apiKey: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<string[]>} the model names, without "models/"
 */
async function listModels({ apiKey, timeoutMs = 20_000, fetchImpl = fetch }) {
  if (!apiKey) throw new VendorError("gemini: no API key", "config");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError")
      throw new VendorError(`gemini: no answer within ${timeoutMs} ms`, "timeout");
    throw new VendorError(`gemini: ${err && err.message}`, "transient");
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = (data && data.error && (data.error.message || data.error.status)) || raw.slice(0, 300);
    throw new VendorError(`gemini ${res.status}: ${detail}`, classify(res.status), res.status);
  }
  const list = (data && Array.isArray(data.data) && data.data) || [];
  return list.map((m) => String((m && m.id) || "").replace(/^models\//, "")).filter(Boolean);
}

/**
 * The models the key may use, from Google's own list (free): each one's id without "models/",
 * its display name, and the methods it answers (generateContent, embedContent).
 * @param {{apiKey: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<Array<{id: string, display_name: string, methods: string[]}>>}
 */
async function listModelsDetailed({ apiKey, timeoutMs = 20_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("gemini: no API key", "config");
  const out = [];
  let token = null;
  for (let page = 0; page < 10; page += 1) {
    const url = `${NATIVE_URL}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
    const { data } = await request("gemini", url, { headers: { "x-goog-api-key": apiKey }, timeoutMs, fetchImpl });
    for (const m of Array.isArray(data.models) ? data.models : []) {
      const id = String((m && m.name) || "").replace(/^models\//, "");
      if (!id) continue;
      out.push({
        id,
        display_name: String(m.displayName || id),
        methods: Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods.map(String) : [],
      });
    }
    if (!data.nextPageToken) break;
    token = data.nextPageToken;
  }
  return out;
}

/**
 * One recording to text, sent inline (a voice note is well under Google's 20 MB inline limit).
 * @param {{apiKey: string, model: string, audio: Buffer, mime: string, prompt: string,
 *          maxTokens?: number, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<{text: string, usage: {input_tokens: number, output_tokens: number}, model: string, finish_reason: string|null}>}
 */
async function transcribe({ apiKey, model, audio, mime, prompt, maxTokens = 8192, timeoutMs = 30_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("gemini: no API key", "config");
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: audio.toString("base64") } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
  };
  const id = String(model).replace(/^models\//, "");
  const { data } = await request("gemini", `${NATIVE_URL}/models/${encodeURIComponent(id)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
    fetchImpl,
  });
  const candidate = (Array.isArray(data.candidates) && data.candidates[0]) || {};
  const parts = (candidate.content && Array.isArray(candidate.content.parts) && candidate.content.parts) || [];
  const meta = data.usageMetadata || {};
  return {
    text: parts
      .filter((p) => p && typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim(),
    usage: {
      input_tokens: Number(meta.promptTokenCount) || 0,
      output_tokens: (Number(meta.candidatesTokenCount) || 0) + (Number(meta.thoughtsTokenCount) || 0),
    },
    model: data.modelVersion || id,
    finish_reason: candidate.finishReason || null,
  };
}

module.exports = {
  name: "gemini",
  BASE_URL,
  NATIVE_URL,
  VendorError,
  complete,
  listModels,
  listModelsDetailed,
  transcribe,
  toolSchema,
  reasoningEffort,
  classify,
};
