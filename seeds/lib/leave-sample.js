"use strict";
/**
 * The mock's sample leave, put on real records through the leave service (docs/guides/ess.md
 * §13 change log, F13). Shared by seeds/build/20_mock_data.js (a laptop: the mock's own people)
 * and seeds/staging/30_leave.js (staging: MyCity's real staff), so both apply a row the same way.
 *
 * A row is { key, type, from, to, days, status, reason }: `from` and `to` are days from today,
 * `type` a leave_type code, `key` whoever the caller maps it to. By status:
 *
 *   approved   recorded by Operations & People (`recorder`), approved at once
 *   submitted  asked by the person: it opens the real `leave.approval`
 *   rejected   asked by the person, then rejected in the flow by their line manager
 *   cancelled  asked by the person, then cancelled by them
 *
 * A request whose type and days need a relief officer and a handover note (docs/guides/ess.md
 * §6: Annual always, any type over its number of working days) names the first colleague the
 * form's own list offers on those days, one of the sample's people when it can, and carries a
 * one-page handover note staged as the person, as Request Leave's upload box stages it.
 *
 * Dates move forward off days that are not worked (the configured week and the public
 * holidays), and a request is kept inside the year it starts in. A row that still does not fit
 * is logged and skipped; the rest load. Nothing is added while any of these people has leave,
 * so a second run adds nothing.
 */
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * A one-page PDF reading `lines`, built by hand so a laptop without Chromium can seed it too: the
 * handover note a sample request carries.
 */
function notePdf(lines) {
  const esc = (t) => String(t).replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td (${esc(l)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** The dates a row asks for, from today: off days moved forward, kept inside one year. */
function datesOf(row, today, cal, workingWeek) {
  const starts = workingWeek.nextWorkingDay(addDays(today, row.from), cal);
  let ends = workingWeek.nextWorkingDay(addDays(today, row.to), cal);
  if (ends < starts) ends = starts;
  if (ends.slice(0, 4) !== starts.slice(0, 4)) ends = `${starts.slice(0, 4)}-12-31`;
  return { starts_on: starts, ends_on: ends };
}

/**
 * @param {object} o
 * @param {import("pg").Pool} o.pool
 * @param {Function} o.log
 * @param {Array<object>} o.rows       the sample rows
 * @param {Map<string, {employee_id: string, user: object|null, manager: object|null}>} o.people
 *   each row's key → the person, their login as req.user, and their line manager's login
 * @param {object|null} o.recorder     the Operations & People login that records approved leave
 * @param {string} o.today             ISO date
 * @returns {Promise<{added: number, skipped: number, already: number}>}
 */
async function applyLeaveSample({ pool, log, rows, people, recorder, today }) {
  const leave = require(path.join(ROOT, "src/modules/leave/leave.service"));
  const engine = require(path.join(ROOT, "src/shared/workflow/engine"));
  const workingWeek = require(path.join(ROOT, "src/shared/time/working-week"));
  const { atomically } = require(path.join(ROOT, "src/shared/db/tx"));
  const uploads = require(path.join(ROOT, "src/modules/documents/documents.service"));

  const ids = [...people.values()].map((p) => p.employee_id);

  /** The relief officer and the note a request needs, or nothing when its type and days need none. */
  async function coverFor(person, body) {
    if (!(await leave.checkSpan(body)).handover_needed) return {};
    const free = (await leave.reliefOfficers(person.employee_id, { page: 1, starts_on: body.starts_on, ends_on: body.ends_on })).data;
    const relief = free.find((p) => ids.includes(p.employee_id)) || free[0];
    if (!relief) throw new Error("nobody free to cover those days");
    const buffer = notePdf([
      "Handover note",
      `${body.starts_on} to ${body.ends_on}`,
      `Covering: ${relief.display_name}`,
      "Open work, contacts and where the files are. SAMPLE for staging.",
    ]);
    const staged = await uploads.stage({ buffer, originalname: "Handover-Note.pdf", size: buffer.length, mimetype: "application/pdf" }, { purpose: "document" }, person.user);
    return { relief_employee_id: relief.employee_id, handover_document_id: staged.document_id };
  }
  const { rows: existing } = await pool.query(
    "SELECT count(*)::int AS n FROM leave_request WHERE employee_id = ANY($1::uuid[])",
    [ids],
  );
  if (existing[0].n > 0) return { added: 0, skipped: 0, already: existing[0].n };

  const { rows: types } = await pool.query("SELECT leave_type_id, code FROM leave_type WHERE active");
  const typeId = new Map(types.map((t) => [t.code, t.leave_type_id]));
  const cal = await workingWeek.loadCalendar(pool);
  const everyone = { scope: "all", scope_ids: null, employee_id: recorder ? recorder.employee_id : null };

  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    const person = people.get(row.key);
    const dates = datesOf(row, today, cal, workingWeek);
    const body = { leave_type_id: typeId.get(row.type), ...dates, reason: row.reason || undefined };
    try {
      if (!person || !person.user) throw new Error("nobody with a login for this row");
      if (!body.leave_type_id) throw new Error(`no active leave type "${row.type}"`);
      if (row.status === "approved") {
        if (!recorder) throw new Error("Operations & People has no login to record it");
        await leave.record(recorder, everyone, { employee_id: person.employee_id, ...body });
      } else {
        const asked = await leave.request(person.user, person.employee_id, { ...body, ...(await coverFor(person, body)) });
        if (row.status === "cancelled") {
          await leave.cancelOwn(person.user, person.employee_id, asked.leave_request_id, {});
        } else if (row.status === "rejected") {
          if (!person.manager) throw new Error("no line manager with a login to reject it");
          const client = await pool.connect();
          try {
            await atomically(client, () =>
              engine.act(client, {
                instance_id: asked.workflow_instance_id,
                actor: person.manager,
                decision: "reject",
                reason: row.reason || "Team is short",
              }),
            );
          } finally {
            client.release();
          }
        }
      }
      added += 1;
    } catch (err) {
      skipped += 1;
      log(`leave: ${row.type} ${dates.starts_on} to ${dates.ends_on} (${row.status}) skipped: ${err.message}`);
    }
  }
  return { added, skipped, already: 0 };
}

/** A login as the services take it (req.user): its roles and the CEO flag. */
async function loginsOf(pool, employeeIds) {
  const { rows } = await pool.query(
    `SELECT e.employee_id, u.user_id, u.is_ceo,
            coalesce(array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS role_ids
       FROM employee e
       JOIN app_user u ON u.employee_id = e.employee_id
       LEFT JOIN user_role ur ON ur.user_id = u.user_id
      WHERE e.employee_id = ANY($1::uuid[])
      GROUP BY e.employee_id, u.user_id, u.is_ceo`,
    [employeeIds],
  );
  return new Map(
    rows.map((r) => [
      r.employee_id,
      { user_id: r.user_id, employee_id: r.employee_id, role_ids: r.role_ids, is_ceo: r.is_ceo },
    ]),
  );
}

module.exports = { applyLeaveSample, loginsOf, datesOf };
