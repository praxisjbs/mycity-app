"use strict";
/**
 * The KPI catalogue's vocabulary, the check every card passes when it is required, and
 * the small helpers its cards share to shape the records behind them.
 *
 * One file says what a card is, because the catalogue's worst failure is two places
 * disagreeing about it: the picker offering a card the Overview then cannot draw, a role
 * saved with a card no code computes. Entries are checked, never trusted: index.js runs
 * assertEntry() on every card at require time, so a half-defined card stops the boot.
 *
 * WHY EVERY CARD NAMES A MODULE. A card is a figure over a module its reader can already
 * open. `module` is the access catalogue key whose `view` grant decides who may see the
 * card and over which records it counts (own, team or all): a card whose module the reader
 * cannot view does not exist for them, in the Overview or in the picker. A card never
 * grants access. `capability`, when set, is a further authority it needs (the Team cards
 * need `home.team`); `sensitive_field`, when set, is a field_visibility key that hides the
 * whole card from a reader it is masked for, rather than showing them a figure built from it.
 *
 * The shape of a card:
 *
 *   id               the key role_kpi and home_kpi_pick store; never changes once shipped
 *   domain           the picker's group: people, work, business, finance
 *   label            its title on the card and in the picker: Title Case, at most 4 words
 *   unit             count, money, pct, pair or days (guards.js says how each is shaped)
 *   module           the access catalogue key that gates it and sets its scope
 *   capability       null, or a CAPABILITY_CATALOG code it also needs
 *   sensitive_field  null, or a field-mask.js key that hides it when masked
 *   status           live (computed, offered) or hidden (declared with no query)
 *   until            hidden only: the milestone that makes it live ("M2")
 *   pickable         false for a card that only belongs to its tab (Team), never offered
 *   tone             null, or the tone the card takes when its figure is not zero
 *   source           where its figure is read: a built module, or a source adapter
 *                    (src/modules/dashboard/sources/<source>.source.js)
 *   value            live only: (client, guards, ctx) => figure, through the guards
 *   caption          optional: (figure) => a short line under the figure, at most 5 words
 *   detail           live only: the records behind it, served by GET /home/kpi/:key
 *     title          Title Case, at most 4 words
 *     summary        optional: (figure) => one line above the list, at most 20 words
 *     columns        1 to 8 of { key, label, numeric?, phone? }; the first is the record's
 *                    title on a phone card, and at most 2 others are marked `phone`
 *     groups         0 to 10 of { value, label }: the chips, counted from figure.groups
 *     list           (client, query, ctx) => a page of rows, 25 at most, through pageQuery
 *
 * The word limits are the screen copy rules' (scripts/check/lib/copy.js LIMITS, which the
 * build does not ship, so they are restated here; a test holds the two equal). Title Case
 * is checked by that test with the copy rules' own function.
 */
const c = require("@mycity/contract");
const catalog = require("../../../shared/access/access.catalog");
const fieldMask = require("../../../shared/rbac/field-mask");
const routeMap = require("../../../shared/route-map");

/** A row of cards holds four. A card that drops out shrinks the row; nothing is put in its place. */
const MAX_CARDS = c.dashboard.HOME_KPI_MAX;

/** The picker's groups, in the order it lists them. */
const DOMAINS = Object.freeze([...c.dashboard.HomeKpiDomain.options]);

/** How a card's figure is drawn: a count, a sum of Naira, a percentage, a part of a whole, days. */
const UNITS = Object.freeze([...c.dashboard.HomeKpiUnit.options]);

/** The tones a card may take: the screen's own (schemas/organisation.js Tone). */
const TONES = Object.freeze([...c.organisation.Tone.options]);

/** live: computed and offered. hidden: declared, with no query, never offered, until its milestone. */
const STATUSES = Object.freeze(["live", "hidden"]);

/** Modules already built whose own service or repo a card reads through (home.md §4.1). */
const BUILT_SOURCES = Object.freeze(["organisation", "attendance", "leave", "workflow", "documents", "alerts"]);

/**
 * The source adapters, one per owning module of a later milestone, each in
 * src/modules/dashboard/sources/<name>.source.js (a test holds this list to that folder).
 */
const ADAPTERS = Object.freeze([
  "tasks",
  "calendar",
  "goals",
  "reviews",
  "vacancies",
  "payroll",
  "partners",
  "expenses",
  "budgets",
]);

/** Word limits of the screen copy rules (scripts/check/lib/copy.js LIMITS). */
const WORDS = Object.freeze({
  title: 4, // a card's label, a list's title, a column's label (LIMITS.title)
  chip: 3, // a group's label, drawn as a chip (LIMITS.button)
  caption: 5, // the line under a figure (LIMITS.kpiCaption)
  sentence: 20, // the line above a list (LIMITS.sentence)
});

const MAX_COLUMNS = 8;
const MAX_GROUPS = 10;
const MAX_PHONE_COLUMNS = 2;

const ID = /^[a-z][a-z0-9_]{1,39}$/;
const KEY = /^[a-z][a-z0-9_]*$/;
const MILESTONE = /^M([2-9]|1[01])$/;
/** An em dash, an en dash, or a spaced double hyphen: never in copy a person reads. */
const DASH = /[\u2014\u2013]|(^|\s)--(\s|$)/;

/** Words that carry a letter; numbers and symbols are free, as the copy rules count them. */
const wordCount = (text) =>
  String(text)
    .trim()
    .split(/\s+/)
    .filter((t) => /\p{L}/u.test(t)).length;

const isFn = (f) => typeof f === "function";

/** What is wrong with one piece of copy: missing, too long, or carrying a dash. */
function copyProblems(where, text, max) {
  if (typeof text !== "string" || text.trim() === "") return [`${where} is missing`];
  const out = [];
  if (wordCount(text) > max) out.push(`${where} "${text}" is over ${max} words`);
  if (DASH.test(text)) out.push(`${where} "${text}" has a dash`);
  return out;
}

/** Problems with a live card's records: their title, columns, groups and list. */
function detailProblems(id, detail) {
  if (!detail || typeof detail !== "object") return [`${id}: a live card needs its detail (the records behind it)`];
  const out = copyProblems(`${id}: detail.title`, detail.title, WORDS.title);
  if (!isFn(detail.list)) out.push(`${id}: detail.list must be a function that reads one page`);
  if (detail.summary !== undefined && !isFn(detail.summary)) out.push(`${id}: detail.summary must be a function`);

  const columns = Array.isArray(detail.columns) ? detail.columns : [];
  if (columns.length < 1 || columns.length > MAX_COLUMNS)
    out.push(`${id}: detail.columns must hold 1 to ${MAX_COLUMNS} columns`);
  const keys = new Set();
  for (const col of columns) {
    if (!KEY.test(col.key || "")) out.push(`${id}: column key "${col.key}" must be snake_case`);
    if (keys.has(col.key)) out.push(`${id}: column "${col.key}" twice`);
    keys.add(col.key);
    out.push(...copyProblems(`${id}: column ${col.key}`, col.label, WORDS.title));
    for (const flag of ["numeric", "phone"])
      if (col[flag] !== undefined && typeof col[flag] !== "boolean")
        out.push(`${id}: column ${col.key}.${flag} must be true or false`);
  }
  if (columns.slice(1).filter((col) => col.phone).length > MAX_PHONE_COLUMNS)
    out.push(`${id}: at most ${MAX_PHONE_COLUMNS} columns besides the first show on a phone`);

  const groups = Array.isArray(detail.groups) ? detail.groups : null;
  if (!groups || groups.length > MAX_GROUPS) out.push(`${id}: detail.groups must be a list of at most ${MAX_GROUPS}`);
  const values = new Set();
  for (const g of groups || []) {
    if (!KEY.test(g.value || "")) out.push(`${id}: group "${g.value}" must be snake_case`);
    if (values.has(g.value)) out.push(`${id}: group "${g.value}" twice`);
    values.add(g.value);
    out.push(...copyProblems(`${id}: group ${g.value}`, g.label, WORDS.chip));
  }
  return out;
}

/**
 * Check one card. Loud beats defensive: every reader of the catalogue trusts these
 * fields, and a typo here renders as a blank card that reads like an outage.
 * @returns {object} the entry, frozen
 * @throws {Error} listing every problem with it
 */
function assertEntry(entry) {
  const id = entry && entry.id;
  const p = [];
  if (!ID.test(id || "")) p.push(`id "${id}" must match ${ID}`);
  if (!DOMAINS.includes(entry.domain)) p.push(`${id}: unknown domain "${entry.domain}"`);
  p.push(...copyProblems(`${id}: label`, entry.label, WORDS.title));
  if (!UNITS.includes(entry.unit)) p.push(`${id}: unknown unit "${entry.unit}"`);
  if (!catalog.isModule(entry.module)) p.push(`${id}: "${entry.module}" is not a module of the access catalogue`);
  if (entry.capability !== null && !catalog.isCapability(entry.capability))
    p.push(`${id}: capability "${entry.capability}" is not in CAPABILITY_CATALOG`);
  if (entry.sensitive_field !== null && !fieldMask.isFieldKey(entry.sensitive_field))
    p.push(`${id}: "${entry.sensitive_field}" is not a field-mask key`);
  if (!STATUSES.includes(entry.status)) p.push(`${id}: status must be live or hidden, got "${entry.status}"`);
  if (typeof entry.pickable !== "boolean") p.push(`${id}: pickable must be true or false`);
  if (entry.tone !== null && !TONES.includes(entry.tone)) p.push(`${id}: tone "${entry.tone}" is not a screen tone`);
  if (!BUILT_SOURCES.includes(entry.source) && !ADAPTERS.includes(entry.source))
    p.push(`${id}: source "${entry.source}" is neither a built module nor a source adapter`);
  if (entry.caption !== undefined && !isFn(entry.caption)) p.push(`${id}: caption must be a function`);

  if (entry.status === "live") {
    if (!isFn(entry.value)) p.push(`${id}: a live card needs value()`);
    if (entry.until !== undefined) p.push(`${id}: a live card has no "until"`);
    p.push(...detailProblems(id, entry.detail));
  } else if (entry.status === "hidden") {
    // Hidden means no query at all: its tables, or the rule it needs, do not exist yet.
    for (const key of ["value", "caption", "detail"])
      if (entry[key] !== undefined) p.push(`${id}: a hidden card has no ${key}; its milestone adds it`);
    if (!MILESTONE.test(entry.until || "")) p.push(`${id}: a hidden card names the milestone that makes it live`);
  }

  if (p.length) throw new Error(`kpi-catalog: bad card:\n  ${p.join("\n  ")}`);
  return Object.freeze(entry);
}

/* ------------------------------------------------------------------ *
 * The records behind a card: rows and cells (schemas/dashboard.js)
 * ------------------------------------------------------------------ */

/** A person as a cell wants them, from a row whose person was read with PERSON(). */
const PERSON = (e, d) =>
  `CASE WHEN ${e}.employee_id IS NULL THEN NULL ELSE json_build_object(
     'employee_id', ${e}.employee_id,
     'display_name', btrim(${e}.first_name || ' ' || ${e}.last_name),
     'job_title', ${e}.job_title,
     'department', ${d}.name) END`;

const iso = (at) => (at instanceof Date ? at.toISOString() : String(at));

/**
 * The typed cells a record's columns hold (HomeKpiCell), each null when it has no value.
 * Money is a cell only in Naira (shared/money holds Naira alone); an amount in another
 * currency is shown as written, its currency first, and is never added to a Naira sum.
 */
const cell = Object.freeze({
  text: (text) => (text === null || text === undefined || text === "" ? null : { kind: "text", text: String(text) }),
  person: (person) => (person ? { kind: "person", person } : null),
  pill: (tone, text) => ({ kind: "pill", tone, text }),
  date: (date) => (date ? { kind: "date", date } : null),
  time: (at) => (at ? { kind: "time", at: iso(at) } : null),
  number: (value) => (value === null || value === undefined ? null : { kind: "number", value: Number(value) }),
  money: (amount, currency) => {
    if (amount === null || amount === undefined) return null;
    if (currency === null || currency === undefined || currency === "NGN") return { kind: "money", amount };
    return { kind: "text", text: `${currency} ${amount}` };
  },
});

/** Where a record opens (shared/route-map.js), or null for one with no screen. */
const linkTo = (type, id, opts) => {
  const link = routeMap.linkFor(type, id, opts);
  return link ? link.path : null;
};

/** One record behind a card: its id, its cells and the path it opens, or null. */
const record = (id, cells, link = null) => ({ id: String(id), cells, link });

/** A page of rows turned into records, its page meta untouched. */
const records = (page, toRecord) => ({ data: page.data.map(toRecord), page: page.page });

/** "1 request", "3 requests". */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

module.exports = {
  MAX_CARDS,
  DOMAINS,
  UNITS,
  TONES,
  STATUSES,
  BUILT_SOURCES,
  ADAPTERS,
  WORDS,
  assertEntry,
  PERSON,
  cell,
  linkTo,
  record,
  records,
  plural,
};
