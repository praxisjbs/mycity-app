"use strict";
/**
 * The test matrix a registry implies (docs/guides/praxis-ai.md §1.2 decision 26): every read,
 * summary and action crossed with every role, each case saying what the screen's own rule
 * expects, so a test can run it and a mismatch blocks the build. The generator knows nothing of
 * MyCity: the roles and the rule (`may`) arrive as arguments.
 *
 *   const cases = casesFor({ tools: registry entries, roles: ["ceo", "employee", ...], may: (role, module, action) => boolean });
 *   // → [{ kind: "read", key: "employees.list", role: "employee", module: "people", action: "view", expect: "refused" }, ...]
 *
 * A tool that carries a `matrix` probe ({ inside, outside }) also yields a scope case per role
 * that may run it: the inside record must be returned or accepted, the outside one never.
 */

/**
 * @param {{tools: Array<{key: string, kind: string, module: string, permission: [string, string], matrix?: object}>,
 *          roles: string[], may: (role: string, module: string, action: string) => boolean}} q
 */
function casesFor({ tools, roles, may }) {
  const out = [];
  for (const t of tools) {
    const [module, action] = t.permission;
    for (const role of roles) {
      const allowed = Boolean(may(role, module, action));
      out.push({ kind: t.kind, key: t.key, role, module, action, expect: allowed ? "allowed" : "refused" });
      if (allowed && t.matrix) out.push({ kind: t.kind, key: t.key, role, module, action, expect: "scoped", probe: t.matrix });
    }
  }
  return out;
}

/** The cases grouped by expectation, for a report. */
function summarise(cases) {
  const by = { allowed: 0, refused: 0, scoped: 0 };
  for (const c of cases) by[c.expect] = (by[c.expect] || 0) + 1;
  return { total: cases.length, ...by };
}

module.exports = { casesFor, summarise };
