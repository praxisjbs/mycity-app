"use strict";
/**
 * Partnerships · proposals and proof points. M7 PR 2 serves the proof points; the Proposal Studio's
 * routes arrive with PR 7 (docs/guides/partnerships.md §5, Appendix A).
 *
 *   GET   /proof-points                  `partnerships` view: MyCity's facts, 25 a page
 *   POST  /proof-points                  edit + partnerships.configure: add one
 *   PATCH /proof-points/:id              edit + configure: change, move, remove its image, retire, restore
 *   POST  /proof-points/:id/image        edit + configure: upload its logo or picture
 *
 * tests/unit/partnerships-skeleton.test.js holds every route here to the partnerships key.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const controller = require("./proposals.controller");

const router = express.Router();
const pr = c.proposals;
const edit = requirePermission("partnerships", "edit");
const configure = requireCapability("partnerships.configure");

route(router, "get", "/proof-points",
  { query: pr.ProofPointListQuery, response: pr.ProofPointPage, summary: "MyCity's proof points" },
  requirePermission("partnerships", "view"), controller.listProofPoints);

route(router, "post", "/proof-points",
  { body: pr.ProofPointCreate, response: pr.ProofPoint, summary: "Add a proof point" },
  edit, configure, controller.createProofPoint);

route(router, "patch", "/proof-points/:id",
  { params: c.common.IdParams, body: pr.ProofPointUpdate, response: pr.ProofPoint, summary: "Change, retire or restore a proof point" },
  edit, configure, controller.updateProofPoint);

route(router, "post", "/proof-points/:id/image",
  { params: c.common.IdParams, body: c.documents.DocumentUpload, response: pr.ProofPoint, summary: "Upload a proof point's logo or picture" },
  edit, configure, upload.single("file", { purpose: "photo" }), controller.setProofPointImage);

module.exports = { basePath: "/partnerships", surface: "staff", router };
