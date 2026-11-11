"use strict";
/**
 * Training's HTTP layer (docs/guides/knowledge.md §5): reads the request, calls the service, answers.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./training.service");
const lesson = require("./training.lesson");
const certificate = require("./training.certificate");

const id = (req) => req.validated.params.id;
const q = (req) => req.validated.query;
const body = (req) => req.validated.body;

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(q(req))),
  create: async (req, res) => created(res, await service.create(withActor(req), body(req))),
  get: async (req, res) => ok(res, await service.get(id(req))),
  update: async (req, res) => ok(res, await service.update(withActor(req), id(req), body(req))),
  addItem: async (req, res) => created(res, await service.addItem(withActor(req), id(req), body(req))),
  editItem: async (req, res) => ok(res, await service.editItem(withActor(req), id(req), body(req))),
  removeItem: async (req, res) => ok(res, await service.removeItem(withActor(req), id(req))),
  reorder: async (req, res) => ok(res, await service.reorder(withActor(req), id(req), body(req))),
  lessonWithAi: async (req, res) => ok(res, await lesson.suggest(withActor(req), body(req))),
  publish: async (req, res) => ok(res, await service.publish(withActor(req), id(req), body(req))),
  archive: async (req, res) => ok(res, await service.archive(withActor(req), id(req), body(req))),
  assign: async (req, res) => created(res, await service.assign(withActor(req), id(req), body(req))),
  assignments: async (req, res) => sendPaged(res, await service.assignments(id(req), q(req))),
  withdraw: async (req, res) => ok(res, await service.withdraw(withActor(req), id(req))),
  people: async (req, res) => sendPaged(res, await service.people(id(req), q(req))),
  remind: async (req, res) => ok(res, await service.remind(withActor(req), id(req))),
  certificate: async (req, res) => res.status(202).json(await certificate.forPlace(withActor(req), id(req))),

  mine: async (req, res) => sendPaged(res, await service.mine(req.user, q(req))),
  myCourse: async (req, res) => ok(res, await service.myCourse(req.user, id(req))),
  start: async (req, res) => ok(res, await service.start(withActor(req), id(req))),
  done: async (req, res) => ok(res, await service.done(withActor(req), id(req))),
  undone: async (req, res) => ok(res, await service.undone(withActor(req), id(req))),
  proof: async (req, res) => ok(res, await service.proof(withActor(req), id(req), body(req))),
  myCertificate: async (req, res) => res.status(202).json(await certificate.mine(req.user, id(req))),
};
