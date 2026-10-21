"use strict";
/**
 * Policies' SQL (docs/guides/policies.md §4). Reads and writes policy, policy_version,
 * policy_audience, policy_signature and policy_acknowledgement; nothing else writes them.
 *
 * Who is asked about a version is worked out when read (§6.7): everyone at work (active, started,
 * not left) with an active login whom its Applies To reaches. The version a person acknowledges is
 * the newest published one of a policy.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const approvers = require("../../shared/workflow/approvers");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;
const PERSON = (alias = "e", dept = "d") => personJson(alias, dept);

/** A timestamp's day in Lagos. */
const LAGOS_DAY = (col) => `(${col} AT TIME ZONE 'Africa/Lagos')::date`;
/** At work on a day, with a login. */
const AT_WORK = (e, day) => `${e}.status = 'active'
   AND (${e}.start_date IS NULL OR ${e}.start_date <= ${day})
   AND (${e}.left_on IS NULL OR ${e}.left_on > ${day})
   AND EXISTS (SELECT 1 FROM app_user au WHERE au.employee_id = ${e}.employee_id AND au.status = 'active')`;
/** Whom a version's Applies To reaches. */
const APPLIES = (v, e) => `(${v}.applies_to_everyone OR EXISTS (
     SELECT 1 FROM policy_audience pa
      WHERE pa.policy_version_id = ${v}.policy_version_id
        AND (pa.department_id = ${e}.department_id OR pa.work_pattern = ${e}.work_pattern
             OR pa.employee_id = ${e}.employee_id)))`;
const ASKED = (v, e, day) => `${AT_WORK(e, day)} AND ${APPLIES(v, e)}`;
/** When a person must have acknowledged a version: within its days of the later of its publication and their first day. */
const DUE_ON = (v, e) =>
  `(GREATEST(${LAGOS_DAY(`${v}.published_at`)}, COALESCE(${e}.start_date, ${LAGOS_DAY(`${v}.published_at`)})) + ${v}.acknowledge_within_days)`;
/** No later published version of the same policy. */
const NEWEST = (v) => `NOT EXISTS (SELECT 1 FROM policy_version nv
   WHERE nv.policy_id = ${v}.policy_id AND nv.status = 'published' AND nv.version > ${v}.version)`;
/** Who a user column names. */
const NAME_OF = (userCol) => `(SELECT btrim(ne.first_name || ' ' || ne.last_name) FROM app_user nu
   JOIN employee ne ON ne.employee_id = nu.employee_id WHERE nu.user_id = ${userCol})`;

const VERSION = `v.policy_version_id, v.policy_id, p.number, p.kind, p.status AS policy_status, v.status,
       v.version, v.effective_from, v.note, v.title, v.body_markdown, v.rules, v.applies_to_everyone,
       v.needs_acknowledgement, v.acknowledge_within_days, v.needs_approval, v.content_hash,
       v.workflow_instance_id, v.submitted_at, v.submitted_by, v.published_at, v.withdrawn_at, v.withdraw_reason,
       v.updated_at, ${NAME_OF("v.published_by")} AS published_by_name,
       ${NAME_OF("v.submitted_by")} AS submitted_by_name,
       ${NAME_OF("COALESCE(v.updated_by, v.created_by)")} AS updated_by_name`;

/* ------------------------------------------------------------------ *
 * Policies
 * ------------------------------------------------------------------ */

/** One change to a policy at a time: a draft saved, a submission, a publication, a withdrawal. */
function lock(client, key) {
  return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`policy:${key}`]);
}

const POLICY = "policy_id, number, kind, title, status, archived_at, created_at, updated_at";

function getPolicy(db, id) {
  return one(db, `SELECT ${POLICY} FROM policy WHERE policy_id = $1`, [id]);
}

function insertPolicy(client, { number, kind, title, userId }) {
  return one(
    client,
    `INSERT INTO policy (number, kind, title, created_by, updated_by) VALUES ($1, $2, $3, $4, $4)
     RETURNING ${POLICY}`,
    [number, kind, title, userId],
  );
}

function renamePolicy(client, id, title, userId) {
  return client.query("UPDATE policy SET title = $2, updated_by = $3 WHERE policy_id = $1 AND title <> $2", [
    id,
    title,
    userId,
  ]);
}

function archivePolicy(client, id, { reason, userId }) {
  return one(
    client,
    `UPDATE policy SET status = 'archived', archived_at = now(), archived_by = $2, archive_reason = $3, updated_by = $2
      WHERE policy_id = $1 AND status = 'active' AND kind = 'document'
      RETURNING ${POLICY}`,
    [id, userId, reason],
  );
}

/** The SQL each PolicyListQuery sort reads. The first is the default order. */
const POLICY_SORTS = { title: "x.title", number: "x.number", updated_at: "x.updated_at" };

/**
 * A page of policies, each with its state on `today`, the number in force, and its newest
 * published version (whose Applies To and acknowledgements the row shows).
 */
function listPolicies(db, query, today) {
  const params = [today, query.kind || null, query.state || null, query.q || null];
  return pageQuery(
    db,
    `WITH x AS (
       SELECT p.policy_id, p.number, p.kind, p.title, p.updated_at,
              CASE WHEN p.status = 'archived' THEN 'archived'
                   WHEN EXISTS (SELECT 1 FROM policy_version s WHERE s.policy_id = p.policy_id AND s.status = 'submitted')
                     THEN 'awaiting_approval'
                   WHEN EXISTS (SELECT 1 FROM policy_version f WHERE f.policy_id = p.policy_id
                                  AND f.status = 'published' AND f.effective_from <= $1::date) THEN 'in_force'
                   WHEN EXISTS (SELECT 1 FROM policy_version w WHERE w.policy_id = p.policy_id AND w.status = 'published')
                     THEN 'waiting'
                   ELSE 'draft' END AS state,
              -- The first of each, by aggregate: pageQuery alone limits a paged query.
              (SELECT (array_agg(f.version ORDER BY f.effective_from DESC, f.version DESC))[1]
                 FROM policy_version f
                WHERE f.policy_id = p.policy_id AND f.status = 'published' AND f.effective_from <= $1::date) AS version_in_force,
              (SELECT (array_agg(n.policy_version_id ORDER BY n.version DESC))[1]
                 FROM policy_version n
                WHERE n.policy_id = p.policy_id AND n.status = 'published') AS newest_version_id,
              (SELECT (array_agg(d.policy_version_id ORDER BY (d.status = 'submitted') DESC))[1]
                 FROM policy_version d
                WHERE d.policy_id = p.policy_id AND d.status IN ('draft', 'submitted')) AS working_version_id
         FROM policy p
     )
     SELECT x.*, ${TOTAL_COL}
       FROM x
      WHERE ($2::text IS NULL OR x.kind = $2)
        AND ($3::text IS NULL OR x.state = $3)
        AND ($4::text IS NULL OR search_fold(x.title || ' ' || x.number) LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(query, POLICY_SORTS, "x.policy_id")}`,
    params,
    query,
  );
}

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

function getVersion(db, id) {
  return one(
    db,
    `SELECT ${VERSION} FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id WHERE v.policy_version_id = $1`,
    [id],
  );
}

/** The policy's draft or submission (`status`), or null. */
function workingVersion(db, policyId, status) {
  return one(
    db,
    `SELECT ${VERSION} FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id
      WHERE v.policy_id = $1 AND v.status = $2`,
    [policyId, status],
  );
}

/** The version in force on a date: the latest published one whose first day is on or before it. */
function versionInForce(db, policyId, date) {
  return one(
    db,
    `SELECT ${VERSION} FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id
      WHERE v.policy_id = $1 AND v.status = 'published' AND v.effective_from <= $2::date
      ORDER BY v.effective_from DESC, v.version DESC LIMIT 1`,
    [policyId, date],
  );
}

/** The version of a rules type's policy in force on a date, with only what a module reads. */
function rulesInForce(db, kind, date) {
  return one(
    db,
    `SELECT v.policy_version_id, v.version, v.rules
       FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id
      WHERE p.kind = $1 AND v.status = 'published' AND v.effective_from <= $2::date
      ORDER BY v.effective_from DESC, v.version DESC LIMIT 1`,
    [kind, date],
  );
}

/**
 * One published (or once published, now past) version of a rules policy of this kind, by its id, or
 * null: the version something was judged by (§6.8, rulesOfVersion).
 */
function rulesOfVersion(db, kind, versionId) {
  return one(
    db,
    `SELECT v.policy_version_id, v.version, v.rules
       FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id
      WHERE p.kind = $1 AND v.policy_version_id = $2`,
    [kind, versionId],
  );
}

/** The newest published version (waiting or in force), or null. */
function newestPublished(db, policyId) {
  return one(
    db,
    `SELECT ${VERSION} FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id
      WHERE v.policy_id = $1 AND v.status = 'published' ORDER BY v.version DESC LIMIT 1`,
    [policyId],
  );
}

/** The published version before `version` (withdrawn ones skipped), or null. */
function previousPublished(db, policyId, version) {
  return one(
    db,
    `SELECT ${VERSION} FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id
      WHERE v.policy_id = $1 AND v.status = 'published' AND v.version < $2::int
      ORDER BY v.version DESC LIMIT 1`,
    [policyId, version],
  );
}

/** The latest first day of a version still waiting after `date`, or null. */
async function lastWaitingStart(db, policyId, date) {
  const row = await one(
    db,
    `SELECT max(effective_from) AS starts FROM policy_version
      WHERE policy_id = $1 AND status = 'published' AND effective_from > $2::date`,
    [policyId, date],
  );
  return row ? row.starts : null;
}

/** The next number for a policy's version: never one used before, withdrawn ones included. */
async function nextVersion(db, policyId) {
  const row = await one(
    db,
    "SELECT COALESCE(max(version), 0)::int + 1 AS next FROM policy_version WHERE policy_id = $1",
    [policyId],
  );
  return row.next;
}

const CONTENT = [
  "title",
  "body_markdown",
  "rules",
  "applies_to_everyone",
  "needs_acknowledgement",
  "acknowledge_within_days",
  "needs_approval",
];
const contentValues = (f) => [
  f.title,
  f.body_markdown === undefined ? null : f.body_markdown,
  f.rules ? JSON.stringify(f.rules) : null,
  f.applies_to_everyone,
  f.needs_acknowledgement,
  f.acknowledge_within_days,
  f.needs_approval,
];

function insertDraft(client, policyId, f, userId) {
  return one(
    client,
    `INSERT INTO policy_version (policy_id, status, ${CONTENT.join(", ")}, created_by, updated_by)
     VALUES ($1, 'draft', $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $9)
     RETURNING policy_version_id`,
    [policyId, ...contentValues(f), userId],
  );
}

function updateDraft(client, id, f, userId) {
  return one(
    client,
    `UPDATE policy_version
        SET title = $2, body_markdown = $3, rules = $4::jsonb, applies_to_everyone = $5,
            needs_acknowledgement = $6, acknowledge_within_days = $7, needs_approval = $8, updated_by = $9
      WHERE policy_version_id = $1 AND status = 'draft'
      RETURNING policy_version_id`,
    [id, ...contentValues(f), userId],
  );
}

async function deleteDraft(client, id) {
  const { rowCount } = await client.query(
    "DELETE FROM policy_version WHERE policy_version_id = $1 AND status = 'draft'",
    [id],
  );
  return rowCount > 0;
}

/** A version's Applies To beyond everyone, replaced. */
async function replaceAudience(client, id, appliesTo) {
  await client.query("DELETE FROM policy_audience WHERE policy_version_id = $1", [id]);
  if (appliesTo.everyone) return;
  await client.query(
    `INSERT INTO policy_audience (policy_version_id, department_id)
     SELECT $1, d FROM unnest($2::uuid[]) d ON CONFLICT DO NOTHING`,
    [id, appliesTo.department_ids],
  );
  await client.query(
    `INSERT INTO policy_audience (policy_version_id, work_pattern)
     SELECT $1, w FROM unnest($2::text[]) w ON CONFLICT DO NOTHING`,
    [id, appliesTo.work_patterns],
  );
  await client.query(
    `INSERT INTO policy_audience (policy_version_id, employee_id)
     SELECT $1, e FROM unnest($2::uuid[]) e ON CONFLICT DO NOTHING`,
    [id, appliesTo.employee_ids],
  );
}

/** Copy one version's Applies To onto another (a withdrawn version back into the draft). */
function copyAudience(client, fromId, toId) {
  return client.query(
    `INSERT INTO policy_audience (policy_version_id, department_id, work_pattern, employee_id)
     SELECT $2, department_id, work_pattern, employee_id FROM policy_audience WHERE policy_version_id = $1
     ON CONFLICT DO NOTHING`,
    [fromId, toId],
  );
}

/** Each version's Applies To rows, with the names a person reads. */
async function audienceOf(db, ids) {
  if (!ids.length) return [];
  // pagination:complete a page's versions' audiences, at most 25 versions
  const { rows } = await completeQuery(
    db,
    `SELECT pa.policy_version_id, pa.department_id, d.name AS department_name, pa.work_pattern,
            pa.employee_id, btrim(e.first_name || ' ' || e.last_name) AS employee_name
       FROM policy_audience pa
       LEFT JOIN department d ON d.department_id = pa.department_id
       LEFT JOIN employee e ON e.employee_id = pa.employee_id
      WHERE pa.policy_version_id = ANY($1::uuid[])
      ORDER BY pa.policy_version_id, d.name, pa.work_pattern, e.first_name, pa.policy_audience_id`,
    [ids],
    { label: "who a page of policy versions applies to" },
  );
  return rows;
}

/** The people a version names in Applies To, as PersonRefs. */
async function namedPeople(db, id) {
  // pagination:complete Applies To names at most 200 people (contract AppliesTo)
  const { rows } = await completeQuery(
    db,
    `SELECT ${PERSON()} AS person
       FROM policy_audience pa
       JOIN employee e ON e.employee_id = pa.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE pa.policy_version_id = $1
      ORDER BY e.first_name, e.last_name, e.employee_id`,
    [id],
    { label: "the people a policy version names" },
  );
  return rows.map((r) => r.person);
}

/** The draft sent for approval. */
function submit(client, id, { effective_from: from, note, contentHash, userId }) {
  return one(
    client,
    `UPDATE policy_version
        SET status = 'submitted', effective_from = $2::date, note = $3, content_hash = $4,
            submitted_at = now(), submitted_by = $5, updated_by = $5
      WHERE policy_version_id = $1 AND status = 'draft'
      RETURNING policy_version_id`,
    [id, from, note, contentHash, userId],
  );
}

function setWorkflowInstance(client, id, instanceId) {
  return client.query("UPDATE policy_version SET workflow_instance_id = $2 WHERE policy_version_id = $1", [
    id,
    instanceId,
  ]);
}

/** A submission rejected or recalled: the draft again, with its content. */
function backToDraft(client, id) {
  return one(
    client,
    `UPDATE policy_version
        SET status = 'draft', effective_from = NULL, note = NULL, content_hash = NULL,
            submitted_at = NULL, submitted_by = NULL, workflow_instance_id = NULL
      WHERE policy_version_id = $1 AND status = 'submitted'
      RETURNING policy_version_id`,
    [id],
  );
}

/** A draft or a submission made `Version N`, from its first day. */
function publish(client, id, { version, effective_from: from, note, contentHash, userId }) {
  return one(
    client,
    `UPDATE policy_version
        SET status = 'published', version = $2::int, effective_from = $3::date, note = $4,
            content_hash = $5, published_at = now(), published_by = $6,
            submitted_at = COALESCE(submitted_at, now()), submitted_by = COALESCE(submitted_by, $6),
            updated_by = $6
      WHERE policy_version_id = $1 AND status IN ('draft', 'submitted')
      RETURNING policy_version_id`,
    [id, version, from, note, contentHash, userId],
  );
}

/** A version waiting to start withdrawn. */
function withdraw(client, id, { reason, userId, today }) {
  return one(
    client,
    `UPDATE policy_version
        SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2, withdraw_reason = $3, updated_by = $2
      WHERE policy_version_id = $1 AND status = 'published' AND effective_from > $4::date
      RETURNING policy_version_id`,
    [id, userId, reason, today],
  );
}

/* ------------------------------------------------------------------ *
 * Signatures
 * ------------------------------------------------------------------ */

function insertSignature(client, s) {
  return one(
    client,
    `INSERT INTO policy_signature (policy_version_id, role, stage_key, stage_name, user_id, employee_id,
                                   signer_name, signer_title, signature_document_id, content_hash)
     SELECT $1, $2, $3, $4, u.user_id, e.employee_id,
            COALESCE(btrim(e.first_name || ' ' || e.last_name), u.email), e.job_title, $6, $7
       FROM app_user u LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.user_id = $5
     RETURNING policy_signature_id`,
    [s.policy_version_id, s.role, s.stage_key || null, s.stage_name || null, s.user_id, s.document_id, s.content_hash],
  );
}

async function signaturesOf(db, ids) {
  if (!ids.length) return [];
  // pagination:complete a page's versions' signatures: a publisher and a few approvers each
  const { rows } = await completeQuery(
    db,
    `SELECT policy_version_id, role, stage_name, signer_name, signer_title, signed_at, signature_document_id
       FROM policy_signature
      WHERE policy_version_id = ANY($1::uuid[])
      ORDER BY policy_version_id, signed_at, policy_signature_id`,
    [ids],
    { label: "signatures on a page of policy versions" },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Who is asked, and acknowledgements
 * ------------------------------------------------------------------ */

/** For each version: everyone asked now, how many acknowledged it and how many are past their due date. */
async function counts(db, ids, today) {
  if (!ids.length) return new Map();
  // pagination:complete one row per version on a page, at most 25
  const { rows } = await completeQuery(
    db,
    `SELECT v.policy_version_id, COUNT(e.employee_id)::int AS asked,
            COUNT(a.acknowledged_at)::int AS acknowledged,
            COUNT(*) FILTER (WHERE e.employee_id IS NOT NULL AND a.acknowledged_at IS NULL
                               AND v.needs_acknowledgement AND ${DUE_ON("v", "e")} < $2::date)::int AS overdue
       FROM policy_version v
       LEFT JOIN employee e ON v.status = 'published' AND ${ASKED("v", "e", "$2::date")}
       LEFT JOIN policy_acknowledgement a ON a.policy_version_id = v.policy_version_id AND a.employee_id = e.employee_id
      WHERE v.policy_version_id = ANY($1::uuid[])
      GROUP BY v.policy_version_id
      ORDER BY v.policy_version_id`,
    [ids, today],
    { label: "acknowledgement counts for a page of policy versions" },
  );
  return new Map(rows.map((r) => [r.policy_version_id, r]));
}

/** The sorts PolicyVersionListQuery has none of: newest first, always. */
function listVersions(db, policyId, query, { today, inForceId }) {
  const params = [policyId, query.state || null, today, inForceId];
  return pageQuery(
    db,
    `SELECT ${VERSION}, ${TOTAL_COL}
       FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id
      WHERE v.policy_id = $1 AND v.version IS NOT NULL
        AND ($2::text IS NULL
             OR ($2 = 'withdrawn' AND v.status = 'withdrawn')
             OR ($2 = 'waiting' AND v.status = 'published' AND v.effective_from > $3::date)
             OR ($2 = 'in_force' AND v.policy_version_id = $4::uuid)
             OR ($2 = 'past' AND v.status = 'published' AND v.effective_from <= $3::date
                 AND v.policy_version_id IS DISTINCT FROM $4::uuid))
      ORDER BY v.version DESC`,
    params,
    query,
  );
}

/** The sorts PolicyAckListQuery allow-lists. The first is the default order. */
const ACK_SORTS = { display_name: "e.first_name, e.last_name", acknowledged_at: "a.acknowledged_at" };

/** A page of everyone asked about a version, within the reader's scope, with where each stands. */
function listAcknowledgements(db, id, query, scope, today) {
  const params = [id, today, query.status || null, query.q || null];
  const s = scopeClause(scope, { column: "e.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${PERSON()} AS employee, a.acknowledged_at, a.reminded_at, ${DUE_ON("v", "e")} AS due_on,
            CASE WHEN a.acknowledged_at IS NOT NULL THEN 'acknowledged'
                 WHEN ${DUE_ON("v", "e")} < $2::date THEN 'overdue' ELSE 'pending' END AS status,
            ${TOTAL_COL}
       FROM policy_version v
       JOIN employee e ON ${ASKED("v", "e", "$2::date")}
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN policy_acknowledgement a ON a.policy_version_id = v.policy_version_id AND a.employee_id = e.employee_id
      WHERE v.policy_version_id = $1 AND v.status IN ('published', 'withdrawn')
        AND ($3::text IS NULL
             OR ($3 = 'acknowledged' AND a.acknowledged_at IS NOT NULL)
             OR ($3 = 'pending' AND a.acknowledged_at IS NULL AND ${DUE_ON("v", "e")} >= $2::date)
             OR ($3 = 'overdue' AND a.acknowledged_at IS NULL AND ${DUE_ON("v", "e")} < $2::date))
        AND ($4::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, ACK_SORTS, "e.employee_id")}`,
    params,
    query,
  );
}

/** Whether a version applies to a person on a day: they are among those asked. */
async function isAsked(db, id, employeeId, today) {
  return Boolean(
    await one(
      db,
      `SELECT 1 FROM policy_version v JOIN employee e ON e.employee_id = $2
        WHERE v.policy_version_id = $1 AND ${ASKED("v", "e", "$3::date")}`,
      [id, employeeId, today],
    ),
  );
}

/**
 * The reader's policies (ESS · Policy Updates): the newest published version of each active
 * policy that applies to them, and the submissions an approval waits on them for.
 */
async function myPolicies(db, user, query, today) {
  const roleCodes = await approvers.roleCodesOf(db, user.role_ids || []);
  const params = [user.employee_id || null, today, query.state || "all"];
  const waiting = approvers.waitingOnClause("wi", user, roleCodes, params);
  return pageQuery(
    db,
    `WITH mine AS (
       SELECT v.policy_version_id, v.policy_id, p.number, p.kind, v.title, v.version, v.effective_from,
              v.needs_acknowledgement, ${DUE_ON("v", "e")} AS due_on, a.acknowledged_at, false AS waiting_on_me,
              (v.needs_acknowledgement AND a.acknowledged_at IS NULL) AS to_acknowledge,
              (v.needs_acknowledgement AND a.acknowledged_at IS NULL AND ${DUE_ON("v", "e")} < $2::date) AS overdue,
              CASE WHEN v.effective_from > $2::date THEN 'waiting' ELSE 'in_force' END AS state
         FROM policy_version v
         JOIN policy p ON p.policy_id = v.policy_id AND p.status = 'active'
         JOIN employee e ON e.employee_id = $1::uuid AND ${ASKED("v", "e", "$2::date")}
         LEFT JOIN policy_acknowledgement a ON a.policy_version_id = v.policy_version_id AND a.employee_id = e.employee_id
        WHERE v.status = 'published' AND ${NEWEST("v")}
       UNION ALL
       SELECT v.policy_version_id, v.policy_id, p.number, p.kind, v.title, NULL, v.effective_from,
              v.needs_acknowledgement, NULL, NULL, true, false, false, 'awaiting_approval'
         FROM policy_version v
         JOIN policy p ON p.policy_id = v.policy_id
         JOIN workflow_instance wi ON wi.workflow_instance_id = v.workflow_instance_id AND wi.state = 'pending'
        WHERE v.status = 'submitted' AND ${waiting}
     )
     SELECT mine.*, ${TOTAL_COL}
       FROM mine
      WHERE ($3 = 'all'
             OR ($3 = 'to_acknowledge' AND mine.to_acknowledge)
             OR ($3 = 'waiting_on_me' AND mine.waiting_on_me))
      ORDER BY mine.waiting_on_me DESC, mine.overdue DESC, mine.to_acknowledge DESC, mine.due_on NULLS LAST,
               mine.title, mine.policy_version_id`,
    params,
    query,
  );
}

/** Whether a submission's approval waits on this user now. */
async function waitsOn(db, id, user) {
  const roleCodes = await approvers.roleCodesOf(db, user.role_ids || []);
  const params = [id];
  const waiting = approvers.waitingOnClause("wi", user, roleCodes, params);
  return Boolean(
    await one(
      db,
      `SELECT 1 FROM policy_version v
         JOIN workflow_instance wi ON wi.workflow_instance_id = v.workflow_instance_id AND wi.state = 'pending'
        WHERE v.policy_version_id = $1 AND v.status = 'submitted' AND ${waiting}`,
      params,
    ),
  );
}

/** The versions a person still owes an acknowledgement for, the oldest due first. */
async function owed(db, employeeId, today) {
  // pagination:complete the versions one person owes now: one per policy that applies to them, a handful
  const { rows } = await completeQuery(
    db,
    `SELECT v.policy_version_id, v.policy_id, v.title, v.version, ${DUE_ON("v", "e")} AS due_on, a.deferred_on
       FROM policy_version v
       JOIN policy p ON p.policy_id = v.policy_id AND p.status = 'active'
       JOIN employee e ON e.employee_id = $1 AND ${ASKED("v", "e", "$2::date")}
       LEFT JOIN policy_acknowledgement a ON a.policy_version_id = v.policy_version_id AND a.employee_id = e.employee_id
      WHERE v.status = 'published' AND v.needs_acknowledgement AND ${NEWEST("v")}
        AND (a.acknowledged_at IS NULL)
      ORDER BY due_on, v.title, v.policy_version_id`,
    [employeeId, today],
    { label: "the policy versions one person owes an acknowledgement for" },
  );
  return rows;
}

function acknowledgementOf(db, id, employeeId) {
  return one(
    db,
    `SELECT acknowledged_at, reminded_at, deferred_on FROM policy_acknowledgement
      WHERE policy_version_id = $1 AND employee_id = $2`,
    [id, employeeId],
  );
}

/** Acknowledged now, once: null when it already was. */
function acknowledge(client, id, employeeId, { contentHash, knownDeviceId }) {
  return one(
    client,
    `INSERT INTO policy_acknowledgement (policy_version_id, employee_id, acknowledged_at, content_hash, known_device_id)
     VALUES ($1, $2, now(), $3, $4)
     ON CONFLICT (policy_version_id, employee_id) DO UPDATE
        SET acknowledged_at = now(), content_hash = EXCLUDED.content_hash, known_device_id = EXCLUDED.known_device_id
      WHERE policy_acknowledgement.acknowledged_at IS NULL
     RETURNING acknowledged_at`,
    [id, employeeId, contentHash, knownDeviceId || null],
  );
}

/** Put off until tomorrow. */
function defer(client, id, employeeId, today) {
  return client.query(
    `INSERT INTO policy_acknowledgement (policy_version_id, employee_id, deferred_on) VALUES ($1, $2, $3::date)
     ON CONFLICT (policy_version_id, employee_id) DO UPDATE SET deferred_on = EXCLUDED.deferred_on
      WHERE policy_acknowledgement.acknowledged_at IS NULL`,
    [id, employeeId, today],
  );
}

/* ------------------------------------------------------------------ *
 * Reminders and notices
 * ------------------------------------------------------------------ */

/** Newest published versions that need acknowledging, published at or before `before`. */
async function versionsToRemind(db, before) {
  // pagination:complete one row per policy at most: the reminder engine looks at every policy
  const { rows } = await completeQuery(
    db,
    `SELECT v.policy_version_id, v.version, v.title, v.published_at
       FROM policy_version v JOIN policy p ON p.policy_id = v.policy_id AND p.status = 'active'
      WHERE v.status = 'published' AND v.needs_acknowledgement AND v.published_at <= $1 AND ${NEWEST("v")}
      ORDER BY v.published_at, v.policy_version_id`,
    [before],
    { label: "policy versions to remind people about" },
  );
  return rows;
}

/** Everyone asked who has neither acknowledged a version nor been reminded of it. */
async function dueForReminder(db, id, today) {
  // pagination:complete the engine reminds everyone due, not a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT e.employee_id
       FROM policy_version v
       JOIN employee e ON ${ASKED("v", "e", "$2::date")}
      WHERE v.policy_version_id = $1
        AND NOT EXISTS (SELECT 1 FROM policy_acknowledgement a
                         WHERE a.policy_version_id = v.policy_version_id AND a.employee_id = e.employee_id
                           AND (a.acknowledged_at IS NOT NULL OR a.reminded_at IS NOT NULL))
      ORDER BY e.employee_id`,
    [id, today],
    { label: "people due a policy reminder" },
  );
  return rows;
}

/** A reminder recorded, once: null when the person was already reminded or has acknowledged. */
function recordReminder(client, id, employeeId) {
  return one(
    client,
    `INSERT INTO policy_acknowledgement (policy_version_id, employee_id, reminded_at) VALUES ($1, $2, now())
     ON CONFLICT (policy_version_id, employee_id) DO UPDATE SET reminded_at = now()
       WHERE policy_acknowledgement.reminded_at IS NULL AND policy_acknowledgement.acknowledged_at IS NULL
     RETURNING policy_acknowledgement_id`,
    [id, employeeId],
  );
}

/** The user ids of everyone asked about a version: who its notices go to. */
async function askedUsers(db, id, today) {
  // pagination:complete a notice goes to everyone asked, not a page of them
  const { rows } = await completeQuery(
    db,
    `SELECT u.user_id
       FROM policy_version v
       JOIN employee e ON ${ASKED("v", "e", "$2::date")}
       JOIN app_user u ON u.employee_id = e.employee_id AND u.status = 'active'
      WHERE v.policy_version_id = $1
      ORDER BY u.user_id`,
    [id, today],
    { label: "everyone asked about a policy version" },
  );
  return rows.map((r) => r.user_id);
}

/** The departments a picker may name, for Applies To in words. */
async function departmentNames(db, ids) {
  if (!ids.length) return new Map();
  // pagination:complete the departments one version names
  const { rows } = await completeQuery(
    db,
    "SELECT department_id, name FROM department WHERE department_id = ANY($1::uuid[]) ORDER BY name, department_id",
    [ids],
    { label: "department names for Applies To" },
  );
  return new Map(rows.map((r) => [r.department_id, r.name]));
}

module.exports = {
  lock,
  getPolicy,
  insertPolicy,
  renamePolicy,
  archivePolicy,
  listPolicies,
  getVersion,
  workingVersion,
  versionInForce,
  rulesInForce,
  rulesOfVersion,
  newestPublished,
  previousPublished,
  lastWaitingStart,
  nextVersion,
  insertDraft,
  updateDraft,
  deleteDraft,
  replaceAudience,
  copyAudience,
  audienceOf,
  namedPeople,
  submit,
  setWorkflowInstance,
  backToDraft,
  publish,
  withdraw,
  insertSignature,
  signaturesOf,
  counts,
  listVersions,
  listAcknowledgements,
  isAsked,
  myPolicies,
  waitsOn,
  owed,
  acknowledgementOf,
  acknowledge,
  defer,
  versionsToRemind,
  dueForReminder,
  recordReminder,
  askedUsers,
  departmentNames,
};
