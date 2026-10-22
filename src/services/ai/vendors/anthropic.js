"use strict";
/**
 * Anthropic: top-tier drafting, Sonnet and Haiku only (docs/guides/integrations.md §1.2
 * decision 3). Plain HTTPS to api.anthropic.com/v1 with the key in `x-api-key`, no SDK: the
 * build refuses vendor SDKs (scripts/check/ai-vendor-imports.js). Called from services/ai/ only.
 *
 * Request shaping: Sonnet 5.5 and Haiku 5.5 refuse a temperature other than the default, so none
 * is sent; thinking is left to the model's default. The conversation arrives in OpenAI's shape,
 * as every vendor file takes it, and is turned into Anthropic's content blocks here; the answer
 * goes back the same way, its stop reason in OpenAI's words (docs/guides/ai-control.md decision 34). Errors: 400, 401, 403, 404 are "config"; 429
 * is "rate_limited" with `retry-after`; 529 (overloaded) and 5xx are "transient".
 */
const { VendorError, request } = require("./http");

const BASE_URL = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

/** The models this ERP may use: Sonnet and Haiku, never Opus or Fable (decision 3). */
const ALLOWED = /^claude-(sonnet|haiku)-/i;

const headers = (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": VERSION });

/**
 * The models the key may use (free), Sonnet and Haiku only, every page read.
 * @param {{apiKey: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<Array<{id: string, display_name: string, image: boolean}>>}
 */
async function listModels({ apiKey, timeoutMs = 20_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("anthropic: no API key", "config");
  const out = [];
  let after = null;
  for (let page = 0; page < 10; page += 1) {
    const url = `${BASE_URL}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
    const { data } = await request("anthropic", url, { headers: headers(apiKey), timeoutMs, fetchImpl });
    for (const m of Array.isArray(data.data) ? data.data : []) {
      if (!m || !m.id || !ALLOWED.test(m.id)) continue;
      const caps = m.capabilities || {};
      out.push({
        id: String(m.id),
        display_name: String(m.display_name || m.id),
        image: !caps.image_input || caps.image_input.supported !== false,
      });
    }
    if (!data.has_more || !data.last_id) break;
    after = data.last_id;
  }
  return out;
}

/** Anthropic's stop reasons in the words every vendor file uses (OpenAI's). */
const FINISH = Object.freeze({ end_turn: "stop", stop_sequence: "stop", max_tokens: "length", tool_use: "tool_calls" });

/** A tool call's id as Anthropic takes it: letters, digits, `_` and `-` only. */
const safeId = (id, i) => String(id || "").replace(/[^a-zA-Z0-9_-]/g, "_") || `call_${i + 1}`;

/** A tool call's arguments as an object; a reply that is not JSON is sent as no arguments. */
function inputOf(args) {
  if (args && typeof args === "object") return args;
  try {
    const v = JSON.parse(String(args || "{}"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * The conversation, kept in OpenAI's shape, as Anthropic's Messages API takes it: an assistant's
 * tool calls become `tool_use` blocks, each tool's result a `tool_result` block in the user turn
 * that follows, and turns of the same role are joined, since the API wants them to alternate.
 * @param {Array<{role: string, content?: string|null, tool_calls?: Array, tool_call_id?: string}>} messages  no system turn
 */
function toAnthropic(messages) {
  const out = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages || []) {
    if (m.role === "tool") {
      push("user", [{ type: "tool_result", tool_use_id: safeId(m.tool_call_id, 0), content: String(m.content ?? "") }]);
    } else if (m.role === "assistant") {
      const blocks = [];
      if (typeof m.content === "string" && m.content.trim()) blocks.push({ type: "text", text: m.content });
      (m.tool_calls || []).forEach((c, i) =>
        blocks.push({ type: "tool_use", id: safeId(c.id, i), name: c.function.name, input: inputOf(c.function.arguments) }),
      );
      push("assistant", blocks);
    } else {
      const text = typeof m.content === "string" ? m.content : "";
      if (text) push("user", [{ type: "text", text }]);
    }
  }
  return out;
}

/**
 * One answer, with tools when they are given.
 * @param {{apiKey: string, model: string, system?: string, messages: Array<object>, tools?: Array<object>|null,
 *          maxTokens?: number, effort?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 *   messages  in OpenAI's shape (vendors/http.js toolCallOf), without the system turn
 *   tools     OpenAI-style function tools, sent as Anthropic's `name`, `description`, `input_schema`
 * @returns {Promise<{text: string, toolCalls: Array, usage: {input_tokens: number, output_tokens: number}, model: string, finish_reason: string|null}>}
 */
async function complete({ apiKey, model, system, messages, tools = null, maxTokens = 1024, effort, timeoutMs = 60_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("anthropic: no API key", "config");
  if (!ALLOWED.test(String(model || ""))) throw new VendorError(`anthropic: ${model} is not a Sonnet or Haiku model`, "config");
  const body = { model, max_tokens: maxTokens, messages: toAnthropic(messages) };
  if (system) body.system = system;
  if (effort) body.output_config = { effort };
  if (tools && tools.length) {
    body.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description || "",
      input_schema: t.function.parameters || { type: "object", properties: {} },
    }));
  }
  const { data } = await request("anthropic", `${BASE_URL}/messages`, {
    method: "POST",
    headers: { ...headers(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
    fetchImpl,
  });
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
  const toolCalls = blocks
    .filter((b) => b && b.type === "tool_use" && b.name)
    .map((b, i) => ({ id: safeId(b.id, i), type: "function", function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
  return {
    text,
    toolCalls,
    usage: {
      input_tokens: Number(data.usage && data.usage.input_tokens) || 0,
      output_tokens: Number(data.usage && data.usage.output_tokens) || 0,
    },
    model: data.model || model,
    finish_reason: data.stop_reason ? FINISH[data.stop_reason] || data.stop_reason : null,
  };
}

module.exports = { name: "anthropic", BASE_URL, VERSION, ALLOWED, listModels, complete };
