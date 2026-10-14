"use strict";
/**
 * Find every module's routes and mount them on the right surface.
 *
 *   src/modules/<name>/<name>.routes.js          → staff  surface, /api/v1<basePath>
 *   src/modules/<name>/<name>.public.routes.js   → public surface, /api/public/v1<basePath>
 *
 * Each routes file exports:
 *
 *   module.exports = { basePath: "/employees", surface: "staff", router };
 *
 * The surface is declared AND implied by the file name, and the two must agree,
 * so a staff router can never be mounted on the public surface by a one-word
 * mistake (SYSTEM_ARCHITECTURE §3).
 *
 * Flat src/modules/<name>/, no groups, no feature gate (A4). Rules:
 *  - a duplicate METHOD + path across two modules fails boot, because the
 *    second would be dead code enforcing a different permission on the same URL;
 *  - one module that fails to load is skipped and REPORTED (health/ready shows
 *    "degraded" and the deploy gate stops), unless `strict`, which throws; the
 *    contract generator and the tests load strict;
 *  - a routes file that is still empty (the repository map creates every file
 *    before its module is built) is skipped quietly;
 *  - every route on a module's router must have been defined through
 *    http/route.js, so no route exists without a contract.
 */
const fs = require("node:fs");
const path = require("node:path");
const { logger } = require("../config/logger");
const { routesOf } = require("./route");

const MODULES_DIR = path.resolve(__dirname, "../modules");
const NAME_RE = /^[a-z][a-z0-9_]*$/;

let lastReport = { mounted: [], skipped: [], routes: [] };

/** @returns {Array<{module: string, surface: "staff"|"public", file: string}>} */
function discover(dir = MODULES_DIR) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !NAME_RE.test(e.name)) continue;
    for (const [surface, file] of [
      ["staff", `${e.name}.routes.js`],
      ["public", `${e.name}.public.routes.js`],
    ]) {
      const full = path.join(dir, e.name, file);
      if (fs.existsSync(full) && fs.statSync(full).size > 0) out.push({ module: e.name, surface, file: full });
    }
  }
  return out;
}

/** "METHOD /path" for every route Express holds on `router`, with the router's own prefix. */
function stackRoutes(router) {
  const out = [];
  for (const layer of (router && router.stack) || []) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods || {})) {
      if (method === "_all") continue;
      out.push(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return out;
}

function checkDefinition(found, def) {
  const where = path.relative(path.resolve(__dirname, "../.."), found.file);
  if (!def || typeof def !== "object" || !def.router) throw new Error(`${where}: export { basePath, surface, router }`);
  if (def.surface !== found.surface) {
    throw new Error(`${where}: surface is "${def.surface}" but a ${found.surface === "public" ? ".public.routes.js" : ".routes.js"} file is the ${found.surface} surface`);
  }
  if (typeof def.basePath !== "string" || !/^\/[a-z0-9/_-]*$/.test(def.basePath)) {
    throw new Error(`${where}: basePath must be a lower-case path starting with /`);
  }
  for (const layer of def.router.stack || []) {
    if (!layer.route && layer.handle && Array.isArray(layer.handle.stack)) {
      throw new Error(`${where}: a router nested with router.use() hides its routes from the contract; define every route on the module's router`);
    }
  }
  const defined = new Set(routesOf(def.router).map((r) => `${r.method} ${r.path}`));
  for (const key of stackRoutes(def.router)) {
    if (!defined.has(key)) throw new Error(`${where}: ${key} was not defined with route() / publicRoute(), so it has no contract`);
  }
  const wrongKind = routesOf(def.router).find((r) => r.kind !== found.surface);
  if (wrongKind) {
    throw new Error(`${where}: ${wrongKind.method} ${wrongKind.path} uses ${wrongKind.kind === "public" ? "publicRoute" : "route"} on the ${found.surface} surface`);
  }
}

/**
 * Mount every module.
 * @param {{staff: import("express").Router, public: import("express").Router}} targets
 * @param {{strict?: boolean, dir?: string}} [opts]
 * @returns {{mounted: string[], skipped: Array<{module: string, error: string}>, routes: Array<object>}}
 */
function mountModules(targets, { strict = false, dir = MODULES_DIR } = {}) {
  const mounted = [];
  const skipped = [];
  const routes = [];
  const seen = new Map();

  for (const found of discover(dir)) {
    const label = `${found.module}${found.surface === "public" ? " (public)" : ""}`;
    let def;
    try {
      def = require(found.file);
      checkDefinition(found, def);
    } catch (err) {
      if (strict) throw err;
      logger.error({ module: label, err }, "module skipped: it failed to load, and its routes are not served");
      skipped.push({ module: label, error: err.message });
      continue;
    }

    const prefix = found.surface === "public" ? "/api/public/v1" : "/api/v1";
    const base = def.basePath === "/" ? "" : def.basePath;
    for (const r of routesOf(def.router)) {
      const full = `${r.method} ${prefix}${base}${r.path === "/" ? "" : r.path}`;
      if (seen.has(full)) {
        throw new Error(`Duplicate route ${full}: defined by ${seen.get(full)} and ${label}. Give one of them a different path.`);
      }
      seen.set(full, label);
      routes.push({
        surface: found.surface,
        module: found.module,
        method: r.method,
        path: `${prefix}${base}${r.path === "/" ? "" : r.path}`,
        permission: r.permission,
        anonymous: Boolean(r.contract.anonymous),
        self: Boolean(r.contract.self),
        contract: r.contract,
      });
    }

    targets[found.surface].use(def.basePath, def.router);
    mounted.push(label);
  }

  if (skipped.length) {
    logger.error({ skipped: skipped.map((s) => s.module) }, "this process is serving an incomplete API");
  }
  lastReport = { mounted, skipped, routes };
  return lastReport;
}

/** What the last mountModules() did; read by /api/health/ready and the generators. */
function mountReport() {
  return lastReport;
}

module.exports = { discover, mountModules, mountReport, MODULES_DIR };
