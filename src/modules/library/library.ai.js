"use strict";
/**
 * What Praxis AI may read and do in the Document Centre (docs/guides/document-centre.md §9, D12).
 *
 *   documents.find       the library as the asker sees it, 25 at a time: each document's title, type,
 *                        what it belongs to, its number and dates, cited so its button opens it in the
 *                        Library. By the asker's own rights (the vault's rule, §6.3); the words found
 *                        inside a file are never returned, and a file's contents never reach a model.
 *   documents.summary    the four figures of the Library's cards.
 *
 * Its cards, each the module's own service function, run with the person's rights at the press:
 * Edit Details (the uploader or documents.manage), New Category and Edit Category (documents.manage).
 * Upload Document and Upload New Version take a file, which is uploaded on the screen.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const service = require("./library.service");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categoryLine = (status) => (row) => [
  { type: "document_category", id: row.document_category_id, label: row.name, status, link: routeMap.screenPath("documents", "categories", { id: row.document_category_id }) },
];
const CATEGORY_LABELS = { name: "Name", description: "Description" };

/** One page of the library for the assistant: what a person reads in the list, never a file's words. */
async function find(params, actor) {
  const page = await service.list(params, actor);
  return { ...page, data: page.data.map((d) => ({ ...d, matched_text: null })) };
}

/** The four figures, as a summary. */
async function figures(client, actor) {
  const { figure } = require("../../shared/ai/summary");
  const s = await service.summary(actor, client);
  return {
    figures: [
      figure("documents", "All documents", s.documents),
      figure("added_this_month", "Added this month", s.added_this_month),
      figure("expiring", "Expiring within 60 days or ended", s.expiring),
      figure("signed", "Signed, sent or filed", s.signed),
    ],
    groups: [],
    series: [],
    total: s.documents,
  };
}

/** A category a card names, by its name; a company document, by its title. */
const categoryNamed = (db, actor, id) =>
  UUID.test(String(id || "")) ? service.cardCategory(db, id) : Promise.resolve([]);

module.exports = defineManifest({
  module: "documents",
  reads: [
    {
      key: "documents.find",
      summary: "documents.summary",
      description: "Find documents the asker may open (agreements, letters, contracts, invoices, certificates, company papers) by words, area, type, status, date added, category or tag",
      params: c.library.LibraryListQuery,
      permission: ["documents", "view"],
      run: (_client, params, actor) => find(params, actor),
      cite: (row) => ({ type: "library_item", id: row.document_id, label: row.title }),
    },
  ],
  summaries: [
    {
      key: "documents.summary",
      description: "The Document Centre in figures: documents the asker may open, added this month, expiring within 60 days or ended, signed",
      params: c.library.LibrarySummaryQuery,
      permission: ["documents", "view"],
      run: (client, _params, actor) => figures(client, actor),
    },
  ],
  actions: [
    {
      key: "documents.edit_details",
      label: "Save Details",
      description: "Change a company document's title, category, tags, expiry date or description; only what changes. Another module's document is changed where it was made",
      input: c.library.CompanyDocumentChange,
      permission: ["documents", "edit"],
      risk: "standard",
      form: "none: Edit Details' form changes the document open in the Library and never names it; the card does",
      fields: ["document_id", "title", "document_category_id", "tags", "expires_on", "description"],
      asks: [{ field: "document_id", question: "Which document?", options: ({ db, actor }) => service.documentNames(db, actor) }],
      resolve: {
        document_id: (value, actor, db) => service.documentIdOf(db, value, actor),
        document_category_id: (value, actor, db) => service.categoryIdOf(db, value, actor),
      },
      records: (values, actor, db) => service.cardDocument(db, values.document_id, actor),
      names: (values, actor, db) => categoryNamed(db, actor, values.document_category_id),
      check: async (client, values, actor) => {
        if (!(await service.cardDocument(client, values.document_id, actor)).length) throw new (require("../../shared/errors").AppError)("NOT_FOUND", "Document not found", 404);
      },
      run: (values, actor) => {
        const { document_id: id, ...changes } = values;
        return service.update(id, changes, actor);
      },
      readback: (row) => [{ type: "library_item", id: row.document_id, label: row.title, status: "saved", link: routeMap.screenPath("documents", "library", { id: row.document_id }) }],
      labels: { document_id: "Document", title: "Title", document_category_id: "Category", tags: "Tags", expires_on: "Expires", description: "Description" },
    },
    {
      key: "documents.category_create",
      label: "New Category",
      description: "Add a document category seen by everyone: its name and what it holds. One seen only by named roles is set on Document Centre, Categories",
      input: c.library.DocumentCategoryCreate,
      permission: ["documents", "edit"],
      capability: "documents.manage",
      risk: "standard",
      fields: ["name", "description"],
      asks: [{ field: "name", question: "What is the category called?" }],
      run: (values, actor) => service.createCategory({ ...values, audience: "everyone", role_ids: [] }, actor),
      readback: categoryLine("added"),
      labels: CATEGORY_LABELS,
    },
    {
      key: "documents.category_edit",
      label: "Save Category",
      description: "Rename a document category or change what it holds; only what changes. Who sees it is set on Document Centre, Categories",
      input: c.library.DocumentCategoryChange,
      permission: ["documents", "edit"],
      capability: "documents.manage",
      risk: "standard",
      form: "none: Edit Category's form changes the category open on Document Centre · Categories and never names it; the card does",
      fields: ["document_category_id", "name", "description"],
      asks: [{ field: "document_category_id", question: "Which category?", options: ({ db, actor }) => service.categoryNames(db, actor) }],
      resolve: { document_category_id: (value, actor, db) => service.categoryIdOf(db, value, actor) },
      records: (values, _actor, db) => service.cardCategory(db, values.document_category_id),
      check: async (client, values) => {
        if (!(await service.cardCategory(client, values.document_category_id)).length)
          throw new (require("../../shared/errors").AppError)("NOT_FOUND", "Category not found", 404);
      },
      run: (values, actor) => {
        const { document_category_id: id, ...changes } = values;
        return service.updateCategory(id, changes, actor);
      },
      readback: categoryLine("saved"),
      labels: { document_category_id: "Category", ...CATEGORY_LABELS },
    },
  ],
  not_offered: {
    CompanyDocumentCreate: "file: Upload Document takes a file, uploaded on Document Centre · Library",
    CompanyDocumentUpdate: "via documents.edit_details: Edit Details' own request, which never names its document; the card is CompanyDocumentChange",
    DocumentCategoryUpdate: "via documents.category_edit: Edit Category's own request, which never names its category; the card is DocumentCategoryChange",
  },
  routes: [
    { intent: "open the document centre, or find a document", screen: "documents.library", prefill: c.library.LibraryListQuery },
    { intent: "upload a company document", screen: "documents.library", params: { action: "new" } },
    { intent: "download the letterhead", screen: "documents.library", params: { action: "letterhead" } },
    { intent: "manage document categories and who sees them", screen: "documents.categories" },
  ],
});
