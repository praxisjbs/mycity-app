"use strict";
// ai:none design: proof points are MyCity's facts, entered on Categories with the whole set in view; the studio's reads and cards arrive with M7 PR 7 and PR 8
// search:none proof points are cited by proposals, not looked for; proposals are found by proposals.search.js when M7 PR 7 builds them
/**
 * Proposals: the HTTP edge. M7 PR 2 serves proof points (docs/guides/partnerships.md §5, §6.11); the
 * studio's routes arrive with PR 7. Reads need `partnerships` view; every write needs edit and the
 * `partnerships.configure` capability, checked on the route.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const proof = require("./proposals.proof");

const id = (req) => req.validated.params.id;

module.exports = {
  listProofPoints: async (req, res) => sendPaged(res, await proof.list(req.validated.query)),
  createProofPoint: async (req, res) => created(res, await proof.create(withActor(req), req.validated.body)),
  updateProofPoint: async (req, res) => ok(res, await proof.update(withActor(req), id(req), req.validated.body)),
  setProofPointImage: async (req, res) => ok(res, await proof.setImage(withActor(req), id(req), readUpload(req))),
};
