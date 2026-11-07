"use strict";
/**
 * A deal's options (docs/guides/partnerships.md §6.6), as MyCity's Deal Merchant Agreement prices
 * them: up to five lines, each a label, Original Price, Discount %, Deal Price (or a price note:
 * App Download, Free Entry), MyCity's Commission per sale and the Merchant's Take per sale.
 *
 *   commission   defaults to the deal price times the deal's rate
 *   take         defaults to the deal price less the commission
 *
 * Both may be set by a holder of `partnerships.money`; for anyone else they are worked out here,
 * since what they would enter is refused (§6.1).
 */
const money = require("../../shared/money/money");
const { AppError } = require("../../shared/errors");

/**
 * The options a deal keeps, each with its defaults filled.
 * @param {Array<object>} options  DealOptionInput[]
 * @param {string|null} rate       the deal's commission rate ("8.00"), or null
 * @returns {Array<object>}
 */
function withDefaults(options, rate) {
  const seen = new Set();
  return (options || []).map((o, i) => {
    if (seen.has(o.position)) {
      throw new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [`options.${i}.position`]: ["Used twice"] });
    }
    seen.add(o.position);
    const price = o.deal_price ?? null;
    const commission =
      o.commission_amount ?? (price !== null && rate !== null && rate !== undefined ? money.toWire(money.percentOf(price, rate)) : null);
    const take = o.merchant_take ?? (price !== null && commission !== null ? money.toWire(money.money(price).minus(money.money(commission))) : null);
    return {
      position: o.position,
      label: o.label,
      original_price: o.original_price ?? null,
      discount_pct: o.discount_pct ?? null,
      deal_price: price,
      price_note: o.price_note ?? null,
      commission_amount: commission,
      merchant_take: take,
    };
  });
}

/** Whether a rate differs from its category's default; with no default there is nothing to differ from. */
function deviates(rate, categoryDefault) {
  if (rate === null || rate === undefined || categoryDefault === null || categoryDefault === undefined) return false;
  return money.compare(rate, categoryDefault) !== 0;
}

module.exports = { withDefaults, deviates };
