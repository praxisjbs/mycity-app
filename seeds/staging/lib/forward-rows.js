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
 * Numbers carry STG ("PAR-STG-01"): the owning modules' counters are theirs to start, and no
 * number they give can collide with one of these. Money is Naira, numeric(18,2) as text.
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

/** Partners and their pipeline (M7): four active, four prospects with an opportunity each. */
const PARTNERS = [
  { key: "mtn-nigeria", name: "MTN Nigeria", type: "corporate", status: "active", owner: "head", added: 240, industry: "Telecoms", site: "mtn.ng" },
  { key: "providusbank", name: "ProvidusBank", type: "corporate", status: "active", owner: "head_team:1", added: 200, industry: "Banking", site: "providusbank.com" },
  { key: "ikeja-city-mall", name: "Ikeja City Mall", type: "corporate", status: "active", owner: "head_team:2", added: 280, industry: "Retail", site: "ikejacitymall.com" },
  { key: "access-bank", name: "Access Bank", type: "corporate", status: "active", owner: "head", added: 150, industry: "Banking", site: "accessbankplc.com" },
  { key: "lagos-state-government", name: "Lagos State Government", type: "government", status: "prospect", owner: "head", added: 60, industry: "Government", site: "lagosstate.gov.ng" },
  { key: "eko-hotels", name: "Eko Hotels", type: "corporate", status: "prospect", owner: "head_team:3", added: 50, industry: "Hospitality", site: "ekohotels.com" },
  { key: "filmhouse-cinemas", name: "Filmhouse Cinemas", type: "corporate", status: "prospect", owner: "head_team:1", added: 40, industry: "Entertainment", site: "filmhouseng.com" },
  { key: "kano-trade-council", name: "Kano Trade Council", type: "government", status: "prospect", owner: "head", added: 35, industry: "Government", site: "kanocc.org.ng" },
];

/** Contact recorded with a partner, days ago. Access Bank has none, so it counts from when it was added. */
const INTERACTIONS = [
  { partner: "mtn-nigeria", type: "meeting", subject: "Venue walkthrough", ago: 2, owner: "head" },
  { partner: "providusbank", type: "call", subject: "Ticket email branding", ago: 1, owner: "head_team:1" },
  { partner: "ikeja-city-mall", type: "email", subject: "Renewal terms", ago: 45, owner: "head_team:2" },
  { partner: "lagos-state-government", type: "meeting", subject: "Contract review", ago: 6, owner: "head" },
];

/** Open opportunities, one a stage, closing in `closes` days. */
const OPPORTUNITIES = [
  { partner: "lagos-state-government", title: "Lagos tourism listings", stage: "negotiation", value: "7500000.00", chance: 60, closes: 30, owner: "head" },
  { partner: "eko-hotels", title: "Eko Hotels weekend features", stage: "proposal", value: "2800000.00", chance: 40, closes: 45, owner: "head_team:3" },
  { partner: "filmhouse-cinemas", title: "Filmhouse ticket bundles", stage: "qualified", value: "3600000.00", chance: 30, closes: 60, owner: "head_team:1" },
  { partner: "kano-trade-council", title: "Kano trade fair listings", stage: "lead", value: "1900000.00", chance: 10, closes: 90, owner: "head" },
];

/** Proposals sent days ago and not yet accepted. */
const PROPOSALS = [
  { opportunity: "lagos-state-government", value: "7500000.00", sent: 6, by: "head" },
  { opportunity: "eko-hotels", value: "2800000.00", sent: 34, by: "head_team:3" },
];

/** Agreements signed this year, starting `started` days ago (never before the 1st of January). */
const AGREEMENTS = [
  { partner: "mtn-nigeria", title: "MTN Nigeria sponsorship", status: "active", value: "18400000.00", started: 200, owner: "head" },
  { partner: "providusbank", title: "ProvidusBank ticketing", status: "signed", value: "9200000.00", started: 26, owner: "head_team:1" },
  { partner: "ikeja-city-mall", title: "Ikeja City Mall listings", status: "active", value: "1350000.00", started: 270, owner: "head_team:2" },
  { partner: "access-bank", title: "Access Bank cardholder offers", status: "active", value: "1100000.00", started: 230, owner: "head" },
];

/** Expense requests waiting for approval (M8), submitted days ago. */
const EXPENSES = [
  { key: "printer-toner", purpose: "Printer toner", category: "office", amount: "52000.00", by: "operations", ago: 1 },
  { key: "lagos-activation-transport", purpose: "Lagos activation transport", category: "travel", amount: "185000.00", by: "head", ago: 0 },
  { key: "social-media-course", purpose: "Social media course", category: "training", amount: "120000.00", by: "head_team:1", ago: 2 },
  { key: "listing-team-data", purpose: "Data bundles, listing team", category: "utilities", amount: "45000.00", by: "manager_team:1", ago: 3 },
  { key: "enugu-launch-transport", purpose: "Enugu city launch, transport", category: "travel", amount: "345000.00", by: "management:1", ago: 1 },
];

/** This quarter's budgets, approved, and their lines: Operations 90% spent, Marketing well under. */
const BUDGETS = [
  {
    key: "operations-quarter",
    name: "Operations",
    owner: "operations",
    lines: [
      { category: "office", amount: "1500000.00", spent: "1380000.00" },
      { category: "utilities", amount: "500000.00", spent: "420000.00" },
    ],
  },
  {
    key: "marketing-quarter",
    name: "Marketing",
    owner: "head",
    lines: [
      { category: "travel", amount: "3000000.00", spent: "1450000.00" },
      { category: "training", amount: "600000.00", spent: "120000.00" },
    ],
  },
];

/* Tasks and the calendar are M2's own staging seed now (40_workspace.js). */

/* Organisational goals and people's targets are Performance's own staging seed now (45_performance_plan.js). */

/* Review rounds and reviews are Performance's own staging seed now (46_performance_reviews.js). */

/**
 * Vacancies (M4) for the organogram's open seats, the first two by title. A vacancy's number
 * and slug follow its place in that list, never the seat's title, so a seat filled between runs
 * moves a title from one vacancy to the next and never a slug.
 */
const OPEN_SEATS = 2;

/* ------------------------------------------------------------------ *
 * The rows, in the order they are written (parents first)
 * ------------------------------------------------------------------ */

const stg = (prefix, n) => `${prefix}-STG-${String(n).padStart(2, "0")}`;

/**
 * Every row this file can write: `{ table, key, needs, parents, values(x, who) }`. `needs`
 * names the people a row hangs off, and one missing leaves it out; `parents` the rows that
 * must have been written first; `values` its columns, from the run's context `x` and the
 * people it needs, or null to leave it out (a row that records who made it needs that
 * person's login, an expense or a budget line its category, a vacancy its open seat).
 */
const ROWS = Object.freeze([
  ...Array.from({ length: OPEN_SEATS }, (_, i) => ({
    table: "vacancy",
    key: `open-seat-${i + 1}`,
    needs: ["operations"],
    values: (x, [ops]) => {
      const seat = x.seats[i];
      if (!seat || !ops.user_id) return null;
      return {
        number: stg("VAC", i + 1),
        department_id: seat.department_id,
        hiring_manager_id: ops.employee_id,
        title: seat.title,
        slug: `stg-open-seat-${i + 1}`,
        description: `${seat.title}, an open seat on the organogram.`,
        positions: 1,
        status: "open",
        opens_at: x.at(x.daysFrom(-20), "09:00"),
        closes_at: x.at(x.daysFrom(20), "17:00"),
        created_by: ops.user_id,
      };
    },
  })),
  ...BUDGETS.flatMap((b, i) => [
    {
      table: "budget",
      key: b.key,
      needs: [b.owner, "ceo"],
      values: (x, [owner, ceo]) => ({
        number: stg("BUD", i + 1),
        name: `${b.name} ${x.quarterName}`,
        department_id: owner.department_id,
        owner_id: owner.employee_id,
        currency: "NGN",
        starts_on: x.quarter.from,
        ends_on: x.quarter.to,
        status: "approved",
        approved_by: ceo.user_id,
        approved_at: x.at(x.quarter.from, "09:00"),
      }),
    },
    ...b.lines.map((line) => ({
      table: "budget_line",
      key: `${b.key}:${line.category}`,
      needs: [],
      parents: [["budget", b.key]],
      values: (x) =>
        x.categories.has(line.category)
          ? {
              budget_id: idOf("budget", b.key),
              expense_category_id: x.categories.get(line.category),
              amount: line.amount,
              spent_amount: line.spent,
            }
          : null,
    })),
  ]),
  ...EXPENSES.map((e, i) => ({
    table: "expense_request",
    key: e.key,
    needs: [e.by],
    values: (x, [person]) =>
      x.categories.has(e.category)
        ? {
            number: stg("EXR", i + 1),
            employee_id: person.employee_id,
            department_id: person.department_id,
            expense_category_id: x.categories.get(e.category),
            purpose: e.purpose,
            amount: e.amount,
            currency: "NGN",
            status: "submitted",
            needed_on: x.daysFrom(7 + i),
            submitted_at: x.at(x.daysFrom(-e.ago), "10:00"),
          }
        : null,
  })),
  ...PARTNERS.map((p, i) => ({
    table: "partner",
    key: p.key,
    needs: [p.owner],
    values: (x, [owner]) => ({
      number: stg("PAR", i + 1),
      name: p.name,
      partner_type: p.type,
      status: p.status,
      industry: p.industry,
      country_code: "NG",
      website: p.site,
      owner_id: owner.employee_id,
      created_at: x.at(x.daysFrom(-p.added), "10:00"),
    }),
  })),
  ...OPPORTUNITIES.map((o, i) => ({
    table: "partnership_opportunity",
    key: o.partner,
    needs: [o.owner],
    parents: [["partner", o.partner]],
    values: (x, [owner]) => ({
      number: stg("POP", i + 1),
      partner_id: idOf("partner", o.partner),
      title: o.title,
      stage: o.stage,
      status: "open",
      owner_id: owner.employee_id,
      estimated_value: o.value,
      currency: "NGN",
      probability: o.chance,
      expected_close_on: x.daysFrom(o.closes),
    }),
  })),
  ...PROPOSALS.map((p, i) => ({
    table: "partnership_proposal",
    key: p.opportunity,
    needs: [p.by],
    parents: [["partnership_opportunity", p.opportunity]],
    values: (x, [by]) =>
      by.user_id
        ? {
            partnership_opportunity_id: idOf("partnership_opportunity", p.opportunity),
            number: stg("PRO", i + 1),
            version: 1,
            status: "sent",
            value: p.value,
            currency: "NGN",
            sent_at: x.at(x.daysFrom(-p.sent), "11:00"),
            created_by: by.user_id,
          }
        : null,
  })),
  ...AGREEMENTS.map((a, i) => ({
    table: "partnership_agreement",
    key: a.partner,
    needs: [a.owner],
    parents: [["partner", a.partner]],
    values: (x, [owner]) => {
      const starts = x.inYear(x.daysFrom(-a.started));
      return {
        partner_id: idOf("partner", a.partner),
        number: stg("AGR", i + 1),
        title: a.title,
        status: a.status,
        starts_on: starts,
        ends_on: lagos.addDays(lagos.addMonths(starts, 12), -1),
        value: a.value,
        currency: "NGN",
        owner_id: owner.employee_id,
      };
    },
  })),
  ...INTERACTIONS.map((t) => ({
    table: "partner_interaction",
    key: t.partner,
    needs: [t.owner],
    parents: [["partner", t.partner]],
    values: (x, [owner]) => ({
      partner_id: idOf("partner", t.partner),
      interaction_type: t.type,
      subject: t.subject,
      occurred_at: x.at(x.daysFrom(-t.ago), "11:00"),
      owner_id: owner.employee_id,
    }),
  })),
]);

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
 * expense categories by code and the organogram's open seats. Pure, so a test builds one.
 * @param {{now: Date, cal: import("../../../src/shared/time/working-week").Calendar,
 *          categories: Array<{code: string, expense_category_id: string}>,
 *          seats: Array<{title: string, department_id: string|null}>}} input
 */
function contextFrom({ now, cal, categories, seats }) {
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
    seats,
  };
}

/** contextFrom() with the working week, the categories and the open seats read from the database. */
async function contextOf(db, now) {
  const { rows: categories } = await db.query(
    "SELECT code::text AS code, expense_category_id FROM expense_category WHERE active",
  );
  const { rows: seats } = await db.query(
    "SELECT title, department_id FROM org_seat WHERE status = 'vacant' ORDER BY title, org_seat_id",
  );
  return contextFrom({ now, cal: await workingWeek.loadCalendar(db), categories, seats });
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
