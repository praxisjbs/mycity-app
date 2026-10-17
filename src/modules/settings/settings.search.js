"use strict";
/**
 * ⌘K for people who can open Settings: numbering schemes by document, prefix or
 * code (opening Documents & Numbering on that scheme), and public holidays by name
 * or ISO date (opening Organisation).
 */
const { recordProvider } = require("../../shared/search/provider");
const { DOC_LABELS } = require("./settings.service");

/** The document's name as the screen shows it, from the code's labels; codes are fixed words. */
const label = `CASE s.doc_type ${Object.entries(DOC_LABELS)
  .map(([type, name]) => `WHEN '${type}' THEN '${name}'`)
  .join(" ")} ELSE s.doc_type END`;

module.exports = [
  recordProvider({
    type: "numbering_scheme",
    module: "settings",
    label: "Numbering",
    words: ["numbering", "number", "prefix", "reference"],
    from: "numbering_scheme s",
    key: "s.doc_type",
    columns: [label, "s.prefix", "s.doc_type"],
    select: `s.doc_type AS id, NULLIF(s.prefix, '') AS ref, ${label} AS title`,
  }),
  recordProvider({
    type: "public_holiday",
    module: "settings",
    label: "Holidays",
    words: ["holiday", "public holiday"],
    from: "public_holiday h",
    key: "h.public_holiday_id",
    columns: ["h.name", "h.holiday_date"],
    select: "h.public_holiday_id AS id, h.name AS title",
  }),
];
