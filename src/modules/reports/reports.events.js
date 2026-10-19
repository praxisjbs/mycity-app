"use strict";
/**
 * What Home's reports record, the file each run produces and who may open it
 * (docs/guides/home.md §3 steps 7 and 8, §6 Reports, §7). Loaded by the API and the worker.
 *
 *   home.report_created        a report was built (and a person's own Overview report, the
 *                              first time they export their Overview)
 *   home.report_updated        a report, its sharing or its schedule changed; paused or resumed
 *   home.report_archived       a report was archived and its schedule stopped
 *   home.report_run            a run was made, for a slot of a schedule, by Run Now or by an
 *                              Overview Export: its file is to be built
 *   home.report_run_finished   a run was settled: its file done, failed, or skipped because its
 *                              recipient may no longer have it
 *
 * All are audit lines; nobody is notified. A schedule's file is emailed to its recipient; a
 * file somebody pressed for is downloaded on the device that pressed.
 *
 * Outbox handlers, each safe to run twice (reports.generate.js):
 *
 *   home.report_run            reports.generate     build the file as its recipient: an XLSX
 *                                                   is kept in the vault and delivered here; a
 *                                                   PDF is queued for the pdf-render job
 *   document.generated         reports.file-ready   a report's PDF exists: deliver it (a
 *                                                   schedule's by email), the run done
 *   document.render_failed     reports.file-failed  a report's PDF could not be made: the run failed
 *
 * The document type `home_report` is declared once, here: the PDF template and its
 * landscape page, and the type an XLSX is stored under too. A run's file is read only by its
 * recipient, its report's owner and the CEO (the vault rule for `home_report_run`), whoever
 * else holds a grant on Home.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineDocType } = require("../../shared/documents/generate");
const vault = require("../../shared/documents/vault");
const { defineVariables } = require("../../shared/templates/variables");
const repo = require("./reports.repo");

const EVENTS = defineEvents("home", {
  "home.report_created": { summary: "A report was created" },
  "home.report_updated": { summary: "A report was changed" },
  "home.report_archived": { summary: "A report was archived" },
  "home.report_run": { summary: "A report run was queued" },
  "home.report_run_finished": { summary: "A report run finished" },
});

/** The document type of every report file, PDF or XLSX. */
const DOC_TYPE = "home_report";

/** The record a report file belongs to: its run. */
const ENTITY = "home_report_run";

defineDocType(DOC_TYPE, {
  label: "Report",
  module: "home",
  template: "report",
  // The run is numbered (RPT-0001); the document takes no second number.
  numbering: null,
  sensitivity: "personal",
  landscape: true,
  title: (data) => data.report_name,
});
defineVariables("document", "report", c.reports.HomeReportDocumentVars);
defineVariables("email", "scheduled-report", c.reports.HomeReportEmailVars);

/**
 * A report file is opened by its recipient, its report's owner and the CEO, and nobody else
 * (home.md §6): the rule decides alone, before any grant the vault would otherwise read.
 */
vault.defineAccess(ENTITY, async (client, user, doc) => {
  if (user.is_ceo === true) return true;
  const readers = await repo.runReaders(client, doc.entity_id);
  return Boolean(readers) && (readers.recipient_user_id === user.user_id || readers.owner_user_id === user.user_id);
});

/** A document event about a report file; every other document is someone else's. */
const isReport = (event) => Boolean(event.payload) && event.payload.doc_type === DOC_TYPE;

// The work is required when a handler runs, not when this file loads: the service requires
// this file for its event keys, and generating requires the service's sources.
outbox.register(EVENTS.HOME_REPORT_RUN, "reports.generate", (event, ctx) =>
  require("./reports.generate").generate(event.entity.id, ctx),
);
outbox.register(vault.EVENTS.DOCUMENT_GENERATED, "reports.file-ready", (event, ctx) =>
  isReport(event) ? require("./reports.generate").fileReady(event.payload.document_id, ctx) : undefined,
);
outbox.register(vault.EVENTS.DOCUMENT_RENDER_FAILED, "reports.file-failed", (event) =>
  isReport(event) ? require("./reports.generate").fileFailed(event.payload.document_id) : undefined,
);

module.exports = { EVENTS, DOC_TYPE, ENTITY };
