"use strict";
/**
 * Interactions (docs/guides/partnerships.md §3 step 3, §6.12, §6.15): a call, meeting, email, visit or
 * note with a lead or a partner, optionally on one of its deals and with one of its contacts. Logging
 * one is contact: it ends a quiet spell. A message on a linked mail thread is an `email` interaction
 * of its own (once per message).
 *
 * The mailbox's half of a linked thread is here too (ThreadPartnerBind, ThreadContext), served on the
 * mailbox's routes (§5, PR 8): a thread is its mailbox owner's, and a record's readers see only its
 * excerpt.
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, blank, listQuery, Paged, summaryPeriod } = require("./common");
const { PersonRef } = require("./organisation");
const { RecordRef } = require("./partner_pipeline");

/** interaction_type, as seeded (7190); a meeting yet to happen is a calendar event instead. */
const InteractionType = z.enum(["call", "meeting", "email", "visit", "note"]);

const Interaction = z
  .object({
    partner_interaction_id: uuid,
    partner_id: uuid.nullable(),
    lead_id: uuid.nullable(),
    deal_id: uuid.nullable(),
    contact: z
      .object({ partner_contact_id: uuid, name: z.string() })
      .strict()
      .nullable(),
    interaction_type: InteractionType,
    subject: z.string(),
    summary: z.string().nullable(),
    occurred_at: isoDateTime,
    owner: PersonRef.nullable(),
    /** Logged from a linked mail thread. */
    from_mail: z.boolean(),
    /**
     * A message from a linked thread as the record's readers see it (§6.15): who it was from and to;
     * its subject and the first 300 characters of its text are `subject` and `summary`. The thread's id
     * only for its mailbox's owner, who alone opens the whole conversation.
     */
    mail: z
      .object({ from: z.string(), to: z.array(z.string()).max(100), mail_thread_id: uuid.nullable() })
      .strict()
      .nullable(),
    created_at: isoDateTime,
  })
  .strict();

const oneRecord = (v) => Boolean(v.partner_id) !== Boolean(v.lead_id);
const PICK_RECORD = { message: "Pick the lead or the partner", path: ["partner_id"] };

/** Log Interaction. When it happened is never in the future (the server checks it in Lagos time). */
const InteractionCreate = z
  .object({
    partner_id: blank(uuid),
    lead_id: blank(uuid),
    deal_id: blank(uuid),
    contact_id: blank(uuid),
    interaction_type: InteractionType,
    occurred_at: isoDateTime,
    subject: text(200),
    summary: z.string().trim().min(10, "At least 10 characters").max(5000),
  })
  .strict()
  .refine(oneRecord, PICK_RECORD);

const InteractionListQuery = listQuery(
  {
    partner_id: uuid.optional(),
    lead_id: uuid.optional(),
    deal_id: uuid.optional(),
    interaction_type: InteractionType.optional(),
  },
  ["occurred_at"],
);
const InteractionPage = Paged(Interaction);

/** Link to Partner on a mail thread: one lead or partner, optionally one of its deals. */
const ThreadPartnerBind = z
  .object({
    partner_id: blank(uuid),
    lead_id: blank(uuid),
    deal_id: blank(uuid),
  })
  .strict()
  .refine(oneRecord, PICK_RECORD);

/** The Partner context on a mail thread: the record it is linked to, if any. */
const ThreadContext = z
  .object({
    mail_thread_id: uuid,
    record: RecordRef.nullable(),
    deal: z.object({ deal_id: uuid, number: z.string(), title: z.string() }).strict().nullable(),
    bound_at: isoDateTime.nullable(),
    bound_by: z.string().nullable(),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
/**
 * The assistant's interaction summary (docs/guides/praxis-ai.md §6.13, Partnerships): the calls, meetings,
 * emails, visits and notes on the partners and leads the reader may see, in figures, by type, by the person
 * who logged them stacked by type, the partners and leads most reached (the grouping asked first), and by
 * month, or by week when asked. A period (when it happened) narrows it only when asked. Figures, never a row.
 */
const InteractionSummaryBy = z.enum(["type", "person", "partner", "week"]);
const InteractionSummaryQuery = z
  .object({
    partner_id: uuid.optional(),
    lead_id: uuid.optional(),
    deal_id: uuid.optional(),
    interaction_type: InteractionType.optional(),
    ...summaryPeriod,
    by: InteractionSummaryBy.default("type"),
  })
  .strict();

const TABLES = {
  InteractionSummaryQuery: { table: null, reason: "the filters, period and grouping of the assistant's interaction summary; figures, never a row" },
  Interaction: {
    table: "partner_interaction",
    virtual: {
      deal_id: "partner_interaction.partnership_opportunity_id",
      contact: "the partner_contact behind contact_id",
      owner: "the person, from employee and department",
      from_mail: "logged from a linked mail message (mail_from is set)",
      mail: "mail_from, mail_to and mail_thread_id, the thread named only to its mailbox's owner",
    },
  },
  InteractionCreate: { table: "partner_interaction", virtual: { deal_id: "written as partnership_opportunity_id" } },
  InteractionListQuery: { table: null, reason: "list controls and filters for the interactions" },
  InteractionPage: { table: null, reason: "a page of interactions" },
  ThreadPartnerBind: { table: "partner_mail_thread" },
  ThreadContext: {
    table: "partner_mail_thread",
    virtual: {
      record: "the lead or partner the thread is linked to",
      deal: "the deal it is linked to",
      bound_by: "the name behind bound_by",
    },
  },
};

module.exports = {
  TABLES,
  InteractionSummaryBy,
  InteractionSummaryQuery,
  InteractionType,
  Interaction,
  InteractionCreate,
  InteractionListQuery,
  InteractionPage,
  ThreadPartnerBind,
  ThreadContext,
};
