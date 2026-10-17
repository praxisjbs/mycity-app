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
 */
const { defineEvents, WORKFLOW } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
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
});

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

module.exports = { EVENTS, DEFINITION_KEY, OUTCOME };
