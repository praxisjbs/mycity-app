"use strict";
/**
 * What the assistant may read and do in Employee Self-Service: the caller's own
 * record, documents and leave, and where it sends them to add a document; and, as cards the
 * person confirms (docs/guides/praxis-ai.md §6.11), a leave request of their own through the
 * same service function Request Leave's Send calls, and their response to one of their own open
 * queries through My Queries' Send Response (decision 33): their own words, one response a query,
 * never edited once sent. Never another person's record; every read is given the caller's own
 * employee id and nothing else.
 *
 * The rest of ESS (the latest payslip, open queries, docs/guides/ess.md §9) joins
 * this manifest as each of those tabs lands.
 */
const c = require("@mycity/contract");
const { AppError } = require("../../shared/errors");
const { defineManifest } = require("../../shared/ai/manifest");
const { oneNamed } = require("../../shared/ai/named");
const routeMap = require("../../shared/route-map");
const md = require("../../shared/documents/markdown");
const documents = require("../documents/documents.service");
const leave = require("../leave/leave.service");
const queries = require("../queries/queries.service");
const profile = require("./ess.profile");
const essQueries = require("./ess.queries");

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

/**
 * The matrix's scope probes (docs/guides/praxis-ai.md §6.17): every read here is the asker's own,
 * whatever their grant says, so their own record and request are returned and an outsider's never.
 */
const profileProbe = {
  inside: (ctx) => ({ type: "employee", id: ctx.actor.employee_id }),
  outside: (ctx) => ({ type: "employee", id: ctx.outsider.employee_id }),
};
async function requestFor(ctx, who) {
  const day = ctx.freshDay();
  const r = await leave.request(who.user, who.employee_id, { leave_type_id: ctx.leaveTypeId, starts_on: day, ends_on: day, reason: `A matrix day for ${ctx.role}` });
  return { type: "leave_request", id: r.leave_request_id };
}
const leaveProbe = {
  inside: (ctx) => requestFor(ctx, { user: ctx.actor, employee_id: ctx.actor.employee_id }),
  outside: (ctx) => requestFor(ctx, ctx.outsider),
};

/**
 * The leave types a person may ask for this year, with the days left of each, as My Leave lists
 * them (every active type): the card's names, its answers to "Which leave type?" and the match of a
 * type the model writes by name (docs/guides/praxis-ai.md decision 32).
 */
async function typesFor(actor) {
  if (!actor || !actor.employee_id) return [];
  return (await leave.balancesFor(actor.employee_id)).balances;
}

/** A type as a choice to tap: "Annual Leave, 12 days left", or its name alone when it has no allowance. */
const choiceOf = (t) => (t.remaining === null || t.remaining === undefined ? t.name : `${t.name}, ${t.remaining} ${t.remaining === 1 ? "day" : "days"} left`);

/**
 * The type a name names, among the person's own (shared/ai/named.js): its name or code with or
 * without the word Leave ("Annual Leave" for the type named Annual), a choice as tapped ("Annual, 12
 * days left"), or words only one type's name begins or is begun by ("Compassionate" for
 * "Compassionate Leave"); null when none or several match.
 */
async function typeIdOf(actor, value) {
  const type = oneNamed(await typesFor(actor), String(value).split(/[,·]/)[0], (t) => [t.name, t.code], { drop: ["leave"] });
  return type ? type.leave_type_id : null;
}

module.exports = defineManifest({
  module: "ess",
  // A create or edit form never drafted here, and why (gate 23 rule 6, praxis-ai.md decision 33).
  not_offered: {
    EssProfileUpdate: "personal: a person's own phone, address, next of kin and bank are personal data the assistant never writes; My Profile edits them",
  },
  actions: [
    {
      key: "my_leave.request",
      label: "Request Leave",
      description: "Ask for leave for myself: the leave type, the first and last day, and a note for my line manager",
      input: c.leave.LeaveRequestCreate,
      permission: ["ess", "create"],
      risk: "standard",
      // The request is the person's own: the card names no other record.
      check: async (_client, _values, actor) => {
        if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee asks for leave", 403);
      },
      // The same function Request Leave's Send calls (ess.leave.request); the type, the days and the year's allowance are its checks.
      run: (values, actor) => leave.request(actor, actor.employee_id, values),
      readback: (r) => [{ type: "leave_request", id: r.leave_request_id, label: `${r.leave_type_name}, ${r.days} ${r.days === 1 ? "day" : "days"}`, status: "sent", link: (routeMap.linkFor("leave_request", r.leave_request_id, { self: true }) || {}).path || null }],
      labels: { leave_type_id: "Leave Type", starts_on: "First Day", ends_on: "Last Day", reason: "Note" },
      // Request Leave's form, field for field; the type named, picked with the form's own list, and asked for first (decision 32).
      fields: ["leave_type_id", "starts_on", "ends_on", "reason"],
      picks: { leave_type_id: "leave_type" },
      names: async (values, actor) => {
        const type = (await typesFor(actor)).find((t) => t.leave_type_id === values.leave_type_id);
        return type ? [{ type: "leave_type", id: type.leave_type_id, label: type.name }] : [];
      },
      asks: [
        { field: "leave_type_id", question: "Which leave type?", options: async ({ actor }) => (await typesFor(actor)).filter((t) => t.remaining === null || t.remaining === undefined || t.remaining > 0).map(choiceOf) },
        // The first and last day (praxis-ai.md decision 34): the model reads the words against today's date.
        { field: "starts_on", question: "What is your first day off?", choices: ["Tomorrow", "Next Monday"] },
        { field: "ends_on", question: "What is your last day off?", choices: ["The Same Day"] },
      ],
      resolve: { leave_type_id: (value, actor) => typeIdOf(actor, value) },
    },
    {
      key: "my_queries.respond",
      label: "Send Response",
      description: "Send my written response to one of my own open queries (its number): my account in my own words, 20 to 4,000 characters; one response a query, never edited once sent",
      input: c.queries.QueryRespond,
      permission: ["ess", "create"],
      risk: "standard",
      form: "none: Respond sits on the open query on My Queries and never names it; the card names the query and carries the words as plain text",
      fields: ["employee_query_id", "body"],
      // A query written by its number or subject is matched among the person's own open queries (decision 32).
      resolve: { employee_query_id: (value, actor, db) => queries.myOpenIdOf(db, actor.employee_id, value) },
      records: (values, actor, db) => queries.cardMine(db, actor.employee_id, values.employee_query_id),
      asks: [
        // Which of the person's own open queries, to tap (praxis-ai.md decision 34).
        { field: "employee_query_id", question: "Which query is it?", options: ({ actor, db }) => queries.myOpenChoices(db, actor.employee_id) },
        { field: "body", question: "What is your response?" },
      ],
      check: (client, values, actor) => queries.assertCardRespond(client, actor.employee_id, values.employee_query_id),
      // My Queries' own Send Response, the words as the editor sends them (HTML from the plain text).
      run: (values, actor) => essQueries.respond(actor, values.employee_query_id, { body_html: md.markdownToHtml(values.body) }),
      readback: (q) => [{ type: "query", id: q.employee_query_id, label: `${q.number} ${q.subject}`, status: "response sent", link: (routeMap.linkFor("query", q.employee_query_id, { self: true }) || {}).path || null }],
      labels: { employee_query_id: "Query", body: "Response" },
    },
  ],
  reads: [
    {
      key: "my_profile.get",
      description: "Read my own record: job, department, line manager, contact details, next of kin, bank and the working week",
      params: c.common.EmptyBody,
      permission: ["ess", "view"],
      run: (_client, _params, actor) => (actor.employee_id ? profile.get(actor) : null),
      cite: (row) => ({ type: "employee", id: row.employee_id, label: row.display_name }),
      matrix: profileProbe,
    },
    {
      key: "my_documents.list",
      description:
        "List my own documents and the ones People have asked me for",
      params: c.documents.DocumentListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) =>
        actor.employee_id
          ? documents.listFor([actor.employee_id], params)
          : EMPTY,
      cite: (row) => ({
        type: "document",
        id: row.document_id || row.document_request_id,
        label: row.name,
      }),
    },
    {
      key: "my_leave.list",
      description: "List my own leave requests, with their dates, working days and status",
      params: c.ess.EssLeaveListQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) =>
        actor.employee_id ? leave.listFor(actor.employee_id, params) : EMPTY,
      cite: (row) => ({
        type: "leave_request",
        id: row.leave_request_id,
        label: `${row.leave_type_name}, ${row.days} days`,
      }),
      matrix: leaveProbe,
    },
    {
      key: "my_leave.balances",
      description: "How many leave days I am entitled to this year, per leave type, and how many are taken, booked, waiting and left",
      params: c.ess.EssLeaveBalanceQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) =>
        actor.employee_id
          ? leave.balancesFor(actor.employee_id, params.year)
          : { year: null, balances: [] },
      cite: () => ({ type: "screen", id: "ess.my-leave", label: "My Leave" }),
    },
  ],
  routes: [
    { intent: "upload one of my documents", screen: "ess.my-documents" },
    { intent: "change my phone, address, next of kin or bank details", screen: "ess.my-profile" },
    { intent: "request leave", screen: "ess.my-leave", params: { new: "1" }, prefill: c.leave.LeaveRequestPrefill },
  ],
});
