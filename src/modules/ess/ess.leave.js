"use strict";
/**
 * ESS · My Leave: the employee's own requests and what is left of their year
 * (docs/guides/ess.md §3 step 5, §5, §10).
 *
 * Everything here is the caller's own record. The employee comes from the session
 * (meOf), never from the request, and the leave service checks a request is theirs
 * before showing or cancelling it. Asking for leave opens the approval flow; deciding
 * it is the approvers' (My Approvals), never this tab's.
 */
const leave = require("../leave/leave.service");
const { meOf } = require("./ess.documents");

const list = (user, query) => leave.listFor(meOf(user), query);

const get = (user, id) => leave.getOwn(meOf(user), id);

/** The leave calendar: the caller's own, everyone under them, or everyone (leave.calendarScope). */
const calendar = (user, query) => leave.calendarFor(user, meOf(user), query);

const balances = (user, query) => leave.balancesFor(meOf(user), query.year);

const request = (user, body) => leave.request(user, meOf(user), body);

const cancel = (user, id, body) => leave.cancelOwn(user, meOf(user), id, body);

module.exports = { list, get, calendar, balances, request, cancel };
