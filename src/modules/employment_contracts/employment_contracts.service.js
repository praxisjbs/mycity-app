"use strict";
/**
 * Employment contracts (docs/guides/offers.md §3 step 5a, §6): the contract a hire signs after
 * accepting their offer.
 *
 *   generateIn()                        the offer's acceptance makes it, in that transaction: the
 *                                       wording in force, the offer's terms, the hire's staff number,
 *                                       and its request opened with the company first, the hire second
 *   get(), viewOf()                     what the hire's onboarding case shows
 *   sign()                              the company's signer signs in the hub; the hire's link is
 *                                       mailed after commit (`contract-sent`)
 *   resend()                            a fresh link to the hire, every earlier one revoked
 *   cancelIn()                          the case ended before the contract was signed
 *   letterOf(), contentHashOf(), sealIn(), signedIn(), declinedIn(), endedIn()
 *                                       the signatures service's hooks (employment_contracts.events.js)
 *   template(), saveTemplate(), restoreTemplate()   the Contract settings' standard wording
 *
 * Who sees a contract: the reader's `recruitment` scope over its vacancy's hiring manager, as the
 * offer it follows. Who signs for the company: the signer named on its own request, settled when
 * the contract was generated, so naming a new Offer Signatory never moves a contract already waiting.
 */
const crypto = require("node:crypto");
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const numbering = require("../../shared/numbering/numbering");
const canonical = require("../../shared/documents/canonical");
const documents = require("../../shared/documents/generate");
const vault = require("../../shared/documents/vault");
const templates = require("../../shared/templates/template-store");
const profile = require("../../shared/organisation/profile");
const signatures = require("../signatures/signatures.service");
const offersRepo = require("../offers/offers.repo");
const repo = require("./employment_contracts.repo");
const render = require("./employment_contracts.render");
const lifecycle = require("./employment_contracts.lifecycle");
const { EVENTS, DOC_TYPE, EMAILS } = require("./employment_contracts.events");

const SUBJECT = "employment_contract";

const notFound = () => new AppError("NOT_FOUND", "That contract does not exist", 404);
const refused = (code, message, status = 409) => new AppError(code, message, status);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const day = (v) => (v ? String(v instanceof Date ? lagos.dateOf(v) : v).slice(0, 10) : null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const holds = (scope, row) =>
  Boolean(scope && (scope.scope === "all" || (row.hiring_manager_id && (scope.scope_ids || []).includes(row.hiring_manager_id))));

/** The contract, or 404 when it is not in the reader's scope. */
async function visible(db, id, scope, opts) {
  const row = await repo.get(db, id, opts);
  if (!row || !holds(scope, row)) throw notFound();
  return row;
}

async function companyOf(db) {
  const org = await profile.readProfile(db);
  return org.legal_name || org.trading_name;
}

const payload = (ct, extra = {}) => ({
  employment_contract_id: ct.employment_contract_id,
  number: ct.number,
  onboarding_case_id: ct.onboarding_case_id,
  employee_name: ct.employee_name,
  owner_user_id: ct.owner_user_id || null,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** EmploymentContractView. */
async function viewOf(db, ct, user) {
  const signers = ct.signature_request_id ? await signatures.signersOf(db, ct.signature_request_id) : [];
  const rows = ct.signature_request_id
    ? await require("../signatures/signatures.repo").signaturesOf(db, ct.signature_request_id)
    : [];
  const company = rows.find((s) => s.signer_role === lifecycle.ROLES.company);
  const hire = rows.find((s) => s.signer_role === lifecycle.ROLES.hire);
  const doc = ct.document_id ? await vault.get(db, ct.document_id) : null;
  return {
    employment_contract_id: ct.employment_contract_id,
    number: ct.number,
    status: ct.status,
    starts_on: day(ct.starts_on),
    ends_on: day(ct.ends_on),
    document: {
      document_id: ct.document_id,
      file_name: doc ? doc.original_name || `${ct.number}.pdf` : `${ct.number}.pdf`,
      size_bytes: doc ? Number(doc.bytes || 0) : 0,
      mime_type: doc ? doc.mime : "application/pdf",
    },
    signers,
    created_at: iso(ct.created_at),
    can_sign: Boolean(
      user && company && company.status === "pending" && company.signer_type === "user" && company.signer_id === user.user_id,
    ),
    can_resend: Boolean(company && company.status === "signed" && hire && hire.status === "pending"),
  };
}

async function get(id, user, scope) {
  return viewOf(pool, await visible(pool, id, scope), user);
}

/** The case's contract, for the onboarding record. In the caller's transaction or on the pool. */
async function forCase(db, caseId, user) {
  const ct = await repo.byCase(db, caseId);
  return ct ? viewOf(db, ct, user) : null;
}

/* ------------------------------------------------------------------ *
 * Generated at acceptance
 * ------------------------------------------------------------------ */

/**
 * Make the hire's contract and open its signature request, in the acceptance transaction
 * (offers.acceptedIn). The company signs first and the hire second, so no link is issued here:
 * Sign for Company makes the hire's.
 *
 * @param {object} client  the acceptance transaction
 * @param {{user_id: string|null}|null} actor
 * @param {{offer: object, onboarding_case: object, employee: object, signatory: object|null}} input
 * @returns {Promise<object>} the contract row
 */
async function generateIn(client, actor, { offer, onboarding_case: onboardingCase, employee, signatory }) {
  if (!signatory || !signatory.user_id)
    throw refused("NO_SIGNATORY", "Name the Offer Signatory in Offers settings first", 422);
  const existing = await repo.byCase(client, onboardingCase.onboarding_case_id);
  if (existing) return existing;

  const contractId = crypto.randomUUID();
  const { number } = await numbering.allocate(client, "contract", { date: lagos.today() });
  const pay = await offersRepo.payLines(client, offer.offer_id);
  const wording = await templates.current(client, "document", render.TEMPLATE);
  const draft = {
    employment_contract_id: contractId,
    number,
    created_at: new Date(),
    starts_on: offer.start_date,
    ends_on: null,
    employee_name: `${employee.first_name} ${employee.last_name}`.trim(),
    employee_first_name: employee.first_name,
    employee_email: employee.work_email,
    staff_number: employee.staff_number,
  };
  const vars = render.varsOf(draft, offer, pay, {
    company: await companyOf(client),
    signatory: { name: signatory.name, title: signatory.job_title || signatory.title || null },
  });
  const doc = await documents.generate(client, {
    doc_type: DOC_TYPE,
    entity: { type: SUBJECT, id: contractId },
    subject_employee_id: employee.employee_id,
    data: vars,
    actor,
    date: vars.date,
    template_version: Number(wording.version),
  });
  await client.query(
    `INSERT INTO employment_contract (employment_contract_id, onboarding_case_id, employee_id, number, status, starts_on, document_id)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6)`,
    [contractId, onboardingCase.onboarding_case_id, employee.employee_id, number, day(offer.start_date), doc.document_id],
  );
  const { signature_request_id: requestId } = await signatures.requestIn(client, actor, {
    document_id: doc.document_id,
    subject_type: SUBJECT,
    subject_id: contractId,
    reference: number,
    title: `Contract of Employment: ${offer.job_title}`,
    issue_links: false,
    signers: [
      {
        signer_type: "user",
        signer_id: signatory.user_id,
        name: signatory.name,
        email: signatory.email,
        title: signatory.job_title || signatory.title || null,
        role: lifecycle.ROLES.company,
      },
      {
        signer_type: "employee",
        signer_id: employee.employee_id,
        name: draft.employee_name,
        email: employee.work_email,
        role: lifecycle.ROLES.hire,
      },
    ],
  });
  await repo.stamp(client, contractId, { signature_request_id: requestId });
  const ct = await repo.get(client, contractId);
  await emit(client, {
    key: EVENTS.CONTRACT_GENERATED,
    entity: { type: SUBJECT, id: contractId },
    actor,
    payload: payload(ct, { signatory_user_id: signatory.user_id }),
  });
  return ct;
}

/* ------------------------------------------------------------------ *
 * The company's signature, and the hire's link
 * ------------------------------------------------------------------ */

/** Queue contract-sent with a link made in the request (never kept, never in the outbox). */
async function mail(ct, link) {
  await require("../../jobs/queues").enqueue(
    "email-send",
    EMAILS.sent,
    {
      to: { name: ct.employee_name, email: ct.employee_email },
      recipient: { first_name: ct.employee_first_name, last_name: ct.employee_last_name, email: ct.employee_email },
      template: EMAILS.sent,
      data: {
        vacancy_title: ct.job_title,
        reference: ct.number,
        sign_url: link.url,
        expires_at: iso(link.expires_at),
      },
    },
    { jobId: `contract-sent-${link.signature_id}-${new Date(link.expires_at).getTime()}-${Date.now()}` },
  );
}

/** The hire's link, fresh (every earlier one revoked). */
async function linkIn(client, actor, ct) {
  const links = await signatures.issueLinks(client, actor, ct.signature_request_id);
  const link = links.find((l) => l.email === ct.employee_email) || links[0];
  if (!link) throw refused("NOT_OPEN", "This contract can no longer be signed");
  return link;
}

/** The company's signer signs in the hub (no email code: already signed in). */
async function sign(actor, scope, id, body, meta) {
  const { view, row, link } = await tx(async (client) => {
    const ct = await visible(client, id, scope, { lock: true });
    if (ct.status !== "draft") throw refused("NOT_WAITING", "This contract is not waiting for the company");
    await signatures.signAsStaffIn(client, actor, ct.signature_request_id, body, meta);
    await repo.setStatus(client, id, ["draft"], "sent");
    const sent = await repo.get(client, id);
    const l = await linkIn(client, actor, sent);
    await emit(client, { key: EVENTS.CONTRACT_COMPANY_SIGNED, entity: { type: SUBJECT, id }, actor, payload: payload(sent) });
    return { view: await viewOf(client, sent, actor), row: sent, link: l };
  });
  await mail(row, link);
  return view;
}

async function resend(actor, scope, id) {
  const { view, row, link } = await tx(async (client) => {
    const ct = await visible(client, id, scope, { lock: true });
    if (ct.status !== "sent") throw refused("NOT_SENT", "Only a sent contract can be resent");
    const l = await linkIn(client, actor, ct);
    await emit(client, { key: EVENTS.CONTRACT_RESENT, entity: { type: SUBJECT, id }, actor, payload: payload(ct) });
    return { view: await viewOf(client, ct, actor), row: ct, link: l };
  });
  await mail(row, link);
  return view;
}

/** The case ended before the contract was signed (onboarding's Withdraw). In the caller's transaction. */
async function cancelIn(client, actor, caseId, reason) {
  const ct = await repo.byCase(client, caseId);
  if (!ct || !lifecycle.OPEN.includes(ct.status)) return false;
  if (ct.signature_request_id)
    await signatures.endFor(client, actor, { subject_type: SUBJECT, subject_id: ct.employment_contract_id, status: "revoked", reason });
  if (!(await repo.setStatus(client, ct.employment_contract_id, lifecycle.OPEN, "cancelled"))) return false;
  await emit(client, {
    key: EVENTS.CONTRACT_CANCELLED,
    entity: { type: SUBJECT, id: ct.employment_contract_id },
    actor,
    payload: payload(ct, { reason: reason || null }),
  });
  return true;
}

/* ------------------------------------------------------------------ *
 * The signatures service's hooks (defineSignable("employment_contract"))
 * ------------------------------------------------------------------ */

/** The contract row, its offer and its pay lines: what every hook renders from. */
async function termsOf(db, contractId) {
  const ct = await repo.get(db, contractId);
  if (!ct) return null;
  const offer = await offersRepo.get(db, ct.offer_id);
  return { ct, offer, pay: await offersRepo.payLines(db, ct.offer_id) };
}

async function letterOf(db, contractId) {
  const t = await termsOf(db, contractId);
  if (!t) return [];
  const vars = render.varsOf(t.ct, t.offer, t.pay, {
    company: await companyOf(db),
    signatory: await companySignerOf(db, t.ct),
  });
  return render.lines(db, t.ct, vars);
}

/** The company's signer as the contract names it: its own request's, settled when it was generated. */
async function companySignerOf(db, ct) {
  if (!ct.signature_request_id) return null;
  const s = (await signatures.signersOf(db, ct.signature_request_id)).find((x) => x.role === lifecycle.ROLES.company);
  return s ? { name: s.name, title: s.title } : null;
}

async function contentHashOf(db, contractId) {
  const t = await termsOf(db, contractId);
  if (!t) return null;
  return canonical.hash("EMPLOYMENT_CONTRACT", render.canonicalOf(t.ct, t.offer, t.pay));
}

/** The sealed copy: the contract again with every signature, the certificate and the QR. */
async function sealIn(client, ctx) {
  const t = await termsOf(client, ctx.request.subject_id);
  const company = await companyOf(client);
  const vars = render.varsOf(t.ct, t.offer, t.pay, {
    company,
    signatory: await companySignerOf(client, t.ct),
    sealing: {
      signers: ctx.signatures.map((s) => ({
        name: s.name,
        title: s.title || null,
        label: s.role === lifecycle.ROLES.company ? `For ${company}` : "The Employee",
        signed_at: s.signed_at || null,
        signature: s.signature || null,
        typed: s.typed || null,
      })),
      certificate: ctx.certificate,
      qr: ctx.qr,
      verify_url: ctx.verify_url,
      reference: ctx.verify_reference,
    },
  });
  const doc = await documents.generate(client, {
    doc_type: DOC_TYPE,
    entity: { type: SUBJECT, id: t.ct.employment_contract_id },
    subject_employee_id: t.ct.employee_id,
    data: vars,
    actor: null,
    date: vars.date,
    template_version: t.ct.terms_version,
  });
  await repo.stamp(client, t.ct.employment_contract_id, { document_id: doc.document_id });
  return doc;
}

/** The hire signed: the last signature of the request. */
async function signedIn(client, ctx) {
  const ct = await repo.get(client, ctx.request.subject_id, { lock: true });
  if (!ct || !(await repo.setStatus(client, ct.employment_contract_id, ["sent", "draft"], "signed"))) return;
  await emit(client, {
    key: EVENTS.CONTRACT_SIGNED,
    entity: { type: SUBJECT, id: ct.employment_contract_id },
    actor: ctx.actor || null,
    payload: payload(ct),
  });
}

async function declinedIn(client, ctx) {
  const ct = await repo.get(client, ctx.request.subject_id, { lock: true });
  if (!ct || !(await repo.setStatus(client, ct.employment_contract_id, lifecycle.OPEN, "cancelled"))) return;
  await emit(client, {
    key: EVENTS.CONTRACT_CANCELLED,
    entity: { type: SUBJECT, id: ct.employment_contract_id },
    actor: null,
    payload: payload(ct, { reason: ctx.reason || null }),
  });
}

/** The request lapsed (signature-reminders, daily). A revoke is the module's own (cancelIn). */
async function endedIn(client, ctx) {
  if (ctx.status !== "expired") return;
  await declinedIn(client, { ...ctx, reason: ctx.reason || "The contract expired unsigned" });
}

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

/** The contract's PDF: the sealed copy once there is one, else the copy generated at acceptance. */
async function documentOf(id, scope) {
  const ct = await visible(pool, id, scope);
  const doc = ct.document_id ? await vault.get(pool, ct.document_id) : null;
  if (!doc || doc.render_status === "pending") throw refused("NOT_READY", "The contract is still being prepared");
  return doc;
}

/* ------------------------------------------------------------------ *
 * Contract settings
 * ------------------------------------------------------------------ */

const TEMPLATE_VARIABLES = Object.freeze(
  Object.keys(c.employment_contracts.EmploymentContractVars.shape).filter((k) => k !== "sealing"),
);

async function templateShape(db, t) {
  const isDefault = Number(t.version) === 0;
  return {
    body: t.body,
    version: Number(t.version),
    is_default: isDefault,
    variables: [...TEMPLATE_VARIABLES],
    updated_at: isDefault ? null : iso(await offersRepo.letterSavedAt(db, "document", render.TEMPLATE)),
  };
}

async function template() {
  return templateShape(pool, await templates.current(pool, "document", render.TEMPLATE));
}

async function saveTemplate(actor, body) {
  return tx(async (client) => {
    const t = await templates.saveVersion(
      client,
      { kind: "document", key: render.TEMPLATE, body: body.body, format: "markdown" },
      { created_by: actor.user_id },
    );
    return templateShape(client, t);
  });
}

async function restoreTemplate(actor) {
  const shipped = templates.shipped("document", render.TEMPLATE);
  return saveTemplate(actor, { body: shipped.body });
}

module.exports = {
  get,
  forCase,
  generateIn,
  sign,
  resend,
  cancelIn,
  letterOf,
  contentHashOf,
  sealIn,
  signedIn,
  declinedIn,
  endedIn,
  documentOf,
  template,
  saveTemplate,
  restoreTemplate,
};
