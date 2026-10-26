"use strict";
/**
 * The User Guide (docs/guides/user-guide.md): the chapters of `docs/manual/`, each cut to its
 * reader on the server, down to the step, before it is sent (§6.3).
 *
 * The chapters are files shipped with each release, read once, at the first request after boot,
 * through the one parser (packages/contract/guide.js) the gate and the in-browser mock use too.
 * Who may read what is the shell's own answer (shared/search/screens.js tabVisible, the reader
 * ⌘K builds): a section about a tab is read by whoever may open the tab, and a part with `needs`
 * only by whoever holds every one of them. Nothing is cached per person, so a changed grant
 * reads at once.
 */
const fs = require("node:fs");
const path = require("node:path");
const { parseChapter, filterChapter } = require("@mycity/contract/guide");
const { logger } = require("../../config/logger");
const { AppError } = require("../../shared/errors");
const catalog = require("../../shared/access/access.catalog");
const { readerOf } = require("../../shared/search/search.service");
const { tabVisible } = require("../../shared/search/screens");
const { scopeFor } = require("../../middleware/rbac");

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
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort() : [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    if (!isChapter(text)) continue;
    const { chapter: parsed, problems } = parseChapter(text, file);
    if (problems.length) logger.warn({ file, problems: problems.slice(0, 5) }, "a User Guide chapter has problems");
    if (parsed.kind === "quick-start") quick = parsed;
    else chapters.push(parsed);
  }
  const rail = new Map(catalog.MODULES.map((m, i) => [m, i]));
  /* Chapters with no module first, by their own order (Getting Started is 0); then the rail's. */
  const key = (c) => (c.module && rail.has(c.module) ? 1000 + rail.get(c.module) : c.order ?? 999);
  chapters.sort((a, b) => key(a) - key(b) || a.title.localeCompare(b.title));
  const out = { chapters, quickStart: quick };
  if (dir === MANUAL) cached = out;
  return out;
}

/**
 * Whether this person may set work for someone else, as My Workspace decides it (GET /tasks/people:
 * their `workspace` create scope reaches another active person). The guide's `team` need.
 */
async function setsWorkForOthers(db, user) {
  const scope = await scopeFor(user, "workspace", "create");
  if (!scope) return false;
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM employee e
                     WHERE e.status = 'active' AND ($1::uuid IS NULL OR e.employee_id <> $1)
                       AND ($2::boolean OR e.employee_id = ANY($3::uuid[]))) AS reaches`,
    [scope.employee_id, scope.scope === "all", scope.scope === "all" ? [] : scope.scope_ids || []],
  );
  return Boolean(rows[0] && rows[0].reaches);
}

/** The reader ⌘K builds, with what only the guide asks: whether they set work for others. */
async function guideReaderOf(db, user) {
  return { ...(await readerOf(db, user)), sets_work_for_others: await setsWorkForOthers(db, user) };
}

/**
 * The reader as the filter asks it: which tabs the shell shows them, and which needs they hold.
 * @param {import("../../shared/search/screens").Reader & {sets_work_for_others?: boolean}} r
 */
function asReader(r) {
  const can = (module, action) => r.is_ceo === true || (r.grants[module] || []).includes(action);
  const holds = (need) => {
    if (need.kind === "grant") return can(need.module, need.action);
    /* A chapter's `cap` need, checked as hasCapability does; the user-guide gate holds each code to the catalogue. */
    if (need.kind === "cap") return r.is_ceo === true || (r.capabilities || []).includes(need.code);
    if (need.kind === "manager") return r.is_ceo === true || r.manages_people === true;
    if (need.kind === "team") return r.is_ceo === true || r.sets_work_for_others === true;
    if (need.kind === "ceo") return r.is_ceo === true;
    if (need.kind === "any") return need.of.some(holds);
    return false;
  };
  return { screen: (module, tab) => tabVisible({ module, tab }, r), holds };
}

/** Every chapter (and the Quick Start) cut to this reader, links to what they may not read made plain. */
function cut(guide, reader) {
  const first = guide.chapters.map((c) => filterChapter(c, reader)).filter(Boolean);
  const slugs = new Set(first.flatMap((c) => c.sections.flatMap((s) => [s.slug, ...s.tasks.map((t) => t.slug)])));
  const known = { slugs };
  return {
    chapters: guide.chapters.map((c) => filterChapter(c, reader, known)).filter(Boolean),
    quickStart: guide.quickStart ? filterChapter(guide.quickStart, reader, known) : null,
  };
}

/** What this person may read of the guide. */
async function guideFor(db, user, opts) {
  return cut(load(opts), asReader(await guideReaderOf(db, user)));
}

/** The contents: every chapter this person may read, with its sections and tasks by title. */
async function contents(db, user, opts) {
  const mine = await guideFor(db, user, opts);
  return {
    chapters: mine.chapters.map((c) => ({
      slug: c.slug,
      title: c.title,
      module: c.module,
      icon: c.icon,
      summary: c.summary,
      sections: c.sections.map((s) => ({
        slug: s.slug,
        title: s.title,
        screen: s.screen,
        tasks: s.tasks.map((t) => ({ slug: t.slug, title: t.title })),
      })),
    })),
    quick_start: mine.quickStart
      ? mine.quickStart.sections.map((s) => ({ slug: s.slug, title: s.title, role: s.role }))
      : [],
  };
}

/** One chapter as this person may read it; 404 when it does not exist or nothing in it is theirs. */
async function chapter(db, user, slug, opts) {
  const found = (await guideFor(db, user, opts)).chapters.find((c) => c.slug === slug);
  if (!found) throw new AppError("NOT_FOUND", "That part of the guide is not there.", 404);
  return found;
}

/** The Quick Start's cards this person may follow (none at all is an empty Quick Start). */
async function quickStart(db, user, opts) {
  const mine = await guideFor(db, user, opts);
  if (mine.quickStart) return mine.quickStart;
  return { slug: "quick-start", kind: "quick-start", title: "Quick Start", module: null, icon: null, summary: "", intro: [], sections: [], pictures: [] };
}

/**
 * A picture's file, when a part of the guide this person may read shows it on that device.
 * @returns {Promise<string>} the file's path on disk
 */
async function image(db, user, { chapter: slug, file }, opts = {}) {
  const [shot, device] = file.replace(/\.png$/, "").split(".");
  const mine = await guideFor(db, user, opts);
  const all = [...mine.chapters, ...(mine.quickStart ? [mine.quickStart] : [])];
  const owner = all.find((c) => c.slug === slug);
  const shown = owner && owner.pictures.some((p) => p.shot === shot && p.devices.includes(device));
  const full = path.join(opts.images || IMAGES, slug, file);
  if (!shown || !fs.existsSync(full)) throw new AppError("NOT_FOUND", "That picture is not there.", 404);
  return full;
}

module.exports = { MANUAL, IMAGES, load, asReader, guideReaderOf, cut, contents, chapter, quickStart, image };
