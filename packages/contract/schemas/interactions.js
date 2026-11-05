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
const { uuid, text, isoDateTime, blank, listQuery, Paged } = require("./common");
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
const TABLES = {
  Interaction: {
    table: "partner_interaction",
    virtual: {
      deal_id: "partner_interaction.partnership_opportunity_id",
      contact: "the partner_contact behind contact_id",
      owner: "the person, from employee and department",
      from_mail: "mail_message_id is set",
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
  InteractionType,
  Interaction,
  InteractionCreate,
  InteractionListQuery,
  InteractionPage,
  ThreadPartnerBind,
  ThreadContext,
};
