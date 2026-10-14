"use strict";
/**
 * The public surface's only key: a token in the URL (README §7 rule 9).
 *
 *   publicRoute(router, "get", "/offers/:token", { response: c.offers.PublicOffer },
 *     requirePublicToken("offer.view"), controller.view);
 *
 *   publicRoute(router, "post", "/offers/:token/sign", { body: c.offers.SignBody, response: c.offers.Signed },
 *     requirePublicToken("offer.sign"), controller.sign);     // the service consumes it in its transaction
 *
 * On success:
 *
 *   req.public_token = { public_token_id, scope, subject_type, subject_id, single_use }
 *
 * The controller reads ONLY that record, through an allow-listed public shape.
 * Any failure (malformed, unknown, expired, revoked, spent, wrong scope) is the
 * same 404, so the link reveals nothing about why, or whether, a record exists.
 *
 * A single-use token is not spent here: the service calls
 * publicToken.consume(client, id) inside the transaction that does the work, so
 * a failed save leaves the link usable and a double submit cannot use it twice.
 */
const { pool } = require("../config/db");
const { AppError } = require("../shared/errors");
const publicToken = require("../shared/tokens/public-token");

const notFound = () => new AppError("NOT_FOUND", "This link is not valid or has expired", 404);

/**
 * @param {string} scope   "<thing>.<action>", the one thing this route does
 * @param {{param?: string}} [opts]  the path parameter holding the token, default "token"
 */
function requirePublicToken(scope, { param = "token" } = {}) {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(scope || "")) {
    throw new Error(`requirePublicToken: scope is "<thing>.<action>", got ${JSON.stringify(scope)}`);
  }
  const mw = async function publicTokenCheck(req, _res, next) {
    const raw = req.params[param];
    if (!publicToken.looksLikeToken(raw)) throw notFound();
    const row = await publicToken.resolve(pool, raw, { scope });
    if (!row) throw notFound();
    req.public_token = row;
    return next();
  };
  mw.publicScope = scope;
  return mw;
}

module.exports = { requirePublicToken };
