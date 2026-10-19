"use strict";
/**
 * Approval definitions: where they are stored, and the ones the code ships with.
 *
 * The stored definitions (workflow_definition) are the truth. Settings, Approvals
 * edits them; an edit saves a NEW version, so an approval already in flight keeps
 * the stages it started with (each instance points at the version it opened on).
 *
 * DEFAULTS are the routes the code ships. Each milestone's migration seeds the
 * definitions it introduces, and also adds them here, so:
 *  - an approval works on a fresh database before anyone opens Settings (the engine
 *    saves the default as version 1 the first time it is needed), and
 *  - the shape of every shipped route is reviewed in code, with the gate below.
 *
 * M0 ships two. `test.threshold` proves the engine end to end: one stage for every
 * request, a second when the amount is ₦500,000.00 or more. `leave.approval` is the
 * leave flow (docs/guides/foundation.md §6.5, seeded in 0499): the line manager, then
 * Operations & People when the request is over 5 days, a number Operations & People
 * change on Settings, Approvals.
 * M1 adds `attendance.location_request` (docs/guides/attendance.md §6.11, seeded in
 * 1392): a work location request, the line manager then Operations & People; and
 * `policy.approval` (docs/guides/policies.md §6.4, seeded in 1396): a policy version, the CEO.
 * Attendance's PR 4 adds `attendance.temporary_site` (docs/guides/attendance.md §6.11, seeded in
 * 1470): a temporary site, Operations & People; everyone on the site is excluded from deciding it.
 * M2 Performance adds four (docs/guides/performance.md §6.4, §6.7, §6.11, §6.12; seeded in 2190):
 * `performance.plan` (a quarter plan: the head's line manager unless the head reports to the CEO,
 * Operations & People unless they sent it, then the CEO; the company plan goes to the CEO alone),
 * `performance.target_change` (the CEO), `performance.commitments` (the person's reviewer, or the
 * CEO for a function head) and `performance.review` (the reviewer's own manager, skipped when the
 * reviewer is the CEO, then Operations & People; the reviewee is excluded from deciding it).
 * M3 adds `queries.consequence` (docs/guides/queries.md §6.5, seeded in 3190): a proposed
 * sanction, Operations & People, then Management from the fourth rung.
 *
 * Table (migration 0070; BACKEND_STRUCTURE §11.1):
 *   workflow_definition  workflow_definition_id, key, version, module_key, name, description,
 *                        context_types jsonb, stages jsonb, active, created_by, created_at;
 *                        UNIQUE (key, version)
 */
const { AppError } = require("../errors");
const catalog = require("../access/access.catalog");
const conditions = require("./conditions");

/**
 * key → authored definition. `module` is the permission key whose records the
 * approval is about; the Approvals screen groups by it and its events carry it.
 */
const DEFAULTS = Object.freeze({
  "test.threshold": {
    key: "test.threshold",
    module: "settings",
    name: "Threshold Test",
    description:
      "Proves the approval engine: a line manager for every request, the CEO from ₦500,000.00.",
    context: { amount: "money" },
    stages: [
      {
        key: "manager",
        name: "Line Manager",
        approver: { type: "manager_of_subject" },
        sla_hours: 48,
      },
      {
        key: "ceo",
        name: "CEO",
        approver: { type: "ceo" },
        condition: { field: "amount", op: ">=", value: "500000.00" },
        sla_hours: 48,
      },
    ],
  },
  "leave.approval": {
    key: "leave.approval",
    module: "people",
    name: "Leave Request",
    description: "The line manager, then Operations & People when the request is over 5 days.",
    context: { days: "number" },
    stages: [
      {
        key: "line_manager",
        name: "Line Manager",
        approver: { type: "manager_of_subject" },
        sla_hours: 48,
      },
      {
        key: "operations_people",
        name: "Operations & People",
        approver: { type: "role", value: "operations_people" },
        condition: { field: "days", op: ">", value: 5 },
        sla_hours: 48,
      },
    ],
  },
  // M1, seeded in 1392 (docs/guides/attendance.md §6.11).
  "attendance.location_request": {
    key: "attendance.location_request",
    module: "people",
    name: "Work Location Request",
    description: "The line manager, then Operations & People.",
    context: { days: "number" },
    stages: [
      {
        key: "line_manager",
        name: "Line Manager",
        approver: { type: "manager_of_subject" },
        sla_hours: 48,
      },
      {
        key: "operations_people",
        name: "Operations & People",
        approver: { type: "role", value: "operations_people" },
        sla_hours: 48,
      },
    ],
  },
  // M1, seeded in 1470 (docs/guides/attendance.md §6.11).
  "attendance.temporary_site": {
    key: "attendance.temporary_site",
    module: "people",
    name: "Temporary Site",
    description: "Operations & People approve where people work for some days.",
    context: { days: "number" },
    stages: [
      {
        key: "operations_people",
        name: "Operations & People",
        approver: { type: "role", value: "operations_people" },
        sla_hours: 48,
      },
    ],
  },
  // M1, seeded in 1396 (docs/guides/policies.md §6.4).
  "policy.approval": {
    key: "policy.approval",
    module: "knowledge",
    name: "Policy Approval",
    description: "The CEO approves and signs a policy version before it can start.",
    context: {},
    stages: [{ key: "ceo", name: "CEO", approver: { type: "ceo" }, sla_hours: 72 }],
  },
  // M2, seeded in 2190 (docs/guides/performance.md §6.4).
  "performance.plan": {
    key: "performance.plan",
    module: "performance",
    name: "Quarter Plan",
    description:
      "The head's line manager, Operations & People, then the CEO. The company plan goes to the CEO.",
    context: { head_reports_to_ceo: "boolean", by_operations_people: "boolean", is_company: "boolean" },
    stages: [
      {
        key: "line_manager",
        name: "Line Manager",
        approver: { type: "manager_of_subject" },
        condition: [
          { field: "head_reports_to_ceo", op: "=", value: false },
          { field: "is_company", op: "=", value: false },
        ],
        sla_hours: 72,
      },
      {
        key: "operations_people",
        name: "Operations & People",
        approver: { type: "role", value: "operations_people" },
        condition: [
          { field: "by_operations_people", op: "=", value: false },
          { field: "is_company", op: "=", value: false },
        ],
        sla_hours: 72,
      },
      { key: "ceo", name: "CEO", approver: { type: "ceo" }, sla_hours: 72 },
    ],
  },
  // M2, seeded in 2190 (docs/guides/performance.md §6.7).
  "performance.target_change": {
    key: "performance.target_change",
    module: "performance",
    name: "Target Change",
    description: "The CEO approves a change to a binding target.",
    context: {},
    stages: [{ key: "ceo", name: "CEO", approver: { type: "ceo" }, sla_hours: 72 }],
  },
  // M2, seeded in 2190 (docs/guides/performance.md §6.11).
  "performance.commitments": {
    key: "performance.commitments",
    module: "performance",
    name: "Monthly Commitments",
    description: "The person's reviewer approves the month's commitments; the CEO approves a head's.",
    context: { is_function_head: "boolean", reviewer_employee_id: "uuid" },
    stages: [
      {
        key: "reviewer",
        name: "Reviewer",
        approver: { type: "employee_in_context", value: "reviewer_employee_id" },
        condition: { field: "is_function_head", op: "=", value: false },
        sla_hours: 48,
      },
      {
        key: "ceo",
        name: "CEO",
        approver: { type: "ceo" },
        condition: { field: "is_function_head", op: "=", value: true },
        sla_hours: 48,
      },
    ],
  },
  // M2, seeded in 2190 (docs/guides/performance.md §6.12).
  "performance.review": {
    key: "performance.review",
    module: "performance",
    name: "Monthly Review",
    description: "The reviewer's own manager, then Operations & People close it.",
    context: { second_level_employee_id: "uuid", reviewer_is_ceo: "boolean" },
    stages: [
      {
        key: "second_level",
        name: "Second Level",
        approver: { type: "employee_in_context", value: "second_level_employee_id" },
        condition: { field: "reviewer_is_ceo", op: "=", value: false },
        sla_hours: 48,
      },
      {
        key: "operations_people",
        name: "Operations & People",
        approver: { type: "role", value: "operations_people" },
        sla_hours: 48,
      },
    ],
  },
  // M3, seeded in 3190 (docs/guides/queries.md §6.5): who approves a proposed sanction.
  // `rank` is the rung's position on the chain when it was proposed.
  "queries.consequence": {
    key: "queries.consequence",
    module: "queries",
    name: "Sanction",
    description: "Operations & People, then Management from Suspension up.",
    context: { rank: "number", fine_amount: "money" },
    stages: [
      {
        key: "operations_people",
        name: "Operations & People",
        approver: { type: "role", value: "operations_people" },
        sla_hours: 48,
      },
      {
        key: "management",
        name: "Management",
        approver: { type: "role", value: "management" },
        condition: { field: "rank", op: ">=", value: 4 },
        sla_hours: 48,
      },
    ],
  },
});

/**
 * Every problem with a definition, including the module key.
 * @returns {string[]}
 */
function problemsOf(def) {
  const out = conditions.validateDefinition(def);
  if (!def || !catalog.isModule(def.module))
    out.push(`module "${def && def.module}" is not a module key`);
  return out;
}

/** Throw a 422 listing every problem, or return the definition. */
function assertValid(def) {
  const problems = problemsOf(def);
  if (problems.length) {
    throw new AppError(
      "WORKFLOW_DEFINITION_INVALID",
      `This approval route is not valid: ${problems.join("; ")}`,
      422,
      {
        stages: problems,
      },
    );
  }
  return def;
}

function getDefault(key) {
  return DEFAULTS[key] || null;
}

/** The row shape the engine works with, from a stored row. */
function fromRow(row) {
  if (!row) return null;
  return {
    workflow_definition_id: row.workflow_definition_id,
    key: row.key,
    version: Number(row.version),
    module: row.module_key,
    name: row.name,
    description: row.description,
    context: row.context_types || {},
    stages: row.stages || [],
    active: row.active,
  };
}

/** The active, highest version of a definition, or null. */
async function findActive(client, key) {
  const { rows } = await client.query(
    `SELECT workflow_definition_id, key, version, module_key, name, description, context_types, stages, active
       FROM workflow_definition
      WHERE key = $1 AND active = true
      ORDER BY version DESC
      LIMIT 1`,
    [key],
  );
  return fromRow(rows[0]);
}

/** One stored version by id (an instance's own version, even if since replaced). */
async function findById(client, id) {
  const { rows } = await client.query(
    `SELECT workflow_definition_id, key, version, module_key, name, description, context_types, stages, active
       FROM workflow_definition WHERE workflow_definition_id = $1`,
    [id],
  );
  return fromRow(rows[0]);
}

/**
 * Save a definition as a new active version; earlier versions of the key are
 * deactivated in the same transaction. Instances already open keep theirs.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {object} def  authored definition
 * @param {{created_by?: string|null}} [opts]
 */
async function saveVersion(client, def, { created_by: createdBy = null } = {}) {
  assertValid(def);
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('workflow_definition:' || $1))",
    [def.key],
  );
  const { rows: cur } = await client.query(
    "SELECT COALESCE(max(version), 0) AS v FROM workflow_definition WHERE key = $1",
    [def.key],
  );
  const version = Number(cur[0].v) + 1;
  await client.query(
    "UPDATE workflow_definition SET active = false WHERE key = $1 AND active = true",
    [def.key],
  );
  const { rows } = await client.query(
    `INSERT INTO workflow_definition
       (key, version, module_key, name, description, context_types, stages, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, true, $8)
     RETURNING workflow_definition_id, key, version, module_key, name, description, context_types, stages, active`,
    [
      def.key,
      version,
      def.module,
      def.name,
      def.description || null,
      JSON.stringify(def.context || {}),
      JSON.stringify(def.stages),
      createdBy,
    ],
  );
  return fromRow(rows[0]);
}

/**
 * The active definition, saving the shipped default as version 1 when the key has
 * never been stored. Refuses a key that is neither stored nor shipped.
 */
async function ensureActive(client, key) {
  const found = await findActive(client, key);
  if (found) return found;
  const spec = getDefault(key);
  if (!spec) {
    throw new AppError(
      "WORKFLOW_NOT_CONFIGURED",
      `There is no approval route "${key}". Set it up in Settings, Approvals.`,
      409,
    );
  }
  // Two first requests at once: the advisory lock in saveVersion serialises them, and
  // the second finds the first one's row.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('workflow_definition:' || $1))",
    [key],
  );
  return (await findActive(client, key)) || saveVersion(client, spec);
}

module.exports = {
  DEFAULTS,
  getDefault,
  problemsOf,
  assertValid,
  fromRow,
  findActive,
  findById,
  saveVersion,
  ensureActive,
};
