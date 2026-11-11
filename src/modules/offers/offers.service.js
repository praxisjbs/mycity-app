"use strict";
/**
 * Offers (docs/guides/offers.md §3 steps 1 to 4, §6): an offer of employment from a shortlisted
 * application to the candidate's signature.
 *
 *   list(), get(), summary(), draft()   what Recruitment · Offers reads
 *   create(), edit()                    New Offer and a draft's edits: monthly pay lines, the total
 *                                       checked against the vacancy's monthly range (outside it, a reason)
 *   submit()                            Submit for Approval: the `recruitment.offer` flow, kept as it
 *                                       was when submitted (the instance holds its definition)
 *   settleApproval()                    the flow's outcome (outbox): approved generates the letter and
 *                                       opens its signature request; rejected returns it to draft
 *   sign()                              the Offer Signatory signs for the company, in the hub
 *   send(), resend()                    the candidate's link mailed; Send starts the expiry and moves
 *                                       the card to the Offer column (candidates.advanceIn)
 *   withdraw(), withdrawForApplication()   ended by a person, or by Not Progressing
 *   letterOf(), contentHashOf(), sealIn(), acceptedIn(), declinedIn(), endedIn()
 *                                       the signatures service's hooks (offers.events.js defineSignable)
 *   settings(), saveSignatory(), letterTemplate(), saveLetter(), restoreLetter()   the Offers tab's settings
 *
 * Who sees an offer: the reader's `recruitment` scope over its vacancy's hiring manager, as the board.
 * Who edits: the same over `recruitment` edit. Who signs for the company: the Offer Signatory
 * (setting recruitment.offer_signatory) named when the offer was approved.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const money = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const numbering = require("../../shared/numbering/numbering");
const canonical = require("../../shared/documents/canonical");
const documents = require("../../shared/documents/generate");
const vault = require("../../shared/documents/vault");
const templates = require("../../shared/templates/template-store");
const workflow = require("../../shared/workflow/engine");
const profile = require("../../shared/organisation/profile");
const { scopeFor } = require("../../middleware/rbac");
const signatures = require("../signatures/signatures.service");
const candidates = require("../candidates/candidates.service");
const organisation = require("../organisation/organisation.service");
const onboarding = require("../onboarding/onboarding.service");
const contracts = require("../employment_contracts/employment_contracts.service");
const repo = require("./offers.repo");
const render = require("./offers.render");
const { EVENTS, FLOW, DOC_TYPE, EMAILS } = require("./offers.events");

const SUBJECT = "offer";
const VALID = c.offers.OFFER_VALID_DAYS;
/** The stages an application may take an offer from: Shortlist, or Offer again after one ended. */
const OFFERABLE = new Set(["shortlist", "offer"]);
const ENDED_REASON = "The candidate was not progressed";
/** The actor of a step nobody in the hub pressed (the candidate's own decline, a lapse). */
const NOBODY = Object.freeze({ user_id: null });

const notFound = () => new AppError("NOT_FOUND", "That offer does not exist", 404);
const refused = (code, message, status = 409, fields) => new AppError(code, message, status, fields);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const num = (v) => (v === null || v === undefined ? null : Number(v));

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ *
 * Scope
 * ------------------------------------------------------------------ */

const holds = (scope, row) => Boolean(scope && (scope.scope === "all" || (row.hiring_manager_id && (scope.scope_ids || []).includes(row.hiring_manager_id))));

/** The offer, or 404 when it is not in the reader's scope. */
async function visible(db, id, scope, opts) {
  const row = await repo.get(db, id, opts);
  if (!row || !holds(scope, row)) throw notFound();
  return row;
}

async function mayEdit(user, row) {
  return holds(user ? await scopeFor(user, "recruitment", "edit") : null, row);
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** OfferRow. */
function listed(r) {
  return {
    offer_id: r.offer_id,
    number: r.number,
    application_id: r.application_id,
    candidate_name: r.candidate_name,
    vacancy_title: r.vacancy_title,
    job_title: r.job_title,
    status: r.status,
    currency: "NGN",
    annual_compensation: money.toWire(r.annual_compensation),
    outside_range: r.outside_range === true,
    start_date: r.start_date || null,
    expires_at: iso(r.expires_at),
    sent_at: iso(r.sent_at),
    created_at: iso(r.created_at),
  };
}

/** The signatory the letter names: the request's company signer once there is one, else the setting. */
async function signatoryOf(db, o) {
  if (o.signature_request_id) {
    const first = (await signatures.signersOf(db, o.signature_request_id)).find((s) => s.role === "mycity");
    if (first) return { name: first.name, title: first.title };
  }
  const s = await repo.signatory(db);
  return s ? { name: s.name, title: s.job_title || null, user_id: s.user_id, email: s.email } : null;
}

async function companyOf(db) {
  return profile.displayName(await profile.readProfile(db));
}

/** OfferLetterVars for an offer as it stands. */
async function varsFor(db, o, lines, extra = {}) {
  return render.varsOf(o, lines, { company: await companyOf(db), signatory: await signatoryOf(db, o), ...extra });
}

/** OfferDetail for the reader. */
async function detailOf(db, o, user) {
  const lines = await repo.payLines(db, o.offer_id);
  const signers = o.signature_request_id ? await signatures.signersOf(db, o.signature_request_id) : [];
  const editable = await mayEdit(user, o);
  const company = signers.find((s) => s.role === "mycity");
  const mine = o.signature_request_id
    ? (await signaturesFor(db, o.signature_request_id)).find((s) => s.signer_type === "user" && s.signer_id === user.user_id && s.status === "pending")
    : null;
  const terms = o.terms || {};
  return {
    ...listed(o),
    vacancy_id: o.vacancy_id,
    department_id: o.department_id,
    department: o.department || null,
    worksite_id: o.worksite_id,
    reports_to: o.reports_to,
    role_function: o.role_function,
    role_scope: o.role_scope,
    employment_type: o.employment_type,
    work_pattern: o.work_pattern,
    office_days: num(o.office_days),
    annual_leave_days: num(o.annual_leave_days),
    incentives: o.incentives,
    pay_lines: lines.map((l) => ({ ...l, monthly_amount: money.toWire(l.monthly_amount) })),
    monthly_total: render.totalOf(lines),
    salary_min: o.salary_min ? money.toWire(o.salary_min) : null,
    salary_max: o.salary_max ? money.toWire(o.salary_max) : null,
    range_reason: o.range_reason,
    job_description: o.job_description,
    additional_terms: o.additional_terms,
    working_hours: o.working_hours,
    probation_months: num(o.probation_months),
    valid_days: terms.valid_days || VALID.default,
    benefits: terms.benefits || null,
    score_snapshot: o.score_snapshot === null ? null : Number(o.score_snapshot),
    decision_snapshot: o.decision_snapshot,
    workflow_instance_id: o.workflow_instance_id,
    letter: await render.lines(db, o, await varsFor(db, o, lines)),
    document: o.document_id
      ? { document_id: o.document_id, file_name: o.document_name, size_bytes: Number(o.document_bytes || 0), mime_type: o.document_mime || "application/pdf" }
      : null,
    signers,
    submitted_at: iso(o.submitted_at),
    approved_at: iso(o.approved_at),
    accepted_at: iso(o.accepted_at),
    declined_at: iso(o.declined_at),
    withdrawn_at: iso(o.withdrawn_at),
    end_reason: o.end_reason,
    candidate_email: o.candidate_email,
    send_refused_at: o.status === "sent" ? iso(await repo.refusedSince(db, o.candidate_email, o.sent_at)) : null,
    can_edit: editable && o.status === "draft",
    can_submit: editable && o.status === "draft",
    can_sign: o.status === "approved" && Boolean(mine) && Boolean(company) && company.status === "pending",
    can_send: editable && o.status === "approved" && Boolean(company) && company.status === "signed",
    can_resend: editable && o.status === "sent",
    can_withdraw: editable && ["approval", "approved", "sent"].includes(o.status),
    can_change_email: editable && o.status === "sent",
  };
}

/** Signature rows of a request, as the record needs them (who is asked, in order). */
async function signaturesFor(db, requestId) {
  return require("../signatures/signatures.repo").signaturesOf(db, requestId);
}

async function list(query, _user, scope) {
  const page = await repo.list(pool, query, scope);
  return { ...page, data: page.data.map(listed) };
}

async function get(id, user, scope) {
  return detailOf(pool, await visible(pool, id, scope), user);
}

async function summary(scope) {
  return repo.summary(pool, scope);
}

/** The application New Offer is for, in the reader's edit scope, at a stage that may take one. */
async function offerable(db, applicationId, scope, { lock = false } = {}) {
  const a = await repo.application(db, applicationId, { lock });
  if (!a || !holds(scope, a)) throw new AppError("NOT_FOUND", "That candidate does not exist", 404);
  if (a.status !== "active" || !OFFERABLE.has(a.stage))
    throw refused("NOT_SHORTLISTED", "Only a shortlisted candidate can take an offer", 409, { application_id: ["Pick a shortlisted candidate"] });
  return a;
}

/** OfferDraft: what New Offer starts from. */
async function draft(applicationId, _user, scope) {
  const a = await offerable(pool, applicationId, scope);
  const v = await repo.vacancyTerms(pool, a.vacancy_id);
  const card = await candidates.scorecardOf(pool, applicationId);
  return {
    application_id: a.application_id,
    candidate_name: a.candidate_name,
    vacancy_title: v.title,
    job_title: v.title,
    department_id: v.department_id,
    reports_to: v.reports_to,
    employment_type: v.employment_type,
    work_pattern: v.work_pattern,
    probation_months: num(v.probation_months),
    start_date: v.target_start_on && v.target_start_on >= lagos.today() ? v.target_start_on : null,
    salary_min: v.salary_min ? money.toWire(v.salary_min) : null,
    salary_max: v.salary_max ? money.toWire(v.salary_max) : null,
    job_description: v.description || null,
    pay_lines: [{ name: "Basic Salary", monthly_amount: v.salary_min ? money.toWire(v.salary_min) : "0.00" }],
    score: card && card.weighted_total !== null ? Number(card.weighted_total) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Writing a draft
 * ------------------------------------------------------------------ */

/** The pay lines, their total against the vacancy's monthly range, and the columns they set. */
function payOf(lines, v, reason) {
  if (!lines.length) throw refused("NO_PAY", "Add a pay line", 422, { pay_lines: ["Add a pay line"] });
  const total = money.sum(lines.map((l) => l.monthly_amount));
  const below = v.salary_min && money.compare(total, v.salary_min) < 0;
  const above = v.salary_max && money.compare(total, v.salary_max) > 0;
  const outside = Boolean(below || above);
  if (outside && !reason) throw refused("RANGE_REASON", "Give a reason for pay outside the range", 422, { range_reason: ["Say why"] });
  return {
    annual_compensation: render.annualOf(lines),
    outside_range: outside,
    range_reason: outside ? reason : null,
  };
}

/** The columns of OfferFields; `terms` keeps valid_days and benefits. */
function columnsOf(body, terms) {
  const out = {};
  for (const k of [
    "job_title",
    "department_id",
    "worksite_id",
    "start_date",
    "reports_to",
    "role_function",
    "role_scope",
    "employment_type",
    "work_pattern",
    "office_days",
    "annual_leave_days",
    "incentives",
    "working_hours",
    "probation_months",
    "job_description",
    "additional_terms",
  ])
    if (body[k] !== undefined) out[k] = body[k];
  if (body.start_date !== undefined && body.start_date < lagos.today())
    throw refused("START_PAST", "The start date has passed", 422, { start_date: ["Pick a later date"] });
  const next = { ...terms };
  if (body.valid_days !== undefined) next.valid_days = body.valid_days || VALID.default;
  if (body.benefits !== undefined) next.benefits = body.benefits || null;
  out.terms = next;
  return out;
}

const ownerPayload = (o, extra = {}) => ({
  offer_id: o.offer_id,
  number: o.number,
  application_id: o.application_id,
  candidate_name: o.candidate_name,
  owner_user_id: o.created_by,
  ...extra,
});

/** The fields the form left empty, so the vacancy's own stand (a department, a worksite). */
const stripBlank = (body) => Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null && v !== undefined));

/** New Offer. In the caller's transaction. */
async function createIn(client, actor, scope, body) {
  const a = await offerable(client, body.application_id, scope, { lock: true });
  const v = await repo.vacancyTerms(client, a.vacancy_id);
  const lines = body.pay_lines;
  const card = await candidates.scorecardOf(client, a.application_id);
  const { number } = await numbering.allocate(client, "offer", { date: lagos.today() });
  let id;
  try {
    id = await repo.insert(client, {
      application_id: a.application_id,
      number,
      currency: "NGN",
      created_by: actor.user_id,
      score_snapshot: card && card.weighted_total !== null ? card.weighted_total : null,
      decision_snapshot: await repo.interviewDecision(client, a.application_id),
      ...columnsOf({ department_id: v.department_id, worksite_id: v.worksite_id, ...stripBlank(body) }, { valid_days: VALID.default }),
      ...payOf(lines, v, body.range_reason),
    });
  } catch (err) {
    if (err.code === "23505") throw refused("OFFER_OPEN", "This candidate already has an open offer");
    throw err;
  }
  await repo.setPayLines(client, id, lines);
  const o = await repo.get(client, id);
  await emit(client, { key: EVENTS.OFFER_CREATED, entity: { type: SUBJECT, id }, actor, payload: ownerPayload(o) });
  return o;
}

async function create(actor, scope, body) {
  return tx(async (client) => detailOf(client, await createIn(client, actor, scope, body), actor));
}

/** The assistant's New Offer: the vacancy's terms, the start date and basic salary given (OfferCard). */
async function createFromCard(actor, scope, values) {
  const d = await draft(values.application_id, actor, scope);
  return create(actor, scope, {
    application_id: d.application_id,
    job_title: values.job_title || d.job_title,
    department_id: d.department_id,
    start_date: values.start_date,
    reports_to: d.reports_to,
    employment_type: d.employment_type,
    work_pattern: d.work_pattern,
    probation_months: d.probation_months,
    job_description: d.job_description,
    pay_lines: [{ name: "Basic Salary", monthly_amount: values.basic_salary }],
    range_reason: "Drafted from the assistant; set the pay lines before submitting",
  });
}

async function edit(actor, scope, id, body) {
  return tx(async (client) => {
    const o = await visible(client, id, scope, { lock: true });
    if (!(await mayEdit(actor, o))) throw notFound();
    if (o.status !== "draft") throw refused("NOT_DRAFT", "Only a draft offer can be changed");
    const patch = columnsOf(body, o.terms || {});
    const lines = body.pay_lines || (await repo.payLines(client, id));
    const reason = body.range_reason !== undefined ? body.range_reason : o.range_reason;
    Object.assign(patch, payOf(lines, { salary_min: o.salary_min, salary_max: o.salary_max }, reason));
    await repo.update(client, id, patch);
    if (body.pay_lines) await repo.setPayLines(client, id, body.pay_lines);
    const after = await repo.get(client, id);
    await emit(client, { key: EVENTS.OFFER_UPDATED, entity: { type: SUBJECT, id }, actor, payload: ownerPayload(after) });
    return detailOf(client, after, actor);
  });
}

/* ------------------------------------------------------------------ *
 * Approval
 * ------------------------------------------------------------------ */

async function submit(actor, scope, id) {
  return tx(async (client) => {
    const o = await visible(client, id, scope, { lock: true });
    if (!(await mayEdit(actor, o))) throw notFound();
    if (o.status !== "draft") throw refused("NOT_DRAFT", "Only a draft offer can be submitted");
    if (!o.start_date) throw refused("NO_START", "Set the start date", 422, { start_date: ["Set the start date"] });
    if (!o.department_id) throw refused("NO_DEPARTMENT", "Set the department", 422, { department_id: ["Set the department"] });
    // The employee is created from these at acceptance (guide §6), so an approved offer can always
    // be accepted: both are NOT NULL on the employee record.
    if (!o.employment_type)
      throw refused("NO_EMPLOYMENT_TYPE", "Set the employment type", 422, { employment_type: ["Set the employment type"] });
    if (!o.work_pattern) throw refused("NO_WORK_PATTERN", "Set the work pattern", 422, { work_pattern: ["Set the work pattern"] });
    const signatory = await repo.signatory(client);
    if (!signatory || !signatory.user_id)
      throw refused("NO_SIGNATORY", "Name the Offer Signatory in Offers settings first");
    const head = o.department_id ? await organisation.headOf(client, o.department_id) : null;
    const instance = await workflow.openInstance(client, {
      definition_key: FLOW,
      entity: { type: SUBJECT, id },
      subject_employee_id: actor.employee_id || null,
      context: {
        annual_compensation: money.toWire(o.annual_compensation),
        outside_range: o.outside_range === true,
        department_id: o.department_id || null,
        department_head_employee_id: head || null,
      },
      actor,
    });
    await repo.setStatus(client, id, ["draft"], "approval", {
      submitted_at: new Date(),
      workflow_instance_id: instance.workflow_instance_id,
      end_reason: null,
    });
    const after = await repo.get(client, id);
    await emit(client, { key: EVENTS.OFFER_SUBMITTED, entity: { type: SUBJECT, id }, actor, payload: ownerPayload(after) });
    return detailOf(client, after, actor);
  });
}

/**
 * Open the offer's signature request when it has none: the letter generated with the wording in
 * force, the Offer Signatory first, the candidate second. No link yet (Send Offer makes it).
 */
async function ensureRequestIn(client, actor, o) {
  if (o.signature_request_id) return o.signature_request_id;
  const s = await repo.signatory(client);
  if (!s || !s.user_id) return null;
  const lines = await repo.payLines(client, o.offer_id);
  const vars = render.varsOf(o, lines, { company: await companyOf(client), signatory: { name: s.name, title: s.job_title || null } });
  const doc = await documents.generate(client, {
    doc_type: DOC_TYPE,
    entity: { type: SUBJECT, id: o.offer_id },
    data: vars,
    actor,
    date: vars.date,
    template_version: o.terms_version,
  });
  const { signature_request_id: requestId } = await signatures.requestIn(client, actor, {
    document_id: doc.document_id,
    subject_type: SUBJECT,
    subject_id: o.offer_id,
    reference: o.number,
    title: `Offer of Employment: ${o.job_title}`,
    issue_links: false,
    signers: [
      { signer_type: "user", signer_id: s.user_id, name: s.name, email: s.email, title: s.job_title || null, role: "mycity" },
      { signer_type: "candidate", signer_id: null, name: o.candidate_name, email: o.candidate_email, role: "candidate" },
    ],
  });
  await repo.stamp(client, o.offer_id, { document_id: doc.document_id, signature_request_id: requestId });
  return requestId;
}

/** The approval finished (outbox, workflow.completed for `recruitment.offer`). */
async function settleApproval(offerId, { state, reason, instance_id: instanceId, actor_user_id: actorUserId }) {
  return tx(async (client) => {
    const o = await repo.get(client, offerId, { lock: true });
    if (!o || o.status !== "approval" || (instanceId && o.workflow_instance_id !== instanceId)) return null;
    const actor = actorUserId ? { user_id: actorUserId } : null;
    if (state === "approved" || state === "timeout_approved") {
      const wording = await templates.current(client, "document", render.TEMPLATE);
      await repo.setStatus(client, offerId, ["approval"], "approved", {
        approved_at: new Date(),
        approved_by: actorUserId,
        terms_version: Number(wording.version),
      });
      const approved = await repo.get(client, offerId);
      await ensureRequestIn(client, actor || { user_id: o.created_by }, approved);
      const s = await repo.signatory(client);
      await emit(client, {
        key: EVENTS.OFFER_APPROVED,
        entity: { type: SUBJECT, id: offerId },
        actor,
        payload: ownerPayload(o, { signatory_user_id: s ? s.user_id : null }),
      });
      return "approved";
    }
    if (state === "rejected" || state === "timeout_rejected") {
      await repo.setStatus(client, offerId, ["approval"], "draft", { end_reason: reason || null, workflow_instance_id: null });
      await emit(client, { key: EVENTS.OFFER_REJECTED, entity: { type: SUBJECT, id: offerId }, actor, payload: ownerPayload(o, { reason: reason || null }) });
      return "draft";
    }
    return null;
  });
}

/* ------------------------------------------------------------------ *
 * The company's signature, Send and Resend
 * ------------------------------------------------------------------ */

/** The Offer Signatory signs for the company, in the hub (no email code: already signed in). */
async function sign(actor, scope, id, body, meta) {
  return tx(async (client) => {
    const o = await visible(client, id, scope, { lock: true });
    if (o.status !== "approved") throw refused("NOT_APPROVED", "Only an approved offer is signed for the company");
    const requestId = await ensureRequestIn(client, actor, o);
    if (!requestId) throw refused("NO_SIGNATORY", "Name the Offer Signatory in Offers settings first");
    await signatures.signAsStaffIn(client, actor, requestId, body, meta);
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** Queue offer-sent with a link made in the request (never kept, never in the outbox). */
async function mail(o, link) {
  await require("../../jobs/queues").enqueue(
    "email-send",
    EMAILS.sent,
    {
      to: { name: o.candidate_name, email: o.candidate_email },
      recipient: { first_name: o.candidate_first_name, last_name: o.candidate_last_name, email: o.candidate_email },
      template: EMAILS.sent,
      data: { vacancy_title: o.job_title, reference: o.number, sign_url: link.url, expires_at: iso(o.expires_at) },
    },
    { jobId: `offer-sent-${link.signature_id}-${new Date(link.expires_at).getTime()}-${Date.now()}` },
  );
}

/** The candidate's link, fresh (every earlier one revoked). */
async function linkIn(client, actor, o) {
  const links = await signatures.issueLinks(client, actor, o.signature_request_id);
  const link = links.find((l) => l.email === o.candidate_email) || links[0];
  if (!link) throw refused("NOT_OPEN", "This offer can no longer be signed");
  return link;
}

async function send(actor, scope, id) {
  const { detail, row, link } = await tx(async (client) => {
    const o = await visible(client, id, scope, { lock: true });
    if (!(await mayEdit(actor, o))) throw notFound();
    if (o.status !== "approved") throw refused("NOT_APPROVED", "Only an approved offer can be sent");
    const company = o.signature_request_id ? (await signatures.signersOf(client, o.signature_request_id)).find((s) => s.role === "mycity") : null;
    if (!company || company.status !== "signed") throw refused("NOT_SIGNED", "The offer is not signed for the company yet");
    // An accepted offer builds its checklist from the requirements in force, so an empty list would
    // open a case with nothing to ask the hire for (guide §11).
    if ((await onboarding.requiredCount(client)) === 0)
      throw refused("NO_REQUIREMENTS", "Set at least one required document on the Onboarding checklist first", 422);
    const days = (o.terms && o.terms.valid_days) || VALID.default;
    const expires = new Date(Date.now() + days * 24 * 3600 * 1000);
    await signatures.setExpiryIn(client, o.signature_request_id, expires);
    await repo.setStatus(client, id, ["approved"], "sent", { sent_at: new Date(), expires_at: expires });
    const sent = await repo.get(client, id);
    const l = await linkIn(client, actor, sent);
    await candidates.advanceIn(client, actor, o.application_id, "offer");
    await emit(client, { key: EVENTS.OFFER_SENT, entity: { type: SUBJECT, id }, actor, payload: ownerPayload(sent) });
    return { detail: await detailOf(client, sent, actor), row: sent, link: l };
  });
  await mail(row, link);
  return detail;
}

async function resend(actor, scope, id) {
  const { detail, row, link } = await tx(async (client) => {
    const o = await visible(client, id, scope, { lock: true });
    if (!(await mayEdit(actor, o))) throw notFound();
    if (o.status !== "sent") throw refused("NOT_SENT", "Only a sent offer can be resent");
    const l = await linkIn(client, actor, o);
    await emit(client, { key: EVENTS.OFFER_RESENT, entity: { type: SUBJECT, id }, actor, payload: ownerPayload(o) });
    return { detail: await detailOf(client, o, actor), row: o, link: l };
  });
  await mail(row, link);
  return detail;
}

/**
 * Change Email (guide §11, the hire's email bounces): a sent offer's candidate address corrected
 * on the candidate (candidates.correctEmailIn, M4's one write path) and on their signature, then a
 * fresh link mailed to it after commit, every earlier one revoked, as Resend does.
 */
async function changeEmail(actor, scope, id, body) {
  const { detail, row, link } = await tx(async (client) => {
    const o = await visible(client, id, scope, { lock: true });
    if (!(await mayEdit(actor, o))) throw notFound();
    if (o.status !== "sent") throw refused("NOT_SENT", "Only a sent offer can be resent");
    await candidates.correctEmailIn(client, actor, o.application_id, body.email);
    await signatures.setSignerEmailIn(client, o.signature_request_id, "candidate", body.email);
    const fresh = await repo.get(client, id);
    const l = await linkIn(client, actor, fresh);
    await emit(client, { key: EVENTS.OFFER_RESENT, entity: { type: SUBJECT, id }, actor, payload: ownerPayload(fresh) });
    return { detail: await detailOf(client, fresh, actor), row: fresh, link: l };
  });
  await mail(row, link);
  return detail;
}

/* ------------------------------------------------------------------ *
 * Ending
 * ------------------------------------------------------------------ */

/**
 * End an open offer as withdrawn, in the caller's transaction. With its approval, the approval is
 * withdrawn (its requester or the CEO, the engine's rule; `asRequester` for Not Progressing, which
 * nobody pressed); approved or sent, its signature request is revoked and the links stop working.
 */
async function withdrawIn(client, actor, o, reason, { asRequester = false } = {}) {
  if (o.status === "approval" && o.workflow_instance_id) {
    const instance = await workflow.getInstance(client, o.workflow_instance_id);
    if (instance && instance.state === "pending")
      await workflow.cancel(client, { instance_id: o.workflow_instance_id, actor: asRequester ? { user_id: instance.opened_by } : actor, reason });
  }
  if (o.signature_request_id) await signatures.endFor(client, actor, { subject_type: SUBJECT, subject_id: o.offer_id, status: "revoked", reason });
  if (!(await repo.setStatus(client, o.offer_id, ["draft", "approval", "approved", "sent"], "withdrawn", { withdrawn_at: new Date(), end_reason: reason })))
    return false;
  // A sent offer had moved the card to Offer: it goes back to Shortlist (none when Not Progressing).
  await candidates.offerEndedIn(client, actor || NOBODY, o.application_id, reason);
  await emit(client, { key: EVENTS.OFFER_WITHDRAWN, entity: { type: SUBJECT, id: o.offer_id }, actor, payload: ownerPayload(o, { reason }) });
  return true;
}

async function withdraw(actor, scope, id, body) {
  return tx(async (client) => {
    const o = await visible(client, id, scope, { lock: true });
    if (!(await mayEdit(actor, o))) throw notFound();
    if (!["approval", "approved", "sent"].includes(o.status)) throw refused("NOT_OPEN", "Only an open offer can be withdrawn");
    await withdrawIn(client, actor, o, body.reason);
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** Not Progressing (outbox): the application's open offer is withdrawn. */
async function withdrawForApplication(applicationId, actorUserId) {
  let ended = 0;
  for (const id of await repo.openFor(pool, applicationId)) {
    ended += await tx(async (client) => {
      const o = await repo.get(client, id, { lock: true });
      if (!o) return 0;
      return (await withdrawIn(client, actorUserId ? { user_id: actorUserId } : null, o, ENDED_REASON, { asRequester: true })) ? 1 : 0;
    });
  }
  return ended;
}

/* ------------------------------------------------------------------ *
 * The signatures service's hooks (defineSignable("offer"))
 * ------------------------------------------------------------------ */

async function letterOf(db, offerId) {
  const o = await repo.get(db, offerId);
  if (!o) return [];
  return render.lines(db, o, await varsFor(db, o, await repo.payLines(db, offerId)));
}

async function contentHashOf(db, offerId) {
  const o = await repo.get(db, offerId);
  return canonical.hash("OFFER_LETTER", render.canonicalOf(o, await repo.payLines(db, offerId)));
}

/** The sealed copy: the letter again with every signature, the certificate and the QR. */
async function sealIn(client, ctx) {
  const o = await repo.get(client, ctx.request.subject_id);
  const company = await companyOf(client);
  const vars = await varsFor(client, o, await repo.payLines(client, o.offer_id), {
    sealing: {
      signers: ctx.signatures.map((s) => ({
        name: s.name,
        title: s.title || null,
        label: s.role === "mycity" ? `For ${company}` : "Employee Acceptance",
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
    entity: { type: SUBJECT, id: o.offer_id },
    data: vars,
    actor: null,
    date: vars.date,
    template_version: o.terms_version,
  });
  await repo.stamp(client, o.offer_id, { document_id: doc.document_id });
  return doc;
}

/**
 * What the employee record starts as (guide §3 step 5). The offer holds every field it is made
 * from, which is why Submit for Approval asks for them. No seat and no login: the Organogram seat
 * and the line manager are settled when Complete Onboarding calls `hireIn` (PR 6), and the login is
 * invited then. The candidate's address is both the work and the personal email until Complete
 * Onboarding takes the company one (AJ, 11/11/2026).
 */
function employeeFrom(o, pay) {
  const probation = o.probation_months === null || o.probation_months === undefined ? null : Number(o.probation_months);
  const start = o.start_date ? new Date(o.start_date) : null;
  let confirmation = null;
  if (start && probation) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + probation);
    confirmation = lagos.dateOf(d);
  }
  return {
    first_name: o.candidate_first_name,
    last_name: o.candidate_last_name,
    work_email: o.candidate_email,
    personal_email: o.candidate_email,
    phone: o.candidate_phone || null,
    job_title: o.job_title,
    department_id: o.department_id,
    worksite_id: o.worksite_id || null,
    employment_type: o.employment_type,
    work_pattern: o.work_pattern,
    start_date: typeof o.start_date === "string" ? o.start_date.slice(0, 10) : lagos.dateOf(o.start_date),
    confirmation_due_on: confirmation,
    gross_monthly: render.totalOf(pay),
  };
}

/**
 * Who signs the hire's contract for the company: the Offer Signatory named now, and when none is
 * named, whoever signed this offer for the company (guide §11). Both carry the login the signature
 * is made with.
 */
async function contractSignatoryIn(client, o) {
  const named = await repo.signatory(client);
  if (named && named.user_id) return named;
  if (!o.signature_request_id) return null;
  const rows = await require("../signatures/signatures.repo").signaturesOf(client, o.signature_request_id);
  const company = rows.find((s) => s.signer_role === "mycity" && s.signer_type === "user" && s.signer_id);
  return company
    ? { user_id: company.signer_id, name: company.signer_name, email: company.signer_email, job_title: company.signer_title || null }
    : null;
}

/**
 * The candidate signed: the last signature of the offer's request, inside the transaction that
 * writes it (guide §3 step 5). All or nothing: the offer is accepted, the employee created, the
 * card moved to Documentation, the case opened at documentation with its checklist, and the
 * employment contract generated and opened for the company's signature. If any part refuses, the
 * signature is not kept and the candidate is asked to try again.
 */
async function acceptedIn(client, ctx) {
  const o = await repo.get(client, ctx.request.subject_id, { lock: true });
  if (!o || !(await repo.setStatus(client, o.offer_id, ["sent"], "accepted", { accepted_at: new Date() }))) return;
  const actor = ctx.actor || NOBODY;
  const pay = await repo.payLines(client, o.offer_id);

  const employee = await organisation.createEmployee(client, employeeFrom(o, pay), actor);
  if (!(await candidates.advanceIn(client, actor, o.application_id, "documentation")))
    throw refused("NOT_MOVED", "This application cannot move to Documentation", 409);
  const onboardingCase = await onboarding.openCaseIn(client, actor, { offer: o, employee });
  await contracts.generateIn(client, actor, {
    offer: o,
    onboarding_case: onboardingCase,
    employee,
    signatory: await contractSignatoryIn(client, o),
  });

  await emit(client, {
    key: EVENTS.OFFER_ACCEPTED,
    entity: { type: SUBJECT, id: o.offer_id },
    actor: ctx.actor || null,
    payload: ownerPayload(o, { employee_id: employee.employee_id, onboarding_case_id: onboardingCase.onboarding_case_id }),
  });
}

/**
 * The sealed offer's mail, a signer at a time (signatures' mailSealed). The candidate is the one
 * person an offer is about, so they get `offer-signed` from Candidate Emails with the sealed copy
 * attached, in place of the service's own `signature-completed`; the company's signatory still
 * receives that one (AJ, 11/11/2026; guide §7).
 */
async function sealedMailFor(db, { request, signer }) {
  if (signer.signer_role !== "candidate") return null;
  const o = await repo.get(db, request.subject_id);
  if (!o) return null;
  return {
    template: EMAILS.signed,
    recipient: { first_name: o.candidate_first_name, last_name: o.candidate_last_name, email: o.candidate_email },
    data: {
      vacancy_title: o.job_title,
      reference: o.number,
      verify_url: `${String(config.PUBLIC_ORIGIN).replace(/\/+$/, "")}/verify/${encodeURIComponent(o.number)}`,
      start_on: o.start_date ? String(o.start_date instanceof Date ? lagos.dateOf(o.start_date) : o.start_date).slice(0, 10) : null,
    },
  };
}

async function declinedIn(client, ctx) {
  const o = await repo.get(client, ctx.request.subject_id, { lock: true });
  if (!o || !(await repo.setStatus(client, o.offer_id, ["sent"], "declined", { declined_at: new Date(), end_reason: ctx.reason || null }))) return;
  await candidates.offerEndedIn(client, NOBODY, o.application_id, "The candidate declined the offer");
  await emit(client, { key: EVENTS.OFFER_DECLINED, entity: { type: SUBJECT, id: o.offer_id }, actor: null, payload: ownerPayload(o) });
}

/** The request lapsed (signature-reminders, daily): a sent offer expires. A revoke is the module's own. */
async function endedIn(client, ctx) {
  if (ctx.status !== "expired") return;
  const o = await repo.get(client, ctx.request.subject_id, { lock: true });
  if (!o || !(await repo.setStatus(client, o.offer_id, ["sent", "approved"], "expired", { end_reason: ctx.reason || null }))) return;
  await candidates.offerEndedIn(client, NOBODY, o.application_id, "The offer expired unsigned");
  await emit(client, { key: EVENTS.OFFER_EXPIRED, entity: { type: SUBJECT, id: o.offer_id }, actor: null, payload: ownerPayload(o) });
}

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */

/** The offer's PDF: the sealed copy once there is one, else the letter generated at approval. */
async function documentOf(id, scope) {
  const o = await visible(pool, id, scope);
  const doc = o.document_id ? await vault.get(pool, o.document_id) : null;
  if (!doc || doc.render_status === "pending") throw new AppError("NOT_READY", "The letter is still being prepared", 409);
  return doc;
}

/* ------------------------------------------------------------------ *
 * Offers settings
 * ------------------------------------------------------------------ */

async function settings(db = pool) {
  const s = await repo.signatory(db);
  const t = await templates.current(db, "document", render.TEMPLATE);
  return {
    signatory: s ? s.person : null,
    letter_version: Number(t.version),
    letter_is_default: Number(t.version) === 0,
  };
}

async function saveSignatory(actor, body) {
  return tx(async (client) => {
    if (!(await repo.employee(client, body.signatory_employee_id)))
      throw refused("NOT_FOUND", "That person is not an employee", 422, { signatory_employee_id: ["Pick an employee"] });
    await repo.putSignatory(client, body.signatory_employee_id, actor.user_id);
    const s = await repo.signatory(client);
    if (!s.user_id) throw refused("NO_LOGIN", "This person has no login to sign with", 422, { signatory_employee_id: ["Needs a login"] });
    return settings(client);
  });
}

/** The names the standard wording may use. */
const LETTER_VARIABLES = Object.freeze(Object.keys(c.offers.OfferLetterVars.shape).filter((k) => k !== "sealing"));

async function letterShape(db, t) {
  const isDefault = Number(t.version) === 0;
  return {
    body: t.body,
    version: Number(t.version),
    is_default: isDefault,
    variables: [...LETTER_VARIABLES],
    updated_at: isDefault ? null : iso(await repo.letterSavedAt(db, "document", render.TEMPLATE)),
  };
}

async function letterTemplate() {
  return letterShape(pool, await templates.current(pool, "document", render.TEMPLATE));
}

async function saveLetter(actor, body) {
  return tx(async (client) => {
    const t = await templates.saveVersion(client, { kind: "document", key: render.TEMPLATE, body: body.body, format: "markdown" }, { created_by: actor.user_id });
    return letterShape(client, t);
  });
}

async function restoreLetter(actor) {
  const shipped = templates.shipped("document", render.TEMPLATE);
  return saveLetter(actor, { body: shipped.body });
}

module.exports = {
  list,
  get,
  summary,
  draft,
  create,
  createFromCard,
  edit,
  submit,
  settleApproval,
  sign,
  send,
  resend,
  changeEmail,
  withdraw,
  withdrawForApplication,
  letterOf,
  contentHashOf,
  sealIn,
  acceptedIn,
  sealedMailFor,
  declinedIn,
  endedIn,
  documentOf,
  settings: () => settings(),
  saveSignatory,
  letterTemplate,
  saveLetter,
  restoreLetter,
};
