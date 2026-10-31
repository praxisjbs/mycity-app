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
const { parseChapter, filterChapter, passagesOf, passageFor } = require("@mycity/contract/guide");
const engine = require("@mycity/contract/guide-search");
const contract = require("@mycity/contract");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { AppError } = require("../../shared/errors");
const { atomically } = require("../../shared/db/tx");
const vault = require("../../shared/documents/vault");
const ai = require("../../services/ai/llm.service");
const governance = require("../../services/ai/governance");
const jobs = require("../../services/ai/jobs");
const transcription = require("../../services/ai/transcription");
const { GUIDE_VOICE } = require("./user_guide.events");
const catalog = require("../../shared/access/access.catalog");
const { readerOf } = require("../../shared/search/search.service");
const { pageOf, envelope, PAGE_SIZE } = require("../../shared/http/paged");
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

/**
 * Whether an action can be asked now for the guide: AI on, the Knowledge Hub's AI on, the cap not
 * reached, the stub not switched on, and a Ready model on the action's chain. The screen offers
 * Get Answer and the microphone only then.
 */
async function canAsk(db, action) {
  try {
    const g = await governance.check(db, { module: "knowledge" });
    if (g.settings.forced_stub) return false;
    return (await jobs.walk(action, { db })).length > 0;
  } catch (err) {
    if (err instanceof AppError) return false;
    throw err;
  }
}

/** The contents: every chapter this person may read, with its sections and tasks by title. */
async function contents(db, user, opts) {
  const mine = await guideFor(db, user, opts);
  const [answers, voice] = await Promise.all([canAsk(db, "guide-answer"), canAsk(db, "guide-voice")]);
  return {
    answers,
    voice,
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

/* ------------------------------------------------------------------ *
 * Search (§6.8)
 * ------------------------------------------------------------------ */

const indexes = new WeakMap();

/** The words index of a guide's chapters (every passage, the Quick Start aside), built once per load. */
function indexOf(guide) {
  let index = indexes.get(guide);
  if (!index) {
    index = engine.indexOf(guide.chapters.flatMap(passagesOf));
    indexes.set(guide, index);
  }
  return index;
}

/** Under this many letters a search is not run. */
const MIN_SEARCH = 2;
/** Passages an answer is written from: the best results, at most this many. */
const ANSWER_SOURCES = 6;
/** A source's lines sent to the model, at most. */
const SOURCE_LINES = 40;

/**
 * Every section and task this person may read that answers a search, best first: the words half
 * and the meaning half (user_guide.meaning.js) together. A failing meaning half costs only itself:
 * the words carry on alone.
 * @param {{q?: string}} query
 * @param {{meaning?: false|((index: object, visible: Map<number, object>, q: string) => Promise<Map<number, number>|null>),
 *          dir?: string, fresh?: boolean}} [opts]  meaning: false for the words alone; a function in
 *          place of the vectors (⌘K's prepared search, tests)
 */
async function hitsFor(db, user, query, opts = {}) {
  const q = String(query.q || "").replace(/\s+/g, " ").trim();
  const guide = load(opts);
  const index = indexOf(guide);
  const visible = engine.visibleTo(index, asReader(await guideReaderOf(db, user)), passageFor);
  if (q.length < MIN_SEARCH) return { q, index, visible, hits: [] };
  const near =
    opts.meaning === false
      ? null
      : opts.meaning || ((i, v, words) => require("./user_guide.meaning").similarities({ index: i, visible: v, q: words, user }));
  let meaning = null;
  if (near) {
    try {
      meaning = await near(index, visible, q);
    } catch (err) {
      logger.warn({ err: err.message }, "the User Guide's meaning search failed; its words answer alone");
    }
  }
  const hits = engine.search(index, q, { visible, meaning }).map(({ score, ...hit }) => hit);
  return { q, index, visible, hits };
}

/** POST /user-guide/search: a page of 25 of what answers a search. */
async function search(db, user, query, opts) {
  const { hits } = await hitsFor(db, user, query, opts);
  const { number, offset } = pageOf(query);
  return envelope(hits.slice(offset, offset + PAGE_SIZE), number, hits.length);
}

/** The answer's shape with its sources checked: a cited number is one of the passages sent. */
const cited = (n) =>
  contract.user_guide.GuideAnswerOutput.superRefine((v, ctx) => {
    v.sentences.forEach((s, i) => {
      if (s.sources.some((x) => x > n)) ctx.addIssue({ code: "custom", path: ["sentences", i, "sources"], message: `cite passages 1 to ${n} only` });
    });
    if (v.answered && !v.sentences.length) ctx.addIssue({ code: "custom", path: ["sentences"], message: "an answer has at least one sentence" });
  });

/**
 * POST /user-guide/answer: a short answer written by the Guide Answer action (Fast job) from the
 * best results this person may read, each sentence citing them (§6.9). Nothing is kept. With AI
 * off, or the passages silent on it, `found` is false and the results stand alone.
 */
async function answer(db, user, body, opts = {}) {
  const { q, index, visible, hits } = await hitsFor(db, user, { q: body.q }, opts);
  const sources = hits.slice(0, ANSWER_SOURCES);
  const none = { found: false, sentences: [], sources };
  if (!sources.length) return none;
  const passages = sources.map((h, i) => ({
    n: i + 1,
    chapter: h.chapter_title,
    title: h.kind === "task" ? `${h.section_title} › ${h.title}` : h.title,
    lines: engine.linesOf(index, h.anchor, visible).slice(0, SOURCE_LINES),
  }));
  let run;
  try {
    run = await ai.complete({
      purpose: "guide-answer",
      module: "knowledge",
      actor: user,
      input: { question: q, passages },
      output: cited(sources.length),
      egress: "reasoning",
      temperature: 0.1,
      maxTokens: 600,
      timeoutMs: 15_000,
    });
  } catch (err) {
    if (err instanceof AppError && /^AI_/.test(err.code)) return none;
    throw err;
  }
  if (run.vendor === "stub" || !run.output || !run.output.answered) return none;
  const sentences = run.output.sentences
    .map((s) => ({ text: s.text.trim(), sources: [...new Set(s.sources)].sort((a, b) => a - b) }))
    .filter((s) => s.text && s.sources.length);
  return { found: sentences.length > 0, sentences, sources };
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Remove one recording: its row in the transaction, its bytes after commit. */
async function removeRecording(documentId, actor) {
  const keys = await tx((client) => vault.remove(client, documentId, { actor, reason: "a spoken search's words were read" }));
  if (keys) await vault.removeFiles(keys);
}

/**
 * POST /user-guide/transcribe: a spoken search to words, on the Guide Voice Search action's chain
 * (Transcription job). The recording is removed whatever happens (§6.10).
 * @param {{buffer: Buffer, originalname: string}} file  readUpload(req)
 * @param {object} actor
 */
async function transcribe(file, actor) {
  const doc = await tx((client) =>
    vault.store(client, { file, purpose: "voice_note", doc_type: GUIDE_VOICE, entity: { type: GUIDE_VOICE, id: actor.user_id }, actor }),
  );
  try {
    const t = await transcription.transcribe({ document_id: doc.document_id, module: "knowledge", purpose: "guide-voice", actor, db: pool });
    return { document_id: doc.document_id, text: t.text, draft: t.draft };
  } finally {
    await removeRecording(doc.document_id, actor).catch((err) =>
      logger.warn({ err, document_id: doc.document_id }, "User Guide: a spoken search's recording was not removed; the vault's sweep will"),
    );
  }
}

module.exports = { MANUAL, IMAGES, load, asReader, guideReaderOf, cut, contents, chapter, quickStart, image, indexOf, hitsFor, search, answer, transcribe };
