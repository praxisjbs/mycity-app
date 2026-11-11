"use strict";
/**
 * A linked thread follows its lead when the lead becomes a partner (docs/guides/partnerships.md §6.4,
 * §6.15): in the conversion's transaction, the thread's link moves to the partner and its messages
 * go on being logged there. The interactions already logged move with the lead's own
 * (interactions.service moveToPartner, which calls this).
 */

/**
 * @param {import("pg").PoolClient} client  the conversion's transaction
 * @param {string} leadId
 * @param {string} partnerId
 */
async function moveToPartnerIn(client, leadId, partnerId) {
  await client.query("UPDATE partner_mail_thread SET partner_id = $2, lead_id = NULL WHERE lead_id = $1", [leadId, partnerId]);
}

module.exports = { moveToPartnerIn };
