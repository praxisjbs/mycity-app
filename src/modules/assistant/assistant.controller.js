"use strict";
// ai:none a person's questions are their own, and the assistant never reads its own history as data (docs/guides/praxis-ai.md §9)
/**
 * Praxis AI: the HTTP edge (docs/guides/praxis-ai.md §5). Everything is the caller's own; the
 * service pins every query to their user.
 */
const { ok, noContent, accepted } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const service = require("./assistant.service");
const history = require("./assistant.history");
const historyExport = require("./assistant.export");
const cards = require("./assistant.cards");
const reads = require("./assistant.reads");

const params = (req) => req.validated.params;

module.exports = {
  ask: async (req, res) => ok(res, await service.ask(req.validated.body, withActor(req))),
  suggestions: async (req, res) => ok(res, await service.suggestionsFor(req.user)),
  conversations: async (req, res) => sendPaged(res, await history.conversations(req.validated.query, req.user)),
  turns: async (req, res) => sendPaged(res, await history.turns(params(req).id, req.validated.query, req.user)),
  deleteConversation: async (req, res) => {
    await history.deleteConversation(params(req).id, withActor(req));
    noContent(res);
  },
  clearHistory: async (req, res) => {
    await history.clearHistory(withActor(req));
    noContent(res);
  },
  summary: async (req, res) => ok(res, await history.summary(req.user)),
  questions: async (req, res) => sendPaged(res, await history.questions(req.validated.query, req.user)),
  exportHistory: async (req, res) => accepted(res, await historyExport.requestExport(withActor(req))),
  feedback: async (req, res) => {
    await service.feedback(params(req).id, req.validated.body, withActor(req));
    noContent(res);
  },
  transcribe: async (req, res) => ok(res, await service.transcribe(readUpload(req), withActor(req))),
  readRows: async (req, res) => ok(res, await reads.rows(params(req).id, params(req).n, req.validated.query, req.user)),
  exportRead: async (req, res) => accepted(res, await historyExport.requestReadExport(params(req).id, params(req).n, withActor(req))),
  card: async (req, res) => ok(res, await cards.get(params(req).id, req.user)),
  editCard: async (req, res) => ok(res, await cards.edit(params(req).id, req.validated.body, withActor(req))),
  confirmCard: async (req, res) => ok(res, await cards.confirm(params(req).id, req.validated.body, withActor(req), req.get("Idempotency-Key") || null)),
  cancelCard: async (req, res) => ok(res, await cards.cancel(params(req).id, withActor(req))),
};
