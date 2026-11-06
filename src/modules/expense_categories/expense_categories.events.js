"use strict";
/**
 * What Expenses · Categories records (docs/guides/expenses.md §7). Each is an audit line only:
 * a category tells nobody when it is added, changed or set up from the suggestions.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("expenses", {
  "expense_category.created": { summary: "An expense category was added" },
  "expense_category.updated": { summary: "An expense category was changed" },
  "expense_category.suggested": { summary: "The suggested expense categories were added" },
});

module.exports = { EVENTS };
