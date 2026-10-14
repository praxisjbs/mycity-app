"use strict";
/**
 * Say which environment answered (SYSTEM_ARCHITECTURE §10: marked, not crippled).
 *
 *   X-Mycity-Environment: staging | production | development | test   on every response
 *   X-Mycity-Build: <first 12 of the sha>                             on every response
 *   X-Robots-Tag: noindex, nofollow                                   everywhere except production
 *
 * Staging does everything production does; it only says what it is, so a
 * screenshot, a mail or a crawler can never mistake it for the real thing.
 */
const { config } = require("../config/env");
const { shortSha } = require("../config/build-info");

function environmentMarker(_req, res, next) {
  res.setHeader("X-Mycity-Environment", config.APP_ENV);
  res.setHeader("X-Mycity-Build", shortSha());
  if (config.APP_ENV !== "production") res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
}

module.exports = { environmentMarker };
