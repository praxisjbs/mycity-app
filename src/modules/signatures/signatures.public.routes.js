"use strict";
/**
 * The public signing and verification pages' API on go.mycityapp.io (docs/guides/offers.md §5;
 * docs/guides/partnerships.md §6.9). No sign-in, no permission: a signing link's token is the only
 * key (middleware/public-token.js), a reference reveals no content, and a QR's key opens one sealed
 * copy. Writes are held to the public surface's write limit.
 *
 *   GET  /sign/:token                 the document as its PDF reads, the signers, where signing stands
 *   POST /sign/:token/code            email a six-digit code to the address the link was sent to
 *   POST /sign/:token/code/verify     enter it
 *   POST /sign/:token/sign            Accept and Sign: full name, title, drawn or typed, consent
 *   POST /sign/:token/decline         Decline, with the reason
 *   GET  /sign/:token/document        the PDF: the sealed copy once there is one
 *   GET  /verify/:ref                 status, signers and the two verdicts; no content
 *   GET  /verify/t/:token             the same, and the document, from the sealed copy's QR
 *   GET  /verify/t/:token/document    the sealed copy
 */
const express = require("express");
const c = require("@mycity/contract");
const { publicRoute } = require("../../http/route");
const { requirePublicToken } = require("../../middleware/public-token");
const vault = require("../../shared/documents/vault");
const { ok } = require("../../shared/http/respond");
const service = require("./signatures.service");
const verify = require("./signatures.verify");

const router = express.Router();
const k = c.signatures;
const byToken = { params: k.SignTokenParams };
const meta = (req) => ({ ip: req.ip, user_agent: String(req.headers["user-agent"] || "").slice(0, 400) });

publicRoute(router, "get", "/sign/:token",
  { ...byToken, response: k.SigningView, summary: "A signing link: the document and where signing stands" },
  requirePublicToken(service.SCOPE),
  async (req, res) => ok(res, await service.view(req.public_token)));

publicRoute(router, "post", "/sign/:token/code",
  { ...byToken, body: c.common.EmptyBody, response: k.SignCodeSent, summary: "Email a signing code" },
  requirePublicToken(service.SCOPE),
  async (req, res) => ok(res, await service.sendCode(req.public_token)));

publicRoute(router, "post", "/sign/:token/code/verify",
  { ...byToken, body: k.SignCodeVerify, response: k.SigningView, summary: "Enter the signing code" },
  requirePublicToken(service.SCOPE),
  async (req, res) => ok(res, await service.verifyCode(req.public_token, req.validated.body.code)));

publicRoute(router, "post", "/sign/:token/sign",
  { ...byToken, body: k.SignSubmit, response: k.SigningView, summary: "Sign a document" },
  requirePublicToken(service.SCOPE),
  async (req, res) => ok(res, await service.sign(req.public_token, req.validated.body, meta(req))));

publicRoute(router, "post", "/sign/:token/decline",
  { ...byToken, body: k.SignDecline, response: k.SigningView, summary: "Decline to sign a document" },
  requirePublicToken(service.SCOPE),
  async (req, res) => ok(res, await service.decline(req.public_token, req.validated.body.reason)));

publicRoute(router, "get", "/sign/:token/document",
  { ...byToken, no_content: true, summary: "The document to sign, or its sealed copy" },
  requirePublicToken(service.SCOPE),
  async (req, res) => vault.serve(req, res, await service.documentFor(req.public_token), { inline: true }));

publicRoute(router, "get", "/verify/:ref",
  { params: k.VerifyRefParams, response: k.VerifyResult, summary: "Verify a signed document by its reference" },
  async (req, res) => ok(res, await verify.byReference(req.validated.params.ref)));

publicRoute(router, "get", "/verify/t/:token",
  { ...byToken, response: k.VerifyByToken, summary: "Verify a signed document from its QR" },
  async (req, res) => ok(res, await verify.byKey(req.validated.params.token)));

publicRoute(router, "get", "/verify/t/:token/document",
  { ...byToken, no_content: true, summary: "A sealed copy, from its QR" },
  async (req, res) => vault.serve(req, res, await verify.sealedDocument(req.validated.params.token), { inline: true }));

module.exports = { basePath: "/", surface: "public", router };
