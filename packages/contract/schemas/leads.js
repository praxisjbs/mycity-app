"use strict";
/**
 * Leads (docs/guides/partnerships.md §3 steps 1 and 6, §4.2, §5, §6.2, §6.4): an organisation MyCity
 * is pursuing that has not signed. A lead is captured with its first deal, and its status is read
 * from that deal's stage, never typed:
 *
 *   new        the deal's stage means `prospect`
 *   contacted  `contacted` or `meeting`
 *   qualified  `proposal` or `negotiation`
 *   lost       `closed_lost` (Close as Lost)
 *   converted  `signed` or `active`: the lead became a partner in the same transaction
 *
 * On Hold shows a pill and keeps the status it had. A converted lead is read only and links to its
 * partner.
 */
const { z } = require("zod");
const { uuid, text, optionalText, email, phone, isoDate, isoDateTime, money, blank, listQuery, Paged, recordId, changesBeside, nothingOn } = require("./common");
const { PlaceToken } = require("./maps");
const { PersonRef } = require("./organisation");
const { RegionScope, DealHealth, DealFields, DealDetail, ImpactRating, Field, CustomValues, CustomFilter, listCode, listWords } = require("./partner_pipeline");
const { RegionInput, RegionView, ContactInput, Contact, EventBrief } = require("./partners");
const { Interaction } = require("./interactions");

const LeadStatus = z.enum(["new", "contacted", "qualified", "lost", "converted"]);

/** The lead's own fields, shared by New Lead and Edit. */
const LeadFields = z
  .object({
    name: text(150),
    partner_category_id: uuid,
    region: RegionInput,
    industry: optionalText(80),
    website: optionalText(200),
    objective: optionalText(2000),
    /** A lead source by its name or its code; a name the list does not hold joins it (§6.3). */
    source: blank(listWords),
    owner_id: uuid,
    identified_on: blank(isoDate),
    /** Impacts by name or code; a name the list does not hold joins it. */
    impact: z.array(listWords).max(9).optional(),
    impact_rating: blank(ImpactRating),
    impact_note: optionalText(500),
    comments: optionalText(2000),
    custom: CustomValues.optional(),
  })
  .strict();

/** New Lead, with its primary contact and its first deal, which opens at the first stage unless one is given. */
const LeadCreate = LeadFields.extend({
  contact: ContactInput,
  deal: DealFields,
}).strict();

const LeadUpdate = z
  .object({
    name: text(150).optional(),
    partner_category_id: uuid.optional(),
    region: RegionInput.optional(),
    industry: z.string().trim().max(80).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    objective: z.string().trim().max(2000).nullable().optional(),
    source: listWords.nullable().optional(),
    owner_id: uuid.optional(),
    identified_on: isoDate.nullable().optional(),
    impact: z.array(listWords).max(9).optional(),
    impact_rating: ImpactRating.nullable().optional(),
    impact_note: z.string().trim().max(500).nullable().optional(),
    comments: z.string().trim().max(2000).nullable().optional(),
    custom: CustomValues.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/** Close as Lost: its deal moves to the first `closed_lost` stage with this reason. */
const LeadLose = z.object({ reason: z.string().trim().min(10, "At least 10 characters").max(1000) }).strict();

/** Convert to Partner, for a deal signed outside the hub: it asks for the signed copy. Idempotent. */
const LeadConvert = z.object({ signed_copy_document_id: blank(uuid) }).strict();

const LeadConverted = z.object({ partner_id: uuid }).strict();

/* ------------------------------------------------------------------ *
 * Praxis AI's cards on leads (docs/guides/partnerships.md §9; praxis-ai.md §6.11, decision 33):
 * flat fields the chat can carry, each reaching New Lead's, Edit Lead's or Close as Lost's own
 * service function. One city of the region; more, the deal's options, venue and custom values are
 * set on the 360.
 * ------------------------------------------------------------------ */

const CITY = { message: "Pick a city", path: ["city"] };

/** New Lead as a card: the organisation, its primary contact and its first deal. */
const LeadAdd = z
  .object({
    name: text(150),
    partner_category_id: uuid,
    region_scope: RegionScope,
    /** With `cities`: the city, picked as every address is. */
    city: PlaceToken.optional(),
    industry: optionalText(80),
    source: listCode.optional(),
    owner_id: uuid,
    contact_first_name: text(80),
    contact_last_name: text(80),
    contact_job_title: optionalText(120),
    contact_email: blank(email),
    contact_phone: blank(phone),
    deal_title: text(150),
    deal_objective: optionalText(2000),
    deal_stage: listCode.optional(),
    estimated_value: blank(money),
    expected_close_on: blank(isoDate),
  })
  .strict()
  .refine((v) => v.region_scope !== "cities" || Boolean(v.city), CITY);

/** Edit Lead as a card: the lead beside the fields that change. */
const LeadChange = z
  .object({
    lead_id: recordId("lead"),
    name: text(150).optional(),
    partner_category_id: uuid.optional(),
    industry: z.string().trim().max(80).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    objective: z.string().trim().max(2000).nullable().optional(),
    source: listCode.nullable().optional(),
    owner_id: uuid.optional(),
    identified_on: isoDate.nullable().optional(),
    impact_rating: ImpactRating.nullable().optional(),
    impact_note: z.string().trim().max(500).nullable().optional(),
    comments: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine(changesBeside(["lead_id"]), nothingOn("lead_id"));

/** Close as Lost as a card: the lead and why. */
const LeadClose = z
  .object({
    lead_id: recordId("lead"),
    reason: z.string().trim().min(10, "At least 10 characters").max(1000),
  })
  .strict();

/** One lead as the list shows it. */
const LeadRow = z
  .object({
    lead_id: uuid,
    number: z.string(),
    name: z.string(),
    partner_category_id: uuid.nullable(),
    category: z.string().nullable(),
    region: z.string().nullable(),
    status: LeadStatus,
    /** Its deal's stage is On Hold: a pill beside the status it kept. */
    on_hold: z.boolean(),
    stage_label: z.string().nullable(),
    health: DealHealth.nullable(),
    owner: PersonRef.nullable(),
    last_contact_at: isoDateTime.nullable(),
    identified_on: isoDate.nullable(),
    created_at: isoDateTime,
  })
  .strict();

const LeadDetail = LeadRow.extend({
  industry: z.string().nullable(),
  website: z.string().nullable(),
  objective: z.string().nullable(),
  source: z.string().nullable(),
  source_label: z.string().nullable(),
  region_view: RegionView,
  impact: z.array(z.string()),
  /** Its impacts by name, in the list's order: what Edit Lead's Impact holds. */
  impact_labels: z.array(z.string()),
  impact_rating: ImpactRating.nullable(),
  impact_note: z.string().nullable(),
  comments: z.string().nullable(),
  custom: CustomValues,
  lost_reason: z.string().nullable(),
  converted_partner_id: uuid.nullable(),
  converted_at: isoDateTime.nullable(),
}).strict();

const LeadListQuery = listQuery(
  {
    /** Leave it out for every lead but the lost ones (the Lost chip asks for `lost`). */
    status: LeadStatus.optional(),
    partner_category_id: uuid.optional(),
    owner_id: uuid.optional(),
    source: listCode.optional(),
    region_scope: RegionScope.optional(),
    region_city: z.string().trim().min(1).max(120).optional(),
    stage: listCode.optional(),
    health: DealHealth.optional(),
    custom: CustomFilter.optional(),
  },
  ["identified_on", "name", "created_at"],
);
const LeadPage = Paged(LeadRow);

/** The cards above Leads, and leads by source. */
const LeadsSummary = z
  .object({
    new: z.number().int().min(0),
    contacted: z.number().int().min(0),
    qualified: z.number().int().min(0),
    converted_this_month: z.number().int().min(0),
    by_source: z
      .array(z.object({ source: z.string().nullable(), label: z.string(), leads: z.number().int().min(0) }).strict())
      .max(25),
  })
  .strict();

/** The Lead 360 (§6.2): one call, zero-data safe, for a lead made a minute ago. */
const Lead360 = z
  .object({
    lead: LeadDetail,
    kpis: z
      .object({
        projected_value: money,
        days_at_stage: z.number().int().min(0),
        health: DealHealth.nullable(),
        days_since_contact: z.number().int().min(0).nullable(),
      })
      .strict(),
    deal: DealDetail.nullable(),
    contacts: z.array(Contact).max(25),
    overview: z
      .object({
        events: z.array(EventBrief).max(3),
        interactions: z.array(Interaction).max(5),
      })
      .strict(),
    custom_fields: z.array(Field).max(200),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const DEAL_NESTED = {
  table: "partnership_opportunity",
  virtual: { venue: "a place row, owner deal.venue", validity: "validity_days or valid_until", member_ids: "deal_member rows", options: "deal_option rows" },
};
const REGION = "region_scope, and the place rows of lead.cities";
const ROW = {
  category: "partner_category.name",
  region: "its region as a list shows it",
  on_hold: "its deal's stage means on_hold",
  stage_label: "its deal's stage",
  health: "its deal's health",
  owner: "the person, from employee and department",
  last_contact_at: "its latest interaction",
};
const TABLES = {
  LeadFields: { table: "lead", virtual: { region: REGION } },
  LeadCreate: {
    table: "lead",
    virtual: { region: REGION },
    nested: { contact: { table: "partner_contact" }, deal: DEAL_NESTED },
  },
  LeadUpdate: { table: "lead", virtual: { region: REGION } },
  LeadLose: { table: null, reason: "the reason, kept as lead.lost_reason and on its deal" },
  LeadConvert: { table: null, reason: "the signed copy that converts the lead" },
  LeadConverted: { table: null, reason: "the partner the lead became" },
  LeadAdd: {
    table: "lead",
    virtual: {
      city: "a place row, owner lead.cities",
      contact_first_name: "the primary partner_contact.first_name",
      contact_last_name: "the primary partner_contact.last_name",
      contact_job_title: "the primary partner_contact.job_title",
      contact_email: "the primary partner_contact.email",
      contact_phone: "the primary partner_contact.phone",
      deal_title: "its first partnership_opportunity.title",
      deal_objective: "its first partnership_opportunity.objective",
      deal_stage: "its first partnership_opportunity.stage",
      estimated_value: "its first partnership_opportunity.estimated_value",
      expected_close_on: "its first partnership_opportunity.expected_close_on",
    },
  },
  LeadChange: { table: "lead" },
  LeadClose: { table: null, reason: "the lead and the reason, kept as lead.lost_reason and on its deal" },
  LeadRow: { table: "lead", virtual: ROW },
  LeadDetail: {
    table: "lead",
    virtual: { ...ROW, source_label: "the lead_source label", impact_labels: "the names of its impacts, from reference_value", region_view: REGION },
  },
  LeadListQuery: { table: null, reason: "list controls and filters for the leads" },
  LeadPage: { table: null, reason: "a page of leads" },
  LeadsSummary: { table: null, reason: "figures over the leads" },
  Lead360: { table: null, reason: "the Lead 360: the lead, its figures, its deal and its collections" },
};

module.exports = {
  TABLES,
  LeadStatus,
  LeadFields,
  LeadCreate,
  LeadUpdate,
  LeadLose,
  LeadConvert,
  LeadConverted,
  LeadAdd,
  LeadChange,
  LeadClose,
  LeadRow,
  LeadDetail,
  LeadListQuery,
  LeadPage,
  LeadsSummary,
  Lead360,
};
