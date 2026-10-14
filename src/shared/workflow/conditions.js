"use strict";
/**
 * Which approval stages apply to a request. Pure: no database, no clock, so the
 * routing of every approval in the system can be tested on its own.
 *
 * A definition is data (workflow_definition, edited in Settings, Approvals):
 *
 *   {
 *     key: "expense.approval",
 *     module: "expenses",
 *     name: "Expense Approval",
 *     context: { amount: "money", category: "text" },
 *     stages: [
 *       { key: "manager", name: "Line Manager", approver: { type: "manager_of_subject" } },
 *       { key: "ceo", name: "CEO", approver: { type: "ceo" },
 *         condition: { field: "amount", op: ">=", value: "500000.00" } },
 *     ],
 *   }
 *
 * Stages run in the order listed. A stage whose condition is false for this request
 * is SKIPPED, not run: a ₦120,000 expense goes to the manager and completes; a
 * ₦750,000 one goes to the manager, then the CEO. Adding a step is adding an object
 * to `stages`; it needs no deploy.
 *
 * A condition is one comparison against the request's context, or a list of them
 * that must all hold. One operator set, no expression language:
 *
 *   { field, op, value }     op: ">=" ">" "=" "<" "<=" "in"
 *
 * `context` names every field a condition may read and its type. The type decides
 * how values compare:
 *
 *   money     exact decimal comparison (shared/money), never a JS number
 *   number    numeric (counts, days, percentages)
 *   date      "YYYY-MM-DD", compared as dates
 *   text, uuid, boolean   "=" and "in" only
 *
 * A request must carry every field its definition declares. A missing amount is
 * refused rather than read as zero, because zero would silently skip a stage meant
 * for large amounts.
 *
 * Stage fields, after normalise():
 *
 *   key          unique within the definition, snake_case; stored on the instance
 *   name         shown to people
 *   approvers    any of: { type: "role", value: <role code> }, { type: "user", value: <user id> },
 *                { type: "manager_of_subject" }, { type: "ceo" }. `approver` (one) is accepted.
 *   condition    null (always applies), one comparison, or a list of them
 *   sla_hours    how long the stage may wait before on_timeout applies (default 48)
 *   on_timeout   "escalate" (default; re-arm and tell the CEO), "auto_approve", "auto_reject"
 *   on_approve   "next" (default) or "complete" (finish here even if later stages apply)
 *   on_reject    "reject" (default; the request ends) or "return" (back to the first stage)
 *
 * An approval whose context carries money never approves itself: validateDefinition
 * refuses on_timeout "auto_approve" on any stage of such a definition.
 */
const money = require("../money/money");

const OPS = new Set([">=", ">", "=", "<", "<=", "in"]);
const ORDERED = new Set([">=", ">", "<", "<="]);
const TYPES = new Set(["money", "number", "date", "text", "uuid", "boolean"]);
const ORDERABLE = new Set(["money", "number", "date"]);
const APPROVER_TYPES = new Set(["role", "user", "manager_of_subject", "ceo"]);
const ON_TIMEOUT = new Set(["escalate", "auto_approve", "auto_reject"]);
const ON_APPROVE = new Set(["next", "complete"]);
const ON_REJECT = new Set(["reject", "return"]);
const KEY_RE = /^[a-z][a-z0-9_]*$/;
const DEF_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_SLA_HOURS = 48;

/* ------------------------------------------------------------------ *
 * Values
 * ------------------------------------------------------------------ */

function checkValue(type, value) {
  switch (type) {
    case "money":
      try {
        money.money(value);
        return true;
      } catch {
        return false;
      }
    case "number":
      return typeof value === "number" ? Number.isFinite(value) : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
    case "date":
      return typeof value === "string" && DATE_RE.test(value);
    case "boolean":
      return typeof value === "boolean";
    case "uuid":
      return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    case "text":
      return typeof value === "string";
    default:
      return false;
  }
}

/** -1, 0 or 1. Only for the orderable types. */
function compareTyped(type, a, b) {
  if (type === "money") return money.compare(a, b);
  if (type === "number") {
    const x = Number(a);
    const y = Number(b);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  // date: ISO strings order as dates
  return a === b ? 0 : a < b ? -1 : 1;
}

function equalTyped(type, a, b) {
  if (type === "money") return money.compare(a, b) === 0;
  if (type === "number") return Number(a) === Number(b);
  if (type === "uuid") return String(a).toLowerCase() === String(b).toLowerCase();
  return a === b;
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

/**
 * Does `condition` hold for `context`? null holds. A list holds when every item does.
 * @param {object|object[]|null} condition
 * @param {Record<string, unknown>} context
 * @param {Record<string, string>} types  definition.context
 */
function evaluate(condition, context, types) {
  if (condition === null || condition === undefined) return true;
  if (Array.isArray(condition)) return condition.every((c) => evaluate(c, context, types));
  const type = types[condition.field];
  const actual = context[condition.field];
  if (!type) throw new Error(`workflow condition reads "${condition.field}", which the definition's context does not declare`);
  if (actual === undefined || actual === null) {
    throw new Error(`workflow context is missing "${condition.field}"`);
  }
  switch (condition.op) {
    case "=":
      return equalTyped(type, actual, condition.value);
    case "in":
      return condition.value.some((v) => equalTyped(type, actual, v));
    case ">=":
      return compareTyped(type, actual, condition.value) >= 0;
    case ">":
      return compareTyped(type, actual, condition.value) > 0;
    case "<=":
      return compareTyped(type, actual, condition.value) <= 0;
    case "<":
      return compareTyped(type, actual, condition.value) < 0;
    default:
      throw new Error(`workflow condition: unknown operator "${condition.op}"`);
  }
}

/* ------------------------------------------------------------------ *
 * Stages
 * ------------------------------------------------------------------ */

function normaliseApprover(a) {
  if (!a || typeof a !== "object") return a;
  return a.value === undefined ? { type: a.type } : { type: a.type, value: a.value };
}

/** The canonical shape of one authored stage. */
function normaliseStage(raw) {
  const s = raw || {};
  let approvers = [];
  if (Array.isArray(s.approvers)) approvers = s.approvers;
  else if (s.approver) approvers = [s.approver];
  return {
    key: s.key,
    name: s.name || s.key,
    approvers: approvers.map(normaliseApprover),
    condition: s.condition === undefined ? null : s.condition,
    sla_hours: s.sla_hours === undefined || s.sla_hours === null ? DEFAULT_SLA_HOURS : s.sla_hours,
    on_timeout: s.on_timeout || "escalate",
    on_approve: s.on_approve || "next",
    on_reject: s.on_reject || "reject",
  };
}

/** Stages in order, normalised. Accepts the stored row or the authored object. */
function stagesOf(definition) {
  return ((definition && definition.stages) || []).map(normaliseStage);
}

function typesOf(definition) {
  return (definition && (definition.context_types || definition.context)) || {};
}

/** Stages that apply to this context, in order. */
function applicableStages(definition, context) {
  const types = typesOf(definition);
  return stagesOf(definition).filter((stage) => evaluate(stage.condition, context, types));
}

/** Does this request need any approval at all? */
function requiresApproval(definition, context) {
  return applicableStages(definition, context).length > 0;
}

/** Where a new instance starts, or null when nothing applies. */
function firstApplicableStage(definition, context) {
  return applicableStages(definition, context)[0] || null;
}

/** The applicable stage after `afterKey`, or null when none remain. */
function nextApplicableStage(definition, context, afterKey) {
  const all = stagesOf(definition);
  const at = all.findIndex((s) => s.key === afterKey);
  const types = typesOf(definition);
  return all.slice(at + 1).find((s) => evaluate(s.condition, context, types)) || null;
}

function stageByKey(definition, key) {
  return stagesOf(definition).find((s) => s.key === key) || null;
}

/** True when any context field is money (auto-approval is then refused). */
function carriesMoney(definition) {
  return Object.values(typesOf(definition)).includes("money");
}

/* ------------------------------------------------------------------ *
 * Checking
 * ------------------------------------------------------------------ */

function conditionProblems(cond, types, where) {
  if (cond === null || cond === undefined) return [];
  if (Array.isArray(cond)) {
    if (cond.length === 0) return [`${where}: an empty condition list; use null for "always"`];
    return cond.flatMap((c, i) => conditionProblems(c, types, `${where}[${i}]`));
  }
  if (typeof cond !== "object") return [`${where}: a condition is { field, op, value }`];
  const out = [];
  const extra = Object.keys(cond).filter((k) => !["field", "op", "value"].includes(k));
  if (extra.length) out.push(`${where}: unknown keys ${extra.join(", ")}`);
  const type = types[cond.field];
  if (!type) out.push(`${where}: field "${cond.field}" is not declared in context`);
  if (!OPS.has(cond.op)) out.push(`${where}: op must be one of ${[...OPS].join(" ")}`);
  if (type && ORDERED.has(cond.op) && !ORDERABLE.has(type)) out.push(`${where}: "${cond.op}" needs a money, number or date field; "${cond.field}" is ${type}`);
  if (type && OPS.has(cond.op)) {
    const values = cond.op === "in" ? cond.value : [cond.value];
    if (cond.op === "in" && (!Array.isArray(cond.value) || cond.value.length === 0)) out.push(`${where}: "in" takes a non-empty list`);
    else if (!values.every((v) => checkValue(type, v))) out.push(`${where}: value does not fit a ${type} field`);
  }
  return out;
}

/**
 * Every problem with a definition, as sentences. Empty means it is valid.
 * @param {object} def  the authored definition (key, module, name, context, stages)
 * @returns {string[]}
 */
function validateDefinition(def) {
  const out = [];
  if (!def || typeof def !== "object") return ["a definition is an object"];
  if (!DEF_KEY_RE.test(String(def.key || ""))) out.push('key is dotted snake_case, e.g. "expense.approval"');
  if (typeof def.name !== "string" || !def.name.trim()) out.push("name is required");
  const types = typesOf(def);
  if (typeof types !== "object" || Array.isArray(types)) out.push("context maps field names to types");
  for (const [field, type] of Object.entries(types || {})) {
    if (!KEY_RE.test(field)) out.push(`context field "${field}" is not snake_case`);
    if (!TYPES.has(type)) out.push(`context field "${field}": type must be one of ${[...TYPES].join(", ")}`);
  }
  const stages = def.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    out.push("at least one stage is required");
    return out;
  }
  const seen = new Set();
  const hasMoney = carriesMoney(def);
  stages.forEach((raw, i) => {
    const s = normaliseStage(raw);
    const where = `stage ${i + 1}${s.key ? ` (${s.key})` : ""}`;
    if (!KEY_RE.test(String(s.key || ""))) out.push(`${where}: key is snake_case`);
    else if (seen.has(s.key)) out.push(`${where}: key is used twice`);
    seen.add(s.key);
    if (s.approvers.length === 0) out.push(`${where}: name at least one approver`);
    for (const a of s.approvers) {
      if (!a || !APPROVER_TYPES.has(a.type)) {
        out.push(`${where}: approver type must be one of ${[...APPROVER_TYPES].join(", ")}`);
      } else if ((a.type === "role" || a.type === "user") && (typeof a.value !== "string" || !a.value)) {
        out.push(`${where}: a ${a.type} approver needs a value`);
      } else if (a.type === "user" && !checkValue("uuid", a.value)) {
        out.push(`${where}: a user approver's value is a user id`);
      }
    }
    if (!Number.isFinite(s.sla_hours) || s.sla_hours <= 0 || s.sla_hours > 24 * 90) out.push(`${where}: sla_hours is between 1 and 2160`);
    if (!ON_TIMEOUT.has(s.on_timeout)) out.push(`${where}: on_timeout is escalate, auto_approve or auto_reject`);
    if (hasMoney && s.on_timeout === "auto_approve") out.push(`${where}: an approval that carries money never approves itself on timeout`);
    if (!ON_APPROVE.has(s.on_approve)) out.push(`${where}: on_approve is next or complete`);
    if (!ON_REJECT.has(s.on_reject)) out.push(`${where}: on_reject is reject or return`);
    out.push(...conditionProblems(s.condition, types || {}, `${where} condition`));
  });
  return out;
}

/**
 * Refuse a context that does not fit its definition: every declared field present
 * and of its type, nothing undeclared.
 * @returns {string[]} problems
 */
function contextProblems(definition, context) {
  const types = typesOf(definition);
  const out = [];
  if (!context || typeof context !== "object" || Array.isArray(context)) return ["context is an object"];
  for (const [field, type] of Object.entries(types)) {
    if (context[field] === undefined || context[field] === null) out.push(`context is missing "${field}"`);
    else if (!checkValue(type, context[field])) out.push(`context "${field}" is not a ${type}`);
  }
  for (const field of Object.keys(context)) {
    if (!Object.prototype.hasOwnProperty.call(types, field)) out.push(`context "${field}" is not declared by the definition`);
  }
  return out;
}

module.exports = {
  OPS,
  TYPES,
  APPROVER_TYPES,
  DEFAULT_SLA_HOURS,
  evaluate,
  normaliseStage,
  stagesOf,
  typesOf,
  applicableStages,
  requiresApproval,
  firstApplicableStage,
  nextApplicableStage,
  stageByKey,
  carriesMoney,
  validateDefinition,
  contextProblems,
  checkValue,
};
