"use strict";
/**
 * The schema tests/integration runs against: the real migrations and reference seeds, applied
 * by scripts/db/migrate.js exactly as a server applies them, plus the test-only tables in
 * fixtures/test-tables.sql. Running the shared layer against anything else is how the code and
 * the schema drifted apart unnoticed (docs/MIGRATIONS.md §7, §12).
 *
 * Rows a test inserts by hand must satisfy the real constraints. The SQL below fills the
 * columns a test does not care about, so each test still names only what it is about.
 */
const fs = require("node:fs");
const path = require("node:path");
const migrate = require("../../../scripts/db/migrate");

const TEST_TABLES = path.join(__dirname, "..", "fixtures", "test-tables.sql");

/**
 * Drop the public schema and build it again from the migrations. Refuses anything but a
 * database whose name ends in "_test".
 * @param {import("pg").Pool} pool
 * @param {string} dbName
 */
async function rebuild(pool, dbName) {
  if (!String(dbName || "").endsWith("_test"))
    throw new Error(`refusing: ${dbName} is not a _test database`);
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await migrate.migrate(client);
    await client.query(fs.readFileSync(TEST_TABLES, "utf8"));
    await client.query(
      "INSERT INTO department (code, name) VALUES ('TEST', 'Test') ON CONFLICT (code) DO NOTHING",
    );
  } finally {
    client.release();
  }
}

/** The columns every employee row must carry, with values no test asserts on. */
const EMPLOYEE_FILL = `
  'T' || upper(substr(md5(random()::text), 1, 8)),
  lower(regexp_replace($1::text || '.' || $2::text, '[^A-Za-z.]', '', 'g')) || '.' || substr(md5(random()::text), 1, 6) || '@staff.mycity.test',
  'Tester',
  (SELECT department_id FROM department WHERE code = 'TEST'),
  'full_time', 'on_site', DATE '2026-01-05'`;

const EMPLOYEE_FILL_COLUMNS =
  "staff_number, work_email, job_title, department_id, employment_type, work_pattern, start_date";

const sql = {
  /** $1 first name, $2 last name, $3 line manager id (or null). */
  employee: `INSERT INTO employee (first_name, last_name, line_manager_id, ${EMPLOYEE_FILL_COLUMNS})
             VALUES ($1::text, $2::text, $3::uuid, ${EMPLOYEE_FILL}) RETURNING employee_id`,
  /** $1 first name; the last name is "Test". */
  employeeNamed: `INSERT INTO employee (first_name, last_name, ${EMPLOYEE_FILL_COLUMNS})
                  VALUES ($1::text, 'Test', ${EMPLOYEE_FILL.replace("$2::text", "'Test'")}) RETURNING employee_id`,
  /** $1 employee id, $2 email, $3 is_ceo. Nobody signs in during these tests. */
  user: "INSERT INTO app_user (employee_id, email, is_ceo, password_hash) VALUES ($1, $2, $3, 'test-only') RETURNING user_id",
  /** $1 employee id, $2 email. */
  userPlain: "INSERT INTO app_user (employee_id, email, password_hash) VALUES ($1, $2, 'test-only') RETURNING user_id",
  /** $1 role code, used as its name too. */
  role: "INSERT INTO role (code, name) VALUES ($1::text, $1::text) RETURNING role_id",
};

module.exports = { rebuild, sql };
