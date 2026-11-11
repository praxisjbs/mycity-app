"use strict";
/**
 * Employee Self-Service: the caller's own record and nothing else
 * (docs/guides/ess.md). Each tab's work lives in its own file beside this one;
 * this is the one door the controller comes through, so a tab added later
 * cannot quietly reach another person's record from somewhere else.
 *
 * My Profile, My Documents (M0, track B), My Leave (M1), My Performance (M2), My Queries
 * (M3) and My Payslips (M6) are on the real API. Attendance arrives with its own milestone.
 */
const data = require("./ess.export");
const documents = require("./ess.documents");
const earnings = require("./ess.earnings");
const leave = require("./ess.leave");
const performance = require("./ess.performance");
const profile = require("./ess.profile");
const queries = require("./ess.queries");

module.exports = { data, documents, earnings, leave, performance, profile, queries };
