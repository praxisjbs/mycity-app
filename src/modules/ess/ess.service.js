"use strict";
/**
 * Employee Self-Service: the caller's own record and nothing else
 * (docs/guides/ess.md). Each tab's work lives in its own file beside this one;
 * this is the one door the controller comes through, so a tab added later
 * cannot quietly reach another person's record from somewhere else.
 *
 * My Profile, My Documents (M0, track B) and My Leave (M1) are on the real API.
 * Attendance, pay, queries and performance arrive with their own milestones.
 */
const data = require("./ess.export");
const documents = require("./ess.documents");
const leave = require("./ess.leave");
const profile = require("./ess.profile");

module.exports = { data, documents, leave, profile };
