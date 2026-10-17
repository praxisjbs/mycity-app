"use strict";
/**
 * Employee Self-Service: the caller's own record and nothing else
 * (docs/guides/ess.md). Each tab's work lives in its own file beside this one;
 * this is the one door the controller comes through, so a tab added later
 * cannot quietly reach another person's record from somewhere else.
 *
 * My Documents is on the real API (M0, track B). My Profile, attendance, pay,
 * leave, queries and performance arrive with their own milestones.
 */
const documents = require("./ess.documents");

module.exports = { documents };
