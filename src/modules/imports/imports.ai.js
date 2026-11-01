"use strict";
/**
 * What the assistant may read about imports: the history, so "did the staff
 * sheet go in?" is answered without opening a screen. It reads, it never runs
 * one (A23); starting or committing an import is a route to the screen where
 * the person does it themselves.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./imports.service");

module.exports = defineManifest({
  module: "settings",
  // Every Create schema of this module's contract, and why the assistant does not offer it (gate 23).
  not_offered: {
    ImportCreate: "an import starts on Settings, Imports with the spreadsheet uploaded and its preview in view",
  },
  reads: [
    {
      key: "imports.history",
      description:
        "List imports, newest first, with what each one created and updated",
      params: c.imports.ImportListQuery,
      permission: ["settings", "view"],
      run: (_client, params) => service.history(params),
      cite: (row) => ({
        type: "import_batch",
        id: row.import_batch_id,
        label: `${row.number} ${row.file_name}`,
      }),
    },
  ],
  routes: [
    { intent: "import a spreadsheet", screen: "settings.imports" },
  ],
});
