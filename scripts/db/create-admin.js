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
 *   node scripts/db/create-admin.js --build-account --env=staging
 *       The implementation team's login (BUILD_ACCOUNT below): a complete
 *       employee record, role Implementation Team, suspended at handover. Asks
 *       only for the work email and the password; neither is ever in the
 *       repository (docs/runbooks/first-accounts.md).
 *
 *   --env=<name>          confirm the environment on the command line instead of
 *                         typing it; refused unless it is this .env's APP_ENV
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
const { StringDecoder } = require("node:string_decoder");
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
    "build-account",
    "env",
    "allow-additional",
    "dry-run",
    "help",
  ]);
  for (const k of Object.keys(args)) {
    if (!known.has(k)) throw new Error(`Unknown option --${k}`);
  }
  const sources = ["from", "sample", "build-account"].filter((k) => args[k]);
  if (sources.length > 1)
    throw new Error(`--${sources.join(" and --")} cannot be used together`);
  if (args.env === true) throw new Error("--env needs the environment's name: --env=staging");
  return args;
}

/* ------------------------------------------------------------------ *
 * Terminal
 * ------------------------------------------------------------------ */

/** Control and escape sequences a terminal may send with a keystroke or a paste. */
const ESCAPE_RE = /\x1b\[[0-9;?]*[~A-Za-z]|\x1b./g; // eslint-disable-line no-control-regex

/**
 * One question at a time on the terminal. A plain question gets its own readline for that
 * question only. A password is read with no readline at all: readline redraws its line by moving
 * to the first column and clearing the screen below, and with the echo muted that redraw erased
 * the prompt, so on a narrow terminal (a phone) it looked as if nothing was asked.
 */
function makeTerminal({ input = process.stdin, output = process.stdout } = {}) {
  const ask = (question, { fallback } = {}) =>
    new Promise((resolve) => {
      const rl = readline.createInterface({ input, output, terminal: true });
      const hint = fallback ? ` [${fallback}]` : "";
      rl.question(`${question}${hint}: `, (a) => {
        rl.close();
        resolve(a.trim() || fallback || "");
      });
    });

  // Nothing is echoed while a password is typed. Enter ends it, Backspace removes the last
  // character, Ctrl+C cancels the run.
  const askHidden = (question) =>
    new Promise((resolve, reject) => {
      output.write(`${question}: `);
      const decoder = new StringDecoder("utf8");
      let typed = "";
      const finish = (settle) => {
        input.removeListener("data", onData);
        input.setRawMode(false);
        input.pause();
        output.write("\n");
        settle();
      };
      const onData = (chunk) => {
        for (const ch of decoder.write(chunk).replace(ESCAPE_RE, "")) {
          if (ch === "\r" || ch === "\n") return finish(() => resolve(typed));
          if (ch === "\u0003") return finish(() => reject(new Error("Cancelled. Nothing was written.")));
          if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
          else if (ch >= " ") typed += ch;
        }
        return undefined;
      };
      input.setRawMode(true);
      input.on("data", onData);
      input.resume();
    });

  return { ask, askHidden, close: () => {} };
}

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

const FIELDS = [
  ["first_name", "First name"],
  ["middle_name", "Middle name (optional)"],
  ["last_name", "Last name"],
  ["preferred_name", "Preferred name (optional)"],
  ["work_email", "Work email"],
  ["personal_email", "Personal email (optional)"],
  ["phone", "Phone, 11 digits (e.g. 0803 123 4567)"],
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
  ["contract_ends_on", "Contract ends (YYYY-MM-DD, optional; consultants and contractors)"],
  ["confirmation_due_on", "Confirmation due (YYYY-MM-DD, optional; end of probation)"],
  ["confirmed_on", "Confirmed on (YYYY-MM-DD, optional)"],
  ["date_of_birth", "Date of birth (YYYY-MM-DD, optional)"],
  ["home_address", "Home address (optional)"],
  ["staff_number", "Staff number (optional, issued automatically when blank)"],
  ["gender", `Gender (${contract.organisation.GENDERS.join(", ")}, optional)`],
  ["next_of_kin_name", "Next of kin name (optional)"],
  ["next_of_kin_phone", "Next of kin phone (optional)"],
  ["next_of_kin_relationship", "Next of kin relationship (optional)"],
  ["bank_name", "Bank name (optional)"],
  ["account_number", "Account number (10 digits, optional)"],
  ["gross_monthly", "Gross monthly pay in naira (e.g. 450000.00, optional)"],
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

/**
 * The implementation team's login: a complete employee record, held by the Implementation Team
 * role for the length of the build and suspended at handover (docs/runbooks/first-accounts.md).
 * Every employee field is filled except the ones that point at other records (worksite, line
 * and dotted managers, seats: a remote first account has none to point at) and left_on. The
 * email is typed at the terminal and serves as both work and personal email, so it is never kept
 * here. A consultant has no probation, so confirmation is due and done on the start date. A
 * two-month consultancy of N3,700,000, so N1,850,000 a month. The account number is ten zeros on
 * purpose: it reaches no one, so no payment run can ever send money to a real account.
 */
const BUILD_ACCOUNT = Object.freeze({
  role_code: "implementation",
  is_ceo: false,
  employee: Object.freeze({
    first_name: "JBS Praxis",
    middle_name: "Implementation",
    last_name: "Team",
    preferred_name: "JBS Praxis",
    phone: "08027492738",
    job_title: "Implementation Partner",
    department_name: "Implementation",
    start_date: "2026-10-09",
    contract_ends_on: "2026-12-09",
    confirmation_due_on: "2026-10-09",
    confirmed_on: "2026-10-09",
    employment_type: "consultant",
    work_pattern: "remote",
    gender: "male",
    date_of_birth: "1990-03-12",
    home_address: "14 Adeola Odeku Street, Victoria Island, Lagos",
    next_of_kin_name: "JBS Praxis Office",
    next_of_kin_phone: "08027492738",
    next_of_kin_relationship: "Employer",
    bank_name: "Zenith Bank",
    account_number: "0000000000",
    gross_monthly: "1850000.00",
  }),
});

/** The build account's payload with the email typed at the terminal, as work and personal email. */
function buildAccount(email) {
  return {
    role_code: BUILD_ACCOUNT.role_code,
    is_ceo: BUILD_ACCOUNT.is_ceo,
    employee: { ...BUILD_ACCOUNT.employee, work_email: email, personal_email: email },
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
  if (args.env !== undefined && args.env !== env) {
    throw new Error(
      `--env=${args.env} does not match this .env (APP_ENV=${env}). Nothing was written.`,
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
    } else if (args["build-account"]) {
      payload = buildAccount(await term.ask("Work email"));
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
      `  ${[e.first_name, e.middle_name, e.last_name].filter(Boolean).join(" ")} <${e.work_email}>, ${e.job_title}, ${e.department_name}`,
    );
    const contractTerm = e.contract_ends_on ? `, contract ${e.start_date} to ${e.contract_ends_on}` : "";
    console.log(`  ${e.employment_type}, ${e.work_pattern}${contractTerm}`);
    console.log(`  role ${data.role_code}${data.is_ceo ? ", CEO" : ""}`);
    console.log(
      `  database environment ${env}${args["dry-run"] ? " (dry run, nothing kept)" : ""}`,
    );

    // --env=<name> is the same confirmation, given on the command line.
    const typed = args.env === env ? env : await term.ask(`\nType "${env}" to continue`);
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

module.exports = { createAdmin, sampleEmployee, buildAccount, BUILD_ACCOUNT, parseArgs, makeTerminal, MIN_PASSWORD };
