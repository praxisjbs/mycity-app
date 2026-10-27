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
const { uuid, text, isoDate, isoDateTime, money, listQuery, Paged, textOfHtml } = require("./common");

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
  /**
   * The wording as the rich text editor opens it. A shipped HTML letter comes converted to the
   * editor's Markdown, its names kept, so saving it keeps MyCity's wording as its first version.
   */
  body_html: z.string().nullable(),
  format: z.enum(["html", "markdown"]).nullable(),
  variables: z.array(z.string()).max(50),
  /**
   * Something sends it: a step, a rule, every manual query (the Query Letter) or every fine (the
   * Salary Deduction Letter). While true it cannot be deactivated or change what it is used for.
   */
  in_use: z.boolean(),
}).strict();

/** GET /letter-templates */
const LetterTemplateListQuery = listQuery(
  { purpose: LetterPurpose.optional(), status: LetterTemplateStatus.optional() },
  ["name", "updated_at"],
);

/** POST /letter-templates: a new letter, saved as a draft. Its key is made from the name. */
/**
 * The wording, as Markdown (`body`, for scripts and imports) or as the rich text editor's HTML
 * (`body_html`, kept as Markdown by the server): exactly one of them.
 */
const bodyHtml = z
  .string()
  .max(60_000, "Too long")
  .refine((v) => textOfHtml(v).length >= 40, "Write the letter");
const oneBody = (v) => (v.body === undefined) !== (v.body_html === undefined);
const ONE_BODY = { message: "Write the letter", path: ["body_html"] };

const LetterTemplateCreate = z
  .object({
    name: text(80),
    purpose: LetterPurpose,
    title: text(150).optional(),
    body: body.optional(),
    body_html: bodyHtml.optional(),
    // Save Draft, or Save and Activate: ready to be chosen at once.
    status: z.enum(["draft", "active"]).default("draft"),
  })
  .strict()
  .refine(oneBody, ONE_BODY);

/**
 * PATCH /letter-templates/:id: its name, and what it is used for while nothing sends it. A fine's
 * letter is the shipped one only, so Used For is Queries or Sanctions.
 */
const LetterTemplateUpdate = z
  .object({
    name: text(80).optional(),
    purpose: z.enum(["query", "sanction"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/** PUT /letter-templates/:id/body: new wording, saved as the next version. */
const LetterTemplateBodySave = z
  .object({
    title: text(150).optional(),
    body: body.optional(),
    body_html: bodyHtml.optional(),
  })
  .strict()
  .refine(oneBody, ONE_BODY);

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

/** POST /letter-templates/assist: the letter being written and what to say (queries guide §9). */
const LetterDraftRequest = z
  .object({
    name: z.string().trim().min(1).max(80),
    purpose: LetterPurpose,
    body_html: z.string().max(60_000).default(""),
    instruction: z.string().trim().min(10, "Say what to write").max(2000, "At most 2000 characters"),
  })
  .strict();

/** The drafted wording as the editor's HTML, or why there is none. Nothing changes until Use Draft. */
const LetterDraft = z
  .object({
    available: z.boolean(),
    reason: z.enum(["off", "limit"]).nullable(),
    body_html: z.string().nullable(),
    ai_run_id: uuid.nullable(),
  })
  .strict();

/** The model's answer: Markdown with only the names a letter may fill. */
const LetterDraftOutput = z
  .object({ body_markdown: z.string().trim().min(40).max(12_000) })
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
      body_html: "body rendered by the one Markdown renderer, for the editor",
      format: "template_version.format",
      variables: "the names ConsequenceLetterVars declares",
      in_use: "whether a step, a rule, every manual query or every fine sends it",
    },
  },
  LetterTemplateListQuery: { table: null, reason: "list controls and filters for Letter Templates" },
  LetterTemplateCreate: {
    table: "letter_template",
    virtual: {
      title: "written to template_version",
      body: "written to template_version",
      body_html: "the editor's HTML, written to template_version as Markdown",
    },
  },
  LetterTemplateUpdate: { table: "letter_template" },
  LetterTemplateBodySave: {
    table: null,
    reason: "the next template_version of the template's key",
  },
  LetterTemplatesSummary: { table: null, reason: "counts over letter_template and the letters sent" },
  LetterPreview: { table: null, reason: "a render with sample values; nothing is stored" },
  LetterDraftRequest: { table: null, reason: "the letter being written and what to say; nothing is kept" },
  LetterDraft: { table: null, reason: "a draft shown before anything changes; nothing is kept" },
  LetterDraftOutput: { table: null, reason: "the model's answer, checked before anyone sees it" },
  ConsequenceLetterVars: {
    table: null,
    reason: "template variables for query and sanction letters",
  },
};

module.exports = {
  TABLES,
  LetterDraftRequest,
  LetterDraft,
  LetterDraftOutput,
  LetterPurpose,
  LetterTemplateStatus,
  LetterTemplate,
  LetterTemplatePage,
  LetterTemplateDetail,
  LetterTemplateListQuery,
  LetterTemplateCreate,
  LetterTemplateBodySave,
  LetterTemplateUpdate,
  LetterTemplatesSummary,
  LetterPreview,
  ConsequenceLetterVars,
};
