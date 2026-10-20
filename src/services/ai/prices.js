"use strict";
/**
 * What one ledger step is charged at (docs/guides/ai-control.md §6.3).
 *
 *   const p = await prices.forStep(db, { provider: "gemini", model: "gemini-2.5-flash" });
 *   // → { input_ngn_per_million: "450.00", output_ngn_per_million: "3750.00", ngn_per_audio_hour: null,
 *   //     ngn_per_search: null, usd_ngn_rate: "1500.0000000000", rate_day: "2026-10-20" }
 *
 * A model's prices are kept in dollars as its provider publishes them (ai_model); the naira price
 * is the dollar price times the newest USD to NGN rate (shared/money/fx.js), rounded to the kobo
 * once, here, as a price. The cost of a call is worked out from these unrounded per million, so
 * ordinary calls are not floored to nothing (governance.js).
 *
 *   Free plan            nothing: the tokens and seconds are still kept on the step
 *   no dollar price      or no rate yet: the naira prices per million tokens in ai_setting (or the
 *                        environment), as before AI Control; audio and searches then cost nothing
 *   audio                a Gemini transcription's input tokens are audio, at the audio price when
 *                        the model has one
 */
const money = require("../../shared/money/money");
const fx = require("../../shared/money/fx");
const quota = require("../../shared/integrations/quota");

const ZERO = Object.freeze({
  input_ngn_per_million: "0.00",
  output_ngn_per_million: "0.00",
  ngn_per_audio_hour: null,
  ngn_per_search: null,
  usd_ngn_rate: null,
  rate_day: null,
});

/** Nothing to pay: the stub, a Free plan. */
const zero = () => ({ ...ZERO });

/** A dollar price in naira at `rate`, to the kobo; null when either is unknown. */
function naira(usd, rate, per = 1) {
  if (usd === null || usd === undefined || rate === null || rate === undefined) return null;
  return money.toWire(money.money(usd).times(money.money(rate)).dividedBy(per));
}

async function modelRow(db, provider, model) {
  try {
    const { rows } = await db.query(
      `SELECT input_usd_per_million::text AS input_usd_per_million, output_usd_per_million::text AS output_usd_per_million,
              audio_usd_per_million::text AS audio_usd_per_million, usd_per_audio_hour::text AS usd_per_audio_hour,
              usd_per_thousand_searches::text AS usd_per_thousand_searches
         FROM ai_model WHERE provider = $1 AND model = $2`,
      [provider, model],
    );
    return rows[0] || null;
  } catch (err) {
    if (err && (err.code === "42P01" || err.code === "42703")) return null;
    throw err;
  }
}

/**
 * The prices one step is charged at.
 * @param {{query: Function}} db
 * @param {{provider: string, model: string, audio?: boolean}} step
 * @returns {Promise<{input_ngn_per_million: string, output_ngn_per_million: string, ngn_per_audio_hour: string|null,
 *                    ngn_per_search: string|null, usd_ngn_rate: string|null, rate_day: string|null}>}
 */
async function forStep(db, { provider, model, audio = false }) {
  if (!provider || provider === "stub") return zero();
  if ((await quota.plan(provider, { db })) === "free") return zero();
  const [row, newest] = await Promise.all([modelRow(db, provider, model), fx.newest({ db })]);
  const rate = newest && newest.usd_ngn ? newest.usd_ngn : null;
  const input = row && (audio && row.audio_usd_per_million ? row.audio_usd_per_million : row.input_usd_per_million);
  const output = row && row.output_usd_per_million;
  if (rate && input && output)
    return {
      input_ngn_per_million: naira(input, rate),
      output_ngn_per_million: naira(output, rate),
      ngn_per_audio_hour: naira(row.usd_per_audio_hour, rate),
      ngn_per_search: naira(row.usd_per_thousand_searches, rate, 1000),
      usd_ngn_rate: rate,
      rate_day: newest.day,
    };
  // A speech model has no token price; its hour is all there is.
  if (rate && row && row.usd_per_audio_hour && !input)
    return { ...zero(), ngn_per_audio_hour: naira(row.usd_per_audio_hour, rate), usd_ngn_rate: rate, rate_day: newest.day };
  const s = await require("./governance").settings(db);
  return {
    ...zero(),
    input_ngn_per_million: s.input_ngn_per_million,
    output_ngn_per_million: s.output_ngn_per_million,
  };
}

module.exports = { forStep, naira, zero };
