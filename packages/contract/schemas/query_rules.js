"use strict";
/**
 * Query rules: "three late arrivals in thirty days raises a query", configured on
 * Queries & Sanctions · Rules, not coded (docs/guides/queries.md §6.3).
 *
 * A rule counts one trigger (`source_event`) for one person inside a rolling window
 * of `window_days` Lagos days (shared/rules/window-counter) and raises one query when
 * the count reaches `threshold`. `measure` is `count` (events) or `minutes` (late
 * minutes summed, lateness only), so a threshold in cumulative hours is a setting too.
 *
 * States a person reads, worked out from `active` and `activated_at`:
 *   draft   never activated; nothing fires
 *   active  fires from its activation onwards
 *   paused  switched off after it was active
 *
 * Every write needs the `queries.configure` capability (guide §8).
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { QueryStatus } = require("./queries");

const QueryRuleSource = z.enum([
  "lateness",
  "absence",
  "missing_clock_out",
  "unenrolled_device",
  "overdue_task",
  "missed_target",
]);
const QueryRuleMeasure = z.enum(["count", "minutes"]);
const QueryRuleState = z.enum(["draft", "active", "paused"]);

const threshold = z.number().int().min(1, "At least 1").max(100000);
const windowDays = z.number().int().min(1, "At least 1 day").max(366);
const letterKey = z.string().trim().min(2).max(64);

/** One rule as its card shows it. */
const QueryRule = z
  .object({
    query_rule_id: uuid,
    code: z.string(),
    name: z.string(),
    source_event: QueryRuleSource,
    measure: QueryRuleMeasure,
    threshold: z.number().int().min(1),
    window_days: z.number().int().min(1),
    letter_template: z.string().nullable(),
    state: QueryRuleState,
    active: z.boolean(),
    activated_at: isoDateTime.nullable(),
    fired_this_month: z.number().int().min(0),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const QueryRulePage = Paged(QueryRule);

/** GET /query-rules */
const QueryRuleListQuery = listQuery(
  { state: QueryRuleState.optional(), source_event: QueryRuleSource.optional() },
  ["name", "created_at"],
);

const minutesOnlyForLateness = (v) =>
  !v.measure || v.measure === "count" || !v.source_event || v.source_event === "lateness";
const MINUTES_ONLY = { message: "Minutes count lateness only", path: ["measure"] };

/** POST /query-rules: saved as a draft. The code is made from the name. */
const QueryRuleCreate = z
  .object({
    name: text(80),
    source_event: QueryRuleSource,
    measure: QueryRuleMeasure.default("count"),
    threshold,
    window_days: windowDays,
    letter_template: letterKey.optional(),
  })
  .strict()
  .refine(minutesOnlyForLateness, MINUTES_ONLY);

/**
 * PATCH /query-rules/:id. The trigger and measure are fixed once a rule has fired
 * (its queries were counted that way); the threshold, window and letter may change
 * and apply from the next event.
 */
const QueryRuleUpdate = z
  .object({
    name: text(80).optional(),
    source_event: QueryRuleSource.optional(),
    measure: QueryRuleMeasure.optional(),
    threshold: threshold.optional(),
    window_days: windowDays.optional(),
    letter_template: letterKey.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field")
  .refine(minutesOnlyForLateness, MINUTES_ONLY);

/** GET /query-rules/summary */
const QueryRulesSummary = z
  .object({
    active: z.number().int().min(0),
    draft: z.number().int().min(0),
    fired_this_month: z.number().int().min(0),
    queries_raised: z.number().int().min(0),
  })
  .strict();

/** A firing is a query a rule raised: Rules · Recent Firings. */
const QueryRuleFiring = z
  .object({
    employee_query_id: uuid,
    number: z.string(),
    query_rule_id: uuid,
    rule_name: z.string(),
    employee: PersonRef,
    status: QueryStatus,
    created_at: isoDateTime,
  })
  .strict();

const QueryRuleFiringPage = Paged(QueryRuleFiring);

/** GET /query-rules/firings, newest first. */
const QueryRuleFiringListQuery = listQuery({ query_rule_id: uuid.optional() }, ["created_at"]);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  QueryRule: {
    table: "query_rule",
    virtual: {
      state: "draft, active or paused, from active and activated_at",
      fired_this_month: "queries this rule raised since the 1st, Lagos time",
    },
  },
  QueryRulePage: { table: null, reason: "a page of query rules" },
  QueryRuleListQuery: { table: null, reason: "list controls and filters for Rules" },
  QueryRuleCreate: { table: "query_rule" },
  QueryRuleUpdate: { table: "query_rule" },
  QueryRulesSummary: { table: null, reason: "counts over query_rule and the queries rules raised" },
  QueryRuleFiring: {
    table: "employee_query",
    virtual: {
      rule_name: "query_rule.name",
      employee: "the person, from employee and department",
    },
  },
  QueryRuleFiringPage: { table: null, reason: "a page of rule-raised queries" },
  QueryRuleFiringListQuery: { table: null, reason: "list controls for Recent Firings" },
};

module.exports = {
  TABLES,
  QueryRuleSource,
  QueryRuleMeasure,
  QueryRuleState,
  QueryRule,
  QueryRulePage,
  QueryRuleListQuery,
  QueryRuleCreate,
  QueryRuleUpdate,
  QueryRulesSummary,
  QueryRuleFiring,
  QueryRuleFiringPage,
  QueryRuleFiringListQuery,
};
