"use strict";
/**
 * ⌘K: one term, every screen, action and record that answers for it, and only what
 * this person may open (MILESTONES §15: "⌘K finds every page, tab and record the user
 * may open, and nothing they may not"). `everything()` is GET /search; `search()` is the
 * records half, every module's provider.
 *
 * Screens and actions are catalogues (shared/search/screens.js, actions.js), matched in
 * memory against the name, the synonyms and the module, and shown when the shell would
 * show them to this person. Records are the providers below.
 *
 *   const r = await searchService.search(pool, req.user, { q: "ada", page: 1 });
 *   // → { q: "ada", hint: null, groups: [{ type, module, label, page, items: [...] }] }
 *
 * Who sees what. For every provider's module the service asks the question
 * requirePermission asks (`view`, middleware/rbac.scopeFor) BEFORE any provider runs.
 * A provider whose module the person cannot view is never queried, so its rows cannot
 * leak through a count, a timing or an error. Within a module the person's scope
 * applies (team, own) through the provider's scope column.
 *
 * Bounded. Each group is a page of 25 (`page` asks for the next one, with `types` to
 * stay in one group). The whole search runs under a 2-second statement timeout, and
 * each provider in its own savepoint: one that fails (a renamed column, no pg_trgm)
 * costs its own group, never the others.
 *
 * Type words. "staff ada" or "ada staff": a word a provider declares (`words`) at
 * either end narrows the search to that type and searches the rest. A term that is
 * only the word is a search for the page, which the app's own registry answers.
 *
 * Beyond recordProvider, a provider may answer an empty line (`empty: true`: what waits on
 * the reader), ask to come first (`pinned: true`), and read the reader themselves (`user`
 * is passed to its search), for a list that is the reader's own rather than a table's.
 */
const { logger } = require("../../config/logger");
const { atomically } = require("../db/tx");
const { pageOf, envelope, PAGE_SIZE } = require("../http/paged");
const catalog = require("../access/access.catalog");
const grantsCache = require("../rbac/grants-cache");
const routeMap = require("../route-map");
const registry = require("./registry");
const { SCREENS, tabVisible } = require("./screens");
const { ACTIONS, linkOf } = require("./actions");

const MIN_TERM = 2;
const MAX_TERM = 80;

const scopeFor = (...args) =>
  require("../../middleware/rbac").scopeFor(...args);

/** "staff ada" → { type: "employee", term: "ada" }, or null. */
function typeHint(term, providers) {
  const words = term.split(/\s+/);
  if (words.length < 2) return null;
  const byWord = new Map();
  for (const p of providers)
    for (const w of p.words) if (!byWord.has(w)) byWord.set(w, p.type);
  for (let n = Math.min(3, words.length - 1); n >= 1; n -= 1) {
    for (const [head, rest] of [
      [words.slice(0, n), words.slice(n)],
      [words.slice(-n), words.slice(0, -n)],
    ]) {
      const type = byWord.get(head.join(" ").toLowerCase());
      const remainder = rest.join(" ").trim();
      if (type && remainder.length >= MIN_TERM)
        return { type, term: remainder };
    }
  }
  return null;
}

async function trigramReady(c) {
  const { rows } = await c.query(
    `SELECT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                     WHERE e.extname = 'pg_trgm' AND n.nspname = ANY (current_schemas(true))) AS ok`,
  );
  return Boolean(rows[0] && rows[0].ok);
}

/**
 * @param {import("pg").Pool} db
 * @param {object} user   req.user
 * @param {{q: string, types?: string[]|null, page?: number}} query
 */
async function search(db, user, { q, types = null, page = 1 } = {}) {
  let term = String(q || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM);
  const all = registry.providers();
  let wanted = types && types.length ? new Set(types) : null;
  const hint = wanted ? null : typeHint(term, all);
  if (hint) {
    wanted = new Set([hint.type]);
    term = hint.term;
  }
  const out = { q: term, hint: hint ? hint.type : null, groups: [] };
  // Nothing typed: only the providers that answer an empty line (what waits on the reader).
  const blank = term === "";
  if (!blank && term.length < MIN_TERM) return out;
  const candidates = all.filter((p) => (!blank || p.empty === true) && (!wanted || wanted.has(p.type)));

  const scopes = new Map();
  for (const module of new Set(candidates.map((p) => p.module))) {
    const s = await scopeFor(user, module, "view");
    if (s) scopes.set(module, s);
  }
  const run = candidates.filter((p) => scopes.has(p.module));
  if (run.length === 0) return out;

  const client = await db.connect();
  try {
    await atomically(client, async () => {
      await client.query(
        "SELECT set_config('statement_timeout', '2000', true), set_config('pg_trgm.word_similarity_threshold', '0.4', true)",
      );
      const fuzzy = await trigramReady(client);
      for (const p of run) {
        await client.query("SAVEPOINT search_provider");
        try {
          const r = await p.search(client, {
            term,
            page,
            fuzzy,
            scope: scopes.get(p.module),
            user,
          });
          await client.query("RELEASE SAVEPOINT search_provider");
          if (r.items.length)
            out.groups.push({
              type: p.type,
              module: p.module,
              label: p.label,
              page: r.page,
              items: r.items,
            });
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT search_provider");
          logger.warn(
            { err, type: p.type },
            "search provider failed; its group is left out",
          );
        }
      }
    });
  } finally {
    client.release();
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Screens and actions: the staff app's own catalogues, answered in memory
 * ------------------------------------------------------------------ */

/** Lower case, accents off, "&" as "and", punctuation as spaces: "Roles & Permissions" → "roles and permissions". */
function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** One edit apart, or the same: a letter added, dropped or changed, or two letters swapped. */
function withinOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/**
 * Does a typed word (four letters or more) sit one slip from a word of the text, or from
 * its start? "payslp" finds Payslips, "organsation" Organisation, "aproval" Approvals.
 */
function nearWord(part, text) {
  if (part.length < 4) return false;
  return text
    .split(" ")
    .some((w) => withinOne(part, w) || withinOne(part, w.slice(0, part.length)) || withinOne(part, w.slice(0, part.length + 1)));
}

/**
 * How well an entry answers the term: 0 (not at all) to 5 (its name). Every word typed
 * must appear in the name, a synonym or the module's name; the name beats a synonym,
 * and a start beats a middle. A word one slip from those still counts, last of all.
 * @param {{title: string, words: readonly string[], context: string}} entry
 * @param {string} term  folded
 */
function rankOf(entry, term) {
  if (!term) return 1;
  const title = fold(entry.title);
  const words = entry.words.map(fold);
  const hay = [title, ...words, fold(entry.context)];
  const parts = term.split(" ");
  if (!parts.every((part) => hay.some((h) => h.includes(part)))) {
    return parts.every((part) => hay.some((h) => h.includes(part) || nearWord(part, h))) ? 0.5 : 0;
  }
  if (title === term) return 5;
  if (title.startsWith(term)) return 4;
  if (words.includes(term)) return 3;
  if (hay.some((h) => h.startsWith(term) || h.includes(` ${term}`))) return 2;
  return 1;
}

/** The matches of a catalogue, best first and then in catalogue order, one page of 25. */
function pageOfMatches(entries, term, page) {
  const ranked = entries
    .map((e, i) => ({ e, i, rank: rankOf(e, term) }))
    .filter((x) => x.rank > 0)
    .sort((x, y) => y.rank - x.rank || x.i - y.i);
  const { number, offset } = pageOf({ page });
  return envelope(
    ranked.slice(offset, offset + PAGE_SIZE).map((x) => x.e.hit),
    number,
    ranked.length,
  );
}

/**
 * What the shell would show this person: their actions per module (as /auth/me gives
 * them) and whether anyone reports to them.
 * @returns {Promise<{grants: Record<string, string[]>, is_ceo: boolean, manages_people: boolean}>}
 */
async function readerOf(db, user) {
  const grants = {};
  for (const module of catalog.MODULES) {
    if (user.is_ceo === true) {
      grants[module] = [...catalog.ACTIONS];
      continue;
    }
    const rows = await grantsCache.getGrants(db, { role_ids: user.role_ids || [], module });
    const actions = catalog.ACTIONS.filter((a) => rows.some((r) => r[`can_${a}`] === true));
    if (actions.length) grants[module] = actions;
  }
  let managesPeople = false;
  if (user.employee_id) {
    const { rows } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM employee r
                       WHERE r.line_manager_id = $1 AND r.status = 'active') AS manages`,
      [user.employee_id],
    );
    managesPeople = Boolean(rows[0] && rows[0].manages);
  }
  return { grants, is_ceo: user.is_ceo === true, manages_people: managesPeople };
}

const tabLabel = (module, tab) => {
  const found = SCREENS.find((x) => x.module === module && x.tab === tab);
  return found ? found.label : null;
};

/** The screens this reader may open, as catalogue entries carrying their result. */
function screenEntries(reader) {
  return SCREENS.filter((x) => tabVisible(x, reader)).map((x) => {
    const moduleLabel = catalog.MODULE_META[x.module].label;
    return {
      title: x.label,
      words: x.words,
      context: moduleLabel,
      hit: {
        id: `${x.module}.${x.tab}`,
        kind: "screen",
        type: "screen",
        title: x.label,
        sub: moduleLabel,
        ref: null,
        status: null,
        link: routeMap.screenPath(x.module, x.tab),
        run: null,
      },
    };
  });
}

/** The actions this reader may take, as catalogue entries carrying their result. */
function actionEntries(reader) {
  const can = ([module, action]) => (reader.grants[module] || []).includes(action);
  return ACTIONS.filter(
    (x) => (!x.need || can(x.need)) && (!x.module || tabVisible({ module: x.module, tab: x.tab }, reader)),
  ).map((x) => {
    const where = x.module ? tabLabel(x.module, x.tab) : null;
    return {
      title: x.label,
      words: x.words,
      context: where || "",
      hit: {
        id: x.key,
        kind: "action",
        type: "action",
        title: x.label,
        sub: where,
        ref: null,
        status: null,
        link: linkOf(x),
        run: x.run,
      },
    };
  });
}

/**
 * ⌘K: screens, actions and every module's records, each group a page of 25, only what
 * the reader may open. `type` keeps one group ("screen", "action" or a record type), to
 * page through it. A type word ("staff ada") narrows the records to that type.
 *
 *   await searchService.everything(pool, req.user, { q: "leave", page: 1 })
 *   // → { q: "leave", hint: null, groups: [{ kind: "screen", ... }, { kind: "action", ... }, ...] }
 *
 * @param {import("pg").Pool} db
 * @param {object} user  req.user
 * @param {{q?: string, type?: string, page?: number}} query
 */
async function everything(db, user, { q = "", type = null, page = 1 } = {}) {
  const line = String(q || "").replace(/\s+/g, " ").trim().slice(0, MAX_TERM);
  const records =
    type === "screen" || type === "action"
      ? { q: line, hint: null, groups: [] }
      : await search(db, user, { q: line, types: type ? [type] : null, page });
  const groups = [];
  // A provider marked pinned (what waits on the reader) comes before the screens.
  const pinned = new Set(registry.providers().filter((p) => p.pinned === true).map((p) => p.type));
  const recordGroup = (g) => ({
    kind: "record",
    type: g.type,
    label: g.label,
    module: g.module,
    page: g.page,
    items: g.items.map((item) => ({ ...item, title: item.title || item.ref || item.id, kind: "record", run: null })),
  });
  for (const g of records.groups) if (pinned.has(g.type)) groups.push(recordGroup(g));
  if (!type || type === "screen" || type === "action") {
    // The whole line: a type word narrows the records, never the screens and actions
    // ("staff sheet" is Import Staff as well as imports of a staff sheet).
    const reader = await readerOf(db, user);
    const term = fold(line);
    const kinds = [
      ["screen", "Screens", screenEntries],
      ["action", "Actions", actionEntries],
    ];
    for (const [kind, label, entries] of kinds) {
      if (type && type !== kind) continue;
      const result = pageOfMatches(entries(reader), term, page);
      if (result.data.length)
        groups.push({ kind, type: kind, label, module: null, page: result.page, items: result.data });
    }
  }
  for (const g of records.groups) if (!pinned.has(g.type)) groups.push(recordGroup(g));
  return { q: records.q, hint: records.hint, groups };
}

module.exports = { search, everything, readerOf, rankOf, fold, withinOne, nearWord, typeHint, trigramReady, MIN_TERM };
