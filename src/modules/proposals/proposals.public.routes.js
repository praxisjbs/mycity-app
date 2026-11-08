"use strict";
/**
 * /api/public/v1/proposals: a proposal on go.mycityapp.io (docs/guides/partnerships.md §5, §6.10). No
 * sign-in, no permission: the link is the key (middleware/public-token.js). A declined, expired or
 * withdrawn proposal's link no longer works. Not to be indexed.
 *
 *   GET /:token        the proposal as designed, its owner's contact; a view recorded
 *   GET /:token/pdf    the PDF that was sent
 */
const express = require("express");
const c = require("@mycity/contract");
const { publicRoute } = require("../../http/route");
const { requirePublicToken } = require("../../middleware/public-token");
const { ok } = require("../../shared/http/respond");
const reader = require("./proposals.public");

const router = express.Router();
const link = requirePublicToken("proposal.view");
const noindex = (req, res, next) => {
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
};

publicRoute(router, "get", "/:token",
  { params: c.proposals.ProposalTokenParams, response: c.proposals.PublicProposal, summary: "A proposal's private link: the proposal as designed" },
  noindex, link, async (req, res) => ok(res, await reader.view(req.public_token, req.params.token, { ip: req.ip, userAgent: req.get("user-agent") })));

publicRoute(router, "get", "/:token/pdf",
  { params: c.proposals.ProposalTokenParams, no_content: true, summary: "A proposal's PDF, as sent" },
  noindex, link, async (req, res) => reader.pdf(req.public_token, req, res));

module.exports = { basePath: "/proposals", surface: "public", router };
