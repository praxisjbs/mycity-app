"use strict";
/**
 * One HTTPS request to a model vendor, the same way for each of them: a time limit, the reply
 * read as JSON, and every failure as a VendorError with a `kind` and, when the vendor says when
 * to come back, `retryAfterMs`. Used by the files beside it only (scripts/check/ai-vendor-imports.js).
 *
 *   kind "config"        400, 401, 403, 404: the key or the model is wrong; retrying cannot help
 *   kind "rate_limited"  429: a rate limit or the plan's quota; `retryAfterMs` says for how long
 *   kind "timeout"       no answer within the limit
 *   kind "transient"     5xx, 529 (overloaded), a network error, a reply that is not JSON
 *
 * A key never reaches a message: messages carry the vendor's name, the status and the vendor's
 * own error text, clipped.
 */

class VendorError extends Error {
  constructor(message, kind, status = null, { retryAfterMs = null } = {}) {
    super(message);
    this.name = "VendorError";
    this.kind = kind;
    this.status = status;
    /** How long the vendor asked us to wait, when it said; null otherwise. */
    this.retryAfterMs = retryAfterMs;
  }
}

function classify(status) {
  if (status === 400 || status === 401 || status === 403 || status === 404) return "config";
  if (status === 429) return "rate_limited";
  return "transient";
}

/** "1h2m3.5s", "2m59.56s", "7.66s" or "120ms" (Groq's reset headers) in milliseconds, or null. */
function durationMs(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let any = false;
  let m;
  while ((m = re.exec(s))) {
    any = true;
    const n = Number(m[1]);
    total += m[2] === "h" ? n * 3_600_000 : m[2] === "m" ? n * 60_000 : m[2] === "s" ? n * 1000 : n;
  }
  return any ? Math.round(total) : null;
}

/**
 * How long to wait, from what the vendor sent: `retry-after` (seconds or a date), the reset
 * headers Groq and Anthropic send, or Google's RetryInfo in the body. Null when none says.
 * @param {Headers|Map<string,string>|null} headers
 * @param {object|null} body
 * @param {Date} [now]
 */
function retryAfterOf(headers, body, now = new Date()) {
  const h = (name) => (headers && typeof headers.get === "function" ? headers.get(name) : null);
  const ra = h("retry-after");
  if (ra) {
    if (/^\d+(\.\d+)?$/.test(ra.trim())) return Math.round(Number(ra) * 1000);
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.max(0, at - now.getTime());
  }
  for (const name of ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens", "x-ratelimit-reset-audio-seconds"]) {
    const ms = durationMs(h(name));
    if (ms !== null) return ms;
  }
  for (const name of ["anthropic-ratelimit-requests-reset", "anthropic-ratelimit-tokens-reset"]) {
    const at = Date.parse(h(name) || "");
    if (Number.isFinite(at)) return Math.max(0, at - now.getTime());
  }
  const details = body && body.error && Array.isArray(body.error.details) ? body.error.details : [];
  for (const d of details) {
    const ms = d && typeof d.retryDelay === "string" ? durationMs(d.retryDelay) : null;
    if (ms !== null) return ms;
  }
  return null;
}

/** The vendor's own words about an error, clipped. */
function detailOf(data, raw) {
  const e = data && data.error;
  const words = (e && (typeof e === "string" ? e : e.message || e.status || e.type)) || (data && data.message) || raw;
  return String(words || "").replace(/\s+/g, " ").slice(0, 300);
}

/**
 * @param {string} vendor   for messages ("groq")
 * @param {string} url
 * @param {{method?: string, headers?: object, body?: string|FormData, timeoutMs?: number, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<{status: number, data: any, headers: Headers}>} the reply, parsed; throws VendorError when not ok
 */
async function request(vendor, url, { method = "GET", headers = {}, body, timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { method, headers, body, signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === "AbortError") throw new VendorError(`${vendor}: no answer within ${timeoutMs} ms`, "timeout");
    throw new VendorError(`${vendor}: ${err && err.message}`, "transient");
  } finally {
    clearTimeout(timer);
  }
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new VendorError(`${vendor} ${res.status}: ${detailOf(data, raw)}`, classify(res.status), res.status, {
      retryAfterMs: res.status === 429 ? retryAfterOf(res.headers, data) : null,
    });
  }
  if (data === null) throw new VendorError(`${vendor}: the reply is not JSON`, "transient", res.status);
  return { status: res.status, data, headers: res.headers };
}

/**
 * A tool call as every vendor file returns it: OpenAI's shape, the one the conversation is kept
 * in whichever provider answers (docs/guides/praxis-ai.md §6.7). `arguments` is a JSON string.
 * @param {object} call  as the vendor sent it
 * @param {number} i     its place in the reply, for a call that came without an id
 * @returns {{id: string, type: "function", function: {name: string, arguments: string}}|null}
 */
function toolCallOf(call, i) {
  const fn = call && call.function;
  if (!fn || typeof fn.name !== "string" || !fn.name) return null;
  const args = fn.arguments;
  return {
    // Anything else the vendor attached stays: Gemini's thought signatures ride in `extra_content`
    // and must go back with the call on the next round (chatMessages).
    ...call,
    id: typeof call.id === "string" && call.id ? call.id : `call_${i + 1}`,
    type: "function",
    function: {
      name: fn.name,
      arguments: typeof args === "string" ? args : JSON.stringify(args || {}),
    },
  };
}

/**
 * The conversation as an OpenAI-compatible vendor takes it: each tool call cut to `id`, `type` and
 * `function`, plus the fields named in `keep` (Gemini keeps `extra_content`). A conversation a
 * Gemini model began can then be handed to another provider, whose API refuses fields it does
 * not know.
 * @param {Array<object>} messages
 * @param {string[]} [keep]
 */
function chatMessages(messages, keep = []) {
  return (messages || []).map((m) => {
    if (!Array.isArray(m.tool_calls)) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((c) => {
        const out = { id: c.id, type: "function", function: { name: c.function.name, arguments: c.function.arguments } };
        for (const k of keep) if (c[k] !== undefined) out[k] = c[k];
        return out;
      }),
    };
  });
}

/**
 * The answer of an OpenAI-compatible chat completion (DeepSeek, Groq, OpenAI), as every vendor
 * file returns it.
 * @param {object} data   the reply
 * @param {string} model  the model asked, when the reply does not name one
 * @returns {{text: string, toolCalls: Array, usage: {input_tokens: number, output_tokens: number}, model: string, finish_reason: string|null}}
 */
function chatResult(data, model) {
  const choice = (data && Array.isArray(data.choices) && data.choices[0]) || {};
  const msg = choice.message || {};
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  return {
    text: typeof msg.content === "string" ? msg.content : "",
    toolCalls: calls.map(toolCallOf).filter(Boolean),
    usage: {
      input_tokens: Number(data && data.usage && data.usage.prompt_tokens) || 0,
      output_tokens: Number(data && data.usage && data.usage.completion_tokens) || 0,
    },
    model: (data && data.model) || model,
    finish_reason: choice.finish_reason || null,
  };
}

module.exports = { VendorError, classify, request, retryAfterOf, durationMs, detailOf, toolCallOf, chatMessages, chatResult };
