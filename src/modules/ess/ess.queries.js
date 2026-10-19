"use strict";
/**
 * ESS · My Queries: the employee's own queries and their response (docs/guides/ess.md
 * §3 step 3; docs/guides/queries.md §3 step 3).
 *
 * Everything here is the caller's own record: the employee comes from the session
 * (meOf), never from the request, and the queries service checks a query is theirs
 * before showing it or taking a response. Raising and deciding a query belong to
 * Queries & Sanctions, never this tab.
 */
const queries = require("../queries/queries.service");
const { meOf } = require("./ess.documents");

const list = (user, query) => queries.listMine(meOf(user), query);

const respond = (user, id, body) => queries.respond(user, meOf(user), id, body);

module.exports = { list, respond };
