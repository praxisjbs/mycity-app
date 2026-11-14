"use strict";
/**
 * What the assistant may read and do about queries: the queries the asker may see, by the
 * same rule the screen keeps (queries.visibility.js: People with scope all every
 * query, anyone else only the ones they raised), one page of 25 at a time, and one
 * query with its response; and, as a card the person confirms (docs/guides/praxis-ai.md §6.11,
 * decision 33), Raise Query through Raise a Query's own function, after Confirm It's You (it starts
 * due process and sends a signed letter: JBS Praxis, 03/11/2026). The letter is signed with the
 * signature the person saved (My Signature, queries.md §6.9): the chat cannot draw one, so a person
 * without one is told so plainly and sent to Edit Signature, and asked to draw or change it, the
 * assistant opens Edit Signature itself. It never reminds or decides (A23).
 *
 * Someone answering their own query does it from ESS's card (ess.ai.js, my_queries.respond).
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { defineManifest } = require("../../shared/ai/manifest");
const { parseBody } = require("../../shared/http/validate");
const routeMap = require("../../shared/route-map");
const people = require("../organisation/organisation.cards");
const policies = require("../policies/policies.service");
const { oneNamed } = require("../../shared/ai/named");
const signature = require("./queries.signature");
const visibility = require("./queries.visibility");
const service = require("./queries.service");

const cite = (row) => ({
  type: "query",
  id: row.employee_query_id,
  label: `${row.number}, ${row.employee.display_name}`,
});

/** A policy a query cites, by its title or number, among those with a version in force; null when none or several. */
async function citedIdOf(words) {
  const page = await policies.citable({ page: 1, q: String(words).slice(0, 100) });
  const found = oneNamed(page.data || [], words, (p) => [p.title, p.number]);
  return found ? found.policy_id : null;
}

/** The person and the policy a card names. */
async function raiseNames(values, db) {
  const cited = values.policy_id && db ? await policies.namesOf(db, [values.policy_id]) : [];
  return [...(await people.peopleNamed(db, [values.employee_id].filter(Boolean))), ...cited.map((p) => ({ type: "policy", id: p.policy_id, label: `${p.title} (${p.number})` }))];
}

module.exports = defineManifest({
  module: "queries",
  actions: [
    {
      key: "queries.raise",
      label: "Raise Query",
      description: "Raise a query on someone: the subject, what happened in full (20 characters or more), and the policy it breaches with the clause to quote; signed with my saved signature",
      input: c.queries.QueryRaise,
      permission: ["queries", "create"],
      // It starts due process and sends a signed letter: Confirm It's You first (JBS Praxis, 03/11/2026).
      risk: "approval",
      form: "none: Raise a Query's form is signed on its own pad; the card signs with the saved signature (QueryRaise)",
      fields: ["employee_id", "subject", "details", "policy_id", "policy_clause"],
      picks: { employee_id: "employee", policy_id: "policy" },
      resolve: { policy_id: (value) => citedIdOf(value) },
      names: (values, _actor, db) => raiseNames(values, db),
      asks: [
        // Who, from People's register (praxis-ai.md decision 34).
        { field: "employee_id", question: "Who is the query for?", read: "employees.list", params: { status: "active" } },
        { field: "subject", question: "What is the query about?" },
        { field: "details", question: "What happened?" },
      ],
      check: (client, values, actor) => service.assertCardRaise(client, values, actor),
      // Raise a Query's own function with the form's own request, signed with the signature the person saved.
      run: async (values, actor) => service.raise(actor, actor.scope, parseBody(c.queries.QueryCreate, { ...values, signature: await signature.signatureOf(pool, actor) })),
      readback: (q) => [{ type: "query", id: q.employee_query_id, label: `${q.number}, ${q.employee.display_name}`, status: "raised", link: (routeMap.linkFor("query", q.employee_query_id) || {}).path || null }],
      labels: { employee_id: "Employee", subject: "Subject", details: "What Happened", policy_id: "Policy", policy_clause: "Clause" },
    },
  ],
  // Every create and edit form of this module's contract, and how the chat reaches it (gate 23, praxis-ai.md decision 33).
  not_offered: {
    QueryCreate: "via queries.raise: Raise a Query's own request, signed on its pad; the card signs with the saved signature (QueryRaise)",
    QueryResponseCreate: "via my_queries.respond: My Queries' own response form, which never names its query; the card is QueryRespond",
    LetterSignatureSave: "file: a signature is drawn by hand on the pad and kept as an image; the chat cannot draw one, and opens Edit Signature to draw it",
  },
  summaries: [
    {
      key: "queries.summary",
      description: "Queries in figures: awaiting a response, overdue, under review, closed, days to close; by status, by department, rule or raiser stacked, raised by month",
      params: c.queries.QuerySummaryQuery,
      permission: ["queries", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, visibility.readerOf(actor.scope, actor)),
    },
  ],
  reads: [
    {
      key: "queries.list",
      summary: "queries.summary",
      description: "List queries: who a query is about, its subject, who raised it, and whether it waits for a response, is under review or is closed",
      params: c.queries.QueryListQuery,
      permission: ["queries", "view"],
      run: (_client, params, actor) => service.list(params, visibility.readerOf(actor.scope, actor)),
      cite,
    },
    {
      key: "queries.get",
      summary: "none: one record",
      description: "One query: its details, the employee's response and the decision",
      params: c.common.IdParams,
      permission: ["queries", "view"],
      run: (_client, params, actor) => service.get(params.id, actor, actor.scope),
      cite,
    },
  ],
  routes: [
    // Only the person draws their signature: asked for one, the assistant says so and opens Edit Signature.
    { intent: "draw or change my signature for letters, which only I can draw", screen: "queries.letter-templates", params: { action: "signature" } },
    { intent: "raise a query", screen: "queries.queries", params: { new: "1" }, prefill: c.queries.QueryCreate },
    { intent: "decide a query", screen: "queries.queries" },
  ],
});
