"use strict";
/**
 * Home's source adapters (src/modules/dashboard/sources/*.source.js, docs/guides/home.md
 * §4.1) held to the schema the migrations build, read as gate 6 reads it
 * (scripts/check/lib/catalogue.js), with no database:
 *
 *  - each says which module, milestone and owner its tables belong to, what that milestone
 *    still owes, and, in its header, that the milestone's builder updates it in the same PR;
 *  - every table and column it declares exists, in a table of the milestone it names;
 *  - every query it runs names only the columns it declares, so `tables` is the whole of
 *    what a later milestone must keep true (each function is run against a client that
 *    records its SQL, and the SQL is checked by the schema gate's own rules against a
 *    schema in which a declared table has only its declared columns);
 *  - a sum of money counts Naira only;
 *  - payroll, with no table yet, declares and runs nothing.
 */
const fs = require("node:fs");
const path = require("node:path");
const { buildCatalogue } = require("../../scripts/check/lib/catalogue");
const { checkStatement } = require("../../scripts/check/schema-drift");
const { ADAPTERS } = require("../../src/modules/dashboard/kpi-catalog/shared");

const DIR = path.join(__dirname, "../../src/modules/dashboard/sources");
const schema = buildCatalogue();
const adapters = Object.fromEntries(ADAPTERS.map((name) => [name, require(path.join(DIR, `${name}.source.js`))]));

const OWNERS = new Set(["GE", "TB", "LA", "AJ"]);
const ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const TEAM = { scope: "team", scope_ids: [ID], employee_id: ID };
const NOW = new Date("2026-10-14T11:00:00Z");
const TODAY = "2026-10-14";
const QUERY = { page: 1, q: "ada" };

/** Every query function each adapter exports, and the arguments it is run with here. */
const CALLS = {
  tasks: {
    overdueCount: [{ now: NOW }, TEAM],
    overduePage: [{ now: NOW }, TEAM, QUERY],
    dueBetween: [{ employee_id: ID, from: NOW, to: NOW }, QUERY],
  },
  calendar: { eventsBetween: [{ employee_id: ID, from: NOW, to: NOW }, QUERY] },
  goals: {
    organisationGoals: [{ from: "2026-10-01", to: "2026-12-31" }, QUERY],
    targetsOf: [{ employee_id: ID, from: "2026-10-01", to: "2026-12-31" }, QUERY],
  },
  reviews: {
    dueCount: [{ today: TODAY }, TEAM],
    duePage: [{ today: TODAY }, TEAM, QUERY],
    reviewerDueCount: [{ today: TODAY, employee_id: ID }],
    reviewerDuePage: [{ today: TODAY, employee_id: ID }, QUERY],
  },
  vacancies: { openCount: [TEAM], openPage: [TEAM, QUERY] },
  payroll: {},
  partners: {
    pipelineCount: [TEAM],
    pipelinePage: [TEAM, QUERY],
    pipelineByStage: [TEAM],
    activeCount: [TEAM],
    activePage: [TEAM, QUERY],
    quietCount: [{ today: TODAY }, TEAM],
    quietPage: [{ today: TODAY }, TEAM, QUERY],
    signedValue: [{ today: TODAY }, TEAM],
    signedPage: [{ today: TODAY }, TEAM, QUERY],
    signedByMonth: [{ from: "2026-01-01", to: "2026-12-31" }, TEAM],
    proposalsOutCount: [TEAM],
    proposalsOutPage: [TEAM, QUERY],
  },
  expenses: { awaiting: [TEAM], awaitingPage: [TEAM, QUERY] },
  budgets: { used: [{ today: TODAY }, TEAM], usedPage: [{ today: TODAY }, TEAM, QUERY] },
};

/** The functions that sum money, each of which must count Naira only. */
const SUMS = { partners: ["signedValue", "signedByMonth"], expenses: ["awaiting"], budgets: ["used", "usedPage"] };

const queryFunctions = (adapter) =>
  Object.keys(adapter).filter((k) => typeof adapter[k] === "function");

/** Run one query function against a client that records every statement and answers a row. */
async function sqlOf(adapter, name) {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(sql);
      return { rows: [{ n: 0, value: 0, denominator: 0, amount: "0.00", _total: 0 }] };
    },
  };
  await adapter[name](client, ...CALLS[adapter.module][name]);
  return statements;
}

/** The schema as gate 6 reads it, but with each table the adapter declares cut to its declared columns. */
function declaredOnly(adapter) {
  const tables = new Map(schema.tables);
  for (const [table, columns] of Object.entries(adapter.tables)) tables.set(table, new Set(columns));
  return { ...schema, tables };
}

/** The milestone of the migration file that creates a table: 2000 → M2, 7000 → M7. */
function milestoneOf(table) {
  const created = (schema.definitions.get(table) || [])[0];
  const number = created && Number(/(\d+)_/.exec(path.basename(created.file))[1]);
  return number ? `M${Math.floor(number / 1000)}` : null;
}

describe.each(ADAPTERS)("the %s source adapter", (name) => {
  const adapter = adapters[name];

  test("names its module, milestone and owner, and what that milestone still owes", () => {
    expect(adapter.module).toBe(name);
    expect(adapter.milestone).toMatch(/^M([2-9]|1[01])$/);
    expect(OWNERS.has(adapter.owner)).toBe(true);
    expect(Array.isArray(adapter.owes) && adapter.owes.length > 0).toBe(true);
    for (const item of adapter.owes) expect(typeof item).toBe("string");
  });

  test("its header says who owns the tables and that their builder updates it in the same PR", () => {
    const header = fs
      .readFileSync(path.join(DIR, `${name}.source.js`), "utf8")
      .split("*/")[0]
      .replace(/\n\s*\*\s?/g, " ")
      .replace(/\s+/g, " ");
    expect(header).toMatch(new RegExp(`OWNED BY [^.]*${adapter.milestone} [^.]*${adapter.owner}`));
    expect(header).toMatch(/MUST, in the same PR/);
  });

  test("every table and column it declares is in the migrated schema, in its milestone's block", () => {
    for (const [table, columns] of Object.entries(adapter.tables)) {
      expect([table, schema.tables.has(table)]).toEqual([table, true]);
      expect([table, milestoneOf(table)]).toEqual([table, adapter.milestone]);
      const real = schema.tables.get(table);
      for (const column of columns) expect([`${table}.${column}`, real.has(column)]).toEqual([`${table}.${column}`, true]);
      expect(new Set(columns).size).toBe(columns.length);
    }
  });

  test("every query function is run here, and names only the columns it declares", async () => {
    expect(queryFunctions(adapter).sort()).toEqual(Object.keys(CALLS[name]).sort());
    const narrowed = declaredOnly(adapter);
    for (const fn of queryFunctions(adapter)) {
      const statements = await sqlOf(adapter, fn);
      expect(statements.length).toBeGreaterThan(0);
      for (const sql of statements) {
        const findings = checkStatement(sql, narrowed).map((f) => `${fn}: ${f.ref}`);
        expect(findings).toEqual([]);
      }
    }
  });
});

describe("money and the adapters", () => {
  test.each(Object.entries(SUMS).flatMap(([name, fns]) => fns.map((fn) => [name, fn])))(
    "%s.%s sums Naira only",
    async (name, fn) => {
      const [sql] = await sqlOf(adapters[name], fn);
      expect(sql).toMatch(/currency = 'NGN'/);
    },
  );

  test("payroll declares no table and runs no query until M6 builds one", () => {
    expect(adapters.payroll.tables).toEqual({});
    expect(queryFunctions(adapters.payroll)).toEqual([]);
  });

  test("the schema check used here does catch a column an adapter did not declare", () => {
    const narrowed = declaredOnly({ tables: { task: ["task_id"] } });
    expect(checkStatement("SELECT t.title FROM task t", narrowed).map((f) => f.ref)).toEqual(["t.title"]);
  });
});
