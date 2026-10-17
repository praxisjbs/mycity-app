"use strict";
const { ok, created, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { readUpload } = require("../../middleware/upload");
const service = require("./community.service");

const p = (req) => req.validated.params;

module.exports = {
  listChannels: async (req, res) => sendPaged(res, await service.listChannels(req.user, req.validated.query)),
  getChannel: async (req, res) => ok(res, await service.getChannel(p(req).id, req.user)),
  createChannel: async (req, res) => created(res, await service.createChannel(req.validated.body, req.user)),
  listMembers: async (req, res) => sendPaged(res, await service.listMembers(p(req).id, req.user, req.validated.query)),
  addMembers: async (req, res) => ok(res, await service.addMembers(p(req).id, req.validated.body, req.user)),
  removeMember: async (req, res) => {
    await service.removeMember(p(req).id, p(req).user_id, req.user);
    noContent(res);
  },
  mute: async (req, res) => {
    await service.setMuted(p(req).id, req.validated.body.muted, req.user);
    noContent(res);
  },
  read: async (req, res) => {
    await service.markRead(p(req).id, req.user);
    noContent(res);
  },
  delivered: async (req, res) => {
    await service.markDelivered(p(req).id, req.validated.body.up_to, req.user);
    noContent(res);
  },
  listMessages: async (req, res) => sendPaged(res, await service.listMessages(p(req).id, req.user, req.validated.query)),
  postMessage: async (req, res) => created(res, await service.postMessage(p(req).id, req.validated.body, req.user)),
  uploadMedia: async (req, res) => created(res, await service.storeMedia(p(req).id, readUpload(req), req.user)),
  recognise: async (req, res) => created(res, await service.recognise(req.validated.body, req.user)),
  react: async (req, res) => ok(res, await service.react(p(req).id, req.user)),
  vote: async (req, res) => ok(res, await service.vote(p(req).id, req.validated.body.option_index, req.user)),
  transcript: async (req, res) => ok(res, await service.transcript(p(req).id, req.user)),
  listConversations: async (req, res) => sendPaged(res, await service.listConversations(req.user, req.validated.query)),
  openDirect: async (req, res) => ok(res, await service.openDirect(req.validated.body.employee_id, req.user)),
  listColleagues: async (req, res) => sendPaged(res, await service.listColleagues(req.validated.query)),
  profileCard: async (req, res) => ok(res, await service.profileCard(p(req).id, req.user)),
};
