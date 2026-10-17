"use strict";
/**
 * A search provider: how one module answers ⌘K. Declared beside the module in
 * `src/modules/<module>/<module>.search.js` (MILESTONES A13, gate 10):
 *
 *   module.exports = recordProvider({
 *     type: "employee",                         // an entity type in shared/route-map
 *     module: "people",                         // whose `view` grant gates it
 *     label: "Employees",                       // the group heading
 *     words: ["employee", "staff"],             // "staff ada" searches employees for "ada"
 *     from: "employee e",
 *     key: "e.employee_id",                     // unique: ends the ORDER BY, so pages are stable
 *     columns: ["e.first_name", "e.last_name", "e.staff_number", "e.work_email"],
 *     select: "e.employee_id AS id, e.staff_number AS ref, e.first_name || ' ' || e.last_name AS title, e.job_title AS sub",
 *     where: "e.status <> 'archived'",
 *     scope: { column: "e.employee_id" },       // team and own scope narrow it, as on the screen
 *     phones: ["e.phone"],                      // found by a number typed any way (below)
 *   });
 *
 * What a provider may not do:
 *  - decide who sees it. The service checks the module's `view` grant before the query
 *    runs, and applies the caller's scope through the provider's scope column with
 *    shared/rbac/scope, the same translation every repo uses. A provider of records
 *    about people declares `scope`; one without is visible to every holder of `view`;
 *  - choose how many rows. A group is a page of 25 through shared/http/paged
 *    (BACKEND_STRUCTURE §16), like every list;
 *  - build a URL. A result opens where shared/route-map says its type opens.
 *
 * How it matches: every column FOLDED (search_fold: lower case, accents off), as a
 * prefix (ranked first), as a substring, and for a term of four letters or more, when
 * pg_trgm is installed, by trigram word similarity, which forgives a one-letter typo
 * ("Adeloa" finds "Adeola"). `%` and `_` typed by a person are letters, not wildcards.
 *
 * Phone numbers are stored in international form (+2348031234567) and typed any way:
 * 0803 123 4567, 08031234567, +234 803 123 4567, or the last four digits. A term made only
 * of digits, spaces and + ( ) - with four digits or more is also compared with each
 * `phones` column digit for digit, a leading local 0 dropped, so all of those find the
 * same person. A whole number typed ranks first.
 */
const catalog = require("../access/access.catalog");
const routeMap = require("../route-map");
const { pageQuery, TOTAL_COL } = require("../http/paged");
const { scopeClause } = require("../rbac/scope");

const escapeLike = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

/** The digits a phone column is compared with, or null when the term is not a number. */
function dialled(term) {
  if (!/^[+\d\s().-]+$/.test(term)) return null;
  const digits = term.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.replace(/^0(?=\d)/, "");
}
const REQUIRED = [
  "type",
  "module",
  "label",
  "from",
  "key",
  "columns",
  "select",
];

/**
 * @param {object} spec  see the header
 * @returns {{type: string, module: string, label: string, words: string[], scoped: boolean,
 *            columns: string[], search: Function}}
 */
function recordProvider(spec) {
  for (const k of REQUIRED)
    if (!spec || !spec[k])
      throw new Error(`search provider ${spec && spec.type}: ${k} is required`);
  if (!catalog.isModule(spec.module))
    throw new Error(
      `search provider ${spec.type}: "${spec.module}" is not a module key`,
    );
  if (!routeMap.hasRoute(spec.type))
    throw new Error(
      `search provider ${spec.type}: add "${spec.type}" to ENTITY_ROUTES in shared/route-map.js so a result can open`,
    );
  if (!Array.isArray(spec.columns) || spec.columns.length === 0)
    throw new Error(
      `search provider ${spec.type}: columns is a non-empty list`,
    );
  if (spec.scope && !spec.scope.column)
    throw new Error(`search provider ${spec.type}: scope is { column }`);
  if (spec.phones !== undefined && (!Array.isArray(spec.phones) || spec.phones.some((col) => !col)))
    throw new Error(`search provider ${spec.type}: phones is a list of columns`);
  const words = (spec.words || [])
    .map((w) => String(w).toLowerCase().trim())
    .filter(Boolean);

  const folded = spec.columns.map((col) => `search_fold(${col}::text)`);
  const phones = (spec.phones || []).map((col) => `regexp_replace(coalesce(${col}::text, ''), '[^0-9]', '', 'g')`);

  /**
   * One page of matches.
   * @param {{query: Function}} c
   * @param {{term: string, page?: number, fuzzy?: boolean, scope: {scope: string, scope_ids: string[]|null}}} q
   */
  async function search(c, { term, page = 1, fuzzy = false, scope }) {
    const useFuzzy = fuzzy && term.length >= 4;
    // $3 (the bare term) only when the typo pass uses it: an unused parameter has no type.
    const params = [
      `%${escapeLike(term)}%`,
      `${escapeLike(term)}%`,
      ...(useFuzzy ? [term] : []),
    ];
    const like = folded.map((f) => `${f} LIKE search_fold($1::text)`);
    if (useFuzzy)
      like.push(...folded.map((f) => `search_fold($3::text) <% ${f}`));
    const rank = folded
      .map(
        (f) =>
          `CASE WHEN ${f} LIKE search_fold($2::text) THEN 3 WHEN ${f} LIKE search_fold($1::text) THEN 2 ELSE 0 END`,
      )
      .concat(
        useFuzzy
          ? folded.map((f) => `word_similarity(search_fold($3::text), ${f})`)
          : [],
      );
    const dial = phones.length ? dialled(term) : null;
    if (dial) {
      params.push(`%${dial}%`, `%${dial}`);
      const n = params.length;
      like.push(...phones.map((p) => `${p} LIKE $${n - 1}::text`));
      rank.push(...phones.map((p) => `CASE WHEN ${p} LIKE $${n}::text THEN 3 WHEN ${p} LIKE $${n - 1}::text THEN 2 ELSE 0 END`));
    }
    const s = spec.scope ? scopeClause(scope, spec.scope, params) : { and: "" };
    const sql = `SELECT ${spec.select}, GREATEST(${rank.join(", ")}) AS search_rank, ${TOTAL_COL}
                   FROM ${spec.from}
                  WHERE (${like.join(" OR ")})${spec.where ? ` AND (${spec.where})` : ""} ${s.and}
                  ORDER BY search_rank DESC${spec.order ? `, ${spec.order}` : ""}, ${spec.key}`;
    const result = await pageQuery(c, sql, params, { page });
    return {
      page: result.page,
      items: result.data.map((r) => {
        const link = routeMap.linkFor(spec.type, r.id);
        return {
          id: String(r.id),
          type: spec.type,
          ref: r.ref || null,
          title: r.title || r.ref || null,
          sub: r.sub || null,
          status: r.status || null,
          link: link ? link.path : null,
        };
      }),
    };
  }

  return Object.freeze({
    type: spec.type,
    module: spec.module,
    label: spec.label,
    words,
    scoped: Boolean(spec.scope),
    columns: spec.columns.slice(),
    search,
  });
}

module.exports = { recordProvider, escapeLike, dialled };
