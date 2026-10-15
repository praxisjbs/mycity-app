"use strict";
/**
 * One id per request, from the browser to the database and back.
 *
 * Takes the caller's X-Request-Id when it is a plain token (so the staff app can
 * correlate its own logs), otherwise mints a UUID. Echoed on the response, set on
 * req.request_id, and opened as the request context that the logger, the error
 * reporter and the audit trail read (config/request-context.js).
 *
 * The incoming id is shape-checked because it is written into every log line.
 */
const { randomUUID } = require("node:crypto");
const requestContext = require("../config/request-context");

const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

/** The surface is filled in later by http/routes.js, once the path says which one it is. */
function requestId(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && SAFE_ID.test(incoming)
      ? incoming
      : randomUUID();
  req.request_id = id;
  res.setHeader("X-Request-Id", id);
  requestContext.run(
    { requestId: id, userId: null, surface: null, importBatchId: null },
    () => next(),
  );
}

module.exports = { requestId, SAFE_ID };
