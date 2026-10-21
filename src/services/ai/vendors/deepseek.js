"use strict";
/**
 * DeepSeek: OpenAI-compatible endpoints at api.deepseek.com, plain HTTPS, no SDK. Its API is run
 * from China, so only work that carries no personal data may be sent to it
 * (docs/guides/ai-control.md decision 23). Called from services/ai/ only.
 */
const { VendorError, request } = require("./http");

const BASE_URL = "https://api.deepseek.com";

const auth = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });

/**
 * The models the key may use (free).
 * @param {{apiKey: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<Array<{id: string, display_name: string}>>}
 */
async function listModels({ apiKey, timeoutMs = 20_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("deepseek: no API key", "config");
  const { data } = await request("deepseek", `${BASE_URL}/models`, { headers: auth(apiKey), timeoutMs, fetchImpl });
  const list = Array.isArray(data.data) ? data.data : [];
  return list.filter((m) => m && m.id).map((m) => ({ id: String(m.id), display_name: String(m.id) }));
}

/**
 * One chat completion.
 * @param {{apiKey: string, model: string, messages: Array<{role: string, content: string}>,
 *          maxTokens?: number, temperature?: number, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<{text: string, usage: {input_tokens: number, output_tokens: number}, model: string, finish_reason: string|null}>}
 */
async function complete({ apiKey, model, messages, maxTokens, temperature = 0.2, timeoutMs = 60_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("deepseek: no API key", "config");
  const body = { model, messages, temperature };
  if (maxTokens) body.max_tokens = maxTokens;
  const { data } = await request("deepseek", `${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { ...auth(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
    fetchImpl,
  });
  const choice = (Array.isArray(data.choices) && data.choices[0]) || {};
  const msg = choice.message || {};
  return {
    text: typeof msg.content === "string" ? msg.content : "",
    usage: {
      input_tokens: Number(data.usage && data.usage.prompt_tokens) || 0,
      output_tokens: Number(data.usage && data.usage.completion_tokens) || 0,
    },
    model: data.model || model,
    finish_reason: choice.finish_reason || null,
  };
}

module.exports = { name: "deepseek", BASE_URL, listModels, complete };
