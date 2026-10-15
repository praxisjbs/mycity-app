"use strict";
/**
 * Running one of the assistant's reads for a person, with that person's rights and
 * nothing more (MILESTONES §15: "an agent checks the caller's grants before the model
 * answers, so marketing cannot reach HR employee data through a question").
 *
 *   const r = await authorise.runRead(client, req.user, "employees.list", { page: 1, q: "ada" });
 *   // → { key, list: true, page: { number, size: 25, total, ... }, data: [...], citations: [...] }
 *
 * In order, every time:
 *   1. the read exists (registry.js);
 *   2. the caller holds its grant (`view` on its module), decided by the same code as
 *      requirePermission (middleware/rbac.scopeFor); refused with AI_READ_FORBIDDEN, so
 *      the assistant can say "that is not available to you";
 *   3. the parameters parse with the read's contract schema; nothing the model invents
 *      reaches SQL unchecked;
 *   4. the read runs with the caller's own scope (all, team or own) as `actor.scope`;
 *   5. a list read must return one page of at most 25 (assertPage, BACKEND_STRUCTURE
 *      §16), however the question was phrased: "all our contacts" is the first 25 and
 *      the total, and the next page is a second read;
 *   6. restricted fields are masked for the caller (shared/rbac/field-mask) before the
 *      model or anyone sees the rows;
 *   7. the rows are cited (cite.js), from what was read.
 *
 * allowedReads(actor) is the tool list for one person: only the reads they could run,
 * so the model is never offered a read that would be refused.
 */
const { logger } = require("../../config/logger");
const { AppError } = require("../errors");
const { assertPage } = require("../http/paged");
const { maskForUser } = require("../rbac/field-mask");
const metrics = require("../observability/metrics");
const registry = require("./registry");
const { citationsFor } = require("./cite");

const scopeFor = (...args) =>
  require("../../middleware/rbac").scopeFor(...args);

/**
 * The reads this person may run.
 * @param {object} actor  req.user
 */
async function allowedReads(actor) {
  const out = [];
  for (const r of registry.reads()) {
    if (await scopeFor(actor, r.permission[0], r.permission[1])) out.push(r);
  }
  return out;
}

/**
 * Run one read for one person.
 * @param {{query: Function}} client
 * @param {object} actor   req.user
 * @param {string} key     a read key ("employees.list")
 * @param {object} [params]
 */
async function runRead(client, actor, key, params = {}) {
  const read = registry.read(key);
  if (!read)
    throw new AppError("AI_READ_UNKNOWN", `There is no "${key}" read`, 404);

  const scope = await scopeFor(actor, read.permission[0], read.permission[1]);
  if (!scope) {
    metrics.inc(
      "mycity_ai_read_denials_total",
      { read: key },
      1,
      "AI reads refused for want of a grant.",
    );
    logger.warn(
      { ai_read: key, user_id: actor && actor.user_id },
      "AI read denied",
    );
    throw new AppError(
      "AI_READ_FORBIDDEN",
      "That information is not available to you.",
      403,
    );
  }

  const parsed = read.params.safeParse(params || {});
  if (!parsed.success) {
    const fields = {};
    for (const i of parsed.error.issues)
      (fields[i.path.join(".") || "(params)"] ||= []).push(i.message);
    throw new AppError(
      "AI_READ_INVALID",
      `The "${key}" read was asked for with parameters it does not take`,
      422,
      fields,
    );
  }

  const result = await read.run(client, parsed.data, { ...actor, scope });
  let rows;
  if (read.list) {
    assertPage(result, `AI read ${key}`);
    rows = result.data;
  } else {
    if (Array.isArray(result) || (result && Array.isArray(result.data))) {
      throw new Error(
        `AI read ${key}: a read without page in its params returns one record or null; a list takes listQuery()`,
      );
    }
    rows = result ? [result] : [];
  }

  const masked = await maskForUser(client, actor, rows);
  return {
    key,
    list: read.list,
    page: read.list ? result.page : null,
    data: read.list ? masked : masked[0] || null,
    citations: citationsFor(read, masked),
  };
}

module.exports = { allowedReads, runRead };
