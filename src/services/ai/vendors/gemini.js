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
 * Errors carry a `kind`: "config" (401, 403, 404: the key or model is wrong, retrying
 * cannot help), "rate_limited" (429), "timeout", or "transient" (5xx, network).
 */
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

class VendorError extends Error {
  constructor(message, kind, status = null) {
    super(message);
    this.name = "VendorError";
    this.kind = kind;
    this.status = status;
  }
}

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

function classify(status) {
  if (status === 401 || status === 403 || status === 404) return "config";
  if (status === 429) return "rate_limited";
  return "transient";
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

/* ------------------------------------------------------------------ *
 * Audio to text
 * ------------------------------------------------------------------ */

/**
 * The compatible endpoint takes only wav and mp3 audio, so a recording goes to the native
 * generateContent API on the same host and version, inline. Temperature 0 and a JSON answer
 * keep the model to the words spoken: it is told never to tidy, summarise or translate
 * (tidying is a separate step the person sees beside the transcript).
 */
const NATIVE_URL = BASE_URL.replace(/\/openai$/, "");

const TRANSCRIBE_SYSTEM = [
  "You transcribe one short voice recording made at work: a voice note, or an answer dictated into a form.",
  "Write down the words spoken, verbatim, in the language they were spoken in. Never translate, summarise, correct grammar or add words.",
  "No speaker labels, timestamps or descriptions of sounds. If nothing intelligible is said, text is an empty string.",
  'Answer with JSON only: {"text": "..."}',
].join("\n");

/**
 * @param {{apiKey: string, model: string, audio: Buffer, mimeType: string, timeoutMs?: number,
 *          fetchImpl?: typeof fetch}} req  audio in a type Gemini takes (wav, mp3, aiff, aac, ogg, flac)
 * @returns {Promise<{text: string, usage: {input_tokens: number, output_tokens: number}, model: string}>}
 */
async function transcribe({ apiKey, model, audio, mimeType, timeoutMs = 90_000, fetchImpl = fetch }) {
  if (!apiKey) throw new VendorError("gemini: no API key", "config");
  if (!Buffer.isBuffer(audio) || !audio.length) throw new VendorError("gemini: no audio", "config");
  const name = String(model).replace(/^models\//, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${NATIVE_URL}/models/${encodeURIComponent(name)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: TRANSCRIBE_SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType, data: audio.toString("base64") } }, { text: "Transcribe this recording." }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] },
        },
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw new VendorError(`gemini: no answer within ${timeoutMs} ms`, "timeout");
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
  const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const answer = parts.map((p) => p.text || "").join("");
  let text;
  try {
    text = String(JSON.parse(answer).text || "");
  } catch {
    throw new VendorError("gemini: the transcript is not the JSON asked for", "transient", res.status);
  }
  const usage = (data && data.usageMetadata) || {};
  return {
    text: text.trim(),
    usage: { input_tokens: Number(usage.promptTokenCount) || 0, output_tokens: Number(usage.candidatesTokenCount) || 0 },
    model: data.modelVersion || name,
  };
}

module.exports = {
  name: "gemini",
  transcribe,
  BASE_URL,
  VendorError,
  complete,
  toolSchema,
  reasoningEffort,
  classify,
};
