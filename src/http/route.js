"use strict";
/**
 * Define a route WITH its contract. The only way a route is added to a module
 * router (BACKEND_STRUCTURE §6); the module loader refuses a router that carries
 * a route defined any other way.
 *
 *   const { route } = require("../../http/route");
 *   const c = require("@mycity/contract");
 *
 *   route(router, "get", "/", { query: c.things.ThingListQuery, response: c.things.ThingPage },
 *     requirePermission("workspace", "view"), controller.list);
 *
 *   route(router, "post", "/", { body: c.things.ThingCreate, response: c.things.Thing },
 *     requirePermission("workspace", "create"), controller.create);
 *
 * Staff routes (route) get, in this order:
 *
 *   auth  →  your handlers (requirePermission, upload, ...)  →  validation  →  your last handler
 *
 * so permission is checked before input is parsed, a multipart body is parsed
 * before it is validated, and the controller reads `req.validated`.
 *
 * Public routes (publicRoute) never get auth and may not carry a permission check:
 * they are reached by token (middleware/public-token.js) or, for careers and
 * vacancies only, by slug (README §7 rule 9).
 *
 * Refused when the route is DEFINED, so the process does not boot with it:
 *  - a schema that is not exported from packages/contract (no local Zod);
 *  - no `response` (use `no_content: true` for a 204);
 *  - a POST, PUT or PATCH with no `body` (use common.EmptyBody when the URL says it all);
 *  - a staff route with neither a requirePermission() handler, nor `self: true`
 *    (authenticated, ownership checked in the service: my notifications, my
 *    profile), nor `anonymous: true` (sign-in only).
 *
 * Path parameters named `id` or `*_id` must be UUIDs unless the contract gives
 * `params`; a malformed id is a 404.
 *
 * Under APP_ENV test and development every 2xx JSON response is parsed with the
 * declared `response` schema: a mismatch fails the test (test) or is logged as an
 * error (development), so the backend cannot drift from the contract unnoticed.
 *
 * Every definition is recorded in a registry that the module loader, the
 * contract generator (scripts/gen/contract.js), the route-map and the gates read.
 */
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const {
  validator,
  uuidParams,
  idParamNames,
} = require("../shared/http/validate");

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const WRITES = new Set(["post", "put", "patch"]);
const KEYS = new Set([
  "body",
  "query",
  "params",
  "response",
  "no_content",
  "anonymous",
  "self",
  "summary",
]);

/** Every route defined, in definition order. */
const REGISTRY = [];

let contractSchemas = null;
/** Every Zod schema exported by packages/contract, by identity. */
function knownSchemas() {
  if (contractSchemas) return contractSchemas;
  const contract = require("@mycity/contract");
  contractSchemas = new Set();
  for (const domain of Object.values(contract)) {
    for (const value of Object.values(domain || {})) {
      if (value && typeof value.safeParse === "function")
        contractSchemas.add(value);
    }
  }
  return contractSchemas;
}

function fail(where, msg) {
  throw new Error(`${where}: ${msg}`);
}

function checkContract(where, kind, method, contract) {
  if (!contract || typeof contract !== "object")
    fail(where, "the contract object is required");
  for (const k of Object.keys(contract))
    if (!KEYS.has(k)) fail(where, `unknown contract key "${k}"`);

  for (const part of ["body", "query", "params", "response"]) {
    const schema = contract[part];
    if (schema === undefined) continue;
    if (!schema || typeof schema.safeParse !== "function")
      fail(where, `${part} must be a Zod schema`);
    if (!knownSchemas().has(schema)) {
      fail(
        where,
        `${part} is not exported from packages/contract; define it in packages/contract/schemas/`,
      );
    }
  }
  if (!contract.response && !contract.no_content)
    fail(where, "declare a response schema, or no_content: true");
  if (contract.response && contract.no_content)
    fail(where, "response and no_content cannot both be set");
  if (WRITES.has(method) && !contract.body)
    fail(
      where,
      "a write route declares a body (common.EmptyBody when it has none)",
    );
  if (method === "get" && contract.body) fail(where, "a GET route has no body");

  if (kind === "public") {
    if (contract.anonymous || contract.self)
      fail(where, "anonymous and self are staff-route flags");
  } else if (contract.anonymous && contract.self) {
    fail(where, "a route is either anonymous or self, not both");
  }
}

/** Under test/development: refuse a 2xx JSON body the contract does not describe. */
function responseCheck(where, schema) {
  const mode =
    config.APP_ENV === "test"
      ? "throw"
      : config.APP_ENV === "development"
        ? "log"
        : null;
  if (!mode || !schema) return null;
  return function checkResponse(_req, res, next) {
    const send = res.json.bind(res);
    res.json = (body) => {
      res.json = send;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Check what the client will receive: a Date from a timestamptz column is
        // a string on the wire, and that is what the contract describes.
        const parsed = schema.safeParse(
          JSON.parse(JSON.stringify(body ?? null)),
        );
        if (!parsed.success) {
          const issues = parsed.error.issues.map(
            (i) => `${i.path.join(".") || "(body)"}: ${i.message}`,
          );
          if (mode === "throw")
            throw new Error(
              `${where}: response does not match its contract\n  ${issues.join("\n  ")}`,
            );
          logger.error(
            { route: where, issues },
            "response does not match its contract",
          );
        }
      }
      return send(body);
    };
    next();
  };
}

function define(kind, router, method, path, contract, handlers) {
  const m = String(method).toLowerCase();
  const where = `${kind === "public" ? "publicRoute" : "route"} ${m.toUpperCase()} ${path}`;
  if (!router || typeof router[m] !== "function")
    fail(where, "the first argument is the module's express.Router()");
  if (!METHODS.has(m))
    fail(where, `method must be one of ${[...METHODS].join(", ")}`);
  if (typeof path !== "string" || !path.startsWith("/"))
    fail(where, "path must start with /");
  checkContract(where, kind, m, contract);
  if (handlers.length === 0 || handlers.some((h) => typeof h !== "function"))
    fail(where, "give the handlers, controller last");

  const permission = handlers.map((h) => h.permission).find(Boolean) || null;
  if (kind === "public" && permission)
    fail(where, "a public route cannot carry requirePermission()");
  if (
    kind === "staff" &&
    !contract.anonymous &&
    !contract.self &&
    !permission
  ) {
    fail(
      where,
      "add requirePermission(key, action), or self: true when the service checks ownership",
    );
  }

  const ids = contract.params ? [] : idParamNames(path);
  const before = handlers.slice(0, -1);
  const last = handlers[handlers.length - 1];
  const chain = [
    // Required here, not at the top: a public routes file loads this module and
    // must not pull the staff auth middleware in with it.
    ...(kind === "staff" && !contract.anonymous
      ? [require("../middleware/auth").auth]
      : []),
    ...(ids.length ? [uuidParams(ids)] : []),
    ...before,
    validator({
      body: contract.body,
      query: contract.query,
      params: contract.params,
    }),
    ...[responseCheck(where, contract.response)].filter(Boolean),
    last,
  ];
  router[m](path, ...chain);

  REGISTRY.push({
    kind,
    router,
    method: m.toUpperCase(),
    path,
    contract,
    permission,
  });
}

/** A staff route (/api/v1). */
function route(router, method, path, contract, ...handlers) {
  define("staff", router, method, path, contract, handlers);
}

/** A public route (/api/public/v1). Only in `<module>.public.routes.js`. */
function publicRoute(router, method, path, contract, ...handlers) {
  define("public", router, method, path, contract, handlers);
}

/** Routes defined on one router (the module loader checks them against the router's stack). */
function routesOf(router) {
  return REGISTRY.filter((r) => r.router === router);
}

function registry() {
  return REGISTRY.slice();
}

module.exports = { route, publicRoute, routesOf, registry };
