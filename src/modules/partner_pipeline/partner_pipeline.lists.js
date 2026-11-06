"use strict";
/**
 * MyCity's partnership lists (docs/guides/partnerships.md §4.3, §6.3), read: the stages with what
 * each counts as, potential impact, lead sources and document kinds, each a `reference_value`
 * domain of the same name. MyCity enters them on Categories or with Start From Tracker (A26:
 * nothing is seeded); the writes arrive with Categories (M7 PR 2).
 *
 * A stage's `meaning` is fixed (`prospect` ... `on_hold`), so stages may be renamed and reordered
 * without breaking a count. The rules every deal follows read them from here:
 *
 *   first stage        the first active stage in order: where a new deal opens
 *   firstOf(meaning)   the first active stage of a meaning: Close as Lost goes to the first
 *                      `closed_lost`, a conversion to the first `signed`
 *   lead status        read from its deal's stage, never typed (§6.4): New (`prospect`),
 *                      Contacted (`contacted`, `meeting`), Qualified (`proposal`, `negotiation`),
 *                      Lost (`closed_lost`), Converted (`signed`, `active`); On Hold keeps the
 *                      status the lead had
 */
const { completeQuery } = require("../../shared/http/paged");

/** The four lists, each a reference_value domain of its own name (contract ListName). */
const LISTS = Object.freeze(["partnership_stage", "partnership_impact", "lead_source", "partner_document_kind"]);

/** The meanings a signed deal counts as: entering one signs it (§6.4, §6.5). */
const SIGNED_MEANINGS = Object.freeze(["signed", "active"]);

/** A lead's status for each meaning; On Hold keeps the one it had. */
const LEAD_STATUS = Object.freeze({
  prospect: "new",
  contacted: "contacted",
  meeting: "contacted",
  proposal: "qualified",
  negotiation: "qualified",
  closed_lost: "lost",
  signed: "converted",
  active: "converted",
});

/** A lead's status once its deal is at a stage of `meaning`; `had` is kept for On Hold. */
const leadStatusOf = (meaning, had) => LEAD_STATUS[meaning] || had || "new";

const isSigned = (meaning) => SIGNED_MEANINGS.includes(meaning);

const ROW = `code::text AS code, label, NULLIF(metadata->>'meaning', '') AS meaning, display_order AS position, active`;

/**
 * One list, whole, in its order (a list is a handful of values every form needs at once).
 * @param {{query: Function}} db
 * @param {string} list  one of LISTS
 * @returns {Promise<{list: string, values: Array<{code: string, label: string, meaning: string|null, position: number, active: boolean}>}>}
 */
async function values(db, list) {
  // pagination:complete a list is a handful of values every form and filter needs at once (ListValues, at most 200)
  const { rows } = await completeQuery(
    db,
    `SELECT ${ROW} FROM reference_value WHERE domain = $1 ORDER BY display_order, label, code`,
    [list],
    { label: `the ${list} list`, ceiling: 200 },
  );
  return {
    list,
    values: rows.map((r) => ({ ...r, meaning: list === "partnership_stage" ? r.meaning || null : null })),
  };
}

/** MyCity's stages in order, retired ones included (a deal may sit at one), each with its meaning. */
async function stagesOf(db) {
  return (await values(db, "partnership_stage")).values;
}

/** The first active stage in order: where a new deal opens. Null while MyCity has none. */
const firstStage = (stages) => stages.find((s) => s.active && s.meaning) || null;

/** The first active stage of a meaning, or null. */
const firstOf = (stages, meaning) => stages.find((s) => s.active && s.meaning === meaning) || null;

/** A stage by its code, active or retired, or null. */
const stageOf = (stages, code) => stages.find((s) => s.code === String(code)) || null;

/** One label of one list by its code, or null (a list's label as a record shows it). */
async function labelOf(db, list, code) {
  if (!code) return null;
  const { rows } = await db.query("SELECT label FROM reference_value WHERE domain = $1 AND code = $2", [list, code]);
  return rows[0] ? rows[0].label : null;
}

/** Whether every code is an active value of the list. */
async function allActive(db, list, codes) {
  const wanted = [...new Set((codes || []).map(String))];
  if (!wanted.length) return true;
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM reference_value WHERE domain = $1 AND active AND code = ANY($2::citext[])",
    [list, wanted],
  );
  return rows[0].n === wanted.length;
}

/** A stage's code from its label or its code, as a person or Praxis AI writes it; null when none or several. */
async function stageCodeOf(db, words) {
  const w = String(words || "").trim().toLowerCase();
  if (!w) return null;
  const found = (await stagesOf(db)).filter((s) => s.active && (s.code.toLowerCase() === w || s.label.toLowerCase() === w));
  return found.length === 1 ? found[0].code : null;
}

/** The active stages' labels, in order (a card's choices). */
async function stageLabels(db) {
  return (await stagesOf(db)).filter((s) => s.active && s.meaning).map((s) => s.label);
}

module.exports = { stageCodeOf, stageLabels, LISTS, SIGNED_MEANINGS, LEAD_STATUS, leadStatusOf, isSigned, values, stagesOf, firstStage, firstOf, stageOf, labelOf, allActive };
