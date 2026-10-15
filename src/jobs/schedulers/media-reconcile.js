"use strict";
/**
 * Files and document rows compared once a night at 02:30 Lagos time
 * (services/media/reconcile.js): orphan files moved aside after a day, never deleted;
 * dead scratch folders removed; rows whose file is missing reported.
 */
const { defineSchedule } = require("../registry");
const reconcile = require("../../services/media/reconcile");

module.exports = defineSchedule({
  name: "media-reconcile",
  pattern: "30 2 * * *",
  summary: "Finds files without a record and records without a file",
  run: () => reconcile.run(),
});
