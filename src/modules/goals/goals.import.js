"use strict";
/**
 * The OKR workbook importer, `okr_workbook` (docs/guides/performance.md §6.19): MyCity uploads its
 * quarter's OKR workbook as it is, and each key result of the Company OKRs sheet and of every
 * function sheet is a row, written through goals.okrs.importKeyResult into the active quarter (or
 * the one being planned).
 *
 * What this file knows that a form does not:
 *
 *  - **The function by its sheet.** A sheet is named after its department (P4); Company OKRs is
 *    the company's.
 *  - **Owners in prose.** "Chinyere Elechi" is a person; "Technology & Back-office Ops" is that
 *    function's head; "CEO (Ifeoma Mbonu)" and "CEO with interim finance owner" are the CEO;
 *    "A (journey) / B (inventory)" is an owner and a co-owner. What matches nobody is kept as the
 *    owner note.
 *  - **The type in words.** "Diagnostic gate — retires on sign-off" is a diagnostic gate; gates,
 *    enabling and output key results are scored as dated, the rest as numeric.
 *  - **[TBC]** in the key result or its baseline marks a provisional target.
 *  - **Initiatives** are bullet lines ending in a date ("— 15 Oct", "— CEO, 31 Oct"); each dated
 *    one becomes a task for the owner, linked to the key result.
 *  - **The latest report.** Status, Actual and Update are the latest scored month's (the month
 *    just ended when none is scored yet); each month's score is its proposed score. A month
 *    imported again keeps what was reported in the app that the workbook leaves blank.
 *  - **Scored From** on a company key result names a function key result further down the file,
 *    so it is linked in the second pass.
 *  - **Former IDs** from the change map are kept as aliases, so a scorecard naming OP-KR2.2 finds
 *    TBO-KR3.3.
 */
const c = require("@mycity/contract");
const { defineImporter } = require("../../shared/import/registry");
const { AppError } = require("../../shared/errors");
const { scopeFor } = require("../../middleware/rbac");
const lagos = require("../../shared/time/lagos");
const organisation = require("../organisation/organisation.service");
const workbook = require("./goals.workbook");
const plans = require("./goals.plans");
const periods = require("./goals.periods");
const repo = require("./goals.repo");
const okrs = require("./goals.okrs");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TYPES = [
  [/^diagnostic gate/i, "diagnostic_gate"],
  [/^visibility gate/i, "visibility_gate"],
  [/^compliance\b.*retir/i, "compliance_retiring"],
  [/^compliance/i, "compliance_floor"],
  [/^enabling/i, "enabling"],
  [/^output/i, "output"],
  [/^outcome/i, "outcome"],
];
const DATED = new Set(["diagnostic_gate", "visibility_gate", "enabling", "output", "compliance_retiring"]);
const STATUSES = [
  [/^not started/i, "not_started"],
  [/^on track/i, "on_track"],
  [/^at risk/i, "at_risk"],
  [/^off track|^behind/i, "off_track"],
  [/^(done|complete|achieved|met)\b/i, "done"],
  [/^missed/i, "missed"],
];
const TBC = /\[TBC\]/i;

/** The quarter imports write into, with its three months. */
async function importPeriod(db) {
  const id = await repo.importPeriodId(db);
  if (!id) throw new AppError("NO_QUARTER", "Set up the quarter before importing its plan", 409);
  const period = await plans.periodOf(db, id);
  const startsOn = period.starts_on instanceof Date ? period.starts_on.toISOString().slice(0, 10) : String(period.starts_on).slice(0, 10);
  return { ...period, starts_on: startsOn, months: periods.monthsOf(startsOn) };
}

const typeOf = (text) => (TYPES.find(([re]) => re.test(text || "")) || [])[1] || null;
const statusOf = (text) => (STATUSES.find(([re]) => re.test(text || "")) || [])[1] || null;

/** "15 Oct" → the date in the quarter's plan year (a January after an October quarter is the next year). */
function dateIn(text, period) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\b(?:\s+(\d{4}))?/.exec(text || "");
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  if (!month) return null;
  const start = new Date(`${String(period.starts_on).slice(0, 10)}T00:00:00Z`);
  let year = m[3] ? Number(m[3]) : start.getUTCFullYear();
  if (!m[3] && month < start.getUTCMonth() + 1 - 3) year += 1;
  const d = new Date(Date.UTC(year, month - 1, Number(m[1])));
  return d.getUTCMonth() === month - 1 ? d.toISOString().slice(0, 10) : null;
}

/** The bullet lines of an Initiatives cell that end in a date, as tasks to set. */
function initiativesOf(text, period) {
  const out = [];
  for (const raw of String(text || "").split(/\n+/)) {
    const line = raw.replace(/^[\s•·\-*]+/, "").trim();
    const at = line.lastIndexOf(" — ");
    if (!line || at < 0) continue;
    const due = dateIn(line.slice(at + 3), period);
    const title = line.slice(0, at).trim().slice(0, 200);
    if (due && title) out.push({ title, due_on: due });
  }
  return out;
}

/** How many single-letter edits turn one word into another. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const here = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = here;
    }
  }
  return row[b.length];
}

const letters = (v) => String(v || "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * An employee by name as a workbook spells it: exactly, else the one person with that first name
 * whose surname is at most two letters out ("Iyersehen" for Iyeserhen). Two near matches are none.
 */
async function personByName(db, name) {
  const exact = await repo.employeeByName(db, name);
  if (exact) return exact;
  const words = String(name || "").trim().split(/\s+/);
  if (words.length < 2) return null;
  const last = letters(words.at(-1));
  const near = (await repo.employeesByFirstName(db, words[0])).filter((e) => distance(letters(e.last_name), last) <= 2);
  return near.length === 1 ? { employee_id: near[0].employee_id } : null;
}

/** One owner as written: a person, a function's head, or the CEO. */
async function personOf(client, part) {
  const inside = (/\(([^)]*)\)/.exec(part) || [])[1] || "";
  const bare = part.replace(/\([^)]*\)/g, "").trim();
  if (/^CEO\b/i.test(bare)) return (inside && (await personByName(client, inside)))?.employee_id || repo.ceoEmployeeId(client);
  const dept = await repo.departmentByName(client, bare);
  if (dept) return organisation.headOf(client, dept.department_id);
  return (await personByName(client, bare))?.employee_id || null;
}

/** The owner cell: the owner, a co-owner after " / ", and the words when nobody matches. */
async function ownersOf(client, text) {
  if (!text) return { accountable_employee_id: null, co_accountable_employee_id: null, accountable_note: null };
  const [first, second] = text.split(/\s+\/\s+/);
  const owner = await personOf(client, first);
  const co = second ? await personOf(client, second) : null;
  return {
    accountable_employee_id: owner,
    co_accountable_employee_id: co && co !== owner ? co : null,
    accountable_note: owner && (!second || co) ? null : text.slice(0, 300),
  };
}

/**
 * The month a report written today is for: the month just ended, within the quarter (its first
 * month before the quarter's second has begun, its last once the quarter is over).
 */
function reportingMonth(period, today = lagos.today()) {
  const months = (period.months || []).map((m) => String(m).slice(0, 10));
  return months.filter((m) => m < `${today.slice(0, 7)}-01`).at(-1) || months[0];
}

/** The months a row reports: each scored month, and the latest report in the latest scored month. */
function monthsOf(values, period) {
  const months = (period.months || []).map((m) => String(m).slice(0, 10));
  const scores = [values.october, values.november, values.december];
  const out = new Map();
  // A month's status is the workbook's only where its Status cell says it (`status_given`); else a
  // new month starts On Track (scored) or Not Started, and a month already reported keeps its own.
  months.forEach((m, i) => {
    if (scores[i] !== undefined) out.set(m, { month: m, status: "on_track", status_given: false, proposed_score: scores[i] });
  });
  const latest = [...out.keys()].at(-1) || reportingMonth(period);
  const status = statusOf(values.status);
  if (latest && (status || values.actual || values.update)) {
    const at = out.get(latest) || { month: latest, proposed_score: null };
    out.set(latest, {
      ...at,
      status: status || at.status || "not_started",
      status_given: Boolean(status),
      actual_text: values.actual || null,
      update_text: values.update || null,
    });
  }
  return [...out.values()].map((m) => ({ actual_text: null, update_text: null, ...m, status: m.status || "not_started" }));
}

/** Every written key result, keyed for the engine's preview of what changed. */
async function find(client, { value }) {
  const id = await repo.importPeriodId(client);
  const hit = id && (await repo.keyResultByOwnCode(client, id, value));
  return hit ? { id: hit.okr_key_result_id, values: { code: value } } : null;
}

const FIELDS = [
  { key: "function", label: "Function", required: true, example: "Branding & Marketing" },
  { key: "objective_code", label: "Objective ID", required: true, example: "BM-O1" },
  { key: "objective", label: "Objective", required: true, max: 500 },
  { key: "code", label: "KR ID", required: true, example: "BM-KR1.1" },
  { key: "statement", label: "Key Result", required: true, max: 1000 },
  { key: "kr_type", label: "Type" },
  { key: "accountable", label: "Accountable" },
  { key: "linked", label: "Linked Company KRs" },
  { key: "baseline", label: "Baseline", max: 1000 },
  { key: "starts_on", label: "Start", type: "date" },
  { key: "finishes_on", label: "Finish", type: "date" },
  { key: "initiatives", label: "Initiatives", max: 6000 },
  { key: "scored_from", label: "Scored From", type: "reference", ref: "key_result", pass: 2 },
  { key: "status", label: "Status" },
  { key: "actual", label: "Actual", max: 1000 },
  { key: "update", label: "Update", max: 4000 },
  { key: "october", label: "October", type: "number" },
  { key: "november", label: "November", type: "number" },
  { key: "december", label: "December", type: "number" },
  { key: "former_codes", label: "Former IDs" },
];

defineImporter({
  key: "okr_workbook",
  label: "OKR Workbook",
  permission: ["performance", "create"],
  capability: "performance.manage",
  entity: "key_result",
  schema: c.goals.OkrWorkbookRow,
  matchKeys: ["code"],
  fields: FIELDS,
  extract: workbook.extractKeyResults,
  find,

  async resolve(client, field, value) {
    const id = await repo.importPeriodId(client);
    return (id && (await repo.keyResultByCode(client, id, value))?.okr_key_result_id) || null;
  },

  async write(client, values, ctx) {
    const period = await importPeriod(client);
    let departmentId = null;
    if (values.function !== workbook.COMPANY) {
      const dept = await repo.departmentByName(client, values.function);
      if (!dept)
        throw new AppError("VALIDATION_FAILED", `No function is called ${values.function}`, 422, { function: ["Not a function"] });
      departmentId = dept.department_id;
    }
    const links = [];
    for (const code of workbook.codesIn(values.linked)) {
      if (!/-KR/.test(code) || !code.startsWith("CO-") || departmentId === null) continue;
      const hit = await repo.keyResultByCode(client, period.performance_period_id, code);
      if (hit) links.push(hit.okr_key_result_id);
    }
    const type = typeOf(values.kr_type);
    return okrs.importKeyResult(
      client,
      ctx.actor,
      {
        performance_period_id: period.performance_period_id,
        department_id: departmentId,
        objective_code: values.objective_code,
        objective_title: values.objective,
        code: values.code,
        statement: values.statement,
        kr_type: type,
        measure: DATED.has(type) ? "dated" : "numeric",
        baseline_text: values.baseline || null,
        target_provisional: TBC.test(values.statement) || TBC.test(values.baseline || ""),
        starts_on: values.starts_on || null,
        finishes_on: values.finishes_on || null,
        ...(await ownersOf(client, values.accountable)),
        linked_company_key_result_ids: links,
        former_codes: workbook.codesIn(values.former_codes),
        months: monthsOf(values, period),
        initiatives: initiativesOf(values.initiatives, period),
      },
      { task_scope: await scopeFor(ctx.actor, "workspace", "create") },
    );
  },

  link: (client, id, refs, ctx) => okrs.importScoredFrom(client, ctx.actor, id, refs.scored_from),
  // A key result a scorecard line, a target change or a confirmed score now rests on stays.
  isReferenced: (client, id) => repo.keyResultInUse(client, id),
  archive: (client, id, ctx) => okrs.removeImported(client, ctx.actor, id),
  // A key result an import changed stays as it is now: the workbook holds no before-image to put back.
  restore: async () => undefined,
});

module.exports = { FIELDS, personByName, distance, typeOf, statusOf, dateIn, initiativesOf, ownersOf, monthsOf, reportingMonth, importPeriod };
