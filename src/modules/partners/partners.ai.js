"use strict";
/**
 * What the assistant may read and do about partners and their contacts (docs/guides/partnerships.md
 * §9): the partners the asker may see, a page of 25 at a time, and one Partner 360, by the rule the
 * screen keeps (§6.1), money left out without `partnerships.money`; and, as cards the person
 * confirms (docs/guides/praxis-ai.md §6.11, decision 33), New Partner (signed before the hub), Edit
 * Partner, Add Contact and Edit Contact, each through the screen's own service function.
 *
 * A signed copy and a logo are files, never in the chat; Close Partner loses every open deal with it,
 * so it stays on the Partner 360. Upload Document is reached from a contract or MoU attached on Ask
 * (praxis-ai.md §6.18): Add Partner Document files it on the partner or lead its parties name, its
 * kind by its name, through Upload Document's own service.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const { parseBody } = require("../../shared/http/validate");
const routeMap = require("../../shared/route-map");
const maps = require("../maps/maps.service");
const pipeline = require("../partner_pipeline/partner_pipeline.service");
const service = require("./partners.service");
const work = require("./partners.work");
const documents = require("./partners.documents");

const link = (id) => (routeMap.linkFor("partner", id) || {}).path || null;
/** The partner a card made or changed, read back as a line that opens its 360. */
const partnerLine = (status) => (p) => [{ type: "partner", id: p.partner.partner_id, label: `${p.partner.number} ${p.partner.name}`, status, link: link(p.partner.partner_id) }];
/** The contact a card added or changed, read back with its record's link. */
const contactLine = (status) => (ct) => {
  const type = ct.partner_id ? "partner" : "lead";
  const id = ct.partner_id || ct.lead_id;
  return [{ type: "partner_contact", id: ct.partner_contact_id, label: `${ct.first_name} ${ct.last_name}`, status, link: (routeMap.linkFor(type, id) || {}).path || null }];
};
const cite = (row) => ({ type: "partner", id: row.partner_id || row.partner.partner_id, label: row.name || row.partner.name });
const SCOPES = ["Cities", "National", "Africa", "Worldwide"];

/** New Partner's own request from the card's flat fields: signed before the hub. */
function partnerCreate(v) {
  return parseBody(c.partners.PartnerCreate, {
    name: v.name,
    partner_category_id: v.partner_category_id,
    region: { scope: v.region_scope, ...(v.region_scope === "cities" && v.city ? { cities: [{ token: v.city }] } : {}) },
    industry: v.industry,
    owner_id: v.owner_id,
    since: v.since,
    contact: {
      first_name: v.contact_first_name,
      last_name: v.contact_last_name,
      job_title: v.contact_job_title,
      email: v.contact_email,
      ...(v.contact_phone ? { phones: [v.contact_phone] } : {}),
    },
    deal: { title: v.deal_title, stage: v.deal_stage, estimated_value: v.estimated_value, owner_id: v.owner_id },
    signed_before_hub: true,
  });
}

module.exports = defineManifest({
  module: "partnerships",
  actions: [
    {
      key: "partners.create",
      label: "Create Partner",
      description: "Record a partner whose relationship was signed before the hub: the organisation, its category and region, owner, primary contact and its signed deal",
      input: c.partners.PartnerAdd,
      permission: ["partnerships", "create"],
      risk: "standard",
      form: "none: New Partner's form also takes the signed copy (a file), headquarters, logo and the deal's options; the card records one signed before the hub (PartnerAdd)",
      picks: { owner_id: "employee", city: "place" },
      resolve: { city: (value) => maps.onePlace(value, { level: "city" }) },
      names: async (values, _actor, db) => [...(await pipeline.cardNames(db, values)), ...maps.cardPlace(values.city)],
      asks: [
        { field: "name", question: "What is the organisation called?" },
        { field: "partner_category_id", question: "Which category is it?", read: "categories.list" },
        { field: "region_scope", question: "Where does it work?", choices: SCOPES },
        { field: "city", question: "Which city?", when: { field: "region_scope", not: ["national", "africa", "worldwide"] } },
        { field: "owner_id", question: "Who owns the partnership?", read: "employees.list" },
        { field: "contact_first_name", question: "Who is the contact there?" },
        { field: "contact_last_name", question: "What is their last name?" },
        { field: "deal_title", question: "What was signed?" },
      ],
      run: (values, actor) => service.create(actor, actor.scope, partnerCreate(values)),
      readback: partnerLine("added"),
      labels: {
        name: "Name",
        partner_category_id: "Category",
        region_scope: "Region",
        city: "City",
        industry: "Industry",
        owner_id: "Owner",
        since: "Since",
        contact_first_name: "Contact First Name",
        contact_last_name: "Contact Last Name",
        contact_job_title: "Contact Position",
        contact_email: "Contact Email",
        contact_phone: "Contact Phone",
        deal_title: "Deal",
        deal_stage: "Stage",
        estimated_value: "Value",
      },
    },
    {
      key: "partners.update",
      label: "Save Partner",
      description: "Change a partner's own details: its name, legal name, category, industry, website, owner or since; only what changes",
      input: c.partners.PartnerChange,
      permission: ["partnerships", "edit"],
      risk: "standard",
      form: "none: Edit Partner's form changes the partner open on its 360 and never names it; the card names the partner (PartnerChange)",
      picks: { owner_id: "employee" },
      names: (values, _actor, db) => pipeline.cardNames(db, values),
      asks: [{ field: "partner_id", question: "Which partner is it?", read: "partners.list" }],
      records: (values) => (values.partner_id ? [{ type: "partner", id: values.partner_id }] : []),
      run: (values, actor) => {
        const { partner_id: id, ...changes } = values;
        return service.update(actor, actor.scope, id, parseBody(c.partners.PartnerUpdate, changes));
      },
      readback: partnerLine("saved"),
      labels: { partner_id: "Partner", name: "Name", legal_name: "Legal Name", partner_category_id: "Category", owner_id: "Owner" },
    },
    {
      key: "contacts.create",
      label: "Add Contact",
      description: "Add a contact person to a partner or a lead: their name, position, email and phone numbers, and whether they sign",
      input: c.partners.ContactCreate,
      permission: ["partnerships", "edit"],
      risk: "standard",
      names: (values, _actor, db) => pipeline.cardNames(db, values),
      asks: [
        { field: "partner_id", question: "Whose contact is it?", read: "partners.list" },
        { field: "first_name", question: "What is their first name?" },
        { field: "last_name", question: "What is their last name?" },
      ],
      run: (values, actor) => service.createContact(actor, actor.scope, values),
      readback: contactLine("added"),
      labels: { partner_id: "Partner", lead_id: "Lead", first_name: "First Name", last_name: "Last Name", job_title: "Position", phones: "Phones" },
    },
    {
      key: "contacts.update",
      label: "Save Contact",
      description: "Change a partner's or lead's contact: their name, position, email, phone numbers, or whether they are the primary contact or a signatory",
      input: c.partners.ContactChange,
      permission: ["partnerships", "edit"],
      risk: "standard",
      form: "none: Edit Contact changes the contact pressed on a 360 and never names it; the card names the contact (ContactChange)",
      names: (values, _actor, db) => pipeline.cardNames(db, values),
      // A contact is named, never picked: matched among the records the person may see.
      resolve: { partner_contact_id: (value, actor, db) => service.contactIdOf(db, value, actor.scope) },
      asks: [{ field: "partner_contact_id", question: "Which contact is it?" }],
      records: (values) => (values.partner_contact_id ? [{ type: "partner_contact", id: values.partner_contact_id }] : []),
      run: (values, actor) => {
        const { partner_contact_id: id, ...changes } = values;
        return service.updateContact(actor, actor.scope, id, parseBody(c.partners.ContactUpdate, changes));
      },
      readback: contactLine("saved"),
      labels: { partner_contact_id: "Contact", first_name: "First Name", last_name: "Last Name", job_title: "Position", phones: "Phones" },
    },
    {
      key: "partner_documents.attach",
      label: "Add Partner Document",
      description: "File an attached contract or MoU among a partner's or a lead's documents (one or the other, never both), its kind by name, and its deal if any",
      input: c.partners.PartnerDocumentAdd,
      permission: ["partnerships", "edit"],
      risk: "standard",
      form: "none: Upload Document's form picks its kind from MyCity's list by code; the card carries the kind by its name (PartnerDocumentAdd), drawn from an attached contract or MoU",
      from_file: { kind: "contract", fills: ["document_id"] },
      fields: ["document_id", "kind", "partner_id", "lead_id", "deal_id"],
      // Picked, named and found from words as Connect to Partner's are; a kind by its name, as the list writes it.
      picks: work.card.picks,
      resolve: { ...work.card.resolve, kind: (value, _actor, db) => documents.kindNameOf(db, value) },
      names: async (values, actor, db) => [...(await work.card.names(values, actor, db)), ...(await documents.cardFile(db, values.document_id, actor))],
      asks: [
        { field: "partner_id", question: "Whose document is it?", read: "partners.list", none: true },
        { field: "kind", question: "What kind is it?", options: ({ db }) => documents.kindLabels(db) },
      ],
      check: (client, values) => documents.assertCard(client, values),
      run: (values, actor) => documents.cardAttach(actor, values),
      readback: documents.cardReadback,
      labels: { document_id: "Document", kind: "Kind", partner_id: "Partner", lead_id: "Lead", deal_id: "Deal" },
    },
  ],
  // Every create and edit form of the partners contract, and how the chat reaches it (gate 23, decision 33).
  not_offered: {
    PartnerCreate: "via partners.create: New Partner's own request, with the signed copy, headquarters, logo and options; the card is PartnerAdd, signed before the hub",
    PartnerUpdate: "via partners.update: Edit Partner's own request, which never names its partner; the card is PartnerChange",
    ContactUpdate: "via contacts.update: Edit Contact's own request, which never names its contact; the card is ContactChange",
  },
  reads: [
    {
      key: "partners.list",
      description: "List partners: name, category, region, status (active, dormant, closed), their furthest deal's stage and health, owner and last contact",
      params: c.partners.PartnerListQuery,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.list(params, actor.scope),
      cite,
    },
    {
      key: "partners.get",
      summary: "none: one record",
      description: "One partner's whole picture: signed value, returns and downloads this year, active deals, days since contact, its deals, contacts and latest interactions",
      params: c.common.IdParams,
      permission: ["partnerships", "view"],
      run: (_client, params, actor) => service.get360(params.id, actor.scope, actor),
      cite,
    },
  ],
  routes: [
    { intent: "add a partner already signed", screen: "partnerships.partners", params: { new: "1" } },
    { intent: "see the partners and their 360", screen: "partnerships.partners" },
  ],
});
