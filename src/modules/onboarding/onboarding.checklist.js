"use strict";
/**
 * Documentation before onboarding (docs/guides/offers.md §3 steps 6 and 7, §6), and the Checklist
 * settings that the checklist is built from.
 *
 *   waitingOn(state)       what the documentation gate still waits on: `documents` (a required item
 *                          not verified), `guarantors` (fewer than two, or one not passed), `bvn`,
 *                          `contract` (not signed). Empty means the case may move to pre-onboarding.
 *   requirements(), createRequirement(), editRequirement()   the Checklist settings (`recruitment` edit)
 *
 * A requirement keeps its code once made; switching one off (active false) leaves it off the
 * checklists of cases opened after, and the cases already open keep their item. Whether an item is
 * required is read from its requirement as it stands.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const repo = require("./onboarding.repo");
const { EVENTS } = require("./onboarding.events");

/** The gate's conditions, in the order the case shows them. */
const CONDITIONS = Object.freeze(["documents", "guarantors", "bvn", "contract"]);

/**
 * @param {{items: Array<{required: boolean, status: string}>, guarantors: Array<{check_status: string}>,
 *          bvn_entered: boolean, contract_status: string|null}} state
 * @returns {string[]} the conditions not yet met, in CONDITIONS order
 */
function waitingOn({ items, guarantors, bvn_entered: bvnEntered, contract_status: contractStatus }) {
  const unmet = new Set();
  if ((items || []).some((i) => i.required && i.status !== "verified")) unmet.add("documents");
  const passed = (guarantors || []).filter((g) => g.check_status === "passed").length;
  if (passed < 2) unmet.add("guarantors");
  if (!bvnEntered) unmet.add("bvn");
  if (contractStatus !== "signed") unmet.add("contract");
  return CONDITIONS.filter((c) => unmet.has(c));
}

/* ------------------------------------------------------------------ *
 * The Checklist settings
 * ------------------------------------------------------------------ */

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** DocumentRequirement. */
const requirementOf = (r) => ({
  document_requirement_id: r.document_requirement_id,
  code: r.code,
  name: r.name,
  description: r.description || null,
  kind: r.kind,
  required: r.required,
  expires: r.expires,
  active: r.active,
  display_order: Number(r.display_order || 0),
});

async function requirements(query) {
  const page = await repo.requirements(pool, query);
  return { ...page, data: page.data.map(requirementOf) };
}

async function createRequirement(actor, body) {
  return tx(async (client) => {
    if (await repo.requirementByCode(client, body.code))
      throw new AppError("CODE_TAKEN", "Another requirement has this code", 409, { code: ["Already in use"] });
    const id = await repo.insertRequirement(client, body);
    const row = await repo.requirement(client, id);
    await emit(client, {
      key: EVENTS.ONBOARDING_REQUIREMENT_SAVED,
      entity: { type: "document_requirement", id },
      actor,
      after: requirementOf(row),
      payload: { document_requirement_id: id, code: row.code },
    });
    return requirementOf(row);
  });
}

async function editRequirement(actor, id, body) {
  return tx(async (client) => {
    const before = await repo.requirement(client, id);
    if (!before) throw new AppError("NOT_FOUND", "That requirement does not exist", 404);
    await repo.updateRequirement(client, id, body);
    const row = await repo.requirement(client, id);
    await emit(client, {
      key: EVENTS.ONBOARDING_REQUIREMENT_SAVED,
      entity: { type: "document_requirement", id },
      actor,
      before: requirementOf(before),
      after: requirementOf(row),
      payload: { document_requirement_id: id, code: row.code },
    });
    return requirementOf(row);
  });
}

module.exports = { CONDITIONS, waitingOn, requirementOf, requirements, createRequirement, editRequirement };
