"use strict";
/**
 * Exchange Rates' provider, exchangerate-api.com (docs/guides/integrations.md §1.2 decision 10):
 * one request brings every currency against a base. The key is sent as a bearer token, never in
 * the address, so it cannot reach a log line. The free plan allows 1,500 requests a month and
 * moves its rates once a day.
 *
 *   const t = await fx.latest({ apiKey, base: "USD" });
 *   // → { base: "USD", rates: { NGN: "1534.2100000000", EUR: "0.9200000000", ... }, updated_at: Date }
 *
 * Errors are FxError with a Settings · Integrations step code: KEY_REFUSED (a key it does not
 * know, an account switched off), OVER_QUOTA (the month's requests used), TIMEOUT, UNAVAILABLE.
 */
const BASE_URL = "https://v6.exchangerate-api.com/v6";

class FxError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.name = "FxError";
    this.code = code;
    this.status = status;
  }
}

const REFUSED = new Set(["invalid-key", "inactive-account", "unsupported-code", "malformed-request"]);

/** A rate as the provider sent it, as a decimal string Postgres keeps exactly (numeric(24,10)). */
function rateText(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(10);
}

/**
 * The newest rates against `base`.
 * @param {{apiKey: string, base?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} req
 * @returns {Promise<{base: string, rates: Record<string, string>, updated_at: Date|null}>}
 */
async function latest({ apiKey, base = "USD", timeoutMs = 10_000, fetchImpl = fetch }) {
  if (!apiKey) throw new FxError("exchange rates: no API key", "KEY_REFUSED");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${BASE_URL}/latest/${encodeURIComponent(base)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw new FxError(`exchange rates: no answer within ${timeoutMs} ms`, "TIMEOUT");
    throw new FxError(`exchange rates: ${err && err.message}`, "UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const type = data && data["error-type"];
  if (type === "quota-reached") throw new FxError("exchange rates: the plan's requests are used", "OVER_QUOTA", res.status);
  if (REFUSED.has(type) || res.status === 401 || res.status === 403)
    throw new FxError(`exchange rates: ${type || res.status}`, "KEY_REFUSED", res.status);
  if (!res.ok || !data || data.result !== "success" || !data.conversion_rates)
    throw new FxError(`exchange rates ${res.status}: ${type || "no rates in the reply"}`, "UNAVAILABLE", res.status);
  const rates = {};
  for (const [code, n] of Object.entries(data.conversion_rates)) {
    const r = rateText(n);
    if (r && /^[A-Z]{3}$/.test(code)) rates[code] = r;
  }
  const unix = Number(data.time_last_update_unix);
  return { base: String(data.base_code || base), rates, updated_at: Number.isFinite(unix) && unix > 0 ? new Date(unix * 1000) : null };
}

module.exports = { latest, FxError, BASE_URL, rateText };
