"use strict";
/**
 * The partnership pipeline (docs/guides/partnerships.md §3, §4.2, §5, §6.3, §6.5 to §6.7, §6.13,
 * §6.14): categories with their agreement templates, delivery checklists and custom fields; MyCity's
 * lists (stages with what each counts as, impact, sources, document kinds); deals with their options,
 * team, stage, health and history; a deal's monthly returns; Start From Tracker.
 *
 * A deal is a row of `partnership_opportunity` (7000); on the wire its id is `deal_id`, the name every
 * table built after it uses. It is on a lead or on a partner, never neither.
 *
 * Money is a two-place string (shared/money). Commission rates and amounts, the merchant's take and
 * returns are left out of every response for a reader without `partnerships.money` (§6.1), so those
 * keys are optional on the way out; the screen never merely hides them.
 *
 * Lists are MyCity's (A26): a stage's code is the list's, and what it counts as is its `meaning`.
 * The code lists the service switches on, deal health and interaction types, are seeded (7190).
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, money, blank, listQuery, Paged, recordId, changesBeside, nothingOn } = require("./common");
const { PersonRef } = require("./organisation");
const { PlaceInput, PlaceView } = require("./maps");

/* ------------------------------------------------------------------ *
 * Words the pipeline is built from
 * ------------------------------------------------------------------ */

/** What a stage counts as, fixed, so MyCity may rename its stages without breaking a count (§6.3). */
const StageMeaning = z.enum(["prospect", "contacted", "meeting", "proposal", "negotiation", "signed", "active", "closed_lost", "on_hold"]);
/** How a deal is going beside its stage (deal_health). Stalled needs blockers. */
const DealHealth = z.enum(["on_track", "follow_up_required", "stalled"]);
/** open: being pursued; live: signed and running; completed: past its validity and event; lost. */
const DealStatus = z.enum(["open", "live", "completed", "lost"]);
/** A record's region: the cities picked, or one of the wider scopes. */
const RegionScope = z.enum(["cities", "national", "africa", "worldwide"]);
const ImpactRating = z.enum(["high", "medium", "low"]);
/** An agreement template's kind; an agreement is one of these. */
const TemplateKind = z.enum(["deal_merchant", "mou", "service_agreement", "contract"]);
const ChecklistDueFrom = z.enum(["signing", "event_start"]);
const FieldType = z.enum(["text", "long_text", "number", "money", "date", "pick", "multi_pick", "yes_no", "url"]);
const FieldAppliesTo = z.enum(["lead", "partner", "deal"]);
const DealMemberRole = z.enum(["owner", "lead", "support", "on_ground"]);
/** A history line records a stage move or a health change, and where it came from. */
const HistoryKind = z.enum(["stage", "health"]);
const HistorySource = z.enum(["person", "signature", "import", "system", "conversion"]);
const ReturnSource = z.enum(["entered", "import"]);
/** MyCity's own lists, edited on Categories (§6.3). */
const ListName = z.enum(["partnership_stage", "partnership_impact", "lead_source", "partner_document_kind"]);

/** A code of one of MyCity's lists: a stage, an impact, a source, a document kind. */
const listCode = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/, "must be a list's code");

/** A percentage with at most two places, as numeric(5,2) leaves the API: "8.00". */
const percent = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "must be a percentage like 8 or 12.50")
  .refine((v) => Number(v) <= 100, "must be 100 or less");

/** A count a form types (expected attendance): a whole number, or the digits typed. */
const count = z.union([z.number().int().min(0).max(10000000), z.string().trim().regex(/^\d{1,8}$/, "Whole number").transform(Number)]);

/** A query-string boolean: "true" or "false". */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

/** One custom field's value (§6.3): checked by its field's type on the server; money as a string. */
const CustomValue = z.union([z.string().max(5000), z.number(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()]);
/** A record's custom values by field key. */
const CustomValues = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/), CustomValue);

/**
 * The filterable custom fields a list is narrowed by, as one query value: `{"ticketing":"exclusive"}`
 * written as JSON. Unknown or unfilterable keys are a 422 on the server.
 */
const CustomFilter = z
  .string()
  .max(2000)
  .transform((v, ctx) => {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      /* refused below */
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a JSON object of field keys" });
    return z.NEVER;
  });

/** The lead or partner a deal, a proposal or an agreement is on. */
const RecordRef = z
  .object({
    type: z.enum(["lead", "partner"]),
    id: uuid,
    number: z.string(),
    name: z.string(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Categories, their templates, checklists and custom fields
 * ------------------------------------------------------------------ */

const Category = z
  .object({
    partner_category_id: uuid,
    name: z.string(),
    description: z.string().nullable(),
    default_commission_pct: percent.nullable(),
    default_validity_days: z.number().int().positive().nullable(),
    counts_as_vendor: z.boolean(),
    display_order: z.number().int().nullable(),
    active: z.boolean(),
  })
  .strict();

/** A category in the list, with how many partners and leads are in it. */
const CategoryRow = Category.extend({
  partners: z.number().int().min(0),
  leads: z.number().int().min(0),
}).strict();

/**
 * An ask (§6.8): a value the person gives when an agreement is generated, with its label and type, and
 * where MyCity's wording has one, its default. Named in the wording as `{{ ask.<key> }}`.
 */
const TemplateAsk = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Lower case letters"),
    label: text(60),
    type: FieldType,
    options: z.array(text(80)).min(1).max(50).optional(),
    default: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => !["pick", "multi_pick"].includes(v.type) || (v.options && v.options.length > 0), {
    message: "Add the choices",
    path: ["options"],
  });

const CategoryTemplate = z
  .object({
    partner_category_template_id: uuid,
    partner_category_id: uuid,
    template_key: z.string(),
    kind: TemplateKind,
    label: z.string(),
    is_default: z.boolean(),
    countersigned: z.boolean(),
    active: z.boolean(),
    asks: z.array(TemplateAsk).max(30),
    version: z.number().int().min(0).nullable(),
  })
  .strict();

/**
 * A record field a template may name (§6.8). `signer.*` are filled by the signing service when the
 * agreement is signed (§6.9); `deal.options` is the options table and `category.checklist` the numbered
 * clauses of the delivery checklist.
 */
const RecordFieldType = z.enum(["text", "number", "date", "table", "list", "signature"]);
const RecordField = z
  .object({
    field: z.string(),
    label: z.string(),
    type: RecordFieldType,
    source: z.enum(["record", "signing"]),
  })
  .strict();

const rf = (field, label, type = "text", source = "record") => Object.freeze({ field, label, type, source });

/** Every record field a category template may name, in the order the editor offers them. */
const AGREEMENT_RECORD_FIELDS = Object.freeze([
  rf("today", "Date", "date"),
  rf("org.name", "MyCity Name"),
  rf("partner.name", "Business Name"),
  rf("partner.legal_name", "Legal Name"),
  rf("partner.headquarters", "Address"),
  rf("partner.region", "Region"),
  rf("contact.full_name", "Contact Person"),
  rf("contact.title", "Contact Position"),
  rf("contact.phones", "Phone Numbers"),
  rf("contact.email", "Email"),
  rf("deal.title", "Deal Title"),
  rf("deal.event_title", "Event Title"),
  rf("deal.event_starts_on", "Event Starts", "date"),
  rf("deal.event_ends_on", "Event Ends", "date"),
  rf("deal.objective", "Objective"),
  rf("deal.expected_attendance", "Expected Attendance", "number"),
  rf("deal.comments", "Comments"),
  rf("deal.valid_until", "Valid Until", "date"),
  rf("deal.validity_label", "Validity"),
  rf("deal.options", "Deal Options", "table"),
  rf("category.checklist", "Delivery Checklist", "list"),
  rf("signer.name", "Signer Name", "text", "signing"),
  rf("signer.title", "Signer Title", "text", "signing"),
  rf("signer.signed_on", "Date Signed", "date", "signing"),
  rf("signer.signature", "Signature", "signature", "signing"),
]);

const ChecklistItem = z
  .object({
    partner_category_checklist_item_id: uuid,
    partner_category_id: uuid,
    title: z.string(),
    description: z.string().nullable(),
    due_from: ChecklistDueFrom,
    due_days: z.number().int().min(0),
    position: z.number().int(),
    active: z.boolean(),
  })
  .strict();

const Field = z
  .object({
    partnership_field_id: uuid,
    key: z.string(),
    label: z.string(),
    field_type: FieldType,
    options: z.array(z.string()).nullable(),
    applies_to: FieldAppliesTo,
    partner_category_id: uuid.nullable(),
    filterable: z.boolean(),
    position: z.number().int(),
    active: z.boolean(),
  })
  .strict();

/** The picked category on Categories: its defaults, templates, checklist, fields and who is in it. */
const CategoryDetail = Category.extend({
  templates: z.array(CategoryTemplate),
  checklist: z.array(ChecklistItem),
  fields: z.array(Field),
  counts: z
    .object({
      partners: z.number().int().min(0),
      leads: z.number().int().min(0),
      open_deals: z.number().int().min(0),
    })
    .strict(),
}).strict();

const CategoryListQuery = listQuery({ active: flag.optional() }, ["display_order", "name"]);
const CategoryPage = Paged(CategoryRow);

const CategoryCreate = z
  .object({
    name: text(80),
    description: optionalText(500),
    default_commission_pct: blank(percent),
    default_validity_days: z.number().int().positive().max(3650).optional(),
    counts_as_vendor: z.boolean().optional(),
  })
  .strict();

/** Edit, Retire (`active: false`) and Restore. A category in use is retired, never deleted. */
const CategoryUpdate = z
  .object({
    name: text(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    default_commission_pct: percent.nullable().optional(),
    default_validity_days: z.number().int().positive().max(3650).nullable().optional(),
    counts_as_vendor: z.boolean().optional(),
    display_order: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/** The editor's wording, as HTML: what the template editor saves and Use Draft hands it. */
const wordingHtml = z.string().trim().min(1, "Write the agreement").max(100000, "Too long");

/**
 * Add Template: the agreement's name, kind and wording in one save, so no category ever holds a template
 * with nothing to fill. The key is made from the category and the label when left out; it never changes.
 */
const CategoryTemplateCreate = z
  .object({
    template_key: z.string().trim().regex(/^[a-z][a-z0-9-]{1,63}$/, "must be a template's key").optional(),
    kind: TemplateKind,
    label: text(80),
    is_default: z.boolean().optional(),
    countersigned: z.boolean().optional(),
    title: optionalText(150),
    body_html: wordingHtml,
    asks: z.array(TemplateAsk).max(30).optional(),
  })
  .strict();

/** The picked template with its wording, for the editor (GET /category-templates/:id). */
const CategoryTemplateDetail = CategoryTemplate.extend({
  title: z.string().nullable(),
  body_html: z.string(),
  record_fields: z.array(RecordField).max(60),
}).strict();

/** Save the wording as the template's next version; the asks are replaced when given. */
const TemplateWordingSave = z
  .object({
    title: z.string().trim().max(150).nullable().optional(),
    body_html: wordingHtml,
    asks: z.array(TemplateAsk).max(30).optional(),
  })
  .strict();

const CategoryTemplateUpdate = z
  .object({
    label: text(80).optional(),
    is_default: z.boolean().optional(),
    countersigned: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/**
 * Tidy With AI (§6.8): the text of a Word agreement MyCity already uses, pasted. Nothing is kept: the
 * draft comes back to be accepted field by field, then saved with Use Draft.
 */
const TemplateTidy = z
  .object({
    text: text(100000),
    kind: TemplateKind.optional(),
  })
  .strict();

/** A field Tidy With AI proposes for a value that belongs to a partner or a deal. */
const ProposedField = z
  .object({
    /** The words in the pasted text it replaces: "26th November, 2026". */
    found: z.string(),
    /** A record field (`deal.valid_until`), a custom field's key, or an ask's key. */
    field: z.string(),
    source: z.enum(["record", "custom", "ask"]),
    label: z.string(),
    /** An ask's type: what the person gives when generating. */
    ask_type: FieldType.nullable(),
  })
  .strict();

/** What the model is asked to return for Tidy With AI, checked before anyone sees it. */
const TemplateTidyOutput = z
  .object({
    /** The agreement as Markdown, each value that belongs to a record or an ask written as its {{ field }}. */
    body_markdown: z.string().min(1).max(150000),
    fields: z.array(ProposedField).max(100),
  })
  .strict();

/**
 * Tidy With AI's answer: the tidied wording for the editor (headings, numbered clauses, the financials grid
 * as a table, each proposed field a chip), or why there is none: AI is off or its limit is reached (§11).
 */
const TemplateTidyDraft = z
  .object({
    available: z.boolean(),
    reason: z.enum(["off", "limit"]).nullable(),
    body_html: z.string().nullable(),
    fields: z.array(ProposedField).max(100),
    ai_run_id: uuid.nullable(),
  })
  .strict();

const ChecklistItemCreate = z
  .object({
    title: text(120).refine((v) => v.length >= 3, "At least 3 letters"),
    description: optionalText(500),
    due_from: ChecklistDueFrom,
    due_days: z.number().int().min(0).max(365),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

/** Edit, Move Up, Move Down (position) and Retire (`active: false`). */
const ChecklistItemUpdate = z
  .object({
    title: text(120)
      .refine((v) => v.length >= 3, "At least 3 letters")
      .optional(),
    description: z.string().trim().max(500).nullable().optional(),
    due_from: ChecklistDueFrom.optional(),
    due_days: z.number().int().min(0).max(365).optional(),
    position: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/** Which custom fields to read: every field is a definition a form needs at once, so they come whole. */
const FieldListQuery = z
  .object({
    applies_to: FieldAppliesTo.optional(),
    partner_category_id: uuid.optional(),
    active: flag.optional(),
  })
  .strict();

const FieldList = z.object({ data: z.array(Field).max(200) }).strict();

/** Add Field (§6.3). The key is made from the label once, and never changed. */
const FieldCreate = z
  .object({
    label: text(60),
    field_type: FieldType,
    options: z.array(text(80)).min(1).max(50).optional(),
    applies_to: FieldAppliesTo,
    partner_category_id: blank(uuid),
    filterable: z.boolean().optional(),
  })
  .strict()
  .refine((v) => !["pick", "multi_pick"].includes(v.field_type) || (v.options && v.options.length > 0), {
    message: "Add the choices",
    path: ["options"],
  });

/** Edit and Retire (`active: false`); a retired field keeps its values. Its key and type never change. */
const FieldUpdate = z
  .object({
    label: text(60).optional(),
    options: z.array(text(80)).min(1).max(50).optional(),
    filterable: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/* ------------------------------------------------------------------ *
 * MyCity's lists
 * ------------------------------------------------------------------ */

const ListValue = z
  .object({
    code: z.string(),
    label: z.string(),
    /** A stage's: what it counts as. Null on the other lists. */
    meaning: StageMeaning.nullable(),
    position: z.number().int(),
    active: z.boolean(),
  })
  .strict();

/** One list, whole, in its order: a list is a handful of values every form needs at once. */
const ListValues = z
  .object({
    list: ListName,
    values: z.array(ListValue).max(200),
  })
  .strict();

const ListParams = z.object({ list: ListName }).strict();
const ListValueParams = z.object({ list: ListName, code: listCode }).strict();

/** A stage needs its meaning; the other lists have none. */
const ListValueCreate = z
  .object({
    label: text(80),
    meaning: StageMeaning.optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

/** Rename, re-order, change what a stage counts as, retire. The last stage of a meaning in use keeps it. */
const ListValueUpdate = z
  .object({
    label: text(80).optional(),
    meaning: StageMeaning.optional(),
    position: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/* ------------------------------------------------------------------ *
 * Start From Tracker (§6.13)
 * ------------------------------------------------------------------ */

/** The uploaded workbook whose dropdowns are read. */
const TrackerSetup = z.object({ document_id: uuid }).strict();

const TrackerStage = z
  .object({
    label: text(80),
    meaning: StageMeaning,
  })
  .strict();

const TrackerCategory = z
  .object({
    name: text(80),
    default_commission_pct: blank(percent),
  })
  .strict();

const TrackerImpact = z.object({ label: text(80) }).strict();

/** What the workbook's dropdowns hold, with a suggested meaning for each stage, for the person to correct. */
const TrackerSetupDraft = z
  .object({
    stages: z.array(TrackerStage).max(40),
    categories: z.array(TrackerCategory).max(40),
    impact: z.array(TrackerImpact).max(40),
  })
  .strict();

/** The lists as the person corrected them. */
const TrackerSetupApply = TrackerSetupDraft;

const SetupResult = z
  .object({
    stages: z.number().int().min(0),
    categories: z.number().int().min(0),
    impact: z.number().int().min(0),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Deals
 * ------------------------------------------------------------------ */

/** One priced line of a deal, as the Deal Merchant Agreement's grid has it (§6.6). */
const DealOptionInput = z
  .object({
    position: z.number().int().min(1).max(5),
    label: text(60),
    original_price: blank(money),
    discount_pct: blank(percent),
    deal_price: blank(money),
    /** A price that is not money: "App Download", "Free Entry". */
    price_note: optionalText(60),
    /** Defaults to the deal price times the deal's rate. */
    commission_amount: blank(money),
    /** Defaults to the price less the commission. */
    merchant_take: blank(money),
  })
  .strict();

const DealOption = z
  .object({
    deal_option_id: uuid,
    position: z.number().int().min(1).max(5),
    label: z.string(),
    original_price: money.nullable(),
    discount_pct: percent.nullable(),
    deal_price: money.nullable(),
    price_note: z.string().nullable(),
    commission_amount: money.nullable().optional(),
    merchant_take: money.nullable().optional(),
  })
  .strict();

const DealMember = z
  .object({
    employee: PersonRef,
    role: DealMemberRole,
  })
  .strict();

/** How long a signed deal runs: 30 days, 60 days, or until a date (§6.6). */
const Validity = z.union([
  z.object({ days: z.union([z.literal(30), z.literal(60)]) }).strict(),
  z.object({ until: isoDate }).strict(),
]);

const endsOnOrAfter = (v) => !v.event_starts_on || !v.event_ends_on || v.event_ends_on >= v.event_starts_on;
const ENDS_BEFORE = { message: "Ends before it starts", path: ["event_ends_on"] };

/** A deal's own fields: what New Deal asks, and New Lead and New Partner ask for their first deal. */
const DealFields = z
  .object({
    title: text(150),
    event_title: optionalText(150),
    event_starts_on: blank(isoDate),
    event_ends_on: blank(isoDate),
    /** Picked from the address search; null or left out for none. */
    venue: PlaceInput.nullish(),
    expected_attendance: blank(count),
    objective: optionalText(2000),
    /** A stage of MyCity's list; the first active stage when left out. */
    stage: blank(listCode),
    /** Projected value: the owner's estimate. */
    estimated_value: blank(money),
    commission_pct: blank(percent),
    validity: Validity.optional(),
    expected_close_on: blank(isoDate),
    next_action: optionalText(300),
    next_action_on: blank(isoDate),
    owner_id: uuid,
    member_ids: z.array(uuid).max(20).optional(),
    options: z.array(DealOptionInput).max(5, "At most five options").optional(),
    impact: z.array(listCode).max(9).optional(),
    impact_rating: blank(ImpactRating),
    impact_note: optionalText(500),
    comments: optionalText(2000),
    custom: CustomValues.optional(),
  })
  .strict();

/** New Deal, on a lead or a partner. */
const DealCreate = DealFields.extend({
  lead_id: blank(uuid),
  partner_id: blank(uuid),
})
  .strict()
  .refine((v) => Boolean(v.lead_id) !== Boolean(v.partner_id), { message: "Pick the lead or the partner", path: ["partner_id"] })
  .refine(endsOnOrAfter, ENDS_BEFORE);

/** Edit a deal. The stage moves through StageMove, the health through HealthSet. */
const DealUpdate = z
  .object({
    title: text(150).optional(),
    event_title: z.string().trim().max(150).nullable().optional(),
    event_starts_on: isoDate.nullable().optional(),
    event_ends_on: isoDate.nullable().optional(),
    venue: PlaceInput.nullable().optional(),
    expected_attendance: count.nullable().optional(),
    objective: z.string().trim().max(2000).nullable().optional(),
    estimated_value: money.nullable().optional(),
    commission_pct: percent.nullable().optional(),
    validity: Validity.nullable().optional(),
    expected_close_on: isoDate.nullable().optional(),
    next_action: z.string().trim().max(300).nullable().optional(),
    next_action_on: isoDate.nullable().optional(),
    owner_id: uuid.optional(),
    member_ids: z.array(uuid).max(20).optional(),
    options: z.array(DealOptionInput).max(5, "At most five options").optional(),
    impact: z.array(listCode).max(9).optional(),
    impact_rating: ImpactRating.nullable().optional(),
    impact_note: z.string().trim().max(500).nullable().optional(),
    comments: z.string().trim().max(2000).nullable().optional(),
    custom: CustomValues.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field")
  .refine(endsOnOrAfter, ENDS_BEFORE);

/**
 * The stage switcher's press (§6.5). A reason of at least 10 characters is needed for On Hold,
 * Closed Lost and any move back; a move into a signed stage without a signed agreement needs the
 * signed copy. The server decides which applies from the stages' meanings and order.
 */
const StageMove = z
  .object({
    stage: listCode,
    reason: blank(z.string().trim().min(10, "At least 10 characters").max(1000)),
    signed_copy_document_id: blank(uuid),
  })
  .strict();

/** Set Health. Stalled needs its blockers. */
const HealthSet = z
  .object({
    health: DealHealth,
    blockers: blank(z.string().trim().min(10, "At least 10 characters").max(1000)),
  })
  .strict()
  .refine((v) => v.health !== "stalled" || Boolean(v.blockers), { message: "Say what is in the way", path: ["blockers"] });

/* ------------------------------------------------------------------ *
 * Praxis AI's cards on deals (§9; docs/guides/praxis-ai.md §6.11, decision 33): flat fields the
 * chat can carry, each reaching the screen's own service function. A deal's options, venue, team,
 * validity, commission and custom values are set on its 360.
 * ------------------------------------------------------------------ */

/** New Deal as a card, on a partner (a lead has the one deal it was captured with). */
const DealAdd = z
  .object({
    partner_id: recordId("partner"),
    title: text(150),
    event_title: optionalText(150),
    event_starts_on: blank(isoDate),
    event_ends_on: blank(isoDate),
    objective: optionalText(2000),
    stage: listCode.optional(),
    estimated_value: blank(money),
    expected_close_on: blank(isoDate),
    next_action: optionalText(300),
    next_action_on: blank(isoDate),
    owner_id: uuid,
  })
  .strict()
  .refine(endsOnOrAfter, ENDS_BEFORE);

/** Edit Deal as a card: the deal beside the fields that change. */
const DealChange = z
  .object({
    deal_id: recordId("deal"),
    title: text(150).optional(),
    event_title: z.string().trim().max(150).nullable().optional(),
    event_starts_on: isoDate.nullable().optional(),
    event_ends_on: isoDate.nullable().optional(),
    expected_attendance: z.number().int().min(0).max(10000000).nullable().optional(),
    objective: z.string().trim().max(2000).nullable().optional(),
    estimated_value: money.nullable().optional(),
    expected_close_on: isoDate.nullable().optional(),
    next_action: z.string().trim().max(300).nullable().optional(),
    next_action_on: isoDate.nullable().optional(),
    owner_id: uuid.optional(),
    impact_rating: ImpactRating.nullable().optional(),
    impact_note: z.string().trim().max(500).nullable().optional(),
    comments: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine(changesBeside(["deal_id"]), nothingOn("deal_id"))
  .refine(endsOnOrAfter, ENDS_BEFORE);

/** The stage switcher as a card. A move into a signed stage needs the signed copy, so the card sends the person to the 360. */
const DealStageChange = z
  .object({
    deal_id: recordId("deal"),
    stage: listCode,
    reason: blank(z.string().trim().min(10, "At least 10 characters").max(1000)),
  })
  .strict();

/** Set Health as a card. Stalled needs its blockers. */
const DealHealthChange = z
  .object({
    deal_id: recordId("deal"),
    health: DealHealth,
    blockers: blank(z.string().trim().min(10, "At least 10 characters").max(1000)),
  })
  .strict()
  .refine((v) => v.health !== "stalled" || Boolean(v.blockers), { message: "Say what is in the way", path: ["blockers"] });

/** One line of a deal's history: a stage move or a health change. */
const StageHistoryLine = z
  .object({
    partnership_stage_history_id: uuid,
    kind: HistoryKind,
    from_stage: z.string().nullable(),
    to_stage: z.string(),
    from_label: z.string().nullable(),
    to_label: z.string(),
    reason: z.string().nullable(),
    source: HistorySource,
    by: PersonRef.nullable(),
    changed_at: isoDateTime,
  })
  .strict();

/** A history line on a record's 360 (the Partner 360's Activity, §6.2): the line and the deal it is about. */
const RecordHistoryLine = StageHistoryLine.extend({
  deal_id: uuid,
  deal_number: z.string(),
  deal_title: z.string(),
}).strict();

/** A delivery checklist item raised as a Workspace task on signing (§6.7); its status is its task's. */
const Deliverable = z
  .object({
    deal_deliverable_id: uuid,
    deal_id: uuid,
    checklist_item_id: uuid.nullable(),
    title: z.string(),
    task_id: uuid.nullable(),
    status: z.string().nullable(),
    due_on: isoDate.nullable(),
    owner: PersonRef.nullable(),
  })
  .strict();

/** One deal as a list shows it. */
const DealRow = z
  .object({
    deal_id: uuid,
    number: z.string(),
    title: z.string(),
    record: RecordRef,
    lead_id: uuid.nullable(),
    partner_id: uuid.nullable(),
    category: z.string().nullable(),
    stage: z.string(),
    stage_label: z.string(),
    meaning: StageMeaning.nullable(),
    health: DealHealth,
    status: DealStatus,
    owner: PersonRef.nullable(),
    estimated_value: money.nullable(),
    currency: z.string().nullable(),
    expected_close_on: isoDate.nullable(),
    days_at_stage: z.number().int().min(0),
    event_title: z.string().nullable(),
    event_starts_on: isoDate.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** One deal whole: its terms, options, team and history. Money keys are absent without `partnerships.money`. */
const DealDetail = DealRow.extend({
  objective: z.string().nullable(),
  event_ends_on: isoDate.nullable(),
  venue: PlaceView.nullable(),
  expected_attendance: z.number().int().nullable(),
  blockers: z.string().nullable(),
  next_action: z.string().nullable(),
  next_action_on: isoDate.nullable(),
  commission_pct: percent.nullable().optional(),
  commission_deviates: z.boolean().optional(),
  validity_days: z.number().int().nullable(),
  valid_until: isoDate.nullable(),
  identified_on: isoDate.nullable(),
  signed_at: isoDateTime.nullable(),
  completed_at: isoDateTime.nullable(),
  close_reason: z.string().nullable(),
  /** Its agreement's value when it has one, else its projected value. */
  signed_value: money.nullable(),
  impact: z.array(z.string()),
  impact_rating: ImpactRating.nullable(),
  impact_note: z.string().nullable(),
  comments: z.string().nullable(),
  custom: CustomValues,
  options: z.array(DealOption).max(5),
  members: z.array(DealMember),
  deliverables: z.array(Deliverable),
  history: z.array(StageHistoryLine).max(25),
}).strict();

const DealListQuery = listQuery(
  {
    stage: listCode.optional(),
    partner_category_id: uuid.optional(),
    region_scope: RegionScope.optional(),
    /** A city of the record's region, as the address search names it. */
    region_city: z.string().trim().min(1).max(120).optional(),
    owner_id: uuid.optional(),
    health: DealHealth.optional(),
    status: DealStatus.optional(),
    lead_id: uuid.optional(),
    partner_id: uuid.optional(),
    custom: CustomFilter.optional(),
  },
  ["expected_close_on", "title", "estimated_value", "created_at"],
);
const DealPage = Paged(DealRow);

/* ------------------------------------------------------------------ *
 * Pipeline
 * ------------------------------------------------------------------ */

const PipelineQuery = z
  .object({
    stage: listCode.optional(),
    partner_category_id: uuid.optional(),
    region_scope: RegionScope.optional(),
    region_city: z.string().trim().min(1).max(120).optional(),
    owner_id: uuid.optional(),
    health: DealHealth.optional(),
  })
  .strict();

const PipelineDeal = z
  .object({
    deal_id: uuid,
    number: z.string(),
    title: z.string(),
    record: RecordRef,
    stage: z.string(),
    stage_label: z.string(),
    days_at_stage: z.number().int().min(0),
    blockers: z.string().nullable(),
    owner: PersonRef.nullable(),
  })
  .strict();

/** Pipeline's figures within the reader's scope (§2, §10.1). Every figure is 0 and every list [] with no deals. */
const PipelineSummary = z
  .object({
    kpis: z
      .object({
        open_deals: z.number().int().min(0),
        signed_this_year: z.number().int().min(0),
        signed_value: money,
        stalled: z.number().int().min(0),
      })
      .strict(),
    by_stage: z.array(
      z
        .object({
          stage: z.string(),
          label: z.string(),
          meaning: StageMeaning.nullable(),
          open: z.number().int().min(0),
          value: money,
        })
        .strict(),
    ),
    longest_at_stage: z.array(PipelineDeal).max(10),
    stalled: z.array(PipelineDeal).max(25),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Returns (§6.14), with `partnerships.money`
 * ------------------------------------------------------------------ */

/** A month in the path: `YYYY-MM`. */
const ReturnMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be a month like 2026-11");
const ReturnParams = z.object({ id: uuid, month: ReturnMonth }).strict();

/** Enter Returns, a month at a time; a month saved again replaces its figures, audited. */
const ReturnSave = z
  .object({
    units_sold: z.number().int().min(0).optional(),
    gross_sales: blank(money),
    mycity_commission: blank(money),
    paid_to_partner: blank(money),
    downloads: z.number().int().min(0).optional(),
    note: optionalText(500),
  })
  .strict();

const DealReturn = z
  .object({
    deal_return_id: uuid,
    deal_id: uuid,
    /** The 1st of the month the figures are for. */
    month: isoDate,
    units_sold: z.number().int().nullable(),
    gross_sales: money.nullable(),
    mycity_commission: money.nullable(),
    paid_to_partner: money.nullable(),
    downloads: z.number().int().nullable(),
    note: z.string().nullable(),
    source: ReturnSource,
    entered_by_name: z.string().nullable(),
    updated_at: isoDateTime,
  })
  .strict();

/** Enter Returns as a card (with `partnerships.money`): the deal and its month beside the figures. */
const DealReturnChange = ReturnSave.extend({ deal_id: recordId("deal"), month: ReturnMonth }).strict();

const ReturnListQuery = listQuery({ year: z.coerce.number().int().min(2000).max(2100).optional() }, ["month"]);
const ReturnPage = Paged(DealReturn);

/**
 * One row of the Partnership Returns import (§6.14): a deal's month, named by the deal's number or by
 * its partner's name and its title, with the month's figures. `line_key` is the deal and the month,
 * made by the importer's extract so a month imported again replaces itself.
 */
const ReturnImportRow = z
  .object({
    line_key: text(400),
    deal_number: optionalText(40),
    partner: optionalText(150),
    deal_title: optionalText(150),
    month: ReturnMonth,
    units_sold: z.number().int().min(0).optional(),
    gross_sales: blank(money),
    mycity_commission: blank(money),
    paid_to_partner: blank(money),
    downloads: z.number().int().min(0).optional(),
    note: optionalText(500),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const DEAL = {
  deal_id: "partnership_opportunity.partnership_opportunity_id, named as every later table names it",
  record: "the lead or partner the deal is on",
  category: "partner_category.name of its lead or partner",
  stage_label: "the stage's label in MyCity's list",
  meaning: "what the stage counts as, from the list",
  owner: "the person, from employee and department",
  days_at_stage: "Lagos days since its last stage line",
};
const DEAL_FIELDS = {
  venue: "a place row, owner deal.venue",
  validity: "validity_days or valid_until",
  member_ids: "deal_member rows",
  options: "deal_option rows",
};
const TABLES = {
  ReturnImportRow: { table: null, reason: "one row of the Partnership Returns sheet as the importer reads it; written as a deal_return" },
  RecordRef: { table: null, reason: "the lead or partner a deal, proposal or agreement is on" },
  Category: { table: "partner_category" },
  CategoryRow: {
    table: "partner_category",
    virtual: { partners: "partners in the category", leads: "leads in the category" },
  },
  CategoryTemplate: {
    table: "partner_category_template",
    virtual: { version: "the current template_version.version of its key" },
  },
  ChecklistItem: { table: "partner_category_checklist_item" },
  Field: { table: "partnership_field" },
  CategoryDetail: {
    table: "partner_category",
    virtual: {
      templates: "partner_category_template rows",
      checklist: "partner_category_checklist_item rows",
      fields: "partnership_field rows of the category or of every category",
      counts: "partners, leads and open deals in the category",
    },
  },
  CategoryListQuery: { table: null, reason: "list controls for the categories" },
  CategoryPage: { table: null, reason: "a page of categories" },
  CategoryCreate: { table: "partner_category" },
  CategoryUpdate: { table: "partner_category" },
  TemplateAsk: { table: null, reason: "an ask inside partner_category_template.asks" },
  RecordField: { table: null, reason: "a record field a template may name; a catalogue, not a row" },
  CategoryTemplateCreate: {
    table: "partner_category_template",
    virtual: { title: "the wording's title, kept in template_version", body_html: "the wording, saved as template_version's Markdown" },
  },
  CategoryTemplateUpdate: { table: "partner_category_template" },
  CategoryTemplateDetail: {
    table: "partner_category_template",
    virtual: {
      version: "the current template_version.version of its key",
      title: "template_version.title",
      body_html: "template_version.body rendered for the editor",
      record_fields: "the record fields a template may name",
    },
  },
  TemplateWordingSave: {
    table: null,
    reason: "new wording saved as the template's next template_version, and its asks",
  },
  TemplateTidy: { table: null, reason: "pasted wording for Tidy With AI; nothing is kept" },
  ProposedField: { table: null, reason: "a field Tidy With AI proposes; nothing is kept until Use Draft" },
  TemplateTidyOutput: { table: null, reason: "the model's answer for Tidy With AI, checked before anyone sees it" },
  TemplateTidyDraft: { table: null, reason: "Tidy With AI's draft; nothing is kept until Use Draft" },
  ChecklistItemCreate: { table: "partner_category_checklist_item" },
  ChecklistItemUpdate: { table: "partner_category_checklist_item" },
  FieldListQuery: { table: null, reason: "which custom field definitions to read" },
  FieldList: { table: null, reason: "the custom field definitions, whole" },
  FieldCreate: { table: "partnership_field", virtual: { label: "the label, and the key made from it once" } },
  FieldUpdate: { table: "partnership_field" },
  ListValue: {
    table: "reference_value",
    virtual: { meaning: "reference_value.metadata.meaning, a stage's", position: "reference_value.display_order" },
  },
  ListValues: { table: null, reason: "one of MyCity's lists, whole, in its order" },
  ListParams: { table: null, reason: "the :list path parameter" },
  ListValueParams: { table: null, reason: "the :list and :code path parameters" },
  ListValueCreate: {
    table: "reference_value",
    virtual: { meaning: "reference_value.metadata.meaning", position: "reference_value.display_order" },
  },
  ListValueUpdate: {
    table: "reference_value",
    virtual: { meaning: "reference_value.metadata.meaning", position: "reference_value.display_order" },
  },
  TrackerSetup: { table: null, reason: "the uploaded workbook Start From Tracker reads" },
  TrackerStage: { table: null, reason: "a stage the workbook's dropdown holds, with a suggested meaning" },
  TrackerCategory: { table: null, reason: "a partnership type the workbook's dropdown holds" },
  TrackerImpact: { table: null, reason: "a potential impact the workbook's dropdown holds" },
  TrackerSetupDraft: { table: null, reason: "what the workbook's dropdowns hold, for the person to correct" },
  TrackerSetupApply: { table: null, reason: "the lists Start From Tracker writes, as the person corrected them" },
  SetupResult: { table: null, reason: "how many list values and categories Start From Tracker made" },
  DealOptionInput: { table: "deal_option" },
  DealOption: { table: "deal_option" },
  DealMember: { table: "deal_member", virtual: { employee: "the member, from employee and department" } },
  DealFields: { table: "partnership_opportunity", virtual: DEAL_FIELDS },
  DealCreate: { table: "partnership_opportunity", virtual: DEAL_FIELDS },
  DealUpdate: { table: "partnership_opportunity", virtual: DEAL_FIELDS },
  StageMove: { table: null, reason: "a stage move: the deal's stage and a partnership_stage_history line" },
  DealAdd: { table: "partnership_opportunity" },
  DealChange: { table: "partnership_opportunity", virtual: { deal_id: "partnership_opportunity.partnership_opportunity_id" } },
  DealStageChange: { table: null, reason: "a stage move as a card: the deal, its stage and a partnership_stage_history line" },
  DealHealthChange: { table: "partnership_opportunity", virtual: { deal_id: "partnership_opportunity.partnership_opportunity_id" } },
  HealthSet: { table: "partnership_opportunity" },
  StageHistoryLine: {
    table: "partnership_stage_history",
    virtual: {
      from_label: "the from stage's or health's label",
      to_label: "the to stage's or health's label",
      by: "the person behind changed_by",
    },
  },
  RecordHistoryLine: {
    table: "partnership_stage_history",
    virtual: {
      from_label: "the from stage's or health's label",
      to_label: "the to stage's or health's label",
      by: "the person behind changed_by",
      deal_id: "partnership_stage_history.partnership_opportunity_id, named as every later table names it",
      deal_number: "the deal's number",
      deal_title: "the deal's title",
    },
  },
  Deliverable: {
    table: "deal_deliverable",
    virtual: { status: "its task's status", due_on: "its task's due day", owner: "its task's assignee" },
  },
  DealRow: { table: "partnership_opportunity", virtual: DEAL },
  DealDetail: {
    table: "partnership_opportunity",
    virtual: {
      ...DEAL,
      venue: "the place row, owner deal.venue",
      signed_value: "its agreement's value, else its projected value",
      options: "deal_option rows",
      members: "deal_member rows",
      deliverables: "deal_deliverable rows",
      history: "the latest partnership_stage_history lines",
    },
  },
  DealListQuery: { table: null, reason: "list controls and filters for the deals" },
  DealPage: { table: null, reason: "a page of deals" },
  PipelineQuery: { table: null, reason: "Pipeline's filters" },
  PipelineDeal: { table: null, reason: "a deal in Pipeline's Longest at a Stage or Stalled" },
  PipelineSummary: { table: null, reason: "Pipeline's figures over the deals" },
  ReturnParams: { table: null, reason: "the :id and :month path parameters" },
  ReturnSave: { table: "deal_return" },
  DealReturnChange: { table: "deal_return" },
  DealReturn: { table: "deal_return", virtual: { entered_by_name: "the name behind entered_by" } },
  ReturnListQuery: { table: null, reason: "list controls for a deal's returns" },
  ReturnPage: { table: null, reason: "a page of a deal's returns" },
};

module.exports = {
  TABLES,
  StageMeaning,
  DealHealth,
  DealStatus,
  RegionScope,
  ImpactRating,
  TemplateKind,
  ChecklistDueFrom,
  FieldType,
  FieldAppliesTo,
  DealMemberRole,
  HistoryKind,
  HistorySource,
  ReturnSource,
  ListName,
  listCode,
  percent,
  flag,
  CustomValue,
  CustomValues,
  CustomFilter,
  RecordRef,
  Category,
  CategoryRow,
  TemplateAsk,
  RecordFieldType,
  RecordField,
  AGREEMENT_RECORD_FIELDS,
  CategoryTemplate,
  CategoryTemplateDetail,
  TemplateWordingSave,
  ChecklistItem,
  Field,
  CategoryDetail,
  CategoryListQuery,
  CategoryPage,
  CategoryCreate,
  CategoryUpdate,
  CategoryTemplateCreate,
  CategoryTemplateUpdate,
  TemplateTidy,
  ProposedField,
  TemplateTidyOutput,
  TemplateTidyDraft,
  ChecklistItemCreate,
  ChecklistItemUpdate,
  FieldListQuery,
  FieldList,
  FieldCreate,
  FieldUpdate,
  ListValue,
  ListValues,
  ListParams,
  ListValueParams,
  ListValueCreate,
  ListValueUpdate,
  TrackerSetup,
  TrackerStage,
  TrackerCategory,
  TrackerImpact,
  TrackerSetupDraft,
  TrackerSetupApply,
  SetupResult,
  DealOptionInput,
  DealOption,
  DealMember,
  Validity,
  DealFields,
  DealCreate,
  DealUpdate,
  StageMove,
  HealthSet,
  DealAdd,
  DealChange,
  DealStageChange,
  DealHealthChange,
  StageHistoryLine,
  RecordHistoryLine,
  Deliverable,
  DealRow,
  DealDetail,
  DealListQuery,
  DealPage,
  PipelineQuery,
  PipelineDeal,
  PipelineSummary,
  ReturnMonth,
  ReturnImportRow,
  ReturnParams,
  ReturnSave,
  DealReturnChange,
  DealReturn,
  ReturnListQuery,
  ReturnPage,
};
