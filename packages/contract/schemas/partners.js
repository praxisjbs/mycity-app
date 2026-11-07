"use strict";
/**
 * Partners (docs/guides/partnerships.md §3, §4.2, §5, §6.1, §6.2, §6.6, §6.16): an organisation with at
 * least one signed deal; its contacts; the Partner 360; duplicates over leads and partners; every
 * document of a record; the Work tab; and the link a project, task or event carries to a partner or a
 * lead (Connect to Partner).
 *
 * A lead becomes a partner when its deal is signed (§6.4); New Partner records one whose relationship
 * is already signed, with its first deal at a signed or active stage and either a signed copy or
 * "signed before the hub" (§6.6).
 *
 * Headquarters (an area) and the region's cities are picked, never typed (F27): `PlaceInput`, kept as
 * place rows by the owning service (owners partner.headquarters, partner.cities and lead.cities).
 *
 * Statuses: active while any deal is live; dormant when none is; closed by Close Partner.
 */
const { z } = require("zod");
const { uuid, text, optionalText, email, phone, isoDate, isoDateTime, money, blank, listQuery, Paged, recordId, changesBeside, nothingOn } = require("./common");
const { PersonRef } = require("./organisation");
const { DocumentRef } = require("./documents");
const { PlaceInput, PlaceView, PlaceToken } = require("./maps");
const { RegionScope, DealHealth, DealFields, DealRow, Deliverable, RecordHistoryLine, Field, CustomValues, CustomFilter, listCode, flag } = require("./partner_pipeline");
const { Interaction } = require("./interactions");

const PartnerStatus = z.enum(["active", "dormant", "closed"]);

/* ------------------------------------------------------------------ *
 * Region, shared by leads and partners
 * ------------------------------------------------------------------ */

/** A record's region: a scope, and with `cities`, the cities picked from the address search. */
const RegionInput = z
  .object({
    scope: RegionScope,
    cities: z.array(PlaceInput).max(20).optional(),
  })
  .strict()
  .refine((v) => v.scope !== "cities" || (v.cities && v.cities.length > 0), { message: "Pick a city", path: ["cities"] });

const RegionView = z
  .object({
    scope: RegionScope.nullable(),
    cities: z.array(PlaceView),
    /** As a list shows it: "Lagos, Ibadan" or "National". */
    label: z.string().nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Contacts
 * ------------------------------------------------------------------ */

/** A person at a lead or a partner, as New Lead, New Partner and Add Contact ask. */
const ContactInput = z
  .object({
    first_name: text(80),
    last_name: text(80),
    job_title: optionalText(120),
    email: blank(email),
    phones: z.array(phone).max(4).optional(),
    signatory: z.boolean().optional(),
  })
  .strict();

const Contact = z
  .object({
    partner_contact_id: uuid,
    partner_id: uuid.nullable(),
    lead_id: uuid.nullable(),
    first_name: z.string(),
    last_name: z.string(),
    job_title: z.string().nullable(),
    email: z.string().nullable(),
    phones: z.array(z.string()),
    primary_contact: z.boolean(),
    signatory: z.boolean(),
    created_at: isoDateTime,
  })
  .strict();

/** Add Contact, on a lead or a partner. */
const ContactCreate = ContactInput.extend({
  partner_id: blank(uuid),
  lead_id: blank(uuid),
  primary_contact: z.boolean().optional(),
})
  .strict()
  .refine((v) => Boolean(v.partner_id) !== Boolean(v.lead_id), { message: "Pick the lead or the partner", path: ["partner_id"] });

const ContactUpdate = z
  .object({
    first_name: text(80).optional(),
    last_name: text(80).optional(),
    job_title: z.string().trim().max(120).nullable().optional(),
    email: email.nullable().optional(),
    phones: z.array(phone).max(4).optional(),
    signatory: z.boolean().optional(),
    primary_contact: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/** Edit Contact as a card: the contact beside the fields that change. */
const ContactChange = z
  .object({
    partner_contact_id: recordId("contact"),
    first_name: text(80).optional(),
    last_name: text(80).optional(),
    job_title: z.string().trim().max(120).nullable().optional(),
    email: email.nullable().optional(),
    phones: z.array(phone).max(4).optional(),
    signatory: z.boolean().optional(),
    primary_contact: z.boolean().optional(),
  })
  .strict()
  .refine(changesBeside(["partner_contact_id"]), nothingOn("partner_contact_id"));

/* ------------------------------------------------------------------ *
 * Partners
 * ------------------------------------------------------------------ */

const signedEvidence = (v) => Boolean(v.signed_copy_document_id) !== (v.signed_before_hub === true);

/** A partner's own fields, shared by New Partner and Edit Partner (as a lead's are, LeadFields). */
const PartnerFields = z
  .object({
    name: text(150),
    legal_name: optionalText(200),
    partner_category_id: uuid,
    region: RegionInput,
    industry: optionalText(80),
    website: optionalText(200),
    /** Picked from the address search at the level of an area; null or left out for none. */
    headquarters: PlaceInput.nullish(),
    logo_document_id: blank(uuid),
    owner_id: uuid,
    since: blank(isoDate),
    custom: CustomValues.optional(),
  })
  .strict();

/**
 * New Partner: an organisation whose relationship is already signed. Its first deal is at a signed or
 * active stage (the server checks the stage's meaning), with the signed copy or "signed before the hub".
 */
const PartnerCreate = PartnerFields.extend({
  contact: ContactInput,
  deal: DealFields,
  signed_copy_document_id: blank(uuid),
  signed_before_hub: z.boolean().optional(),
})
  .strict()
  .refine(signedEvidence, { message: "Attach the signed copy", path: ["signed_copy_document_id"] });

const PartnerUpdate = z
  .object({
    name: text(150).optional(),
    legal_name: z.string().trim().max(200).nullable().optional(),
    partner_category_id: uuid.optional(),
    region: RegionInput.optional(),
    industry: z.string().trim().max(80).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    headquarters: PlaceInput.nullable().optional(),
    logo_document_id: uuid.nullable().optional(),
    owner_id: uuid.optional(),
    since: isoDate.nullable().optional(),
    custom: CustomValues.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/** Close Partner: its open deals are lost with it, each with this reason. */
const PartnerClose = z.object({ reason: z.string().trim().min(10, "At least 10 characters").max(1000) }).strict();

/* ------------------------------------------------------------------ *
 * Praxis AI's cards on partners and contacts (docs/guides/partnerships.md §9; praxis-ai.md §6.11,
 * decision 33): flat fields the chat can carry, each reaching the screen's own service function.
 * A card records a partner signed before the hub; a signed copy is a file, attached on its screen.
 * ------------------------------------------------------------------ */

/** New Partner as a card: the organisation, its primary contact and its first deal, signed before the hub. */
const PartnerAdd = z
  .object({
    name: text(150),
    partner_category_id: uuid,
    region_scope: RegionScope,
    /** With `cities`: the city, picked as every address is. */
    city: PlaceToken.optional(),
    industry: optionalText(80),
    owner_id: uuid,
    since: blank(isoDate),
    contact_first_name: text(80),
    contact_last_name: text(80),
    contact_job_title: optionalText(120),
    contact_email: blank(email),
    contact_phone: blank(phone),
    deal_title: text(150),
    /** A signed or active stage; the first signed one when left out. */
    deal_stage: listCode.optional(),
    estimated_value: blank(money),
  })
  .strict()
  .refine((v) => v.region_scope !== "cities" || Boolean(v.city), { message: "Pick a city", path: ["city"] });

/** Edit Partner as a card: the partner beside the fields that change. */
const PartnerChange = z
  .object({
    partner_id: recordId("partner"),
    name: text(150).optional(),
    legal_name: z.string().trim().max(200).nullable().optional(),
    partner_category_id: uuid.optional(),
    industry: z.string().trim().max(80).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    owner_id: uuid.optional(),
    since: isoDate.nullable().optional(),
  })
  .strict()
  .refine(changesBeside(["partner_id"]), nothingOn("partner_id"));

/** One partner as the list shows it. */
const PartnerRow = z
  .object({
    partner_id: uuid,
    number: z.string(),
    name: z.string(),
    partner_category_id: uuid.nullable(),
    category: z.string().nullable(),
    region: z.string().nullable(),
    status: PartnerStatus,
    /** Its furthest live or open deal's stage. */
    stage_label: z.string().nullable(),
    health: DealHealth.nullable(),
    owner: PersonRef.nullable(),
    last_contact_at: isoDateTime.nullable(),
    since: isoDate.nullable(),
  })
  .strict();

const PartnerDetail = PartnerRow.extend({
  legal_name: z.string().nullable(),
  industry: z.string().nullable(),
  website: z.string().nullable(),
  country_code: z.string().nullable(),
  headquarters: PlaceView.nullable(),
  region_view: RegionView,
  logo: DocumentRef.nullable(),
  lead_id: uuid.nullable(),
  custom: CustomValues,
  closed_at: isoDateTime.nullable(),
  close_reason: z.string().nullable(),
  /** Signed before the hub: shown on its Documents tab and on verification. */
  signed_outside: z.boolean(),
  created_at: isoDateTime,
}).strict();

const PartnerListQuery = listQuery(
  {
    status: PartnerStatus.optional(),
    partner_category_id: uuid.optional(),
    owner_id: uuid.optional(),
    region_scope: RegionScope.optional(),
    region_city: z.string().trim().min(1).max(120).optional(),
    stage: listCode.optional(),
    health: DealHealth.optional(),
    /** No contact since the start of the day the Partner Inactivity rule names (§6.12). */
    quiet: flag.optional(),
    custom: CustomFilter.optional(),
  },
  ["name", "last_contact_at", "since", "created_at"],
);
const PartnerPage = Paged(PartnerRow);

/** The cards above Partners. */
const PartnersSummary = z
  .object({
    active: z.number().int().min(0),
    dormant: z.number().int().min(0),
    quiet: z.number().int().min(0),
    live_deals: z.number().int().min(0),
    signed_value: money,
    /** The days without contact that make an active partner quiet: the enabled Partner Inactivity rule's, else 30 (§6.12). */
    quiet_days: z.number().int().min(1),
  })
  .strict();

/** A calendar event connected to a record, as its Overview lists the next three. */
const EventBrief = z
  .object({
    calendar_event_id: uuid,
    title: z.string(),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    event_type: z.string(),
  })
  .strict();

/**
 * The Partner 360 (§6.2): one call, zero-data safe: every figure 0 and every collection [] for a
 * partner made a minute ago. Returns This Year is absent without `partnerships.money`; Downloads This
 * Year takes its place on screen.
 */
const Partner360 = z
  .object({
    partner: PartnerDetail,
    kpis: z
      .object({
        signed_value: money,
        returns_this_year: money.optional(),
        downloads_this_year: z.number().int().min(0),
        active_deals: z.number().int().min(0),
        days_since_contact: z.number().int().min(0).nullable(),
      })
      .strict(),
    deals: z.array(DealRow).max(25),
    contacts: z.array(Contact).max(25),
    overview: z
      .object({
        events: z.array(EventBrief).max(3),
        interactions: z.array(Interaction).max(5),
      })
      .strict(),
    deliverables: z.array(Deliverable).max(25),
    custom_fields: z.array(Field).max(200),
    /** The stage and health lines of the deals the reader sees, the latest 25, newest first (Activity, §6.2). */
    history: z.array(RecordHistoryLine).max(25),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Duplicates (§6.2): advisory, over leads and partners
 * ------------------------------------------------------------------ */

const DuplicateQuery = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    email: email.optional(),
    phone: phone.optional(),
    website: z.string().trim().min(3).max(200).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Give a name, email, phone or website");

const Duplicates = z
  .object({
    candidates: z
      .array(
        z
          .object({
            type: z.enum(["lead", "partner"]),
            id: uuid,
            number: z.string(),
            name: z.string(),
            /** 55 to 100: a match from 55. */
            score: z.number().int().min(0).max(100),
            /** What matched: name, email, phone, website. */
            reasons: z.array(z.enum(["name", "email", "phone", "website"])),
          })
          .strict(),
      )
      .max(25),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Documents (§2): every document of a record
 * ------------------------------------------------------------------ */

const PartnerDocumentQuery = listQuery(
  {
    partner_id: uuid.optional(),
    lead_id: uuid.optional(),
    deal_id: uuid.optional(),
    kind: listCode.optional(),
  },
  ["created_at"],
);

/** Upload Document: a vault upload tagged for a record, with its kind (a partner_document_kind code). */
const PartnerDocumentAttach = z
  .object({
    document_id: uuid,
    kind: listCode,
    partner_id: blank(uuid),
    lead_id: blank(uuid),
    deal_id: blank(uuid),
  })
  .strict()
  .refine((v) => Boolean(v.partner_id) !== Boolean(v.lead_id), { message: "Pick the lead or the partner", path: ["partner_id"] });

const PartnerDocument = z
  .object({
    document: DocumentRef,
    kind: z.string().nullable(),
    kind_label: z.string().nullable(),
    deal_id: uuid.nullable(),
    /** Where it came from: an upload, a proposal, an agreement, a signed copy. */
    origin: z.enum(["upload", "proposal", "agreement", "signed_copy"]),
    uploaded_by: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();

const PartnerDocumentPage = Paged(PartnerDocument);

/* ------------------------------------------------------------------ *
 * Work (§6.16): what the reader may see, and how many they may not
 * ------------------------------------------------------------------ */

const WorkKind = z.enum(["project", "task", "event"]);

const PartnerWorkQuery = listQuery(
  {
    partner_id: uuid.optional(),
    lead_id: uuid.optional(),
    deal_id: uuid.optional(),
    kind: WorkKind,
  },
  ["due_on", "created_at"],
);

const PartnerWorkItem = z
  .object({
    kind: WorkKind,
    id: uuid,
    /** A project's or task's number; null for an event. */
    number: z.string().nullable(),
    title: z.string(),
    status: z.string(),
    /** A task's or project's due day, an event's day. */
    due_on: isoDate.nullable(),
    starts_at: isoDateTime.nullable(),
    deal_id: uuid.nullable(),
    owner: PersonRef.nullable(),
  })
  .strict();

/** A page of the work the reader may see, and how many items of each kind they may not ("3 more tasks you cannot see"). */
const PartnerWorkPage = Paged(PartnerWorkItem)
  .extend({
    hidden: z
      .object({
        projects: z.number().int().min(0),
        tasks: z.number().int().min(0),
        events: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

/**
 * Connect to Partner (§6.16): the link a project, task or event carries, to a partner or a lead and
 * one of its deals. Its keys join ProjectCreate, TaskCreate and CalendarEventCreate (and their edit
 * fields as `partnerLinkEditFields`), written by the Workspace services after Partnerships checks the
 * person sees the record and the deal (partners.work checkLink).
 */
const partnerLinkFields = {
  partner_id: blank(uuid),
  lead_id: blank(uuid),
  deal_id: blank(uuid),
};
/** A link's two rules, on a create body: a partner or a lead, not both; a deal only with one of them. */
const linkRules = (schema) =>
  schema
    .refine((v) => !(v.partner_id && v.lead_id), { message: "A partner or a lead, not both", path: ["lead_id"] })
    .refine((v) => !v.deal_id || Boolean(v.partner_id || v.lead_id), { message: "Pick the partner first", path: ["partner_id"] });
const PartnerLink = linkRules(z.object(partnerLinkFields).strict());

/**
 * The link on an edit: only what changes. A new partner or lead clears the other and, unless one is
 * given, the deal; `null` on both disconnects (the service decides against the work as it stands).
 */
const partnerLinkEditFields = {
  partner_id: uuid.nullable().optional(),
  lead_id: uuid.nullable().optional(),
  deal_id: uuid.nullable().optional(),
};
/** An edit names a partner or a lead, not both. */
const linkEditRules = (schema) => schema.refine((v) => !(v.partner_id && v.lead_id), { message: "A partner or a lead, not both", path: ["lead_id"] });

/**
 * The link as a task, project or event carries it on the way out. The names are filled only for a
 * reader who sees the record (and the deal) in Partnerships; anyone else reads the ids alone, so
 * connecting never shows a partner to someone who could not open it (§6.16, A24).
 */
const PartnerLinkView = z
  .object({
    partner_id: uuid.nullable(),
    lead_id: uuid.nullable(),
    deal_id: uuid.nullable(),
    name: z.string().nullable(),
    number: z.string().nullable(),
    deal_number: z.string().nullable(),
    deal_title: z.string().nullable(),
  })
  .strict();

/** The Partner filter on My Workspace's Tasks and Projects: a partner or a lead. */
const PartnerLinkQuery = z.object({ partner_id: uuid.optional(), lead_id: uuid.optional() }).strict();

const LinkKind = z.enum(["partner", "lead"]);

/** Connect to Partner's Partner (GET /work/records): partners not closed and leads still open, that the reader sees; `kind` one of the two. */
const PartnerLinkRecordQuery = listQuery({ kind: LinkKind.optional() }, ["name"]);
const PartnerLinkRecord = z
  .object({
    kind: LinkKind,
    id: uuid,
    number: z.string(),
    name: z.string(),
    category: z.string().nullable(),
  })
  .strict();
const PartnerLinkRecordPage = Paged(PartnerLinkRecord);

/**
 * Connect to Partner's Deal (GET /work/deals): the record's open and live deals the reader sees; with
 * no record (a Praxis AI card's Deal), every open and live deal they see.
 */
const PartnerLinkDealQuery = listQuery({ partner_id: uuid.optional(), lead_id: uuid.optional() });
const PartnerLinkDeal = z
  .object({
    deal_id: uuid,
    number: z.string(),
    title: z.string(),
    status: z.enum(["open", "live"]),
    /** The partner's or lead's name. */
    record_name: z.string(),
  })
  .strict();
const PartnerLinkDealPage = Paged(PartnerLinkDeal);

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const ORGANISATION = {
  region: "region_scope, and the place rows of partner.cities",
  headquarters: "a place row, owner partner.headquarters",
  contact: "the primary partner_contact",
  deal: "its first partnership_opportunity",
  signed_copy_document_id: "the first deal's signed copy",
  signed_before_hub: "the first deal was signed before the hub",
};
const DEAL_NESTED = {
  table: "partnership_opportunity",
  virtual: { venue: "a place row, owner deal.venue", validity: "validity_days or valid_until", member_ids: "deal_member rows", options: "deal_option rows" },
};
const TABLES = {
  RegionInput: { table: null, reason: "a record's region_scope and the place rows of its cities" },
  RegionView: { table: null, reason: "a record's region_scope and its cities' places" },
  ContactInput: { table: "partner_contact" },
  Contact: { table: "partner_contact" },
  ContactCreate: { table: "partner_contact" },
  ContactUpdate: { table: "partner_contact" },
  ContactChange: { table: "partner_contact" },
  PartnerFields: { table: "partner", virtual: { region: ORGANISATION.region, headquarters: ORGANISATION.headquarters } },
  PartnerCreate: {
    table: "partner",
    virtual: ORGANISATION,
    nested: { contact: { table: "partner_contact" }, deal: DEAL_NESTED },
  },
  PartnerUpdate: {
    table: "partner",
    virtual: { region: ORGANISATION.region, headquarters: ORGANISATION.headquarters },
  },
  PartnerAdd: {
    table: "partner",
    virtual: {
      city: "a place row, owner partner.cities",
      contact_first_name: "the primary partner_contact.first_name",
      contact_last_name: "the primary partner_contact.last_name",
      contact_job_title: "the primary partner_contact.job_title",
      contact_email: "the primary partner_contact.email",
      contact_phone: "the primary partner_contact.phone",
      deal_title: "its first partnership_opportunity.title",
      deal_stage: "its first partnership_opportunity.stage",
      estimated_value: "its first partnership_opportunity.estimated_value",
    },
  },
  PartnerChange: { table: "partner" },
  PartnerClose: { table: null, reason: "the reason, kept as partner.close_reason and on each open deal lost with it" },
  PartnerRow: {
    table: "partner",
    virtual: {
      category: "partner_category.name",
      region: "its region as a list shows it",
      stage_label: "its furthest live or open deal's stage",
      health: "that deal's health",
      owner: "the person, from employee and department",
      last_contact_at: "its latest interaction",
    },
  },
  PartnerDetail: {
    table: "partner",
    virtual: {
      category: "partner_category.name",
      region: "its region as a list shows it",
      stage_label: "its furthest live or open deal's stage",
      health: "that deal's health",
      owner: "the person, from employee and department",
      last_contact_at: "its latest interaction",
      headquarters: "the place row, owner partner.headquarters",
      region_view: "region_scope and the place rows of partner.cities",
      logo: "the document behind logo_document_id",
      signed_outside: "its first deal was signed before the hub",
    },
  },
  PartnerListQuery: { table: null, reason: "list controls and filters for the partners" },
  PartnerPage: { table: null, reason: "a page of partners" },
  PartnersSummary: { table: null, reason: "figures over the partners" },
  EventBrief: { table: "calendar_event" },
  Partner360: { table: null, reason: "the Partner 360: the partner, its figures and its collections" },
  DuplicateQuery: { table: null, reason: "what a new lead or partner is checked against" },
  Duplicates: { table: null, reason: "likely duplicates among leads and partners" },
  PartnerDocumentQuery: { table: null, reason: "list controls and filters for a record's documents" },
  PartnerDocumentAttach: {
    table: null,
    reason: "tags a vault document for a lead or partner (document.entity_type and entity_id) with its kind and deal",
  },
  PartnerDocument: { table: null, reason: "a document of a record: the vault's row, its kind and where it came from" },
  PartnerDocumentPage: { table: null, reason: "a page of a record's documents" },
  PartnerWorkQuery: { table: null, reason: "list controls for a record's work" },
  PartnerWorkItem: { table: null, reason: "a project, task or event connected to a record" },
  PartnerWorkPage: { table: null, reason: "a page of a record's work and the counts hidden from the reader" },
  PartnerLink: { table: "task" },
  PartnerLinkView: { table: null, reason: "the partner or lead and deal a project, task or event is for, named for the reader" },
  PartnerLinkQuery: { table: null, reason: "the Partner filter on My Workspace's lists" },
  PartnerLinkRecordQuery: { table: null, reason: "list controls for Connect to Partner's Partner" },
  PartnerLinkRecord: { table: null, reason: "a partner or a lead Connect to Partner offers" },
  PartnerLinkRecordPage: { table: null, reason: "a page of partners and leads to connect work to" },
  PartnerLinkDealQuery: { table: null, reason: "list controls for Connect to Partner's Deal" },
  PartnerLinkDeal: { table: null, reason: "an open or live deal Connect to Partner offers" },
  PartnerLinkDealPage: { table: null, reason: "a page of a record's deals to connect work to" },
};

module.exports = {
  TABLES,
  PartnerStatus,
  RegionInput,
  RegionView,
  ContactInput,
  Contact,
  ContactCreate,
  ContactUpdate,
  ContactChange,
  PartnerFields,
  PartnerCreate,
  PartnerUpdate,
  PartnerClose,
  PartnerAdd,
  PartnerChange,
  PartnerRow,
  PartnerDetail,
  PartnerListQuery,
  PartnerPage,
  PartnersSummary,
  EventBrief,
  Partner360,
  DuplicateQuery,
  Duplicates,
  PartnerDocumentQuery,
  PartnerDocumentAttach,
  PartnerDocument,
  PartnerDocumentPage,
  WorkKind,
  PartnerWorkQuery,
  PartnerWorkItem,
  PartnerWorkPage,
  partnerLinkFields,
  partnerLinkEditFields,
  linkRules,
  linkEditRules,
  PartnerLink,
  PartnerLinkView,
  PartnerLinkQuery,
  LinkKind,
  PartnerLinkRecordQuery,
  PartnerLinkRecord,
  PartnerLinkRecordPage,
  PartnerLinkDealQuery,
  PartnerLinkDeal,
  PartnerLinkDealPage,
};
