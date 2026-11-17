"use strict";
/**
 * The Document Centre's Library (docs/guides/document-centre.md): the business documents a reader
 * may already open from their own modules, listed in one place.
 *
 * A row is one current file of the vault's `document` table, of a type a module gives the library
 * (`<module>.library.js`, shared/documents/library.js), listed only for a reader the vault's own
 * rule lets open it (§6.3). Nothing is copied: the file's bytes are still read from
 * GET /documents/:id/content, where the vault checks once more.
 *
 * Statuses a person reads, worked out and never stored (§6.6):
 *   signed     locked: signed, sent or filed, and never replaceable
 *   expiring   its expiry is inside EXPIRING_WITHIN_DAYS, or has passed
 *   archived   a company document taken out of the library (listed only with the Archived filter)
 *
 * Company documents (§6.4, §6.5): the company's own papers, uploaded here into a category MyCity
 * names, each category seen by everyone or by named roles. The file is staged through the upload
 * engine (POST /documents) and claimed by POST /library/documents; a new version is staged the same
 * way. Tags are free words, lower case, at most MAX_TAGS a document.
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, listQuery, Paged, recordId, changesBeside, nothingOn } = require("./common");

/** The most tags one document carries (§6.4). */
const MAX_TAGS = 8;

const LibraryStatus = z.enum(["signed", "expiring", "archived"]);

/** What the Status filter offers: archived is the Archived filter's, for those who keep the library. */
const LibraryStatusFilter = z.enum(["signed", "expiring"]);

/** Who sees a category's documents (§6.4). */
const CategoryAudience = z.enum(["everyone", "roles"]);

/** One tag: 2 to 30 letters, numbers, spaces or hyphens, kept lower case. */
const DocumentTag = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "At least 2 letters")
  .max(30, "At most 30 characters")
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} -]*$/u, "Letters and numbers only");

/** A document's tags: each once, at most MAX_TAGS. */
const DocumentTags = z
  .array(DocumentTag)
  .max(MAX_TAGS, `At most ${MAX_TAGS} tags`)
  .transform((tags) => [...new Set(tags)]);

/** A title a person gives a company document. */
const DocumentTitle = text(200);

/** What a company document is, for its uploader: optional. */
const DocumentDescription = z.string().trim().max(2000, "At most 2000 characters");

/** When a document was added, as the Added filter offers it. */
const LibraryAdded = z.enum(["this_month", "last_90_days", "this_year"]);

/** A module key, as the Area filter sends it. */
const LibraryArea = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, "Pick an area");

/** A registered document type, as the Type filter sends it. */
const LibraryType = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,63}$/, "Pick a document type");

/** The record a document belongs to: a partner, an employee, a request. `link` is null when the reader may not open it. */
const LibraryRecord = z
  .object({
    type: z.string(),
    id: z.string(),
    label: z.string().nullable(),
    ref: z.string().nullable(),
    link: z.string().nullable(),
  })
  .strict();

/** A company document's category, as a row names it. */
const LibraryCategoryRef = z.object({ document_category_id: uuid, name: z.string() }).strict();

/**
 * What only a company document carries (§6.4, §6.5): its category, tags, description, whether it
 * is archived, and what the reader may do with it (the uploader or `documents.manage`).
 */
const LibraryCompanyFacts = z
  .object({
    company_document_id: uuid,
    category: LibraryCategoryRef,
    tags: z.array(z.string()).max(MAX_TAGS),
    description: z.string().nullable(),
    archived_at: isoDateTime.nullable(),
    may_edit: z.boolean(),
    may_archive: z.boolean(),
  })
  .strict();

/** One document of the library, as its list and its record show it. `storage_key` never crosses the wire. */
const LibraryDocument = z
  .object({
    document_id: uuid,
    title: z.string(),
    original_name: z.string().nullable(),
    doc_type: z.string(),
    type_label: z.string(),
    area: z.string(),
    area_label: z.string(),
    record: LibraryRecord.nullable(),
    number: z.string().nullable(),
    mime: z.string(),
    bytes: z.number().int().min(0),
    page_count: z.number().int().min(1).nullable(),
    version: z.number().int().min(1),
    status: LibraryStatus.nullable(),
    expires_on: isoDate.nullable(),
    locked_at: isoDateTime.nullable(),
    created_at: isoDateTime,
    added_by_name: z.string().nullable(),
    /** A company document's own facts; null for another module's document. */
    company: LibraryCompanyFacts.nullable(),
    /** The words around a match in the file's text, for the reader it is listed for; null otherwise (§6.7). */
    matched_text: z.string().max(200).nullable(),
  })
  .strict();

const LibraryPage = Paged(LibraryDocument);

/** GET /library/documents. Newest first unless a sort is asked for. */
const LibraryListQuery = listQuery(
  {
    area: LibraryArea.optional(),
    doc_type: LibraryType.optional(),
    status: LibraryStatusFilter.optional(),
    added: LibraryAdded.optional(),
    category_id: uuid.optional(),
    tag: DocumentTag.optional(),
    /** Archived company documents instead of the current ones: for `documents.manage` (§6.1). */
    archived: z.enum(["true", "false"]).optional(),
  },
  ["created_at", "title", "expires_on"],
);

/** GET /library/documents/summary: the four figures above the list, over what the reader may see. */
const LibrarySummary = z
  .object({
    documents: z.number().int().min(0),
    added_this_month: z.number().int().min(0),
    expiring: z.number().int().min(0),
    signed: z.number().int().min(0),
  })
  .strict();

/** Praxis AI's summary of the Library: the four figures, over everything the asker may see. */
const LibrarySummaryQuery = z.object({}).strict();

const LibraryAreaOption = z.object({ area: z.string(), label: z.string() }).strict();
const LibraryTypeOption = z.object({ doc_type: z.string(), label: z.string(), area: z.string() }).strict();

/** GET /library/filters: the areas and types the reader can reach, for the Area and Type filters. */
const LibraryFilters = z
  .object({
    areas: z.array(LibraryAreaOption).max(40),
    types: z.array(LibraryTypeOption).max(80),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Company documents (§6.4, §6.5)
 * ------------------------------------------------------------------ */

/** POST /library/documents: Upload Document. `document_id` is the staged upload's (POST /documents). */
const CompanyDocumentCreate = z
  .object({
    document_id: z.string().uuid("Upload a file"),
    title: DocumentTitle,
    document_category_id: z.string().uuid("Pick a category"),
    tags: DocumentTags.default([]),
    expires_on: isoDate.nullish(),
    description: DocumentDescription.nullish(),
  })
  .strict();

/** The fields Edit Details changes; null clears an expiry or a description. */
const CompanyDocumentFields = {
  title: DocumentTitle.optional(),
  document_category_id: z.string().uuid("Pick a category").optional(),
  tags: DocumentTags.optional(),
  expires_on: isoDate.nullish(),
  description: DocumentDescription.nullish(),
};

/** PATCH /library/documents/:id: Edit Details. Something must change. */
const CompanyDocumentUpdate = z
  .object(CompanyDocumentFields)
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), nothingOn("title"));

/** Edit Details' card (praxis-ai.md decision 33): the document, found by its title, and what changes. */
const CompanyDocumentChange = z
  .object({ document_id: recordId("document"), ...CompanyDocumentFields })
  .strict()
  .refine(changesBeside(["document_id"]), nothingOn("document_id"));

/** POST /library/documents/:id/versions: Upload New Version, from a staged upload. */
const CompanyDocumentVersion = z.object({ document_id: z.string().uuid("Upload a file") }).strict();

/* ------------------------------------------------------------------ *
 * Categories (§6.4)
 * ------------------------------------------------------------------ */

const CategoryRole = z.object({ role_id: uuid, name: z.string() }).strict();

/** One category: who sees it, and how many current documents it holds. */
const DocumentCategory = z
  .object({
    document_category_id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    audience: CategoryAudience,
    roles: z.array(CategoryRole).max(60),
    documents: z.number().int().min(0),
    archived_at: isoDateTime.nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();

const CategoryPage = Paged(DocumentCategory);

/** GET /library/categories: those the reader sees; `archived` for `documents.manage`. */
const CategoryListQuery = listQuery({ archived: z.enum(["true", "false"]).optional() }, ["name", "created_at"]);

const CategoryName = text(80);
const CategoryRoleIds = z.array(uuid).max(60).transform((ids) => [...new Set(ids)]);
const rolesNamed = (v) => v.audience !== "roles" || (Array.isArray(v.role_ids) && v.role_ids.length > 0);
const pickRole = { message: "Pick a role", path: ["role_ids"] };

/** New Category. A category seen by roles names at least one. */
const DocumentCategoryCreate = z
  .object({
    name: CategoryName,
    description: DocumentDescription.max(500, "At most 500 characters").nullish(),
    audience: CategoryAudience.default("everyone"),
    role_ids: CategoryRoleIds.default([]),
  })
  .strict()
  .refine(rolesNamed, pickRole);

const CategoryFields = {
  name: CategoryName.optional(),
  description: DocumentDescription.max(500, "At most 500 characters").nullish(),
  audience: CategoryAudience.optional(),
  role_ids: CategoryRoleIds.optional(),
};

/** Edit Category. Something must change; a roles audience names a role (checked again by the service). */
const DocumentCategoryUpdate = z
  .object(CategoryFields)
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), nothingOn("name"))
  .refine((v) => v.audience !== "roles" || v.role_ids === undefined || v.role_ids.length > 0, pickRole);

/** Edit Category's card: the category, matched by its name, and what changes. */
const DocumentCategoryChange = z
  .object({ document_category_id: recordId("category"), ...CategoryFields })
  .strict()
  .refine(changesBeside(["document_category_id"]), nothingOn("document_category_id"));

/* ------------------------------------------------------------------ *
 * Tags and the letterhead
 * ------------------------------------------------------------------ */

/** One tag in use, and on how many documents the reader sees. */
const TagRow = z.object({ tag: z.string(), documents: z.number().int().min(0) }).strict();
const TagPage = Paged(TagRow);
const TagListQuery = listQuery({}, ["tag"]);

/** POST /library/letterhead: Download Letterhead, as PDF or Word (§6.8). */
const LetterheadRequest = z.object({ format: z.enum(["pdf", "docx"]) }).strict();

/** The blank letterhead's template takes nothing: Settings · Organisation fills it. */
const LetterheadVars = z.object({}).strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  LibraryRecord: { table: null, reason: "the record a document belongs to, read from its own module's table" },
  LibraryDocument: {
    table: "document",
    virtual: {
      title: "the document's title, else its file name, else its type's label",
      type_label: "the type's name in the library (shared/documents/library.js)",
      area: "the module key the type belongs to",
      area_label: "that module's name",
      record: "the record the file belongs to, from its source",
      status: "signed when locked, expiring when its expiry is near or past, else none",
      added_by_name: "the display name of who uploaded or generated it",
      company: "a company document's own facts, from company_document",
      matched_text: "the words around a search's match in document_text.text",
    },
  },
  LibraryCategoryRef: { table: "document_category" },
  LibraryCompanyFacts: {
    table: "company_document",
    virtual: {
      category: "its document_category, by name",
      may_edit: "whether the reader uploaded it or holds documents.manage",
      may_archive: "whether the reader may archive or restore it",
    },
  },
  CompanyDocumentCreate: { table: "company_document", virtual: { expires_on: "set on the vault's document.expires_on" } },
  CompanyDocumentUpdate: { table: "company_document", virtual: { expires_on: "set on the vault's document.expires_on" } },
  CompanyDocumentChange: { table: "company_document", virtual: { expires_on: "set on the vault's document.expires_on" } },
  CompanyDocumentVersion: { table: "company_document" },
  CategoryRole: { table: "role", virtual: { name: "the role's name" } },
  DocumentCategory: {
    table: "document_category",
    virtual: { roles: "its document_category_role rows, named", documents: "current company documents in it" },
  },
  CategoryPage: { table: null, reason: "a page of categories" },
  CategoryListQuery: { table: null, reason: "list controls for the categories" },
  DocumentCategoryCreate: { table: "document_category", virtual: { role_ids: "written as document_category_role rows" } },
  DocumentCategoryUpdate: { table: "document_category", virtual: { role_ids: "written as document_category_role rows" } },
  DocumentCategoryChange: { table: "document_category", virtual: { role_ids: "written as document_category_role rows" } },
  TagRow: { table: null, reason: "a tag in use, counted over company_document.tags" },
  TagPage: { table: null, reason: "a page of tags" },
  TagListQuery: { table: null, reason: "list controls for the tag field's suggestions" },
  LetterheadRequest: { table: null, reason: "which file Download Letterhead makes" },
  LetterheadVars: { table: null, reason: "the blank letterhead's template variables: none" },
  LibraryPage: { table: null, reason: "a page of the library" },
  LibraryListQuery: { table: null, reason: "list controls and filters for the library" },
  LibrarySummary: { table: null, reason: "counts over the documents the reader may see" },
  LibrarySummaryQuery: { table: null, reason: "the summary takes no filters: the four figures over what the reader may see" },
  LibraryAreaOption: { table: null, reason: "a module the reader can reach documents of" },
  LibraryTypeOption: { table: null, reason: "a document type the reader can reach" },
  LibraryFilters: { table: null, reason: "the Area and Type filters' options, from the library's sources" },
};

module.exports = {
  TABLES,
  MAX_TAGS,
  LibraryStatus,
  LibraryStatusFilter,
  CategoryAudience,
  DocumentTag,
  LibraryCategoryRef,
  LibraryCompanyFacts,
  CompanyDocumentCreate,
  CompanyDocumentUpdate,
  CompanyDocumentChange,
  CompanyDocumentVersion,
  CategoryRole,
  DocumentCategory,
  CategoryPage,
  CategoryListQuery,
  DocumentCategoryCreate,
  DocumentCategoryUpdate,
  DocumentCategoryChange,
  TagRow,
  TagPage,
  TagListQuery,
  LetterheadRequest,
  LetterheadVars,
  LibraryAdded,
  LibraryRecord,
  LibraryDocument,
  LibraryPage,
  LibraryListQuery,
  LibrarySummary,
  LibrarySummaryQuery,
  LibraryAreaOption,
  LibraryTypeOption,
  LibraryFilters,
};
