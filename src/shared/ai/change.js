"use strict";
/**
 * A card that changes a few fields of something the screen saves whole (docs/guides/praxis-ai.md
 * §6.11, decision 33): a numbering scheme, the working week, the company's reminders, System
 * Health's targets. What the card gives is laid over what is saved, then held to the screen form's
 * own schema, so the service saves exactly what that form would have sent, and a problem comes back
 * on its field as a refusal the person can fix on the card.
 *
 *   const body = asForm(c.settings.NumberingSchemeSave, { ...saved, ...given(changes) });
 */
const { AppError } = require("../errors");
const { fieldsOf } = require("../http/validate");

/** Only the fields a card gave: undefined is "not given"; null is a value the person chose. */
function given(changes) {
  return Object.fromEntries(Object.entries(changes || {}).filter(([, v]) => v !== undefined));
}

/**
 * The body as the screen's form would send it, or a 422 naming its fields.
 * @template T
 * @param {{safeParse: (v: unknown) => {success: boolean, data?: T, error?: object}}} schema  the form's own contract schema
 * @param {object} body
 * @returns {T}
 */
function asForm(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, fieldsOf(parsed.error));
  return parsed.data;
}

module.exports = { given, asForm };
