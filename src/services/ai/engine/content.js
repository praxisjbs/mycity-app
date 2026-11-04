"use strict";
/**
 * What of a read goes back to the model (docs/guides/praxis-ai.md §6.3 step 6, §6.13): the
 * page, the total, and the rows that fit, cut on a row's boundary with a note; a summary's
 * figures whole. The rows pass through the redaction the adapter supplies first, so the engine
 * never decides what a person may see.
 */

/** How much of one read's page goes back to the model, cut on a row's boundary. */
const RESULT_MAX_CHARS = 12_000;

/**
 * A read's page as the model receives it.
 * @param {number} n          which read of the question (1 first)
 * @param {{key: string, rows: object[], total: number|null, page: {number: number, has_next: boolean}|null}} made
 * @param {(rows: object[]) => object[]} redact   the adapter's redaction of the rows
 * @param {number} [max]
 */
function readContent(n, made, redact, max = RESULT_MAX_CHARS) {
  const head = {
    read: n,
    key: made.key,
    total: made.total,
    page: made.page ? made.page.number : null,
    has_next: Boolean(made.page && made.page.has_next),
  };
  const rows = [];
  let size = JSON.stringify({ ...head, rows: [] }).length;
  let cut = false;
  for (const row of redact(made.rows)) {
    const s = JSON.stringify(row).length + 1;
    if (size + s > max) {
      cut = true;
      break;
    }
    rows.push(row);
    size += s;
  }
  return JSON.stringify(cut ? { ...head, rows, note: `only the first ${rows.length} rows fit` } : { ...head, rows });
}

/**
 * A summary's result as the model receives it: its figures, groups and series, never rows.
 * @param {number} n
 * @param {{key: string, result: {figures: object[], groups: object[], series: object[], total: number|null}}} made
 */
function summaryContent(n, made) {
  const r = made.result;
  return JSON.stringify({ read: n, key: made.key, kind: "summary", total: r.total, figures: r.figures, groups: r.groups, series: r.series });
}

module.exports = { readContent, summaryContent, RESULT_MAX_CHARS };
