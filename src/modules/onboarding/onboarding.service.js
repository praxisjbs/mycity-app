"use strict";
/**
 * Onboarding (docs/guides/offers.md §3 steps 5 to 8): the hire's case, from the offer's acceptance
 * to their first day.
 *
 *   openCaseIn()        the acceptance transaction opens the case at documentation, its checklist one
 *                       item for each active document requirement (guide §3 step 5); the outbox then
 *                       mails the Upload Documents link (onboarding.events.js)
 *   requiredCount()     how many required items the checklist has: Send Offer is refused while there
 *                       are none, so no offer is accepted into an empty checklist (guide §11)
 *   caseForOffer()      the offer's case, once there is one
 *   list(), get()       Recruitment · Onboarding, within the reader's `recruitment` scope
 *   verifyItem(), rejectItem()    Operations & People check what the hire sent
 *   checkGuarantor()    a guarantor's reference check, Passed or Failed
 *   remind()            Send Reminder: a fresh Upload Documents link, every earlier one stopped
 *   checkGateIn()       the documentation gate (guide §3 step 7): every required item verified, both
 *                       guarantors passed, the BVN entered and the contract signed move the case to
 *                       pre_onboarding and the application with it. Asked after each of those changes,
 *                       the contract's signature included (contractSignedIn)
 *
 * The public upload page is onboarding.upload.js; the Checklist settings onboarding.checklist.js; the
 * Plans settings onboarding.plans.js. Onboarding itself (the start date, the plan's steps, Complete
 * Onboarding and the login invite) comes with the rest of the onboarding backend (PR 6b).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const organisation = require("../organisation/organisation.service");
const repo = require("./onboarding.repo");
const checklist = require("./onboarding.checklist");
const { EVENTS, ENTITY } = require("./onboarding.events");

const contracts = () => require("../employment_contracts/employment_contracts.service");
const candidates = () => require("../candidates/candidates.service");

const notFound = () => new AppError("NOT_FOUND", "That onboarding case does not exist", 404);
const refused = (code, message, status = 409, fields) => new AppError(code, message, status, fields);
const iso = (v) => (v ? new Date(v).toISOString() : null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A case is its owner's (the vacancy's hiring manager), as an offer and a contract are. */
const holds = (scope, row) =>
  Boolean(scope && (scope.scope === "all" || (row.owner_id && (scope.scope_ids || []).includes(row.owner_id))));

async function visible(db, id, scope, opts) {
  const row = await repo.get(db, id, opts);
  if (!row || !holds(scope, row)) throw notFound();
  return row;
}

/** What every event of a case carries: who it is for, and who to tell. */
const payload = (row, extra = {}) => ({
  onboarding_case_id: row.onboarding_case_id,
  application_id: row.application_id,
  employee_id: row.employee_id,
  employee_name: row.employee_name,
  owner_user_id: row.owner_user_id || null,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * Opened at acceptance
 * ------------------------------------------------------------------ */

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
    entity: { type: ENTITY, id: caseId },
    actor,
    payload: { ...payload(row), offer_id: offer.offer_id },
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

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** A stored file as the contract's DocumentRef. */
const docRef = (id, d) =>
  id
    ? { document_id: id, file_name: (d && d.original_name) || "document", size_bytes: Number((d && d.bytes) || 0), mime_type: (d && d.mime) || "application/octet-stream" }
    : null;

/** OnboardingItem. */
const itemOf = (i) => ({
  onboarding_checklist_item_id: i.onboarding_checklist_item_id,
  document_requirement_id: i.document_requirement_id || null,
  title: i.title,
  kind: i.kind,
  required: i.required,
  status: i.status,
  document: docRef(i.document_id, i),
  entered_value: i.entered_value || null,
  uploaded_at: iso(i.uploaded_at),
  verified_at: iso(i.verified_at),
  rejected_reason: i.rejected_reason || null,
  display_order: Number(i.display_order || 0),
});

/** Guarantor. */
const guarantorOf = (g) => ({
  onboarding_guarantor_id: g.onboarding_guarantor_id,
  position: Number(g.position),
  kind: g.kind,
  full_name: g.full_name,
  relationship: g.relationship,
  organisation: g.organisation || null,
  job_title: g.job_title || null,
  phone: g.phone,
  email: g.email || null,
  years_known: g.years_known === null || g.years_known === undefined ? null : Number(g.years_known),
  form: docRef(g.form_document_id, g),
  check_status: g.check_status,
  check_note: g.check_note || null,
  checked_at: iso(g.checked_at),
});

/** OnboardingRow. */
const rowOf = (r) => ({
  onboarding_case_id: r.onboarding_case_id,
  hire_name: r.hire_name || r.employee_name || "",
  job_title: r.job_title,
  department: r.department || null,
  status: r.status,
  starts_on: r.starts_on || null,
  items_outstanding: Number(r.items_outstanding || 0),
  created_at: iso(r.created_at),
});

/** Everything the gate reads, on the caller's connection. */
async function stateOf(db, row, user = null) {
  // One after another: inside a transaction they share one client.
  const items = await repo.items(db, row.onboarding_case_id);
  const guarantors = await repo.guarantors(db, row.onboarding_case_id);
  const bvnEntered = row.employee_id ? await organisation.hasBvn(db, row.employee_id) : false;
  const contract = await contracts().forCase(db, row.onboarding_case_id, user);
  const waiting = checklist.waitingOn({
    items,
    guarantors,
    bvn_entered: bvnEntered,
    contract_status: contract ? contract.status : null,
  });
  return { items, guarantors, bvnEntered, contract, waiting };
}

/** OnboardingDetail. */
async function detailOf(db, row, user) {
  const s = await stateOf(db, row, user);
  return {
    ...rowOf(row),
    application_id: row.application_id,
    offer_id: row.offer_id,
    employee_id: row.employee_id || null,
    owner_id: row.owner_id || null,
    privacy_acknowledged_at: iso(row.privacy_acknowledged_at),
    documentation_completed_at: iso(row.documentation_completed_at),
    completed_at: iso(row.completed_at),
    cancelled_at: iso(row.cancelled_at),
    end_reason: row.end_reason || null,
    items: s.items.map(itemOf),
    guarantors: s.guarantors.map(guarantorOf),
    bvn_entered: s.bvnEntered,
    contract: s.contract,
    waiting_on: s.waiting,
  };
}

async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  return { ...page, data: page.data.map(rowOf) };
}

async function get(id, user, scope) {
  return detailOf(pool, await visible(pool, id, scope), user);
}

/* ------------------------------------------------------------------ *
 * The documentation gate
 * ------------------------------------------------------------------ */

/**
 * Move the case to pre-onboarding when documentation is complete, in the caller's transaction. The
 * application follows to Pre-Onboarding (candidates.advanceIn); the case is what the gate answers to,
 * so an application already moved on its own does not hold it back. True when the case moved.
 */
async function checkGateIn(client, actor, caseId) {
  const row = await repo.get(client, caseId, { lock: true });
  if (!row || row.status !== "documentation") return false;
  const { waiting } = await stateOf(client, row);
  if (waiting.length > 0) return false;
  if (!(await repo.setStatus(client, caseId, ["documentation"], "pre_onboarding", { documentationCompleted: true }))) return false;
  await candidates().advanceIn(client, actor || { user_id: null }, row.application_id, "pre_onboarding");
  await emit(client, {
    key: EVENTS.ONBOARDING_DOCUMENTATION_COMPLETED,
    entity: { type: ENTITY, id: caseId },
    actor,
    payload: payload(row),
  });
  return true;
}

/** The hire signed their contract (employment_contracts' signedIn, in the signing transaction). */
async function contractSignedIn(client, actor, caseId) {
  return checkGateIn(client, actor, caseId);
}

/* ------------------------------------------------------------------ *
 * Operations & People check what the hire sent
 * ------------------------------------------------------------------ */

/** Only a case still at documentation takes checks; after that its documents are settled. */
function assertDocumentation(row) {
  if (row.status !== "documentation") throw refused("NOT_IN_DOCUMENTATION", "This case is past documentation");
}

async function verifyItem(actor, scope, id, itemId) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    assertDocumentation(row);
    const it = await repo.item(client, id, itemId, { lock: true });
    if (!it) throw refused("NOT_FOUND", "That item is not on this checklist", 404);
    if (it.status !== "uploaded") throw refused("NOT_UPLOADED", "Nothing waits to be verified here");
    if (it.document_id && it.scan_status === "pending") throw refused("SCAN_PENDING", "Wait for the virus scan to finish");
    if (it.document_id && it.scan_status === "infected") throw refused("FILE_INFECTED", "This file failed the virus scan; reject it");
    await repo.itemVerified(client, itemId, actor.user_id);
    await emit(client, {
      key: EVENTS.ONBOARDING_ITEM_VERIFIED,
      entity: { type: ENTITY, id },
      actor,
      payload: payload(row, { onboarding_checklist_item_id: itemId, title: it.title }),
    });
    await checkGateIn(client, actor, id);
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** Back to the hire with the reason, which their upload page shows beside the item. */
async function rejectItem(actor, scope, id, itemId, { reason }) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    assertDocumentation(row);
    const it = await repo.item(client, id, itemId, { lock: true });
    if (!it) throw refused("NOT_FOUND", "That item is not on this checklist", 404);
    if (!(await repo.itemRejected(client, itemId, reason))) throw refused("NOT_UPLOADED", "Nothing was sent for this item");
    await emit(client, {
      key: EVENTS.ONBOARDING_ITEM_REJECTED,
      entity: { type: ENTITY, id },
      actor,
      payload: payload(row, { onboarding_checklist_item_id: itemId, title: it.title }),
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** A guarantor's reference check, recorded Passed or Failed with a note. */
async function checkGuarantor(actor, scope, id, guarantorId, body) {
  return tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    assertDocumentation(row);
    const g = await repo.guarantor(client, id, guarantorId, { lock: true });
    if (!g) throw refused("NOT_FOUND", "That guarantor is not on this case", 404);
    await repo.recordCheck(client, guarantorId, body, actor.user_id);
    await emit(client, {
      key: EVENTS.ONBOARDING_GUARANTOR_CHECKED,
      entity: { type: ENTITY, id },
      actor,
      before: { check_status: g.check_status },
      after: { check_status: body.check_status },
      payload: payload(row, { onboarding_guarantor_id: guarantorId, check_status: body.check_status }),
    });
    await checkGateIn(client, actor, id);
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** Send Reminder: a fresh Upload Documents link to the hire, made after this check commits. */
async function remind(actor, scope, id) {
  await tx(async (client) => {
    const row = await visible(client, id, scope, { lock: true });
    assertDocumentation(row);
  });
  await require("./onboarding.upload").sendLink(id, actor.user_id || null, { reminder: true });
  return detailOf(pool, await repo.get(pool, id), actor);
}

module.exports = {
  openCaseIn,
  requiredCount,
  caseForOffer,
  list,
  get,
  detailOf,
  itemOf,
  guarantorOf,
  stateOf,
  checkGateIn,
  contractSignedIn,
  verifyItem,
  rejectItem,
  checkGuarantor,
  remind,
};
