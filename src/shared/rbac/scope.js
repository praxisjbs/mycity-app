"use strict";
/**
 * Record scope as SQL. The one translation of req.scope into a WHERE clause, so
 * no repo writes its own idea of "team".
 *
 * middleware/rbac.js sets, on every permission-checked request:
 *
 *   req.scope      "all" | "team" | "own"
 *   req.scope_ids  null for all; employee ids for team (the caller and everyone
 *                  under them); [the caller's employee id] for own
 *
 * A repo names the column that says whose record a row is, and passes the
 * request's scope through:
 *
 *   const s = scopeClause(scope, { column: "e.employee_id" }, params);
 *   const sql = `SELECT ... FROM employee e WHERE e.status = 'active' ${s.and} ORDER BY ...`;
 *
 *   scope "all"   → s.and === ""                      (no filter)
 *   scope "team"  → s.and === "AND e.employee_id = ANY($3::uuid[])"
 *   scope "own"   → same, with a one-element array
 *
 * A row whose owner column is NULL is NOT visible under team or own: a record
 * nobody owns belongs to whoever holds `all`. Records here are about people, so
 * an unowned row is never shown to someone with a narrower grant.
 *
 * Services pass `{ scope, scope_ids }` down from the controller as one object:
 *
 *   controller:  service.list(req.validated.query, scopeOf(req))
 */
const { AppError } = require("../errors");

/** The scope object a controller hands to its service. */
function scopeOf(req) {
  return { scope: req.scope || "own", scope_ids: req.scope_ids || null, employee_id: req.user ? req.user.employee_id : null };
}

/**
 * @param {{scope: string, scope_ids: string[]|null}} s       from scopeOf(req)
 * @param {{column: string}} on                               the owner column, qualified
 * @param {Array} params                                      the query's params; one is appended when filtering
 * @returns {{and: string, where: string}}  "AND ..." / "WHERE ..." fragments, or empty strings for all
 */
function scopeClause(s, on, params) {
  if (!on || !on.column) throw new Error("scopeClause: name the owner column");
  if (!s || !s.scope) throw new Error("scopeClause: pass scopeOf(req)");
  if (s.scope === "all") return { and: "", where: "" };
  if (s.scope !== "team" && s.scope !== "own") throw new Error(`scopeClause: unknown scope "${s.scope}"`);
  const ids = Array.isArray(s.scope_ids) ? s.scope_ids : [];
  params.push(ids);
  const cond = `${on.column} = ANY($${params.length}::uuid[])`;
  return { and: `AND ${cond}`, where: `WHERE ${cond}` };
}

/**
 * For a single record already loaded: may this scope see it?
 * Throws 404, not 403, so a record outside scope is indistinguishable from one
 * that does not exist.
 *
 * @param {{scope: string, scope_ids: string[]|null}} s
 * @param {string|null} ownerEmployeeId
 */
function assertInScope(s, ownerEmployeeId) {
  if (s.scope === "all") return;
  const ids = s.scope_ids || [];
  if (!ownerEmployeeId || !ids.includes(ownerEmployeeId)) {
    throw new AppError("NOT_FOUND", "Not found", 404);
  }
}

module.exports = { scopeOf, scopeClause, assertInScope };
