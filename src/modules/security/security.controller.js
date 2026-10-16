"use strict";
// ai:none how a person signs in (keys, codes, passkeys, the PIN) is never material for the assistant
// search:none a person's passkeys and codes are found on their own My Security, not looked up
/**
 * Security's HTTP edge: the signed-in person's own two-step sign-in, passkeys and
 * PIN (My Security), and confirming it is them. Every call acts on the caller's own
 * login only; there is no parameter that names another person.
 */
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const service = require("./security.service");

const id = (req) => req.validated.params.id;
const userAgentOf = (req) => String(req.headers["user-agent"] || "").slice(0, 400);

module.exports = {
  methods: async (req, res) => ok(res, await service.methods(req.user)),
  confirmOptions: async (req, res) => ok(res, await service.confirmOptions(req.user)),
  confirm: async (req, res) => ok(res, await service.confirm(withActor(req), req.validated.body)),

  setUpTwoStep: async (req, res) => ok(res, await service.setUpTwoStep(withActor(req))),
  turnOnTwoStep: async (req, res) =>
    ok(res, await service.turnOnTwoStep(withActor(req), req.validated.body)),
  turnOffTwoStep: async (req, res) => ok(res, await service.turnOffTwoStep(withActor(req))),
  renewRecoveryCodes: async (req, res) => ok(res, await service.renewRecoveryCodes(withActor(req))),
  setFrequency: async (req, res) => ok(res, await service.setFrequency(withActor(req), req.validated.body)),

  listPasskeys: async (req, res) => sendPaged(res, await service.listPasskeys(req.user, req.validated.query)),
  passkeyOptions: async (req, res) => ok(res, await service.passkeyOptions(req.user)),
  addPasskey: async (req, res) =>
    created(res, await service.addPasskey(withActor(req), req.validated.body, { userAgent: userAgentOf(req) })),
  renamePasskey: async (req, res) =>
    ok(res, await service.renamePasskey(withActor(req), id(req), req.validated.body)),
  removePasskey: async (req, res) => ok(res, await service.removePasskey(withActor(req), id(req))),

  setPin: async (req, res) => ok(res, await service.setPin(withActor(req), req.validated.body)),
  removePin: async (req, res) => ok(res, await service.removePin(withActor(req))),
};
