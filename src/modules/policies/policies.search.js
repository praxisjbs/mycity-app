"use strict";
/**
 * ⌘K for policies (docs/guides/policies.md §9). Those who write policies (`policies.manage`) find
 * every policy by its number or title, opening Knowledge Hub · Policies. Everyone finds the
 * published policies that apply to them by title, opening Policy Updates on the newest version:
 * the query is pinned to the caller (`owner`), and Applies To decides the rest, as the screen does.
 */
const { recordProvider } = require("../../shared/search/provider");

const LAGOS_TODAY = "(now() AT TIME ZONE 'Africa/Lagos')::date";

module.exports = [
  recordProvider({
    type: "policy",
    module: "knowledge",
    capability: "policies.manage",
    label: "Policies",
    words: ["policy", "policies", "handbook"],
    from: "policy p",
    key: "p.policy_id",
    columns: ["p.number", "p.title"],
    select: "p.policy_id AS id, p.number AS ref, p.title AS title, p.kind AS sub, p.status AS status",
    order: "p.title",
  }),
  recordProvider({
    type: "policy_version",
    module: "ess",
    label: "My Policies",
    words: ["policy", "policies", "handbook", "acknowledge"],
    from: `policy_version v
      JOIN policy p ON p.policy_id = v.policy_id AND p.status = 'active'
      JOIN app_user u ON u.status = 'active'
      JOIN employee e ON e.employee_id = u.employee_id`,
    key: "v.policy_version_id",
    columns: ["v.title", "p.number"],
    select:
      "v.policy_version_id AS id, p.number AS ref, v.title AS title, 'Version ' || v.version AS sub, NULL::text AS status",
    where: `v.status = 'published'
      AND NOT EXISTS (SELECT 1 FROM policy_version nv
                       WHERE nv.policy_id = v.policy_id AND nv.status = 'published' AND nv.version > v.version)
      AND (v.applies_to_everyone OR EXISTS (
            SELECT 1 FROM policy_audience pa
             WHERE pa.policy_version_id = v.policy_version_id
               AND (pa.department_id = e.department_id OR pa.work_pattern = e.work_pattern OR pa.employee_id = e.employee_id)))
      AND e.status = 'active' AND (e.start_date IS NULL OR e.start_date <= ${LAGOS_TODAY})`,
    order: "v.title",
    owner: { column: "u.user_id" },
  }),
];
