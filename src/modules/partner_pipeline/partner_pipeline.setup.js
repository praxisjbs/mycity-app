"use strict";
/**
 * Start From Tracker (docs/guides/partnerships.md §6.3, §6.13): MyCity's workbook already offers the
 * stages, partnership types and potential impacts its team picks from, in the dropdowns of its columns.
 * Reading them proposes the lists; the person corrects the stages' meanings and applies. Nothing is
 * seeded (A26) and nothing is overwritten: a value MyCity already has is left as it is.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const storage = require("../../services/storage/storage.service");
const { readDropdowns } = require("../../shared/spreadsheet/parse");
const repo = require("./partner_pipeline.repo");
const lists = require("./partner_pipeline.lists");
const { EVENTS } = require("./partner_pipeline.events");

/** The column a dropdown belongs to, by its header: "Partnership Stage", "Partnership Type", "Potential Impact". */
const KIND_OF = [
  [/\bcurrent\b/i, null],
  [/\bstage\b/i, "stages"],
  [/\b(partnership\s+)?type\b/i, "categories"],
  [/\bimpact\b/i, "impact"],
];
const kindOf = (header) => {
  for (const [re, kind] of KIND_OF) if (re.test(String(header || ""))) return kind;
  return null;
};

/** What a stage counts as, from its words; a stage the words do not place counts as the one before it. */
const MEANINGS = [
  [/\blost\b|\bdeclin|\bclosed\b|\bnot interested\b/i, "closed_lost"],
  [/\bon hold\b|\bpaused\b|\bhold\b/i, "on_hold"],
  [/\bsigned\b|\bsealed\b|\bsecured\b/i, "signed"],
  [/\bactive\b|\bongoing partnership\b/i, "active"],
  [/\bnegotiat|\bverbal\b|\bcontract review\b|\bcontract\b/i, "negotiation"],
  [/\bproposal\b|\bfollow[- ]?up\b/i, "proposal"],
  [/\bmeeting\b/i, "meeting"],
  [/\bcontact/i, "contacted"],
  [/\bprospect|\bidentified\b|\bidea\b|\bnew\b/i, "prospect"],
];

function suggestMeanings(labels) {
  let last = "prospect";
  return labels.map((label) => {
    const hit = MEANINGS.find(([re]) => re.test(label));
    last = hit ? hit[1] : last;
    return { label, meaning: last };
  });
}

/** "Ticketing (exclusive), 8% commission" is the category Ticketing (exclusive) and a commission of 8%. */
function categoryOf(label) {
  const m = /[,;]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%\s*commission\b/i.exec(label);
  const name = (m ? label.replace(m[0], "") : label).replace(/[\s,;]+$/, "").trim();
  return { name: name.slice(0, 80), default_commission_pct: m ? m[1] : undefined };
}

/** The distinct values, keeping the first spelling and the order the workbook offers them. */
const distinct = (items, key) => {
  const seen = new Set();
  return items.filter((i) => !seen.has(key(i).toLowerCase()) && key(i) && seen.add(key(i).toLowerCase()));
};

/** POST /setup/from-tracker: what the uploaded workbook's dropdowns hold, as lists to correct. */
async function read(actor, body) {
  const doc = await vault.get(pool, body.document_id);
  if (!doc || doc.uploaded_by !== actor.user_id)
    throw new AppError("NOT_FOUND", "That file does not exist", 404, { document_id: ["No such file"] });
  const dropdowns = await readDropdowns({ buffer: await storage.get(doc.storage_key) });
  const found = { stages: [], categories: [], impact: [] };
  for (const d of dropdowns) {
    const kind = kindOf(d.header);
    if (kind) found[kind].push(...d.values);
  }
  if (!found.stages.length && !found.categories.length && !found.impact.length)
    throw new AppError("TRACKER_NO_DROPDOWNS", "This workbook has no stage, type or impact dropdowns", 422, { document_id: ["No dropdowns found"] });
  const stages = suggestMeanings(distinct(found.stages, (v) => v).map((v) => v.slice(0, 80)));
  return {
    stages,
    categories: distinct(found.categories.map(categoryOf), (c) => c.name),
    impact: distinct(found.impact.map((label) => ({ label: label.slice(0, 80) })), (i) => i.label),
  };
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** POST /setup/from-tracker/apply: the lists as the person corrected them; what MyCity has stays as it is. */
async function apply(actor, body) {
  const result = await tx(async (client) => {
    const made = { stages: 0, categories: 0, impact: 0 };
    for (const s of body.stages) {
      if (await repo.valueByLabel(client, lists.STAGES, s.label)) continue;
      await repo.insertValue(client, lists.STAGES, {
        code: await lists.freeCode(client, lists.STAGES, s.label),
        label: s.label,
        position: await repo.nextValuePosition(client, lists.STAGES),
        meaning: s.meaning,
      });
      made.stages += 1;
    }
    await lists.assertStagesComplete(client);
    for (const i of body.impact) {
      if (await repo.valueByLabel(client, "partnership_impact", i.label)) continue;
      await repo.insertValue(client, "partnership_impact", {
        code: await lists.freeCode(client, "partnership_impact", i.label),
        label: i.label,
        position: await repo.nextValuePosition(client, "partnership_impact"),
      });
      made.impact += 1;
    }
    for (const c of body.categories) {
      if (await repo.categoryByName(client, c.name)) continue;
      await repo.insertCategory(client, { ...c, display_order: await repo.nextCategoryOrder(client) });
      made.categories += 1;
    }
    await emit(client, {
      key: EVENTS.PARTNERSHIP_SETUP_APPLIED,
      entity: { type: "partnership_setup", id: actor.user_id },
      actor,
      payload: made,
    });
    return made;
  });
  return result;
}

module.exports = { read, apply, suggestMeanings, categoryOf, kindOf };
