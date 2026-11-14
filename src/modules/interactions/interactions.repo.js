"use strict";
/**
 * Interactions: the SQL (docs/guides/partnerships.md §4.2, §6.12). An interaction is on a lead or a
 * partner (one of the two), optionally on one of its deals and with one of its contacts. Who sees
 * one is who may see its record (§6.1, partner_pipeline.repo's one rule).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const deals = require("../partner_pipeline/partner_pipeline.repo");

/**
 * An interaction as the contract's Interaction. `reader` is the SQL of the reader's employee id: a
 * message's thread is named only to its mailbox's owner (§6.15), so a row read for nobody names none.
 */
const rowOf = (reader = "NULL::uuid") => `pi.partner_interaction_id, pi.partner_id, pi.lead_id, pi.partnership_opportunity_id AS deal_id,
  CASE WHEN c.partner_contact_id IS NULL THEN NULL
       ELSE json_build_object('partner_contact_id', c.partner_contact_id, 'name', btrim(c.first_name || ' ' || c.last_name)) END AS contact,
  pi.interaction_type, pi.subject, pi.summary, pi.occurred_at, ${personJson("e", "d")} AS owner,
  (pi.mail_from IS NOT NULL OR pi.mail_message_id IS NOT NULL) AS from_mail,
  CASE WHEN pi.mail_from IS NULL THEN NULL ELSE json_build_object(
    'from', pi.mail_from, 'to', COALESCE(pi.mail_to, '{}'),
    'mail_thread_id', (SELECT mt.mail_thread_id FROM mail_thread mt
                         JOIN mail_account ma ON ma.mail_account_id = mt.mail_account_id
                         JOIN app_user au ON au.user_id = ma.user_id
                        WHERE mt.mail_thread_id = pi.mail_thread_id AND au.employee_id = ${reader})) END AS mail,
  pi.created_at`;
const ROW = rowOf();

const FROM = `FROM partner_interaction pi
  LEFT JOIN partner p ON p.partner_id = pi.partner_id
  LEFT JOIN lead l ON l.lead_id = pi.lead_id
  LEFT JOIN partner_contact c ON c.partner_contact_id = pi.contact_id
  LEFT JOIN employee e ON e.employee_id = pi.owner_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

/** Seen when its record is: the partner's rule or the lead's. */
function seenOf(scope, params) {
  const p = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  if (!p) return "";
  const l = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
  return `AND ((pi.partner_id IS NOT NULL ${p}) OR (pi.lead_id IS NOT NULL ${l}))`;
}

/** A page of interactions the reader may see, newest first unless asked otherwise. */
function list(db, query, scope) {
  const params = [query.partner_id || null, query.lead_id || null, query.deal_id || null, query.interaction_type || null, query.q || null, (scope && scope.employee_id) || null];
  const seen = seenOf(scope, params);
  return pageQuery(
    db,
    `SELECT ${rowOf("$6::uuid")}, ${TOTAL_COL} ${FROM}
      WHERE ($1::uuid IS NULL OR pi.partner_id = $1) AND ($2::uuid IS NULL OR pi.lead_id = $2)
        AND ($3::uuid IS NULL OR pi.partnership_opportunity_id = $3) AND ($4::text IS NULL OR pi.interaction_type = $4)
        AND ($5::text IS NULL OR search_fold(pi.subject || ' ' || COALESCE(pi.summary, '')) LIKE '%' || search_fold($5) || '%')
        ${seen}
      ORDER BY ${orderBy(query, { occurred_at: "pi.occurred_at" }, "pi.partner_interaction_id")}`,
    params,
    query,
  );
}

/**
 * The interactions in figures for the assistant (docs/guides/praxis-ai.md §6.13, Partnerships), in one
 * statement over those whose record the reader may see (§6.1, as list() keeps it): the counts by type,
 * the people who logged them and the partners and leads reached; by type; by the person who logged them,
 * each row's types for a stacked bar (20); the partners and leads most reached (10); and by Lagos month,
 * or by week (its Monday) when `week`. A period on the day it happened narrows it only when `from` and
 * `to` are given. Figures, never a row.
 * @param {{partner_id?: string, lead_id?: string, deal_id?: string, interaction_type?: string, from?: string, to?: string, week?: boolean}} q
 */
async function aiSummary(db, q, scope) {
  const params = [q.partner_id || null, q.lead_id || null, q.deal_id || null, q.interaction_type || null, q.from || null, q.to || null];
  const seen = seenOf(scope, params);
  const bucket = q.week
    ? "to_char(date_trunc('week', occurred_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM-DD')"
    : "to_char(occurred_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM')";
  const { rows } = await db.query(
    `WITH x AS (
       SELECT pi.partner_interaction_id, pi.interaction_type, pi.occurred_at, pi.partner_id, pi.lead_id, pi.owner_id,
              NULLIF(btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS owner,
              COALESCE(p.partner_id, l.lead_id) AS record_id,
              CASE WHEN p.partner_id IS NOT NULL THEN p.name ELSE l.name || ' (lead)' END AS record
         ${FROM}
        WHERE ($1::uuid IS NULL OR pi.partner_id = $1) AND ($2::uuid IS NULL OR pi.lead_id = $2)
          AND ($3::uuid IS NULL OR pi.partnership_opportunity_id = $3) AND ($4::text IS NULL OR pi.interaction_type = $4)
          AND ($5::date IS NULL OR (pi.occurred_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $5::date AND $6::date)
          ${seen}
     ), figures AS (
       SELECT count(*)::int AS interactions,
              count(*) FILTER (WHERE interaction_type = 'call')::int AS calls,
              count(*) FILTER (WHERE interaction_type = 'meeting')::int AS meetings,
              count(*) FILTER (WHERE interaction_type = 'email')::int AS emails,
              count(*) FILTER (WHERE interaction_type = 'visit')::int AS visits,
              count(*) FILTER (WHERE interaction_type = 'note')::int AS notes,
              count(DISTINCT owner_id)::int AS people,
              count(DISTINCT partner_id)::int AS partners,
              count(DISTINCT lead_id)::int AS leads
         FROM x
     ), by_person AS (
       SELECT COALESCE(owner_id::text, 'none') AS key, COALESCE(min(owner), 'No One') AS label,
              count(*) FILTER (WHERE interaction_type = 'call')::int AS call,
              count(*) FILTER (WHERE interaction_type = 'meeting')::int AS meeting,
              count(*) FILTER (WHERE interaction_type = 'email')::int AS email,
              count(*) FILTER (WHERE interaction_type = 'visit')::int AS visit,
              count(*) FILTER (WHERE interaction_type = 'note')::int AS note,
              row_number() OVER (ORDER BY count(*) DESC, min(owner), owner_id) AS rank
         FROM x GROUP BY owner_id
     ), by_record AS (
       SELECT record_id::text AS key, min(record) AS label, count(*)::int AS value,
              row_number() OVER (ORDER BY count(*) DESC, min(record), record_id) AS rank
         FROM x GROUP BY record_id
     ), buckets AS (
       SELECT ${bucket} AS at, count(*)::int AS value FROM x GROUP BY 1
     )
     SELECT (SELECT row_to_json(f) FROM figures f) AS figures,
            (SELECT json_agg(json_build_object('key', interaction_type, 'value', n)) FROM (SELECT interaction_type, count(*)::int AS n FROM x GROUP BY interaction_type) s) AS by_type,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'call', call, 'meeting', meeting, 'email', email, 'visit', visit, 'note', note) ORDER BY rank)
               FROM by_person WHERE rank <= 20) AS by_person,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', value) ORDER BY rank) FROM by_record WHERE rank <= 10) AS by_record,
            (SELECT json_agg(json_build_object('at', at, 'value', value) ORDER BY at) FROM buckets) AS buckets`,
    params,
  );
  const row = rows[0] || {};
  return { figures: row.figures || {}, by_type: row.by_type || [], by_person: row.by_person || [], by_record: row.by_record || [], buckets: row.buckets || [] };
}

/** A record's latest interactions (the first page, newest first). */
function latestOf(db, { kind, id }) {
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM} WHERE pi.${kind}_id = $1 ORDER BY pi.occurred_at DESC, pi.partner_interaction_id`,
    [id],
    { page: 1 },
  );
}

/** One interaction. */
async function get(db, id) {
  const { rows } = await db.query(`SELECT ${ROW} ${FROM} WHERE pi.partner_interaction_id = $1`, [id]);
  return rows[0] || null;
}

/** A new interaction; returns its id. */
async function insert(client, row) {
  const { rows } = await client.query(
    `INSERT INTO partner_interaction (partner_id, lead_id, partnership_opportunity_id, contact_id, interaction_type, subject, summary, occurred_at, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING partner_interaction_id`,
    [row.partner_id || null, row.lead_id || null, row.deal_id || null, row.contact_id || null, row.interaction_type, row.subject, row.summary, row.occurred_at, row.owner_id || null],
  );
  return rows[0].partner_interaction_id;
}

/**
 * An email interaction from a linked thread's message (§6.15), once a message: answers its id, or null
 * when the message was logged already (the partial unique index on mail_message_id).
 */
async function insertMail(client, row) {
  const { rows } = await client.query(
    `INSERT INTO partner_interaction (partner_id, lead_id, partnership_opportunity_id, interaction_type, subject, summary, occurred_at,
                                      owner_id, mail_message_id, mail_thread_id, mail_from, mail_to)
     VALUES ($1, $2, $3, 'email', $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (mail_message_id) WHERE mail_message_id IS NOT NULL DO NOTHING
     RETURNING partner_interaction_id`,
    [row.partner_id || null, row.lead_id || null, row.deal_id || null, row.subject, row.summary, row.occurred_at, row.owner_id || null, row.mail_message_id, row.mail_thread_id, row.mail_from, row.mail_to],
  );
  return rows[0] ? rows[0].partner_interaction_id : null;
}

module.exports = { list, aiSummary, latestOf, get, insert, insertMail };
