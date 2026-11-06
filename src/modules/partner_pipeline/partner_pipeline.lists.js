"use strict";
/**
 * MyCity's partnership lists, edited on Categories (docs/guides/partnerships.md §6.3): the pipeline's
 * stages, the potential impacts, the lead sources and the document kinds. They are data MyCity enters
 * (A26); only the deal health and interaction type code lists, which the code switches on, are seeded.
 *
 * A stage carries a meaning, the fixed code it counts as, so MyCity may rename its stages without
 * breaking a count. The list keeps at least one active stage meaning prospect, signed and closed_lost,
 * and the last stage of any meaning a deal is at cannot change meaning or retire.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const repo = require("./partner_pipeline.repo");
const { EVENTS } = require("./partner_pipeline.events");

const STAGES = "partnership_stage";

/** What the pipeline cannot do without: a start, a signing and a loss. */
const REQUIRED = Object.freeze({ prospect: "starts", signed: "signs", closed_lost: "loses" });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** `proposal_sent` from "Proposal Sent"; a letter first. */
function codeOf(label) {
  const base = String(label)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return /^[a-z]/.test(base) ? base : `v_${base || "value"}`;
}

async function freeCode(db, domain, label) {
  const base = codeOf(label);
  for (let n = 1; n < 100; n += 1) {
    const code = n === 1 ? base : `${base}_${n}`;
    if (!(await repo.codeTaken(db, domain, code))) return code;
  }
  throw new AppError("LIST_CODE", "Give it a different name", 409, { label: ["Name in use"] });
}

const shaped = (r) => ({ code: r.code, label: r.label, meaning: r.meaning || null, position: r.position, active: r.active });

async function values(list, db = pool) {
  return { list, values: (await repo.listValues(db, list)).map(shaped) };
}

function assertMeaning(list, meaning, { required }) {
  if (list === STAGES) {
    if (required && !meaning) throw new AppError("MEANING_REQUIRED", "Pick what it counts as", 422, { meaning: ["Pick what it counts as"] });
  } else if (meaning) {
    throw new AppError("MEANING_NOT_ALLOWED", "Only stages count as something", 422, { meaning: ["Stages only"] });
  }
}

async function assertUnusedLabel(db, list, label, exceptCode) {
  const same = await repo.valueByLabel(db, list, label);
  if (same && same.code !== exceptCode) throw new AppError("LABEL_TAKEN", "That name is taken", 409, { label: ["Name in use"] });
}

/** The last stage of a meaning cannot lose it while the pipeline needs it or a deal is at it. */
async function assertMeaningKept(db, row) {
  if (!row.active || !row.meaning) return;
  if ((await repo.stagesCounting(db, row.meaning, row.code)) > 0) return;
  if (REQUIRED[row.meaning])
    throw new AppError("STAGE_LAST_OF_MEANING", `Keep a stage that ${REQUIRED[row.meaning]} a deal`, 409, { meaning: ["Last of its kind"] });
  if (await repo.stageInUse(db, row.code))
    throw new AppError("STAGE_IN_USE", "A deal is at this stage", 409, { meaning: ["In use"] });
}

async function add(actor, list, body) {
  assertMeaning(list, body.meaning, { required: true });
  await tx(async (client) => {
    await assertUnusedLabel(client, list, body.label);
    const code = await freeCode(client, list, body.label);
    const position = body.position ?? (await repo.nextValuePosition(client, list));
    await repo.insertValue(client, list, { code, label: body.label, position, meaning: body.meaning });
    await emit(client, {
      key: EVENTS.LIST_VALUE_CREATED,
      entity: { type: "list_value", id: `${list}:${code}` },
      actor,
      after: shaped(await repo.getValue(client, list, code)),
      payload: { list, code },
    });
  });
  return values(list);
}

async function update(actor, list, code, body) {
  assertMeaning(list, body.meaning, { required: false });
  await tx(async (client) => {
    const before = await repo.getValue(client, list, code);
    if (!before) throw new AppError("NOT_FOUND", "That value does not exist", 404);
    if (body.label !== undefined) await assertUnusedLabel(client, list, body.label, code);
    if (list === STAGES) {
      const losing = (body.active === false && before.active) || (body.meaning !== undefined && body.meaning !== before.meaning);
      if (losing) await assertMeaningKept(client, before);
    }
    await repo.updateValue(client, list, code, body);
    await emit(client, {
      key: EVENTS.LIST_VALUE_UPDATED,
      entity: { type: "list_value", id: `${list}:${code}` },
      actor,
      before: shaped(before),
      after: shaped(await repo.getValue(client, list, code)),
      payload: { list, code },
    });
  });
  return values(list);
}

/** After a set of stages is added, the pipeline still needs a start, a signing and a loss. */
async function assertStagesComplete(db) {
  const missing = [];
  for (const meaning of Object.keys(REQUIRED)) if ((await repo.stagesCounting(db, meaning, "")) === 0) missing.push(meaning);
  if (missing.length)
    throw new AppError("STAGES_INCOMPLETE", `Add a stage that counts as ${missing.join(", ").replace("_", " ")}`, 422, {
      stages: ["Add the missing stages"],
    });
}

module.exports = { STAGES, REQUIRED, codeOf, freeCode, values, add, update, assertStagesComplete, assertUnusedLabel };
