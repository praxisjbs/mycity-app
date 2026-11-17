"use strict";
/**
 * ESS · My Leave: the employee's own requests and what is left of their year
 * (docs/guides/ess.md §3 step 5, §5, §10).
 *
 * Everything here is the caller's own record. The employee comes from the session
 * (meOf), never from the request, and the leave service checks a request is theirs
 * before showing or cancelling it. Asking for leave opens the approval flow; deciding
 * it is the approvers' (My Approvals), never this tab's. A request that names the caller as
 * its relief officer is theirs to read, never to cancel (docs/guides/ess.md §6).
 */
const leave = require("../leave/leave.service");
const { meOf } = require("./ess.documents");

const list = (user, query) => leave.listFor(meOf(user), query);

/** One of the caller's requests, or one that names them as its relief officer (read only). */
const get = (user, id) => leave.getOwn(meOf(user), id);

/** Before Send: the working days, and whether the type asks for a relief officer and a handover note. */
const check = (_user, query) => leave.checkSpan(query);

/** Who may cover for the caller: never themselves, 25 at a time. */
const reliefOfficers = (user, query) => leave.reliefOfficers(meOf(user), query);

/** The leave calendar: the caller's own, everyone under them, or everyone (leave.calendarScope). */
const calendar = (user, query) => leave.calendarFor(user, meOf(user), query);

const balances = (user, query) => leave.balancesFor(meOf(user), query.year);

const request = (user, body) => leave.request(user, meOf(user), body);

const cancel = (user, id, body) => leave.cancelOwn(user, meOf(user), id, body);

module.exports = { list, get, check, reliefOfficers, calendar, balances, request, cancel };
