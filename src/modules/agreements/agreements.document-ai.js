"use strict";
/**
 * A contract or MoU attached on Praxis AI · Ask (docs/guides/praxis-ai.md §1.10 decisions 43, 44 and
 * 47, §6.18; partnerships.md §9; job chosen by TB, Image Reading).
 *
 *   readForChat(actor, doc, db)   the document on `agreement-document-read`; its terms for the pane's
 *                                 Record tab; the card that files it, matched here, never by the model
 *
 * The model reads the title, the kind, the parties, the dates, the money, how it renews, each side's
 * obligations and who signed. The server matches the parties by name among the partners and leads the
 * person may edit (MyCity's own names set aside), then the agreements on them waiting for their
 * signature: one draws Record Signed Copy with the agreement filled, several ask which, none draws
 * Add Partner Document on the partner or lead the parties name. Someone with Partnerships view alone
 * gets the summary and the terms, and no card (decision 41). Nothing is saved: the person's press
 * files the document and claims it.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { scopeFor } = require("../../middleware/rbac");
const m = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const { formatDate } = require("../../shared/time/day-first");
const { choiceWords, oneNamed, plainWords } = require("../../shared/ai/named");
const profile = require("../../shared/organisation/profile");
const storage = require("../../services/storage/storage.service");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const service = require("./agreements.service");

const MODULE = "partnerships";
const SIGNED_COPY = "agreements.record_signed_copy";
const ATTACH = "partner_documents.attach";
/** The words a company's name adds that a record's name may leave out ("Lagoon Youth Fest Limited"). */
const COMPANY = ["ltd", "limited", "plc", "inc", "llc", "company", "co", "nigeria", "nig"];
/** The reading's kind as a person reads it, and the names MyCity's list may give it. */
const KIND = Object.freeze({
  mou: { label: "MOU", names: ["MOU", "Memorandum of Understanding"] },
  service_agreement: { label: "Service Agreement", names: ["Service Agreement"] },
  contract: { label: "Contract", names: ["Contract"] },
  other: { label: "Other", names: [] },
});
const MAX_CHOICES = 6;

const cut = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (v && ISO_DAY.test(v) ? formatDate(v) : null);

/** A party's name with the words a company adds set aside, as names are matched. */
const plain = (name) => plainWords(name, COMPANY);

/** Whether a name is MyCity's own (Settings · Organisation's trading or legal name). */
function oursOf(org) {
  const ours = [org.trading_name, org.legal_name, profile.displayName(org)].map(plain).filter(Boolean);
  return (name) => {
    const w = plain(name);
    return Boolean(w) && ours.some((o) => w === o || w.startsWith(`${o} `) || o.startsWith(`${w} `));
  };
}

/** A value in its own currency: naira through shared/money, any other by its code ("USD 1,000.00"). */
function valueWords(value, currency) {
  if (!value) return null;
  const code = String(currency || "NGN").toUpperCase();
  return code === "NGN" ? m.formatNaira(value) : `${code} ${m.formatNaira(value, { symbol: false })}`;
}

/**
 * The document's terms as the pane's Record tab shows them (AiAttachmentRecord): every field read, in
 * words a person reads, each party's obligations under its name, who signed last.
 */
function recordOf(r) {
  const items = [];
  const add = (label, value) => {
    const v = cut(value, 2000);
    if (!v) return;
    const taken = items.filter((i) => i.label === label || i.label.startsWith(`${label} (`)).length;
    items.push({ label: cut(taken ? `${label} (${taken + 1})` : label, 200), value: v });
  };
  add("Kind", r.kind ? KIND[r.kind].label : null);
  add("Parties", r.parties.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join("; "));
  add("Signed On", day(r.signed_on));
  add("Starts On", day(r.starts_on));
  add("Ends On", day(r.ends_on));
  add("Notice", r.notice_days === null || r.notice_days === undefined ? null : `${r.notice_days} ${r.notice_days === 1 ? "day" : "days"}`);
  add("Value", valueWords(r.value, r.currency));
  add("Renewal", r.renewal);
  const byParty = new Map();
  for (const o of r.obligations) byParty.set(o.party, [...(byParty.get(o.party) || []), o.obligation]);
  for (const [party, list] of byParty) add(party, list.join(" "));
  add("Signed By", r.signatories.map((s) => [s.name, s.title].filter(Boolean).join(", ")).join("; "));
  return { title: cut(r.title || (r.kind ? KIND[r.kind].label : "Agreement"), 200) || "Agreement", items: items.slice(0, 30) };
}

/**
 * The partners and leads the parties name, among those the person may edit: each party but MyCity's,
 * found by Connect to Partner's own list and matched as a card's words are, the company words aside.
 */
async function recordsNamed(parties, ours, scope, db) {
  const work = require("../partners/partners.work");
  const found = new Map();
  for (const p of parties) {
    if (ours(p.name)) continue;
    const words = plain(p.name);
    if (!words) continue;
    const page = await work.records({ page: 1, q: words }, scope, db);
    const one = oneNamed(page.data, p.name, (r) => [r.name], { drop: COMPANY });
    if (one) found.set(one.id, { kind: one.kind, id: one.id, name: one.name, party: p.name });
  }
  return [...found.values()];
}

/** Who signed for the record the document is with: its party's signatory, else the only one not MyCity's. */
function signerFor(signatories, record, ours) {
  if (record) {
    const theirs = signatories.filter((s) => s.party && oneNamed([record], s.party, (r) => [r.name, r.party], { drop: COMPANY }));
    if (theirs.length === 1) return theirs[0];
  }
  const notOurs = signatories.filter((s) => !(s.party && ours(s.party)));
  return notOurs.length === 1 ? notOurs[0] : null;
}

/** MyCity's document kind the reading names, by name ("MOU"), or null when the list holds none. */
async function kindNameFor(kind, db) {
  const documents = require("../partners/partners.documents");
  for (const words of (KIND[kind] || KIND.other).names) {
    const name = await documents.kindLabelOf(db, words);
    if (name) return name;
  }
  return null;
}

/**
 * The card that files the document (decision 47): Record Signed Copy on an agreement waiting for its
 * signature, else Add Partner Document on the partner or lead the parties name.
 */
async function cardFor(actor, doc, r, ours, db) {
  const scope = await scopeFor(actor, "partnerships", "edit");
  if (!scope) return null;
  const records = await recordsNamed(r.parties, ours, scope, db);
  const ids = (kind) => records.filter((x) => x.kind === kind).map((x) => x.id);
  const waiting = records.length ? await service.awaitingSignature(db, { partner_ids: ids("partner"), lead_ids: ids("lead") }, scope) : [];

  if (waiting.length) {
    const values = { document_id: doc.document_id };
    const choices = {};
    if (waiting.length === 1) values.partnership_agreement_id = waiting[0].partnership_agreement_id;
    else choices.partnership_agreement_id = waiting.slice(0, MAX_CHOICES).map((a) => choiceWords(service.cardLabel(a)));
    // A day ahead of today is a misreading: the card asks for it rather than carry it.
    if (r.signed_on && ISO_DAY.test(r.signed_on) && r.signed_on <= lagos.today()) values.signed_on = r.signed_on;
    const on = waiting.length === 1 ? records.find((x) => x.id === (waiting[0].record || {}).id) : null;
    const signer = signerFor(r.signatories, on, ours);
    if (signer) {
      values.signed_by_name = cut(signer.name, 120);
      if (signer.title) values.signed_by_title = cut(signer.title, 120);
    } else if (r.signatories.length) {
      choices.signed_by_name = r.signatories.slice(0, MAX_CHOICES).map((s) => choiceWords(s.name));
    }
    return { action: SIGNED_COPY, values, defaults: {}, problems: {}, choices };
  }

  const values = { document_id: doc.document_id };
  const choices = {};
  const kind = await kindNameFor(r.kind, db);
  if (kind) values.kind = kind;
  if (records.length === 1) {
    const [only] = records;
    values.partner_id = only.kind === "partner" ? only.id : null;
    values.lead_id = only.kind === "lead" ? only.id : null;
  } else if (records.length > 1) {
    choices.partner_id = records
      .filter((x) => x.kind === "partner")
      .slice(0, MAX_CHOICES)
      .map((x) => choiceWords(x.name));
  }
  return { action: ATTACH, values, defaults: {}, problems: {}, choices };
}

/**
 * @param {object} actor  req.user
 * @param {object} doc    the person's staged document (vault row)
 * @param {{query: Function}} [db]
 * @returns {Promise<{outcome: string, reading?: object, card?: object|null, notes?: string[], record?: object}>}
 */
async function readForChat(actor, doc, db = pool) {
  if (!ai.FILE_TYPES.includes(doc.mime) || doc.scan_status === "pending" || doc.scan_status === "infected") return { outcome: "unreadable" };
  const now = await drafts.availability(pool, MODULE);
  if (!now.available) return { outcome: now.reason === "limit" ? "limit" : "off" };
  let run;
  try {
    run = await ai.complete({
      purpose: "agreement-document-read",
      module: MODULE,
      actor,
      input: { today: lagos.today() },
      output: c.agreements.AgreementDocumentRead,
      files: [{ mime_type: doc.mime, data: await storage.get(doc.storage_key) }],
      egress: "external",
      temperature: 0,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return { outcome: reason === "limit" ? "limit" : "off" };
    // A provider that refuses the file (its kind, its size), or an answer that never parses, reads as a file that cannot be read.
    if (err && ["AI_VENDOR_CONFIG", "AI_FILE_TOO_LARGE", "AI_BAD_OUTPUT"].includes(err.code)) return { outcome: "unreadable" };
    throw err;
  }
  const out = run.output;
  // The stub reads nothing: with no provider set up, reading is off.
  if (!out) return { outcome: "off" };
  if (!cut(out.title, 200) && !out.parties.length) return { outcome: "unreadable" };

  const value = out.value && m.money(out.value).greaterThan(0) ? m.toWire(out.value) : null;
  const reading = {
    title: cut(out.title, 200) || null,
    kind: out.kind,
    parties: out.parties.map((p) => ({ name: cut(p.name, 200), role: cut(p.role, 100) || null })).filter((p) => p.name),
    signed_on: out.signed_on,
    starts_on: out.starts_on,
    ends_on: out.ends_on,
    notice_days: out.notice_days,
    value,
    currency: value ? out.currency || "NGN" : null,
    renewal: cut(out.renewal, 300) || null,
    obligations: out.obligations.map((o) => ({ party: cut(o.party, 200), obligation: cut(o.obligation, 300) })).filter((o) => o.party && o.obligation),
    signatories: out.signatories.map((s) => ({ name: cut(s.name, 120), title: cut(s.title, 120) || null, party: cut(s.party, 200) || null })).filter((s) => s.name),
  };
  const ours = oursOf(await profile.readProfile(db));
  const card = await cardFor(actor, doc, reading, ours, db);
  return { outcome: "read", reading, card, notes: [], record: recordOf(reading) };
}

module.exports = { readForChat, recordOf, valueWords, COMPANY };
