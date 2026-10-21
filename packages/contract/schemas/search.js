"use strict";
/**
 * ⌘K search (docs/guides/foundation.md §6.7): one line over the screens, the actions
 * and the records the reader may open, grouped by kind, each group a page of 25.
 *
 *   screens   every tab of the staff app, by its name or a synonym
 *   actions   things to do in one step: Add Employee, Clock In, Request Leave, each
 *             screen's New action
 *   records   every module's `<module>.search.js` (employees, logins, departments, ...)
 *
 * Who sees what is decided on the server: a screen or an action needs the grant its
 * screen needs, and a record group runs only for a reader who may view that module,
 * within their scope. With nothing typed, the screens and actions come back.
 */
const { z } = require("zod");
const { listQuery, PageMeta, PAGE_SIZE } = require("./common");

const SearchKind = z.enum(["screen", "action", "record"]);

/**
 * What the app does itself when an action is chosen, instead of opening `link`:
 *   clock        opens Clock In or Out
 *   read_all     marks every notification read
 *   theme_dark   the dark theme;  theme_light  the light theme
 *   density      Compact or Comfortable, whichever is not on
 *   install      installs the app (offered only where the browser can)
 *   refresh      every read on the screen asks again, in place (FRONTEND_FOUNDATION F28)
 *   reload       the whole app starts again on the same screen (F28)
 *   sign_out     signs out
 */
const SearchRun = z.enum([
  "clock",
  "read_all",
  "notify_settings",
  "notify_on",
  "notify_test",
  "theme_dark",
  "theme_light",
  "density",
  "install",
  "refresh",
  "reload",
  "sign_out",
]);

/** GET /search: `type` keeps one group, to page through it. */
const SearchQuery = listQuery({
  type: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(40)
    .optional(),
});

/** One result. `link` is the screen it opens, null for an action the app runs itself. */
const SearchHit = z
  .object({
    id: z.string(),
    kind: SearchKind,
    type: z.string(),
    title: z.string(),
    sub: z.string().nullable(),
    ref: z.string().nullable(),
    status: z.string().nullable(),
    link: z.string().nullable(),
    run: SearchRun.nullable(),
  })
  .strict();

/** One group: Screens, Actions, or one kind of record, with its own page of 25. */
const SearchGroup = z
  .object({
    kind: SearchKind,
    type: z.string(),
    label: z.string(),
    module: z.string().nullable(),
    page: PageMeta,
    items: z.array(SearchHit).max(PAGE_SIZE),
  })
  .strict();

/** The answer: the term searched (a type word taken off), the type it named, the groups. */
const SearchResult = z
  .object({
    q: z.string(),
    hint: z.string().nullable(),
    groups: z.array(SearchGroup),
  })
  .strict();

/** Gate 6 (check/contract-columns.js): search reads across tables; none of these is a row. */
const TABLES = {
  SearchQuery: { table: null, reason: "the search line, the page and the group to page through" },
  SearchHit: { table: null, reason: "a screen, an action or a record of any module, as one result" },
  SearchGroup: { table: null, reason: "a page of results of one kind" },
  SearchResult: { table: null, reason: "every group the reader may see" },
};

module.exports = { TABLES, SearchKind, SearchRun, SearchQuery, SearchHit, SearchGroup, SearchResult };
