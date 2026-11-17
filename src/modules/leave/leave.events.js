"use strict";
/**
 * What the leave module records, who it tells, and how a decision reaches a request.
 *
 * A request is decided in its approval (`leave.approval`, shared/workflow). The engine
 * already tells the approvers when a request reaches them and the person who asked when
 * it is approved or rejected (shared/notifications/fanout.js), so this file adds only
 * what the flow does not cover: leave People record for someone, and leave cancelled
 * by somebody other than the person it belongs to.
 *
 * After commit the outcome of an approval is copied onto the request (`settle`), at
 * least once and idempotently: the copy changes only a request still `submitted`. A
 * request withdrawn from My Approvals rather than My Leave is settled the same way.
 *
 * Relief and handover (docs/guides/ess.md §6, §8): the relief officer a request names is
 * told when it is approved and again when approved leave is cancelled, with no step of
 * their own. The handover note is a `leave_handover` document on the request, opened by
 * the person, the relief officer, whoever may read the request's approval, and People
 * within their scope.
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const { formatDate } = require("../../shared/time/day-first");
const outbox = require("../../shared/events/outbox");
const workflow = require("../../shared/workflow/engine");

const EVENTS = defineEvents("people", {
  "leave_request.submitted": { summary: "Leave was requested" },
  "leave_request.recorded": { summary: "Leave was recorded for someone by People" },
  "leave_request.approved": { summary: "A leave request was approved" },
  "leave_request.rejected": { summary: "A leave request was rejected" },
  "leave_request.cancelled": { summary: "A leave request was cancelled" },
  "leave_balance.set": { summary: "People set a person's leave allowance for a year" },
  "leave_type.created": { summary: "A leave type was added" },
  "leave_type.updated": { summary: "A leave type was changed" },
  "leave_type.deleted": { summary: "A leave type nobody had used was deleted" },
  "leave_request.relief_covering": { summary: "A relief officer was told they cover approved leave" },
  "leave_request.relief_released": { summary: "A relief officer was told leave they covered was cancelled" },
});

/** The handover note a request carries (vault.claim in leave.service.request). */
const HANDOVER_DOC_TYPE = "leave_handover";
defineDocumentType(HANDOVER_DOC_TYPE, { label: "Handover Note", module: "people", sensitivity: "personal" });

/** The approval flow every request opens. */
const DEFINITION_KEY = "leave.approval";

defineNotification(EVENTS.LEAVE_REQUEST_RECORDED, {
  to: [{ subject: true }],
  title: "Leave recorded",
  body: (e) => `${e.payload.leave_type_name}, ${e.payload.days} working ${e.payload.days === 1 ? "day" : "days"}.`,
});

defineNotification(EVENTS.LEAVE_REQUEST_CANCELLED, {
  to: [{ subject: true }],
  title: "Leave cancelled",
  body: (e) => `${e.payload.leave_type_name} leave was cancelled.`,
});

/** The relief officer's login, from the event (leave.repo.loginsOf). */
const relief = (e, client) => require("./leave.repo").loginsOf(client, e.payload.relief_employee_id);
/** "Annual leave, 03/12/2026 to 10/12/2026." */
const span = (e) => `${e.payload.leave_type_name} leave, ${formatDate(e.payload.starts_on)} to ${formatDate(e.payload.ends_on)}.`;

defineNotification(EVENTS.LEAVE_REQUEST_RELIEF_COVERING, {
  to: [{ users: relief }],
  title: (e) => `Relief cover: ${e.payload.employee_name}`,
  body: span,
  who: "The relief officer",
  copy: true,
});

defineNotification(EVENTS.LEAVE_REQUEST_RELIEF_RELEASED, {
  to: [{ users: relief }],
  title: "Relief cover cancelled",
  body: (e) => `${e.payload.employee_name}, ${span(e)}`,
  who: "The relief officer",
  copy: true,
});

/**
 * Who opens a handover note (docs/guides/ess.md §8): the CEO, the person, the relief officer,
 * whoever may read the request's approval (its approvers on any stage, those who decided it, and
 * `people` view within scope), and for a request with no approval `people` view within scope.
 * A note no request holds yet stays its uploader's.
 */
vault.defineAccess("leave_request", async (client, user, doc) => {
  if (!user) return false;
  if (user.is_ceo === true) return true;
  const row = await require("./leave.repo").byHandover(client, doc.document_id);
  if (!row) return Boolean(doc.uploaded_by && doc.uploaded_by === user.user_id);
  if (user.employee_id && (row.employee_id === user.employee_id || row.relief_employee_id === user.employee_id)) return true;
  if (row.workflow_instance_id) {
    const instance = await workflow.getInstance(client, row.workflow_instance_id);
    if (instance && (await require("../workflow/workflow.service").mayRead(client, instance, user))) return true;
  }
  const scope = await require("../../middleware/rbac").scopeFor(user, "people", "view");
  if (!scope) return false;
  return scope.scope === "all" || (scope.scope_ids || []).includes(row.employee_id);
});

defineNotification(EVENTS.LEAVE_BALANCE_SET, {
  to: [{ subject: true }],
  title: "Leave allowance changed",
  body: (e) =>
    e.payload.days === null
      ? `${e.payload.leave_type_name}, ${e.payload.year}: back to the usual allowance.`
      : `${e.payload.leave_type_name}, ${e.payload.year}: ${e.payload.days} working days.`,
});

/** The request status an approval's end state means. */
const OUTCOME = Object.freeze({
  approved: "approved",
  timeout_approved: "approved",
  rejected: "rejected",
  timeout_rejected: "rejected",
  cancelled: "cancelled",
});

/*
 * The service is required when a handler runs, not when this file loads: the service
 * requires this file for its event keys, and the worker loads this file on its own.
 */
const settle = (id, status) => require("./leave.service").settle(id, status);

workflow.onCompleted(DEFINITION_KEY, "leave.apply_decision", (event) =>
  settle(event.entity.id, OUTCOME[event.payload.state] || null),
);

outbox.register(WORKFLOW.WORKFLOW_CANCELLED, "leave.apply_withdrawal", async (event) => {
  if (event.payload.definition_key !== DEFINITION_KEY) return;
  await settle(event.entity.id, "cancelled");
});

module.exports = { EVENTS, DEFINITION_KEY, OUTCOME, HANDOVER_DOC_TYPE };
