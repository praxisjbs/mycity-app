"use strict";
/**
 * The rows Home's staging seed writes into the tables of later milestones (decision O11,
 * docs/guides/home.md §11), so every card, chart and list on Home has figures on staging
 * before the modules that own those tables are built.
 *
 * Each row is written by SQL, since its module has no service yet, with an id made from its
 * table and key (lib/uuid5.js), so a second run updates the row it wrote first and adds
 * nothing. Every id this file can write is written out in HOME_STAGING_ROWS
 * (lib/home-staging-rows.js), which says how the milestone that builds a table takes these
 * rows away (docs/DATABASE_SCHEMA.md, each milestone's "Read by Home").
 *
 * The records are drawn from the in-browser mock's, as staging's are (docs/guides/foundation.md
 * §6.2, F13); the people are the real staff, found by post (lib/staff.js). A row whose person,
 * seat, category or parent is missing is left out. Dates are counted from the day the seed runs,
 * so a later run moves them with it and staging keeps showing this week and this quarter.
 *
 * The organisation moves between runs: someone changes manager or leaves, a seat is filled.
 * So each run leaves the forward tables holding exactly the rows it writes. A listed row it
 * does not write is deleted with the alerts about it, and a row whose unique key now gives it
 * a value another listed row holds takes it from that row, which is written again after it.
 *
 * Numbers carried STG ("PAR-STG-01"), so no number an owning module gives could collide with one.
 *
 * Every table it wrote is now its owner's (M2, M4, M7, M8 and Performance each seed their own), so
 * ROWS is empty: a run writes nothing here and deletes every listed row still standing, with the
 * alerts about it. The machinery stays for a later milestone's table that Home reads first.
 */
const lagos = require("../../../src/shared/time/lagos");
const workingWeek = require("../../../src/shared/time/working-week");
const { quarterOf } = require("../../../src/modules/dashboard/dashboard.layout");
const { uuid5 } = require("./uuid5");
const { DELETE_ORDER, HOME_STAGING_ROWS, removeRows } = require("./home-staging-rows");

/** Keeps the Home seed's names apart from any other seed's. */
const NAMESPACE = "24a304eb-62c3-4284-acf1-1d55a1dc11b2";

/** The id of a row: its table and its key in the namespace. */
const idOf = (table, key) => uuid5(`${table}:${key}`, NAMESPACE);

/**
 * People a row hangs off, by post (lib/staff.js). `head_team:2` is the second person who
 * reports to the Head of Department; `management:1` the first post given Management.
 */
function personOf(staff, slot) {
  const [post, nth] = slot.split(":");
  const at = (list) => list[Number(nth) - 1] || null;
  switch (post) {
    case "ceo":
      return staff.ceo;
    case "operations":
      return staff.operations;
    case "head":
      return staff.head;
    case "manager":
      return staff.manager;
    case "management":
      return at(staff.management);
    case "head_team":
      return at(staff.reportsOf(staff.head));
    case "manager_team":
      return at(staff.reportsOf(staff.manager));
    default:
      throw new Error(`forward-rows: no post "${slot}"`);
  }
}

/* ------------------------------------------------------------------ *
 * The records
 * ------------------------------------------------------------------ */

/* Partners and their pipeline are M7's own staging seed now (70_partnerships.js). */

/* Expense requests and budgets are M8's own staging seed now (80_expenses.js). */

/* Tasks and the calendar are M2's own staging seed now (40_workspace.js). */

/* Organisational goals and people's targets are Performance's own staging seed now (45_performance_plan.js). */

/* Review rounds and reviews are Performance's own staging seed now (46_performance_reviews.js). */

/* Vacancies are Recruitment's own staging seed now (55_recruitment.js). */

/* ------------------------------------------------------------------ *
 * The rows, in the order they are written (parents first)
 * ------------------------------------------------------------------ */

/**
 * Every row this file can write: `{ table, key, needs, parents, values(x, who) }`. `needs`
 * names the people a row hangs off, and one missing leaves it out; `parents` the rows that
 * must have been written first; `values` its columns, from the run's context `x` and the
 * people it needs, or null to leave it out (a row that records who made it needs that
 * person's login, an expense or a budget line its category).
 */
const ROWS = Object.freeze([]);

/** The ids HOME_STAGING_ROWS lists, by table. A row it does not list is never written. */
const LISTED = new Map(HOME_STAGING_ROWS.map((e) => [e.table, e.ids]));
for (const row of ROWS)
  if (!(LISTED.get(row.table) || []).includes(idOf(row.table, row.key)))
    throw new Error(`forward-rows: ${row.table} "${row.key}" is not in HOME_STAGING_ROWS (lib/home-staging-rows.js)`);

/* ------------------------------------------------------------------ *
 * Writing them
 * ------------------------------------------------------------------ */

/**
 * What the rows are counted from: the run's day in Lagos, this week, quarter and year, the
 * and the expense categories by code. Pure, so a test builds one.
 * @param {{now: Date, cal: import("../../../src/shared/time/working-week").Calendar,
 *          categories: Array<{code: string, expense_category_id: string}>}} input
 */
function contextFrom({ now, cal, categories }) {
  const today = lagos.today(now);
  const { year, month } = lagos.yearMonth(today);
  const quarter = quarterOf(today);
  const monday = lagos.addDays(today, 1 - lagos.weekday(today));
  const weekDay = (n) => lagos.addDays(monday, n - 1);
  let lastWorking = today;
  for (let n = 1; n <= 7; n += 1)
    if (weekDay(n) > lastWorking && workingWeek.isWorkingDay(weekDay(n), cal)) lastWorking = weekDay(n);
  const due = lagos.instant(lastWorking, "15:00");
  return {
    today,
    year,
    quarter,
    quarterName: `Q${Math.ceil(month / 3)} ${year}`,
    daysFrom: (n) => lagos.addDays(today, n),
    at: (date, time) => lagos.instant(date, time),
    weekDay,
    dueThisWeek: due > now ? due : lagos.instant(today, "23:30"),
    inYear: (date) => (date < `${year}-01-01` ? `${year}-01-01` : date),
    inQuarter: (date) => (date > quarter.to ? quarter.to : date),
    categories: new Map(categories.map((c) => [c.code, c.expense_category_id])),
  };
}

/** contextFrom() with the working week and the categories read from the database. */
async function contextOf(db, now) {
  const { rows: categories } = await db.query(
    "SELECT code::text AS code, expense_category_id FROM expense_category WHERE active",
  );
  return contextFrom({ now, cal: await workingWeek.loadCalendar(db), categories });
}

/** Insert a row by its id, or bring the one already there to these values. */
async function upsert(db, table, id, values) {
  const columns = Object.keys(values);
  const all = [`${table}_id`, ...columns];
  await db.query(
    `INSERT INTO ${table} (${all.join(", ")}) VALUES (${all.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (${table}_id) DO UPDATE SET ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}
      WHERE (${columns.map((c) => `${table}.${c}`).join(", ")}) IS DISTINCT FROM (${columns
        .map((c) => `EXCLUDED.${c}`)
        .join(", ")})`,
    [id, ...columns.map((c) => values[c])],
  );
}

/**
 * Each table's unique keys other than its id, as column lists, read from the database so a key
 * a later migration adds is honoured too. A partial or expression index is not one: no row of
 * this file can fall under it.
 * @returns {Promise<Map<string, string[][]>>}
 */
async function uniqueKeysOf(db, tables) {
  const { rows } = await db.query(
    `SELECT c.relname::text AS table_name, array_agg(a.attname::text ORDER BY k.n) AS columns
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indrelid = ANY (SELECT to_regclass(t) FROM unnest($1::text[]) AS t)
        AND i.indisunique AND NOT i.indisprimary AND i.indpred IS NULL AND i.indexprs IS NULL
      GROUP BY c.relname, i.indexrelid`,
    [tables],
  );
  const keys = new Map(tables.map((t) => [t, []]));
  for (const r of rows) keys.get(r.table_name).push(r.columns);
  return keys;
}

/**
 * The rows this run writes, parents first: each whose people, parents and values are there,
 * unless a row before it already takes a value one of the table's unique keys needs.
 * @returns {Map<string, {row: object, values: object}>} by id
 */
function planOf(rows, x, staff, keys) {
  const plan = new Map();
  const taken = new Set();
  for (const row of rows) {
    const id = idOf(row.table, row.key);
    const who = row.needs.map((slot) => personOf(staff, slot));
    const parentsThere = (row.parents || []).every(([table, key]) => plan.has(idOf(table, key)));
    const values = who.every(Boolean) && parentsThere ? row.values(x, who) : null;
    if (!values) continue;
    const held = keys
      .get(row.table)
      .filter((columns) => columns.every((c) => c in values))
      .map((columns) => `${row.table}(${columns}) ${JSON.stringify(columns.map((c) => values[c]))}`);
    if (held.some((k) => taken.has(k))) continue;
    for (const k of held) taken.add(k);
    plan.set(id, { row, values });
  }
  return plan;
}

/** Take from this file's other rows in the table any value a unique key gives this one. */
async function makeRoom(db, table, id, values, keys) {
  for (const columns of keys.filter((cs) => cs.every((c) => c in values))) {
    await db.query(
      `DELETE FROM ${table} WHERE ${table}_id <> $1 AND ${table}_id = ANY($2::uuid[])
          AND (${columns.join(", ")}) = (${columns.map((_, i) => `$${i + 3}`).join(", ")})`,
      [id, LISTED.get(table), ...columns.map((c) => values[c])],
    );
  }
}

/**
 * Write every row whose people, seat, category and parents are there, after deleting the listed
 * rows this run does not write and the alerts about them.
 * @param {{db: {query: Function}, staff: object, now: Date, log?: Function, rows?: ReadonlyArray<object>}} opts
 *   db     a client inside atomically(): the rows land together or not at all
 *   staff  lib/staff.js realStaff()
 *   rows   the rows to write: ROWS, unless a test takes some out as their owner will
 * @returns {Promise<{written: number, left_out: number, removed: number}>}
 */
async function writeForwardRows({ db, staff, now, log = () => {}, rows = ROWS }) {
  const x = await contextOf(db, now);
  const keys = await uniqueKeysOf(db, DELETE_ORDER);
  const plan = planOf(rows, x, staff, keys);
  const gone = await removeRows(
    db,
    HOME_STAGING_ROWS.map(({ table, ids }) => ({ table, ids: ids.filter((id) => !plan.has(id)) })),
  );
  for (const [id, { row, values }] of plan) {
    await makeRoom(db, row.table, id, values, keys.get(row.table));
    await upsert(db, row.table, id, values);
  }
  const leftOut = rows.length - plan.size;
  log(
    `forward tables: ${plan.size} rows in place, ${leftOut} left out for want of a person, a seat, a category ` +
      `or a value of their own; ${gone.rows} no longer written deleted, with ${gone.alerts} alerts about them`,
  );
  return { written: plan.size, left_out: leftOut, removed: gone.rows };
}

module.exports = { NAMESPACE, ROWS, DELETE_ORDER, HOME_STAGING_ROWS, idOf, personOf, contextFrom, planOf, writeForwardRows };
