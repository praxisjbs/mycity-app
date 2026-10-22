"use strict";
/**
 * OpenAI: embeddings for search (docs/guides/ai-control.md decision 18), and text answers, tools
 * included, from an OpenAI text model chosen on AI Control (decision 34). Plain HTTPS to
 * api.openai.com/v1, no SDK. Called from services/ai/ only.
 */
const { VendorError, request, chatMessages, chatResult } = require("./http");

const BASE_URL = "https://api.openai.com/v1";

const auth = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });

/**
 * The models the key may use (free).
 * @param {{apiKey: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<Array<{id: string, display_name: string}>>}
 */
async function listModels({ apiKey, timeoutMs = 20_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("openai: no API key", "config");
  const { data } = await request("openai", `${BASE_URL}/models`, { headers: auth(apiKey), timeoutMs, fetchImpl });
  const list = Array.isArray(data.data) ? data.data : [];
  return list.filter((m) => m && m.id).map((m) => ({ id: String(m.id), display_name: String(m.id) }));
}

/**
 * Vectors for one or more texts.
 * @param {{apiKey: string, model: string, input: string|string[], dimensions?: number,
 *          timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<{vectors: number[][], usage: {input_tokens: number, output_tokens: number}, model: string}>}
 */
async function embed({ apiKey, model, input, dimensions, timeoutMs = 20_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("openai: no API key", "config");
  const body = { model, input };
  if (dimensions) body.dimensions = dimensions;
  const { data } = await request("openai", `${BASE_URL}/embeddings`, {
    method: "POST",
    headers: { ...auth(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
    fetchImpl,
  });
  const rows = Array.isArray(data.data) ? data.data : [];
  return {
    vectors: rows.map((r) => (Array.isArray(r.embedding) ? r.embedding : [])),
    usage: { input_tokens: Number(data.usage && data.usage.prompt_tokens) || 0, output_tokens: 0 },
    model: data.model || model,
  };
}

/** GPT-4 models take a temperature; the reasoning models (o-series, GPT-5) refuse one. */
const TAKES_TEMPERATURE = /^gpt-4/i;

/**
 * One chat completion on an OpenAI text model, with tools when they are given. A text model chosen
 * on AI Control answers through this (docs/guides/ai-control.md decision 34). The ceiling is sent
 * as `max_completion_tokens`, which every current chat model takes.
 * @param {{apiKey: string, model: string, messages: Array<object>, json?: boolean, tools?: Array<object>|null,
 *          maxTokens?: number, temperature?: number, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<{text: string, toolCalls: Array, usage: {input_tokens: number, output_tokens: number}, model: string, finish_reason: string|null}>}
 */
async function complete({ apiKey, model, messages, json = false, tools = null, maxTokens, temperature = 0.2, timeoutMs = 60_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("openai: no API key", "config");
  const body = { model, messages: chatMessages(messages) };
  if (TAKES_TEMPERATURE.test(String(model || ""))) body.temperature = temperature;
  if (maxTokens) body.max_completion_tokens = maxTokens;
  if (json) body.response_format = { type: "json_object" };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const { data } = await request("openai", `${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { ...auth(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
    fetchImpl,
  });
  return chatResult(data, model);
}

module.exports = { name: "openai", BASE_URL, listModels, embed, complete };
