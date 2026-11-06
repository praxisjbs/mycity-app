"use strict";
/**
 * What a budget records and who it tells (docs/guides/expenses.md §7).
 *
 *   budget.set                    New Budget: Budget History's first lines; audit only
 *   budget.changed                Edit Budget: each line it changed, before and after; the
 *                                 department's head is told
 *   budget.line_threshold_reached the budget-threshold sweep found a line 90% used (committed and
 *                                 spent); the head and Operations & People are told, once per line
 *
 * A save's changed lines travel in its event's metadata (`changes`), which Budget History reads
 * back from the audit ledger.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { formatNaira } = require("../../shared/money/money");

const EVENTS = defineEvents("expenses", {
  "budget.set": { summary: "A department's budget for a year was set" },
  "budget.changed": { summary: "A department's budget was changed" },
  "budget.line_threshold_reached": { summary: "A budget line passed 90% used" },
});

defineNotification(EVENTS.BUDGET_CHANGED, {
  to: [{ users: (e) => [e.payload.head_user_id].filter(Boolean) }],
  title: (e) => `Budget changed: ${e.payload.name}`,
  body: (e) => `${e.payload.changed} ${e.payload.changed === 1 ? "line" : "lines"} changed.`,
});

defineNotification(EVENTS.BUDGET_LINE_THRESHOLD_REACHED, {
  to: [{ users: (e) => e.payload.user_ids || [] }],
  title: (e) => `${e.payload.category} at ${e.payload.used}%: ${e.payload.name}`,
  body: (e) => `${formatNaira(e.payload.used_amount)} of ${formatNaira(e.payload.amount)} used.`,
});

module.exports = { EVENTS };
