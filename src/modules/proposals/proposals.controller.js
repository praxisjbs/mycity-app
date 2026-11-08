"use strict";
// ai:none design: proof points are MyCity's facts, entered on Categories with the whole set in view, and the studio is built on screen (a brief, cards, pages, a confirmed Send); M7 PR 8 declares the proposals.list read and the proposals.start card
// search:none proof points are cited by proposals, not looked for; proposals are found by proposals.search.js when M7 PR 8 builds search
/**
 * Proposals: the HTTP edge (docs/guides/partnerships.md §5, §6.10, §6.11). Proof points (M7 PR 2) and
 * the Proposal Studio (PR 7). Reads need `partnerships` view; the studio's writes need edit (New Proposal
 * create), within the deal's scope (§6.1); proof points and Save as Template need `partnerships.configure`.
 */
const { ok, created, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { scopeOf } = require("../../shared/rbac/scope");
const { readUpload } = require("../../middleware/upload");
const proof = require("./proposals.proof");
const service = require("./proposals.service");
const draft = require("./proposals.draft");
const send = require("./proposals.send");

const id = (req) => req.validated.params.id;
const actor = (req) => withActor(req);

module.exports = {
  listProofPoints: async (req, res) => sendPaged(res, await proof.list(req.validated.query)),
  createProofPoint: async (req, res) => created(res, await proof.create(withActor(req), req.validated.body)),
  updateProofPoint: async (req, res) => ok(res, await proof.update(withActor(req), id(req), req.validated.body)),
  setProofPointImage: async (req, res) => ok(res, await proof.setImage(withActor(req), id(req), readUpload(req))),

  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get(actor(req), id(req), scopeOf(req))),
  preview: async (req, res) => {
    const out = await service.previewOf(actor(req), id(req), scopeOf(req));
    return ok(res, { html: out.html, sections: out.sections, checks: out.checks });
  },
  start: async (req, res) => created(res, await service.start(actor(req), req.validated.body, scopeOf(req))),
  retry: async (req, res) => ok(res, await service.retry(actor(req), id(req), scopeOf(req))),
  answer: async (req, res) => ok(res, await service.answer(actor(req), id(req), req.validated.params.qid, req.validated.body, scopeOf(req))),
  skip: async (req, res) => ok(res, await service.skip(actor(req), id(req), req.validated.params.qid, scopeOf(req))),
  reshuffle: async (req, res) => ok(res, await service.reshuffle(actor(req), id(req), req.validated.params.qid, scopeOf(req))),
  draft: async (req, res) => ok(res, await service.requestDraft(actor(req), id(req), scopeOf(req))),
  edit: async (req, res) => ok(res, await service.edit(actor(req), id(req), req.validated.body, scopeOf(req))),
  rewrite: async (req, res) => {
    const p = await service.seen(require("../../config/db").pool, id(req), scopeOf(req));
    if (p.status !== "draft" || !p.content) throw service.refuse("Revise a sent proposal to change it");
    return ok(res, await draft.rewrite(actor(req), p, req.validated.params.key, req.validated.body.instruction));
  },
  message: async (req, res) => ok(res, await draft.message(actor(req), await service.seen(require("../../config/db").pool, id(req), scopeOf(req)))),
  send: async (req, res) => ok(res, await send.send(actor(req), id(req), req.validated.body, scopeOf(req))),
  pdf: async (req, res) => accepted(res, await service.pdf(actor(req), id(req), scopeOf(req))),
  accept: async (req, res) => ok(res, await service.accept(actor(req), id(req), scopeOf(req))),
  decline: async (req, res) => ok(res, await service.decline(actor(req), id(req), req.validated.body, scopeOf(req))),
  withdraw: async (req, res) => ok(res, await service.withdraw(actor(req), id(req), scopeOf(req))),
  revise: async (req, res) => created(res, await service.revise(actor(req), id(req), scopeOf(req))),
  saveTemplate: async (req, res) => created(res, await service.saveTemplate(actor(req), id(req), req.validated.body, scopeOf(req))),
  listTemplates: async (req, res) => sendPaged(res, await service.listTemplates(req.validated.query)),
};
