"use strict";
/**
 * Partnerships · partners, their contacts, the Partner 360, duplicates, documents and work (docs/guides/partnerships.md §5).
 *
 * Mounted on /api/v1/partnerships beside the other partnership modules. The routes arrive with M7
 * PR 3 (Leads, partners, deals and the 360s); documents and work with PR 3 and PR 5 (the guide's Appendix A), each defined with route(), its contract in
 * packages/contract/schemas/partners.js and requirePermission("partnerships", <action>), with
 * requireCapability after it where §5 names one. tests/unit/partnerships-skeleton.test.js holds every
 * route here to the partnerships key.
 */
const router = require("express").Router();

module.exports = { basePath: "/partnerships", surface: "staff", router };
