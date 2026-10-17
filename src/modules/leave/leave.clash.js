"use strict";
/**
 * Cover: who else in the same department is away, or waiting to be, on the days a
 * request asks for (People · Leave). It reads only what the caller's `people` scope
 * already shows, so a line manager sees their own team's clashes and nobody else's.
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const { assertInScope } = require("../../shared/rbac/scope");
const repo = require("./leave.repo");

/** One page of the requests that overlap request `id` in its department. */
async function clashesOf(id, query, scope) {
  const of = await repo.get(pool, id);
  if (!of) throw new AppError("NOT_FOUND", "That leave request does not exist", 404);
  assertInScope(scope, of.employee_id);
  return repo.clashes(pool, of, query, scope);
}

module.exports = { clashesOf };
