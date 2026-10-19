"use strict";
/**
 * From a query's decision to a proposed sanction (docs/guides/queries.md §3 step 4,
 * §6.4). The query is the record a person decides on; the sanction, its approval and
 * its letter belong to the sanctions module, so this hands the decision across inside
 * the same transaction and marks the query as waiting on that approval.
 */
const { AppError } = require("../../shared/errors");
const repo = require("./queries.repo");

/**
 * @param {import("pg").PoolClient} client  inside the decision's transaction, the query locked
 * @param {object} actor   who decided
 * @param {object} row     the query (repo.get)
 * @param {object} body    QueryDecision with outcome `sanction`
 */
async function propose(client, actor, row, body) {
  const sanctions = require("../sanctions/sanctions.service");
  if (typeof sanctions.propose !== "function")
    throw new AppError("SANCTIONS_NOT_READY", "Sanctions cannot be proposed yet", 409);
  const proposal = await sanctions.propose(client, actor, row, body);
  await repo.setReview(client, row.employee_query_id, proposal.workflow_instance_id);
  return proposal;
}

module.exports = { propose };
