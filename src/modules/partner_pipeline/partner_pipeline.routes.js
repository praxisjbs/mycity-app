"use strict";
/**
 * Partnerships · categories, lists, custom fields, Start From Tracker, deals, their stages, health and returns (docs/guides/partnerships.md §5).
 *
 * Mounted on /api/v1/partnerships beside the other partnership modules. The routes arrive with M7
 * PR 2 (categories, lists, fields, templates, proof points) and PR 3 (deals); returns with PR 4 (the guide's Appendix A), each defined with route(), its contract in
 * packages/contract/schemas/partner_pipeline.js and requirePermission("partnerships", <action>), with
 * requireCapability after it where §5 names one. tests/unit/partnerships-skeleton.test.js holds every
 * route here to the partnerships key.
 */
const router = require("express").Router();

module.exports = { basePath: "/partnerships", surface: "staff", router };
