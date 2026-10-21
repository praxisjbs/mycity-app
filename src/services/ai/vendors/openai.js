"use strict";
/**
 * OpenAI: embeddings for search (docs/guides/ai-control.md decision 18). Plain HTTPS to
 * api.openai.com/v1, no SDK. Called from services/ai/ only.
 */
const { VendorError, request } = require("./http");

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

module.exports = { name: "openai", BASE_URL, listModels, embed };
