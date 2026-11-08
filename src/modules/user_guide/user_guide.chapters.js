"use strict";
/**
 * The User Guide's chapters as read from `docs/manual/` (docs/guides/user-guide.md §6), and the one
 * chapter written for people outside MyCity, the public site's Help (§6.11).
 *
 * Kept apart from user_guide.service.js because the public route reads it: nothing here knows a staff
 * session or a grant (scripts/check/public-surface.js, README §7 rule 9). The service cuts these
 * chapters to each member of staff; the public chapter is read whole, by nobody signed in.
 */
const fs = require("node:fs");
const path = require("node:path");
const { parseChapter, filterChapter } = require("@mycity/contract/guide");
const { logger } = require("../../config/logger");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");

const MANUAL = path.resolve(__dirname, "../../../docs/manual");
const IMAGES = path.join(MANUAL, "img");

/** A chapter file: Markdown that opens with its front matter. Anything else is not in the guide yet. */
const isChapter = (text) => text.startsWith("---\n") || text.startsWith("---\r\n");

let cached = null;

/**
 * Every chapter and the Quick Start, parsed once. A chapter with problems is still served (the
 * gate keeps them out of a release) and logged.
 * @param {{dir?: string, fresh?: boolean}} [opts]  tests read their own folder, afresh
 */
function load({ dir = MANUAL, fresh = false } = {}) {
  if (cached && !fresh && dir === MANUAL) return cached;
  const chapters = [];
  let quick = null;
  let help = null;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort() : [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    if (!isChapter(text)) continue;
    const { chapter: parsed, problems } = parseChapter(text, file);
    if (problems.length) logger.warn({ file, problems: problems.slice(0, 5) }, "a User Guide chapter has problems");
    if (parsed.kind === "quick-start") quick = parsed;
    else if (parsed.kind === "public-help") help = parsed;
    else chapters.push(parsed);
  }
  const rail = new Map(catalog.MODULES.map((m, i) => [m, i]));
  /* Chapters with no module first, by their own order (Getting Started is 0); then the rail's. */
  const key = (c) => (c.module && rail.has(c.module) ? 1000 + rail.get(c.module) : c.order ?? 999);
  chapters.sort((a, b) => key(a) - key(b) || a.title.localeCompare(b.title));
  const out = { chapters, quickStart: quick, publicHelp: help };
  if (dir === MANUAL) cached = out;
  return out;
}

/* ------------------------------------------------------------------ *
 * The public site's Help page (§6.11)
 * ------------------------------------------------------------------ */

/** Nobody signed in: every section is read, nothing that needs a grant. */
const PUBLIC_READER = { screen: () => true, holds: () => false };

/**
 * The chapter for people outside MyCity (`kind: public-help`, docs/manual/public-site.md), as the
 * public site's Help page reads it. 404 while there is none.
 */
function publicHelp(opts) {
  const help = load(opts).publicHelp;
  const read = help ? filterChapter(help, PUBLIC_READER) : null;
  if (!read) throw new AppError("NOT_FOUND", "Help is not there.", 404);
  return read;
}

/**
 * A picture the Help page shows, by its file (`<shot>.<desktop|phone>.png`): only one its chapter
 * names, from that chapter's own folder.
 * @returns {string} the file's path on disk
 */
function publicImage(file, opts = {}) {
  const [shot, device] = file.replace(/\.png$/, "").split(".");
  const help = publicHelp(opts);
  const shown = help.pictures.some((p) => p.shot === shot && p.devices.includes(device));
  const full = path.join(opts.images || IMAGES, help.slug, file);
  if (!shown || !fs.existsSync(full)) throw new AppError("NOT_FOUND", "That picture is not there.", 404);
  return full;
}

module.exports = { MANUAL, IMAGES, isChapter, load, publicHelp, publicImage };
