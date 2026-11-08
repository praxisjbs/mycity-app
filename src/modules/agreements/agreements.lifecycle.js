"use strict";
/**
 * An agreement's lifecycle (docs/guides/partnerships.md §6.8, MILESTONES §12), the moves a person makes
 * and those its approval makes:
 *
 *   draft     Generate Agreement; or back from its approval (rejected, changes asked for, withdrawn),
 *             with the reason shown until it is submitted again. Its wording, values and term change
 *             here only
 *   review    Submit for Approval: every field filled and its start set; `partnership.agreement` opens
 *   approval  the first stage approved and a later one waits; or every stage approved, which Send for
 *             Signature then accepts (AgreementDetail.approval.state `approved`)
 *   sent ... renewed   the signing and the daily job (agreements.signing, agreements.renewals)
 *   closed    Close Agreement, with its reason, from any status: an open approval is withdrawn and an
 *             open signature request ended, so no link keeps working
 *
 * Renew drafts the next agreement from this one (the same template, deal and values, the term moved),
 * on a new deal for the term when asked; this one becomes renewed when that one is signed.
 * Send Back follows expenses' rule: the engine's Request Changes keeps an approval pending at its first
 * stage, so the approval is withdrawn as its opener and the agreement returns to Draft.
 */
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const engine = require("../../shared/workflow/engine");
const md = require("../../shared/documents/markdown");
const lagos = require("../../shared/time/lagos");
const signatures = require("../signatures/signatures.service");
const wording = require("../templates/templates.agreements");
const repo = require("./agreements.repo");
const generate = require("./agreements.generate");
const approval = require("./agreements.approval");
const signing = require("./agreements.signing");
const { EVENTS, ENTITY, SUBJECT } = require("./agreements.events");

const refused = (code, message, status = 409, fields) => new AppError(code, message, status, fields);
const service = () => require("./agreements.service");

/** PATCH /agreements/:id: in Draft only. A field given fills its chip still open; the wording replaces it whole. */
async function update(actor, scope, id, body) {
  await service().tx(async (client) => {
    const a = await service().visibleIn(client, id, scope, { lock: true });
    if (a.status !== "draft") throw refused("NOT_DRAFT", "Only a draft agreement can be edited");
    const changes = {};
    let body_ = a.body;
    if (body.body_html !== undefined) {
      body_ = wording.wordingFrom(body.body_html);
      wording.checkNames(body_, await signing.catalogOf(client, a));
    }
    if (body.fields !== undefined) {
      const refilled = await generate.refillIn(client, { ...a, body: body_ }, body.fields);
      changes.fields = refilled.fields;
      body_ = refilled.body;
    }
    if (body_ !== a.body) changes.body = body_;
    if (body.starts_on !== undefined) changes.starts_on = body.starts_on;
    if (body.ends_on !== undefined) changes.ends_on = body.ends_on;
    if (body.renewal_notice_days !== undefined) changes.renewal_notice_days = body.renewal_notice_days;
    const starts = changes.starts_on === undefined ? a.starts_on : changes.starts_on;
    const ends = changes.ends_on === undefined ? a.ends_on : changes.ends_on;
    if (starts && ends && String(ends) < String(starts)) throw refused("VALIDATION_FAILED", "Check the dates", 422, { ends_on: ["Ends before it starts"] });
    if (!Object.keys(changes).length) return;
    await repo.set(client, id, ["draft"], changes);
    await emit(client, {
      key: EVENTS.AGREEMENT_UPDATED,
      entity: { type: ENTITY, id },
      actor,
      payload: { partnership_agreement_id: id, number: a.number, fields: Object.keys(changes) },
    });
  });
  return service().get(id, scope, actor);
}

/** POST /agreements/:id/submit: every field filled and its start set; the approval opens. Review. */
async function submit(actor, scope, id) {
  await service().tx(async (client) => {
    const a = await service().visibleIn(client, id, scope, { lock: true });
    if (a.status !== "draft") throw refused("NOT_DRAFT", "Only a draft agreement can be submitted");
    const missing = await signing.missingOf(client, a);
    if (missing.length) throw refused("FIELDS_MISSING", `Fill ${missing.join(", ")} first`, 422, { body_html: missing.map((m) => `${m} is empty`) });
    if (!a.starts_on) throw refused("VALIDATION_FAILED", "Set the start date", 422, { starts_on: ["Set the start date"] });
    if (md.markdownToText(a.body || "").trim().length < 40) throw refused("VALIDATION_FAILED", "Write the agreement", 422, { body_html: ["Write the agreement"] });
    const instance = await approval.openIn(client, actor, a);
    await repo.set(client, id, ["draft"], { status: "review", workflow_instance_id: instance.workflow_instance_id, returned_reason: null, returned_at: null });
    await emit(client, {
      key: EVENTS.AGREEMENT_SUBMITTED,
      entity: { type: ENTITY, id },
      actor,
      before: { status: "draft" },
      after: { status: "review" },
      payload: await signing.payloadFor(client, a, { instance_id: instance.workflow_instance_id }),
    });
  });
  return service().get(id, scope, actor);
}

/** The first stage approved and a later one waits (outbox): review → approval. */
async function advanced(id, instanceId) {
  return service().tx(async (client) => {
    const a = await repo.get(client, id, null, { lock: true });
    if (!a || a.workflow_instance_id !== instanceId) return null;
    if (!(await repo.set(client, id, ["review"], { status: "approval" }))) return null;
    await emit(client, {
      key: EVENTS.AGREEMENT_ADVANCED,
      entity: { type: ENTITY, id },
      actor: null,
      before: { status: "review" },
      after: { status: "approval" },
      payload: await signing.payloadFor(client, a),
    });
    return "approval";
  });
}

/** Back to Draft with the reason, in the caller's transaction. */
async function returnIn(client, a, why, reason) {
  if (!(await repo.set(client, a.partnership_agreement_id, ["review", "approval"], { status: "draft", returned_reason: reason || why, returned_at: new Date() })))
    return null;
  await emit(client, {
    key: EVENTS.AGREEMENT_RETURNED,
    entity: { type: ENTITY, id: a.partnership_agreement_id },
    actor: null,
    before: { status: a.status },
    after: { status: "draft" },
    payload: await signing.payloadFor(client, a, { why, reason: reason || null }),
  });
  return "draft";
}

const RETURNED = Object.freeze({
  rejected: "Rejected",
  timeout_rejected: "Not decided in time",
  cancelled: "Approval withdrawn",
});

/**
 * Its approval ended (outbox, workflow.completed or workflow.cancelled): approved stays at approval
 * with its approval approved, for Send for Signature; rejected or withdrawn, back to Draft with why.
 */
async function settleApproval(id, { state, reason, instance_id: instanceId }) {
  return service().tx(async (client) => {
    const a = await repo.get(client, id, null, { lock: true });
    if (!a || (instanceId && a.workflow_instance_id !== instanceId) || !["review", "approval"].includes(a.status)) return null;
    if (state === "approved" || state === "timeout_approved") {
      if (a.status === "review") await repo.set(client, id, ["review"], { status: "approval" });
      await emit(client, {
        key: EVENTS.AGREEMENT_APPROVED,
        entity: { type: ENTITY, id },
        actor: null,
        before: { status: a.status },
        after: { status: "approval" },
        payload: await signing.payloadFor(client, a),
      });
      return "approved";
    }
    if (!RETURNED[state]) return null;
    return returnIn(client, a, RETURNED[state], reason);
  });
}

/**
 * An approver pressed Send Back (outbox, workflow.changes_requested): the approval, still pending, is
 * withdrawn as its opener, and the agreement returns to Draft with the approver's reason.
 */
async function sentBack(id, payload) {
  return service().tx(async (client) => {
    const a = await repo.get(client, id, null, { lock: true });
    if (!a || !["review", "approval"].includes(a.status) || (payload.instance_id && a.workflow_instance_id !== payload.instance_id)) return null;
    const instance = await engine.findOpenInstance(client, { type: ENTITY, id });
    if (instance) await engine.cancel(client, { instance_id: instance.workflow_instance_id, actor: { user_id: instance.opened_by }, reason: payload.reason || null });
    return returnIn(client, a, "Changes asked for", payload.reason || null);
  });
}

/**
 * POST /agreements/:id/close: from any status, with the reason. An open approval is withdrawn (as its
 * opener, so it reads withdrawn, not rejected) and an open signature request ended (its links stop).
 */
async function close(actor, scope, id, body) {
  await service().tx(async (client) => {
    const a = await service().visibleIn(client, id, scope, { lock: true });
    if (a.status === "closed") throw refused("CLOSED", "This agreement is already closed");
    const instance = await engine.findOpenInstance(client, { type: ENTITY, id });
    if (instance) await engine.cancel(client, { instance_id: instance.workflow_instance_id, actor: { user_id: instance.opened_by }, reason: body.reason });
    await signatures.endFor(client, actor, { subject_type: SUBJECT, subject_id: id, status: "revoked", reason: body.reason });
    await repo.set(client, id, [a.status], { status: "closed", closed_at: new Date(), close_reason: body.reason });
    await emit(client, {
      key: EVENTS.AGREEMENT_CLOSED,
      entity: { type: ENTITY, id },
      actor,
      before: { status: a.status },
      after: { status: "closed" },
      payload: await signing.payloadFor(client, a, { reason: body.reason }),
    });
  });
  return service().get(id, scope, actor);
}

/**
 * POST /agreements/:id/renew: the next agreement drafted from this one, signed, active or expiring:
 * the same template, deal and values, its term moved; on a new deal for the term when asked (the same
 * record, opened at the first stage). This one becomes renewed when the next is signed.
 */
async function renew(actor, scope, id, body) {
  const nextId = await service().tx(async (client) => {
    const a = await service().visibleIn(client, id, scope, { lock: true });
    if (!["signed", "active", "expiring"].includes(a.status)) throw refused("NOT_SIGNED", "Only a signed agreement can be renewed");
    const open = await client.query(
      "SELECT 1 FROM partnership_agreement WHERE renews_agreement_id = $1 AND status NOT IN ('closed') LIMIT 1",
      [id],
    );
    if (open.rows.length) throw refused("RENEWAL_OPEN", "Its renewal is already drafted");
    let dealId = a.deal_id;
    if (body.new_deal) {
      const facts = await repo.dealFacts(client, a.deal_id);
      // Signing converted the lead, so a signed agreement's record is a partner.
      if (!facts.partner_id) throw refused("NO_PARTNER", "Only a partner's agreement can renew onto a new deal");
      const pipeline = require("../partner_pipeline/partner_pipeline.service");
      const made = await pipeline.createIn(
        client,
        actor,
        { kind: "partner", id: facts.partner_id, categoryId: facts.partner_category_id },
        { title: `${facts.title} (Renewal)`.slice(0, 200), owner_id: facts.owner_id, estimated_value: facts.estimated_value ?? null },
        { held: await pipeline.holdsMoney(actor) },
      );
      dealId = made.deal_id;
    }
    const facts = await repo.dealFacts(client, dealId);
    const kept = Object.fromEntries(Object.entries(a.fields || {}).filter(([k]) => k.startsWith("ask.")));
    return generate.draftIn(client, actor, facts, {
      template_key: a.template_key,
      asks: kept,
      starts_on: body.starts_on,
      ends_on: body.ends_on || null,
      renews_agreement_id: id,
      renewal_notice_days: a.renewal_notice_days,
    });
  });
  return service().get(nextId, scope, actor);
}

/** POST /agreements: Generate Agreement on a deal the reader sees. */
async function generateOne(actor, scope, body) {
  const id = await service().tx(async (client) => {
    await require("../partner_pipeline/partner_pipeline.service").assertSeen(client, body.deal_id, scope);
    const facts = await repo.dealFacts(client, body.deal_id);
    return generate.draftIn(client, actor, facts, { kind: body.kind, template_key: body.template_key, asks: body.asks || {} });
  });
  return service().get(id, scope, actor);
}

/** The start a renewal is offered: the day after this one ends, else today. */
const renewalStart = (a) => (a.ends_on ? lagos.addDays(String(a.ends_on), 1) : lagos.today());

module.exports = { update, submit, advanced, settleApproval, sentBack, close, renew, generateOne, renewalStart };
