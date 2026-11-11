"use strict";
/**
 * Interactions (docs/guides/partnerships.md §3 step 3, §6.12): Log Interaction records a call,
 * meeting, email, visit or note with a lead or a partner, and is contact: it ends a quiet spell.
 *
 *   when      never in the future (a minute's grace for a phone's clock)
 *   summary   10 characters or more (the contract's)
 *   deal      one of the record's own; contact, one of the record's own
 *   owner     the person who logs it
 *
 * A meeting yet to happen is a calendar event connected to the record (M7 PR 5); a linked mail
 * thread's messages are logged as `email` interactions by the mailbox binding (PR 8). On conversion
 * a lead's interactions and linked mail move to its partner (moveToPartner).
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const { EVENTS } = require("./interactions.events");
const repo = require("./interactions.repo");
const dealRepo = require("../partner_pipeline/partner_pipeline.repo");

/** How far ahead of the server's clock a phone may say "now". */
const GRACE_MS = 60 * 1000;

const invalid = (field, message) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [field]: [message] });

/** A page of interactions the reader may see (GET /interactions). */
const list = (query, scope) => repo.list(pool, query, scope);

/** A record's latest five interactions (the 360's Overview). */
async function latestOf(db, record) {
  return (await repo.latestOf(db, record)).data.slice(0, 5);
}

/** Log Interaction (POST /interactions), on a record the reader may see. */
async function create(actor, scope, body) {
  const record = body.partner_id ? { kind: "partner", id: body.partner_id } : { kind: "lead", id: body.lead_id };
  const at = new Date(body.occurred_at);
  if (at.getTime() > Date.now() + GRACE_MS) throw invalid("occurred_at", "Not in the future");
  const id = await require("../partner_pipeline/partner_pipeline.service").tx(async (client) => {
    const alias = record.kind === "partner" ? "p" : "l";
    const params = [record.id];
    const seen = dealRepo.recordSeen(scope, { alias, kind: record.kind }, params);
    const { rows } = await client.query(`SELECT ${alias}.status FROM ${record.kind} ${alias} WHERE ${alias}.${record.kind}_id = $1 ${seen}`, params);
    if (!rows[0]) throw invalid(`${record.kind}_id`, `No such ${record.kind}`);
    if (record.kind === "lead" && rows[0].status === "converted") throw invalid("lead_id", "Now a partner");
    if (body.deal_id) {
      const { rows: d } = await client.query(`SELECT 1 FROM partnership_opportunity WHERE partnership_opportunity_id = $1 AND ${record.kind}_id = $2`, [body.deal_id, record.id]);
      if (!d.length) throw invalid("deal_id", "Not this record's deal");
    }
    if (body.contact_id) {
      const { rows: c } = await client.query(`SELECT 1 FROM partner_contact WHERE partner_contact_id = $1 AND ${record.kind}_id = $2`, [body.contact_id, record.id]);
      if (!c.length) throw invalid("contact_id", "Not this record's contact");
    }
    const interactionId = await repo.insert(client, { ...body, occurred_at: at, owner_id: actor.employee_id || null });
    await emit(client, {
      key: EVENTS.INTERACTION_LOGGED,
      entity: { type: "partner_interaction", id: interactionId },
      actor,
      payload: { partner_interaction_id: interactionId, [`${record.kind}_id`]: record.id, deal_id: body.deal_id || null, interaction_type: body.interaction_type },
    });
    return interactionId;
  });
  return repo.get(pool, id);
}

/**
 * A linked thread's message logged as an email interaction on its record, in the caller's
 * transaction (§6.15; mailbox/binding/intake.service): once a message, owned by the mailbox's owner,
 * its subject and excerpt as the record's readers see them. It is contact (§6.12).
 * @returns {Promise<string|null>}  the interaction's id, or null when the message was logged already
 */
async function logMailIn(client, m) {
  const id = await repo.insertMail(client, m);
  if (!id) return null;
  await emit(client, {
    key: EVENTS.INTERACTION_LOGGED,
    entity: { type: "partner_interaction", id },
    actor: null,
    payload: { partner_interaction_id: id, partner_id: m.partner_id || null, lead_id: m.lead_id || null, deal_id: m.deal_id || null, interaction_type: "email", source: "mail" },
  });
  return id;
}

/** A lead's interactions and linked mail become its partner's (a conversion, §6.4, §6.15). */
async function moveToPartner(client, leadId, partnerId) {
  await client.query("UPDATE partner_interaction SET partner_id = $2, lead_id = NULL WHERE lead_id = $1", [leadId, partnerId]);
  await require("../mailbox/binding/convert.service").moveToPartnerIn(client, leadId, partnerId);
}

module.exports = { list, latestOf, create, logMailIn, moveToPartner, GRACE_MS };
