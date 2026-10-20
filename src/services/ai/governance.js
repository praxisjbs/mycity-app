"use strict";
/**
 * Whether an AI call may happen, and what it costs (BACKEND_STRUCTURE §14.2).
 *
 *   const g = await governance.check(db, { module: "recruitment" });
 *   // → { settings, vendor: "gemini" | "stub", model, spent_ngn, cap_ngn }
 *   //   or throws AppError AI_DISABLED / AI_MODULE_DISABLED / AI_CAP_REACHED
 *
 * Every AI entry point (llm.service.complete, transcription) asks here first, so a
 * new feature cannot forget the switch or the cap.
 *
 * The settings (ai_setting, one row, edited on the M10 spend screen) hold:
 *   enabled                 the whole of AI on or off
 *   vendor, model           "gemini" or "stub"; the model name
 *   disabled_modules        per-module switch: module keys whose AI features are off
 *   monthly_cap_ngn         spend ceiling for the Lagos calendar month; NULL is no cap
 *   input/output_ngn_per_million  token prices, so the spend is in naira
 * With no row (or before migration 0095), the defaults come from the environment:
 * enabled, Gemini when it has a key, no cap, the AI_*_NGN_PER_MILLION prices.
 *
 * Which vendor answers: "gemini" with a key; the stub otherwise, never an error
 * (a missing key is a configuration the product supports: CI, laptops, staging). The key
 * is Settings · Integrations' (shared/integrations/settings.js: saved there, else
 * GEMINI_API_KEY in the server file; docs/guides/integrations.md §6.3).
 *
 * Spend is computed from the tokens each step recorded and the prices recorded with
 * it, summed for the month and rounded once at the end. Rounding each call to the
 * kobo first would floor ordinary calls to ₦0.00 and the cap would never be reached.
 * The check asks "is the month already at the cap", because the cost of the call about
 * to be made is not known until it is made: the overshoot is at most one call.
 */
const { config } = require("../../config/env");
const { AppError } = require("../../shared/errors");
const integrations = require("../../shared/integrations/settings");
const catalog = require("../../shared/access/access.catalog");
const money = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");

const VENDORS = new Set(["gemini", "stub"]);

/** Gemini's key in use, or null: AI then answers from the stub. */
const keyOf = (db) => integrations.secret("gemini", "api_key", { db });

function defaults(apiKey = null) {
  return {
    enabled: true,
    vendor: apiKey ? "gemini" : "stub",
    model: config.GEMINI_MODEL,
    disabled_modules: [],
    monthly_cap_ngn: null,
    input_ngn_per_million: config.AI_INPUT_NGN_PER_MILLION,
    output_ngn_per_million: config.AI_OUTPUT_NGN_PER_MILLION,
  };
}

const str2 = (v) =>
  v === null || v === undefined ? null : money.toWire(String(v));

/**
 * The effective settings: the ai_setting row over the environment defaults.
 * @param {{query: Function}} db
 */
async function settings(db) {
  const base = defaults(await keyOf(db));
  let row = null;
  try {
    const { rows } = await db.query(
      `SELECT enabled, vendor, model, disabled_modules, monthly_cap_ngn, input_ngn_per_million, output_ngn_per_million
         FROM ai_setting ORDER BY updated_at DESC LIMIT 1`,
    );
    row = rows[0] || null;
  } catch (err) {
    if (err.code !== "42P01") throw err;
  }
  if (!row) return base;
  return {
    enabled: row.enabled !== false,
    vendor: VENDORS.has(row.vendor) ? row.vendor : base.vendor,
    model: row.model || base.model,
    disabled_modules: Array.isArray(row.disabled_modules)
      ? row.disabled_modules
      : [],
    monthly_cap_ngn: str2(row.monthly_cap_ngn),
    input_ngn_per_million:
      str2(row.input_ngn_per_million) || base.input_ngn_per_million,
    output_ngn_per_million:
      str2(row.output_ngn_per_million) || base.output_ngn_per_million,
  };
}

/** The vendor that will answer: the setting, falling back to the stub without a key. */
function vendorFor(s, apiKey) {
  return s.vendor === "gemini" && apiKey ? "gemini" : "stub";
}

/**
 * Naira for one step, unrounded (a Decimal).
 * @param {{input_tokens: number, output_tokens: number}} usage
 * @param {{input_ngn_per_million: string, output_ngn_per_million: string}} prices
 */
function costOf(usage, prices) {
  const inTok = Number(usage.input_tokens) || 0;
  const outTok = Number(usage.output_tokens) || 0;
  return money
    .money(prices.input_ngn_per_million)
    .times(inTok)
    .plus(money.money(prices.output_ngn_per_million).times(outTok))
    .dividedBy(1_000_000);
}

/** The first instant of the Lagos month containing `now`, and of the next one. */
function monthWindow(now = new Date()) {
  const { first } = lagos.monthBounds(lagos.today(now));
  return {
    from: lagos.startOfDay(first),
    to: lagos.startOfDay(lagos.addMonths(first, 1)),
  };
}

/**
 * AI spend in naira for the Lagos month containing `now` ("1234.56").
 * @param {{query: Function}} db
 */
async function spentThisMonth(db, now = new Date()) {
  const { from, to } = monthWindow(now);
  try {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM((input_tokens::numeric * input_ngn_per_million + output_tokens::numeric * output_ngn_per_million) / 1000000), 0)::text AS spent
         FROM ai_run_step
        WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );
    return money.toWire(rows[0].spent);
  } catch (err) {
    if (err.code === "42P01") return "0.00";
    throw err;
  }
}

/**
 * May an AI call for `module` happen now? Throws a refusal the screen can show.
 * @param {{query: Function}} db
 * @param {{module: string, now?: Date}} opts
 */
async function check(db, { module, now = new Date() }) {
  if (!catalog.isModule(module))
    throw new Error(`ai governance: "${module}" is not a module key`);
  const s = await settings(db);
  if (!s.enabled)
    throw new AppError("AI_DISABLED", "AI features are switched off.", 503);
  if (s.disabled_modules.includes(module)) {
    throw new AppError(
      "AI_MODULE_DISABLED",
      "AI features are switched off for this area.",
      503,
    );
  }
  const spent = await spentThisMonth(db, now);
  if (
    s.monthly_cap_ngn !== null &&
    money.compare(spent, s.monthly_cap_ngn) >= 0
  ) {
    throw new AppError(
      "AI_CAP_REACHED",
      "This month's AI spending limit has been reached.",
      429,
    );
  }
  const apiKey = await keyOf(db);
  return {
    settings: s,
    vendor: vendorFor(s, apiKey),
    model: s.model,
    /** For the vendor call only; never logged, stored or sent anywhere else. */
    api_key: apiKey,
    spent_ngn: spent,
    cap_ngn: s.monthly_cap_ngn,
  };
}

/** Readiness: which vendor answers, without calling it. */
async function health(db) {
  try {
    const s = await settings(db);
    const vendor = vendorFor(s, await keyOf(db));
    return {
      status: "up",
      vendor,
      model: vendor === "stub" ? "stub" : s.model,
      enabled: s.enabled,
    };
  } catch (err) {
    return { status: "degraded", error: String(err.message).slice(0, 120) };
  }
}

module.exports = {
  VENDORS,
  defaults,
  settings,
  vendorFor,
  costOf,
  monthWindow,
  spentThisMonth,
  check,
  health,
};
