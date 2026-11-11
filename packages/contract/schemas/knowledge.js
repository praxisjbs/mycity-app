"use strict";
/**
 * Knowledge Hub · SOPs (docs/guides/knowledge.md §4 to §6.4): each department's own standard
 * operating procedures, structured and versioned, written by the department's head or holders of
 * `sops.manage`, read by everyone. Policies are `policies.js`; training is `training.js`.
 *
 * An SOP is Purpose, Scope, Roles Involved and numbered Steps; a step's text is Markdown (bold,
 * italic, links, lists) the reader draws as blocks, never HTML. A step may name the screen it
 * happens on as a route map key (`people/employees`), which lists the SOP under Procedures in that
 * screen's help, and carry a file from the vault.
 *
 * States: `draft` (never published), `published` (a version in force, perhaps with a draft being
 * written), `archived`.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDateTime, listQuery, Paged } = require("./common");
const { RichTextBlock } = require("./policies");

const longEnough = (n) => (v) => v.trim().length >= n;
const reasonText = text(500).refine(longEnough(10), "At least 10 characters");

const SopState = z.enum(["draft", "published", "archived"]);

/** A route map screen, `<module>/<tab>`; the service checks it is one the route map knows. */
const ScreenKey = z.string().regex(/^[a-z_]+\/[a-z0-9-]+$/, "Pick a screen");

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** One numbered step as staff read it, and as the editor loads it. */
const SopStep = z
  .object({
    position: z.number().int().min(1).max(50),
    /** Markdown, for the editor. */
    text: z.string(),
    /** The same, as the reader draws it. */
    blocks: z.array(RichTextBlock),
    who: z.string().nullable(),
    screen_key: z.string().nullable(),
    /** The screen's name as the hub shows it; null when the key no longer resolves (§11). */
    screen_label: z.string().nullable(),
    document_id: uuid.nullable(),
    document_name: z.string().nullable(),
  })
  .strict();

/** A published version: what everyone reads. */
const SopVersion = z
  .object({
    sop_version_id: uuid,
    sop_id: uuid,
    number: z.string(),
    department_id: uuid,
    department_name: z.string(),
    version: z.number().int().min(1),
    title: z.string(),
    purpose: z.string(),
    scope: z.string().nullable(),
    roles: z.array(z.string()),
    steps: z.array(SopStep),
    note: z.string().nullable(),
    published_at: isoDateTime,
    published_by_name: z.string().nullable(),
    content_hash: z.string(),
  })
  .strict();

/** The draft being written, for a writer. */
const SopDraft = z
  .object({
    sop_version_id: uuid,
    title: z.string(),
    purpose: z.string().nullable(),
    scope: z.string().nullable(),
    roles: z.array(z.string()),
    steps: z.array(SopStep),
    /** Whether it differs from the version in force (always true before the first version). */
    has_changes: z.boolean(),
    updated_at: isoDateTime,
    updated_by_name: z.string().nullable(),
  })
  .strict();

/** One SOP: its version in force, and its draft for a writer. */
const Sop = z
  .object({
    sop_id: uuid,
    number: z.string(),
    department_id: uuid,
    department_name: z.string(),
    title: z.string(),
    state: SopState,
    in_force: SopVersion.nullable(),
    draft: SopDraft.nullable(),
    archived_at: isoDateTime.nullable(),
    archive_reason: z.string().nullable(),
    /** The reader may write this department's SOPs (its head, or `sops.manage`). */
    can_edit: z.boolean(),
    can_archive: z.boolean(),
  })
  .strict();

/** A row of Knowledge Hub · SOPs, and of a screen's Procedures. */
const SopRow = z
  .object({
    sop_id: uuid,
    number: z.string(),
    title: z.string(),
    department_id: uuid,
    department_name: z.string(),
    state: SopState,
    version: z.number().int().min(1).nullable(),
    has_draft: z.boolean(),
    updated_at: isoDateTime,
  })
  .strict();
const SopPage = Paged(SopRow);

const SopListQuery = listQuery(
  {
    department_id: uuid.optional(),
    state: SopState.optional(),
  },
  ["title", "number", "updated_at"],
);

/** The SOPs a step of whose version in force names this screen. */
const SopScreenQuery = listQuery({ screen_key: ScreenKey });

/**
 * A department on Knowledge Hub · SOPs: a chip over the list (one with an SOP the reader may read),
 * or, with `writable`, one the reader may write SOPs for (New SOP's Department; none for a reader
 * who writes for no department).
 */
const SopDepartment = z.object({ department_id: uuid, name: z.string() }).strict();
const SopDepartmentPage = Paged(SopDepartment);
const SopDepartmentQuery = listQuery({ writable: z.enum(["true", "false"]).optional() });

/** One row of an SOP's version history. */
const SopVersionRow = z
  .object({
    sop_version_id: uuid,
    version: z.number().int().min(1),
    title: z.string(),
    note: z.string().nullable(),
    published_at: isoDateTime,
    published_by_name: z.string().nullable(),
  })
  .strict();
const SopVersionPage = Paged(SopVersionRow);

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** New SOP: its department (fixed for good) and title; an empty draft is made with it. */
const SopCreate = z
  .object({
    department_id: uuid,
    title: text(120).refine(longEnough(4), "At least 4 characters"),
  })
  .strict();

/** One step as the editor saves it. */
const SopStepInput = z
  .object({
    text: text(1000).refine(longEnough(3), "Write the step"),
    who: optionalText(80),
    screen_key: ScreenKey.optional(),
    document_id: uuid.optional(),
  })
  .strict();

/**
 * Save Draft: every field, the steps in order. A draft may be unfinished; Publish asks for the
 * purpose and at least one step (§6.3).
 */
const SopDraftSave = z
  .object({
    title: text(120).refine(longEnough(4), "At least 4 characters"),
    purpose: optionalText(600).refine((v) => v === undefined || v.length >= 10, "At least 10 characters"),
    scope: optionalText(600),
    roles: z.array(text(60)).max(10, "Ten roles at most"),
    steps: z.array(SopStepInput).max(50, "Fifty steps at most"),
  })
  .strict();

/** Publish SOP: the note says what changed; required from Version 2 (the service). */
const SopPublish = z
  .object({
    note: optionalText(500).refine((v) => v === undefined || v.length >= 10, "At least 10 characters"),
  })
  .strict();

/** Archive SOP. */
const SopReason = z.object({ reason: reasonText }).strict();

/** Draft With AI: a pasted procedure or an uploaded PDF, never both (§6.4). */
const SopDraftWithAi = z
  .object({
    department_id: uuid,
    text: optionalText(20_000),
    document_id: uuid.optional(),
  })
  .strict()
  .refine((v) => (v.text ? 1 : 0) + (v.document_id ? 1 : 0) === 1, { message: "Paste the procedure or pick a PDF", path: ["text"] });

/** What Draft With AI suggests: the form's fields, never saved until the writer saves. */
const SopDraftSuggestion = z
  .object({
    title: z.string(),
    purpose: z.string(),
    scope: z.string().nullable(),
    roles: z.array(z.string()).max(10),
    steps: z.array(z.object({ text: z.string(), who: z.string().nullable() }).strict()).max(50),
  })
  .strict();

const TABLES = {
  SopStep: {
    table: "sop_step",
    virtual: {
      blocks: "text, as the reader draws it",
      screen_label: "the screen's name from the route map",
      document_name: "the document's file name",
    },
  },
  SopVersion: {
    table: "sop_version",
    virtual: {
      number: "the SOP's",
      department_id: "the SOP's",
      department_name: "the SOP's department's name",
      steps: "its sop_step rows",
      published_by_name: "the publisher's name",
    },
  },
  SopDraft: {
    table: "sop_version",
    virtual: {
      steps: "its sop_step rows",
      has_changes: "worked out against the version in force",
      updated_by_name: "who saved it last",
    },
  },
  Sop: {
    table: "sop",
    virtual: {
      department_name: "the department's name",
      state: "worked out from status and its versions",
      in_force: "its newest published sop_version",
      draft: "its draft sop_version, for a writer",
      can_edit: "the reader heads the department or holds sops.manage",
      can_archive: "can_edit, with knowledge delete for sops.manage",
    },
  },
  SopRow: {
    table: "sop",
    virtual: {
      department_name: "the department's name",
      state: "worked out from status and its versions",
      version: "the version in force's number",
      has_draft: "whether a draft sop_version exists",
    },
  },
  SopPage: { table: null, reason: "a page of SOPs" },
  SopListQuery: { table: null, reason: "list controls, not a row" },
  SopScreenQuery: { table: null, reason: "list controls, not a row" },
  SopDepartment: { table: "department" },
  SopDepartmentPage: { table: null, reason: "a page of departments" },
  SopDepartmentQuery: { table: null, reason: "list controls, not a row" },
  SopVersionRow: { table: "sop_version", virtual: { published_by_name: "the publisher's name" } },
  SopVersionPage: { table: null, reason: "a page of an SOP's versions" },
  SopCreate: { table: "sop" },
  SopStepInput: { table: "sop_step" },
  SopDraftSave: { table: "sop_version", virtual: { steps: "written as sop_step rows" } },
  SopPublish: { table: "sop_version" },
  SopReason: { table: null, reason: "the archive reason, written to sop.archive_reason" },
  SopDraftWithAi: { table: null, reason: "what Draft With AI reads; nothing is saved" },
  SopDraftSuggestion: { table: null, reason: "a suggestion the writer may take into the form; nothing is saved" },
};

module.exports = {
  TABLES,
  SopState,
  ScreenKey,
  SopStep,
  SopVersion,
  SopDraft,
  Sop,
  SopRow,
  SopPage,
  SopListQuery,
  SopScreenQuery,
  SopDepartment,
  SopDepartmentPage,
  SopDepartmentQuery,
  SopVersionRow,
  SopVersionPage,
  SopCreate,
  SopStepInput,
  SopDraftSave,
  SopPublish,
  SopReason,
  SopDraftWithAi,
  SopDraftSuggestion,
};
