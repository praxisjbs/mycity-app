/**
 * WorkbookContext: everything a branded spreadsheet needs to know besides its
 * rows. The builder stays pure (no client, no query), which is what lets unit
 * tests build a workbook without a database.
 *
 * One company, one currency, one timezone, one language, so most of it is
 * fixed: MyCity's brand colours, naira, Lagos time, English. What varies per
 * export is who made it, what it is called, the filters it was made with and,
 * for a cover sheet, the company's letterhead lines (pass the organisation
 * profile from shared/documents/generate.orgProfile when the caller has a
 * client; without it the cover carries the company name alone).
 *
 *   const ctx = workbookContext({ actor: req.user, title: "Employees", filters: req.query });
 *   const buffer = await buildWorkbook({ sheets, context: ctx, cover: true });
 */
"use strict";

const { config } = require("../../config/env");
const { TIMEZONE } = require("./cells");

/** House colours: City Green header, white text, MyCity yellow accent. */
const BRAND = Object.freeze({
  name: "MyCity App Ltd",
  primary: "#014339",
  primaryForeground: "#FFFFFF",
  accent: "#FFDF55",
});

/**
 * @param {object} [opts]
 * @param {{full_name?: string, name?: string}} [opts.actor]  req.user, or a job's actor
 * @param {string} [opts.title]
 * @param {object} [opts.filters]   shown on the cover as "key = value"
 * @param {Array<[string, string]>} [opts.lines]  more cover lines, label then value, after the
 *        filters: what each sheet holds, a line the reader must see (Download My Data)
 * @param {Date|string} [opts.generatedAt]
 * @param {{name?: string, address?: string, phone?: string, email?: string, website?: string}} [opts.org]
 */
function workbookContext({
  actor = null,
  title = null,
  filters = null,
  lines = [],
  generatedAt = new Date(),
  org = null,
} = {}) {
  const actorName = actor ? actor.full_name || actor.name || null : null;
  return {
    brand: { ...BRAND, name: (org && org.name) || BRAND.name },
    org: org || {},
    timezone: TIMEZONE,
    env: config.APP_ENV === "staging" ? "staging" : "live",
    actor: actorName ? { name: actorName } : null,
    title,
    filters,
    lines: Array.isArray(lines) ? lines : [],
    generatedAt,
  };
}

module.exports = { workbookContext, BRAND };
