"use strict";
/**
 * Partners and the pipeline, as Home reads them: the cards Open Opportunities, Active
 * Partnerships, Signed Value, No Contact 30 Days and Proposals Out with the records behind
 * each, the pipeline by stage and the value signed by month for the Partnerships Overview, and
 * the quiet partners Home's Partner Inactivity alerts sweep.
 *
 * OWNED BY the `partners`, `partner_pipeline`, `interactions`, `proposals` and `agreements`
 * modules, M7 Partnerships, CRM & Trackers, LA (migrations 7000 to 7060).
 *
 * Since M7 PR 3 every query here is the owning module's own read (partner_pipeline.repo,
 * partners.repo, proposals.repo), by the rule the Partnerships screens keep
 * (docs/guides/partnerships.md §6.1, §6.17): a deal is seen by its owner's scope, its team or the
 * scope of its lead's or partner's owner, a partner by its owner's scope or a deal on it whose owner
 * or team the reader may see. A pull request that changes
 * what those modules write MUST, in the same PR, keep these reads and `tables` true to every
 * column they name (docs/guides/home.md §4.1). A unit test holds `tables` to the migrated schema
 * and the queries to `tables`.
 *
 *   open opportunity     a deal with status `open`
 *   active partnership   a partner with status `active` (a deal of it is live)
 *   signed               a deal signed in the Lagos year, at its signed value: its signed
 *                        agreement's value, else its projected value (§6.6)
 *   quiet                an active partner with no interaction since the start of the day 30
 *                        days ago (Lagos); one never contacted counts from when it was added; a
 *                        linked mail's messages are interactions (§6.12, §6.15)
 *   proposal out         a proposal `sent` or `viewed`
 * Stage codes are business data (A26) and never appear here; a stage is labelled from MyCity's
 * `partnership_stage` list and ordered by it. A partner's type is its category's name.
 *
 * Money is Naira only (shared/money): a sum counts rows in `NGN` and leaves other currencies
 * out; a count counts every row (docs/guides/home.md §13).
 */
const lagos = require("../../../shared/time/lagos");
const deals = require("../../partner_pipeline/partner_pipeline.repo");
const partners = require("../../partners/partners.repo");
const proposals = require("../../proposals/proposals.repo");

/** The tables and the columns these reads name. */
const TABLES = Object.freeze({
  partner: ["partner_id", "name", "partner_category_id", "status", "owner_id", "created_at"],
  partner_category: ["partner_category_id", "name"],
  lead: ["lead_id", "name", "owner_id"],
  partner_interaction: ["partner_id", "occurred_at"],
  partnership_opportunity: [
    "partnership_opportunity_id",
    "number",
    "partner_id",
    "lead_id",
    "title",
    "stage",
    "status",
    "owner_id",
    "estimated_value",
    "currency",
    "expected_close_on",
    "signed_at",
  ],
  deal_member: ["deal_id", "employee_id"],
  partnership_proposal: ["partnership_proposal_id", "partnership_opportunity_id", "number", "status", "value", "currency", "sent_at", "view_count", "last_viewed_at"],
  partnership_agreement: ["partnership_opportunity_id", "status", "value", "signed_at"],
});

/** What M7 still owes these queries: nothing since M7 PR 3 moved them to the modules' reads. */
const OWES = Object.freeze([]);

/** Days without contact that make an active partner quiet on Home's card. */
const QUIET_DAYS = 30;

/** The instant contact must be on or after for an active partner not to be quiet. */
const quietSince = (today) => lagos.startOfDay(lagos.addDays(today, -QUIET_DAYS));

/** The first and last day of the Lagos year a date is in. */
const yearOf = (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` });

/** How many deals are open, within the scope. */
const pipelineCount = (client, scope) => deals.homeOpenCount(client, scope);
/** One page of the open deals, within the scope, soonest expected to close first. */
const pipelinePage = (client, scope, query) => deals.homeOpenPage(client, scope, query);
/** The open deals in each stage, in the list's order: the Partnership Pipeline. */
const pipelineByStage = (client, scope) => deals.homeOpenByStage(client, scope);

/** How many partners are active, within the scope. */
const activeCount = (client, scope) => partners.homeActiveCount(client, scope);
/** One page of the active partners, within the scope, by name. */
const activePage = (client, scope, query) => partners.homeActivePage(client, scope, query);
/** How many active partners have gone quiet as of a Lagos date, within the scope. */
const quietCount = (client, { today }, scope) => partners.homeQuietCount(client, quietSince(today), scope);
/** One page of the quiet partners, within the scope, the longest quiet first. */
const quietPage = (client, { today }, scope, query) => partners.homeQuietPage(client, quietSince(today), scope, query);
/** A batch of the active partners last in contact before an instant, whatever their owner (the alert sweep). */
const quietBatch = (client, batch) => partners.homeQuietBatch(client, batch);

/**
 * The value of the deals signed in the Lagos year of `today`, within the scope: the Naira sum
 * and how many deals (every currency) there are.
 * @returns {Promise<{amount: string, n: number}>} amount as numeric(18,2) text
 */
const signedValue = (client, { today }, scope) => deals.homeSigned(client, yearOf(today), scope);
/** One page of the deals signed this year, within the scope, the most recent first. */
const signedPage = (client, { today }, scope, query) => deals.homeSignedPage(client, yearOf(today), scope, query);
/** The Naira value signed in each month from `from` to `to`: the Monthly Signed Value chart. */
const signedByMonth = (client, { from, to }, scope) => deals.homeSignedByMonth(client, { from, to }, scope);

/** How many proposals are out, within the scope of their deals. */
const proposalsOutCount = (client, scope) => proposals.homeOutCount(client, scope);
/** One page of the proposals out, within the scope, the longest out first. */
const proposalsOutPage = (client, scope, query) => proposals.homeOutPage(client, scope, query);

module.exports = {
  module: "partners",
  milestone: "M7",
  owner: "LA",
  tables: TABLES,
  owes: OWES,
  QUIET_DAYS,
  pipelineCount,
  pipelinePage,
  pipelineByStage,
  activeCount,
  activePage,
  quietCount,
  quietPage,
  quietBatch,
  signedValue,
  signedPage,
  signedByMonth,
  proposalsOutCount,
  proposalsOutPage,
};
