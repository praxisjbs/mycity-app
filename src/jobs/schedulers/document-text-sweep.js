"use strict";
/**
 * Every night at 02:20 Lagos (docs/guides/document-centre.md §6.7): the library's documents with no
 * text yet, and those whose read failed a day ago, queued for `document-text` a batch at a time.
 * Safe to run twice.
 */
const { defineSchedule } = require("../registry");

module.exports = defineSchedule({
  name: "document-text-sweep",
  pattern: "20 2 * * *",
  summary: "Library documents with no text, or a failed read, queued to be read",
  run: () => require("../../modules/library/library.text").sweep(),
});
