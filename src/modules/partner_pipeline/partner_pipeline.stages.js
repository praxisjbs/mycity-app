"use strict";
/**
 * The stage switcher (docs/guides/partnerships.md §6.5): one press moves a deal to another of
 * MyCity's stages, with history, in one transaction.
 *
 *   refused       the stage it is at; a retired stage; a signed deal sent back before signing
 *                 (it is closed as lost instead)
 *   needs Why     On Hold, Closed Lost, and any move to an earlier position (10 characters or more);
 *                 leaving On Hold resumes the deal and needs none
 *   needs a copy  a move into a signed meaning (`signed`, `active`) of a deal not yet signed, unless
 *                 it has a signed agreement: the signed copy, through the upload engine
 *
 * What each move does, in the same transaction:
 *   the deal       its stage; `lost` with its reason at Closed Lost; `live` and signed (its validity
 *                  dated) on entering a signed meaning; `open` again when a lost deal reopens
 *   its history    a stage line, with the reason and where it came from (a person, a conversion)
 *   a lead's       its status read from the new stage (§6.4); a signed deal converts it into a
 *                  partner (partners.convert.js), with its signed copy
 *   a partner's    the signed copy among its documents; its status kept in step (§6.6)
 *   events         deal.stage_changed, and deal.lost or deal.signed
 */
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const lagos = require("../../shared/time/lagos");
const { EVENTS } = require("./partner_pipeline.events");
const repo = require("./partner_pipeline.repo");
const lists = require("./partner_pipeline.lists");
const service = require("./partner_pipeline.service");

const invalid = (field, message, code = "VALIDATION_FAILED") => new AppError(code, "Check the highlighted fields", 422, { [field]: [message] });

/** The meanings a signed deal may still move to: another signed one, On Hold, or Closed Lost. */
const AFTER_SIGNING = new Set(["signed", "active", "on_hold", "closed_lost"]);

/**
 * What a move needs and refuses, from the stages' meanings and order (no writes).
 * @returns {{from: object|null, to: object, back: boolean, needsReason: boolean, signs: boolean}}
 */
function ruleOf(stages, deal, code) {
  const to = lists.stageOf(stages, code);
  if (!to || !to.active) throw invalid("stage", "Pick a stage");
  if (String(deal.stage) === to.code) throw invalid("stage", "Already at this stage");
  const from = lists.stageOf(stages, deal.stage);
  const order = (s) => stages.indexOf(s);
  // Leaving On Hold resumes a deal wherever it goes: On Hold sits last in the list, so it is never a move back.
  const back = Boolean(from) && from.meaning !== "on_hold" && order(to) < order(from);
  if (deal.signed_at && !AFTER_SIGNING.has(to.meaning)) throw invalid("stage", "Already signed");
  const signs = lists.isSigned(to.meaning) && !deal.signed_at;
  const needsReason = back || to.meaning === "on_hold" || to.meaning === "closed_lost";
  return { from, to, back, needsReason, signs };
}

/**
 * Move a locked deal, in the caller's transaction.
 * @param {import("pg").PoolClient} client
 * @param {object} actor
 * @param {object} deal  repo.lock()'s row
 * @param {{stage: string, reason?: string, signed_copy_document_id?: string}} body
 * @param {{source?: string, scope?: object}} [opts]
 * @returns {Promise<{converted_partner_id: string|null}>}
 */
async function moveIn(client, actor, deal, body, { source = "person" } = {}) {
  const stages = await lists.stagesOf(client);
  const rule = ruleOf(stages, deal, body.stage);
  const reason = body.reason ? body.reason.trim() : null;
  // Convert to Partner moves the deal to its signed stage from wherever it was: the signed copy is the reason.
  if (rule.needsReason && !reason && source !== "conversion") throw invalid("reason", "Say why");
  if (rule.signs && !body.signed_copy_document_id && !(await repo.hasSignedAgreement(client, deal.deal_id))) {
    throw invalid("signed_copy_document_id", "Attach the signed copy", "SIGNED_COPY_REQUIRED");
  }

  const changes = { stage: rule.to.code };
  if (rule.to.meaning === "closed_lost") Object.assign(changes, { status: "lost", closed_at: new Date(), close_reason: reason });
  else if (rule.signs) {
    const { rows } = await client.query("SELECT validity_days, valid_until FROM partnership_opportunity WHERE partnership_opportunity_id = $1", [deal.deal_id]);
    const v = rows[0];
    Object.assign(changes, { status: "live", signed_at: new Date(), closed_at: null, close_reason: null });
    if (v.validity_days && !v.valid_until) changes.valid_until = lagos.addDays(lagos.today(), v.validity_days);
  } else if (deal.status === "lost") Object.assign(changes, { status: deal.signed_at ? "live" : "open", closed_at: null, close_reason: null });
  await client.query(
    `UPDATE partnership_opportunity SET ${Object.keys(changes).map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE partnership_opportunity_id = $1`,
    [deal.deal_id, ...Object.values(changes)],
  );
  await repo.addHistory(client, { deal_id: deal.deal_id, kind: "stage", from: deal.stage, to: rule.to.code, reason, source, user_id: actor ? actor.user_id : null });
  const payload = { deal_id: deal.deal_id, number: deal.number, from: deal.stage, to: rule.to.code, meaning: rule.to.meaning, owner_id: deal.owner_id, moved_by: actor ? actor.user_id : null, source };
  await emit(client, { key: EVENTS.DEAL_STAGE_CHANGED, entity: { type: "partner_deal", id: deal.deal_id }, actor, before: { stage: deal.stage }, after: { stage: rule.to.code }, payload });
  if (rule.to.meaning === "closed_lost") await emit(client, { key: EVENTS.DEAL_LOST, entity: { type: "partner_deal", id: deal.deal_id }, actor, payload });

  let converted = null;
  if (deal.lead_id && !deal.partner_id) {
    const leads = require("../leads/leads.service");
    if (rule.signs) {
      converted = await require("../partners/partners.convert").convertIn(client, actor, { lead_id: deal.lead_id, deal_id: deal.deal_id, signed_copy_document_id: body.signed_copy_document_id || null });
    } else {
      await leads.syncStatus(client, actor, deal.lead_id, rule.to.meaning, reason);
    }
  } else if (deal.partner_id) {
    if (rule.signs && body.signed_copy_document_id) {
      await require("../partners/partners.documents").attachIn(client, actor, {
        record: { kind: "partner", id: deal.partner_id },
        deal_id: deal.deal_id,
        document_id: body.signed_copy_document_id,
        origin: "signed_copy",
        field: "signed_copy_document_id",
      });
    }
    await require("../partners/partners.service").syncStatus(client, actor, deal.partner_id);
  }
  if (rule.signs) {
    await emit(client, {
      key: EVENTS.DEAL_SIGNED,
      entity: { type: "partner_deal", id: deal.deal_id },
      actor,
      payload: { deal_id: deal.deal_id, number: deal.number, partner_id: deal.partner_id || (converted && converted.partner_id), owner_id: deal.owner_id, source },
    });
  }
  return { converted_partner_id: converted ? converted.partner_id : null };
}

/** The stage switcher's press (POST /deals/:id/stage): the deal the reader may see, moved. */
async function move(actor, scope, id, body, { source = "person" } = {}) {
  await service.tx(async (client) => {
    await service.assertSeen(client, id, scope);
    const deal = await repo.lock(client, id);
    await moveIn(client, actor, deal, body, { source });
  });
  return service.get(id, scope, actor);
}

/**
 * The stage switcher as a Praxis AI card, checked before it is drawn: the deal the reader may see,
 * the move its rules allow, and never into a signed meaning, which needs the signed copy (a file).
 */
async function assertCard(client, values, scope) {
  if (!values.deal_id || !values.stage) return;
  await service.assertSeen(client, values.deal_id, scope);
  const deal = await repo.lock(client, values.deal_id);
  const rule = ruleOf(await lists.stagesOf(client), deal, values.stage);
  if (rule.signs && !(await repo.hasSignedAgreement(client, deal.deal_id))) {
    throw new AppError("SIGNED_COPY_REQUIRED", "A signed stage needs the signed copy: attach it on the deal's 360.", 422, { stage: ["Attach the copy first"] });
  }
  if (rule.needsReason && !values.reason) throw invalid("reason", "Say why");
}

module.exports = { ruleOf, moveIn, move, assertCard, AFTER_SIGNING };
