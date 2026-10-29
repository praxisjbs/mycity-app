"use strict";
/**
 * Staging demonstration data: two Knowledge Hub policies for Queries & Sanctions to cite
 * (docs/guides/policies.md, docs/guides/queries.md §6.2, F13).
 *
 *   Code of Conduct          reports, meetings, plans others rely on, partners' complaints
 *   Use of Company Devices   company phones and data, clocking in from a registered device
 *
 * Each is created, written and published by Operations & People through the Policies service, as
 * the screen would: in force from today, for the Implementation department only, to be
 * acknowledged within 7 days. Only the Implementation Team's own accounts are told: staging sends
 * real mail, and MyCity's staff are never the audience of demonstration data (TB, 27/10/2026).
 * 50_queries.js cites these clauses on its queries and its rule.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), before
 * 50_queries.js. Idempotent: a policy is found by its title, and a second run adds nothing.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { realStaff } = require("./lib/staff");
const { signatureOf } = require("./lib/signature");

const src = (p) => require(path.join(__dirname, "..", "..", "src", p));

const AUDIENCE = "Implementation";

/** The clauses, word for word as 50_queries.js quotes them. */
const CLAUSES = Object.freeze({
  reports: "Submit every report by its due date, or tell your manager in writing before it falls due.",
  meetings: "Attend the meetings you are invited to, or send your apology to your manager before they start.",
  plans: "Change a plan others rely on only with your manager's approval.",
  partners: "Answer or pass on a partner's complaint within one working day.",
  devices: "Company phones, laptops and data are for work only.",
  clockIn: "Clock in only from a device registered in My Devices.",
});

const POLICIES = Object.freeze([
  {
    title: "Code of Conduct",
    body_html: [
      "<h2>Purpose</h2>",
      "<p>This policy sets out how we work with each other and with our partners.</p>",
      "<h2>Work on time</h2>",
      `<ol><li>${CLAUSES.reports}</li><li>${CLAUSES.meetings}</li></ol>`,
      "<h2>Work together</h2>",
      `<ol><li>${CLAUSES.plans}</li><li>${CLAUSES.partners}</li></ol>`,
      "<h2>When it is not followed</h2>",
      "<p>A breach may be queried, and a query may lead to a sanction on the consequence chain.</p>",
    ].join(""),
  },
  {
    title: "Use of Company Devices",
    body_html: [
      "<h2>Purpose</h2>",
      "<p>This policy covers the phones, laptops and data the company gives you.</p>",
      "<h2>Use</h2>",
      `<ol><li>${CLAUSES.devices}</li><li>${CLAUSES.clockIn}</li></ol>`,
      "<h2>When it is not followed</h2>",
      "<p>A breach may be queried, and charges above the allowance may be deducted as a fine.</p>",
    ].join(""),
  },
]);

/** A person as a service's caller (req.user), or null when they have no login. */
async function callerOf(db, person) {
  if (!person || !person.user_id) return null;
  const user = await grantsCache.getAuthUser(db, person.user_id);
  return user ? { ...user, ip: null } : null;
}

const nameOf = (p) => `${p.first_name} ${p.last_name}`;

async function seed({ pool, actor, log = () => {} }) {
  const policies = src("modules/policies/policies.service");
  const lagos = src("shared/time/lagos");

  const staff = await realStaff(pool);
  const { rows: dept } = await pool.query("SELECT department_id FROM department WHERE name = $1", [AUDIENCE]);
  if (!dept.length) {
    log(`policies: no ${AUDIENCE} department, no policies added`);
    return;
  }
  const by = (await callerOf(pool, staff.operations)) || actor;
  const signer = staff.operations ? nameOf(staff.operations) : "Operations & People";
  const settings = {
    applies_to: { everyone: false, department_ids: [dept[0].department_id], work_patterns: [], employee_ids: [] },
    needs_acknowledgement: true,
    acknowledge_within_days: 7,
    needs_approval: false,
  };

  for (const plan of POLICIES) {
    const { rows: had } = await pool.query("SELECT policy_id FROM policy WHERE title = $1 AND status = 'active'", [plan.title]);
    if (had.length) continue;
    try {
      const made = await policies.create(by, c.policies.PolicyCreate.parse({ title: plan.title, ...settings }));
      await policies.saveDraft(by, made.policy_id, c.policies.PolicyDraftSave.parse({ title: plan.title, ...settings, body_html: plan.body_html }));
      await policies.publish(by, made.policy_id, c.policies.PolicyPublish.parse({
        effective_from: lagos.today(),
        note: "First version.",
        signature: signatureOf(signer),
      }));
      log(`policies: ${plan.title} published for ${AUDIENCE}`);
    } catch (err) {
      log(`policies: ${plan.title} stopped: ${err.message}`);
    }
  }
}

module.exports = seed;
module.exports.CLAUSES = CLAUSES;
module.exports.POLICIES = POLICIES;
