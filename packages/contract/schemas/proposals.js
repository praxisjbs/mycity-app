"use strict";
/**
 * Proposals and the Proposal Studio (docs/guides/partnerships.md §3 step 4, §4.2, §5, §6.10, §6.11):
 * a proposal on a deal, briefed with notes or a transcript, questioned and drafted by Claude into the
 * design kit's layouts, edited, and sent by a person who confirms where it goes; MyCity's proof points;
 * saved templates; the public page.
 *
 * Content is structured, never markup (§6.11): `ProposalContent` is an ordered list of sections, each
 * naming a layout of the kit and filling that layout's fields, so Claude fills fields and the one
 * renderer draws the studio's preview, the public page and the PDF from the same HTML. Every figure,
 * date, price, percentage and named organisation in a section carries its source; one Claude could
 * not source is listed in `unconfirmed` for the person to confirm before Send.
 *
 * Statuses: brief, questions, writing (the draft job runs), draft, sent, viewed (the link opened),
 * accepted, declined, expired (past `valid_until`), withdrawn (the link stops).
 */
const { z } = require("zod");
const { uuid, text, optionalText, email, isoDate, isoDateTime, money, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { DocumentRef } = require("./documents");
const { RecordRef, flag } = require("./partner_pipeline");

const ProposalStatus = z.enum(["brief", "questions", "writing", "draft", "sent", "viewed", "accepted", "declined", "expired", "withdrawn"]);
/** The question cards' groups: The Partner, The Offer, Audience and Reach, Money, Timing, Proof. */
const QuestionGroup = z.enum(["partner", "offer", "audience", "money", "timing", "proof"]);
const AnswerKind = z.enum(["short_text", "long_text", "number", "money", "date", "pick", "multi_pick"]);
const QuestionState = z.enum(["open", "answered", "skipped", "replaced"]);
const SourceKind = z.enum(["notes", "transcript"]);
const AssetRole = z.enum(["cover", "gallery", "logo", "section"]);
const ProofPointKind = z.enum(["stat", "partner_logo", "endorsement", "result"]);
/** The design kit's layouts (§6.11). */
const LayoutName = z.enum(["cover", "letter", "opportunity", "why_mycity", "audience", "deliverables", "packages", "timeline", "proof", "terms", "next_steps", "closing"]);

/** An answer, a suggestion or an ask's value: by its card's kind; money as a string, a date ISO. */
const AnswerValue = z.union([z.string().max(5000), z.number(), z.array(z.string().max(200)).max(20), z.null()]);

/* ------------------------------------------------------------------ *
 * The design kit's content (§6.11): one schema a layout
 * ------------------------------------------------------------------ */

/** Where a figure in a section comes from: the brief, an answer, a record field, a proof point. */
const FigureSource = z
  .object({
    figure: text(120),
    source: z.enum(["brief", "answer", "record", "proof_point"]),
    /** The question's or proof point's id, or the record field ("deal.event_starts_on"). */
    ref: z.string().max(200).nullable(),
  })
  .strict();

/** What every section carries: its key in the proposal, whether it is hidden, its figures' sources. */
const sectionBase = {
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "must be a section key"),
  hidden: z.boolean().default(false),
  sources: z.array(FigureSource).max(60).default([]),
  /** Figures Claude could not source: marked for the person, listed before Send. */
  unconfirmed: z.array(text(120)).max(20).default([]),
};
const heading = text(120);
const para = text(1200);
/** An image of the proposal (proposal_asset); null where the kit's stand-in is used. */
const asset = uuid.nullable();
const stat = z.object({ value: text(40), label: text(120) }).strict();
const lucide = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, "must be a Lucide icon's name");

const CoverSection = z
  .object({
    ...sectionBase,
    layout: z.literal("cover"),
    title: heading,
    prepared_for: text(150),
    date: isoDate,
    reference: text(40),
    image_asset_id: asset,
    partner_logo_asset_id: asset,
  })
  .strict();

const LetterSection = z
  .object({
    ...sectionBase,
    layout: z.literal("letter"),
    paragraphs: z.array(para).min(2).max(3),
    signer_name: text(120),
    signer_title: text(120),
    signer_photo_asset_id: asset,
  })
  .strict();

const OpportunitySection = z
  .object({
    ...sectionBase,
    layout: z.literal("opportunity"),
    heading,
    paragraphs: z.array(para).min(1).max(4),
    pull_quote: text(240).nullable(),
  })
  .strict();

const WhyMyCitySection = z
  .object({
    ...sectionBase,
    layout: z.literal("why_mycity"),
    heading,
    points: z
      .array(z.object({ proof_point_id: uuid.nullable(), value: text(40), label: text(120) }).strict())
      .min(3)
      .max(6),
  })
  .strict();

const AudienceSection = z
  .object({
    ...sectionBase,
    layout: z.literal("audience"),
    heading,
    intro: para.nullable(),
    stats: z.array(stat).min(1).max(6),
    /** Drawn by the renderer as SVG from these figures. */
    chart: z
      .object({
        kind: z.enum(["bar", "donut"]),
        title: text(80),
        series: z
          .array(z.object({ label: text(60), value: z.number().min(0) }).strict())
          .min(2)
          .max(8),
      })
      .strict()
      .nullable(),
  })
  .strict();

const DeliverablesSection = z
  .object({
    ...sectionBase,
    layout: z.literal("deliverables"),
    heading,
    items: z
      .array(z.object({ title: text(120), detail: text(400).nullable(), icon: lucide }).strict())
      .min(1)
      .max(12),
  })
  .strict();

const PackagesSection = z
  .object({
    ...sectionBase,
    layout: z.literal("packages"),
    heading,
    /** Cards for three or fewer, else a table. */
    display: z.enum(["cards", "table"]),
    options: z
      .array(
        z
          .object({
            label: text(60),
            price: money.nullable(),
            /** A price that is not money: "App Download", "Free Entry". */
            price_note: text(60).nullable(),
            includes: z.array(text(160)).max(8),
            terms: text(240).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();

const TimelineSection = z
  .object({
    ...sectionBase,
    layout: z.literal("timeline"),
    heading,
    phases: z
      .array(
        z
          .object({
            name: text(60),
            starts_on: isoDate.nullable(),
            ends_on: isoDate.nullable(),
            detail: text(400),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();

const ProofSection = z
  .object({
    ...sectionBase,
    layout: z.literal("proof"),
    heading,
    logos: z
      .array(z.object({ proof_point_id: uuid, label: text(80) }).strict())
      .max(12),
    results: z.array(stat).max(6),
  })
  .strict();

const TermsSection = z
  .object({
    ...sectionBase,
    layout: z.literal("terms"),
    heading,
    items: z
      .array(z.object({ label: text(60), detail: text(400) }).strict())
      .min(1)
      .max(8),
  })
  .strict();

const NextStepsSection = z
  .object({
    ...sectionBase,
    layout: z.literal("next_steps"),
    heading,
    steps: z.array(text(200)).min(1).max(6),
    contact: z
      .object({
        name: text(120),
        title: text(120).nullable(),
        email: email.nullable(),
        phone: z.string().max(30).nullable(),
      })
      .strict(),
    /** A QR to the web version. */
    show_qr: z.boolean(),
  })
  .strict();

const ClosingSection = z
  .object({
    ...sectionBase,
    layout: z.literal("closing"),
    message: text(240).nullable(),
    image_asset_id: asset,
  })
  .strict();

/** One section of a proposal: a layout of the kit and its fields. */
const Section = z.discriminatedUnion("layout", [
  CoverSection,
  LetterSection,
  OpportunitySection,
  WhyMyCitySection,
  AudienceSection,
  DeliverablesSection,
  PackagesSection,
  TimelineSection,
  ProofSection,
  TermsSection,
  NextStepsSection,
  ClosingSection,
]);

/** The proposal's content: its sections in order, each key once. */
const ProposalContent = z
  .object({ sections: z.array(Section).min(1).max(20) })
  .strict()
  .refine((v) => new Set(v.sections.map((s) => s.key)).size === v.sections.length, { message: "Each section once", path: ["sections"] });

/* ------------------------------------------------------------------ *
 * The studio
 * ------------------------------------------------------------------ */

/** New Proposal on a deal: notes and/or a transcript (.md or .txt), images, a saved template. */
const ProposalStart = z
  .object({
    deal_id: uuid,
    notes: optionalText(20000),
    transcript_document_id: blank(uuid),
    asset_document_ids: z.array(uuid).max(12).optional(),
    design_template_id: blank(uuid),
  })
  .strict();

const ProposalQuestion = z
  .object({
    proposal_question_id: uuid,
    position: z.number().int().min(0),
    group_key: QuestionGroup,
    question: z.string(),
    /** One line: a help term on the card. */
    why: z.string().nullable(),
    answer_kind: AnswerKind,
    options: z.array(z.string()).nullable(),
    suggested: AnswerValue,
    /** "From the transcript, 00:21:51", "From the deal". */
    suggested_from: z.string().nullable(),
    required: z.boolean(),
    answer: AnswerValue,
    state: QuestionState,
    replaces_id: uuid.nullable(),
    /** How many times this card has been reshuffled; at most three. */
    reshuffles: z.number().int().min(0).max(3),
  })
  .strict();

const QuestionParams = z.object({ id: uuid, qid: uuid }).strict();

/** An answer typed, or Use Suggestion. */
const QuestionAnswer = z.object({ answer: AnswerValue }).strict();

/** A section's key in the path. */
const SectionParams = z.object({ id: uuid, key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/) }).strict();

/**
 * One edit of the proposal on screen: a section's fields, its layout, its place, whether it shows,
 * or an image. Every save is kept; a sent proposal is revised as a new version instead.
 */
const ProposalContentEdit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("section"), key: SectionParams.shape.key, section: Section }).strict(),
  z.object({ op: z.literal("layout"), key: SectionParams.shape.key, layout: LayoutName }).strict(),
  z.object({ op: z.literal("move"), key: SectionParams.shape.key, direction: z.enum(["up", "down"]) }).strict(),
  z.object({ op: z.literal("hide"), key: SectionParams.shape.key, hidden: z.boolean() }).strict(),
  z
    .object({
      op: z.literal("image"),
      key: SectionParams.shape.key,
      /** The section's image field: image_asset_id, partner_logo_asset_id, signer_photo_asset_id. */
      field: z.enum(["image_asset_id", "partner_logo_asset_id", "signer_photo_asset_id"]),
      document_id: uuid,
      alt: text(200),
    })
    .strict(),
]);

/** Rewrite Section: an instruction for Claude on that section only. Nothing is kept until Use Rewrite. */
const SectionRewrite = z.object({ instruction: text(500) }).strict();
const SectionRewriteDraft = z.object({ key: z.string(), section: Section }).strict();

/** Confirm and Send: nothing is sent without the person's press, and `confirm: true` with it. */
const ProposalSend = z
  .object({
    to: z.array(email).min(1, "Add an address").max(5),
    cc: z.array(email).max(5).optional(),
    subject: text(150),
    message: text(5000),
    confirm: z.literal(true),
  })
  .strict();

const ProposalDecline = z.object({ reason: text(1000) }).strict();

/** Save as Template: the layouts, their order and tone notes, never the partner's facts. */
const ProposalTemplateSave = z.object({ name: text(80) }).strict();

const TemplateStructure = z
  .object({
    layouts: z.array(LayoutName).min(1).max(20),
    tone_notes: z.string().max(2000).nullable(),
  })
  .strict();

const ProposalTemplate = z
  .object({
    proposal_template_id: uuid,
    name: z.string(),
    partner_category_id: uuid.nullable(),
    structure: TemplateStructure,
    created_from_proposal_id: uuid.nullable(),
    active: z.boolean(),
  })
  .strict();

const ProposalAsset = z
  .object({
    proposal_asset_id: uuid,
    document: DocumentRef,
    role: AssetRole,
    section_key: z.string().nullable(),
    alt: z.string(),
    stand_in: z.boolean(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Proof points (§6.11): MyCity's own facts, entered on Categories
 * ------------------------------------------------------------------ */

const ProofPoint = z
  .object({
    proof_point_id: uuid,
    kind: ProofPointKind,
    label: z.string(),
    /** The figure as said: "10,000+". */
    value: z.string().nullable(),
    detail: z.string().nullable(),
    document: DocumentRef.nullable(),
    source_note: z.string().nullable(),
    position: z.number().int(),
    active: z.boolean(),
  })
  .strict();

const ProofPointCreate = z
  .object({
    kind: ProofPointKind,
    label: text(80),
    value: optionalText(40),
    detail: optionalText(400),
    document_id: blank(uuid),
    source_note: optionalText(300),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

const ProofPointUpdate = z
  .object({
    label: text(80).optional(),
    value: z.string().trim().max(40).nullable().optional(),
    detail: z.string().trim().max(400).nullable().optional(),
    document_id: uuid.nullable().optional(),
    source_note: z.string().trim().max(300).nullable().optional(),
    position: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

const ProofPointListQuery = listQuery({ kind: ProofPointKind.optional(), active: flag.optional() }, ["position", "label"]);
const ProofPointPage = Paged(ProofPoint);

/* ------------------------------------------------------------------ *
 * Reading proposals
 * ------------------------------------------------------------------ */

const ProposalRow = z
  .object({
    partnership_proposal_id: uuid,
    number: z.string(),
    version: z.number().int().min(1),
    title: z.string().nullable(),
    status: ProposalStatus,
    value: money.nullable(),
    currency: z.string().nullable(),
    record: RecordRef,
    deal_id: uuid,
    deal_title: z.string(),
    owner: PersonRef.nullable(),
    sent_at: isoDateTime.nullable(),
    first_viewed_at: isoDateTime.nullable(),
    view_count: z.number().int().min(0),
    valid_until: isoDate.nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** The proposal whole, as the studio edits it: its brief, cards, content, images and outcome. */
const ProposalDetail = ProposalRow.extend({
  brief: z
    .object({
      notes: z.string().nullable(),
      transcript: DocumentRef.nullable(),
    })
    .strict(),
  questions: z.array(ProposalQuestion).max(40),
  content: ProposalContent.nullable(),
  assets: z.array(ProposalAsset).max(25),
  design_template_id: uuid.nullable(),
  sent_to: z.array(z.string()),
  sent_cc: z.array(z.string()),
  last_viewed_at: isoDateTime.nullable(),
  accepted_at: isoDateTime.nullable(),
  declined_at: isoDateTime.nullable(),
  decline_reason: z.string().nullable(),
  withdrawn_at: isoDateTime.nullable(),
  supersedes_id: uuid.nullable(),
  /** The private link, while it works. */
  link_url: z.string().nullable(),
  /** Whether Claude can be asked: AI Is Off and AI Limit Reached leave the kit to fill by hand. */
  ai: z.enum(["on", "off", "capped"]),
}).strict();

const ProposalListQuery = listQuery(
  {
    status: ProposalStatus.optional(),
    deal_id: uuid.optional(),
    partner_id: uuid.optional(),
    lead_id: uuid.optional(),
    owner_id: uuid.optional(),
  },
  ["sent_at", "created_at", "value"],
);
const ProposalPage = Paged(ProposalRow);

/** The cards above Proposals. */
const ProposalsSummary = z
  .object({
    sent_this_year: z.number().int().min(0),
    accepted: z.number().int().min(0),
    viewed_no_reply: z.number().int().min(0),
    /** Accepted of those decided this year, a whole percentage; null before any is decided. */
    acceptance_rate: z.number().int().min(0).max(100).nullable(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The public page (go.mycityapp.io/proposal/<token>)
 * ------------------------------------------------------------------ */

const ProposalTokenParams = z.object({ token: z.string().min(16).max(200) }).strict();

const PublicProposal = z
  .object({
    title: z.string(),
    partner_name: z.string(),
    /** The kit's HTML, the same the PDF is drawn from. */
    html: z.string(),
    owner_contact: z
      .object({
        name: z.string(),
        title: z.string().nullable(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
      })
      .strict(),
    valid_until: isoDate.nullable(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const KIT = "a section of ProposalContent, kept in partnership_proposal.content";
const ROW = {
  record: "the lead or partner its deal is on",
  deal_id: "partnership_proposal.partnership_opportunity_id",
  deal_title: "partnership_opportunity.title",
  owner: "its deal's owner, from employee and department",
};
const TABLES = {
  FigureSource: { table: null, reason: "where a figure in a section comes from" },
  CoverSection: { table: null, reason: KIT },
  LetterSection: { table: null, reason: KIT },
  OpportunitySection: { table: null, reason: KIT },
  WhyMyCitySection: { table: null, reason: KIT },
  AudienceSection: { table: null, reason: KIT },
  DeliverablesSection: { table: null, reason: KIT },
  PackagesSection: { table: null, reason: KIT },
  TimelineSection: { table: null, reason: KIT },
  ProofSection: { table: null, reason: KIT },
  TermsSection: { table: null, reason: KIT },
  NextStepsSection: { table: null, reason: KIT },
  ClosingSection: { table: null, reason: KIT },
  ProposalContent: { table: null, reason: "partnership_proposal.content: the sections in order" },
  ProposalStart: {
    table: "partnership_proposal",
    virtual: {
      deal_id: "written as partnership_opportunity_id",
      notes: "a proposal_source of kind notes",
      transcript_document_id: "a proposal_source of kind transcript",
      asset_document_ids: "proposal_asset rows",
    },
  },
  ProposalQuestion: { table: "proposal_question", virtual: { reshuffles: "the cards that replaced this one's chain" } },
  QuestionParams: { table: null, reason: "the :id and :qid path parameters" },
  QuestionAnswer: { table: "proposal_question" },
  SectionParams: { table: null, reason: "the :id and :key path parameters" },
  SectionRewrite: { table: null, reason: "an instruction for Claude; nothing is kept" },
  SectionRewriteDraft: { table: null, reason: "a rewritten section; nothing is kept until Use Rewrite" },
  ProposalSend: { table: null, reason: "the confirmed addresses and message, kept as sent_to and sent_cc and in the mail" },
  ProposalDecline: { table: null, reason: "the reason, kept as decline_reason" },
  ProposalTemplateSave: { table: "proposal_template" },
  TemplateStructure: { table: null, reason: "proposal_template.structure: layouts, their order and tone notes" },
  ProposalTemplate: { table: "proposal_template" },
  ProposalAsset: { table: "proposal_asset", virtual: { document: "the document behind document_id" } },
  ProofPoint: { table: "proof_point", virtual: { document: "the document behind document_id" } },
  ProofPointCreate: { table: "proof_point" },
  ProofPointUpdate: { table: "proof_point" },
  ProofPointListQuery: { table: null, reason: "list controls for the proof points" },
  ProofPointPage: { table: null, reason: "a page of proof points" },
  ProposalRow: { table: "partnership_proposal", virtual: ROW },
  ProposalDetail: {
    table: "partnership_proposal",
    virtual: {
      ...ROW,
      brief: "its proposal_source rows",
      questions: "its proposal_question rows",
      assets: "its proposal_asset rows",
      link_url: "the public link while its token works",
      ai: "the AI's switch and the month's cap",
    },
  },
  ProposalListQuery: { table: null, reason: "list controls and filters for the proposals" },
  ProposalPage: { table: null, reason: "a page of proposals" },
  ProposalsSummary: { table: null, reason: "figures over the proposals" },
  ProposalTokenParams: { table: null, reason: "the public link's :token" },
  PublicProposal: { table: null, reason: "the public page: the kit's HTML and the owner's contact" },
};

module.exports = {
  TABLES,
  ProposalStatus,
  QuestionGroup,
  AnswerKind,
  QuestionState,
  SourceKind,
  AssetRole,
  ProofPointKind,
  LayoutName,
  AnswerValue,
  FigureSource,
  CoverSection,
  LetterSection,
  OpportunitySection,
  WhyMyCitySection,
  AudienceSection,
  DeliverablesSection,
  PackagesSection,
  TimelineSection,
  ProofSection,
  TermsSection,
  NextStepsSection,
  ClosingSection,
  Section,
  ProposalContent,
  ProposalStart,
  ProposalQuestion,
  QuestionParams,
  QuestionAnswer,
  SectionParams,
  ProposalContentEdit,
  SectionRewrite,
  SectionRewriteDraft,
  ProposalSend,
  ProposalDecline,
  ProposalTemplateSave,
  TemplateStructure,
  ProposalTemplate,
  ProposalAsset,
  ProofPoint,
  ProofPointCreate,
  ProofPointUpdate,
  ProofPointListQuery,
  ProofPointPage,
  ProposalRow,
  ProposalDetail,
  ProposalListQuery,
  ProposalPage,
  ProposalsSummary,
  ProposalTokenParams,
  PublicProposal,
};
