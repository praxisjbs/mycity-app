"use strict";
/**
 * Anthropic: top-tier drafting, Sonnet and Haiku only (docs/guides/integrations.md §1.2
 * decision 3). Plain HTTPS to api.anthropic.com/v1 with the key in `x-api-key`, no SDK: the
 * build refuses vendor SDKs (scripts/check/ai-vendor-imports.js). Called from services/ai/ only.
 *
 * Request shaping: Sonnet 5.5 and Haiku 5.5 refuse a temperature other than the default, so none
 * is sent; thinking is left to the model's default. Errors: 400, 401, 403, 404 are "config"; 429
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

/**
 * One answer.
 * @param {{apiKey: string, model: string, system?: string, messages: Array<{role: string, content: string}>,
 *          maxTokens?: number, effort?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<{text: string, usage: {input_tokens: number, output_tokens: number}, model: string, finish_reason: string|null}>}
 */
async function complete({ apiKey, model, system, messages, maxTokens = 1024, effort, timeoutMs = 60_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("anthropic: no API key", "config");
  if (!ALLOWED.test(String(model || ""))) throw new VendorError(`anthropic: ${model} is not a Sonnet or Haiku model`, "config");
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (effort) body.output_config = { effort };
  const { data } = await request("anthropic", `${BASE_URL}/messages`, {
    method: "POST",
    headers: { ...headers(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
    fetchImpl,
  });
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    usage: {
      input_tokens: Number(data.usage && data.usage.input_tokens) || 0,
      output_tokens: Number(data.usage && data.usage.output_tokens) || 0,
    },
    model: data.model || model,
    finish_reason: data.stop_reason || null,
  };
}

module.exports = { name: "anthropic", BASE_URL, VERSION, ALLOWED, listModels, complete };
