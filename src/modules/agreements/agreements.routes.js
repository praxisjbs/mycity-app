"use strict";
/**
 * Partnerships · agreements: generate, approve, sign, renew, close (docs/guides/partnerships.md §5).
 *
 * Mounted on /api/v1/partnerships beside the other partnership modules. The routes arrive with M7
 * PR 6 (the guide's Appendix A), each defined with route(), its contract in
 * packages/contract/schemas/agreements.js and requirePermission("partnerships", <action>), with
 * requireCapability after it where §5 names one. tests/unit/partnerships-skeleton.test.js holds every
 * route here to the partnerships key.
 */
const router = require("express").Router();

module.exports = { basePath: "/partnerships", surface: "staff", router };
