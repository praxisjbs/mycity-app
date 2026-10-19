"use strict";
/**
 * Organisation events (loaded by the API and the worker). An employee record holds
 * personal data, so its audit rows are marked sensitive: the Audit Log masks them
 * for people without the field grant.
 *
 * One follow-on runs here: a change to who reports to whom moves the boundary of
 * "my team", and team scope is cached (shared/rbac/grants-cache.js). The cache's
 * version is bumped after the change commits, so the next request reads the new
 * tree rather than yesterday's (docs/guides/foundation.md §7). A vacant seat's line
 * or status moves it too: the people under an empty seat are in the team of the first
 * person above it (docs/guides/organogram.md §6).
 *
 * Download PDF (organogram.md §5 to §7) runs through three more, each safe to run
 * twice (org-chart.export.js):
 *
 *   org_chart.export_requested   organisation.org_chart_pdf     read the tree as the person
 *                                                               asking, lay it out, queue it for
 *                                                               the pdf-render job
 *   document.generated           organisation.org_chart_email   an org_chart PDF exists: email it
 *   document.render_failed       organisation.org_chart_failed  it could not be drawn: tell them
 *
 * The document type `org_chart` is declared once, here. A request's PDF is opened by the
 * person who asked and the CEO, and nobody else (the vault rule for `org_chart_export`).
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const grantsCache = require("../../shared/rbac/grants-cache");
const { defineDocType } = require("../../shared/documents/generate");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const { defineVariables } = require("../../shared/templates/variables");
const { defineNotification } = require("../../shared/notifications/fanout");

const EVENTS = defineEvents("people", {
  "department.created": { summary: "A department was created" },
  "department.updated": { summary: "A department was changed" },
  "employee.created": { summary: "An employee record was created", sensitive: true },
  "employee.updated": { summary: "An employee record was changed", sensitive: true },
  "employee.archived": { summary: "An employee record was archived" },
  "employee.restored": { summary: "An archived employee record was restored" },
  "employee.reporting_line_changed": { summary: "An employee's reporting line changed" },
  "employee.photo_updated": { summary: "An employee's photo was set or removed" },
  "org_seat.created": { summary: "A vacant seat was added to the structure" },
  "org_seat.updated": { summary: "A vacant seat was changed" },
  "org_chart.export_requested": { summary: "An organogram PDF was requested" },
  "org_chart.export_failed": { summary: "An organogram PDF could not be drawn" },
});

/** The document type of Download PDF's file. */
const CHART_DOC_TYPE = "org_chart";

/** The record a Download PDF file belongs to: the request. */
const CHART_EXPORT = "org_chart_export";

defineDocType(CHART_DOC_TYPE, {
  label: "Organogram",
  module: "ess",
  template: "org-chart",
  numbering: null,
  sensitivity: "normal",
  landscape: true,
  title: () => "Organogram",
});
defineVariables("document", "org-chart", c.organisation.OrgChartDocumentVars);
defineVariables("email", "org-chart-export", c.organisation.OrgChartExportEmailVars);

/**
 * An employee's photo (organisation.photo.js): uploaded on ESS · My Profile, shown wherever the
 * person appears, so every signed-in member of staff may read it; the rule decides alone.
 */
const PHOTO_DOC_TYPE = "employee_photo";
const PHOTO_ENTITY = "employee_photo";
defineDocumentType(PHOTO_DOC_TYPE, { label: "Profile photo", module: "people", sensitivity: "normal" });
vault.defineAccess(PHOTO_ENTITY, async (client, user) => user.is_ceo === true || Boolean(user.employee_id));

/** A request's PDF is for the person who asked, and the CEO; the rule decides alone. */
vault.defineAccess(CHART_EXPORT, async (client, user, doc) =>
  user.is_ceo === true || (Boolean(doc.uploaded_by) && doc.uploaded_by === user.user_id),
);

defineNotification(EVENTS.ORG_CHART_EXPORT_FAILED, {
  to: [{ users: (event) => [event.payload.requested_by] }],
  title: "Your organogram PDF failed",
  body: "It could not be drawn. Press Download PDF again.",
  who: "Who asked for it",
});

const bumpTeams = async () => grantsCache.bumpTeamVersion();

outbox.register(EVENTS.EMPLOYEE_REPORTING_LINE_CHANGED, "organisation.refresh_team_scope", bumpTeams);
outbox.register(EVENTS.EMPLOYEE_CREATED, "organisation.refresh_team_scope", bumpTeams);
outbox.register(EVENTS.EMPLOYEE_ARCHIVED, "organisation.refresh_team_scope", bumpTeams);
outbox.register(EVENTS.EMPLOYEE_RESTORED, "organisation.refresh_team_scope", bumpTeams);
outbox.register(EVENTS.ORG_SEAT_UPDATED, "organisation.refresh_team_scope", bumpTeams);

/** A document event about Download PDF's file; every other document is someone else's. */
const isChart = (event) => Boolean(event.payload) && event.payload.doc_type === CHART_DOC_TYPE;

// The work is required when a handler runs: it needs the service, which requires this file.
outbox.register(EVENTS.ORG_CHART_EXPORT_REQUESTED, "organisation.org_chart_pdf", (event) =>
  require("./org-chart.export").build(event),
);
outbox.register(vault.EVENTS.DOCUMENT_GENERATED, "organisation.org_chart_email", (event) =>
  isChart(event) ? require("./org-chart.export").deliver(event.payload.document_id) : undefined,
);
outbox.register(vault.EVENTS.DOCUMENT_RENDER_FAILED, "organisation.org_chart_failed", (event) =>
  isChart(event) ? require("./org-chart.export").failed(event.payload.document_id) : undefined,
);

module.exports = { EVENTS, CHART_DOC_TYPE, CHART_EXPORT, PHOTO_DOC_TYPE, PHOTO_ENTITY };
