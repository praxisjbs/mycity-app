"use strict";
/**
 * Letter templates: the letters Queries & Sanctions sends, and their wording
 * (docs/guides/queries.md §6.7). M5 adds mail templates here.
 *
 * A `letter_template` row names a letter; its wording is the current
 * `template_version` under the same key (shared/templates/template-store.js), or
 * the shipped default in templates/documents/<key>.html. An edit saves a new
 * version as Markdown; a generated letter records the version it used.
 *
 * Statuses a person reads:
 *   awaiting_sample  no wording yet (the shipped file is empty and nothing was saved)
 *   draft            has wording, not yet chosen for use
 *   active           a rung, a rule or a manual query may use it
 *   retired          kept for the letters already sent; no longer offered
 *
 * Every letter fills from one variable schema, ConsequenceLetterVars, so a template
 * added on the screen reads the same record a shipped one does. Writes need the
 * `queries.configure` capability.
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, money, listQuery, Paged } = require("./common");

/** query: a query's letter; sanction: a rung's; fine: the Salary Deduction letter a fine sends (guide §6.6). */
const LetterPurpose = z.enum(["query", "sanction", "fine"]);
const LetterTemplateStatus = z.enum(["awaiting_sample", "draft", "active", "retired"]);

const body = z.string().trim().min(40, "Write the letter").max(20000);

/** One template in the list. `used_by` names the rungs and rules that send it. */
const LetterTemplate = z
  .object({
    letter_template_id: uuid,
    key: z.string(),
    name: z.string(),
    purpose: LetterPurpose,
    status: LetterTemplateStatus,
    version: z.number().int().min(0),
    used_by: z.array(z.string()).max(25),
    updated_at: isoDateTime,
  })
  .strict();

const LetterTemplatePage = Paged(LetterTemplate);

/** One template with its current wording. */
const LetterTemplateDetail = LetterTemplate.extend({
  title: z.string().nullable(),
  body: z.string().nullable(),
  format: z.enum(["html", "markdown"]).nullable(),
  variables: z.array(z.string()).max(50),
}).strict();

/** GET /letter-templates */
const LetterTemplateListQuery = listQuery(
  { purpose: LetterPurpose.optional(), status: LetterTemplateStatus.optional() },
  ["name", "updated_at"],
);

/** POST /letter-templates: a new letter, saved as a draft. Its key is made from the name. */
const LetterTemplateCreate = z
  .object({
    name: text(80),
    purpose: LetterPurpose,
    title: text(150).optional(),
    body,
  })
  .strict();

/** PUT /letter-templates/:id/body: new wording, saved as the next version. */
const LetterTemplateBodySave = z
  .object({
    title: text(150).optional(),
    body,
  })
  .strict();

/** GET /letter-templates/summary */
const LetterTemplatesSummary = z
  .object({
    templates: z.number().int().min(0),
    active: z.number().int().min(0),
    awaiting_sample: z.number().int().min(0),
    sent_90d: z.number().int().min(0),
  })
  .strict();

/**
 * GET /letter-templates/:id/preview: the letter's wording filled with sample values, as
 * paragraphs of runs; `filled` marks the words that came from the record, so the screen
 * can show which parts the system writes. Nothing is stored.
 */
const LetterPreview = z
  .object({
    reference: z.string(),
    title: z.string(),
    date_line: z.string(),
    paragraphs: z
      .array(z.array(z.object({ text: z.string(), filled: z.boolean() }).strict()).max(200))
      .max(200),
  })
  .strict();

/**
 * What every query and sanction letter may say (shared/templates/variables.js).
 * Dates are ISO and money a Naira string; the template formats them for the reader
 * (`{{ longdate raised_on }}`, `{{ money fine_amount }}`, shared/documents/render.js).
 */
const ConsequenceLetterVars = z
  .object({
    employee: z
      .object({
        display_name: z.string(),
        first_name: z.string(),
        job_title: z.string().nullable(),
        department: z.string().nullable(),
      })
      .strict(),
    query_number: z.string(),
    subject: z.string(),
    details: z.string(),
    reason: z.string().nullable().default(null),
    step_name: z.string().nullable().default(null),
    raised_on: isoDate,
    response_due: isoDateTime.nullable().default(null),
    effective_on: isoDate.nullable().default(null),
    ends_on: isoDate.nullable().default(null),
    days: z.number().int().nullable().default(null),
    fine_amount: money.nullable().default(null),
    // The policy the query cites, and the line quoted (guide §6.2).
    policy: z
      .object({ number: z.string(), title: z.string(), version: z.number().int(), clause: z.string().nullable() })
      .strict()
      .nullable()
      .default(null),
    signer: z
      .object({
        name: z.string(),
        role: z.string(),
        // The signer's drawn signature as a PNG data URL, printed above their name (guide §6.2).
        signature: z
          .string()
          .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
          .nullable()
          .default(null),
      })
      .strict(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  LetterTemplate: {
    table: "letter_template",
    virtual: {
      version: "the current template_version.version, 0 for the shipped default",
      used_by: "names of the consequence_step and query_rule rows that send it",
    },
  },
  LetterTemplatePage: { table: null, reason: "a page of letter templates" },
  LetterTemplateDetail: {
    table: "letter_template",
    virtual: {
      version: "the current template_version.version, 0 for the shipped default",
      used_by: "names of the consequence_step and query_rule rows that send it",
      title: "template_version.title",
      body: "template_version.body, or the shipped file",
      format: "template_version.format",
      variables: "the names ConsequenceLetterVars declares",
    },
  },
  LetterTemplateListQuery: { table: null, reason: "list controls and filters for Letter Templates" },
  LetterTemplateCreate: {
    table: "letter_template",
    virtual: { title: "written to template_version", body: "written to template_version" },
  },
  LetterTemplateBodySave: {
    table: null,
    reason: "the next template_version of the template's key",
  },
  LetterTemplatesSummary: { table: null, reason: "counts over letter_template and the letters sent" },
  LetterPreview: { table: null, reason: "a render with sample values; nothing is stored" },
  ConsequenceLetterVars: {
    table: null,
    reason: "template variables for query and sanction letters",
  },
};

module.exports = {
  TABLES,
  LetterPurpose,
  LetterTemplateStatus,
  LetterTemplate,
  LetterTemplatePage,
  LetterTemplateDetail,
  LetterTemplateListQuery,
  LetterTemplateCreate,
  LetterTemplateBodySave,
  LetterTemplatesSummary,
  LetterPreview,
  ConsequenceLetterVars,
};
