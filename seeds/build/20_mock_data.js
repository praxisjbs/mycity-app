"use strict";
/**
 * The mock's people and leave, in a laptop's own database (docs/guides/ess.md §13).
 *
 *   SEED_PASSWORD=<a password> in .env, then:  npm run db:seed -- --build
 *
 * `npm run dev` on the in-browser mock and `VITE_API_MODE=live npm run dev` on the real
 * API then show the same 25 people, the same reporting tree and the same leave. The
 * roster is app/src/api/mock/data/roster.json, the file the mock itself reads, so the two
 * cannot drift.
 *
 * Local only. Besides the three refusals in scripts/db/seed.js (APP_ENV, the database
 * name, system_marker), this file refuses unless:
 *
 *   - APP_ENV is development or test
 *   - SMTP_HOST is empty, so no mail to these addresses can leave the machine
 *   - the roster is on disk: a release ships app/dist, never app/src, so on a server
 *     there is nothing to load
 *
 * Everything goes through the services, so numbering, audit and events apply:
 *
 *   people    the organisation service: departments, then each person, managers first.
 *             Staff numbers come from the numbering, not the mock.
 *   logins    the identity service, every login with SEED_PASSWORD (never in the repo),
 *             roles from the post: CEO, Operations & People, Head of Department, Line
 *             Manager, Staff. The CEO flag only when the database has no CEO yet.
 *   leave     seeds/lib/leave-sample.js, the same as staging: approved rows recorded by
 *             Operations & People, waiting rows asked by the person (they open the real
 *             approval), one rejected in the flow by the line manager, one cancelled.
 *
 * Left out: pay, attendance, documents and every other module (their owners seed them).
 * A suspended person in the mock is loaded as active.
 *
 * Idempotent: a person whose work email is already on the register is left as they are,
 * a login is added only where there is none, and leave is added only while none of these
 * people has any.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const ROSTER = path.join(ROOT, "app", "src", "api", "mock", "data", "roster.json");
const LOCAL = new Set(["development", "test"]);
const { applyLeaveSample, loginsOf } = require("../lib/leave-sample");

const ROLE_BY_KEY = {
  ifeoma: "management",
  cynthia: "operations_people",
  ngozi: "head_of_department",
};
const CEO_KEY = "ifeoma";
const PEOPLE_LEAD = "cynthia";
const KIN = ["Sibling", "Parent", "Spouse"];

/** Why this machine may not be given the mock's data; empty means it may. */
function refusals({ appEnv, smtpHost, rosterExists }) {
  const out = [];
  if (!LOCAL.has(appEnv)) out.push(`APP_ENV is ${appEnv}: the mock's data is for a laptop or CI only`);
  if (smtpHost) out.push("SMTP_HOST is set: mail to these people would really be sent");
  if (!rosterExists) out.push("the mock's roster is not in this build (app/src/api/mock/data/roster.json)");
  return out;
}

const addMonths = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
/** Managers before the people who report to them. */
function inTreeOrder(people) {
  const out = [];
  const placed = new Set();
  while (out.length < people.length) {
    const before = out.length;
    for (const p of people)
      if (!placed.has(p.key) && (!p.manager || placed.has(p.manager))) {
        out.push(p);
        placed.add(p.key);
      }
    if (out.length === before) throw new Error("roster.json: the reporting lines loop or name someone missing");
  }
  return out;
}

/** The register's fields for one mock person (EmployeeCreate before parsing). */
function employeeOf(p, i, today) {
  const due = addMonths(p.start_date, 6);
  const confirmed = p.status !== "probation";
  return {
    first_name: p.first_name,
    last_name: p.last_name,
    work_email: p.work_email,
    phone: p.phone,
    job_title: p.job_title,
    start_date: p.start_date,
    employment_type: p.employment_type,
    work_pattern: p.work_pattern,
    confirmation_due_on: due,
    confirmed_on: confirmed ? (due < today ? due : today) : null,
    date_of_birth: p.date_of_birth,
    next_of_kin_name: p.next_of_kin,
    next_of_kin_relationship: KIN[i % KIN.length],
    bank_name: p.bank_name,
    account_number: `0${String(10000 + i * 373).padStart(5, "0")}${p.account_last4}`,
  };
}

module.exports = async function seed({ pool, actor, log }) {
  const { config } = require(path.join(ROOT, "src/config/env"));
  const problems = refusals({
    appEnv: config.APP_ENV,
    smtpHost: config.SMTP_HOST,
    rosterExists: fs.existsSync(ROSTER),
  });
  if (problems.length) {
    log(`mock data: not loaded:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    return;
  }
  const password = process.env.SEED_PASSWORD;
  if (!password)
    throw new Error(
      "Set SEED_PASSWORD in .env: every seeded login signs in with it (it stays on this machine)",
    );

  const roster = JSON.parse(fs.readFileSync(ROSTER, "utf8"));
  const lagos = require(path.join(ROOT, "src/shared/time/lagos"));
  const today = lagos.today();
  const people = await loadPeople({ pool, actor, log, roster, password, today });
  await loadLeave({ pool, log, roster, people, today });
};

/* ------------------------------------------------------------------ *
 * People and logins
 * ------------------------------------------------------------------ */

async function loadPeople({ pool, actor, log, roster, password, today }) {
  const { atomically } = require(path.join(ROOT, "src/shared/db/tx"));
  const { EmployeeCreate } = require(path.join(ROOT, "packages/contract/schemas/organisation"));
  const organisation = require(path.join(ROOT, "src/modules/organisation/organisation.service"));
  const identity = require(path.join(ROOT, "src/modules/identity/identity.service"));
  const access = require(path.join(ROOT, "src/modules/access/access.service"));

  const managers = new Set(roster.people.map((p) => p.manager).filter(Boolean));
  const index = new Map(roster.people.map((p, i) => [p.key, i]));
  const byKey = new Map();
  const counts = { created: 0, kept: 0, logins: 0 };

  for (const p of inTreeOrder(roster.people)) {
    const client = await pool.connect();
    try {
      await atomically(client, async () => {
        let employee = await organisation.findEmployeeByWorkEmail(client, p.work_email);
        if (employee) counts.kept += 1;
        else {
          const department = await organisation.findOrCreateDepartment(client, p.department, actor);
          const body = EmployeeCreate.parse({
            ...employeeOf(p, index.get(p.key), today),
            department_id: department.department_id,
            ...(p.manager ? { line_manager_id: byKey.get(p.manager).employee_id } : {}),
          });
          employee = await organisation.createEmployee(client, body, actor);
          counts.created += 1;
        }
        byKey.set(p.key, { employee_id: employee.employee_id });

        const { rows } = await client.query(
          "SELECT user_id FROM app_user WHERE employee_id = $1 OR email = $2",
          [employee.employee_id, p.work_email],
        );
        if (rows.length) return;
        const { rows: ceo } = await client.query("SELECT 1 FROM app_user WHERE is_ceo");
        const user = await identity.createUserForEmployee(
          client,
          {
            employee_id: employee.employee_id,
            email: p.work_email,
            password,
            is_ceo: p.key === CEO_KEY && ceo.length === 0,
          },
          actor,
        );
        const role = ROLE_BY_KEY[p.key] || (managers.has(p.key) ? "manager" : "employee");
        await access.setRoles(client, user.user_id, [role], actor);
        counts.logins += 1;
      });
    } finally {
      client.release();
    }
  }
  log(
    `mock data: ${counts.created} people added, ${counts.kept} already there, ` +
      `${counts.logins} logins (password: SEED_PASSWORD)`,
  );

  const users = await loginsOf(pool, [...byKey.values()].map((v) => v.employee_id));
  for (const [key, v] of byKey) byKey.set(key, { employee_id: v.employee_id, user: users.get(v.employee_id) || null });
  return byKey;
}

/* ------------------------------------------------------------------ *
 * Leave
 * ------------------------------------------------------------------ */

async function loadLeave({ pool, log, roster, people, today }) {
  const managerOf = new Map(roster.people.map((p) => [p.key, p.manager]));
  const withManagers = new Map(
    [...people].map(([key, p]) => {
      const m = managerOf.get(key) && people.get(managerOf.get(key));
      return [key, { ...p, manager: m ? m.user : null }];
    }),
  );
  const lead = people.get(PEOPLE_LEAD);
  const r = await applyLeaveSample({
    pool,
    log: (m) => log(`mock data: ${m}`),
    rows: roster.leave,
    people: withManagers,
    recorder: lead ? lead.user : null,
    today,
  });
  log(
    r.already
      ? `mock data: leave already there (${r.already} requests), none added`
      : `mock data: ${r.added} of ${roster.leave.length} leave requests added`,
  );
}

module.exports.refusals = refusals;
module.exports.inTreeOrder = inTreeOrder;
module.exports.employeeOf = employeeOf;
