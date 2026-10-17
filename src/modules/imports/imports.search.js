"use strict";
/**
 * ⌘K: an import by its number or the file somebody uploaded, for whoever reads
 * the history. A result opens Settings · Imports on that batch.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "import_batch",
  module: "settings",
  label: "Imports",
  words: ["import", "spreadsheet", "upload", "sheet"],
  from: "import_batch b",
  key: "b.import_batch_id",
  columns: ["b.number", "b.file_name", "b.importer_key"],
  select:
    "b.import_batch_id AS id, b.number AS ref, b.file_name AS title, b.status AS sub",
  order: "b.created_at DESC",
});
