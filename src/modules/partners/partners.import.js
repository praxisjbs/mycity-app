"use strict";
/**
 * The Partnership Tracker importer, `partnership_tracker` (docs/guides/partnerships.md §6.13): MyCity's
 * workbook as its growth team keeps it, one row an organisation, written through the services as a
 * lead with its open deal, or a partner with its live deal when the row's stage is signed or active
 * ("signed before the hub"). Every write is `leads.createIn` or `partners.createIn` with source
 * `import`, inside the engine's transaction, so numbering, history, events and audit are the
 * screens' own, and a signed row's deal.signed carries `import`.
 *
 * What this file knows that a form does not:
 *
 *  - **The workbook.** Sheet Master Tracker (else any sheet with a Partner Name column), headers on
 *    the row that names them; a row with no partner name is skipped. extract() reads it into the
 *    importer's fields, so mapping, Map Values, preview, the error file and revert work as for any
 *    sheet, and an export of Partners or Leads (partners.export.js) reads back the same way.
 *  - **Contact details** are a phone, an email or two phones in a cell, split by their shape.
 *  - **Partnership Type** may carry terms: "Ticketing (exclusive), 8% commission" is the category
 *    Ticketing (exclusive) and a commission of 8% on the deal.
 *  - **Dates** are typed six ways ("25th June 26", "3rd of July", "24th of July, 2026", "Sept 2026",
 *    and real dates), read day-first; a month alone is its 1st, and the comments say so; a missing
 *    year is the sheet's (the year most of its dates carry).
 *  - **Region** is cities in any case ("IBADAN", PH for Port Harcourt) or a scope (National, Africa,
 *    Worldwide). Each city is placed through the city search, or picked on Map Values (F27).
 *  - **Lead Owner** has many spellings ("JOHN", "Mr. John"); each is matched to a person once on Map
 *    Values; an unmatched owner leaves the record with No Owner.
 *  - **Status** is the deal's health (Stalled takes the comments as blockers); Closed loses an open
 *    deal; Active Partnership adds nothing. A stage meaning Closed Lost makes a lost lead.
 *  - **Current Stage** repeats the stage (Sealed, Ongoing, Invoicing) and is kept only when it says
 *    more, in the comments. Text under Expected Close Date that is not a date joins the next action.
 *  - **Any other column** fills the custom field of the same label (Categories adds one); a column
 *    with no such field is named on its rows and kept out.
 *
 * Matching (`matchKeys`): the name as written, then the website's host, then the primary contact's
 * email, over every lead and partner whatever the importer's scope, as the duplicate check reads. A
 * row that matches is left as it is (the hub's record is kept), so importing the file again makes
 * nothing twice. Reverting removes what the import made, until a record is in use (an interaction, a
 * proposal, an agreement, a document, returns, or a stage moved on the hub).
 */
const c = require("@mycity/contract");
const { defineImporter } = require("../../shared/import/registry");
const { normalise } = require("../../shared/import/mapping");
const { readDate } = require("../../shared/spreadsheet/day-first-cells");
const { AppError } = require("../../shared/errors");
const lagos = require("../../shared/time/lagos");
const { scopeFor } = require("../../middleware/rbac");
const repo = require("./partners.repo");
const service = require("./partners.service");
const pipelineRepo = require("../partner_pipeline/partner_pipeline.repo");
const lists = require("../partner_pipeline/partner_pipeline.lists");
const categories = require("../partner_pipeline/partner_pipeline.categories");
const { categoryOf } = require("../partner_pipeline/partner_pipeline.setup");

const SHEET = "master tracker";

/* ------------------------------------------------------------------ *
 * Reading the cells (pure)
 * ------------------------------------------------------------------ */

const text = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s || null;
};

const EMAIL = /[^\s@,;<>()]+@[^\s@,;<>()]+\.[a-z]{2,}/gi;

/** A contact cell split by shape: its email, and every phone it holds ("0803 123 4567 / 0812 ..."). */
function splitContact(cell) {
  const raw = text(cell);
  if (!raw) return { email: null, phones: [] };
  const emails = raw.match(EMAIL) || [];
  const rest = raw.replace(EMAIL, " ");
  const phones = [];
  for (const chunk of rest.split(/[,;/|]|\bor\b|\band\b/i)) {
    const candidate = chunk.replace(/[^\d+]/g, "");
    if (candidate.replace(/\D/g, "").length < 7) continue;
    const parsed = c.common.phone.safeParse(candidate);
    if (parsed.success && !phones.includes(parsed.data)) phones.push(parsed.data);
  }
  return { email: emails[0] ? emails[0].toLowerCase() : null, phones };
}

/** "Mr. Tunde Bakare" is first name Tunde and last name Bakare; a single word is a first name. */
function splitName(cell) {
  const bare = (text(cell) || "").replace(/^(mr|mrs|ms|miss|dr|engr|chief|prof)\.?\s+/i, "").trim();
  if (!bare) return null;
  const words = bare.split(" ");
  return { first_name: words[0].slice(0, 80), last_name: words.slice(1).join(" ").slice(0, 80) };
}

const SCOPES = [
  [/^(national|nationwide|nigeria|all states)$/i, "national"],
  [/^(africa|pan[- ]?africa|pan[- ]?african|west africa)$/i, "africa"],
  [/^(worldwide|global|international|world)$/i, "worldwide"],
];
const CITY_NAMES = new Map([
  ["ph", "Port Harcourt"],
  ["p h", "Port Harcourt"],
  ["portharcourt", "Port Harcourt"],
  ["fct", "Abuja"],
]);

/** The scope a region word names, or null. */
const scopeOf = (piece) => (SCOPES.find(([re]) => re.test(String(piece).trim())) || [])[1] || null;

/** The values a Region cell holds: "Lagos, IBADAN & PH" is three cities. */
const regionPieces = (cell) =>
  String(cell || "")
    .split(/[,;/&|]|\band\b|\s-\s/i)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** A city as the search is asked for it: "IBADAN" is Ibadan, "PH" Port Harcourt. */
function cityWords(piece) {
  const key = normalise(piece);
  if (CITY_NAMES.has(key)) return CITY_NAMES.get(key);
  return String(piece)
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** A Region cell's scope and its cities (still words): cities win over a scope word beside them. */
function regionOf(cell) {
  const pieces = regionPieces(cell);
  const cities = pieces.filter((p) => !scopeOf(p));
  if (cities.length) return { scope: "cities", cities };
  const scope = pieces.map(scopeOf).find(Boolean);
  return scope ? { scope, cities: [] } : null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const monthOf = (word) => MONTHS[String(word || "").toLowerCase().slice(0, String(word || "").toLowerCase().startsWith("sept") ? 4 : 3)] || null;
const pad = (n) => String(n).padStart(2, "0");
const yearOf = (y, fallback) => (y ? (String(y).length === 2 ? 2000 + Number(y) : Number(y)) : fallback);

/**
 * A tracker date, read day-first: a real date, an Excel serial, "03/07/2026", "25th June 26", "3rd of
 * July", "24th of July, 2026", "July 24, 2026", "Sept 2026". A month alone is its 1st (`month_only`);
 * a missing year is `year` (`year_missing`).
 * @returns {{date: string|null, month_only: boolean, year_missing: boolean}}
 */
function parseTrackerDate(cell, year) {
  const none = { date: null, month_only: false, year_missing: false };
  if (cell === null || cell === undefined || cell === "") return none;
  if (typeof cell === "number" || cell instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(cell)) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(String(cell).trim())) {
    const r = readDate(cell);
    return r.date ? { ...none, date: r.date } : none;
  }
  const t = String(cell)
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/\bof\b|,|\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const done = (y, m, d, flags) => {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    return lagos.isDate(iso) ? { ...none, ...flags, date: iso } : none;
  };
  let m = /^(\d{1,2}) ([a-z]+)(?: (\d{2}|\d{4}))?$/.exec(t);
  if (m && monthOf(m[2])) return done(yearOf(m[3], year), monthOf(m[2]), Number(m[1]), { year_missing: !m[3] });
  m = /^([a-z]+) (\d{1,2})(?: (\d{4}))?$/.exec(t);
  if (m && monthOf(m[1])) return done(yearOf(m[3], year), monthOf(m[1]), Number(m[2]), { year_missing: !m[3] });
  m = /^([a-z]+)(?: (\d{4}))?$/.exec(t);
  if (m && monthOf(m[1])) return done(yearOf(m[2], year), monthOf(m[1]), 1, { month_only: true, year_missing: !m[2] });
  return none;
}

/** The sheet's year: the year most of its dates name, else this year in Lagos. */
function sheetYear(cells) {
  const count = new Map();
  for (const cell of cells) {
    const r = parseTrackerDate(cell, 0);
    if (r.date && !r.year_missing) count.set(r.date.slice(0, 4), (count.get(r.date.slice(0, 4)) || 0) + 1);
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
  return best ? Number(best[0]) : Number(lagos.today().slice(0, 4));
}

/** Potential Impact: "High: strong reach in Lagos" is the rating High and its note; the rest are impact values. */
function impactOf(cell) {
  const raw = text(cell);
  if (!raw) return { values: [], rating: null, note: null };
  const m = /^(high|medium|low)\s*[:\-–]\s*(.*)$/i.exec(raw);
  if (m) return { values: [], rating: m[1].toLowerCase(), note: text(m[2]) };
  return { values: raw.split(/[,;/]/).map((v) => v.trim()).filter(Boolean), rating: null, note: null };
}

/** Current Stage words that only repeat the stage. */
const REPEATS = new Set(["sealed", "ongoing", "invoicing", "signed", "active", "done", "closed"]);

/* ------------------------------------------------------------------ *
 * The workbook (pure)
 * ------------------------------------------------------------------ */

/** Each tracker header, by the words it is written with; anything else is another column. */
const HEADERS = [
  ["sn", /^(s ?n|s no|no|serial|serial no|#)$/],
  ["name", /^(partner name|partner|organisation|organization|company|business name|name)$/],
  ["industry", /^(industry|sector)$/],
  ["contact_name", /^(contact person|contact name|contact)$/],
  ["position", /^(position|designation|role|job title)$/],
  ["contact", /^(contact details|contact detail|phone|email|phone email|contact info)$/],
  ["region", /^(region|location|city|cities)$/],
  ["objective", /^(partnership objective|objective)$/],
  ["type", /^(partnership type|type|category)$/],
  ["stage", /^(partnership stage|stage)$/],
  ["impact", /^(potential impact|impact)$/],
  ["owner", /^(lead owner|owner)$/],
  ["identified", /^(date identified|identified|date)$/],
  ["current_stage", /^(current stage)$/],
  ["next_action", /^(next action|next step|next steps)$/],
  ["expected_close", /^(expected close date|expected close|close date)$/],
  ["status", /^(status|health)$/],
  ["comments", /^(comments|comment|notes|remarks)$/],
  ["website", /^(website|web|url)$/],
  ["number", /^(number|reference|ref)$/],
];
const headerKey = (cell) => {
  const n = normalise(cell);
  return (HEADERS.find(([, re]) => re.test(n)) || [])[0] || null;
};

/** The tracker's sheet and its header row: Master Tracker first, else the first sheet with a Partner Name column. */
function findTable(sheets) {
  const ordered = [...sheets].sort((a, b) => (normalise(b.name) === SHEET) - (normalise(a.name) === SHEET));
  for (const sheet of ordered) {
    const at = (sheet.rows || []).slice(0, 20).findIndex((r) => (r || []).some((cell) => headerKey(cell) === "name") && (r || []).filter((cell) => headerKey(cell)).length >= 2);
    if (at >= 0) return { sheet, at };
  }
  return null;
}

/**
 * The importer's rows from the workbook as MyCity keeps it, each keyed by field, with the notes kept
 * on the batch. Throws for a workbook with no Partner Name column.
 * @param {Array<{name: string, rows: Array<Array<*>>}>} sheets
 */
function extract(sheets) {
  const found = findTable(sheets);
  if (!found) throw new AppError("IMPORT_NOT_TRACKER", "This is not the partnership tracker: no sheet has a Partner Name column", 422);
  const { sheet, at } = found;
  const header = sheet.rows[at] || [];
  const cols = {};
  const others = [];
  header.forEach((cell, i) => {
    const key = headerKey(cell);
    if (key && cols[key] === undefined) cols[key] = i;
    else if (text(cell) && !key) others.push({ i, header: text(cell) });
  });
  const cell = (r, key) => (cols[key] === undefined ? null : (r || [])[cols[key]]);
  const body = sheet.rows.slice(at + 1);
  const year = sheetYear(body.map((r) => cell(r, "identified")));
  const rows = [];
  let skipped = 0;
  for (const r of body) {
    if (!(r || []).some((v) => text(v))) continue;
    const name = text(cell(r, "name"));
    if (!name) {
      skipped += 1;
      continue;
    }
    const comments = [text(cell(r, "comments"))];
    const { email, phones } = splitContact(cell(r, "contact"));
    const type = text(cell(r, "type"));
    const typed = type ? categoryOf(type) : null;
    const stage = text(cell(r, "stage"));
    const identifiedCell = cell(r, "identified");
    const identified = parseTrackerDate(identifiedCell, year);
    if (identified.month_only) comments.push(`Date Identified was a month only (${text(identifiedCell)})`);
    else if (!identified.date && text(identifiedCell)) comments.push(`Date Identified: ${text(identifiedCell)}`);
    const closeCell = cell(r, "expected_close");
    const close = parseTrackerDate(closeCell, year);
    const nextAction = [text(cell(r, "next_action")), !close.date && text(closeCell) ? text(closeCell) : null].filter(Boolean).join("; ") || null;
    const current = text(cell(r, "current_stage"));
    if (current && !REPEATS.has(normalise(current)) && normalise(current) !== normalise(stage)) comments.push(`Current Stage: ${current}`);
    const extra = Object.fromEntries(others.map((o) => [o.header, text((r || [])[o.i])]).filter(([, v]) => v));
    rows.push({
      name: name.slice(0, 150),
      industry: text(cell(r, "industry")),
      contact_name: text(cell(r, "contact_name")),
      position: text(cell(r, "position")),
      email,
      phones: phones.length ? phones.join(", ") : null,
      region: text(cell(r, "region")),
      objective: text(cell(r, "objective")),
      category: typed ? typed.name : null,
      commission_pct: typed && typed.default_commission_pct !== undefined ? Number(typed.default_commission_pct) : null,
      stage,
      impact: text(cell(r, "impact")),
      owner: text(cell(r, "owner")),
      identified_on: identified.date,
      current_stage: current,
      next_action: nextAction ? nextAction.slice(0, 300) : null,
      expected_close_on: close.date,
      status: text(cell(r, "status")),
      comments: comments.filter(Boolean).join("\n").slice(0, 2000) || null,
      website: text(cell(r, "website")),
      other: Object.keys(extra).length ? JSON.stringify(extra) : null,
    });
  }
  const notes = [];
  if (skipped) notes.push(`${skipped} rows with no partner name were skipped`);
  if (others.length) notes.push(`Other columns: ${others.map((o) => o.header).join(", ")}`);
  return { rows, notes };
}

/* ------------------------------------------------------------------ *
 * Writing a row
 * ------------------------------------------------------------------ */

const rowError = (field, message) => new AppError("VALIDATION_FAILED", message, 422, { [field]: [message] });
const note = (field, message) => ({ field, message });

/** The places a region's cities are: Map Values' pick, else the one city the search finds; the rest named in a note. */
async function citiesOf(client, words, ctx, notes) {
  const out = [];
  const missed = [];
  // "IBADAN, ibadan" is one city.
  const unique = [...new Map(words.map((w) => [normalise(w), w])).values()];
  for (const piece of unique) {
    const chosen = ctx.valueOf ? ctx.valueOf("region", piece) : undefined;
    let token = chosen ? chosen.to : undefined;
    if (token === undefined) token = await require("../maps/maps.service").onePlace(cityWords(piece), { level: "city" });
    const parsed = token ? c.maps.PlaceInput.safeParse({ token }) : null;
    if (parsed && parsed.success) out.push(parsed.data);
    else if (!(chosen && chosen.to === null)) missed.push(piece);
  }
  if (missed.length) notes.push(note("region", `Region: ${missed.join(", ")} not placed; pick on Map Values or the record`));
  return out.slice(0, 20);
}

/** Potential Impact as MyCity's list codes, its rating and note; values off the list join the note. */
async function impactFor(client, cell) {
  const parsed = impactOf(cell);
  const { values } = await lists.values("partnership_impact", client);
  const byLabel = new Map(values.filter((v) => v.active).map((v) => [normalise(v.label.replace(/&/g, "and")), v.code]));
  const codes = [];
  const off = [];
  for (const v of parsed.values) {
    const code = byLabel.get(normalise(v.replace(/&/g, "and")));
    if (code && !codes.includes(code)) codes.push(code);
    else if (!code) off.push(v);
  }
  const noteText = [parsed.note, off.length ? off.join(", ") : null].filter(Boolean).join("; ") || null;
  return { impact: codes.length ? codes : undefined, impact_rating: parsed.rating, impact_note: noteText ? noteText.slice(0, 500) : null };
}

/** Other columns into the custom fields of the same label (the record's kind or its deal's); the rest named. */
async function customFor(client, other, appliesTo, categoryId, notes) {
  if (!other) return { record: {}, deal: {} };
  let extra;
  try {
    extra = JSON.parse(other);
  } catch {
    return { record: {}, deal: {} };
  }
  const fields = await pipelineRepo.listFields(client, { partner_category_id: categoryId, active: true });
  const out = { record: {}, deal: {} };
  const unknown = [];
  for (const [header, value] of Object.entries(extra)) {
    const f = fields.find((x) => [appliesTo, "deal"].includes(x.applies_to) && normalise(x.label) === normalise(header));
    if (!f) {
      unknown.push(header);
      continue;
    }
    const v = ["number", "money"].includes(f.field_type) ? String(value).replace(/[₦,\s]/g, "") : f.field_type === "yes_no" ? /^(yes|y|true|1)$/i.test(value) : f.field_type === "multi_pick" ? String(value).split(/[,;]/).map((x) => x.trim()) : value;
    out[f.applies_to === "deal" ? "deal" : "record"][f.key] = f.field_type === "number" ? Number(v) : v;
  }
  if (unknown.length) notes.push(note("other", `No custom field for ${unknown.join(", ")}; add it on Categories to import it`));
  return out;
}

/** A tracker row as a new lead or partner, through the services, in the engine's transaction. */
async function writeRow(client, values, ctx) {
  const actor = ctx.actor;
  const notes = [];
  const pipeline = require("../partner_pipeline/partner_pipeline.service");
  const stages = await lists.stagesOf(client);
  const stage = values.stage ? lists.stageOf(stages, values.stage) : lists.firstStage(stages);
  if (!stage) throw rowError("stage", stages.length ? "Partnership Stage: map it on Map Values" : "Set up the stages first (Start From Tracker)");
  if (!values.category) throw rowError("category", "Partnership Type is required");
  const category = await pipelineRepo.getCategory(client, values.category);
  const owner = values.owner || null;
  if (owner) {
    const scope = await scopeFor(actor, "partnerships", "create");
    if (scope && scope.scope !== "all" && !(scope.scope_ids || []).includes(owner)) throw rowError("owner", "Lead Owner: outside your team");
  }
  const held = await pipeline.holdsMoney(actor);
  let commission = values.commission_pct ?? null;
  if (commission !== null && !held) {
    notes.push(note("commission_pct", "Commission left out: it needs See Commission and Returns"));
    commission = null;
  }
  const region = regionOf(values.region);
  const cities = region && region.scope === "cities" ? await citiesOf(client, region.cities, ctx, notes) : [];
  const contactName = splitName(values.contact_name);
  const phones = values.phones ? values.phones.split(/,\s*/).filter(Boolean).slice(0, 4) : [];
  const contact =
    contactName || values.email || phones.length
      ? { first_name: contactName ? contactName.first_name : "Contact", last_name: contactName ? contactName.last_name : "", job_title: values.position || null, email: values.email || null, phones }
      : null;
  const impact = await impactFor(client, values.impact);
  const signed = lists.isSigned(stage.meaning);
  const custom = await customFor(client, values.other, signed ? "partner" : "lead", values.category, notes);
  const deal = {
    title: `${category ? category.name : "Partnership"} Partnership`.slice(0, 150),
    objective: values.objective || null,
    stage: stage.meaning === "closed_lost" ? undefined : stage.code,
    owner_id: owner,
    commission_pct: commission === null ? undefined : String(commission),
    expected_close_on: values.expected_close_on || null,
    next_action: values.next_action || null,
    ...impact,
    comments: values.comments || null,
    custom: custom.deal,
  };
  const body = {
    name: values.name,
    partner_category_id: values.category,
    region: region ? { scope: region.scope, cities } : { scope: null, cities: [] },
    industry: values.industry || null,
    website: values.website || null,
    owner_id: owner,
    identified_on: values.identified_on || null,
    custom: custom.record,
    contact,
    deal,
  };
  let made;
  if (signed) {
    made = await service.createIn(client, actor, { ...body, signed_before_hub: true }, { held, source: "import" });
    made.id = made.partner_id;
  } else {
    made = await require("../leads/leads.service").createIn(client, actor, { ...body, ...impact, comments: values.comments || null }, { held, source: "import" });
    made.id = made.lead_id;
  }
  const stagesSvc = require("../partner_pipeline/partner_pipeline.stages");
  const health = require("../partner_pipeline/partner_pipeline.health");
  // A Closed Lost stage, or Closed on an open deal: the deal is lost, so the lead is.
  if (stage.meaning === "closed_lost" || (values.status === "closed" && !signed)) {
    const lost = lists.firstOf(stages, "closed_lost");
    if (!lost) throw rowError("stage", "Set up a Closed Lost stage first");
    await stagesSvc.moveIn(client, actor, await pipelineRepo.lock(client, made.deal_id), { stage: lost.code, reason: "Closed lost in the tracker" }, { source: "import" });
  } else if (["follow_up_required", "stalled"].includes(values.status)) {
    const blockers = values.status === "stalled" ? (values.comments && values.comments.length >= 10 ? values.comments.slice(0, 1000) : "From the tracker") : undefined;
    await health.setIn(client, actor, await pipelineRepo.lock(client, made.deal_id), { health: values.status, blockers }, { source: "import" });
  } else if (values.status === "closed" && signed) {
    notes.push(note("status", "Status: Closed kept the signed deal live; close it on the record"));
  }
  return { id: made.id, action: "create", notes };
}

/* ------------------------------------------------------------------ *
 * The importer
 * ------------------------------------------------------------------ */

const STATUS_OPTIONS = [
  { value: "on_track", label: "On Track", aliases: ["on-track", "ok", "good"] },
  { value: "follow_up_required", label: "Follow-Up Required", aliases: ["follow up required", "follow-up", "follow up", "followup required"] },
  { value: "stalled", label: "Stalled", aliases: ["stuck", "blocked"] },
  { value: "active", label: "Active Partnership", aliases: ["active"] },
  { value: "closed", label: "Closed", aliases: ["closed lost", "lost"] },
];

const FIELDS = [
  { key: "name", label: "Partner Name", required: true, max: 150, example: "Eko Arts Fair" },
  { key: "industry", label: "Industry", max: 80 },
  { key: "contact_name", label: "Contact Person", max: 160 },
  { key: "position", label: "Position", max: 120 },
  { key: "email", label: "Contact Email", type: "email" },
  { key: "phones", label: "Contact Phones", max: 200 },
  {
    key: "region",
    label: "Region",
    hint: "Cities, or National, Africa or Worldwide",
    mapValues: {
      kind: "place",
      split: regionPieces,
      skip: (piece) => Boolean(scopeOf(piece)),
      suggest: (client, field, value) => require("../maps/maps.service").onePlace(cityWords(value), { level: "city" }),
      describe: async (client, field, to) => (require("../maps/maps.service").cardPlace(to)[0] || {}).label || null,
    },
  },
  { key: "objective", label: "Partnership Objective", max: 2000 },
  {
    key: "category",
    label: "Partnership Type",
    type: "reference",
    ref: "partner_category",
    createMissing: "confirm",
    mapValues: { kind: "list", choices: (client) => categories.choices(client) },
  },
  { key: "commission_pct", label: "Commission", type: "number" },
  {
    key: "stage",
    label: "Partnership Stage",
    type: "reference",
    ref: "partnership_stage",
    mapValues: {
      kind: "list",
      choices: async (client) => (await lists.stagesOf(client)).filter((s) => s.active && s.meaning).map((s) => ({ value: s.code, label: s.label })),
    },
  },
  { key: "impact", label: "Potential Impact", max: 1000 },
  {
    key: "owner",
    label: "Lead Owner",
    type: "reference",
    ref: "employee",
    missing: "leave",
    mapValues: { kind: "person", describe: (client, field, to) => repo.employeeLabel(client, to) },
  },
  { key: "identified_on", label: "Date Identified", type: "date" },
  { key: "current_stage", label: "Current Stage", max: 200 },
  { key: "next_action", label: "Next Action", max: 300 },
  { key: "expected_close_on", label: "Expected Close Date", type: "date" },
  { key: "status", label: "Status", type: "enum", options: STATUS_OPTIONS, mapValues: { kind: "list" } },
  { key: "comments", label: "Comments", max: 2000 },
  { key: "website", label: "Website", max: 200 },
  { key: "other", label: "Other Columns", max: 4000 },
];

defineImporter({
  key: "partnership_tracker",
  label: "Partnership Tracker",
  permission: ["partnerships", "create"],
  entity: "partner",
  alsoEntities: ["lead"],
  schema: c.partners.TrackerImportRow,
  matchKeys: ["name", "website", "email"],
  fields: FIELDS,
  extract,

  async find(client, { key, value }) {
    const hit = await repo.trackerMatch(client, key, key === "website" ? require("./partners.dedup").hostOf(value) : value);
    return hit ? { id: hit.id, values: { number: hit.number } } : null;
  },

  async resolve(client, field, value) {
    if (field.key === "category") {
      const found = await pipelineRepo.categoryNamed(client, value);
      return found && found.active ? found.id : null;
    }
    if (field.key === "stage") return lists.stageCodeOf(client, value);
    if (field.key === "owner") return repo.employeeNamed(client, value);
    return null;
  },

  // A Partnership Type ticked to create: a category of that name, set up later on Categories.
  create: (client, field, value, ctx) => categories.createIn(client, ctx.actor, { name: String(value).slice(0, 80) }),

  async write(client, values, ctx) {
    // A record already in the hub is kept as it is: the import never overwrites what people entered.
    if (ctx.existing) return { id: ctx.existing.id, action: "none" };
    return writeRow(client, values, ctx);
  },

  async isReferenced(client, id) {
    const kind = await repo.kindOf(client, id);
    return kind ? repo.trackerInUse(client, kind, id) : false;
  },

  async archive(client, id, ctx) {
    const kind = await repo.kindOf(client, id);
    if (kind === "partner") await service.removeImportedIn(client, ctx.actor, id);
    else if (kind === "lead") await require("../leads/leads.service").removeImportedIn(client, ctx.actor, id);
  },

  // Nothing is updated by this import (a matched record is left as it is), so there is nothing to put back.
  restore: async () => undefined,
});

module.exports = { FIELDS, extract, splitContact, splitName, regionOf, regionPieces, cityWords, parseTrackerDate, sheetYear, impactOf, headerKey };
