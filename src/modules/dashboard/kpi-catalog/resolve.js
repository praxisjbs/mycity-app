"use strict";
/**
 * Which cards a person's Overview shows, and what the card picker offers them. Pure: no
 * database, no clock, so the hardest rule in the feature is tested with plain values, and
 * the picker's preview and the painted row cannot disagree (both call selectCards).
 *
 * THE PRECEDENCE, stated once (docs/guides/home.md §6, Cards):
 *
 *   the person's own pick  >  their roles' cards  >  their Home view's defaults  >  none
 *
 *   own pick       home_kpi_pick. No row (null) means "follow my roles"; an empty list
 *                  means "I chose none", and is honoured: a person who removed every card
 *                  gets an empty row, not their roles' cards back.
 *   roles' cards   the role_kpi rows of their effective roles, highest rank first then by
 *                  name, each role's defaults joined in that order. Joining, not "the first
 *                  role wins each slot": the first role's cards lead and the next tops them
 *                  up, which needs no one to know which role is "first" for a slot.
 *   view defaults  HOME_VIEW_DEFAULTS[home_view], code, not a seed (A26).
 *
 * Two rules over whichever won:
 *   - Locked cards (every role's locked_ids, joined) lead, even against the person's own
 *     pick and an empty one: a role that fixes a card in place means it.
 *   - Only cards the person may see (eligibility.js), each once, the first four. A card that
 *     drops out shrinks the row; nothing is put in its place, so a person never learns the
 *     shape of what they cannot see from a substitute.
 */
const { MAX_CARDS, CATALOG, BY_ID, isPickable, cardOf, optionOf } = require("./index");

/**
 * The cards each Home view opens on when neither the person nor their roles chose. Each
 * lists a fifth or sixth so a card hidden until M2 does not leave a gap.
 */
const HOME_VIEW_DEFAULTS = Object.freeze({
  operations: Object.freeze([
    "attendance_today",
    "tasks_overdue",
    "expenses_pending",
    "partnerships_active",
    "headcount",
  ]),
  ceo: Object.freeze([
    "goals_on_track",
    "approvals_awaiting_you",
    "partnerships_signed_value",
    "alerts_high_open",
    "attendance_today",
  ]),
  partnerships: Object.freeze([
    "partnerships_active",
    "partnerships_signed_value",
    "partnerships_quiet_30d",
    "proposals_out",
  ]),
  staff: Object.freeze([
    "my_targets_on_track",
    "my_tasks_overdue",
    "my_reviews_due",
    "my_attendance_30d",
    "my_leave_left",
  ]),
});

/**
 * Ids that are strings, live, pickable and in `eligible`, each once, in their order. Total:
 * anything else (an id the catalogue no longer has, a hidden card, junk) is dropped, never
 * thrown on, since stored ids outlive the code that wrote them.
 * @param {unknown[]|null|undefined} ids
 * @param {Set<string>} eligible
 * @returns {string[]}
 */
function keepEligible(ids, eligible) {
  const seen = new Set();
  const out = [];
  for (const id of ids || []) {
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    if (isPickable(id) && eligible.has(id)) out.push(id);
  }
  return out;
}

/** Every role's locked cards, joined in role order, as the subject may see them. */
const lockedOf = (roleCards, eligible) => keepEligible(roleCards.flatMap((r) => r.locked_ids || []), eligible);

/**
 * The cards to show, and where they came from.
 * @param {{picks: string[]|null|undefined,
 *          roleCards?: Array<{default_ids: string[], locked_ids: string[]}>,
 *          homeView: string|null,
 *          eligible: Set<string>}} input
 *   picks      the person's home_kpi_pick ids; null or undefined when they have no row
 *   roleCards  role_kpi rows of their effective roles, highest rank first, then by name
 *   homeView   their Home view (/me home_view)
 *   eligible   the cards they may see (eligibility.forUser)
 * @returns {{source: "user"|"role"|"view", ids: string[]}}
 */
function selectCards({ picks, roleCards = [], homeView, eligible }) {
  const locked = lockedOf(roleCards, eligible);
  const lead = (ids) => [...locked, ...ids.filter((id) => !locked.includes(id))].slice(0, MAX_CARDS);

  if (Array.isArray(picks)) return { source: "user", ids: lead(keepEligible(picks, eligible)) };

  const fromRoles = keepEligible(roleCards.flatMap((r) => r.default_ids || []), eligible);
  if (fromRoles.length) return { source: "role", ids: lead(fromRoles) };

  return { source: "view", ids: lead(viewDefaults(homeView, eligible)) };
}

/**
 * A Home view's defaults as a subject may see them, at most four.
 * @param {string|null} homeView
 * @param {Set<string>} eligible
 */
function viewDefaults(homeView, eligible) {
  const ids = Object.prototype.hasOwnProperty.call(HOME_VIEW_DEFAULTS, homeView) ? HOME_VIEW_DEFAULTS[homeView] : [];
  return keepEligible(ids, eligible).slice(0, MAX_CARDS);
}

/**
 * The row the Overview paints: each selected card with its figure, in order. A card whose
 * figure could not be had (null) is left out and named in `hidden`; a zero is a figure and
 * is painted.
 * @param {string[]} ids  selectCards().ids
 * @param {Record<string, object|null>} figures  index.figuresFor()
 * @returns {{cards: object[], hidden: string[]}}  cards as HomeKpiCard
 */
function paintCards(ids, figures) {
  const cards = [];
  const hidden = [];
  for (const id of ids) {
    const figure = figures[id];
    if (figure === null || figure === undefined) hidden.push(id);
    else cards.push(cardOf(BY_ID.get(id), figure));
  }
  return { cards, hidden };
}

/**
 * What the card picker offers a person (HomeKpiPicker): every card they may choose, in the
 * catalogue's order; their own pick as it stands today (null when they follow their roles);
 * what they would see without one; the locked cards; and what shows now. A card they may
 * not see is not offered, greyed or counted.
 * @param {{picks: string[]|null|undefined, roleCards?: object[], homeView: string|null, eligible: Set<string>}} input
 */
function pickerModel({ picks, roleCards = [], homeView, eligible }) {
  const showing = selectCards({ picks, roleCards, homeView, eligible });
  const fallback = selectCards({ picks: null, roleCards, homeView, eligible });
  return {
    max: MAX_CARDS,
    cards: CATALOG.filter((e) => isPickable(e.id) && eligible.has(e.id)).map(optionOf),
    kpi_ids: Array.isArray(picks) ? keepEligible(picks, eligible).slice(0, MAX_CARDS) : null,
    default_ids: fallback.ids,
    locked_ids: lockedOf(roleCards, eligible).slice(0, MAX_CARDS),
    showing_ids: showing.ids,
    source: showing.source,
  };
}

/**
 * The checks on the defaults themselves: every id a catalogue card a person may pick.
 * @throws {Error} listing every problem
 */
function assertDefaultsSane() {
  const problems = [];
  for (const [view, ids] of Object.entries(HOME_VIEW_DEFAULTS)) {
    for (const id of ids) {
      const entry = BY_ID.get(id);
      if (!entry) problems.push(`${view}: "${id}" is not a card`);
      else if (!entry.pickable) problems.push(`${view}: "${id}" belongs to its tab and is never offered`);
    }
    if (new Set(ids).size !== ids.length) problems.push(`${view}: a card twice`);
  }
  if (problems.length) throw new Error(`kpi-catalog defaults:\n  ${problems.join("\n  ")}`);
}

assertDefaultsSane();

module.exports = {
  HOME_VIEW_DEFAULTS,
  keepEligible,
  selectCards,
  viewDefaults,
  paintCards,
  pickerModel,
  assertDefaultsSane,
};
