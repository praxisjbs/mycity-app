"use strict";
/**
 * Partnerships · Partners: the HTTP edge for partners, the Partner 360, contacts, documents and
 * duplicates, and the Work tab with Connect to Partner's pickers (docs/guides/partnerships.md §5,
 * §6.16). Scope comes from the `partnerships` grant (§6.1); the Work tab adds Workspace's own.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf } = require("../../shared/rbac/scope");
const { withActor } = require("../../shared/events/emit");
const service = require("./partners.service");
const documents = require("./partners.documents");
const dedup = require("./partners.dedup");
const work = require("./partners.work");

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
  work: async (req, res) => sendPaged(res, await work.list(req.validated.query, scopeOf(req), req.user)),
  workRecords: async (req, res) => sendPaged(res, await work.records(req.validated.query, scopeOf(req))),
  workDeals: async (req, res) => sendPaged(res, await work.deals(req.validated.query, scopeOf(req))),
};
