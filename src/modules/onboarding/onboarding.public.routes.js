"use strict";
/**
 * /api/public/v1/onboard: the hire's Upload Documents page on go.mycityapp.io (docs/guides/offers.md
 * §3 step 6, §5). No sign-in, no permission: the link is the key (middleware/public-token.js, scope
 * `onboarding.upload`, the case its subject) and every answer is the allow-listed UploadPack. Writes
 * are held to the public surface's write limit.
 *
 *   GET  /:token                       the checklist as the hire sees it, with the privacy notice
 *   POST /:token/privacy               accept the privacy notice (before anything else)
 *   POST /:token/files                 a file, at most 15 MB, on the hire's record and scanned
 *   POST /:token/items/:item_id        an item: the file sent, the typed value, or both
 *   POST /:token/guarantors            a guarantor entered or corrected
 *   POST /:token/bvn                   the BVN (eleven digits, kept masked); correctable until
 *                                      documentation completes
 *   POST /:token/address               the hire's home address, picked
 *   GET  /:token/places/search, /pin   the address search and a pinned point's name for the page's
 *                                      address fields (F27), signed as the staff app's are
 */
const express = require("express");
const c = require("@mycity/contract");
const { publicRoute } = require("../../http/route");
const { requirePublicToken } = require("../../middleware/public-token");
const upload = require("../../middleware/upload");
const { ok } = require("../../shared/http/respond");
const page = require("./onboarding.upload");
const maps = require("../maps/maps.controller");
const { SCOPE } = require("./onboarding.events");

const router = express.Router();
const o = c.onboarding;
const link = requirePublicToken(SCOPE);
const caseOf = (req) => req.public_token.subject_id;

publicRoute(router, "get", "/:token", { response: o.UploadPack, summary: "An Upload Documents link: the hire's checklist" },
  link, async (req, res) => ok(res, await page.pack(caseOf(req))));

publicRoute(router, "post", "/:token/privacy", { body: o.PrivacyAcknowledge, response: o.UploadPack, summary: "Accept the privacy notice" },
  link, async (req, res) => ok(res, await page.acknowledge(caseOf(req))));

publicRoute(router, "post", "/:token/files", { body: o.UploadFile, response: c.documents.DocumentRef, summary: "Send a document" },
  link, upload.single("file", { purpose: "document" }),
  async (req, res) => ok(res, await page.file(caseOf(req), upload.readUpload(req))));

publicRoute(router, "post", "/:token/items/:item_id", { params: o.UploadItemParams, body: o.UploadItem, response: o.UploadPack, summary: "Send a checklist item" },
  link, async (req, res) => ok(res, await page.item(caseOf(req), req.validated.params.item_id, req.validated.body)));

publicRoute(router, "post", "/:token/guarantors", { body: o.GuarantorInput, response: o.UploadPack, summary: "Enter a guarantor" },
  link, async (req, res) => ok(res, await page.guarantor(caseOf(req), req.validated.body)));

publicRoute(router, "post", "/:token/bvn", { body: o.BvnEnter, response: o.UploadPack, summary: "Enter the BVN" },
  link, async (req, res) => ok(res, await page.bvn(caseOf(req), req.validated.body)));

publicRoute(router, "post", "/:token/address", { body: o.HireAddressEnter, response: o.UploadPack, summary: "Enter the home address" },
  link, async (req, res) => ok(res, await page.address(caseOf(req), req.validated.body)));

// The page's address fields search and pin through our API, as the staff app's do (F27): the link is
// the key, and every place handed back is signed for the form that saves it.
publicRoute(router, "get", "/:token/places/search", { query: o.UploadPlaceSearchQuery, response: c.maps.PlaceMatches, summary: "Search an address" },
  link, async (req, res) => {
    req.validated.query = { q: req.validated.query.q, level: "address" };
    return maps.search(req, res);
  });

publicRoute(router, "get", "/:token/places/pin", { query: o.UploadPinQuery, response: c.maps.Place, summary: "Name a pinned point" },
  link, async (req, res) => {
    req.validated.query = { ...req.validated.query, level: "address" };
    return maps.pin(req, res);
  });

module.exports = { basePath: "/onboard", surface: "public", router };
