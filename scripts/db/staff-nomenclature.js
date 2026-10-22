"use strict";
/**
 * MyCity's names for its functions, posts and seats, kept true on every deploy
 * (`seeds/staff/nomenclature.json`; docs/guides/performance.md §6.20, docs/guides/foundation.md §6.1).
 *
 * The staff loader keeps what the app already has, so a new name in the sheet never reaches a
 * department or a person already loaded. This step does, in place, through the organisation
 * service (the one write path for the org), before the sheet is imported and again after it:
 *
 *   1. departments   a department under one of its former names (`was`) is renamed, keeping its
 *                    id and its people; one the sheet names and the database lacks is created with
 *                    its code; a code the system made from a name becomes MyCity's short code (BM);
 *                    a department in `merge` gives its people and seats over and is retired empty
 *   2. job titles    a person or an open seat still holding an old title takes the new one
 *   3. seats         an open seat still holding an old title takes the new one
 *   4. moves         the posts listed go to their department, from the departments named
 *   5. lines         a post still reporting to the named seat reports to the named post instead
 *   6. heads         a department with no head is given its post's holder, or its seat
 *
 * Each step looks before it writes and changes only what still holds the old value, so an
 * edit made on screen stays and a second deploy changes nothing. People are matched by their
 * post, never by name.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(ROOT, "seeds", "staff", "nomenclature.json");

/** Lower case, punctuation out, spacing collapsed: how two names are compared. */
const fold = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9*]+/g, " ")
    .trim();

/**
 * A post pattern: exact, or with one `*` standing for the rest ("Growth Officer - *").
 * @returns {(title: string) => string|null} the part `*` stood for ("" for an exact match), or null
 */
function matcher(pattern) {
  const p = fold(pattern);
  if (!p.includes("*")) return (title) => (fold(title) === p ? "" : null);
  const [head, tail] = p.split("*");
  return (title) => {
    const t = fold(title);
    if (!t.startsWith(head) || !t.endsWith(tail) || t.length < head.length + tail.length) return null;
    const raw = String(title).trim();
    // The part `*` stood for, in the title's own spelling: what follows the pattern's fixed head.
    const fixed = String(pattern).split("*")[0];
    return raw.slice(fixed.length).trim() || t.slice(head.length, t.length - tail.length).trim();
  };
}

/** The new title for an old one under a pattern map, or null when none applies. */
function retitle(map, title) {
  for (const [from, to] of Object.entries(map || {})) {
    const rest = matcher(from)(title);
    if (rest === null) continue;
    const next = to.includes("*") ? to.replace("*", rest) : to;
    return next === title ? null : next;
  }
  return null;
}

/** The code the system makes from a name ("SALES_MARKETING"), as organisation.service does. */
const autoCode = (name) =>
  String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

function readNomenclature(file = FILE) {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    departments: parsed.departments || [],
    job_titles: parsed.job_titles || {},
    seats: parsed.seats || {},
    moves: parsed.moves || [],
    lines: parsed.lines || [],
  };
}

/**
 * Apply the nomenclature.
 * @param {{pool: import("pg").Pool, atomically: Function, log?: Function, actor: object,
 *          file?: string, teams?: string[]}} opts
 *   teams: the department names the sheet being loaded uses; a department is created only when
 *   the sheet names it, so a sheet that is not MyCity's creates nothing here
 * @returns {Promise<{renamed: number, created: number, codes: number, merged: number, titles: number,
 *                    seats: number, moved: number, lines: number, heads: number}>}
 */
async function applyNomenclature({ pool, atomically, log = () => {}, actor, file = FILE, teams = [] }) {
  const out = { renamed: 0, created: 0, codes: 0, merged: 0, titles: 0, seats: 0, moved: 0, lines: 0, heads: 0 };
  const plan = readNomenclature(file);
  if (!plan) return out;
  const organisation = require(path.join(ROOT, "src/modules/organisation/organisation.service.js"));
  const tx = async (fn) => {
    const client = await pool.connect();
    try {
      return await atomically(client, () => fn(client));
    } finally {
      client.release();
    }
  };
  const named = new Set(teams.map(fold));
  const deptByName = async (name) =>
    (
      await pool.query(
        `SELECT department_id, name, code::text AS code, active, head_employee_id, head_seat_id
           FROM department WHERE lower(name) = lower($1) ORDER BY active DESC, created_at LIMIT 1`,
        [name],
      )
    ).rows[0] || null;
  const holders = async (post) =>
    (
      await pool.query(
        `SELECT employee_id FROM employee WHERE status = 'active' AND lower(btrim(job_title)) = lower(btrim($1))`,
        [post],
      )
    ).rows;

  /* 1. Departments. */
  for (const d of plan.departments) {
    let dept = await deptByName(d.name);
    if (!dept) {
      for (const old of d.was || []) {
        const former = await deptByName(old);
        if (!former) continue;
        await tx((client) => organisation.updateDepartment(client, former.department_id, { name: d.name }, actor));
        log(`department "${old}" is now "${d.name}"`);
        out.renamed += 1;
        dept = await deptByName(d.name);
        break;
      }
    }
    if (!dept && named.has(fold(d.name))) {
      await tx((client) => organisation.createDepartment(client, { name: d.name, code: d.code }, actor));
      log(`department "${d.name}" (${d.code}) created`);
      out.created += 1;
      dept = await deptByName(d.name);
    }
    if (!dept) continue;
    const made = [d.name, ...(d.was || [])].map(autoCode);
    if (d.code && dept.code !== d.code && made.includes(dept.code)) {
      const taken = (await pool.query("SELECT 1 FROM department WHERE code = $1", [d.code])).rows.length > 0;
      if (taken) log(`WARNING: code ${d.code} is held by another department; "${d.name}" keeps ${dept.code}`);
      else {
        await tx((client) => organisation.updateDepartment(client, dept.department_id, { code: d.code }, actor));
        log(`department "${d.name}" has the code ${d.code}`);
        out.codes += 1;
      }
    }
    for (const other of d.merge || []) {
      const from = await deptByName(other);
      if (!from || from.department_id === dept.department_id || !from.active) continue;
      const { rows: people } = await pool.query(
        "SELECT employee_id FROM employee WHERE department_id = $1 AND status <> 'archived'",
        [from.department_id],
      );
      const { rows: openSeats } = await pool.query(
        "SELECT org_seat_id FROM org_seat WHERE department_id = $1 AND status <> 'closed'",
        [from.department_id],
      );
      await tx(async (client) => {
        for (const p of people)
          await organisation.updateEmployee(client, p.employee_id, { department_id: dept.department_id }, actor);
        for (const s of openSeats)
          await organisation.updateSeat(client, s.org_seat_id, { department_id: dept.department_id }, actor);
        await organisation.updateDepartment(client, from.department_id, { active: false }, actor);
      });
      log(`department "${other}" merged into "${d.name}" (${people.length} people) and retired`);
      out.merged += 1;
    }
  }

  /* 2. Job titles, of people and of open seats. */
  const { rows: titled } = await pool.query(
    "SELECT employee_id, job_title FROM employee WHERE status <> 'archived' AND job_title IS NOT NULL ORDER BY created_at",
  );
  for (const p of titled) {
    const next = retitle(plan.job_titles, p.job_title);
    if (!next) continue;
    await tx((client) => organisation.updateEmployee(client, p.employee_id, { job_title: next }, actor));
    log(`post "${p.job_title}" is now "${next}"`);
    out.titles += 1;
  }

  /* 3. Seats: the seat map, then the job title map for open seats. */
  const { rows: seats } = await pool.query(
    "SELECT org_seat_id, title FROM org_seat WHERE status <> 'closed' ORDER BY created_at",
  );
  for (const s of seats) {
    const next = retitle(plan.seats, s.title) || retitle(plan.job_titles, s.title);
    if (!next) continue;
    await tx((client) => organisation.updateSeat(client, s.org_seat_id, { title: next }, actor));
    log(`seat "${s.title}" is now "${next}"`);
    out.seats += 1;
  }

  /* 4. Moves. */
  for (const m of plan.moves) {
    const to = await deptByName(m.department);
    if (!to) continue;
    const from = (await Promise.all((m.from || []).map(deptByName))).filter(Boolean).map((x) => x.department_id);
    if (!from.length) continue;
    const posts = (m.posts || []).map(matcher);
    const fits = (title) => posts.some((f) => f(title) !== null);
    const { rows: people } = await pool.query(
      "SELECT employee_id, job_title FROM employee WHERE status <> 'archived' AND department_id = ANY($1::uuid[])",
      [from],
    );
    const { rows: open } = await pool.query(
      "SELECT org_seat_id, title FROM org_seat WHERE status <> 'closed' AND department_id = ANY($1::uuid[])",
      [from],
    );
    const going = people.filter((p) => fits(p.job_title));
    const seatsGoing = open.filter((s) => fits(s.title));
    if (!going.length && !seatsGoing.length) continue;
    await tx(async (client) => {
      for (const p of going)
        await organisation.updateEmployee(client, p.employee_id, { department_id: to.department_id }, actor);
      for (const s of seatsGoing)
        await organisation.updateSeat(client, s.org_seat_id, { department_id: to.department_id }, actor);
    });
    log(`${going.length} people and ${seatsGoing.length} seats moved to "${m.department}"`);
    out.moved += going.length + seatsGoing.length;
  }

  /* 5. Lines. */
  for (const l of plan.lines) {
    const seat = (
      await pool.query(
        "SELECT org_seat_id FROM org_seat WHERE status <> 'closed' AND lower(btrim(title)) = lower(btrim($1)) LIMIT 1",
        [l.from_seat],
      )
    ).rows[0];
    const to = await holders(l.to_post);
    if (!seat || to.length !== 1) continue;
    const { rows: people } = await pool.query(
      `SELECT employee_id, dotted_manager_id FROM employee
        WHERE status <> 'archived' AND lower(btrim(job_title)) = lower(btrim($1)) AND line_manager_seat_id = $2`,
      [l.post, seat.org_seat_id],
    );
    for (const p of people) {
      const change = { line_manager_id: to[0].employee_id, reason: `Org chart: ${l.post} reports to ${l.to_post}` };
      if (p.dotted_manager_id === to[0].employee_id) change.dotted_manager_id = null;
      await tx((client) => organisation.setReportingLine(client, p.employee_id, change, actor));
      log(`${l.post} now reports to the ${l.to_post}`);
      out.lines += 1;
    }
  }

  /* 6. Heads. */
  for (const d of plan.departments) {
    if (!d.head) continue;
    const dept = await deptByName(d.name);
    if (!dept || dept.head_employee_id || dept.head_seat_id) continue;
    let patch = null;
    if (d.head.post) {
      const who = await holders(d.head.post);
      if (who.length === 1) patch = { head_employee_id: who[0].employee_id };
    } else if (d.head.seat) {
      const seat = (
        await pool.query(
          "SELECT org_seat_id FROM org_seat WHERE status <> 'closed' AND lower(btrim(title)) = lower(btrim($1)) LIMIT 1",
          [d.head.seat],
        )
      ).rows[0];
      if (seat) patch = { head_seat_id: seat.org_seat_id };
    }
    if (!patch) continue;
    await tx((client) => organisation.updateDepartment(client, dept.department_id, patch, actor));
    log(`"${d.name}" is headed by the ${d.head.post || d.head.seat}`);
    out.heads += 1;
  }
  return out;
}

module.exports = { FILE, fold, matcher, retitle, autoCode, readNomenclature, applyNomenclature };
