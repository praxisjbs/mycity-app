"use strict";
/**
 * Staging demonstration data: Queries & Sanctions (M3; docs/guides/queries.md §3, §6, F13).
 *
 * Everything goes through the module's own services, as the screens would, hung off MyCity's real
 * staff found by post (lib/staff.js):
 *
 *   the chain     Chain Settings' five rungs in MILESTONES §8's order (Caution, Warning, Second
 *                 Warning, Suspension Without Pay, Dismissal or Termination), each on its shipped
 *                 letter; only when the chain is empty, so a chain People entered stays theirs
 *   a rule        Unregistered Device on Rules, switched on (the Attendance policy owns lateness)
 *   queries       raised by the Line Manager, then the Head of Department, on the people who report
 *                 to them, each signed on the pad, and walked as the people would:
 *                   waiting for the response
 *                   answered, waiting for a decision
 *                   answered and closed with no action
 *                   answered, a Caution proposed by Management and approved and signed by
 *                     Operations & People on the query's card
 *                   answered, a Warning with a fine, proposed and approved the same way
 *                   answered, a Caution proposed and waiting on Operations & People
 *
 * The proposer is never the approver (the approval refuses that, guide §6.4). An approved sanction
 * is issued, and its letters made, by the worker after the seed, as it is for anyone.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 47_performance_commitments.js. Idempotent: each query is found by its person and subject, the
 * rule by its code, and a second run adds nothing. A query whose post nobody holds is left out.
 */
const path = require("node:path");
const c = require("@mycity/contract");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { realStaff } = require("./lib/staff");
const { signatureOf } = require("./lib/signature");

const src = (p) => require(path.join(__dirname, "..", "..", "src", p));

/** Chain Settings' rungs, in MILESTONES §8's order. */
const CHAIN = Object.freeze([
  { name: "Caution", letter_template: "caution-letter", valid_days: 365 },
  { name: "Warning", letter_template: "warning-letter", valid_days: 365 },
  { name: "Second Warning", letter_template: "warning-letter", valid_days: 365 },
  {
    name: "Suspension Without Pay",
    letter_template: "suspension-without-pay-letter",
    financial_effect: "unpaid_days",
    default_days: 3,
    evidence_required: true,
  },
  {
    name: "Dismissal or Termination",
    letter_template: "termination-letter",
    financial_effect: "ends_employment",
    evidence_required: true,
  },
]);

const RULE = Object.freeze({
  name: "Unregistered Device",
  source_event: "unenrolled_device",
  threshold: 3,
  window_days: 30,
  policy_clause: "Clock in only from a device registered in My Devices.",
});

const RESPONSE =
  "<p>I accept that the report reached the team late. The vendor sent the figures on the Friday " +
  "evening and I did not flag the delay to my manager in time. I have set a reminder two days " +
  "ahead of each deadline and will raise any delay the same day.</p>";

/**
 * The queries, in the order of the people they go to. `walk` is how far each is taken:
 * open, answered, closed, approved, fined, pending.
 */
const QUERIES = Object.freeze([
  {
    walk: "open",
    subject: "Missed Weekly Field Report",
    details: "The weekly field report for the week ending last Friday was not submitted, and no reason was given to your manager.",
  },
  {
    walk: "answered",
    subject: "Late Vendor Report",
    details: "The vendor reconciliation report was due on Monday at 12:00 and reached the team on Wednesday, holding up the month's figures.",
  },
  {
    walk: "closed",
    subject: "Absent From Team Meeting",
    details: "You did not attend Tuesday's team meeting at 10:00 and no apology or reason was sent to your manager before or after it.",
  },
  {
    walk: "approved",
    subject: "Unapproved Schedule Change",
    details: "You changed the agents' visit schedule for the week without your manager's approval, and two partner visits were missed.",
  },
  {
    walk: "fined",
    subject: "Company Phone Misuse",
    details: "The company phone assigned to you ran up data charges well above the monthly allowance on downloads unrelated to work.",
  },
  {
    walk: "pending",
    subject: "Unanswered Partner Complaint",
    details: "A partner's complaint sent to you on Monday was not answered or passed on for three working days, and they escalated it to the CEO.",
  },
]);

/** A person as a service's caller (req.user), or null when they have no login. */
async function callerOf(db, person) {
  if (!person || !person.user_id) return null;
  const user = await grantsCache.getAuthUser(db, person.user_id);
  return user ? { ...user, ip: null } : null;
}

const nameOf = (p) => `${p.first_name} ${p.last_name}`;

module.exports = async function seed({ pool, actor, log = () => {} }) {
  const queries = src("modules/queries/queries.service");
  const response = src("modules/queries/queries.response");
  const visibility = src("modules/queries/queries.visibility");
  const sanctions = src("modules/sanctions/sanctions.service");
  const chain = src("modules/sanctions/sanctions.chain");
  const rules = src("modules/query_rules/query_rules.service");

  const staff = await realStaff(pool);
  const all = { scope: "all", scope_ids: null };

  /* The chain, only when nobody has entered one. */
  const { rows: steps } = await pool.query("SELECT count(*)::int AS n FROM consequence_step");
  if (steps[0].n === 0) {
    const by = (await callerOf(pool, staff.operations)) || actor;
    for (const step of CHAIN) await chain.create(by, c.sanctions.ConsequenceStepCreate.parse(step));
    log(`queries: the chain's ${CHAIN.length} rungs entered`);
  }

  /* The rule. */
  const code = rules.codeFrom(RULE.name);
  const { rows: had } = await pool.query("SELECT query_rule_id FROM query_rule WHERE code = $1", [code]);
  if (!had.length) {
    const by = (await callerOf(pool, staff.operations)) || actor;
    const made = await rules.create(by, c.query_rules.QueryRuleCreate.parse(RULE));
    if (rules.countable(RULE.source_event)) await rules.activate(by, made.query_rule_id);
    log(`queries: rule ${RULE.name} made`);
  }

  /* The queries: each raised by a person's own line manager, Line Manager first, then Head of Department. */
  const proposerPerson = staff.management[0] || staff.ceo;
  const proposer = await callerOf(pool, proposerPerson);
  const approver = await callerOf(pool, staff.operations);
  if (!proposer || !approver) {
    log("queries: no Management or Operations & People login, no queries added");
    return;
  }
  const busy = new Set([proposerPerson, staff.operations, staff.ceo].filter(Boolean).map((p) => p.employee_id));
  const pairs = [];
  for (const lead of [staff.manager, staff.head]) {
    const caller = await callerOf(pool, lead);
    if (!caller) continue;
    for (const person of staff.reportsOf(lead)) if (!busy.has(person.employee_id)) pairs.push({ lead, caller, person });
  }
  const { rows: chainRows } = await pool.query(
    "SELECT consequence_step_id, name FROM consequence_step WHERE active ORDER BY position",
  );
  const stepNamed = (name) => (chainRows.find((s) => s.name === name) || chainRows[0] || {}).consequence_step_id;
  const reader = visibility.readerOf(all, approver);

  let added = 0;
  for (const [n, plan] of QUERIES.entries()) {
    if (!pairs[n]) break;
    const { lead, caller, person } = pairs[n];
    const { rows: found } = await pool.query(
      "SELECT employee_query_id FROM employee_query WHERE employee_id = $1 AND subject = $2",
      [person.employee_id, plan.subject],
    );
    if (found.length) continue;
    try {
      const raised = await queries.raise(
        caller,
        all,
        c.queries.QueryCreate.parse({
          employee_id: person.employee_id,
          subject: plan.subject,
          details: plan.details,
          signature: signatureOf(nameOf(lead)),
        }),
      );
      added += 1;
      if (plan.walk === "open") continue;

      const answerer = (await callerOf(pool, person)) || { ...actor, employee_id: person.employee_id };
      await response.respond(answerer, person.employee_id, raised.employee_query_id, c.queries.QueryResponseCreate.parse({ body_html: RESPONSE }));
      if (plan.walk === "answered") continue;

      if (plan.walk === "closed") {
        await queries.decide(proposer, all, raised.employee_query_id, c.queries.QueryDecision.parse({
          outcome: "no_action",
          reason: "The reason given holds; the meeting was moved at short notice.",
        }));
        continue;
      }

      const decided = await queries.decide(proposer, all, raised.employee_query_id, c.queries.QueryDecision.parse({
        outcome: "sanction",
        consequence_step_id: stepNamed(plan.walk === "fined" ? "Warning" : "Caution"),
        reason: "The response accepts the facts and gives no reason that excuses them.",
        ...(plan.walk === "fined" ? { fine_amount: "5000.00" } : {}),
      }));
      if (plan.walk === "pending" || !decided.sanction) continue;
      await sanctions.approve(approver, reader, decided.sanction.sanction_id,
        c.sanctions.SanctionApprove.parse({ signature: signatureOf(nameOf(staff.operations)) }));
    } catch (err) {
      log(`queries: ${plan.subject} for ${nameOf(person)} stopped: ${err.message}`);
    }
  }
  log(`queries: ${added} queries raised`);
};
