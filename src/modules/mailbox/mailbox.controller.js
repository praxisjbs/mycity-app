"use strict";
// ai:none mail is private correspondence; nothing in M1 asks the assistant to read it (mailbox.md §9)
const { ok, created, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { readUpload } = require("../../middleware/upload");
const service = require("./mailbox.service");

const id = (req) => req.validated.params.id;

module.exports = {
  connection: async (req, res) => ok(res, await service.getConnection(req.user)),
  connect: async (req, res) => ok(res, await service.connect(req.validated.body, req.user)),
  sync: async (req, res) => ok(res, await service.requestSync(req.user)),
  disconnect: async (req, res) => ok(res, await service.disconnect(req.user)),
  threads: async (req, res) => sendPaged(res, await service.listThreads(req.user, req.validated.query)),
  thread: async (req, res) => ok(res, await service.getThread(id(req), req.user)),
  read: async (req, res) => {
    await service.markRead(id(req), req.user);
    noContent(res);
  },
  imageTrust: async (req, res) => {
    await service.setImageTrust(req.validated.body, req.user);
    noContent(res);
  },
  move: async (req, res) => {
    await service.move(id(req), req.validated.body.to, req.user);
    noContent(res);
  },
  empty: async (req, res) => ok(res, await service.emptyFolder(req.validated.params.kind, req.user)),
  draft: async (req, res) => ok(res, await service.getDraft(id(req), req.user)),
  saveDraft: async (req, res) => ok(res, await service.saveDraft(id(req), req.validated.body, req.user)),
  deleteDraft: async (req, res) => {
    await service.deleteDraft(id(req), req.user);
    noContent(res);
  },
  attach: async (req, res) => created(res, await service.storeAttachment(readUpload(req), req.user)),
  send: async (req, res) => created(res, await service.send(req.validated.body, req.user, req.get("Idempotency-Key"))),
  cancel: async (req, res) => ok(res, await service.cancel(id(req), req.user)),
};
