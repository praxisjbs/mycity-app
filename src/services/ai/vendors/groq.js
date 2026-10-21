"use strict";
/**
 * Groq (groq.com): speech to text with Whisper, first in the transcription chain
 * (docs/guides/integrations.md §1.2 decision 6). OpenAI-compatible endpoints under
 * api.groq.com/openai/v1, plain HTTPS, no SDK. Called from services/ai/ only.
 *
 * The free plan is counted per organisation, in requests and in seconds of audio a day, each
 * request billed as at least ten seconds. A 429 carries `retry-after`, which the transcription
 * chain uses to skip Groq until its quota resets (decision 7).
 */
const { VendorError, request } = require("./http");

const BASE_URL = "https://api.groq.com/openai/v1";
/** Groq bills a request as at least this many seconds of audio. */
const MIN_BILLED_SECONDS = 10;

const auth = (apiKey) => ({ Authorization: `Bearer ${apiKey}` });

/**
 * The models the key may use (free): ids with whether Groq marks them active.
 * @param {{apiKey: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<Array<{id: string, display_name: string}>>}
 */
async function listModels({ apiKey, timeoutMs = 20_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("groq: no API key", "config");
  const { data } = await request("groq", `${BASE_URL}/models`, { headers: auth(apiKey), timeoutMs, fetchImpl });
  const list = Array.isArray(data.data) ? data.data : [];
  return list
    .filter((m) => m && m.id && m.active !== false)
    .map((m) => ({ id: String(m.id), display_name: String(m.id) }));
}

/**
 * One recording to text.
 * @param {{apiKey: string, model: string, audio: Buffer, filename: string, mime: string,
 *          language?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<{text: string, duration_s: number|null, billed_s: number, model: string}>}
 */
async function transcribe({ apiKey, model, audio, filename, mime, language, timeoutMs = 30_000, fetchImpl }) {
  if (!apiKey) throw new VendorError("groq: no API key", "config");
  const form = new FormData();
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (language) form.append("language", language);
  form.append("file", new Blob([audio], { type: mime }), filename);
  const { data } = await request("groq", `${BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: auth(apiKey),
    body: form,
    timeoutMs,
    fetchImpl,
  });
  const duration = Number(data.duration);
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : null;
  return {
    text: String(data.text || "").trim(),
    duration_s: seconds,
    billed_s: Math.max(MIN_BILLED_SECONDS, Math.ceil(seconds || 0)),
    model,
  };
}

module.exports = { name: "groq", BASE_URL, MIN_BILLED_SECONDS, listModels, transcribe };
