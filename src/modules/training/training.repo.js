"use strict";
/**
 * Training's SQL (docs/guides/knowledge.md §4). Reads and writes training_course, training_item,
 * training_assignment, training_assignment_audience, training_enrolment and
 * training_item_progress; nothing else writes them.
 *
 * Who an assignment reaches is worked out in SQL (§6.7): everyone at work (active, started, not
 * left) with an active login, who is everyone, or in one of its departments, or holds one of its
 * roles, or is named. Where a person stands on a course is worked out against a day in Lagos:
 * completed, overdue (a due date before that day), in progress (started) or not started.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;
const PERSON = (alias = "e", dept = "d") => personJson(alias, dept);

/** At work on a day, with a login. */
const AT_WORK = (e, day) => `${e}.status = 'active'
   AND (${e}.start_date IS NULL OR ${e}.start_date <= ${day})
   AND (${e}.left_on IS NULL OR ${e}.left_on > ${day})
   AND EXISTS (SELECT 1 FROM app_user au WHERE au.employee_id = ${e}.employee_id AND au.status = 'active')`;

/**
 * Whom an assignment reaches. `named` false leaves the named people out: a joiner is enrolled only
 * by everyone, a department or a role (Keep Assigning New Joiners is ignored for named people).
 */
const REACHES = (a, e, { named = true } = {}) => `(${a}.everyone OR EXISTS (
     SELECT 1 FROM training_assignment_audience x
      WHERE x.training_assignment_id = ${a}.training_assignment_id
        AND (x.department_id = ${e}.department_id
             OR x.role_id IN (SELECT ur.role_id FROM user_role ur
                                JOIN app_user ru ON ru.user_id = ur.user_id AND ru.status = 'active'
                               WHERE ru.employee_id = ${e}.employee_id
                                 AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE))
             ${named ? `OR x.employee_id = ${e}.employee_id` : ""})))`;

/** Where a person stands on a course on a day. */
const STATUS = (te, day) => `CASE WHEN ${te}.completed_at IS NOT NULL THEN 'completed'
     WHEN ${te}.due_on IS NOT NULL AND ${te}.due_on < ${day} THEN 'overdue'
     WHEN ${te}.started_at IS NOT NULL THEN 'in_progress'
     ELSE 'not_started' END`;

/** Who a user column names. */
const NAME_OF = (userCol) => `(SELECT btrim(ne.first_name || ' ' || ne.last_name) FROM app_user nu
   JOIN employee ne ON ne.employee_id = nu.employee_id WHERE nu.user_id = ${userCol})`;

/** The certificate's PDF is made (rendered and stored): Download Certificate offers it. */
const READY = (te) => `EXISTS (SELECT 1 FROM document cd WHERE cd.document_id = ${te}.certificate_document_id AND cd.render_status = 'done')`;

/** A course's items, counted, and their minutes summed (null when none is set). */
const ITEM_COUNT = (c) => `(SELECT count(*)::int FROM training_item ti WHERE ti.training_course_id = ${c}.training_course_id)`;
const MINUTES = (c) => `(SELECT sum(ti.minutes)::int FROM training_item ti WHERE ti.training_course_id = ${c}.training_course_id)`;
/** The items of a course a person has done. */
const DONE_COUNT = (te) => `(SELECT count(*)::int FROM training_item_progress tp
   JOIN training_item ti ON ti.training_item_id = tp.training_item_id
  WHERE tp.training_enrolment_id = ${te}.training_enrolment_id)`;

/* ------------------------------------------------------------------ *
 * Courses
 * ------------------------------------------------------------------ */

/** One change to a course at a time: its items, settings, publication, assignments, archive. */
function lockCourse(client, id) {
  return client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`training_course:${id}`]);
}

const COURSE = `c.training_course_id, c.number, c.title, c.summary, c.status, c.library, c.proof_required,
       c.proof_prompt, c.issue_certificate, c.published_at, c.published_by, c.signer_name, c.signer_title,
       c.signature_document_id, c.archived_at, c.archive_reason, c.created_at, c.updated_at,
       ${NAME_OF("c.published_by")} AS published_by_name, ${MINUTES("c")} AS minutes`;

async function insertCourse(client, r) {
  const { rows } = await client.query(
    `INSERT INTO training_course (number, title, summary, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING training_course_id`,
    [r.number, r.title, r.summary, r.created_by],
  );
  return rows[0].training_course_id;
}

const getCourse = (db, id) => one(db, `SELECT ${COURSE} FROM training_course c WHERE c.training_course_id = $1`, [id]);

/** The settings a course may change; only the keys given. */
const COURSE_FIELDS = ["title", "summary", "library", "proof_required", "proof_prompt", "issue_certificate"];

async function updateCourse(client, id, fields, userId) {
  const keys = COURSE_FIELDS.filter((k) => k in fields);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  await client.query(
    `UPDATE training_course SET ${["updated_by = $2", ...sets].join(", ")} WHERE training_course_id = $1`,
    [id, userId, ...keys.map((k) => fields[k])],
  );
}

/** Touch a course when its items change, so its list's Updated moves. */
const touchCourse = (client, id, userId) =>
  client.query("UPDATE training_course SET updated_by = $2 WHERE training_course_id = $1", [id, userId]);

async function publishCourse(client, id, r) {
  await client.query(
    `UPDATE training_course
        SET status = 'published', published_at = now(), published_by = $2, signer_name = $3, signer_title = $4,
            signature_document_id = $5, updated_by = $2
      WHERE training_course_id = $1`,
    [id, r.user_id, r.signer_name, r.signer_title, r.signature_document_id],
  );
}

async function archiveCourse(client, id, { reason, userId }) {
  await client.query(
    `UPDATE training_course
        SET status = 'archived', archived_at = now(), archived_by = $2, archive_reason = $3, updated_by = $2
      WHERE training_course_id = $1`,
    [id, userId, reason],
  );
}

/** Assigned (everyone on the course), in progress, completed and overdue, on a day. */
const COUNTS = (c, day) => `(SELECT count(*)::int FROM training_enrolment te WHERE te.training_course_id = ${c}.training_course_id) AS assigned,
       (SELECT count(*)::int FROM training_enrolment te WHERE te.training_course_id = ${c}.training_course_id
           AND te.completed_at IS NULL AND te.started_at IS NOT NULL) AS in_progress,
       (SELECT count(*)::int FROM training_enrolment te WHERE te.training_course_id = ${c}.training_course_id
           AND te.completed_at IS NOT NULL) AS completed,
       (SELECT count(*)::int FROM training_enrolment te WHERE te.training_course_id = ${c}.training_course_id
           AND te.completed_at IS NULL AND te.due_on < ${day}) AS overdue`;

const counts = (db, id, today) =>
  one(db, `SELECT ${COUNTS("c", "$2::date")} FROM training_course c WHERE c.training_course_id = $1`, [id, today]);

/** The SQL for each field CourseListQuery allow-lists. The first is the default order. */
const COURSE_SORTS = { title: "c.title", number: "c.number", updated_at: "c.updated_at" };

function listCourses(db, query, today) {
  return pageQuery(
    db,
    `SELECT c.training_course_id, c.number, c.title, c.status AS state, c.library, ${ITEM_COUNT("c")} AS items,
            ${COUNTS("c", "$3::date")}, c.updated_at, ${TOTAL_COL}
       FROM training_course c
      WHERE ($1::text IS NULL OR c.status = $1)
        AND ($2::text IS NULL OR search_fold(c.title) LIKE '%' || search_fold($2) || '%'
             OR search_fold(c.number::text) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, COURSE_SORTS, "c.training_course_id")}`,
    [query.state ?? null, query.q ?? null, today],
    query,
  );
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

const ITEM = `ti.training_item_id, ti.training_course_id, ti.position, ti.kind, ti.title, ti.url, ti.document_id,
       ti.lesson_markdown, ti.minutes, d.original_name AS document_name, d.mime AS document_type`;

async function items(db, courseId) {
  // pagination:complete a course holds at most 40 items, shown together in order
  const { rows } = await completeQuery(
    db,
    `SELECT ${ITEM} FROM training_item ti LEFT JOIN document d ON d.document_id = ti.document_id
      WHERE ti.training_course_id = $1 ORDER BY ti.position, ti.training_item_id`,
    [courseId],
    { label: "a course's items", ceiling: 40 },
  );
  return rows;
}

const itemOf = (db, id) =>
  one(db, `SELECT ${ITEM} FROM training_item ti LEFT JOIN document d ON d.document_id = ti.document_id WHERE ti.training_item_id = $1`, [id]);

async function insertItem(client, courseId, r) {
  const { rows } = await client.query(
    `INSERT INTO training_item (training_course_id, position, kind, title, url, document_id, lesson_markdown, minutes)
     SELECT $1, COALESCE(max(position), 0) + 1, $2, $3, $4, $5, $6, $7 FROM training_item WHERE training_course_id = $1
     RETURNING training_item_id`,
    [courseId, r.kind, r.title, r.url, r.document_id, r.lesson_markdown, r.minutes],
  );
  return rows[0].training_item_id;
}

async function updateItem(client, id, r) {
  await client.query(
    `UPDATE training_item SET kind = $2, title = $3, url = $4, document_id = $5, lesson_markdown = $6, minutes = $7
      WHERE training_item_id = $1`,
    [id, r.kind, r.title, r.url, r.document_id, r.lesson_markdown, r.minutes],
  );
}

/** Remove an item (its progress goes with it) and close the gap in the order. */
async function deleteItem(client, id, courseId) {
  await client.query("DELETE FROM training_item WHERE training_item_id = $1", [id]);
  await client.query(
    `UPDATE training_item ti SET position = o.n
       FROM (SELECT training_item_id, row_number() OVER (ORDER BY position, training_item_id) AS n
               FROM training_item WHERE training_course_id = $1) o
      WHERE ti.training_item_id = o.training_item_id AND ti.position <> o.n`,
    [courseId],
  );
}

/** The items in the order given; positions are unique at commit, so two may swap. */
async function setOrder(client, courseId, ids) {
  await client.query(
    `UPDATE training_item ti SET position = o.n
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, n)
      WHERE ti.training_item_id = o.id AND ti.training_course_id = $1 AND ti.position <> o.n`,
    [courseId, ids],
  );
}

/* ------------------------------------------------------------------ *
 * Assignments
 * ------------------------------------------------------------------ */

async function insertAssignment(client, r) {
  const { rows } = await client.query(
    `INSERT INTO training_assignment (training_course_id, everyone, due_within_days, keep_assigning, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING training_assignment_id`,
    [r.training_course_id, r.everyone, r.due_within_days, r.keep_assigning, r.created_by],
  );
  return rows[0].training_assignment_id;
}

async function insertAudience(client, id, { department_ids: departments, role_ids: roles, employee_ids: named }) {
  await client.query(
    `INSERT INTO training_assignment_audience (training_assignment_id, department_id, role_id, employee_id)
     SELECT $1::uuid, d, NULL::uuid, NULL::uuid FROM unnest($2::uuid[]) AS d
     UNION ALL SELECT $1::uuid, NULL::uuid, r, NULL::uuid FROM unnest($3::uuid[]) AS r
     UNION ALL SELECT $1::uuid, NULL::uuid, NULL::uuid, p FROM unnest($4::uuid[]) AS p
     ON CONFLICT DO NOTHING`,
    [id, departments, roles, named],
  );
}

/** Of the ids given, those that are departments, roles and employees on the staff. */
async function knownAudience(db, { department_ids: departments, role_ids: roles, employee_ids: named }) {
  const { rows } = await db.query(
    `SELECT (SELECT coalesce(array_agg(department_id), '{}') FROM department WHERE department_id = ANY($1::uuid[])) AS departments,
            (SELECT coalesce(array_agg(role_id), '{}') FROM role WHERE role_id = ANY($2::uuid[])) AS roles,
            (SELECT coalesce(array_agg(employee_id), '{}') FROM employee
              WHERE employee_id = ANY($3::uuid[]) AND status = 'active') AS people`,
    [departments, roles, named],
  );
  return rows[0];
}

const DUE = (a, day) => `CASE WHEN ${a}.due_within_days IS NULL THEN NULL ELSE ${day} + ${a}.due_within_days END`;

/**
 * Enrol everyone an assignment reaches on `today` (§6.7), in the caller's transaction:
 *  - a Library starter not yet finished is moved onto it and gains its due date;
 *  - someone already assigned keeps their place, with the earlier due date;
 *  - anyone with no place on the course is enrolled;
 *  - someone who completed it is left as they are.
 * `employeeId` limits it to one person; `named` false leaves its named people out (a joiner).
 * @returns {Promise<{enrolled: number, moved: number}>}
 */
async function enrol(client, assignmentId, today, { employeeId = null, named = true } = {}) {
  const who = `${AT_WORK("e", "$2::date")} AND ${REACHES("a", "e", { named })} AND ($3::uuid IS NULL OR e.employee_id = $3)`;
  const moved = await client.query(
    `UPDATE training_enrolment te
        SET training_assignment_id = a.training_assignment_id, due_on = ${DUE("a", "$2::date")}
       FROM training_assignment a, employee e
      WHERE a.training_assignment_id = $1 AND te.training_course_id = a.training_course_id
        AND te.employee_id = e.employee_id AND te.training_assignment_id IS NULL AND te.completed_at IS NULL
        AND ${who}`,
    [assignmentId, today, employeeId],
  );
  await client.query(
    `UPDATE training_enrolment te
        SET due_on = LEAST(te.due_on, ${DUE("a", "$2::date")})
       FROM training_assignment a, employee e
      WHERE a.training_assignment_id = $1 AND te.training_course_id = a.training_course_id
        AND te.employee_id = e.employee_id AND te.training_assignment_id IS NOT NULL
        AND te.training_assignment_id <> a.training_assignment_id AND te.completed_at IS NULL
        AND a.due_within_days IS NOT NULL AND (te.due_on IS NULL OR te.due_on > ${DUE("a", "$2::date")})
        AND ${who}`,
    [assignmentId, today, employeeId],
  );
  const added = await client.query(
    `INSERT INTO training_enrolment (training_course_id, employee_id, training_assignment_id, due_on)
     SELECT a.training_course_id, e.employee_id, a.training_assignment_id, ${DUE("a", "$2::date")}
       FROM training_assignment a
       JOIN employee e ON ${who}
      WHERE a.training_assignment_id = $1
     ON CONFLICT (training_course_id, employee_id) DO NOTHING`,
    [assignmentId, today, employeeId],
  );
  return { enrolled: added.rowCount, moved: moved.rowCount };
}

/** The assignments still enrolling joiners, on courses that are published (archived ones withdrew theirs). */
async function openAssignments(db, { employeeId = null, today = null } = {}) {
  // pagination:complete the sweep visits every open assignment once a day; a handful at a time
  const { rows } = await completeQuery(
    db,
    `SELECT a.training_assignment_id, a.training_course_id
       FROM training_assignment a
       JOIN training_course c ON c.training_course_id = a.training_course_id AND c.status = 'published'
      WHERE a.withdrawn_at IS NULL AND a.keep_assigning
        AND ($1::uuid IS NULL OR EXISTS (
              SELECT 1 FROM employee e
               WHERE e.employee_id = $1 AND ${AT_WORK("e", "$2::date")} AND ${REACHES("a", "e", { named: false })}
                 AND NOT EXISTS (SELECT 1 FROM training_enrolment te
                                  WHERE te.training_course_id = a.training_course_id AND te.employee_id = e.employee_id
                                    AND te.training_assignment_id IS NOT NULL)))
      ORDER BY a.created_at, a.training_assignment_id`,
    [employeeId, today],
    { label: "open training assignments" },
  );
  return rows;
}

async function assignmentsOfCourse(db, courseId, { open = false } = {}) {
  // pagination:complete a course's assignments, each withdrawn with its archive
  const { rows } = await completeQuery(
    db,
    `SELECT training_assignment_id, withdrawn_at FROM training_assignment
      WHERE training_course_id = $1 AND ($2::boolean IS FALSE OR withdrawn_at IS NULL)
      ORDER BY created_at, training_assignment_id`,
    [courseId, open],
    { label: "a course's assignments", ceiling: 1000 },
  );
  return rows;
}

const ASSIGNMENT = `a.training_assignment_id, a.training_course_id, a.everyone, a.due_within_days, a.keep_assigning,
       a.withdrawn_at, a.created_at, ${NAME_OF("a.created_by")} AS created_by_name,
       (SELECT count(*)::int FROM training_enrolment te WHERE te.training_assignment_id = a.training_assignment_id) AS enrolled,
       (SELECT coalesce(json_agg(json_build_object('department_id', dd.department_id, 'name', dd.name) ORDER BY dd.name, dd.department_id), '[]')
          FROM training_assignment_audience x JOIN department dd ON dd.department_id = x.department_id
         WHERE x.training_assignment_id = a.training_assignment_id) AS departments,
       (SELECT coalesce(json_agg(json_build_object('role_id', r.role_id, 'name', r.name) ORDER BY r.name, r.role_id), '[]')
          FROM training_assignment_audience x JOIN role r ON r.role_id = x.role_id
         WHERE x.training_assignment_id = a.training_assignment_id) AS roles,
       (SELECT coalesce(json_agg(${PERSON("pe", "pd")} ORDER BY pe.first_name, pe.last_name, pe.employee_id), '[]')
          FROM training_assignment_audience x JOIN employee pe ON pe.employee_id = x.employee_id
          LEFT JOIN department pd ON pd.department_id = pe.department_id
         WHERE x.training_assignment_id = a.training_assignment_id) AS people`;

const getAssignment = (db, id) =>
  one(db, `SELECT ${ASSIGNMENT} FROM training_assignment a WHERE a.training_assignment_id = $1`, [id]);

function listAssignments(db, courseId, query) {
  return pageQuery(
    db,
    `SELECT ${ASSIGNMENT}, ${TOTAL_COL} FROM training_assignment a
      WHERE a.training_course_id = $1
      ORDER BY a.created_at DESC, a.training_assignment_id`,
    [courseId],
    query,
  );
}

async function markWithdrawn(client, id, userId) {
  await client.query(
    "UPDATE training_assignment SET withdrawn_at = now(), withdrawn_by = $2 WHERE training_assignment_id = $1 AND withdrawn_at IS NULL",
    [id, userId],
  );
}

/**
 * A withdrawn assignment's enrolments (§6.7): one not started that another open assignment of the
 * course reaches moves onto that one; the rest not started are removed (their ids answered, for
 * their tasks); started ones stay, without a due date.
 * @returns {Promise<string[]>} the removed enrolments' ids
 */
async function releaseAssignment(client, id, today) {
  await client.query(
    `WITH moves AS (
       SELECT te.training_enrolment_id,
              (SELECT a2.training_assignment_id FROM training_assignment a2
                WHERE a2.training_course_id = te.training_course_id AND a2.withdrawn_at IS NULL
                  AND a2.training_assignment_id <> $1 AND ${REACHES("a2", "e")}
                ORDER BY a2.created_at, a2.training_assignment_id LIMIT 1) AS to_id
         FROM training_enrolment te
         JOIN employee e ON e.employee_id = te.employee_id
        WHERE te.training_assignment_id = $1 AND te.started_at IS NULL AND te.completed_at IS NULL
          AND ${AT_WORK("e", "$2::date")})
     UPDATE training_enrolment t SET training_assignment_id = m.to_id
       FROM moves m
      WHERE t.training_enrolment_id = m.training_enrolment_id AND m.to_id IS NOT NULL`,
    [id, today],
  );
  const { rows } = await client.query(
    `DELETE FROM training_enrolment
      WHERE training_assignment_id = $1 AND started_at IS NULL AND completed_at IS NULL
      RETURNING training_enrolment_id`,
    [id],
  );
  await client.query(
    "UPDATE training_enrolment SET due_on = NULL WHERE training_assignment_id = $1 AND completed_at IS NULL AND due_on IS NOT NULL",
    [id],
  );
  return rows.map((r) => r.training_enrolment_id);
}

/* ------------------------------------------------------------------ *
 * Enrolments
 * ------------------------------------------------------------------ */

const ENROLMENT = `te.training_enrolment_id, te.training_course_id, te.employee_id, te.training_assignment_id,
       te.due_on::text AS due_on, te.started_at, te.completed_at, te.proof_url, te.proof_document_id,
       te.certificate_number, te.certificate_document_id, te.certificate_hash, te.certificate_holder_name,
       te.certificate_course_title, te.task_id, te.reminded_at, te.reminders_sent, te.created_at,
       ${READY("te")} AS certificate_ready`;

/** A person's place on a course, locked for the change (§6.8). */
const lockEnrolment = (client, id) =>
  one(client, `SELECT ${ENROLMENT} FROM training_enrolment te WHERE te.training_enrolment_id = $1 FOR UPDATE`, [id]);

const enrolmentOf = (db, id) => one(db, `SELECT ${ENROLMENT} FROM training_enrolment te WHERE te.training_enrolment_id = $1`, [id]);

const enrolmentFor = (db, courseId, employeeId) =>
  one(db, `SELECT ${ENROLMENT} FROM training_enrolment te WHERE te.training_course_id = $1 AND te.employee_id = $2`, [courseId, employeeId]);

/** A Library start: a place with no assignment, started now. Null when one already exists. */
async function insertLibraryEnrolment(client, courseId, employeeId) {
  const { rows } = await client.query(
    `INSERT INTO training_enrolment (training_course_id, employee_id, started_at) VALUES ($1, $2, now())
     ON CONFLICT (training_course_id, employee_id) DO NOTHING RETURNING training_enrolment_id`,
    [courseId, employeeId],
  );
  return rows[0] ? rows[0].training_enrolment_id : null;
}

const setStarted = (client, id) =>
  client.query("UPDATE training_enrolment SET started_at = now() WHERE training_enrolment_id = $1 AND started_at IS NULL", [id]);

async function markDone(client, enrolmentId, itemId) {
  const { rowCount } = await client.query(
    `INSERT INTO training_item_progress (training_enrolment_id, training_item_id) VALUES ($1, $2)
     ON CONFLICT (training_enrolment_id, training_item_id) DO NOTHING`,
    [enrolmentId, itemId],
  );
  return rowCount > 0;
}

async function markUndone(client, enrolmentId, itemId) {
  const { rowCount } = await client.query(
    "DELETE FROM training_item_progress WHERE training_enrolment_id = $1 AND training_item_id = $2",
    [enrolmentId, itemId],
  );
  return rowCount > 0;
}

/** The course's items as it stands, and how many of them the person has done. */
const progressOf = (db, enrolmentId) =>
  one(
    db,
    `SELECT ${ITEM_COUNT("te")} AS total, ${DONE_COUNT("te")} AS done
       FROM training_enrolment te WHERE te.training_enrolment_id = $1`,
    [enrolmentId],
  );

async function setProof(client, id, { url, document_id: documentId }) {
  await client.query(
    "UPDATE training_enrolment SET proof_url = $2, proof_document_id = $3 WHERE training_enrolment_id = $1",
    [id, url || null, documentId || null],
  );
}

/** Completion, with the certificate's number, hash and facts as issued (all null without one). */
async function complete(client, id, { at, number, hash, holderName, courseTitle }) {
  await client.query(
    `UPDATE training_enrolment
        SET completed_at = $2, started_at = COALESCE(started_at, $2), certificate_number = $3, certificate_hash = $4,
            certificate_holder_name = $5, certificate_course_title = $6
      WHERE training_enrolment_id = $1`,
    [id, at, number, hash, holderName, courseTitle],
  );
}

/**
 * A completed place's certificate as it was issued, with what it prints beside the facts: the
 * course's number, its items and length, and the publisher's signature (K7).
 */
const certificateOf = (db, enrolmentId) =>
  one(
    db,
    `SELECT te.training_enrolment_id, te.employee_id, te.training_course_id, te.completed_at,
            te.certificate_number::text AS certificate_number, te.certificate_hash, te.certificate_holder_name,
            te.certificate_course_title, te.certificate_document_id, c.number AS course_number, c.signer_name,
            c.signer_title, c.signature_document_id, ${ITEM_COUNT("c")} AS items, ${MINUTES("c")} AS minutes
       FROM training_enrolment te
       JOIN training_course c ON c.training_course_id = te.training_course_id
      WHERE te.training_enrolment_id = $1`,
    [enrolmentId],
  );

/** The place a certificate number names (any case: a number is typed). */
const byCertificateNumber = (db, number) =>
  one(db, "SELECT training_enrolment_id FROM training_enrolment WHERE certificate_number = $1::citext", [number]);

const setCertificateDocument = (client, id, documentId) =>
  client.query("UPDATE training_enrolment SET certificate_document_id = $2 WHERE training_enrolment_id = $1", [id, documentId]);

/** The next open places on a course after `afterId`, checked for completion a batch at a time. */
async function openPlaces(db, courseId, afterId) {
  const { rows } = await db.query(
    `SELECT training_enrolment_id FROM training_enrolment
      WHERE training_course_id = $1 AND completed_at IS NULL AND ($2::uuid IS NULL OR training_enrolment_id > $2)
      ORDER BY training_enrolment_id
      LIMIT 500 -- pagination:batch open places checked for completion`,
    [courseId, afterId],
  );
  return rows;
}

const setTask = (client, id, taskId) =>
  client.query("UPDATE training_enrolment SET task_id = $2 WHERE training_enrolment_id = $1", [id, taskId]);

/**
 * The next assigned places with no task yet, after `afterId`: the worker sets their tasks in
 * small transactions, each place once per run.
 */
async function awaitingTasks(db, courseId, afterId, size) {
  const { rows } = await db.query(
    `SELECT te.training_enrolment_id, te.employee_id, te.due_on::text AS due_on, a.created_by AS set_by_user_id
       FROM training_enrolment te
       JOIN training_assignment a ON a.training_assignment_id = te.training_assignment_id
       JOIN employee e ON e.employee_id = te.employee_id AND e.status = 'active'
      WHERE ($1::uuid IS NULL OR te.training_course_id = $1) AND te.task_id IS NULL AND te.completed_at IS NULL
        AND ($2::uuid IS NULL OR te.training_enrolment_id > $2)
      ORDER BY te.training_enrolment_id
      LIMIT $3 -- pagination:batch places whose tasks one transaction sets`,
    [courseId, afterId, size],
  );
  return rows;
}

/** The facts the certificate states (§6.9), read at completion. */
const certificateFacts = (db, enrolmentId) =>
  one(
    db,
    `SELECT btrim(e.first_name || ' ' || e.last_name) AS holder_name, c.number AS course_number, c.title AS course_title,
            c.signer_name AS publisher_name, c.signer_title AS publisher_title
       FROM training_enrolment te
       JOIN employee e ON e.employee_id = te.employee_id
       JOIN training_course c ON c.training_course_id = te.training_course_id
      WHERE te.training_enrolment_id = $1`,
    [enrolmentId],
  );

/** The SQL for each field EnrolmentListQuery allow-lists. The first is the default order. */
const PEOPLE_SORTS = { due_on: "te.due_on", started_at: "te.started_at", completed_at: "te.completed_at" };

/** Training · People: everyone on a course, with where they stand. */
function people(db, courseId, query, today) {
  return pageQuery(
    db,
    `SELECT te.training_enrolment_id, ${PERSON("e", "d")} AS person, ${STATUS("te", "$4::date")} AS status,
            (te.training_assignment_id IS NOT NULL) AS assigned, te.due_on::text AS due_on, te.started_at,
            te.completed_at, ${DONE_COUNT("te")} AS items_done, ${ITEM_COUNT("te")} AS items_total, te.proof_url,
            te.proof_document_id, te.certificate_number::text AS certificate_number,
            ${READY("te")} AS certificate_ready, ${TOTAL_COL}
       FROM training_enrolment te
       JOIN employee e ON e.employee_id = te.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE te.training_course_id = $1
        AND ($2::text IS NULL OR ${STATUS("te", "$4::date")} = $2)
        AND ($3::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($3) || '%')
      ORDER BY ${orderBy(query, PEOPLE_SORTS, "te.training_enrolment_id")}`,
    [courseId, query.status ?? null, query.q ?? null, today],
    query,
  );
}

/** Everyone overdue on a course now, at work, and not reminded today (Remind Overdue, §6.11). */
async function overdueToRemind(db, courseId, today) {
  // pagination:complete Remind Overdue reminds everyone overdue on the course at once
  const { rows } = await completeQuery(
    db,
    `SELECT te.training_enrolment_id, te.employee_id, te.due_on::text AS due_on
       FROM training_enrolment te
       JOIN employee e ON e.employee_id = te.employee_id
      WHERE te.training_course_id = $1 AND te.completed_at IS NULL AND te.due_on < $2::date
        AND ${AT_WORK("e", "$2::date")}
        AND (te.reminded_at IS NULL OR (te.reminded_at AT TIME ZONE 'Africa/Lagos')::date < $2::date)
      ORDER BY te.training_enrolment_id`,
    [courseId, today],
    { label: "a course's overdue people" },
  );
  return rows;
}

async function recordReminder(client, id) {
  await client.query(
    "UPDATE training_enrolment SET reminded_at = now(), reminders_sent = reminders_sent + 1 WHERE training_enrolment_id = $1",
    [id],
  );
}

/**
 * The reminder engine's occurrences that have come due by `now` (§6.11): 3 days before the due
 * date, on it, then 7, 14 and 21 days after, each at 08:00 Lagos, for open places with a due date.
 * Only steps of the last week, and none from before the place existed, so a late assignment is
 * not reminded of a step it never had.
 */
async function remindersDue(db, now) {
  // pagination:complete the engine adds each due step once; at most a week's steps are found
  const { rows } = await completeQuery(
    db,
    `SELECT te.training_enrolment_id, te.due_on::text AS due_on, s.step,
            ((te.due_on + s.step)::timestamp + time '08:00') AT TIME ZONE 'Africa/Lagos' AS due_at
       FROM training_enrolment te
       CROSS JOIN (VALUES (-3), (0), (7), (14), (21)) AS s(step)
      WHERE te.completed_at IS NULL AND te.due_on IS NOT NULL
        AND te.due_on BETWEEN ($1::timestamptz AT TIME ZONE 'Africa/Lagos')::date - 22
                          AND ($1::timestamptz AT TIME ZONE 'Africa/Lagos')::date + 3
        AND ((te.due_on + s.step)::timestamp + time '08:00') AT TIME ZONE 'Africa/Lagos' <= $1::timestamptz
        AND ((te.due_on + s.step)::timestamp + time '08:00') AT TIME ZONE 'Africa/Lagos' > $1::timestamptz - interval '7 days'
        AND ((te.due_on + s.step)::timestamp + time '08:00') AT TIME ZONE 'Africa/Lagos' >= date_trunc('day', te.created_at) - interval '1 day'
      ORDER BY te.training_enrolment_id, s.step`,
    [now],
    { label: "training reminders due" },
  );
  return rows;
}

/** Whether a person is at work today. */
async function atWork(db, employeeId, today) {
  const r = await one(db, `SELECT 1 AS ok FROM employee e WHERE e.employee_id = $1 AND ${AT_WORK("e", "$2::date")}`, [employeeId, today]);
  return Boolean(r);
}

/** A person's open places (a leaver's, closed with them). */
async function openEnrolmentsOf(db, employeeId) {
  // pagination:complete a leaver's open courses, each closed with them
  const { rows } = await completeQuery(
    db,
    `SELECT training_enrolment_id, training_course_id FROM training_enrolment
      WHERE employee_id = $1 AND completed_at IS NULL ORDER BY training_enrolment_id`,
    [employeeId],
    { label: "a person's open courses", ceiling: 1000 },
  );
  return rows;
}

const deleteEnrolment = (client, id) => client.query("DELETE FROM training_enrolment WHERE training_enrolment_id = $1", [id]);

/* ------------------------------------------------------------------ *
 * ESS · My Training
 * ------------------------------------------------------------------ */

const MY_COURSE = (day) => `c.training_course_id, c.number, c.title, c.summary, ${MINUTES("c")} AS minutes,
       ${ITEM_COUNT("c")} AS items_total, CASE WHEN te.training_enrolment_id IS NULL THEN 0 ELSE ${DONE_COUNT("te")} END AS items_done,
       CASE WHEN te.training_enrolment_id IS NULL THEN NULL ELSE ${STATUS("te", day)} END AS status,
       te.due_on::text AS due_on, te.completed_at, te.certificate_number::text AS certificate_number,
       ${READY("te")} AS certificate_ready`;

/** Each list's own order (they take no sort). */
const MY_ORDER = {
  to_do: "te.due_on ASC NULLS LAST, c.title, c.training_course_id",
  in_progress: "te.due_on ASC NULLS LAST, te.started_at, c.training_course_id",
  completed: "te.completed_at DESC, c.training_course_id",
  library: "c.title, c.training_course_id",
};

/** One of My Training's lists for a person (§2): To Do, In Progress, Completed or Library. */
function mine(db, employeeId, query, today) {
  const list = query.list || "to_do";
  const where = {
    to_do: "te.training_enrolment_id IS NOT NULL AND te.completed_at IS NULL AND te.started_at IS NULL",
    in_progress: "te.training_enrolment_id IS NOT NULL AND te.completed_at IS NULL AND te.started_at IS NOT NULL",
    completed: "te.completed_at IS NOT NULL",
    library: "te.training_enrolment_id IS NULL AND c.status = 'published' AND c.library",
  }[list];
  return pageQuery(
    db,
    `SELECT ${MY_COURSE("$3::date")}, ${TOTAL_COL}
       FROM training_course c
       LEFT JOIN training_enrolment te ON te.training_course_id = c.training_course_id AND te.employee_id = $1
      WHERE ${where} AND c.status <> 'draft'
        AND ($2::text IS NULL OR search_fold(c.title) LIKE '%' || search_fold($2) || '%'
             OR search_fold(c.number::text) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${MY_ORDER[list]}`,
    [employeeId, query.q ?? null, today],
    query,
  );
}

/** A person's progress on a course's items: item id → when done. */
async function doneAt(db, enrolmentId) {
  // pagination:complete one person's progress on one course, at most 40 items
  const { rows } = await completeQuery(
    db,
    "SELECT training_item_id, done_at FROM training_item_progress WHERE training_enrolment_id = $1 ORDER BY training_item_id",
    [enrolmentId],
    { label: "a person's progress on a course", ceiling: 40 },
  );
  return new Map(rows.map((r) => [r.training_item_id, r.done_at]));
}

/** A person's own enrolment, by its id: the course it is on. */
const courseOfOwnEnrolment = (db, enrolmentId, employeeId) =>
  one(db, "SELECT training_course_id FROM training_enrolment WHERE training_enrolment_id = $1 AND employee_id = $2", [enrolmentId, employeeId]);

/* ------------------------------------------------------------------ *
 * Praxis AI: people overdue on any course (`training.manage`)
 * ------------------------------------------------------------------ */

function overdueAcross(db, query, today) {
  return pageQuery(
    db,
    `SELECT te.training_enrolment_id, ${PERSON("e", "d")} AS person, c.training_course_id, c.number, c.title,
            te.due_on::text AS due_on, ${DONE_COUNT("te")} AS items_done, ${ITEM_COUNT("te")} AS items_total, ${TOTAL_COL}
       FROM training_enrolment te
       JOIN training_course c ON c.training_course_id = te.training_course_id
       JOIN employee e ON e.employee_id = te.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE te.completed_at IS NULL AND te.due_on < $1::date AND e.status = 'active'
        AND ($2::text IS NULL OR search_fold(c.title) LIKE '%' || search_fold($2) || '%'
             OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($2) || '%')
      ORDER BY te.due_on, te.training_enrolment_id`,
    [today, query.q ?? null],
    query,
  );
}

/** The employee and job title a user signs as. */
const signerOf = (db, userId) =>
  one(
    db,
    `SELECT btrim(e.first_name || ' ' || e.last_name) AS name, e.job_title
       FROM app_user u JOIN employee e ON e.employee_id = u.employee_id WHERE u.user_id = $1`,
    [userId],
  );

/** A login's employee and their own login, for the worker's actors. */
const userOf = (db, userId) =>
  one(db, "SELECT user_id, employee_id, status FROM app_user WHERE user_id = $1", [userId]);

/** A person's note on a course (§6.13), or null before their first save. */
const noteOf = (db, courseId, employeeId) =>
  one(db, "SELECT body, updated_at FROM training_note WHERE training_course_id = $1 AND employee_id = $2", [courseId, employeeId]);

/** Writes the person's note on a course, the first save creating it; answers the row as saved. */
const saveNote = (client, courseId, employeeId, body) =>
  one(
    client,
    `INSERT INTO training_note (training_course_id, employee_id, body) VALUES ($1, $2, $3)
     ON CONFLICT (employee_id, training_course_id) DO UPDATE SET body = EXCLUDED.body
     RETURNING body, updated_at, (xmax = 0) AS created`,
    [courseId, employeeId, body],
  );

/* ------------------------------------------------------------------ *
 * Praxis AI: the places on courses in figures
 * ------------------------------------------------------------------ */

/** The assistant summary's grouping: the column and name each `by` maps to (never the caller's words). */
const AI_BY = Object.freeze({
  course: { key: "x.training_course_id::text", label: "x.number || ' ' || x.title" },
  department: { key: "COALESCE(x.department_id::text, 'none')", label: "COALESCE(x.department, 'No department')" },
});

/**
 * The places on courses, in figures for the assistant (docs/guides/praxis-ai.md §6.13, Workspace,
 * Knowledge Hub, Community, Home and Settings), in one statement: every place as Training counts them
 * (COUNTS), or with `employeeId` one person's as My Training shows them (no draft course); where each
 * stands on `today` (STATUS), the certificates issued, the Library's published courses; by course or
 * department with each one's statuses for a stacked bar, completions by Lagos month. A period (the Lagos
 * day enrolled) narrows it only when given. Figures, never a row: never a person's proof or notes.
 * @param {{state?, department_id?, from?, to?, by: string}} q
 * @param {{employeeId?: string|null, today: string}} on
 */
async function aiSummary(db, q, { employeeId = null, today }) {
  const dim = AI_BY[q.by] || AI_BY.course;
  const { rows } = await db.query(
    `WITH x AS (
       SELECT te.employee_id, c.training_course_id, c.number::text AS number, c.title, e.department_id, d.name AS department,
              ${STATUS("te", "$6::date")} AS status, te.completed_at, te.certificate_number
         FROM training_enrolment te
         JOIN training_course c ON c.training_course_id = te.training_course_id
         JOIN employee e ON e.employee_id = te.employee_id
         LEFT JOIN department d ON d.department_id = e.department_id
        WHERE ($1::text IS NULL OR c.status = $1)
          AND ($2::uuid IS NULL OR e.department_id = $2)
          AND ($3::date IS NULL OR (te.created_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $3::date AND $4::date)
          AND ($5::uuid IS NULL OR (te.employee_id = $5 AND c.status <> 'draft'))
     ), figures AS (
       SELECT count(DISTINCT training_course_id)::int AS courses, count(DISTINCT employee_id)::int AS people,
              count(*)::int AS places,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
              count(*) FILTER (WHERE status = 'overdue')::int AS overdue,
              count(*) FILTER (WHERE status = 'not_started')::int AS not_started,
              count(certificate_number)::int AS certificates,
              (SELECT count(*)::int FROM training_course lc
                WHERE lc.status = 'published' AND lc.library AND ($1::text IS NULL OR lc.status = $1)) AS library
         FROM x
     ), by_dim AS (
       SELECT ${dim.key} AS key, min(${dim.label}) AS label,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
              count(*) FILTER (WHERE status = 'overdue')::int AS overdue,
              count(*) FILTER (WHERE status = 'not_started')::int AS not_started,
              row_number() OVER (ORDER BY count(*) DESC, min(${dim.label}), ${dim.key}) AS rank
         FROM x GROUP BY ${dim.key}
     )
     SELECT (SELECT row_to_json(f) FROM figures f) AS figures,
            (SELECT json_agg(json_build_object('key', status, 'value', n)) FROM (SELECT status, count(*)::int AS n FROM x GROUP BY status) s) AS by_status,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'completed', completed, 'in_progress', in_progress,
                                               'overdue', overdue, 'not_started', not_started) ORDER BY rank)
               FROM by_dim WHERE rank <= 20) AS by_dim,
            (SELECT json_agg(json_build_object('at', at, 'value', n) ORDER BY at)
               FROM (SELECT to_char(completed_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS at, count(*)::int AS n
                       FROM x WHERE completed_at IS NOT NULL GROUP BY 1) m) AS by_month`,
    [q.state || null, q.department_id || null, q.from || null, q.to || null, employeeId, today],
  );
  const r = rows[0] || {};
  return { figures: r.figures || {}, by_status: r.by_status || [], by_dim: r.by_dim || [], by_month: r.by_month || [] };
}

module.exports = {
  aiSummary,
  AT_WORK,
  REACHES,
  STATUS,
  lockCourse,
  insertCourse,
  getCourse,
  updateCourse,
  touchCourse,
  publishCourse,
  archiveCourse,
  counts,
  listCourses,
  items,
  itemOf,
  insertItem,
  updateItem,
  deleteItem,
  setOrder,
  insertAssignment,
  insertAudience,
  knownAudience,
  enrol,
  openAssignments,
  assignmentsOfCourse,
  getAssignment,
  listAssignments,
  markWithdrawn,
  releaseAssignment,
  lockEnrolment,
  enrolmentOf,
  enrolmentFor,
  insertLibraryEnrolment,
  setStarted,
  markDone,
  markUndone,
  progressOf,
  setProof,
  complete,
  certificateOf,
  byCertificateNumber,
  setCertificateDocument,
  openPlaces,
  setTask,
  awaitingTasks,
  certificateFacts,
  people,
  overdueToRemind,
  recordReminder,
  remindersDue,
  atWork,
  openEnrolmentsOf,
  deleteEnrolment,
  mine,
  doneAt,
  courseOfOwnEnrolment,
  overdueAcross,
  signerOf,
  userOf,
  noteOf,
  saveNote,
};
