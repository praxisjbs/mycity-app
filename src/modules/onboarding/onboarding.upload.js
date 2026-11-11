"use strict";
/**
 * The hire's Upload Documents page on go.mycityapp.io/onboard/<token> (docs/guides/offers.md §3
 * step 6, §5): the checklist as the hire sees it, the privacy notice to accept first, each item sent,
 * the two guarantors and the BVN. No sign-in: the link is the key (scope `onboarding.upload`, the
 * case its subject), and every answer is an allow-listed shape (UploadPack).
 *
 *   pack()                  what the page shows
 *   acknowledge()           the privacy notice, accepted before anything is sent
 *   file()                  a file, stored on the hire's employee record and scanned (a stranger's
 *                           upload); named next on an item or as a guarantor's form
 *   item()                  an item: the file, the typed value or both, as its requirement asks
 *   guarantor()             a guarantor entered or corrected; a correction waits for its check again
 *   bvn()                   the BVN, kept masked on the employee record (organisation.setBvnIn)
 *   sendLink(), stopLinks() the link, made from the outbox when the case opens and on Send Reminder,
 *                           mailed as `onboarding-documents`; stopped on Not Progressing
 *
 * Only a case at documentation takes anything. The link is never kept: only its hash is, and it is
 * made in a transaction of its own and handed straight to the mail queue.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const vault = require("../../shared/documents/vault");
const profile = require("../../shared/organisation/profile");
const publicToken = require("../../shared/tokens/public-token");
const lagos = require("../../shared/time/lagos");
const organisation = require("../organisation/organisation.service");
const repo = require("./onboarding.repo");
const service = require("./onboarding.service");
const { EVENTS, ENTITY, SCOPE, SUBJECT, EMAILS } = require("./onboarding.events");

/** The employee document type a hire's files are kept under (documents module, People 360). */
const DOC_TYPE = "employee_document";

const notFound = () => new AppError("NOT_FOUND", "This link is not valid or has expired", 404);
const refused = (code, message, status = 409, fields) => new AppError(code, message, status, fields);
const origin = () => String(config.PUBLIC_ORIGIN).replace(/\/+$/, "");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/**
 * The privacy notice the hire accepts before sending anything, one sentence a line. Plain and
 * short; Operations & People may have it reworded (offers.md §13).
 */
function privacyNotice(company) {
  return [
    `${company} asks for these documents and details to complete your employment.`,
    "We use them to confirm who you are, your qualifications and your references, and to set up your pay.",
    "Only Operations & People and the people managing your onboarding can open them.",
    "Your BVN is kept masked on your employee record and used only for your salary account.",
    "Everything you send stays on your employee record while you work with us, and afterwards as the law requires.",
    "You can ask Operations & People to see or correct what we hold about you.",
  ];
}

/** The case the link is for, if it still takes anything. */
async function caseOf(db, caseId, { lock = false } = {}) {
  const row = await repo.get(db, caseId, { lock });
  if (!row || !["documentation", "pre_onboarding"].includes(row.status) || !row.employee_id) throw notFound();
  return row;
}

/** Writes need the case at documentation and the privacy notice accepted. */
function assertOpen(row) {
  if (row.status !== "documentation") throw refused("DOCUMENTATION_DONE", "Your documents are complete");
  if (!row.privacy_acknowledged_at) throw refused("PRIVACY_FIRST", "Accept the privacy notice first");
}

/** UploadPack. A guarantor's check note is Operations & People's and stays with them. */
async function packOf(db, row) {
  // One after another: inside a transaction they share one client.
  const items = await repo.items(db, row.onboarding_case_id);
  const guarantors = await repo.guarantors(db, row.onboarding_case_id);
  const bvnEntered = await organisation.hasBvn(db, row.employee_id);
  const org = await profile.readProfile(db);
  const company = profile.displayName(org);
  return {
    first_name: row.employee_first_name || "",
    role: row.job_title,
    company,
    starts_on: row.starts_on || null,
    status: row.status,
    privacy_notice: privacyNotice(company),
    privacy_acknowledged: Boolean(row.privacy_acknowledged_at),
    items: items.map(service.itemOf),
    guarantors: guarantors.map((g) => ({ ...service.guarantorOf(g), check_note: null })),
    bvn_entered: bvnEntered,
  };
}

const payload = (row, extra = {}) => ({
  onboarding_case_id: row.onboarding_case_id,
  application_id: row.application_id,
  employee_id: row.employee_id,
  employee_name: row.employee_name,
  owner_user_id: row.owner_user_id || null,
  ...extra,
});

/** A file this hire sent on this link, still on their record; refused otherwise. */
async function ownFile(db, row, documentId, field) {
  const doc = await repo.strangerDocument(db, documentId, row.employee_id);
  if (!doc) throw refused("DOCUMENT_NOT_FOUND", "Upload the file again", 422, { [field]: ["Upload it again"] });
  if (doc.scan_status === "infected") throw refused("FILE_INFECTED", "This file failed the virus scan", 422, { [field]: ["Send another file"] });
  return doc;
}

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

async function pack(caseId) {
  return packOf(pool, await caseOf(pool, caseId));
}

async function acknowledge(caseId) {
  return tx(async (client) => {
    const row = await caseOf(client, caseId, { lock: true });
    if (row.status !== "documentation") throw refused("DOCUMENTATION_DONE", "Your documents are complete");
    if (!row.privacy_acknowledged_at) {
      await repo.acknowledgePrivacy(client, caseId);
      await emit(client, { key: EVENTS.ONBOARDING_PRIVACY_ACKNOWLEDGED, entity: { type: ENTITY, id: caseId }, actor: null, payload: payload(row) });
    }
    return packOf(client, await repo.get(client, caseId));
  });
}

/**
 * A file the hire sends: on their employee record from the start (the People 360's Documents tab),
 * quarantined and scanned as any stranger's upload. Answered as a DocumentRef to name on an item.
 */
async function file(caseId, upload) {
  if (!upload) throw refused("FILE_REQUIRED", "Add the file", 422, { file: ["Add the file"] });
  return tx(async (client) => {
    const row = await caseOf(client, caseId, { lock: true });
    assertOpen(row);
    const doc = await vault.store(client, {
      file: upload,
      purpose: "document",
      doc_type: DOC_TYPE,
      entity: { type: "employee", id: row.employee_id },
      subject_employee_id: row.employee_id,
      stranger: true,
      actor: null,
    });
    return { document_id: doc.document_id, file_name: doc.original_name, size_bytes: Number(doc.bytes), mime_type: doc.mime };
  });
}

async function item(caseId, itemId, body) {
  return tx(async (client) => {
    const row = await caseOf(client, caseId, { lock: true });
    assertOpen(row);
    const it = await repo.item(client, caseId, itemId, { lock: true });
    if (!it) throw refused("NOT_FOUND", "That item is not on your list", 404);
    if (it.status === "verified") throw refused("ALREADY_VERIFIED", "This item is already verified");
    const needsFile = it.kind === "file" || it.kind === "both";
    const needsValue = it.kind === "number" || it.kind === "both";
    if (needsFile && !body.document_id) throw refused("FILE_REQUIRED", "Add the file", 422, { document_id: ["Add the file"] });
    if (needsValue && !body.entered_value) throw refused("VALUE_REQUIRED", "Enter the number", 422, { entered_value: ["Enter the number"] });
    if (needsFile) await ownFile(client, row, body.document_id, "document_id");
    await repo.itemUploaded(client, itemId, {
      document_id: needsFile ? body.document_id : null,
      entered_value: needsValue ? body.entered_value : null,
    });
    await emit(client, {
      key: EVENTS.ONBOARDING_ITEM_UPLOADED,
      entity: { type: ENTITY, id: caseId },
      actor: null,
      payload: payload(row, { onboarding_checklist_item_id: itemId, title: it.title }),
    });
    return packOf(client, await repo.get(client, caseId));
  });
}

/**
 * A guarantor: one a previous employer, one who has known the hire four years or more (the contract
 * refuses fewer), never two of the same kind. A guarantor who has passed their check stays as they are.
 */
async function guarantor(caseId, body) {
  return tx(async (client) => {
    const row = await caseOf(client, caseId, { lock: true });
    assertOpen(row);
    const existing = await repo.guarantors(client, caseId);
    const same = existing.find((g) => Number(g.position) === body.position);
    const other = existing.find((g) => Number(g.position) !== body.position);
    if (other && other.kind === body.kind)
      throw refused("SAME_KIND", "Your two guarantors are of different kinds", 422, { kind: ["Pick the other kind"] });
    if (same && same.check_status === "passed") throw refused("ALREADY_CHECKED", "This guarantor has passed their check");
    if (body.form_document_id) await ownFile(client, row, body.form_document_id, "form_document_id");
    const id = await repo.saveGuarantor(client, caseId, body);
    await emit(client, {
      key: EVENTS.ONBOARDING_GUARANTOR_SAVED,
      entity: { type: ENTITY, id: caseId },
      actor: null,
      payload: payload(row, { onboarding_guarantor_id: id, position: body.position }),
    });
    return packOf(client, await repo.get(client, caseId));
  });
}

/** The BVN: on the employee record, masked; it may be the last thing documentation waited on. */
async function bvn(caseId, body) {
  return tx(async (client) => {
    const row = await caseOf(client, caseId, { lock: true });
    assertOpen(row);
    await organisation.setBvnIn(client, row.employee_id, body.bvn, null);
    await emit(client, { key: EVENTS.ONBOARDING_BVN_ENTERED, entity: { type: ENTITY, id: caseId }, actor: null, payload: payload(row) });
    await service.checkGateIn(client, null, caseId);
    return packOf(client, await repo.get(client, caseId));
  });
}

/* ------------------------------------------------------------------ *
 * The link
 * ------------------------------------------------------------------ */

/** A link lives a month, and at least a week past the start date; never past the tokens' limit. */
function ttlHours(startsOn, now = new Date()) {
  const month = now.getTime() + 30 * 86_400_000;
  const afterStart = startsOn ? new Date(`${String(startsOn).slice(0, 10)}T23:59:59+01:00`).getTime() + 7 * 86_400_000 : 0;
  const hours = Math.ceil((Math.max(month, afterStart) - now.getTime()) / 3_600_000);
  return Math.min(hours, publicToken.MAX_TTL_HOURS);
}

/**
 * Make the hire a fresh link, stopping every earlier one, and mail it as `onboarding-documents`.
 * From the outbox when the case opens, and on Send Reminder. A case past documentation, or a hire
 * with no address, gets nothing. Each run makes its own link, so a run again sends a working one.
 */
async function sendLink(caseId, actorUserId = null, { reminder = false } = {}) {
  const made = await tx(async (client) => {
    const row = await repo.get(client, caseId, { lock: true });
    if (!row || row.status !== "documentation" || !row.employee_email) return null;
    await publicToken.revokeFor(client, { subject_type: SUBJECT, subject_id: caseId, scope: SCOPE });
    const link = await publicToken.issue(client, {
      scope: SCOPE,
      subject_type: SUBJECT,
      subject_id: caseId,
      ttl_hours: ttlHours(row.starts_on),
      created_by: actorUserId,
    });
    if (reminder)
      await emit(client, {
        key: EVENTS.ONBOARDING_LINK_SENT,
        entity: { type: ENTITY, id: caseId },
        actor: actorUserId ? { user_id: actorUserId } : null,
        payload: payload(row),
      });
    return { row, token: link.token, id: link.public_token_id };
  });
  if (!made) return false;
  const { row } = made;
  await require("../../jobs/queues").enqueue(
    "email-send",
    EMAILS.documents,
    {
      to: { name: row.employee_name, email: row.employee_email },
      recipient: { first_name: row.employee_first_name, last_name: row.employee_last_name, email: row.employee_email },
      template: EMAILS.documents,
      data: {
        vacancy_title: row.job_title,
        documents_url: `${origin()}/onboard/${made.token}`,
        due_on: row.starts_on && String(row.starts_on).slice(0, 10) >= lagos.today() ? String(row.starts_on).slice(0, 10) : null,
      },
    },
    { jobId: `onboarding-documents-${made.id}` },
  );
  return true;
}

/** Not Progressing: the application's Upload Documents links stop working. */
async function stopLinks(applicationId) {
  const row = await repo.byApplication(pool, applicationId);
  if (!row) return 0;
  return tx((client) => publicToken.revokeFor(client, { subject_type: SUBJECT, subject_id: row.onboarding_case_id, scope: SCOPE }));
}

module.exports = { DOC_TYPE, privacyNotice, ttlHours, pack, acknowledge, file, item, guarantor, bvn, sendLink, stopLinks };
