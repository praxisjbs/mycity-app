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
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, listQuery, Paged } = require("./common");

const LibraryStatus = z.enum(["signed", "expiring"]);

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
  })
  .strict();

const LibraryPage = Paged(LibraryDocument);

/** GET /library/documents. Newest first unless a sort is asked for. */
const LibraryListQuery = listQuery(
  {
    area: LibraryArea.optional(),
    doc_type: LibraryType.optional(),
    status: LibraryStatus.optional(),
    added: LibraryAdded.optional(),
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

const LibraryAreaOption = z.object({ area: z.string(), label: z.string() }).strict();
const LibraryTypeOption = z.object({ doc_type: z.string(), label: z.string(), area: z.string() }).strict();

/** GET /library/filters: the areas and types the reader can reach, for the Area and Type filters. */
const LibraryFilters = z
  .object({
    areas: z.array(LibraryAreaOption).max(40),
    types: z.array(LibraryTypeOption).max(80),
  })
  .strict();

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
    },
  },
  LibraryPage: { table: null, reason: "a page of the library" },
  LibraryListQuery: { table: null, reason: "list controls and filters for the library" },
  LibrarySummary: { table: null, reason: "counts over the documents the reader may see" },
  LibraryAreaOption: { table: null, reason: "a module the reader can reach documents of" },
  LibraryTypeOption: { table: null, reason: "a document type the reader can reach" },
  LibraryFilters: { table: null, reason: "the Area and Type filters' options, from the library's sources" },
};

module.exports = {
  TABLES,
  LibraryStatus,
  LibraryAdded,
  LibraryRecord,
  LibraryDocument,
  LibraryPage,
  LibraryListQuery,
  LibrarySummary,
  LibraryAreaOption,
  LibraryTypeOption,
  LibraryFilters,
};
