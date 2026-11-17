"use strict";
/**
 * The Document Centre's library (docs/guides/document-centre.md §6.1 to §6.3): which of the vault's
 * documents a module gives the library, what each belongs to, and who may see it there.
 *
 * A module declares its documents beside its other files, `src/modules/<module>/<module>.library.js`,
 * found by name as a search provider is. There is no list to register in:
 *
 *   module.exports = librarySource({
 *     area: "partnerships",                           // the module key; its label is the Area filter's
 *     types: { partner_document: "Partner Document" }, // registered doc types, with the Type filter's name
 *     entity: "partner_document",                     // the entity type(s) the vault stores them against
 *     kind: "(SELECT ... )",                          // optional: a finer name for the row than its type's
 *     record: {                                       // the record the file belongs to, each SQL over `d`
 *       type: "'partner'", id: "d.entity_id", label: "(SELECT p.name ...)", ref: "(SELECT p.number ...)",
 *     },
 *     listed: "EXISTS (...)",                         // optional: only the files the record still holds
 *     expires: "(SELECT a.ends_on ...)",              // optional: when it ends, where the record says so
 *     number: "(SELECT cd.number ...)",               // optional: the row's number, where the record holds it
 *     archived: "(SELECT cd.archived_at ...)",        // optional: when the record was archived (a company document)
 *     area_label: "Company",                          // optional: the Area filter's name, where not the module's
 *     default: true,                                  // the vault's default read rule, as SQL from here
 *     // or, for an entity the module gave vault.defineAccess():
 *     reach: (client, user) => scopeFor(user, "partnerships", "view"),   // once per request
 *     readable: (reach, params) => "EXISTS (...)",                        // a condition over `d`
 *   });
 *
 * THE RULE (§6.3): the library never lists a document vault.canRead() would refuse. `readable()`
 * is the one condition the list, the figures, one document, ⌘K and the assistant's read all use.
 * A source with `default: true` gets the vault's default rule written as SQL below, line for line
 * with canRead; a source whose entity has its own rule writes that same rule as SQL. The two are
 * held together by tests/integration/library-access.test.js, in both directions, for every role.
 *
 * Every source's SQL runs inside `CASE WHEN d.doc_type = ANY(...) AND d.entity_type = ANY(...)`,
 * so a cast such as `d.entity_id::uuid` is never evaluated for another type's row: a brand slot or
 * a hash is not a uuid, and a WHERE gives no order of evaluation where a CASE does.
 *
 * Every registered doc type is accounted for: a source lists it, or NOT_IN_LIBRARY names it with
 * its reason (`unaccounted()`, held empty by a unit test). A new type must choose.
 */
const fs = require("node:fs");
const path = require("node:path");
const catalog = require("../access/access.catalog");
const grantsCache = require("../rbac/grants-cache");
const docTypes = require("./types");
const vault = require("./vault");

const MODULES_DIR = path.resolve(__dirname, "../../modules");
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const TYPE_RE = /^[a-z][a-z0-9_]{1,63}$/;

/** A library row is a file that can be opened now: current, scanned clean (or never needing a scan), drawn. */
const BASE = "d.is_current AND d.scan_status IN ('clean', 'skipped') AND COALESCE(d.render_status, 'done') = 'done'";

/**
 * Doc types the library never lists, each with why (§6.2). Exports and transient types are left
 * out by their own flags and need no line here.
 */
const NOT_IN_LIBRARY = Object.freeze({
  payslip: "payslips stay on Payroll · Payslips and ESS · My Payslips (D4)",
  staged_upload: "an upload no record has claimed yet",
  import_source: "a spreadsheet an import read, kept with its batch",
  community_media: "a chat's file, for the people in that conversation",
  link_preview_image: "a link card's picture",
  mail_attachment: "a mail's attachment, for the mailbox it arrived in",
  mail_signature_image: "a picture inside an email signature",
  employee_photo: "a profile photo",
  leave_handover: "a leave request's handover note, for its person, relief officer and approvers (ess.md §8)",
  brand_image: "a brand file of Settings · Organisation",
  signature_image: "a drawn signature, part of the document it signed",
  query_signature: "a drawn signature, part of the letter it signed",
  policy_signature: "a drawn signature, part of the policy it signed",
  training_signature: "a publisher's signature on a course",
  proposal_asset: "a picture inside a proposal",
  proposal_source: "a meeting transcript a proposal was drafted from",
  proof_point_image: "a proof point's picture",
  candidate_cv: "not yet a source (guide §13, question 1)",
  assessment_answer: "not yet a source (guide §13, question 1)",
  interview_assessment_form: "not yet a source (guide §13, question 1)",
  performance_evidence: "not yet a source (guide §13, question 1)",
  review_dictation: "a review's dictation, part of the review",
  review_summary: "not yet a source (guide §13, question 1)",
  home_report: "not yet a source (guide §13, question 1)",
  training_material: "not yet a source (guide §13, question 1)",
  training_proof: "not yet a source (guide §13, question 1)",
});

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const list = (values) => `ARRAY[${values.map(quote).join(", ")}]::text[]`;

/**
 * Declare what one module gives the library.
 * @param {object} spec  see the header
 */
function librarySource(spec) {
  const where = `librarySource(${spec && spec.area})`;
  if (!spec || !catalog.isModule(spec.area)) throw new Error(`${where}: area is a module key`);
  const types = Object.entries(spec.types || {});
  if (types.length === 0) throw new Error(`${where}: types is { doc_type: "Label" }`);
  for (const [docType, label] of types) {
    if (!TYPE_RE.test(docType) || typeof label !== "string" || !label.trim())
      throw new Error(`${where}: "${docType}" needs a label`);
    const registered = docTypes.typeOf(docType);
    if (!registered) throw new Error(`${where}: "${docType}" is not a registered document type`);
    if (registered.export || registered.transient)
      throw new Error(`${where}: "${docType}" is kept a day or a request, never listed`);
    if (Object.prototype.hasOwnProperty.call(NOT_IN_LIBRARY, docType))
      throw new Error(`${where}: "${docType}" is named in NOT_IN_LIBRARY; take it off there first`);
    if (spec.default === true && !registered.module)
      throw new Error(`${where}: "${docType}" has no module, so the default rule cannot be written for it`);
  }
  const entities = [].concat(spec.entity || []);
  if (entities.length === 0 || entities.some((e) => !NAME_RE.test(String(e))))
    throw new Error(`${where}: entity names the entity type(s) its documents are stored against`);
  const custom = typeof spec.reach === "function" || typeof spec.readable === "function";
  if (spec.default === true ? custom : !(typeof spec.reach === "function" && typeof spec.readable === "function"))
    throw new Error(`${where}: give default: true, or reach and readable together`);
  const record = spec.record || null;
  if (record)
    for (const key of ["type", "id", "label"])
      if (typeof record[key] !== "string" || !record[key].trim()) throw new Error(`${where}: record.${key} is SQL over d`);
  return Object.freeze({
    area: spec.area,
    types: Object.freeze(Object.fromEntries(types.map(([t, l]) => [t, l.trim()]))),
    doc_types: Object.freeze(types.map(([t]) => t)),
    entities: Object.freeze(entities.slice()),
    kind: typeof spec.kind === "string" && spec.kind.trim() ? spec.kind : null,
    record: record ? Object.freeze({ type: record.type, id: record.id, label: record.label, ref: record.ref || "NULL" }) : null,
    listed: typeof spec.listed === "string" && spec.listed.trim() ? spec.listed : null,
    expires: typeof spec.expires === "string" && spec.expires.trim() ? spec.expires : null,
    number: typeof spec.number === "string" && spec.number.trim() ? spec.number : null,
    archived: typeof spec.archived === "string" && spec.archived.trim() ? spec.archived : null,
    area_label: typeof spec.area_label === "string" && spec.area_label.trim() ? spec.area_label.trim() : null,
    default: spec.default === true,
    reach: spec.default === true ? null : spec.reach,
    readable: spec.default === true ? null : spec.readable,
  });
}

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

let cached = null;

/** Non-empty `*.library.js` files, in a stable order. */
function discover(dir = MODULES_DIR) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || !NAME_RE.test(e.name)) continue;
    for (const f of fs.readdirSync(path.join(dir, e.name)).sort()) {
      const full = path.join(dir, e.name, f);
      if (f.endsWith(".library.js") && fs.statSync(full).size > 0) out.push(full);
    }
  }
  return out;
}

/** Load every source under `dir`. Two sources claiming one doc type is a load error. */
function load({ dir = MODULES_DIR } = {}) {
  const all = [];
  const seen = new Map();
  for (const file of discover(dir)) {
    const rel = path.relative(path.resolve(dir, ".."), file).split(path.sep).join("/");
    const exported = require(file);
    for (const s of Array.isArray(exported) ? exported : [exported]) {
      if (!s || !Array.isArray(s.doc_types) || !s.area) throw new Error(`${rel}: export librarySource({ ... }) (or an array of them)`);
      for (const t of s.doc_types) {
        if (seen.has(t)) throw new Error(`library type "${t}" is declared by both ${seen.get(t)} and ${rel}`);
        seen.set(t, rel);
      }
      // A source's rule and the vault's must be the same kind: a default source's entities have no
      // rule of their own, and a source with its own rule has one for every entity it names.
      for (const e of s.entities) {
        if (s.default === vault.hasAccess(e))
          throw new Error(
            s.default
              ? `${rel}: the vault has its own read rule for "${e}"; write it as reach and readable`
              : `${rel}: the vault has no read rule for "${e}"; use default: true`,
          );
      }
      all.push(Object.freeze({ ...s, file: rel }));
    }
  }
  cached = all;
  return all;
}

/** Every source. */
const sources = () => cached || load();

/** Tests: forget what was loaded. */
function reset() {
  cached = null;
}

/** Registered doc types that no source lists and NOT_IN_LIBRARY does not name. A test holds this empty. */
function unaccounted() {
  const listed = new Set(sources().flatMap((s) => s.doc_types));
  return docTypes
    .all()
    .filter((t) => !t.export && !t.transient && !listed.has(t.doc_type) && !Object.prototype.hasOwnProperty.call(NOT_IN_LIBRARY, t.doc_type))
    .map((t) => t.doc_type);
}

/* ------------------------------------------------------------------ *
 * Who sees a row
 * ------------------------------------------------------------------ */

const scopeFromGrants = (...args) => require("../../middleware/rbac").scopeFromGrants(...args);

/** What one module's grant gives the reader under the vault's default rule. */
async function moduleReach(client, user, module) {
  const rows = await grantsCache.getGrants(client, { role_ids: user.role_ids || [], module });
  const view = scopeFromGrants(rows, "view");
  return {
    view,
    edit: Boolean(scopeFromGrants(rows, "edit")),
    team: view === "team" ? await grantsCache.getTeamEmployeeIds(client, user.employee_id) : null,
  };
}

/**
 * Work out, once per request, what the reader can reach: each default source's module grant and
 * each other source's own reach.
 * @param {{query: Function}} client
 * @param {{user_id: string, employee_id?: string|null, role_ids?: string[], is_ceo?: boolean}} user
 */
async function reach(client, user) {
  const who = { user_id: user.user_id, employee_id: user.employee_id || null, is_ceo: user.is_ceo === true };
  const modules = new Map();
  const own = new Map();
  for (const s of sources()) {
    if (!s.default) {
      own.set(s, await s.reach(client, user));
      continue;
    }
    if (who.is_ceo) continue;
    for (const t of s.doc_types) {
      const module = docTypes.typeOf(t).module;
      if (!modules.has(module)) modules.set(module, await moduleReach(client, user, module));
    }
  }
  return { user: who, modules, own };
}

/** The vault's default rule for one module's documents, as SQL over `d` (vault.canRead, line for line). */
function defaultReadable(who, grant, bind) {
  // The CEO; the employee it is about; whoever uploaded it.
  if (who.is_ceo) return "TRUE";
  const parts = [];
  if (who.employee_id) parts.push(`d.subject_employee_id = ${bind(who.employee_id)}::uuid`);
  parts.push(`d.uploaded_by = ${bind(who.user_id)}::uuid`);
  // Otherwise the module's `view` grant, within scope; a restricted document also needs `edit`.
  if (grant && grant.view) {
    let seen = null;
    if (grant.view === "all") seen = "TRUE";
    else if (grant.view === "team") seen = `d.subject_employee_id = ANY(${bind(grant.team || [])}::uuid[])`;
    // `own` adds nothing: the subject's own document is already read above.
    if (seen) parts.push(grant.edit ? seen : `(d.sensitivity <> 'restricted' AND ${seen})`);
  }
  return `(${parts.join(" OR ")})`;
}

/** One source's condition for this reader: SQL over `d`, or "FALSE" when they reach none of it. */
function sourceCondition(s, r, params, bind, listed = true) {
  let cond;
  if (!s.default) {
    // A reach of nothing (no grant on the module) reaches nothing; the source is not asked.
    const own = r.own.get(s);
    cond = own === null || own === undefined ? "FALSE" : s.readable(own, params) || "FALSE";
  } else {
    // One source's types share a module in practice; where they do not, each is read by its own.
    const byModule = new Map();
    for (const t of s.doc_types) {
      const m = docTypes.typeOf(t).module;
      if (!byModule.has(m)) byModule.set(m, []);
      byModule.get(m).push(t);
    }
    const parts = [...byModule].map(([m, types]) => {
      const rule = defaultReadable(r.user, r.modules.get(m) || null, bind);
      return byModule.size === 1 ? rule : `(d.doc_type = ANY(${list(types)}) AND ${rule})`;
    });
    cond = parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
  }
  if (cond === "FALSE") return "FALSE";
  return listed && s.listed ? `(${cond}) AND (${s.listed})` : cond;
}

const guard = (s) => `d.doc_type = ANY(${list(s.doc_types)}) AND d.entity_type = ANY(${list(s.entities)})`;

/**
 * The condition a library row passes for this reader, appending its parameters to `params`:
 * a file that can be opened, of a type the library holds, readable by its source's rule.
 * @param {Awaited<ReturnType<typeof reach>>} r
 * @param {Array} params
 * @param {{listed?: boolean}} [opts]  listed false leaves out each source's `listed` narrowing: the read
 *                                     rule alone, as the access test compares it with vault.canRead
 * @returns {{sql: string, sources: object[]}}  the SQL, and the sources the reader reaches at all
 */
function readable(r, params, { listed = true } = {}) {
  const bound = new Map();
  const bind = (value) => {
    const key = JSON.stringify(value);
    if (!bound.has(key)) {
      params.push(value);
      bound.set(key, `$${params.length}`);
    }
    return bound.get(key);
  };
  const branches = [];
  const reached = [];
  for (const s of sources()) {
    const cond = sourceCondition(s, r, params, bind, listed);
    if (cond === "FALSE") continue;
    reached.push(s);
    branches.push(`WHEN ${guard(s)} THEN (${cond})`);
  }
  if (branches.length === 0) return { sql: "FALSE", sources: [] };
  return { sql: `${BASE} AND (CASE ${branches.join(" ")} ELSE FALSE END)`, sources: reached };
}

/* ------------------------------------------------------------------ *
 * What a row shows
 * ------------------------------------------------------------------ */

/** A value per source, as one CASE over `d`; a source that gives none answers NULL. */
function perSource(pick) {
  const branches = sources()
    .map((s) => [s, pick(s)])
    .filter(([, sql]) => sql)
    .map(([s, sql]) => `WHEN ${guard(s)} THEN (${sql})::text`);
  return branches.length ? `(CASE ${branches.join(" ")} ELSE NULL END)` : "NULL::text";
}

/** A fixed word per doc type, as one CASE. */
function perType(pick) {
  const branches = sources().flatMap((s) => s.doc_types.map((t) => `WHEN ${quote(t)} THEN ${quote(pick(s, t))}`));
  return branches.length ? `(CASE d.doc_type ${branches.join(" ")} ELSE NULL END)` : "NULL::text";
}

const moduleLabel = (area) => (catalog.MODULE_META[area] ? catalog.MODULE_META[area].label : area);
/** The Area filter's name for a source: its own, else its module's. */
const areaLabel = (s) => s.area_label || moduleLabel(s.area);

/**
 * The SQL of what a row shows, each an expression over `d`: the type's name (a source's finer
 * `kind` where it has one), the area, the record it belongs to, and when it ends.
 */
function columns() {
  const fixed = perType((s, t) => s.types[t]);
  return {
    type_label: `COALESCE(${perSource((s) => s.kind)}, ${fixed})`,
    area: perType((s) => s.area),
    area_label: perType((s) => areaLabel(s)),
    record_type: perSource((s) => s.record && s.record.type),
    record_id: perSource((s) => s.record && s.record.id),
    record_label: perSource((s) => s.record && s.record.label),
    record_ref: perSource((s) => s.record && s.record.ref),
    // When it ends: the record's own date where its source gives one (an agreement's term), else the file's.
    expires_on: `COALESCE(${perSource((s) => s.expires)}::date, d.expires_on)`,
    // The row's number: the record's own where its source gives one (a company document's DOC-0001), else the file's.
    number: `COALESCE(${perSource((s) => s.number)}, d.number)`,
    // When the record was archived, where its source can be (a company document); NULL for every other row.
    archived_at: `(${perSource((s) => s.archived)})::timestamptz`,
  };
}

/** The types and areas of the given sources, for the Area and Type filters. */
function options(from = sources()) {
  const areas = [];
  const types = [];
  for (const s of from) {
    if (!areas.some((a) => a.area === s.area)) areas.push({ area: s.area, label: areaLabel(s) });
    for (const t of s.doc_types) types.push({ doc_type: t, label: s.types[t], area: s.area });
  }
  const order = catalog.MODULES;
  areas.sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  types.sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area) || a.label.localeCompare(b.label));
  return { areas, types };
}

/* ------------------------------------------------------------------ *
 * SQL a source's record often needs
 * ------------------------------------------------------------------ */

/** An employee's name, by an expression giving their id. */
const employeeName = (id) => `(SELECT trim(e.first_name || ' ' || e.last_name) FROM employee e WHERE e.employee_id = ${id})`;

/** An employee's staff number, by an expression giving their id. */
const staffNumber = (id) => `(SELECT e.staff_number::text FROM employee e WHERE e.employee_id = ${id})`;

module.exports = {
  MODULES_DIR,
  employeeName,
  staffNumber,
  BASE,
  NOT_IN_LIBRARY,
  librarySource,
  discover,
  load,
  sources,
  reset,
  unaccounted,
  reach,
  readable,
  columns,
  options,
};
