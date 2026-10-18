"use strict";
/**
 * Partners and the pipeline, as Home reads them: the cards Open Opportunities, Active
 * Partnerships, Signed Value, No Contact 30 Days and Proposals Out with the records behind
 * each, and the pipeline by stage and the value signed by month for the Partnerships
 * Overview.
 *
 * OWNED BY the `partners`, `partner_pipeline`, `interactions`, `proposals` and `agreements`
 * modules, M7 Partnerships, CRM & Trackers, GE (migration 7000).
 *
 * Home reads these tables before the modules that own them are built, so this file is the
 * one place Home names them. The M7 pull request that builds them MUST, in the same PR, move
 * or replace these queries with its own reads, keep `tables` true to every column they name,
 * and clear `owes` as it pays each item (docs/guides/home.md §4.1, docs/DATABASE_SCHEMA.md M7
 * Owes). A unit test holds `tables` to the migrated schema and the queries to `tables`.
 *
 * The rules Home reads them by, until M7 settles its vocabularies:
 *   a partner, an opportunity or an agreement is its owner's (owner_id), so a row with no
 *     owner is seen only with `all` scope; a proposal is its opportunity's owner's
 *   open opportunity     status `open`
 *   active partnership   a partner with status `active`
 *   signed               an agreement with status `signed` or `active`, in the year it starts
 *   quiet                an active partner with no recorded contact since the start of the day
 *                        30 days ago (Lagos); one never contacted counts from when it was added
 *   proposal out         sent, not accepted, its opportunity still open
 * Stage codes are business data (A26) and never appear here; a stage is labelled from the
 * `partnership_stage` code list and ordered by it.
 *
 * Money is Naira only (shared/money): a sum counts rows in `NGN` and leaves other
 * currencies out; a count counts every row (docs/guides/home.md §13).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../../shared/http/paged");
const { scopeClause } = require("../../../shared/rbac/scope");
const lagos = require("../../../shared/time/lagos");
const { PERSON } = require("../kpi-catalog/shared");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  partner: ["partner_id", "name", "partner_type", "status", "owner_id", "created_at"],
  partner_interaction: ["partner_id", "occurred_at"],
  partnership_opportunity: [
    "partnership_opportunity_id",
    "partner_id",
    "title",
    "stage",
    "status",
    "owner_id",
    "estimated_value",
    "currency",
    "expected_close_on",
  ],
  partnership_proposal: [
    "partnership_proposal_id",
    "partnership_opportunity_id",
    "number",
    "value",
    "currency",
    "sent_at",
    "accepted_at",
  ],
  partnership_agreement: [
    "partnership_agreement_id",
    "partner_id",
    "number",
    "title",
    "status",
    "starts_on",
    "value",
    "currency",
    "owner_id",
  ],
});

/** What M7 still owes these queries. */
const OWES = Object.freeze([
  "MyCity's twelve stages and partner types in place of the seeded ones (DATABASE_SCHEMA M7, A26).",
  "Partner and agreement statuses: Home reads a partner `active` as active, an agreement `signed` or `active` as signed.",
  "The agreement workflow, its signed date and MOU or contract type: until then an agreement counts in the year it starts.",
  "Mail threads bound to a partner: until then contact is the interactions recorded.",
  "The currency rule for sums: Naira only until the owner decides (home.md §13).",
  "Index partner_interaction (partner_id, occurred_at DESC), partner (owner_id), partnership_opportunity (owner_id, " +
    "status) and partnership_agreement (status, starts_on) (asked by Home).",
]);

/** Days without contact that make an active partner quiet. */
const QUIET_DAYS = 30;

/** The agreement statuses that mean it is signed. */
const SIGNED = "pa.status IN ('signed', 'active')";

/** When a partner was last in contact: their latest interaction, else when they were added. */
const LAST_CONTACT = `COALESCE((SELECT max(pi.occurred_at) FROM partner_interaction pi
  WHERE pi.partner_id = p.partner_id), p.created_at)`;

/** The instant contact must be on or after for an active partner not to be quiet. */
const quietSince = (today) => lagos.startOfDay(lagos.addDays(today, -QUIET_DAYS));

/** The first and last day of the Lagos year a date is in. */
const yearOf = (today) => ({ from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` });

const search = (n, column) => `($${n}::text IS NULL OR search_fold(${column}) LIKE '%' || search_fold($${n}) || '%')`;

async function one(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}

/* ------------------------------------------------------------------ *
 * Open opportunities
 * ------------------------------------------------------------------ */

/** How many opportunities are open, within the scope. */
async function pipelineCount(client, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "po.owner_id" }, params);
  const sql = `SELECT count(*)::int AS n FROM partnership_opportunity po WHERE po.status = 'open' ${s.and}`;
  return (await one(client, sql, params)).n;
}

/** One page of the open opportunities, within the scope, soonest expected to close first. */
function pipelinePage(client, scope, query) {
  const params = [query.q || null];
  const s = scopeClause(scope, { column: "po.owner_id" }, params);
  return pageQuery(
    client,
    `SELECT po.partnership_opportunity_id, po.title, p.name AS partner, po.stage,
            COALESCE(rv.label, po.stage) AS stage_label, po.estimated_value, po.currency, po.expected_close_on,
            ${PERSON("e", "d")} AS owner, ${TOTAL_COL}
       FROM partnership_opportunity po
       JOIN partner p ON p.partner_id = po.partner_id
       LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = po.stage
       LEFT JOIN employee e ON e.employee_id = po.owner_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE po.status = 'open' AND ${search(1, "po.title || ' ' || p.name")}
        ${s.and}
      ORDER BY ${orderBy(query, { expected_close_on: "po.expected_close_on" }, "po.partnership_opportunity_id")}`,
    params,
    query,
  );
}

/**
 * The open opportunities in each stage, within the scope, in the stages' own order (the
 * code list's; a stage it does not list comes last): the Partnership Pipeline. One row a
 * stage that has any.
 * @returns {Promise<Array<{stage: string, label: string, open: number}>>}
 */
async function pipelineByStage(client, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "po.owner_id" }, params);
  const { rows } = await client.query(
    `SELECT po.stage, COALESCE(rv.label, po.stage) AS label, count(*)::int AS open
       FROM partnership_opportunity po
       LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = po.stage
      WHERE po.status = 'open' ${s.and}
      GROUP BY po.stage, rv.label, rv.display_order
      ORDER BY rv.display_order NULLS LAST, po.stage`,
    params,
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Active partnerships, and the quiet ones
 * ------------------------------------------------------------------ */

/** How many partners are active, within the scope. */
async function activeCount(client, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "p.owner_id" }, params);
  return (await one(client, `SELECT count(*)::int AS n FROM partner p WHERE p.status = 'active' ${s.and}`, params)).n;
}

/** One page of the active partners, within the scope, by name, each with when they were last in contact. */
function activePage(client, scope, query) {
  const params = [query.q || null];
  const s = scopeClause(scope, { column: "p.owner_id" }, params);
  return pageQuery(
    client,
    `SELECT p.partner_id, p.name, p.partner_type, ${LAST_CONTACT} AS last_contact_at,
            ${PERSON("e", "d")} AS owner, ${TOTAL_COL}
       FROM partner p
       LEFT JOIN employee e ON e.employee_id = p.owner_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE p.status = 'active' AND ${search(1, "p.name")}
        ${s.and}
      ORDER BY ${orderBy(query, { name: "p.name" }, "p.partner_id")}`,
    params,
    query,
  );
}

/**
 * How many active partners have gone quiet as of a Lagos date, within the scope.
 * @param {{query: Function}} client
 * @param {{today: string}} on
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
async function quietCount(client, { today }, scope) {
  const params = [quietSince(today)];
  const s = scopeClause(scope, { column: "p.owner_id" }, params);
  return (
    await one(
      client,
      `SELECT count(*)::int AS n FROM partner p
        WHERE p.status = 'active' AND ${LAST_CONTACT} < $1::timestamptz ${s.and}`,
      params,
    )
  ).n;
}

/** One page of the quiet partners, within the scope, the longest quiet first. */
function quietPage(client, { today }, scope, query) {
  const params = [quietSince(today), query.q || null];
  const s = scopeClause(scope, { column: "q.owner_id" }, params);
  return pageQuery(
    client,
    `SELECT q.partner_id, q.name, q.last_contact_at, ${PERSON("e", "d")} AS owner, ${TOTAL_COL}
       FROM (SELECT p.partner_id, p.name, p.owner_id, ${LAST_CONTACT} AS last_contact_at
               FROM partner p WHERE p.status = 'active') q
       LEFT JOIN employee e ON e.employee_id = q.owner_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE q.last_contact_at < $1::timestamptz AND ${search(2, "q.name")}
        ${s.and}
      ORDER BY ${orderBy(query, { last_contact_at: "q.last_contact_at" }, "q.partner_id")}`,
    params,
    query,
  );
}

/**
 * The active partners last in contact before `before` (an instant), a batch of at most `size`
 * after the partner `after` (by id), each with its name and last contact: Home's Partner
 * Inactivity alert rules read them in their daily sweep. Every partner, whatever its owner:
 * who sees an alert is the alert list's decision.
 * @param {{query: Function}} client
 * @param {{before: Date, after?: string|null, size: number}} batch
 * @returns {Promise<Array<{partner_id: string, name: string, last_contact_at: Date}>>}
 */
async function quietBatch(client, { before, after = null, size }) {
  const { rows } = await client.query(
    `SELECT q.partner_id, q.name, q.last_contact_at
       FROM (SELECT p.partner_id, p.name, ${LAST_CONTACT} AS last_contact_at
               FROM partner p
              WHERE p.status = 'active' AND ($2::uuid IS NULL OR p.partner_id > $2::uuid)) q
      WHERE q.last_contact_at < $1::timestamptz
      ORDER BY q.partner_id
      LIMIT $3 -- pagination:batch the partners one step of Home's alert sweep reads`,
    [before, after, size],
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Signed value
 * ------------------------------------------------------------------ */

/**
 * The value of the agreements signed in the Lagos year of `today`, within the scope: the
 * Naira sum and how many agreements (every currency) there are.
 * @returns {Promise<{amount: string, n: number}>} amount as numeric(18,2) text
 */
async function signedValue(client, { today }, scope) {
  const { from, to } = yearOf(today);
  const params = [from, to];
  const s = scopeClause(scope, { column: "pa.owner_id" }, params);
  return one(
    client,
    `SELECT COALESCE(sum(pa.value) FILTER (WHERE pa.currency = 'NGN'), 0)::numeric(18,2) AS amount,
            count(*)::int AS n
       FROM partnership_agreement pa
      WHERE ${SIGNED} AND pa.starts_on >= $1::date AND pa.starts_on <= $2::date ${s.and}`,
    params,
  );
}

/** One page of the agreements signed this year, within the scope, the most recent first. */
function signedPage(client, { today }, scope, query) {
  const { from, to } = yearOf(today);
  const params = [from, to, query.q || null];
  const s = scopeClause(scope, { column: "pa.owner_id" }, params);
  return pageQuery(
    client,
    `SELECT pa.partnership_agreement_id, pa.number, pa.title, p.name AS partner, pa.starts_on, pa.value,
            pa.currency, ${PERSON("e", "d")} AS owner, ${TOTAL_COL}
       FROM partnership_agreement pa
       JOIN partner p ON p.partner_id = pa.partner_id
       LEFT JOIN employee e ON e.employee_id = pa.owner_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE ${SIGNED} AND pa.starts_on >= $1::date AND pa.starts_on <= $2::date
        AND ${search(3, "pa.title || ' ' || p.name")}
        ${s.and}
      ORDER BY ${orderBy(query, { starts_on: "pa.starts_on DESC" }, "pa.partnership_agreement_id")}`,
    params,
    query,
  );
}

/**
 * The Naira value signed in each month from `from` to `to` (dates, both included), within
 * the scope, oldest first; a month with nothing signed has no row: the Monthly Signed Value
 * chart.
 * @returns {Promise<Array<{month: string, amount: string}>>} month as YYYY-MM
 */
async function signedByMonth(client, { from, to }, scope) {
  const params = [from, to];
  const s = scopeClause(scope, { column: "pa.owner_id" }, params);
  const { rows } = await client.query(
    `SELECT to_char(date_trunc('month', pa.starts_on), 'YYYY-MM') AS month,
            sum(pa.value)::numeric(18,2) AS amount
       FROM partnership_agreement pa
      WHERE ${SIGNED} AND pa.currency = 'NGN' AND pa.value IS NOT NULL
        AND pa.starts_on >= $1::date AND pa.starts_on <= $2::date ${s.and}
      GROUP BY 1
      ORDER BY 1`,
    params,
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Proposals out
 * ------------------------------------------------------------------ */

const PROPOSAL_OUT = `pp.sent_at IS NOT NULL AND pp.accepted_at IS NULL AND po.status = 'open'`;

/** How many proposals are out, within the scope of their opportunities' owners. */
async function proposalsOutCount(client, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "po.owner_id" }, params);
  return (
    await one(
      client,
      `SELECT count(*)::int AS n
         FROM partnership_proposal pp
         JOIN partnership_opportunity po ON po.partnership_opportunity_id = pp.partnership_opportunity_id
        WHERE ${PROPOSAL_OUT} ${s.and}`,
      params,
    )
  ).n;
}

/** One page of the proposals out, within the scope, the longest out first. */
function proposalsOutPage(client, scope, query) {
  const params = [query.q || null];
  const s = scopeClause(scope, { column: "po.owner_id" }, params);
  return pageQuery(
    client,
    `SELECT pp.partnership_proposal_id, pp.number, po.title AS opportunity, p.name AS partner, pp.sent_at,
            pp.value, pp.currency, ${TOTAL_COL}
       FROM partnership_proposal pp
       JOIN partnership_opportunity po ON po.partnership_opportunity_id = pp.partnership_opportunity_id
       JOIN partner p ON p.partner_id = po.partner_id
      WHERE ${PROPOSAL_OUT} AND ${search(1, "po.title || ' ' || p.name")}
        ${s.and}
      ORDER BY ${orderBy(query, { sent_at: "pp.sent_at" }, "pp.partnership_proposal_id")}`,
    params,
    query,
  );
}

module.exports = {
  module: "partners",
  milestone: "M7",
  owner: "GE",
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
