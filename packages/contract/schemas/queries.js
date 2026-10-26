"use strict";
/**
 * Queries: raised by a manager or a rule, answered by the employee, decided by
 * People (docs/guides/queries.md §3, §5, §6).
 *
 * Who sees a query is one rule (§6.1): scope `all` and the CEO see every one,
 * anyone else only the queries they raised; a query a rule raised (`raised_by`
 * null) is seen by scope `all` and the CEO only. The employee reads their own in
 * ESS, under /ess/queries, with the My… shapes at the end of this file.
 *
 * Statuses:
 *   awaiting_response  raised; the employee has not answered
 *   under_review       answered, or a proposed sanction waits for approval
 *   resolved           closed with an outcome: no_action or sanctioned
 */
const { z } = require("zod");
const {
  uuid,
  text,
  isoDate,
  isoDateTime,
  money,
  blank,
  listQuery,
  Paged,
} = require("./common");
const { PersonRef } = require("./organisation");
const { RichTextBlock, SignaturePng } = require("./policies");

const QueryStatus = z.enum(["awaiting_response", "under_review", "resolved"]);
const QueryOutcome = z.enum(["no_action", "sanctioned"]);

/** One piece of evidence: a counted day, a note, or a file from the vault. */
const EvidenceItem = z
  .object({
    label: text(200),
    date: isoDate.optional(),
    document_id: uuid.optional(),
  })
  .strict();

const evidence = z.array(EvidenceItem).max(50);

/**
 * The response, once the employee has written it. Never edited. `body` is the Markdown kept from
 * the editor's HTML (guide §3 step 3); `blocks` is the same text as a screen draws it.
 */
const QueryResponse = z
  .object({
    body: z.string(),
    blocks: z.array(RichTextBlock),
    submitted_at: isoDateTime,
  })
  .strict();

/** The sanction a query led to, as the query shows it. */
const QuerySanctionRef = z
  .object({
    sanction_id: uuid,
    number: z.string().nullable(),
    step_name: z.string(),
    status: z.enum(["pending_approval", "issued", "rejected", "withdrawn"]),
  })
  .strict();

/** One row of the Queries list. */
const Query = z
  .object({
    employee_query_id: uuid,
    number: z.string(),
    employee: PersonRef,
    subject: z.string(),
    raised_by: uuid.nullable(),
    raised_by_name: z.string().nullable(),
    query_rule_id: uuid.nullable(),
    rule_name: z.string().nullable(),
    status: QueryStatus,
    outcome: QueryOutcome.nullable(),
    escalated: z.boolean(),
    response_due_at: isoDateTime.nullable(),
    responded_at: isoDateTime.nullable(),
    created_at: isoDateTime,
  })
  .strict();

const QueryPage = Paged(Query);

/** One query, as its card shows it. */
const QueryDetail = Query.extend({
  details: z.string(),
  evidence,
  response: QueryResponse.nullable(),
  letter_document_id: uuid.nullable(),
  reminded_at: isoDateTime.nullable(),
  reviewed_by_name: z.string().nullable(),
  reviewed_at: isoDateTime.nullable(),
  workflow_instance_id: uuid.nullable(),
  sanction: QuerySanctionRef.nullable(),
  next_step: z
    .object({ consequence_step_id: uuid, name: z.string(), position: z.number().int().min(1) })
    .strict()
    .nullable(),
  can_decide: z.boolean(),
  can_remind: z.boolean(),
}).strict();

/**
 * GET /queries. `raised`: `mine` keeps the queries the caller raised, `rules` those
 * a rule raised (scope `all` only; anyone else already sees only their own).
 */
const QueryListQuery = listQuery(
  {
    status: QueryStatus.optional(),
    employee_id: uuid.optional(),
    raised: z.enum(["mine", "rules"]).optional(),
  },
  ["created_at", "number", "response_due_at"],
);

/** POST /queries: a manager or People raise a query. */
const QueryCreate = z
  .object({
    employee_id: uuid,
    subject: z.string().trim().min(4, "Name the subject").max(150),
    details: z.string().trim().min(20, "Give the facts").max(4000),
    letter_template: z.string().trim().max(64).optional(),
    // The raiser's drawn signature (guide §6.2), kept in the vault and printed on the letter.
    signature: SignaturePng,
  })
  .strict();

/**
 * POST /queries/:id/decision. `no_action` closes the query. `sanction` proposes a
 * rung of the chain: it is written as pending and its approval opens
 * (queries.consequence); the query resolves when that approval does.
 */
const QueryDecision = z
  .object({
    outcome: z.enum(["no_action", "sanction"]),
    reason: z.string().trim().min(10, "Record the reason").max(2000),
    consequence_step_id: uuid.optional(),
    effective_on: blank(isoDate),
    ends_on: blank(isoDate),
    evidence: evidence.optional(),
    fine_amount: blank(money),
    // The proposer's drawn signature, for a sanction (guide §6.4); printed on its letters.
    signature: SignaturePng.optional(),
  })
  .strict()
  .refine((v) => v.outcome !== "sanction" || Boolean(v.signature), {
    message: "Sign in the box",
    path: ["signature"],
  })
  .refine((v) => v.outcome !== "sanction" || Boolean(v.consequence_step_id), {
    message: "Pick the sanction",
    path: ["consequence_step_id"],
  })
  .refine((v) => v.outcome === "sanction" || (!v.consequence_step_id && !v.fine_amount), {
    message: "Only with a sanction",
    path: ["consequence_step_id"],
  })
  // Above 0.00 without turning money into a number: not negative, and some digit not zero.
  .refine((v) => !v.fine_amount || (!v.fine_amount.startsWith("-") && /[1-9]/.test(v.fine_amount)), {
    message: "Enter the fine",
    path: ["fine_amount"],
  })
  .refine((v) => !v.effective_on || !v.ends_on || v.ends_on >= v.effective_on, {
    message: "Ends before it starts",
    path: ["ends_on"],
  });

/** GET /queries/summary: the figures above the list, within the caller's visibility. */
const QueriesSummary = z
  .object({
    open: z.number().int().min(0),
    awaiting_response: z.number().int().min(0),
    closed_this_month: z.number().int().min(0),
    escalated: z.number().int().min(0),
    by_reason: z
      .array(z.object({ label: z.string(), count: z.number().int().min(0) }).strict())
      .max(25),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * ESS · My Queries (the ess module, through the queries service)
 * ------------------------------------------------------------------ */

/** GET /ess/queries: `open` is not yet resolved, `archived` is resolved. */
const EssQueryListQuery = listQuery({ status: z.enum(["open", "archived"]).optional() });

/** One of the caller's own queries. */
const MyQuery = z
  .object({
    employee_query_id: uuid,
    number: z.string(),
    subject: z.string(),
    details: z.string(),
    status: QueryStatus,
    outcome: QueryOutcome.nullable(),
    response_due_at: isoDateTime.nullable(),
    response: QueryResponse.nullable(),
    letter_document_id: uuid.nullable(),
    sanction: QuerySanctionRef.nullable(),
    can_respond: z.boolean(),
    created_at: isoDateTime,
  })
  .strict();

const MyQueryPage = Paged(MyQuery);

/** GET /ess/queries/summary: the three cards on My Queries, the caller's own. */
const MyQueriesSummary = z
  .object({
    open: z.number().int().min(0),
    archived: z.number().int().min(0),
    sanctions: z.number().int().min(0),
    last_sanction: isoDate.nullable(),
  })
  .strict();

/** The words of an editor's HTML: tags dropped, entities read, spaces folded. Counts what was written. */
const wordsOf = (html) =>
  String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, "x")
    .replace(/\s+/g, " ")
    .trim();

/**
 * POST /ess/queries/:id/response: the employee's written answer, as the rich text editor's HTML.
 * One a query. The text inside counts (20 to 4,000 characters); the service keeps it as Markdown.
 */
const QueryResponseCreate = z
  .object({
    body_html: z
      .string()
      .max(40_000, "Too long")
      .refine((v) => wordsOf(v).length >= 20, "Write your response")
      .refine((v) => wordsOf(v).length <= 4000, "At most 4000 characters"),
  })
  .strict();

/** The variables of templates/email/query-raised.html: the letter rides as the attachment. */
const QueryRaisedEmailVars = z
  .object({
    query_number: z.string(),
    subject: z.string(),
    response_due: isoDateTime.nullable(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  EvidenceItem: { table: null, reason: "one item of employee_query.evidence or sanction.evidence (jsonb)" },
  QueryResponse: { table: "query_response", virtual: { blocks: "body as RichTextBlock[], from the one Markdown renderer" } },
  QuerySanctionRef: {
    table: "sanction",
    virtual: { step_name: "consequence_step.name, or sanction.sanction_type for a rung since removed" },
  },
  Query: {
    table: "employee_query",
    virtual: {
      employee: "the person, from employee and department",
      raised_by_name: "the raiser's display name, from app_user and employee",
      rule_name: "query_rule.name",
      escalated: "a sanction on the query is pending_approval",
    },
  },
  QueryPage: { table: null, reason: "a page of queries" },
  QueryDetail: {
    table: "employee_query",
    virtual: {
      employee: "the person, from employee and department",
      raised_by_name: "the raiser's display name, from app_user and employee",
      rule_name: "query_rule.name",
      escalated: "a sanction on the query is pending_approval",
      response: "the query_response row",
      reviewed_by_name: "the reviewer's display name",
      sanction: "the latest sanction on the query",
      next_step: "the rung after the highest one in force for the person (guide §6.5)",
      can_decide: "the reader may record a decision now (guide §6.4)",
      can_remind: "awaiting a response, raised by the reader or in scope all, not reminded today",
    },
  },
  QueryListQuery: { table: null, reason: "list controls and filters for the Queries list" },
  QueryCreate: {
    table: "employee_query",
    virtual: {
      letter_template: "the letter_template key the query letter is generated from",
      signature: "the drawn PNG, stored through the vault as signature_document_id",
    },
  },
  QueryDecision: {
    table: null,
    reason: "a decision: resolves the query, or writes a sanction and opens its approval",
  },
  QueriesSummary: { table: null, reason: "counts over employee_query within the reader's visibility" },
  EssQueryListQuery: { table: null, reason: "list controls for ESS · My Queries" },
  MyQuery: {
    table: "employee_query",
    virtual: {
      response: "the query_response row",
      sanction: "the latest sanction on the query",
      can_respond: "awaiting a response and not yet answered",
    },
  },
  MyQueryPage: { table: null, reason: "a page of the caller's own queries" },
  MyQueriesSummary: { table: null, reason: "counts over the caller's own queries and issued sanctions" },
  QueryResponseCreate: {
    table: "query_response",
    virtual: { body_html: "the editor's HTML, kept as body (Markdown) by shared/documents/markdown" },
  },
  QueryRaisedEmailVars: { table: null, reason: "the variables of templates/email/query-raised.html, not a row" },
};

module.exports = {
  TABLES,
  QueryStatus,
  QueryOutcome,
  EvidenceItem,
  QueryResponse,
  QuerySanctionRef,
  Query,
  QueryPage,
  QueryDetail,
  QueryListQuery,
  QueryCreate,
  QueryDecision,
  QueriesSummary,
  EssQueryListQuery,
  MyQuery,
  MyQueryPage,
  MyQueriesSummary,
  QueryResponseCreate,
  QueryRaisedEmailVars,
};
