"use strict";
/**
 * Home · Alerts (docs/guides/home.md §3 steps 5 and 6, §6): the alerts a reader may see and
 * clear, and the rules that raise them.
 *
 * A rule is data: a metric, a threshold, for count metrics a window, a severity, and who
 * may clear its alerts (`permission_key`, a `<module>.<action>` grant). The shared engine
 * (src/shared/alerts/alerts.js) raises one open alert per rule and subject, and a person
 * clears or dismisses it. Clearing takes both the `alerts.clear` capability and the rule's
 * grant over the person the alert is about.
 *
 * Who reads what (home.md §5, §8): the list, the counts and one alert need `alerts.clear`
 * or `alerts.manage`; the rules need `alerts.manage`. A rule's key is made by the server
 * from its metric and name, so nobody types one.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDateTime, listQuery, Paged } = require("./common");
const { ACTIONS } = require("./identity");

const count = z.number().int().min(0);

const HOME_ALERT_SEVERITIES = ["low", "medium", "high"];
const HomeAlertSeverity = z.enum(HOME_ALERT_SEVERITIES);

/** Where an alert comes from, for the category chips and Alert Sources. */
const HOME_ALERT_CATEGORIES = ["attendance", "approval", "document", "people", "partnership", "budget", "recruitment"];
const HomeAlertCategory = z.enum(HOME_ALERT_CATEGORIES);

/**
 * How a metric is read against its threshold:
 *   count     the value reaching the threshold breaches it (3 late arrivals, 14 days waiting)
 *   deadline  a date coming within the threshold's days breaches it (a document expiring in
 *             30 days or less); `over_by` then holds the days left, 0 on the day itself and
 *             below 0 once the date has passed, and the screen says so. The threshold is
 *             whole days.
 */
const HomeAlertKind = z.enum(["count", "deadline"]);

/**
 * What an alert's `over_by` holds, from its metric's kind: how far past the threshold
 * (`over`, a count metric) or the days left before the date (`days_left`, a deadline
 * metric: "12.00" twelve days ahead, "0.00" on the day itself, "-2.00" two days after it has
 * passed). The Over By cell reads "+1", "12 days left", the day itself or Expired from it.
 */
const HomeAlertOverBy = z.enum(["over", "days_left"]);

/**
 * The metrics a rule can watch, in the order the New Rule form lists them. Each says what
 * both sides need: its category, how it is read, whether a rule on it counts over a
 * window of days ("3 late arrivals in 30 days"), and who clears its alerts unless the rule
 * says otherwise. src/modules/alerts/alerts.metrics.js computes each (its source, subject
 * and the milestone that owns its tables); a test holds its keys equal to these.
 */
const HOME_ALERT_METRICS = Object.freeze({
  approval_ageing: Object.freeze({ category: "approval", kind: "count", window: false, permission_key: "people.approve" }),
  document_expiry: Object.freeze({ category: "document", kind: "deadline", window: false, permission_key: "people.edit" }),
  confirmation_due: Object.freeze({ category: "people", kind: "deadline", window: false, permission_key: "people.edit" }),
  contract_ending: Object.freeze({ category: "people", kind: "deadline", window: false, permission_key: "people.edit" }),
  partner_inactivity: Object.freeze({ category: "partnership", kind: "count", window: false, permission_key: "partnerships.edit" }),
  budget_threshold: Object.freeze({ category: "budget", kind: "count", window: false, permission_key: "expenses.approve" }),
  recruitment_sla: Object.freeze({ category: "recruitment", kind: "count", window: false, permission_key: "recruitment.edit" }),
});
const HomeAlertMetric = z.enum(Object.keys(HOME_ALERT_METRICS));

/**
 * The metric of the rules the system keeps for the Attendance policy's consequence rules (home.md
 * §6 Alerts; attendance.md §6.16): one rule per policy rule, never offered on New Rule, never
 * edited or switched off on Alert Rules, never read by the sweep. Their alerts are the policy's
 * breaches, in the attendance category, with no Over By.
 */
const HOME_ALERT_POLICY_METRIC = "attendance_policy";

/** The Attendance policy's consequence rules, by their key in its rules (AttendanceRules). */
const HOME_ALERT_POLICY_RULES = Object.freeze(["late_rule", "early_rule", "absence_rule", "forgotten_rule", "location_rule"]);
const HomeAlertPolicyRuleKey = z.enum(HOME_ALERT_POLICY_RULES);

/** Open, or closed by a person: cleared (dealt with) or dismissed (not a real issue, or its rule was switched off). */
const HomeAlertState = z.enum(["open", "cleared", "dismissed"]);

/**
 * Who may clear a rule's alerts: a grant written `<module>.<action>` ("people.approve").
 * The server also holds the module to the access catalogue.
 */
const PermissionKey = z
  .string()
  .trim()
  .regex(new RegExp(`^[a-z][a-z_]*\\.(${ACTIONS.join("|")})$`), "Choose who clears");

/** A threshold, as the form sends it and the column keeps it: a number with at most two places. */
const threshold = z.coerce
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter a number");

/** Days a count metric looks back over. A form's empty field is "not given". */
const windowDays = z
  .union([z.coerce.number().int().min(1, "1 to 365").max(365, "1 to 365"), z.literal("")])
  .nullish()
  .transform((v) => (v === "" || v === null ? undefined : v));

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

/** One alert, as the Alerts list and the alert's sheet show it. */
const HomeAlert = z
  .object({
    home_alert_id: uuid,
    home_alert_rule_id: uuid,
    rule_name: z.string(),
    /** A plain string: a rule kept from before the metric list may name one it lacks. */
    metric: z.string(),
    category: HomeAlertCategory.nullable(),
    subject_type: z.string(),
    subject_id: z.string(),
    /** The employee the alert is about; null when it is about no one in particular (a budget). */
    subject_employee_id: uuid.nullable(),
    title: z.string(),
    trigger: z.string().nullable(),
    severity: HomeAlertSeverity,
    /** How far past the threshold, or for a deadline metric the days left ("12.00"; "0.00" on the day, below 0 once passed). */
    over_by: z.string().nullable(),
    /** Which of the two `over_by` is; null for a metric no longer in the list. */
    over_by_kind: HomeAlertOverBy.nullable(),
    /** The rule's threshold, unscaled ("3"). */
    threshold: z.string(),
    /** Who may clear it: the rule's grant. */
    permission_key: z.string(),
    /** The rule's grant as a person reads it ("People Approvers"): the Who Can Clear column. */
    who_can_clear: z.string(),
    raised_at: isoDateTime,
    last_seen_at: isoDateTime,
    escalated_at: isoDateTime.nullable(),
    cleared_at: isoDateTime.nullable(),
    cleared_by: uuid.nullable(),
    cleared_by_name: z.string().nullable(),
    outcome: z.enum(["cleared", "dismissed"]).nullable(),
    note: z.string().nullable(),
    /** Where the record the alert is about opens. */
    link: z.string().nullable(),
    /** The reader may clear or dismiss it: open, `alerts.clear`, and the rule's grant over its subject. */
    can_clear: z.boolean(),
  })
  .strict();

/**
 * GET /home/alerts: open alerts, newest first, unless `state` asks for the cleared or the
 * dismissed (View Dismissed). `mine`: only those the reader may clear (Needs You).
 * `overdue`: open more than seven days.
 */
const HomeAlertQuery = listQuery(
  {
    category: HomeAlertCategory.optional(),
    severity: HomeAlertSeverity.optional(),
    state: HomeAlertState.optional(),
    mine: z.enum(["true", "false"]).optional(),
    overdue: z.enum(["true", "false"]).optional(),
    home_alert_rule_id: uuid.optional(),
  },
  ["raised_at", "severity"],
);
const HomeAlertPage = Paged(HomeAlert);

/** GET /home/alerts/summary: the four cards, the chips and Alert Sources, over what the reader may see. */
const HomeAlertSummary = z
  .object({
    open: count,
    /** Open alerts the reader may clear. */
    needs_you: count,
    /** Open more than seven days. */
    overdue: count,
    /** Cleared since Monday (Lagos). Dismissed alerts are not counted. */
    cleared_this_week: count,
    /** Open alerts by category, for the chips. */
    categories: z.array(z.object({ category: HomeAlertCategory, count }).strict()).max(HOME_ALERT_CATEGORIES.length),
    /** Alerts raised in the last 30 days by metric, cleared ones included, most first. */
    sources: z.array(z.object({ metric: z.string(), count }).strict()).max(25),
  })
  .strict();

/**
 * POST /home/alerts/:id/clear: cleared (dealt with) or dismissed (not a real issue). Clearing
 * an alert already closed answers it as it stands, with no second audit entry.
 */
const HomeAlertClear = z
  .object({
    outcome: z.enum(["cleared", "dismissed"]).default("cleared"),
    note: optionalText(500),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/** One rule, as Alert Rules and the rule form show it. */
const HomeAlertRule = z
  .object({
    home_alert_rule_id: uuid,
    key: z.string(),
    name: z.string(),
    /** A plain string: a rule kept from before the metric list may name one it lacks. */
    metric: z.string(),
    category: HomeAlertCategory.nullable(),
    kind: HomeAlertKind.nullable(),
    threshold: z.string(),
    window_days: z.number().int().nullable(),
    severity: HomeAlertSeverity,
    permission_key: z.string(),
    /** The grant as a person reads it ("People Approvers"). */
    who_can_clear: z.string(),
    enabled: z.boolean(),
    open_alerts: count,
    created_by: uuid.nullable(),
    updated_by: uuid.nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

/** GET /home/alert-rules */
const HomeAlertRuleQuery = listQuery(
  {
    metric: HomeAlertMetric.optional(),
    category: HomeAlertCategory.optional(),
    enabled: z.enum(["true", "false"]).optional(),
  },
  ["name", "created_at"],
);
const HomeAlertRulePage = Paged(HomeAlertRule);

/**
 * A rule fits its metric: a window belongs to a metric that counts over days, and to no
 * other; a deadline is whole days before the date.
 */
function ruleFits(v, ctx) {
  const metric = HOME_ALERT_METRICS[v.metric];
  if (!metric) return;
  if (metric.window && v.window_days === undefined)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["window_days"], message: "Enter the days" });
  if (!metric.window && v.window_days !== undefined)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["window_days"], message: "Not for this metric" });
  if (metric.kind === "deadline" && typeof v.threshold === "string" && !/^\d+(\.0{1,2})?$/.test(v.threshold))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["threshold"], message: "Whole days only" });
}

/** POST /home/alert-rules. Who clears defaults to the metric's `permission_key` on the form. */
const HomeAlertRuleCreate = z
  .object({
    name: text(80),
    metric: HomeAlertMetric,
    threshold,
    window_days: windowDays,
    severity: HomeAlertSeverity,
    permission_key: PermissionKey,
  })
  .strict()
  .superRefine(ruleFits);

/**
 * PATCH /home/alert-rules/:id: any of a rule's numbers, its name, who clears it, and its
 * switch. Its metric stays (the key is made from it), so the service holds the change to
 * the metric as POST does. Switching a rule off dismisses its open alerts as the rule change.
 */
const HomeAlertRuleUpdate = z
  .object({
    name: text(80),
    threshold,
    window_days: windowDays,
    severity: HomeAlertSeverity,
    permission_key: PermissionKey,
    enabled: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" });

/**
 * GET /home/alert-rules/policy: the Attendance policy's five consequence rules, read only, as the
 * version in force today sets them. `figures` is the rule in words ("3 late arrivals in a month or 5
 * hours"), null while it is off. `can_set` says whether the reader may open the policy to change
 * them (`policies.manage`).
 */
const HomeAlertPolicyRules = z
  .object({
    policy_version_id: uuid.nullable(),
    version: z.number().int().min(1).nullable(),
    rules: z
      .array(
        z
          .object({
            rule: HomeAlertPolicyRuleKey,
            name: z.string(),
            on: z.boolean(),
            figures: z.string().nullable(),
            alert: z.boolean(),
            query: z.boolean(),
            open_alerts: count,
          })
          .strict(),
      )
      .length(HOME_ALERT_POLICY_RULES.length),
    can_set: z.boolean(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  HomeAlert: {
    table: "home_alert",
    virtual: {
      rule_name: "the rule's name, from home_alert_rule",
      metric: "the rule's metric, from home_alert_rule",
      category: "the metric's category in HOME_ALERT_METRICS",
      over_by_kind: "from the metric's kind in HOME_ALERT_METRICS: a deadline metric's over_by is the days left, below 0 once passed",
      threshold: "the rule's threshold, from home_alert_rule",
      permission_key: "the rule's grant, from home_alert_rule",
      who_can_clear: "the rule's grant worded from the access catalogue's module label and its action",
      cleared_by_name: "the name of the login in cleared_by",
      link: "derived from subject_type and subject_id through shared/route-map.js",
      can_clear: "open, the reader holds alerts.clear, and the rule's grant reaches the subject",
    },
  },
  HomeAlertQuery: { table: null, reason: "list controls and the Alerts list's filters" },
  HomeAlertPage: { table: null, reason: "a page of alerts" },
  HomeAlertSummary: { table: null, reason: "counts over home_alert for the alerts the reader may see" },
  HomeAlertClear: { table: "home_alert" },
  HomeAlertRule: {
    table: "home_alert_rule",
    virtual: {
      category: "the metric's category in HOME_ALERT_METRICS",
      kind: "the metric's kind in HOME_ALERT_METRICS",
      who_can_clear: "permission_key worded from the access catalogue's module label and its action",
      open_alerts: "counted from the rule's home_alert rows not yet cleared",
    },
  },
  HomeAlertRuleQuery: { table: null, reason: "list controls and the Alert Rules filters" },
  HomeAlertRulePage: { table: null, reason: "a page of alert rules" },
  HomeAlertRuleCreate: { table: "home_alert_rule" },
  HomeAlertRuleUpdate: { table: "home_alert_rule" },
  HomeAlertPolicyRules: {
    table: null,
    reason: "the Attendance policy's consequence rules in force today, from its version, with their open alerts",
  },
};

module.exports = {
  TABLES,
  HOME_ALERT_SEVERITIES,
  HOME_ALERT_CATEGORIES,
  HOME_ALERT_METRICS,
  HOME_ALERT_POLICY_METRIC,
  HOME_ALERT_POLICY_RULES,
  HomeAlertPolicyRuleKey,
  HomeAlertSeverity,
  HomeAlertCategory,
  HomeAlertKind,
  HomeAlertOverBy,
  HomeAlertMetric,
  HomeAlertState,
  HomeAlert,
  HomeAlertQuery,
  HomeAlertPage,
  HomeAlertSummary,
  HomeAlertClear,
  HomeAlertRule,
  HomeAlertRuleQuery,
  HomeAlertRulePage,
  HomeAlertRuleCreate,
  HomeAlertRuleUpdate,
  HomeAlertPolicyRules,
};
