"use strict";
/**
 * The Talent Pool: candidates kept for 24 months after a role, with why, and invited back to a
 * later one (docs/guides/recruitment.md §3 step 13, §6.9; moved from M5 to M4 by TB, 04/11/2026).
 *
 * One candidate is in the pool once at a time (talent_pool_entry, migration 4060). An entry leaves
 * the pool when its 24 months end (talent-pool-purge) or on Remove; a removed entry is not listed.
 * Invite to Apply sends an Apply link to an open vacancy; the application it leads to has source
 * `pool`. Scope is the hiring manager of the vacancy the person applied for, as on Candidates.
 */
const { z } = require("zod");
const { uuid, isoDateTime, listQuery, Paged } = require("./common");
const { VacancyRef } = require("./vacancies");

/** One person in the pool. The score is the screening score of the application they came from. */
const PoolEntry = z
  .object({
    talent_pool_entry_id: uuid,
    candidate_id: uuid,
    name: z.string(),
    email: z.string(),
    application_id: uuid.nullable(),
    applied_for: VacancyRef.nullable(),
    score: z.number().min(0).max(100).nullable(),
    score_provisional: z.boolean(),
    reason: z.string(),
    added_by_name: z.string().nullable(),
    created_at: isoDateTime,
    expires_at: isoDateTime,
    invited_at: isoDateTime.nullable(),
    invited_vacancy: VacancyRef.nullable(),
    hired_from_pool: z.boolean(),
    removed_at: isoDateTime.nullable(),
  })
  .strict();

const PoolPage = Paged(PoolEntry);

/** GET /recruitment/pool. `invited=true` keeps those invited back, `false` those not yet. */
const PoolListQuery = listQuery(
  { invited: z.enum(["true", "false"]).optional() },
  ["created_at", "score", "expires_at"],
);

/** GET /recruitment/pool/summary: the four figures above the list, in the reader's scope. */
const PoolSummary = z
  .object({
    in_pool: z.number().int().min(0),
    invited_back: z.number().int().min(0),
    hired_from_pool: z.number().int().min(0),
    average_score: z.number().min(0).max(100).nullable(),
  })
  .strict();

/** POST /recruitment/pool (Add to Pool): from an application, with why. Again for one already in it renews the 24 months. */
const PoolAdd = z
  .object({
    application_id: uuid,
    reason: z.string().trim().min(5, "Say why").max(500, "At most 500 characters"),
  })
  .strict();

/** POST /recruitment/pool/:id/invite: an Apply link to an open vacancy. */
const PoolInvite = z.object({ vacancy_id: uuid }).strict();

/** POST /recruitment/pool/:id/remove: off the pool before their time. */
const PoolRemove = z
  .object({ removed_reason: z.string().trim().max(500, "At most 500 characters").optional() })
  .strict();

/** POST /recruitment/pool/exports: the whole filtered pool as a workbook, answered as documents ExportFile. */
const PoolExportRequest = z
  .object({ invited: z.enum(["true", "false"]).optional(), q: z.string().trim().max(100).optional() })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  PoolEntry: {
    table: "talent_pool_entry",
    virtual: {
      name: "the candidate's first and last name",
      email: "candidate.email",
      applied_for: "the vacancy of the application they came from",
      score: "that application's screening_score, or provisional_score while there is none",
      score_provisional: "true while score is provisional_score",
      added_by_name: "the display name of who added them",
      invited_vacancy: "the vacancy they were invited to; null when its hiring manager is outside the reader's scope",
      hired_from_pool: "a later application of source pool reached stage hired",
    },
  },
  PoolPage: { table: null, reason: "a page of the pool" },
  PoolListQuery: { table: null, reason: "list controls and filters for the Talent Pool" },
  PoolSummary: { table: null, reason: "counts over talent_pool_entry within the reader's scope" },
  PoolAdd: { table: "talent_pool_entry" },
  PoolInvite: { table: null, reason: "the vacancy an Apply link is for; stamped as invited_vacancy_id" },
  PoolRemove: { table: "talent_pool_entry" },
  PoolExportRequest: { table: null, reason: "the filters of a pool export; nothing is kept but the file" },
};

module.exports = {
  TABLES,
  PoolEntry,
  PoolPage,
  PoolListQuery,
  PoolSummary,
  PoolAdd,
  PoolInvite,
  PoolRemove,
  PoolExportRequest,
};
