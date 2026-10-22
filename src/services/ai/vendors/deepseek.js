"use strict";
/**
 * DeepSeek: OpenAI-compatible endpoints at api.deepseek.com, plain HTTPS, no SDK. Its API is run
 * from China, so only work that carries no personal data may be sent to it
 * (docs/guides/ai-control.md decision 23). Called from services/ai/ only.
 */
const { VendorError, request, chatMessages, chatResult } = require("./http");

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
 * One chat completion, with tools when they are given (DeepSeek's API takes OpenAI's).
 * @param {{apiKey: string, model: string, messages: Array<object>, tools?: Array<object>|null,
 *          maxTokens?: number, temperature?: number, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<{text: string, toolCalls: Array, usage: {input_tokens: number, output_tokens: number}, model: string, finish_reason: string|null}>}
 */
async function complete({ apiKey, model, messages, tools = null, maxTokens, temperature = 0.2, timeoutMs = 60_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("deepseek: no API key", "config");
  const body = { model, messages: chatMessages(messages), temperature };
  if (maxTokens) body.max_tokens = maxTokens;
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const { data } = await request("deepseek", `${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { ...auth(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
    fetchImpl,
  });
  return chatResult(data, model);
}

module.exports = { name: "deepseek", BASE_URL, listModels, complete };
