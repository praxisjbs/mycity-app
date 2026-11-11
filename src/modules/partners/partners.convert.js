"use strict";
/**
 * Signing converts a lead into a partner (docs/guides/partnerships.md §3 step 6, §6.4): a transition
 * reachable from one state only, in the transaction of the stage move that signed its deal (a
 * completed signature, Record Signed Copy, a stage move with the signed copy, or Convert to Partner).
 *
 *   the partner     numbered; the lead's name, category, industry, region (its cities copied),
 *                   website, owner and custom values; `lead_id` kept; since today
 *   the deal        its `partner_id` set, its `lead_id` kept
 *   what moves      contacts, documents, interactions and linked mail (each by its own module);
 *                   the projects, tasks and events connected to the lead, through the Workspace
 *                   services (relinkIn, M7 PR 5); its agreements (agreements.service moveToPartnerIn)
 *   the signed copy among the partner's documents, on the deal
 *   the lead        Converted, with `converted_partner_id`, read only from then on
 *   events          partner.created, lead.converted (deal.signed is the stage move's)
 *
 * Converts once: the lead is locked, and a lead already converted answers its partner, so a second
 * press, a second tab or a repeated signature event changes nothing.
 */
const { emit } = require("../../shared/events/emit");
const places = require("../../shared/places/places");
const lagos = require("../../shared/time/lagos");
const { EVENTS } = require("./partners.events");
const { EVENTS: LEAD_EVENTS } = require("../leads/leads.events");
const service = require("./partners.service");
const documents = require("./partners.documents");

/** The cities a region holds at most (partners.service MAX_CITIES). */
const MAX_CITIES = 20;

/**
 * Convert the lead whose deal was just signed, in the caller's transaction.
 * @param {import("pg").PoolClient} client
 * @param {object} actor
 * @param {{lead_id: string, deal_id: string, signed_copy_document_id?: string|null}} opts
 * @returns {Promise<{partner_id: string, converted: boolean}>}
 */
async function convertIn(client, actor, { lead_id, deal_id, signed_copy_document_id = null }) {
  const { rows } = await client.query(
    `SELECT lead_id, number::text AS number, name, partner_category_id, industry, region_scope, website, owner_id, custom,
            status, converted_partner_id
       FROM lead WHERE lead_id = $1 FOR UPDATE`,
    [lead_id],
  );
  const lead = rows[0];
  if (lead.status === "converted") return { partner_id: lead.converted_partner_id, converted: false };

  const made = await service.insertIn(
    client,
    actor,
    {
      name: lead.name,
      partner_category_id: lead.partner_category_id,
      region_scope: lead.region_scope,
      industry: lead.industry,
      website: lead.website,
      owner_id: lead.owner_id,
      since: lagos.today(),
      custom: lead.custom || {},
      lead_id,
    },
    {},
  );
  const partnerId = made.partner_id;
  for (let i = 0; i < MAX_CITIES; i += 1) {
    await places.copy(client, { name: "lead.cities", key: `${lead_id}:${i}` }, { name: "partner.cities", key: `${partnerId}:${i}` });
  }
  await client.query("UPDATE partnership_opportunity SET partner_id = $2 WHERE lead_id = $1", [lead_id, partnerId]);
  await client.query("UPDATE partner_contact SET partner_id = $2, lead_id = NULL WHERE lead_id = $1", [lead_id, partnerId]);
  await documents.moveToPartner(client, lead_id, partnerId);
  await require("../interactions/interactions.service").moveToPartner(client, lead_id, partnerId);
  await require("../agreements/agreements.service").moveToPartnerIn(client, lead_id, partnerId);
  // Connect to Partner's links follow the lead (docs/guides/workspace.md §6), each through its own service.
  const moved = { lead_id, partner_id: partnerId };
  await require("../projects/projects.service").relinkIn(client, actor, moved);
  await require("../tasks/tasks.service").relinkIn(client, actor, moved);
  await require("../calendar/calendar.service").relinkIn(client, actor, moved);
  if (signed_copy_document_id) {
    await documents.attachIn(client, actor, {
      record: { kind: "partner", id: partnerId },
      deal_id,
      document_id: signed_copy_document_id,
      origin: "signed_copy",
      field: "signed_copy_document_id",
    });
  }
  await client.query("UPDATE lead SET status = 'converted', converted_partner_id = $2, converted_at = now() WHERE lead_id = $1", [lead_id, partnerId]);
  await service.syncStatus(client, actor, partnerId);
  await emit(client, {
    key: EVENTS.PARTNER_CREATED,
    entity: { type: "partner", id: partnerId },
    actor,
    after: { number: made.number, name: lead.name, owner_id: lead.owner_id, lead_id },
    payload: { partner_id: partnerId, number: made.number, lead_id, deal_id, owner_id: lead.owner_id },
  });
  await emit(client, {
    key: LEAD_EVENTS.LEAD_CONVERTED,
    entity: { type: "lead", id: lead_id },
    actor,
    before: { status: lead.status },
    after: { status: "converted", converted_partner_id: partnerId },
    payload: { lead_id, number: lead.number, name: lead.name, partner_id: partnerId, deal_id, owner_id: lead.owner_id },
  });
  return { partner_id: partnerId, converted: true };
}

module.exports = { convertIn };
