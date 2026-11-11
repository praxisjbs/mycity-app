"use strict";
/**
 * Onboarding (docs/guides/offers.md §3 steps 5 to 8): the hire's case, from the offer's acceptance
 * to their first day.
 *
 *   openCaseIn()      the acceptance transaction opens the case at documentation, its checklist one
 *                     item for each active document requirement (guide §3 step 5)
 *   requiredCount()   how many required items the checklist has: Send Offer is refused while there
 *                     are none, so no offer is accepted into an empty checklist (guide §11)
 *   caseForOffer()    the offer's case, once there is one
 *
 * The uploads, the verifications, the guarantors, the documentation gate, the plans and Complete
 * Onboarding come with the onboarding backend (PR 6).
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const repo = require("./onboarding.repo");
const { EVENTS } = require("./onboarding.events");

const SUBJECT = "onboarding";

/**
 * Open the hire's case, in the acceptance transaction (offers.acceptedIn). Opened once an offer:
 * a hook that runs twice finds the case and leaves it alone.
 *
 * @param {object} client  the acceptance transaction
 * @param {{user_id: string|null}|null} actor
 * @param {{offer: object, employee: object}} input
 * @returns {Promise<object>} the case row
 */
async function openCaseIn(client, actor, { offer, employee }) {
  const existing = await repo.byOffer(client, offer.offer_id);
  if (existing) return existing;
  const caseId = await repo.insertCase(client, {
    application_id: offer.application_id,
    offer_id: offer.offer_id,
    employee_id: employee.employee_id,
    owner_id: offer.hiring_manager_id || null,
    starts_on: offer.start_date || null,
  });
  await repo.insertItems(client, caseId, await repo.activeRequirements(client));
  const row = await repo.get(client, caseId);
  await emit(client, {
    key: EVENTS.ONBOARDING_OPENED,
    entity: { type: SUBJECT, id: caseId },
    actor,
    payload: {
      onboarding_case_id: caseId,
      application_id: offer.application_id,
      offer_id: offer.offer_id,
      employee_id: employee.employee_id,
      employee_name: row.employee_name,
      owner_user_id: row.owner_user_id || null,
    },
  });
  return row;
}

/** How many required checklist items the Checklist settings hold. */
async function requiredCount(db = pool) {
  return repo.requiredCount(db);
}

async function caseForOffer(db, offerId) {
  return repo.byOffer(db, offerId);
}

module.exports = { openCaseIn, requiredCount, caseForOffer };
