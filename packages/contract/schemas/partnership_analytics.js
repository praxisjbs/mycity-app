"use strict";
/**
 * Partnership Analytics (docs/guides/partnerships.md §6.18): MyCity's monthly performance sheet's eight
 * measures per lead owner, for a period in Lagos days, with signed deals and returns per month, by
 * category, by region and stage to stage. Within the reader's scope; returns only with
 * `partnerships.money`; a performance rating only where Performance lets the reader see it.
 *
 * Every figure is 0 and every list [] for a period with nothing in it.
 */
const { z } = require("zod");
const { uuid, isoDate, money } = require("./common");
const { PersonRef } = require("./organisation");

const AnalyticsPeriod = z.enum(["month", "quarter", "year", "custom"]);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const count = z.number().int().min(0);

/** This Month, This Quarter, This Year, or Custom with its from and to. */
const AnalyticsQuery = z
  .object({
    period: AnalyticsPeriod.default("month"),
    from: isoDate.optional(),
    to: isoDate.optional(),
    partner_category_id: uuid.optional(),
  })
  .strict()
  .refine((v) => v.period !== "custom" || Boolean(v.from && v.to), { message: "Pick the dates", path: ["from"] })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { message: "Ends before it starts", path: ["to"] });

/** One lead owner's row: the performance sheet's eight measures. */
const OwnerMeasures = z
  .object({
    owner: PersonRef.nullable(),
    new_prospects: count,
    meetings_held: count,
    proposals_sent: count,
    partnerships_signed: count,
    active_partnerships: count,
    downloads: count,
    vendor_leads: count,
    /** The person's monthly rating from Performance, as Performance shows it to the reader; null where it would not. */
    performance_rating: z.string().nullable(),
  })
  .strict();

const PartnershipAnalytics = z
  .object({
    period: z.object({ from: isoDate, to: isoDate }).strict(),
    kpis: z
      .object({
        new_prospects: count,
        meetings_held: count,
        proposals_sent: count,
        partnerships_signed: count,
      })
      .strict(),
    by_owner: z.array(OwnerMeasures).max(200),
    signed_per_month: z.array(z.object({ month, signed: count, value: money }).strict()).max(60),
    /** With `partnerships.money` only. */
    returns_per_month: z
      .array(z.object({ month, gross_sales: money, mycity_commission: money, downloads: count }).strict())
      .max(60)
      .optional(),
    by_category: z
      .array(z.object({ partner_category_id: uuid.nullable(), name: z.string(), open: count, signed: count, value: money }).strict())
      .max(100),
    by_region: z.array(z.object({ region: z.string(), open: count, signed: count }).strict()).max(100),
    stage_conversion: z
      .array(
        z
          .object({
            from_stage: z.string(),
            from_label: z.string(),
            to_stage: z.string(),
            to_label: z.string(),
            moved: count,
            /** Of the deals that reached the from stage, the share that went on to the next, a whole percentage. */
            rate: z.number().int().min(0).max(100).nullable(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  AnalyticsQuery: { table: null, reason: "the period and category Analytics reads" },
  OwnerMeasures: { table: null, reason: "one lead owner's measures over the period" },
  PartnershipAnalytics: { table: null, reason: "Analytics' figures over leads, deals, proposals, interactions and returns" },
};

module.exports = { TABLES, AnalyticsPeriod, AnalyticsQuery, OwnerMeasures, PartnershipAnalytics };
