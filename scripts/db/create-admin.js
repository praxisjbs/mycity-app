#!/usr/bin/env node
"use strict";
/**
 * Bootstrap an administrator: a COMPLETE employee, their login, and their role,
 * created together in one transaction through the same services the app uses.
 *
 * Why it is written this way (internal meeting, 12 October 2026). A script that
 * inserts an `app_user` with only an email and a password makes an account that
 * can sign in but does not exist as an employee: invisible in People, outside every reporting line, owning records
 * nobody could trace to a person. With the repository public, a script that
 * mints such an account is also a back door anyone can read. So here:
 *
 *  - No login without an employee. The employee is created first, with the
 *    full payload the People screen requires, a staff number and a department.
 *    The login is attached to that employee (`app_user.employee_id NOT NULL`).
 *  - Writes go through organisation, identity and access SERVICES, never raw
 *    SQL, so numbering, audit, events and field rules apply exactly as when a
 *    person is created on screen (README §6.1).
 *  - The password is typed at a hidden prompt, twice. Never an argument (shell
 *    history, process list), never in a file.
 *  - An existing login is never overwritten. An `ON CONFLICT DO UPDATE SET
 *    password_hash` would let anyone able to run the script take over any
 *    account by email.
 *  - It is a bootstrap. Once any active user holds the role, it refuses unless
 *    --allow-additional is given; everyone after the first is created in the
 *    app, by a person, under their own name in the audit log.
 *  - It needs the server's own .env and an interactive terminal, and asks you
 *    to type the environment name before it writes anything.
 *
 * Usage
 *
 *   node scripts/db/create-admin.js
 *       Interactive. Asks for every employee field, then the role and password.
 *
 *   node scripts/db/create-admin.js --from=admin.json
 *       Employee fields and role from a JSON file in the AdminBootstrap shape
 *       (packages/contract/schemas/organisation.js). Password still prompted.
 *
 *   node scripts/db/create-admin.js --sample
 *       Staging, local and CI only. Fills the employee with a complete sample
 *       profile and asks only for the work email, role and password. Refused
 *       on production: the production administrator is a real person.
 *
 *   --allow-additional    create another holder of a role that already has one
 *   --dry-run             validate and run the whole transaction, then roll back
 *
 * Seeds and tests call createAdmin() directly with a payload; they never shell
 * out to this file.
 *
 * Depends on (M0, BACKEND_STRUCTURE §17):
 *   src/config/env.js            { config: { APP_ENV, ... } }
 *   src/config/db.js             { pool }
 *   src/config/request-context.js run(ctx, fn)
 *   src/shared/db/tx.js          atomically(client, fn)
 *   src/modules/organisation/organisation.service.js
 *       findDepartmentByName(client, name)
 *       createDepartment(client, { name }, actor)
 *       findEmployeeByWorkEmail(client, email)
 *       createEmployee(client, EmployeeCreate, actor)
 *   src/modules/identity/identity.service.js
 *       findUserByEmail(client, email)
 *       findUserByEmployeeId(client, employee_id)
 *       findCeo(client)
 *       createUserForEmployee(client, { employee_id, email, password, is_ceo }, actor)
 *   src/modules/access/access.service.js
 *       findRoleByCode(client, code)
 *       listRoles(client)
 *       countActiveUsersWithRole(client, role_id)
 *       assignRole(client, { user_id, role_id }, actor)
 */

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");

const contract = require("../../packages/contract");

const ACTOR = Object.freeze({ user_id: null, source: "script:create-admin" });
/** The rule is identity's (identity.password-policy.js); the length is the contract's. */
const MIN_PASSWORD = contract.identity.PASSWORD_MIN;
const LOCK_KEY = "mycity:create-admin";

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const m = raw.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`Unknown argument "${raw}"`);
    args[m[1]] = m[2] === undefined ? true : m[2];
  }
  const known = new Set([
    "from",
    "sample",
    "allow-additional",
    "dry-run",
    "help",
  ]);
  for (const k of Object.keys(args)) {
    if (!known.has(k)) throw new Error(`Unknown option --${k}`);
  }
  if (args.from && args.sample)
    throw new Error("--from and --sample cannot be used together");
  return args;
}

/* ------------------------------------------------------------------ *
 * Terminal
 * ------------------------------------------------------------------ */

function makeTerminal() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  let muted = false;
  // Echo nothing while a password is typed. The prompt itself is written before muting.
  rl._writeToOutput = (s) => {
    if (!muted) rl.output.write(s);
  };

  const ask = (question, { fallback } = {}) =>
    new Promise((resolve) => {
      const hint = fallback ? ` [${fallback}]` : "";
      rl.question(`${question}${hint}: `, (a) =>
        resolve(a.trim() || fallback || ""),
      );
    });

  const askHidden = (question) =>
    new Promise((resolve) => {
      rl.output.write(`${question}: `);
      muted = true;
      rl.question("", (a) => {
        muted = false;
        rl.output.write("\n");
        resolve(a);
      });
    });

  return { ask, askHidden, close: () => rl.close() };
}

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

const FIELDS = [
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["work_email", "Work email"],
  ["phone", "Phone (e.g. 0803 123 4567)"],
  ["job_title", "Job title"],
  ["department_name", "Department"],
  ["start_date", "Start date (YYYY-MM-DD)"],
  [
    "employment_type",
    `Employment type (${contract.organisation.EMPLOYMENT_TYPES.join(", ")})`,
  ],
  [
    "work_pattern",
    `Work pattern (${contract.organisation.WORK_PATTERNS.join(", ")})`,
  ],
  ["date_of_birth", "Date of birth (YYYY-MM-DD, optional)"],
  ["staff_number", "Staff number (optional, issued automatically when blank)"],
  ["gender", `Gender (${contract.organisation.GENDERS.join(", ")}, optional)`],
  ["next_of_kin_name", "Next of kin name (optional)"],
  ["next_of_kin_phone", "Next of kin phone (optional)"],
  ["next_of_kin_relationship", "Next of kin relationship (optional)"],
];

/** A complete, obviously sample profile. Staging, local and CI only. */
function sampleEmployee(workEmail) {
  return {
    first_name: "System",
    last_name: "Administrator",
    work_email: workEmail,
    phone: "08000000000",
    job_title: "System Administrator",
    department_name: "Administration",
    start_date: new Date().toISOString().slice(0, 10),
    employment_type: "full_time",
    work_pattern: "on_site",
  };
}

async function collectInteractive(term) {
  const employee = {};
  for (const [key, label] of FIELDS) {
    const v = await term.ask(label);
    if (v !== "") employee[key] = v;
  }
  return employee;
}

async function chooseRole(term, roles) {
  console.log("\nRoles on this database:");
  for (const r of roles) console.log(`  ${r.code.padEnd(24)} ${r.name || ""}`);
  return term.ask("Role code");
}

async function askCeo(term) {
  const a = (
    await term.ask("Is this person the CEO? (yes/no)", { fallback: "no" })
  ).toLowerCase();
  return a === "yes" || a === "y";
}

async function askPassword(term) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const p1 = await term.askHidden(
      `Password (at least ${MIN_PASSWORD} characters, upper and lower case, a number and a symbol)`,
    );
    const shape = contract.identity.NewPassword.safeParse(p1);
    if (!shape.success) {
      console.log(`  ${shape.error.issues[0].message}.`);
      continue;
    }
    const p2 = await term.askHidden("Repeat password");
    if (p1 !== p2) {
      console.log("  The two entries do not match.");
      continue;
    }
    return p1;
  }
  throw new Error("No password set after three attempts");
}

function validate(payload) {
  const parsed = contract.organisation.AdminBootstrap.safeParse(payload);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map(
    (i) => `  ${i.path.join(".") || "(payload)"}: ${i.message}`,
  );
  const err = new Error(`The details are not valid:\n${lines.join("\n")}`);
  err.validation = true;
  throw err;
}

/* ------------------------------------------------------------------ *
 * The transaction. Exported for seeds and tests.
 * ------------------------------------------------------------------ */

/**
 * Create the employee, the login and the role assignment. Runs inside the
 * caller's client; wrap it in atomically() (main() does).
 *
 * @param {import("pg").PoolClient} client
 * @param {object} input      AdminBootstrap shape (validated here again)
 * @param {string} password
 * @param {{allowAdditional?: boolean}} [opts]
 * @returns {Promise<{employee: object, user: object, role: object, employee_created: boolean}>}
 */
async function createAdmin(client, input, password, opts = {}) {
  const organisation = require("../../src/modules/organisation/organisation.service");
  const identity = require("../../src/modules/identity/identity.service");
  const access = require("../../src/modules/access/access.service");
  const { AppError } = require("../../src/shared/errors");

  const data = validate(input);
  const { employee: e, role_code, is_ceo } = data;

  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new AppError(
      "WEAK_PASSWORD",
      `Password must be at least ${MIN_PASSWORD} characters`,
      422,
    );
  }

  // Two people running this at once must not both pass the checks below.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);

  const role = await access.findRoleByCode(client, role_code);
  if (!role)
    throw new AppError(
      "ROLE_NOT_FOUND",
      `There is no role "${role_code}" on this database`,
      404,
    );

  const holders = await access.countActiveUsersWithRole(client, role.role_id);
  if (holders > 0 && !opts.allowAdditional) {
    throw new AppError(
      "ROLE_ALREADY_HELD",
      `${holders} active user(s) already hold "${role_code}". Create further users in the app ` +
        "(Settings, Users), or pass --allow-additional if this really must be scripted.",
      409,
    );
  }

  if (is_ceo && (await identity.findCeo(client))) {
    throw new AppError(
      "CEO_EXISTS",
      "A CEO is already recorded. There can be only one.",
      409,
    );
  }

  if (await identity.findUserByEmail(client, e.work_email)) {
    throw new AppError(
      "LOGIN_EXISTS",
      `A login for ${e.work_email} already exists. This script never changes an existing login; ` +
        "reset the password from the app instead.",
      409,
    );
  }

  // Reuse the employee when staff were imported before the first login was made.
  let employee = await organisation.findEmployeeByWorkEmail(
    client,
    e.work_email,
  );
  let employeeCreated = false;

  if (employee) {
    if (await identity.findUserByEmployeeId(client, employee.employee_id)) {
      throw new AppError(
        "LOGIN_EXISTS",
        `Employee ${employee.staff_number} already has a login`,
        409,
      );
    }
  } else {
    let department = await organisation.findDepartmentByName(
      client,
      e.department_name,
    );
    if (!department)
      department = await organisation.createDepartment(
        client,
        { name: e.department_name },
        ACTOR,
      );

    const { department_name, ...fields } = e;
    const body = contract.organisation.EmployeeCreate.parse({
      ...fields,
      department_id: department.department_id,
    });
    employee = await organisation.createEmployee(client, body, ACTOR);
    employeeCreated = true;
  }

  const user = await identity.createUserForEmployee(
    client,
    {
      employee_id: employee.employee_id,
      email: e.work_email,
      password,
      is_ceo,
    },
    ACTOR,
  );
  await access.assignRole(
    client,
    { user_id: user.user_id, role_id: role.role_id },
    ACTOR,
  );

  return { employee, user, role, employee_created: employeeCreated };
}

/* ------------------------------------------------------------------ *
 * Command line
 * ------------------------------------------------------------------ */

function usage() {
  const src = fs.readFileSync(__filename, "utf8");
  const block = src.slice(src.indexOf("/**"), src.indexOf(" */") + 3);
  console.log(
    block
      .replace(/^\/\*\*|\*\/$/g, "")
      .replace(/^ \* ?/gm, "")
      .trim(),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Run this in an interactive terminal. Seeds and tests call createAdmin() directly.",
    );
  }

  const { config } = require("../../src/config/env");
  const env = config.APP_ENV;
  if (!env) throw new Error("APP_ENV is not set; is this the server's .env?");
  if (args.sample && env === "production") {
    throw new Error(
      "--sample is refused on production. The production administrator is a real person.",
    );
  }

  const { pool } = require("../../src/config/db");
  const { atomically } = require("../../src/shared/db/tx");
  const requestContext = require("../../src/config/request-context");
  const access = require("../../src/modules/access/access.service");

  const term = makeTerminal();
  const client = await pool.connect();
  try {
    console.log(`\nMyCity: create administrator on ${env.toUpperCase()}\n`);

    let payload;
    if (args.from) {
      const file = path.resolve(process.cwd(), String(args.from));
      payload = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      const employee = args.sample
        ? sampleEmployee(await term.ask("Work email"))
        : await collectInteractive(term);
      const role_code = await chooseRole(term, await access.listRoles(client));
      const is_ceo = await askCeo(term);
      payload = { employee, role_code, is_ceo };
    }

    // Validate before asking for a password, so a typo does not cost a retype.
    const data = validate(payload);
    const password = await askPassword(term);

    const e = data.employee;
    console.log("\nAbout to create:");
    console.log(
      `  ${e.first_name} ${e.last_name} <${e.work_email}>, ${e.job_title}, ${e.department_name}`,
    );
    console.log(`  role ${data.role_code}${data.is_ceo ? ", CEO" : ""}`);
    console.log(
      `  database environment ${env}${args["dry-run"] ? " (dry run, nothing kept)" : ""}`,
    );

    const typed = await term.ask(`\nType "${env}" to continue`);
    if (typed !== env) {
      console.log("Cancelled. Nothing was written.");
      return;
    }

    const ROLLBACK = Symbol("dry-run");
    let result;
    try {
      await requestContext.run(
        { requestId: randomUUID(), userId: null, surface: "script" },
        () =>
          atomically(client, async () => {
            result = await createAdmin(client, data, password, {
              allowAdditional: Boolean(args["allow-additional"]),
            });
            if (args["dry-run"]) throw ROLLBACK;
          }),
      );
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }

    const { employee, user, role, employee_created } = result;
    console.log(
      `\n${args["dry-run"] ? "Dry run passed. Rolled back; nothing was kept." : "Done."}`,
    );
    console.log(
      `  employee ${employee.staff_number} ${employee_created ? "(created)" : "(existing, login added)"}`,
    );
    console.log(`  login    ${user.email}`);
    console.log(`  role     ${role.code}`);
  } finally {
    client.release();
    term.close();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\ncreate-admin failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createAdmin, sampleEmployee, MIN_PASSWORD };
