"use strict";
/**
 * Likely duplicates over leads and partners (docs/guides/partnerships.md §6.2): advisory, never
 * blocking. New Lead and New Partner show the likely match before saving; a lead whose organisation
 * is already a partner is offered New Deal on that partner.
 *
 * Candidates come from SQL (a similar name by trigram, a contact's email or phone, the website's
 * host), at most 25; shared/dedup scores them, and a match is 55 or more:
 *
 *   name      60, in proportion to the words shared when not the same (company suffixes dropped)
 *   email     60, a contact's address
 *   website   55, the same host
 *   phone     45, a contact's number
 *
 * Every lead and partner is searched whatever the reader's scope: the point is that two people do
 * not capture the same organisation twice. Only the number and the name are returned.
 */
const { pool } = require("../../config/db");
const dedup = require("../../shared/dedup/dedup");
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");

const SIGNALS = [
  { key: "name", weight: 60, normalize: dedup.norm.company, label: "name", similar: true },
  { key: "email", weight: 60, normalize: dedup.norm.email, label: "email" },
  { key: "website", weight: 55, label: "website" },
  { key: "phone", weight: 45, normalize: dedup.norm.phone, label: "phone" },
];

/** A website's host, lower case, without `www.`: "https://www.Hevix.ng/events" is "hevix.ng". */
function hostOf(website) {
  if (!website) return null;
  const host = String(website)
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0];
  return host || null;
}

const HOST_SQL = (col) => `NULLIF(split_part(split_part(regexp_replace(regexp_replace(lower(COALESCE(${col}, '')), '^[a-z]+://', ''), '^www\\.', ''), '/', 1), ':', 1), '')`;

/**
 * The likely duplicates of what is being entered (GET /duplicates).
 * @param {{name?: string, email?: string, phone?: string, website?: string}} query  DuplicateQuery
 * @returns {Promise<{candidates: Array<{type: string, id: string, number: string, name: string, score: number, reasons: string[]}>}>}
 */
async function find(query) {
  const host = hostOf(query.website);
  const params = [query.name || null, query.email || null, query.phone || null, host];
  const contact = (kind, idExpr) => `EXISTS (SELECT 1 FROM partner_contact c WHERE c.${kind}_id = ${idExpr} AND c.email = $2)`;
  const phone = (kind, idExpr) => `EXISTS (SELECT 1 FROM partner_contact c WHERE c.${kind}_id = ${idExpr} AND ($3::text = c.phone OR $3::text = ANY(c.phones)))`;
  const named = (col) => `($1::text IS NOT NULL AND similarity(search_fold(${col}), search_fold($1)) > 0.3)`;
  const page = await pageQuery(
    pool,
    `SELECT * , ${TOTAL_COL} FROM (
       SELECT 'partner' AS type, p.partner_id AS id, p.number, p.name,
              ($2::text IS NOT NULL AND ${contact("partner", "p.partner_id")}) AS email_match,
              ($3::text IS NOT NULL AND ${phone("partner", "p.partner_id")}) AS phone_match,
              ($4::text IS NOT NULL AND ${HOST_SQL("p.website")} = $4) AS host_match,
              CASE WHEN $1::text IS NULL THEN 0 ELSE similarity(search_fold(p.name), search_fold($1)) END AS likeness
         FROM partner p
        WHERE p.status <> 'closed'
          AND (${named("p.name")} OR ($2::text IS NOT NULL AND ${contact("partner", "p.partner_id")})
               OR ($3::text IS NOT NULL AND ${phone("partner", "p.partner_id")}) OR ($4::text IS NOT NULL AND ${HOST_SQL("p.website")} = $4))
       UNION ALL
       SELECT 'lead', l.lead_id, l.number::text, l.name,
              ($2::text IS NOT NULL AND ${contact("lead", "l.lead_id")}),
              ($3::text IS NOT NULL AND ${phone("lead", "l.lead_id")}),
              ($4::text IS NOT NULL AND ${HOST_SQL("l.website")} = $4),
              CASE WHEN $1::text IS NULL THEN 0 ELSE similarity(search_fold(l.name), search_fold($1)) END
         FROM lead l
        WHERE l.status NOT IN ('converted', 'lost')
          AND (${named("l.name")} OR ($2::text IS NOT NULL AND ${contact("lead", "l.lead_id")})
               OR ($3::text IS NOT NULL AND ${phone("lead", "l.lead_id")}) OR ($4::text IS NOT NULL AND ${HOST_SQL("l.website")} = $4))
     ) cand
     ORDER BY (email_match OR phone_match OR host_match) DESC, likeness DESC, type, id`,
    params,
    { page: 1 },
  );
  const input = { name: query.name, email: query.email, phone: query.phone, website: host };
  const candidates = page.data.map((r) => ({
    key: `${r.type}:${r.id}`,
    name: r.name,
    email: r.email_match ? query.email : null,
    phone: r.phone_match ? query.phone : null,
    website: r.host_match ? host : null,
  }));
  const byKey = new Map(page.data.map((r) => [`${r.type}:${r.id}`, r]));
  const ranked = dedup.rank(input, candidates, SIGNALS, { min: 55, cap: 25, idKey: "key" });
  return {
    candidates: ranked.map((m) => {
      const r = byKey.get(m.id);
      return {
        type: r.type,
        id: r.id,
        number: r.number,
        name: r.name,
        score: m.score,
        reasons: [...new Set(m.reasons.map((x) => x.replace(" (similar)", "")))],
      };
    }),
  };
}

module.exports = { find, hostOf, SIGNALS };
