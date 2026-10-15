"use strict";
/**
 * Build the Express app. Does not listen, connect or schedule anything, so the
 * tests, the contract generator and server.js all build the same app.
 *
 *   const { buildApp } = require("./app");
 *   const { app, report } = buildApp();
 *
 * Order (SYSTEM_ARCHITECTURE §4), each step for a reason:
 *
 *   async-safe          before any router exists, so every async throw reaches the handler
 *   request-id          opens the request context the logger reads
 *   access-log          after the id, so the access line carries it
 *   helmet              security headers; the API serves JSON only, so the default CSP holds
 *   compression
 *   environment-marker  X-Mycity-Environment on everything, errors included
 *   host guard          a path on the wrong host is a 404 (http/static.js)
 *   json body (1 MB)    files never come as JSON (shared/http/body-limits.js)
 *   cookie-parser       the refresh token cookie, read by the identity module only
 *   routes              health, metrics, /api/v1 (staff), /api/public/v1 (public)
 *   static sites        app/dist on the staff host, public-app/dist on the public host
 *   not-found, error handler
 *
 * `trust proxy` is a hop COUNT, not `true`: with `true`, any client can claim any
 * IP in X-Forwarded-For and walk past every per-IP rate limit. It also makes
 * req.hostname the Host the browser asked for, which the host guard relies on.
 *
 * The Content-Security-Policy is written for the two builds this process serves:
 * scripts, styles, fonts and API calls from the same origin only; images and
 * media also from blob: and data: (upload previews, voice notes). Nothing is
 * loaded from a third-party CDN.
 */
require("./middleware/async-safe");

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const { config, isServer } = require("./config/env");
const { requestId } = require("./middleware/request-id");
const { accessLog } = require("./middleware/access-log");
const { environmentMarker } = require("./middleware/environment-marker");
const { errorHandler, notFound } = require("./middleware/error-handler");
const { JSON_LIMIT } = require("./shared/http/body-limits");
const { buildRoutes } = require("./http/routes");
const { hostGuard, staticSites } = require("./http/static");

const CSP = {
  useDefaults: true,
  directives: {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    // Over plain http on a laptop, upgrading would point every request at https.
    "upgrade-insecure-requests": isServer ? [] : null,
  },
};

/**
 * @param {{strict?: boolean, accessLog?: boolean, modulesDir?: string}} [opts]
 *   strict      a module that fails to load throws instead of being skipped
 *   accessLog   false in unit tests, to keep the output readable
 *   modulesDir  tests point this at fixture modules
 */
function buildApp(opts = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    config.TRUST_PROXY_HOPS > 0 ? config.TRUST_PROXY_HOPS : false,
  );
  app.set("etag", false);

  app.use(requestId);
  if (opts.accessLog !== false) app.use(accessLog());
  app.use(
    helmet({
      contentSecurityPolicy: CSP,
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use(compression());
  app.use(environmentMarker);
  app.use(hostGuard());
  app.use(express.json({ limit: JSON_LIMIT }));
  app.use(cookieParser());

  const { router, report } = buildRoutes({
    strict: Boolean(opts.strict),
    dir: opts.modulesDir,
  });
  app.use(router);
  app.use(staticSites());

  app.use(notFound);
  app.use(errorHandler);
  return { app, report };
}

module.exports = { buildApp };
