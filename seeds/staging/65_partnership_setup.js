"use strict";
/**
 * Staging demonstration data: how Partnerships · Categories looks once MyCity has set it up
 * (docs/guides/partnerships.md §6.3, §6.7, §6.8, §6.11, F13). Production starts empty (A5, A26): MyCity
 * enters these on Categories, or reads them from its tracker with Start From Tracker.
 *
 *   the pipeline's stages     the thirteen of MyCity's tracker, each with what it counts as
 *   potential impacts         the tracker's nine
 *   document kinds            the kinds partnerships.md §4.3 lists, which Upload Document and Praxis AI's
 *                             Add Partner Document pick from (praxis-ai.md §6.18)
 *   categories                the tracker's twelve partnership types
 *   Events                    its delivery checklist (the Deal Merchant Agreement's five clauses), a
 *                             custom field and the Deal Merchant Agreement rebuilt as its default
 *                             template, with its asks (docs/MyCity-ERP-Documents/partnership-samples/)
 *   proof points              a demonstration set a proposal may cite
 *
 * Everything goes through the services, as the screen's own buttons do. The partners, leads, deals and
 * proposals follow with M7 PR 8's seed (70_partnerships.js). Run only by `scripts/db/seed.js --staging`.
 * Idempotent: each row is found by its name or title, and a second run adds nothing.
 */
const path = require("node:path");

const src = (p) => require(path.join(__dirname, "..", "..", "src", p));

/** MyCity's thirteen stages, in the order its tracker offers them, and what each counts as (§6.3). */
const STAGES = Object.freeze([
  ["Prospect Identified", "prospect"],
  ["Initial Contact", "contacted"],
  ["Introductory Meeting Scheduled", "meeting"],
  ["Introductory Meeting Held", "meeting"],
  ["Proposal Sent", "proposal"],
  ["Follow-Up Ongoing", "proposal"],
  ["Negotiation", "negotiation"],
  ["Verbal Approval", "negotiation"],
  ["Contract Review", "negotiation"],
  ["Partnership Signed", "signed"],
  ["Active Partnership", "active"],
  ["Closed Lost", "closed_lost"],
  ["On Hold", "on_hold"],
]);

/** What a record's document may be (partnerships.md §4.3), as Upload Document's Kind offers them. */
const DOCUMENT_KINDS = Object.freeze(["Proposal", "MOU", "Service Agreement", "Contract", "Brief", "Invoice", "Media", "Other"]);

const IMPACTS = Object.freeze([
  "App Downloads & Visibility",
  "Revenue Generation",
  "Brand Visibility",
  "User Acquisition",
  "Vendor Acquisition",
  "Content Collaboration",
  "Community Growth",
  "Business Listings",
  "Strategic Positioning",
]);

/** The tracker's twelve partnership types; the ones Analytics counts as vendor leads are marked. */
const CATEGORIES = Object.freeze([
  { name: "Event", default_validity_days: 30 },
  { name: "Hospitality" },
  { name: "Vendor", counts_as_vendor: true },
  { name: "Media" },
  { name: "Corporate" },
  { name: "Community" },
  { name: "Strategic" },
  { name: "Tourism" },
  { name: "University" },
  { name: "Government" },
  { name: "Sponsorship" },
  { name: "Influencer" },
]);

/** What MyCity delivers on a signed event deal: the Deal Merchant Agreement's clauses (§6.7). */
const CHECKLIST = Object.freeze([
  { title: "Platform and technical partnership", due_from: "signing", due_days: 7, description: "Event registration on MyCityApp NG platform, with our team supporting the setup so attendees move smoothly from sign up to check-in." },
  { title: "Amplification", due_from: "event_start", due_days: 14, description: "Our marketing team will push the event across our channels, as we have an established pool of 10,000+ network and community." },
  { title: "Branded presence and souvenirs", due_from: "event_start", due_days: 3, description: "MyCityApp NG branded souvenir items distributed to attendees." },
  { title: "Documentation", due_from: "event_start", due_days: 0, description: "Our on-ground team will join the media team to cover the event highlights from attendee interviews to special presentations." },
  { title: "Ember to Remember calendar listing", due_from: "signing", due_days: 14, description: "The event will be featured on the MyCityApp NG Ember to Remember national content calendar, which has been recognized and approved by the Federal Government of Nigeria, with support from MTN Nigeria." },
]);

/** A field chip as the template editor writes it (templates.agreements.js reads it back). */
const chip = (field, helper) => `<span data-field="${field}">{{ ${helper ? `${helper} ` : ""}${field} }}</span>`;
const line = (label, field, helper) => `<p>${label} ${chip(field, helper)}</p>`;

/** The Deal Merchant Agreement, rebuilt from the redacted sample: its placeholders are fields (§6.8). */
const AGREEMENT = [
  "<h2>Deal Merchant Agreement</h2>",
  line("Date:", "today", "longdate"),
  line("Business Name:", "partner.name"),
  line("Address:", "partner.headquarters"),
  line("Phone number:", "contact.phones"),
  line("Email:", "contact.email"),
  line("Contact person:", "contact.full_name"),
  line("Deal Title:", "deal.title"),
  "<h3>Deals Description</h3>",
  "<p><strong>Option 1</strong></p>",
  line("Event Title is:", "deal.event_title"),
  `<p>${chip("ask.attendee_actions")}</p>`,
  "<p><strong>Option 2</strong></p>",
  `<p>${chip("ask.expected_attendees")}</p>`,
  "<p><strong>Option 3</strong></p>",
  `<p>${chip("ask.about_event")}</p>`,
  "<h3>Financials</h3>",
  `<p>${chip("deal.options")}</p>`,
  "<h3>Deal Validity</h3>",
  `<p>${chip("deal.validity_label")}, ending ${chip("deal.valid_until", "longdate")}</p>`,
  "<h3>Fine Print and Highlights</h3>",
  "<p>In detail, explain what is included in the deal:</p>",
  `<p>${chip("category.checklist")}</p>`,
  "<h3>How long is the service</h3>",
  `<p>${chip("ask.service_period")}</p>`,
  "<h3>If the deal is the bundle, please explain the breakdown of the original price</h3>",
  `<p>${chip("ask.bundle_breakdown")}</p>`,
  "<h3>How should customers make bookings?</h3>",
  `<p>${chip("ask.bookings")}</p>`,
  line("Opening hours for MyCityApp customers:", "ask.opening_hours"),
  line("Will Merchant send pictures?", "ask.merchant_pictures"),
  "<h3>Acceptance of Agreement</h3>",
  "<p>The Company shall remit payment for coupons to the Merchant based on redeemed coupons as per agreed days interval till deal expiration.</p>",
  "<p>The above prices, specifications and conditions are hereby accepted. The Company is authorized to execute the project as outlined in this Agreement.</p>",
  line("Business Name:", "partner.name"),
  line("Name of Representative:", "signer.name"),
  line("Title of Representative:", "signer.title"),
  line("Date Signed:", "signer.signed_on", "longdate"),
  line("Signature:", "signer.signature"),
].join("");

/** The values the person gives when generating, with the sample's own sentences as their defaults. */
const ASKS = Object.freeze([
  { key: "attendee_actions", label: "What Attendees Do", type: "long_text", default: "All the attendees of the event are expected to download MyCityApp Ng as part of event registration and a ticket access to the event." },
  { key: "expected_attendees", label: "Expected Attendees", type: "text" },
  { key: "about_event", label: "About the Event", type: "long_text" },
  { key: "service_period", label: "Service Period", type: "long_text", default: "For the period of the event, which is built up to event date, during event day and supported highlights after the event." },
  { key: "bundle_breakdown", label: "Bundle Breakdown", type: "text", default: "None Applicable" },
  { key: "bookings", label: "How To Book", type: "text", default: "Through MyCityApp download link for the event" },
  { key: "opening_hours", label: "Opening Hours", type: "text", default: "24hrs" },
  { key: "merchant_pictures", label: "Merchant Sends Pictures", type: "yes_no" },
]);

/** A demonstration set a proposal may cite (§6.11); MyCity enters its own on production. */
const PROOF_POINTS = Object.freeze([
  { kind: "stat", label: "Network and community", value: "10,000+", source_note: "MyCity's standard agreement wording" },
  { kind: "endorsement", label: "Ember to Remember calendar", detail: "MyCityApp NG's national content calendar, recognized and approved by the Federal Government of Nigeria.", source_note: "MyCity's standard agreement wording" },
  { kind: "endorsement", label: "MTN Nigeria", detail: "Supports the Ember to Remember calendar.", source_note: "MyCity's standard agreement wording" },
]);

async function seed({ pool, actor, log = () => {} }) {
  const categories = src("modules/partner_pipeline/partner_pipeline.categories");
  const checklists = src("modules/partner_pipeline/partner_pipeline.checklists");
  const lists = src("modules/partner_pipeline/partner_pipeline.lists");
  const fields = src("modules/partner_pipeline/partner_pipeline.fields");
  const proof = src("modules/proposals/proposals.proof");
  const repo = src("modules/partner_pipeline/partner_pipeline.repo");

  const n = { stages: 0, impacts: 0, kinds: 0, categories: 0, checklist: 0, templates: 0, fields: 0, proof: 0 };

  for (const [label, meaning] of STAGES) {
    if (await repo.valueByLabel(pool, lists.STAGES, label)) continue;
    await lists.add(actor, lists.STAGES, { label, meaning });
    n.stages += 1;
  }
  for (const label of IMPACTS) {
    if (await repo.valueByLabel(pool, "partnership_impact", label)) continue;
    await lists.add(actor, "partnership_impact", { label });
    n.impacts += 1;
  }
  for (const label of DOCUMENT_KINDS) {
    if (await repo.valueByLabel(pool, "partner_document_kind", label)) continue;
    await lists.add(actor, "partner_document_kind", { label });
    n.kinds += 1;
  }
  for (const c of CATEGORIES) {
    if (await repo.categoryByName(pool, c.name)) continue;
    await categories.create(actor, c);
    n.categories += 1;
  }

  const events = await repo.categoryByName(pool, "Event");
  const id = events.partner_category_id;
  const have = await categories.detail(id);

  for (const item of CHECKLIST) {
    if (have.checklist.some((i) => i.title === item.title)) continue;
    await checklists.addItem(actor, id, item);
    n.checklist += 1;
  }
  if (!have.fields.some((f) => f.label === "Ticket Model")) {
    await fields.create(actor, { label: "Ticket Model", field_type: "pick", options: ["Free Entry", "Paid Tickets", "App Download"], applies_to: "deal", partner_category_id: id, filterable: true });
    n.fields += 1;
  }
  if (!have.templates.some((t) => t.label === "Deal Merchant Agreement")) {
    await categories.addTemplate(actor, id, {
      kind: "deal_merchant",
      label: "Deal Merchant Agreement",
      title: "Deal Merchant Agreement",
      countersigned: true,
      is_default: true,
      body_html: AGREEMENT,
      asks: ASKS,
    });
    n.templates += 1;
  }

  const kept = new Set((await pool.query("SELECT label FROM proof_point")).rows.map((r) => r.label));
  for (const p of PROOF_POINTS) {
    if (kept.has(p.label)) continue;
    await proof.create(actor, p);
    n.proof += 1;
  }

  log(`partnerships: ${n.stages} stages, ${n.impacts} impacts, ${n.kinds} document kinds, ${n.categories} categories, ${n.checklist} checklist items, ${n.fields} field, ${n.templates} template, ${n.proof} proof points`);
}

module.exports = seed;
module.exports.STAGES = STAGES;
module.exports.DOCUMENT_KINDS = DOCUMENT_KINDS;
module.exports.AGREEMENT = AGREEMENT;
module.exports.ASKS = ASKS;
module.exports.CHECKLIST = CHECKLIST;
