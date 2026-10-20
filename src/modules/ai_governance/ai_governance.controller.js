"use strict";
// ai:none AI Control is configuration; the spend is read on its own tab (docs/guides/ai-control.md §9)
// search:none chains, prices and caps are not records anyone looks up; the three tabs are found by their words (shared/search/screens.js)
/**
 * AI Control: the HTTP edge (docs/guides/ai-control.md §5). Find Prices' search runs in the
 * worker; everything else answers at once.
 */
const { ok, accepted, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./ai_governance.service");

const params = (req) => req.validated.params;

module.exports = {
  jobs: async (req, res) => sendPaged(res, await service.jobs(req.validated.query)),
  actions: async (req, res) => sendPaged(res, await service.actions(req.validated.query)),
  saveChain: async (req, res) => ok(res, await service.saveChain(params(req).scope, params(req).key, req.validated.body, withActor(req))),
  makeFirst: async (req, res) => ok(res, await service.makeFirst(params(req).scope, params(req).key, req.validated.body, withActor(req))),
  resetChain: async (req, res) => {
    await service.resetChain(params(req).key, withActor(req));
    noContent(res);
  },
  models: async (req, res) => sendPaged(res, await service.models(req.validated.query)),
  modelsSummary: async (_req, res) => ok(res, await service.modelsSummary()),
  setPrices: async (req, res) => ok(res, await service.setPrices(params(req).id, req.validated.body, withActor(req))),
  findPrices: async (req, res) => accepted(res, await service.findPrices(withActor(req))),
  proposals: async (req, res) => sendPaged(res, await service.proposals(req.validated.query)),
  acceptProposal: async (req, res) => ok(res, await service.acceptProposal(params(req).id, req.validated.body, withActor(req))),
  dismissProposal: async (req, res) => {
    await service.dismissProposal(params(req).id, withActor(req));
    noContent(res);
  },
  spend: async (_req, res) => ok(res, await service.spend()),
  spendActions: async (req, res) => sendPaged(res, await service.spendActions(req.validated.query)),
  setCap: async (req, res) => ok(res, await service.setCap(params(req).provider, req.validated.body, withActor(req))),
  setOverallCap: async (req, res) => ok(res, await service.setOverallCap(req.validated.body, withActor(req))),
};
