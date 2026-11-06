"use strict";
/**
 * Partnerships · Partners: the HTTP edge for partners, the Partner 360, contacts, documents and
 * duplicates (docs/guides/partnerships.md §5). Scope comes from the `partnerships` grant (§6.1).
 * The Work tab's route arrives with My Workspace's links (M7 PR 5).
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./partners.service");
const documents = require("./partners.documents");
const dedup = require("./partners.dedup");

const id = (req) => req.validated.params.id;

module.exports = {
  summary: async (req, res) => ok(res, await service.summary(scopeOf(req))),
  list: async (req, res) => sendPaged(res, await service.list(req.validated.query, scopeOf(req))),
  get: async (req, res) => ok(res, await service.get360(id(req), scopeOf(req), req.user)),
  create: async (req, res) => created(res, await service.create(withActor(req), scopeOf(req), req.validated.body)),
  update: async (req, res) => ok(res, await service.update(withActor(req), scopeOf(req), id(req), req.validated.body)),
  close: async (req, res) => ok(res, await service.close(withActor(req), scopeOf(req), id(req), req.validated.body)),
  duplicates: async (req, res) => ok(res, await dedup.find(req.validated.query)),
  createContact: async (req, res) => created(res, await service.createContact(withActor(req), scopeOf(req), req.validated.body)),
  updateContact: async (req, res) => ok(res, await service.updateContact(withActor(req), scopeOf(req), id(req), req.validated.body)),
  documents: async (req, res) => sendPaged(res, await documents.page(req.validated.query, scopeOf(req))),
  attach: async (req, res) => created(res, await documents.attach(withActor(req), scopeOf(req), req.validated.body)),
};
