"use strict";
/**
 * What the proposals module records (docs/guides/partnerships.md §7). Proof points arrive with M7 PR 2;
 * the Proposal Studio's event keys arrive with PR 7.
 *
 *   proof_point.created   a fact about MyCity a proposal may cite was entered
 *   proof_point.updated   one was changed, moved, given or lost its image, retired or restored
 *
 * A proof point's image is a logo or a picture, stored by this module against the proof point
 * (`proof_point_image`), and read by anyone who may open Partnerships.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const grantsCache = require("../../shared/rbac/grants-cache");

const EVENTS = defineEvents("partnerships", {
  "proof_point.created": { summary: "A proof point was added" },
  "proof_point.updated": { summary: "A proof point was changed, retired or restored" },
});

defineDocumentType("proof_point_image", { label: "Proof point image", module: "partnerships", sensitivity: "normal" });

/** A proof point's picture is MyCity's own: whoever may open Partnerships may see it. */
vault.defineAccess("proof_point", async (client, user) => {
  if (!user || !user.user_id) return false;
  if (user.is_ceo === true) return true;
  const { scopeFromGrants } = require("../../middleware/rbac");
  const rows = await grantsCache.getGrants(client, { role_ids: user.role_ids || [], module: "partnerships" });
  return Boolean(scopeFromGrants(rows, "view"));
});

module.exports = { EVENTS };
