"use strict";
/**
 * /api/v1/security: the signed-in person's own two-step sign-in, passkeys and PIN
 * (ESS · My Security), and confirming it is them before a change.
 *
 * Every route is the caller's own (`self`): the service acts only on the signed-in
 * person's login, so no grant is involved and none could widen it (README §5.2). An
 * administrator's reset of someone else's two-step is Settings · Users
 * (users.routes.js), under the settings grant. Signing in with these is /auth
 * (identity.routes.js).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const limits = require("../../middleware/rate-limit");
const controller = require("./security.controller");

const router = express.Router();
const own = { self: true };

route(router, "get", "/",
  { response: c.security.SignInMethods, ...own, summary: "My two-step sign-in, passkeys and PIN" },
  controller.methods);

route(router, "post", "/confirm/options",
  { body: c.common.EmptyBody, response: c.security.PasskeyChallenge, ...own, summary: "Start confirming with a passkey" },
  limits.confirmLimiter, controller.confirmOptions);

route(router, "post", "/confirm",
  { body: c.security.Confirm, response: c.security.Confirmed, ...own, summary: "Confirm it is me before a change" },
  limits.confirmLimiter, controller.confirm);

route(router, "post", "/two-step/setup",
  { body: c.common.EmptyBody, response: c.security.TwoStepSetup, ...own, summary: "Start setting up two-step sign-in" },
  controller.setUpTwoStep);

route(router, "post", "/two-step",
  { body: c.security.TwoStepTurnOn, response: c.security.RecoveryCodes, ...own, summary: "Turn on two-step sign-in with the first code" },
  limits.confirmLimiter, controller.turnOnTwoStep);

route(router, "post", "/two-step/off",
  { body: c.common.EmptyBody, response: c.security.SignInMethods, ...own, summary: "Turn off two-step sign-in" },
  controller.turnOffTwoStep);

route(router, "post", "/two-step/recovery-codes",
  { body: c.common.EmptyBody, response: c.security.RecoveryCodes, ...own, summary: "New recovery codes" },
  controller.renewRecoveryCodes);

route(router, "post", "/two-step/frequency",
  { body: c.security.TwoStepFrequencySet, response: c.security.SignInMethods, ...own, summary: "How often two-step asks" },
  controller.setFrequency);

route(router, "get", "/passkeys",
  { query: c.common.PageQuery, response: c.security.PasskeyPage, ...own, summary: "My passkeys" },
  controller.listPasskeys);

route(router, "post", "/passkeys/options",
  { body: c.common.EmptyBody, response: c.security.PasskeyChallenge, ...own, summary: "Start adding a passkey" },
  controller.passkeyOptions);

route(router, "post", "/passkeys",
  { body: c.security.PasskeyAdd, response: c.security.Passkey, ...own, summary: "Add a passkey" },
  controller.addPasskey);

route(router, "post", "/passkeys/:id/rename",
  { body: c.security.PasskeyRename, response: c.security.Passkey, ...own, summary: "Rename a passkey" },
  controller.renamePasskey);

route(router, "post", "/passkeys/:id/remove",
  { body: c.common.EmptyBody, response: c.security.SignInMethods, ...own, summary: "Remove a passkey" },
  controller.removePasskey);

route(router, "post", "/pin",
  { body: c.security.PinSet, response: c.security.SignInMethods, ...own, summary: "Set or change my PIN" },
  controller.setPin);

route(router, "post", "/pin/remove",
  { body: c.common.EmptyBody, response: c.security.SignInMethods, ...own, summary: "Remove my PIN" },
  controller.removePin);

module.exports = { basePath: "/security", surface: "staff", router };
