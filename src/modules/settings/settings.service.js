"use strict";
/**
 * Settings: the values every module reads, and the one write path for each
 * (docs/guides/foundation.md, track C).
 *
 *   organisation   the company's profile, one setting row per field, entered on
 *                  screen and never seeded
 *   working week   Monday to Sunday (A22); attendance, leave and SLAs read it
 *                  through shared/time/working-week, whose cache is cleared here
 *   holidays       Nigeria's seeded for 2026 and 2027 (seeds/reference/0448), the
 *                  moon-dated and weekend ones expected until saved here, which confirms
 *                  them; others entered on screen; the same calendar
 *   numbering      a scheme per numbered document type; a change applies to the
 *                  next number, never to one already issued
 *   security       session length, idle lock and password minimum within the .env
 *                  floor (settings.security-rules.js), two-step by role (access)
 *
 * Every change runs in one transaction with emit(): settings.changed for the Audit
 * Log, settings.security_changed for a security rule, which also tells the watchers.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const numbering = require("../../shared/numbering/numbering");
const { SCHEMES, DOC_TYPES, validateScheme } = require("../../shared/numbering/schemes");
const lagos = require("../../shared/time/lagos");
const vault = require("../../shared/documents/vault");
const organisationProfile = require("../../shared/organisation/profile");
const places = require("../../shared/places/places");
const workingWeek = require("../../shared/time/working-week");
const access = require("../access/access.service");
const policy = require("../identity/identity.session-policy");
const rules = require("./settings.security-rules");
const repo = require("./settings.repo");
const { EVENTS } = require("./settings.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "Not found", 404);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ *
 * Organisation
 * ------------------------------------------------------------------ */

const PROFILE_FIELDS = organisationProfile.FIELDS;
/** The company's address field (shared/places/owners.js). */
const ADDRESS = "organisation.address";
const { keyOf, BRAND } = organisationProfile;

async function profileOf(db) {
  const all = await organisationProfile.readProfile(db);
  return Object.fromEntries(PROFILE_FIELDS.map((f) => [f, all[f]]));
}

/** What an upload answers with, and each brand file on the profile. */
const refOf = (doc) => ({
  document_id: doc.document_id,
  file_name: doc.original_name || doc.title || "upload",
  size_bytes: Number(doc.bytes) || 0,
  mime_type: doc.mime,
});

/** The three brand files (foundation.md §6.11), each a DocumentRef or null. */
async function brandOf(db) {
  const all = await organisationProfile.readProfile(db);
  const out = {};
  for (const [slot, field] of Object.entries(BRAND)) {
    const doc = all[field] ? await vault.get(db, all[field]) : null;
    out[slot] = doc ? refOf(doc) : null;
  }
  return out;
}

/** GET /settings/organisation */
async function organisation() {
  return {
    ...(await profileOf(pool)),
    address_place: await places.view(pool, ADDRESS, "organisation"),
    ...(await brandOf(pool)),
    currency: "NGN",
    time_zone: "Africa/Lagos",
  };
}

/**
 * POST /settings/organisation/brand/:slot: the file becomes that brand file at once. The old
 * document stays in the vault, as every replaced file does; the next letter, system mail and
 * signature use the new one.
 */
async function uploadBrand(slot, file, actor) {
  if (!file) throw new AppError("FILE_REQUIRED", "Choose a file to upload", 422, { file: ["Choose a file"] });
  return tx(async (client) => {
    const field = BRAND[slot];
    const before = (await organisationProfile.readProfile(client))[field];
    const doc = await vault.store(client, {
      file,
      purpose: "brand",
      doc_type: "brand_image",
      entity: { type: "brand", id: slot },
      title: slot,
      actor,
    });
    await repo.putSetting(client, keyOf(field), doc.document_id, actor.user_id);
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "setting", id: "organisation" },
      actor,
      before: { [field]: before },
      after: { [field]: doc.document_id },
      payload: { area: "organisation", brand: slot },
    });
    return refOf(doc);
  });
}

/** DELETE /settings/organisation/brand/:slot: back to the drawn pin and the company's name. */
async function removeBrand(slot, actor) {
  await tx(async (client) => {
    const field = BRAND[slot];
    const before = (await organisationProfile.readProfile(client))[field];
    if (!before) return;
    await repo.putSetting(client, keyOf(field), null, actor.user_id);
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "setting", id: "organisation" },
      actor,
      before: { [field]: before },
      after: { [field]: null },
      payload: { area: "organisation", brand: slot },
    });
  });
  return organisation();
}

/** PATCH /settings/organisation: the fields sent, each set or cleared. */
async function updateOrganisation(patch, actor) {
  await tx(async (client) => {
    const before = await profileOf(client);
    const after = { ...before };
    for (const f of PROFILE_FIELDS)
      if (f !== "address" && patch[f] !== undefined) after[f] = patch[f] === "" ? null : patch[f];
    // The address is a place, kept through shared/places; the profile keeps its line (F27).
    if (patch.address === null) {
      await places.remove(client, ADDRESS, "organisation");
      after.address = null;
    } else if (patch.address !== undefined) {
      after.address = (await places.save(client, ADDRESS, "organisation", patch.address)).line;
    }
    if (same(before, after)) return;
    for (const f of PROFILE_FIELDS)
      if (before[f] !== after[f]) await repo.putSetting(client, keyOf(f), after[f], actor.user_id);
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "setting", id: "organisation" },
      actor,
      before,
      after,
      payload: { area: "organisation" },
    });
  });
  return organisation();
}

/* ------------------------------------------------------------------ *
 * The working week
 * ------------------------------------------------------------------ */

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Seven days, Monday first; a day with no row is a day off. */
function fullWeek(rows) {
  return [1, 2, 3, 4, 5, 6, 7].map(
    (weekday) =>
      rows.find((r) => r.weekday === weekday) || { weekday, is_working_day: false, starts_at: null, ends_at: null },
  );
}

/** GET /settings/working-week */
async function week() {
  return { days: fullWeek(await repo.workingWeek(pool)) };
}

/** PUT /settings/working-week: all seven days together. */
async function saveWeek(body, actor) {
  const days = [...body.days].sort((a, b) => a.weekday - b.weekday);
  await tx(async (client) => {
    const before = fullWeek(await repo.workingWeek(client, { lock: true }));
    if (same(before, days)) return;
    for (const d of days) await repo.putDay(client, d);
    const text = (list) =>
      Object.fromEntries(
        list.map((d) => [DAY_NAMES[d.weekday - 1], d.is_working_day ? `${d.starts_at} to ${d.ends_at}` : "Not worked"]),
      );
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "working_week", id: "week" },
      actor,
      before: text(before),
      after: text(days),
      payload: { area: "working_week" },
    });
  });
  workingWeek.invalidateCalendar();
  return week();
}

/* ------------------------------------------------------------------ *
 * Public holidays
 * ------------------------------------------------------------------ */

/** GET /settings/holidays */
const holidays = (query) => repo.holidayPage(pool, query);

const dateTaken = (h) =>
  new AppError("HOLIDAY_EXISTS", `${h.name} is already on that date.`, 409, { holiday_date: ["Already a holiday"] });

/** POST /settings/holidays */
async function addHoliday(body, actor) {
  const row = await tx(async (client) => {
    const clash = await repo.holidayOn(client, body.holiday_date);
    if (clash) throw dateTaken(clash);
    const created = await repo.insertHoliday(client, body);
    if (!created) throw dateTaken({ name: "Another holiday" });
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "public_holiday", id: created.public_holiday_id },
      actor,
      after: { holiday_date: created.holiday_date, name: created.name },
      payload: { area: "holidays" },
    });
    return created;
  });
  workingWeek.invalidateCalendar();
  return row;
}

/** PATCH /settings/holidays/:id */
async function updateHoliday(id, body, actor) {
  const row = await tx(async (client) => {
    const before = await repo.findHoliday(client, id, { lock: true });
    if (!before) throw notFound();
    const clash = await repo.holidayOn(client, body.holiday_date, id);
    if (clash) throw dateTaken(clash);
    if (before.holiday_date === body.holiday_date && before.name === body.name && !before.expected) return before;
    const after = await repo.updateHoliday(client, id, body);
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "public_holiday", id },
      actor,
      before: { holiday_date: before.holiday_date, name: before.name, expected: before.expected },
      after: { holiday_date: after.holiday_date, name: after.name, expected: after.expected },
      payload: { area: "holidays" },
    });
    return after;
  });
  workingWeek.invalidateCalendar();
  return row;
}

/** DELETE /settings/holidays/:id */
async function removeHoliday(id, actor) {
  await tx(async (client) => {
    const before = await repo.findHoliday(client, id, { lock: true });
    if (!before) throw notFound();
    await repo.deleteHoliday(client, id);
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "public_holiday", id },
      actor,
      before: { holiday_date: before.holiday_date, name: before.name },
      payload: { area: "holidays" },
    });
  });
  workingWeek.invalidateCalendar();
}

/* ------------------------------------------------------------------ *
 * Numbering
 * ------------------------------------------------------------------ */

/** What each numbered document type is called on screen. */
const DOC_LABELS = Object.freeze({
  employee: "Staff Number",
  document: "Document",
  import_batch: "Import",
  report_run: "Report Run",
  location_request: "Work Location Request",
  field_assignment: "Field Assignment",
  temporary_site: "Temporary Site",
  policy: "Policy",
  query: "Query",
  sanction: "Sanction",
  letter: "Letter",
  vacancy: "Vacancy",
  offer: "Offer Letter",
  contract: "Employment Contract",
  payroll_run: "Payroll Run",
  payslip: "Payslip",
  proposal: "Proposal",
  mou: "MOU",
  expense: "Expense Request",
  requisition: "Requisition",
  disbursement: "Disbursement",
});

/** The year and the year and month of today, in Lagos. */
function periodNow() {
  const today = lagos.today();
  return { year: today.slice(0, 4), month: today.slice(0, 7) };
}

/** A scheme row as the screen shows it, with the next number it would give today. */
function schemeOut(row, period) {
  const scheme = {
    prefix: row.prefix,
    padding: Number(row.padding),
    separator: row.separator,
    reset: row.reset,
    include_period: row.include_period,
  };
  const p = scheme.reset === "never" ? "all" : scheme.reset === "yearly" ? period.year : period.month;
  return {
    doc_type: row.doc_type,
    label: DOC_LABELS[row.doc_type] || row.doc_type,
    ...scheme,
    next: numbering.format(scheme, p, Number(row.last_value) + 1),
    issued: Number(row.last_value),
    updated_at: row.updated_at,
  };
}

/** GET /settings/numbering */
async function numberingList(query) {
  const period = periodNow();
  const q = String(query.q || "").toLowerCase();
  const labelled = q ? DOC_TYPES.filter((t) => (DOC_LABELS[t] || "").toLowerCase().includes(q)) : [];
  const page = await repo.numberingPage(pool, query, period, [...DOC_TYPES], labelled);
  return { ...page, data: page.data.map((r) => schemeOut(r, period)) };
}

/** GET /settings/numbering/summary */
const numberingSummary = () => repo.numberingSummary(pool, [...DOC_TYPES]);

/**
 * PUT /settings/numbering/:doc_type. A scheme that resets must carry its period, or
 * the next period would issue a number already issued in the last.
 */
async function saveScheme(docType, body, actor) {
  if (!SCHEMES[docType]) throw notFound();
  const scheme = {
    prefix: body.prefix,
    padding: body.padding,
    separator: body.separator,
    reset: body.reset,
    include_period: body.include_period,
  };
  const problems = validateScheme(scheme);
  if (scheme.reset !== "never" && !scheme.include_period) problems.push("include_period");
  if (problems.length) {
    const fields = {};
    for (const p of problems) {
      if (p === "include_period") fields.include_period = ["Needed when it resets"];
      else if (p.includes("no prefix")) fields.padding = ["Add sequence digits"];
      else if (p.includes("no sequence")) fields.padding = ["Add digits or a period"];
      else if (p.startsWith("prefix")) fields.prefix = ["Up to 8 letters"];
      else if (p.startsWith("padding")) fields.padding = ["0 to 10"];
      else if (p.startsWith("separator")) fields.separator = ["Not a separator"];
      else fields.reset = ["Not a reset"];
    }
    throw new AppError("INVALID_SCHEME", "This numbering scheme cannot be used.", 422, fields);
  }
  const period = periodNow();
  const row = await tx(async (client) => {
    const before = await repo.findScheme(client, docType, period, { lock: true });
    if (!before) throw notFound();
    const was = {
      prefix: before.prefix,
      padding: Number(before.padding),
      separator: before.separator,
      reset: before.reset,
      include_period: before.include_period,
    };
    if (same(was, scheme)) return before;
    await repo.updateScheme(client, docType, scheme);
    await emit(client, {
      key: EVENTS.SETTINGS_CHANGED,
      entity: { type: "numbering_scheme", id: docType },
      actor,
      before: was,
      after: scheme,
      payload: { area: "numbering", doc_type: docType },
    });
    return repo.findScheme(client, docType, period);
  });
  return schemeOut(row, period);
}

/* ------------------------------------------------------------------ *
 * Security rules
 * ------------------------------------------------------------------ */

/** GET /settings/security */
async function securityPolicy() {
  await policy.load(pool);
  const now = rules.current();
  const floors = rules.floors();
  const [roles, counts] = await Promise.all([
    access.twoStepRoles(pool),
    repo.securityCounts(pool, policy.idleSeconds()),
  ]);
  return {
    session_max_age_min: now.session_max_age_min,
    session_max_age_floor: floors.session_max_age_min,
    idle_lock_min: now.idle_lock_min,
    idle_lock_floor: floors.idle_lock_min,
    password_min_length: now.password_min_length,
    password_min_floor: floors.password_min_length,
    two_step_roles: roles,
    ...counts,
  };
}

/**
 * PATCH /settings/security: tighter (or back to the floor), never looser. A rule
 * looser than its floor is refused with the floor named on the field.
 */
async function updateSecurity(patch, actor) {
  const ruleChange = Object.fromEntries(rules.RULES.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]));
  const storedAfter = await tx(async (client) => {
    const stored = await rules.stored(client);
    const now = rules.effective(stored);
    const bad = rules.problems(ruleChange, now);
    if (Object.keys(bad).length)
      throw new AppError("RULE_BELOW_FLOOR", "A rule would be looser than the server allows.", 422, bad);

    const before = { ...now };
    const after = { ...now, ...ruleChange };
    const next = { ...stored, ...ruleChange };
    for (const k of Object.keys(ruleChange)) await repo.putSetting(client, rules.KEYS[k], ruleChange[k], actor.user_id);

    if (patch.two_step_roles !== undefined) {
      const roleChange = await access.setTwoStepRoles(client, patch.two_step_roles);
      before.two_step_roles = roleChange.before;
      after.two_step_roles = roleChange.after;
    }
    if (!same(before, after)) {
      await emit(client, {
        key: EVENTS.SETTINGS_SECURITY_CHANGED,
        entity: { type: "setting", id: "security" },
        actor,
        before,
        after,
        payload: { area: "security" },
      });
    }
    return next;
  });
  rules.remember(storedAfter);
  return securityPolicy();
}

/** GET /settings/security/failed-logins */
async function failedSignIns(query) {
  const page = await repo.failedSignIns(pool, query);
  const REASONS = new Set(["bad_password", "bad_code", "no_such_account", "throttled"]);
  return {
    ...page,
    data: page.data.map((r) => ({
      ...r,
      reason: REASONS.has(r.reason)
        ? r.reason
        : r.reason === "status_suspended"
          ? "suspended"
          : r.reason === "status_left"
            ? "closed"
            : "other",
    })),
  };
}

module.exports = {
  organisation,
  updateOrganisation,
  uploadBrand,
  removeBrand,
  week,
  saveWeek,
  holidays,
  addHoliday,
  updateHoliday,
  removeHoliday,
  DOC_LABELS,
  numberingList,
  numberingSummary,
  saveScheme,
  securityPolicy,
  updateSecurity,
  failedSignIns,
};
