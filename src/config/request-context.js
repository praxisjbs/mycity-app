"use strict";
/**
 * Per-request ambient context, carried through every await without being passed.
 *
 *   { requestId, userId, surface, importBatchId }
 *
 *  - The logger mixin adds these to every line (config/logger.js).
 *  - emit() records the actor and request on the audit row (shared/events/emit.js).
 *  - The import engine sets importBatchId so every record it writes can be
 *    reverted as one batch (shared/import).
 *
 * Workers and scripts open their own scope with run(); outside one, get() is
 * undefined and every getter returns null.
 *
 *   requestContext.run({ requestId, userId: null, surface: "script" }, () => work());
 */
const { AsyncLocalStorage } = require("node:async_hooks");

/**
 * @typedef {object} RequestContext
 * @property {string} [requestId]
 * @property {string|null} [userId]
 * @property {"staff"|"public"|"worker"|"script"} [surface]
 * @property {string|null} [importBatchId]
 */

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with `ctx` bound for its whole async lifetime.
 * @template T
 * @param {RequestContext} ctx
 * @param {() => T} fn
 * @returns {T}
 */
function run(ctx, fn) {
  return storage.run({ ...(ctx || {}) }, fn);
}

/** @returns {RequestContext|undefined} */
function get() {
  return storage.getStore();
}

/**
 * Add fields to the current context (auth sets userId once the token is checked).
 * No-op outside a scope.
 * @param {Partial<RequestContext>} patch
 */
function set(patch) {
  const ctx = storage.getStore();
  if (ctx) Object.assign(ctx, patch);
}

const field = (name) => () => {
  const ctx = storage.getStore();
  return (ctx && ctx[name]) || null;
};

module.exports = {
  run,
  get,
  set,
  getRequestId: field("requestId"),
  getUserId: field("userId"),
  getSurface: field("surface"),
  getImportBatchId: field("importBatchId"),
};
