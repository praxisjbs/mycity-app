"use strict";
/**
 * Download Letterhead's Word file (docs/guides/document-centre.md §6.8), made in the worker: the
 * logo and the yellow rule in the header and the organisation's line in the footer, on every page,
 * over an empty page. Drawn from Settings · Organisation and the brand files at the press, through
 * the same reader the PDF letterhead uses (shared/documents/generate.js orgProfile), so the two never
 * differ. The PDF is the worker's PDF render of templates/documents/letterhead.html, empty.
 */
const { pool } = require("../../config/db");
const { buildDocx } = require("../../shared/documents/docx");
const exportFiles = require("../../shared/documents/exports");
const { orgProfile } = require("../../shared/documents/generate");
const organisation = require("../../shared/organisation/profile");
const grantsCache = require("../../shared/rbac/grants-cache");

/** The brand's yellow, the rule under the header (MILESTONES §5.1). */
const RULE = "FFDF55";
/** The logo's height in the header, CSS pixels. */
const LOGO_HEIGHT = 40;

/** The organisation's line, as the PDF letterhead's footer prints it. */
const footerOf = (org) => [org.name, org.rc, org.address, org.phone, org.email, org.website].filter(Boolean).join(" · ");

/** The Word letterhead's parts: the header's picture or name, and the footer's line. */
async function partsOf(db = pool) {
  const org = await orgProfile(db);
  const profile = await organisation.readProfile(db);
  const picture = await organisation.brandPicture(db, profile.logo_document_id, { height: LOGO_HEIGHT, scale: 4 });
  return {
    header: { picture: picture ? { buffer: picture.buffer, width: picture.width, height: picture.height } : null, text: org.display_name, rule: RULE },
    footer: footerOf(org),
    author: org.name,
  };
}

/**
 * letterhead.requested, in the worker: the file the request reserved, made. Someone no longer
 * active gets a failed file instead.
 */
async function buildWord(event, ctx) {
  const p = event.payload || {};
  if (!p.document_id) return;
  const asker = p.requested_by ? await grantsCache.getAuthUser(pool, p.requested_by) : null;
  if (!asker || asker.status !== "active") return exportFiles.fail(p.document_id, "Only an active member of staff may have this file.");
  await exportFiles.make(p.document_id, ctx, async () => {
    const parts = await partsOf();
    return buildDocx({ title: "", body: "", author: parts.author, header: parts.header, footer: parts.footer });
  });
}

module.exports = { buildWord, partsOf, footerOf, RULE };
