"use strict";
/**
 * Training: the one write path for courses, their items, publication, assignments, enrolments,
 * progress, proof and completion, and the reads behind Knowledge Hub · Training and ESS · My
 * Training (docs/guides/knowledge.md §6.5 to §6.11).
 *
 *   create, update, addItem, editItem, removeItem, reorder   a course and its items (§6.5); a file
 *                  is an upload claimed from the upload engine into the vault
 *   publish        once, with the publisher's signature stored in the vault (§6.6, K7)
 *   archive        it leaves the Library; its open assignments are withdrawn
 *   assign         everyone, departments, roles or people: each person reached enrolled in the
 *                  press's transaction (§6.7); their tasks and notices follow in the worker
 *                  (settleEnrolments), a few at a time, so 300 people at once is one quick press
 *   withdraw       an assignment stops enrolling; places not started go with their tasks
 *   start, done, undone, proof   the person's own (§6.8); completion runs under the enrolment's
 *                  lock and allocates the certificate's number and hash in the same transaction
 *   myNote, saveNote   the person's own running note on a course they may open (§6.13)
 *   exportNote         Download Word: that note as a Word file, made in the worker (buildNoteExport)
 *   remind         Remind Overdue; remindersDue and reminderCheck are the reminder engine's (§6.11)
 *   enrolJoiner, sweep, closeLeaver   the worker's: joiners enrolled, leavers closed
 *
 * Every change to one course runs under its lock. Events carry ids, numbers, titles and dates.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const lagos = require("../../shared/time/lagos");
const vault = require("../../shared/documents/vault");
const exportFiles = require("../../shared/documents/exports");
const { buildDocx } = require("../../shared/documents/docx");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const { formatDate } = require("../../shared/time/day-first");
const { config } = require("../../config/env");
const canonical = require("../../shared/documents/canonical");
const md = require("../../shared/documents/markdown");
const grantsCache = require("../../shared/rbac/grants-cache");
const repo = require("./training.repo");
const { EVENTS, ENROLMENT_ENTITY, COURSE_ENTITY, NOTE_EXPORT } = require("./training.events");

const tasks = () => require("../tasks/tasks.service");

/** A course holds at most this many items (§6.5). */
const MAX_ITEMS = 40;
/** A drawn signature's PNG, at most (§6.6). */
const SIGNATURE_MAX_BYTES = 200 * 1024;
/** Places whose tasks one worker transaction sets. */
const TASK_BATCH = 50;
const MANAGE = "training.manage";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That course does not exist", 404);
const itemNotFound = () => new AppError("NOT_FOUND", "That item does not exist", 404);
const archived = () => new AppError("COURSE_ARCHIVED", "This course is archived", 409);
const invalid = (field, message) => new AppError("VALIDATION_FAILED", message, 422, { [field]: [message] });
const iso = (t) => (t ? new Date(t).toISOString() : null);

/* ------------------------------------------------------------------ *
 * Pure
 * ------------------------------------------------------------------ */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * A YouTube link's video id (§6.5): youtube.com/watch?v=, youtu.be/<id> or youtube.com/shorts/<id>,
 * over https. Null for any other link, which opens in a new tab.
 * @param {string|null} url
 * @returns {string|null}
 */
function youtubeIdOf(url) {
  let u;
  try {
    u = new URL(String(url || ""));
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] || null;
  else if (host === "youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (m) id = m[1];
    }
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** An item as a builder and a learner see it (TrainingItem). */
function toItem(row) {
  const lesson = row.kind === "lesson" ? row.lesson_markdown || "" : null;
  return {
    training_item_id: row.training_item_id,
    position: Number(row.position),
    kind: row.kind,
    title: row.title,
    url: row.url || null,
    youtube_id: row.kind === "video" ? youtubeIdOf(row.url) : null,
    document_id: row.document_id || null,
    document_name: row.document_id ? row.document_name || null : null,
    document_type: row.document_id ? row.document_type || null : null,
    lesson_html: lesson === null ? null : md.markdownToHtml(lesson),
    lesson: lesson === null ? null : md.markdownToBlocks(lesson),
    minutes: row.minutes === null || row.minutes === undefined ? null : Number(row.minutes),
  };
}

const minutesOf = (row) => (row.minutes === null || row.minutes === undefined ? null : Number(row.minutes) || null);

/** Who an assignment reaches, in words: "Everyone", or "Marketing, Sales Lead and 2 people". */
function audienceText(a) {
  if (a.everyone) return "Everyone";
  const parts = [...a.departments.map((d) => d.name), ...a.roles.map((r) => r.name)];
  if (a.people.length === 1) parts.push(a.people[0].display_name);
  else if (a.people.length > 1) parts.push(`${a.people.length} people`);
  if (!parts.length) return "Nobody";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function toAssignment(a) {
  return {
    training_assignment_id: a.training_assignment_id,
    training_course_id: a.training_course_id,
    everyone: a.everyone,
    departments: a.departments,
    roles: a.roles,
    people: a.people,
    audience_text: audienceText(a),
    due_within_days: a.due_within_days === null ? null : Number(a.due_within_days),
    keep_assigning: a.keep_assigning,
    enrolled: Number(a.enrolled),
    withdrawn_at: iso(a.withdrawn_at),
    created_at: iso(a.created_at),
    created_by_name: a.created_by_name || null,
  };
}

/** The decoded bytes of a drawn signature's data URL. */
const pngOf = (dataUrl) => Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ""), "base64");

/* ------------------------------------------------------------------ *
 * Who may manage
 * ------------------------------------------------------------------ */

/** Whether a user holds training.manage (the CEO holds every capability). */
async function canManage(db, user) {
  if (user && user.is_ceo === true) return true;
  return (await grantsCache.getCapabilities(db, user && user.user_id)).includes(MANAGE);
}

/* ------------------------------------------------------------------ *
 * Courses (Knowledge Hub · Training)
 * ------------------------------------------------------------------ */

async function courseOf(db, id) {
  const course = await repo.getCourse(db, id);
  if (!course) throw notFound();
  return course;
}

/** GET /training/courses/:id: the course with its items, settings and counts. */
async function get(id, db = pool) {
  const course = await courseOf(db, id);
  const [items, counts] = await Promise.all([repo.items(db, id), repo.counts(db, id, lagos.today())]);
  return {
    training_course_id: course.training_course_id,
    number: course.number,
    title: course.title,
    summary: course.summary,
    state: course.status,
    library: course.library,
    proof_required: course.proof_required,
    proof_prompt: course.proof_prompt,
    issue_certificate: course.issue_certificate,
    items: items.map(toItem),
    minutes: minutesOf(course),
    published_at: iso(course.published_at),
    published_by_name: course.published_by_name || null,
    signer_name: course.signer_name,
    signer_title: course.signer_title,
    archived_at: iso(course.archived_at),
    archive_reason: course.archive_reason,
    counts,
  };
}

/** GET /training/courses: a page of courses with their counts. */
async function list(query) {
  const page = await repo.listCourses(pool, query, lagos.today());
  return { ...page, data: page.data.map(({ in_progress: _p, ...r }) => ({ ...r, updated_at: iso(r.updated_at) })) };
}

/** POST /training/courses: New Course, numbered, a draft with no items. */
async function create(user, body) {
  const id = await tx(async (client) => {
    const { number } = await numbering.allocate(client, "training_course");
    const courseId = await repo.insertCourse(client, {
      number,
      title: body.title,
      summary: body.summary || null,
      created_by: user.user_id,
    });
    await emit(client, {
      key: EVENTS.TRAINING_COURSE_CREATED,
      entity: { type: COURSE_ENTITY, id: courseId },
      actor: user,
      after: { number, title: body.title },
      payload: { training_course_id: courseId, number, title: body.title },
    });
    return courseId;
  });
  return get(id);
}

/** A course for a change: locked, and not archived. */
async function forChange(client, id) {
  await repo.lockCourse(client, id);
  const course = await courseOf(client, id);
  if (course.status === "archived") throw archived();
  return course;
}

/** PATCH /training/courses/:id: title, summary and settings; only what is sent changes. */
async function update(user, id, body) {
  await tx(async (client) => {
    const before = await forChange(client, id);
    const fields = { ...body };
    if ("summary" in fields) fields.summary = fields.summary || null;
    if ("proof_prompt" in fields) fields.proof_prompt = fields.proof_prompt || null;
    await repo.updateCourse(client, id, fields, user.user_id);
    const pick = (row) => Object.fromEntries(Object.keys(fields).map((k) => [k, row[k] ?? null]));
    await emit(client, {
      key: EVENTS.TRAINING_COURSE_UPDATED,
      entity: { type: COURSE_ENTITY, id },
      actor: user,
      before: pick(before),
      after: pick({ ...before, ...fields }),
      payload: { training_course_id: id, number: before.number, title: fields.title || before.title },
    });
    // Proof no longer asked: anyone who has done every item completes now (§11).
    if (before.proof_required && fields.proof_required === false) await completeReady(client, id, user);
  });
  return get(id);
}

/** The longest lesson kept, in Markdown (§6.5). */
const LESSON_MAX = 20_000;

/**
 * A lesson from the editor's HTML, kept as Markdown through the one converter (as Policies keep
 * their text): 20 to 20,000 characters of it, or a 422 on the editor's field.
 */
function lessonOf(html) {
  const markdown = md.htmlToMarkdown(html || "").trim();
  const words = md.markdownToText(markdown).trim();
  if (words.length < 20) throw new AppError("VALIDATION_FAILED", "The lesson needs at least 20 characters", 422, { lesson_html: ["At least 20 characters"] });
  if (markdown.length > LESSON_MAX) throw new AppError("VALIDATION_FAILED", "The lesson is too long", 422, { lesson_html: ["At most 20,000 characters"] });
  return markdown;
}

/**
 * An item's content as stored, checked for its kind: a file is an upload claimed into the vault
 * for the course (A13), a link an https URL, a lesson Markdown from the editor's HTML.
 */
async function itemContent(client, user, courseId, body) {
  const base = { kind: body.kind, title: body.title.trim(), url: null, document_id: null, lesson_markdown: null, minutes: body.minutes ?? null };
  if (body.kind === "file") {
    await vault.claim(client, {
      document_id: body.document_id,
      doc_type: "training_material",
      entity: { type: COURSE_ENTITY, id: courseId },
      actor: user,
    });
    return { ...base, document_id: body.document_id };
  }
  if (body.kind === "lesson") return { ...base, lesson_markdown: lessonOf(body.lesson_html) };
  return { ...base, url: body.url };
}

async function itemChanged(client, user, course, change, itemId) {
  await repo.touchCourse(client, course.training_course_id, user.user_id);
  await emit(client, {
    key: EVENTS.TRAINING_COURSE_ITEM_CHANGED,
    entity: { type: COURSE_ENTITY, id: course.training_course_id },
    actor: user,
    payload: { training_course_id: course.training_course_id, number: course.number, change, training_item_id: itemId || null },
  });
}

/** POST /training/courses/:id/items: Add Item, at the end; at most 40. */
async function addItem(user, courseId, body) {
  await tx(async (client) => {
    const course = await forChange(client, courseId);
    if ((await repo.items(client, courseId)).length >= MAX_ITEMS)
      throw new AppError("TOO_MANY_ITEMS", `A course holds at most ${MAX_ITEMS} items`, 422);
    const itemId = await repo.insertItem(client, courseId, await itemContent(client, user, courseId, body));
    await itemChanged(client, user, course, "added", itemId);
  });
  return get(courseId);
}

async function itemFor(client, itemId) {
  const item = await repo.itemOf(client, itemId);
  if (!item) throw itemNotFound();
  return item;
}

/** PATCH /training/items/:id: the whole item again. Done marks stay with it. */
async function editItem(user, itemId, body) {
  const courseId = (await itemFor(pool, itemId)).training_course_id;
  await tx(async (client) => {
    const course = await forChange(client, courseId);
    await itemFor(client, itemId);
    await repo.updateItem(client, itemId, await itemContent(client, user, courseId, body));
    await itemChanged(client, user, course, "changed", itemId);
  });
  return get(courseId);
}

/**
 * DELETE /training/items/:id. Its progress goes with it (§6.6); anyone on a published course who
 * has now done every remaining item completes in the same transaction (§11).
 */
async function removeItem(user, itemId) {
  const courseId = (await itemFor(pool, itemId)).training_course_id;
  await tx(async (client) => {
    const course = await forChange(client, courseId);
    await itemFor(client, itemId);
    await repo.deleteItem(client, itemId, courseId);
    await itemChanged(client, user, course, "removed", itemId);
    if (course.status !== "draft") await completeReady(client, courseId, user);
  });
  return get(courseId);
}

/** PUT /training/courses/:id/order: every item of the course, once, in its new order. */
async function reorder(user, courseId, { item_ids: ids }) {
  await tx(async (client) => {
    const course = await forChange(client, courseId);
    const have = (await repo.items(client, courseId)).map((i) => i.training_item_id);
    if (ids.length !== have.length || new Set(ids).size !== ids.length || !ids.every((id) => have.includes(id)))
      throw invalid("item_ids", "Name every item once");
    await repo.setOrder(client, courseId, ids);
    await itemChanged(client, user, course, "reordered", null);
  });
  return get(courseId);
}

/**
 * POST /training/courses/:id/publish: once, with at least one item and the publisher's signature
 * (§6.6). The signature is stored in the vault for the course, and the signer's name and job
 * title are copied now: every certificate of the course prints them (K7).
 */
async function publish(user, id, body) {
  await tx(async (client) => {
    const course = await forChange(client, id);
    if (course.status !== "draft") throw new AppError("COURSE_PUBLISHED", "This course is already published", 409);
    if (!(await repo.items(client, id)).length) throw new AppError("NO_ITEMS", "Add an item first", 422);
    const buffer = pngOf(body.signature);
    if (buffer.length > SIGNATURE_MAX_BYTES) throw invalid("signature", "Signature too large");
    const signer = await repo.signerOf(client, user.user_id);
    if (!signer) throw new AppError("FORBIDDEN", "Only an employee can sign a course", 403);
    const doc = await vault.store(client, {
      file: { buffer, originalname: "signature.png" },
      purpose: "signature",
      doc_type: "training_signature",
      entity: { type: COURSE_ENTITY, id },
      sensitivity: "normal",
      actor: user,
    });
    await repo.publishCourse(client, id, {
      user_id: user.user_id,
      signer_name: signer.name,
      signer_title: signer.job_title || null,
      signature_document_id: doc.document_id,
    });
    await emit(client, {
      key: EVENTS.TRAINING_COURSE_PUBLISHED,
      entity: { type: COURSE_ENTITY, id },
      actor: user,
      before: { status: course.status },
      after: { status: "published", signer_name: signer.name, signature_document_id: doc.document_id },
      payload: { training_course_id: id, number: course.number, title: course.title },
    });
  });
  return get(id);
}

/** Withdraw one assignment inside the caller's transaction (§6.7); answers how many places went. */
async function release(client, user, assignmentId) {
  await repo.markWithdrawn(client, assignmentId, user ? user.user_id : null);
  const removed = await repo.releaseAssignment(client, assignmentId, lagos.today());
  for (const enrolmentId of removed)
    await tasks().cancelForRecord(client, user, { entity_type: ENROLMENT_ENTITY, entity_id: enrolmentId, reason: "The training was withdrawn" });
  return removed.length;
}

/**
 * POST /training/courses/:id/archive: it leaves the Library and nobody can start it; its open
 * assignments are withdrawn; places in progress stay and may still be finished (§6.6).
 */
async function archive(user, id, { reason }) {
  await tx(async (client) => {
    const course = await forChange(client, id);
    const open = await repo.assignmentsOfCourse(client, id, { open: true });
    for (const a of open) await repo.markWithdrawn(client, a.training_assignment_id, user.user_id);
    let removed = 0;
    for (const a of open) removed += await release(client, user, a.training_assignment_id);
    await repo.archiveCourse(client, id, { reason, userId: user.user_id });
    await emit(client, {
      key: EVENTS.TRAINING_COURSE_ARCHIVED,
      entity: { type: COURSE_ENTITY, id },
      actor: user,
      before: { status: course.status },
      after: { status: "archived", archive_reason: reason },
      payload: { training_course_id: id, number: course.number, title: course.title, withdrawn: open.length, removed },
    });
  });
  return get(id);
}

/* ------------------------------------------------------------------ *
 * Assignments
 * ------------------------------------------------------------------ */

/**
 * POST /training/courses/:id/assignments: Assign Training (§6.7). In one transaction the
 * assignment is stored and everyone it reaches now is enrolled with their due date; each new
 * place's task and notice follow in the worker (training.notify_assigned).
 */
async function assign(user, courseId, body) {
  const id = await tx(async (client) => {
    const course = await forChange(client, courseId);
    if (course.status !== "published") throw new AppError("COURSE_NOT_PUBLISHED", "Publish the course first", 409);
    const audience = body.everyone
      ? { department_ids: [], role_ids: [], employee_ids: [] }
      : {
          department_ids: [...new Set(body.department_ids)],
          role_ids: [...new Set(body.role_ids)],
          employee_ids: [...new Set(body.employee_ids)],
        };
    const known = await repo.knownAudience(client, audience);
    if (known.departments.length !== audience.department_ids.length) throw invalid("department_ids", "Not a department");
    if (known.roles.length !== audience.role_ids.length) throw invalid("role_ids", "Not a role");
    if (known.people.length !== audience.employee_ids.length) throw invalid("employee_ids", "Not on the staff");
    // Keeps assigning only through everyone, a department or a role: named people are named once.
    const groups = body.everyone || audience.department_ids.length + audience.role_ids.length > 0;
    const assignmentId = await repo.insertAssignment(client, {
      training_course_id: courseId,
      everyone: body.everyone,
      due_within_days: body.due_within_days ?? null,
      keep_assigning: Boolean(body.keep_assigning) && groups,
      created_by: user.user_id,
    });
    await repo.insertAudience(client, assignmentId, audience);
    const { enrolled, moved } = await repo.enrol(client, assignmentId, lagos.today());
    await emit(client, {
      key: EVENTS.TRAINING_ASSIGNED,
      entity: { type: COURSE_ENTITY, id: courseId },
      actor: user,
      after: { training_assignment_id: assignmentId, everyone: body.everyone, ...audience, due_within_days: body.due_within_days ?? null },
      payload: { training_course_id: courseId, training_assignment_id: assignmentId, number: course.number, enrolled, moved },
      metadata: { count: enrolled + moved },
    });
    return assignmentId;
  });
  return toAssignment(await repo.getAssignment(pool, id));
}

/** GET /training/courses/:id/assignments, newest first. */
async function assignments(courseId, query) {
  await courseOf(pool, courseId);
  const page = await repo.listAssignments(pool, courseId, query);
  return { ...page, data: page.data.map(toAssignment) };
}

/**
 * POST /training/assignments/:id/withdraw (§6.7): it stops enrolling joiners; places from it not
 * started are removed with their tasks (or move to another open assignment that reaches them);
 * started ones stay, without a due date.
 */
async function withdraw(user, assignmentId) {
  const found = await repo.getAssignment(pool, assignmentId);
  if (!found) throw new AppError("NOT_FOUND", "That assignment does not exist", 404);
  await tx(async (client) => {
    await repo.lockCourse(client, found.training_course_id);
    const a = await repo.getAssignment(client, assignmentId);
    if (a.withdrawn_at) throw new AppError("ASSIGNMENT_WITHDRAWN", "This assignment is already withdrawn", 409);
    const removed = await release(client, user, assignmentId);
    await emit(client, {
      key: EVENTS.TRAINING_ASSIGNMENT_WITHDRAWN,
      entity: { type: "training_assignment", id: assignmentId },
      actor: user,
      before: { withdrawn_at: null },
      after: { withdrawn: true },
      payload: { training_course_id: a.training_course_id, training_assignment_id: assignmentId, removed },
    });
  });
  return toAssignment(await repo.getAssignment(pool, assignmentId));
}

/** GET /training/courses/:id/people: everyone on the course and where they stand. */
async function people(courseId, query) {
  await courseOf(pool, courseId);
  const page = await repo.people(pool, courseId, query, lagos.today());
  return {
    ...page,
    data: page.data.map((r) => ({ ...r, started_at: iso(r.started_at), completed_at: iso(r.completed_at) })),
  };
}

/** The reminder's event for one place. */
function reminderEvent(e, course, today) {
  return {
    key: EVENTS.TRAINING_REMINDER_DUE,
    entity: { type: ENROLMENT_ENTITY, id: e.training_enrolment_id },
    payload: {
      training_enrolment_id: e.training_enrolment_id,
      training_course_id: course.training_course_id,
      title: course.title,
      due_on: e.due_on,
      overdue: e.due_on < today,
      subject_employee_id: e.employee_id,
    },
  };
}

/** POST /training/courses/:id/remind: everyone overdue on it now, skipping anyone reminded today (§6.11). */
async function remind(user, courseId) {
  return tx(async (client) => {
    const course = await courseOf(client, courseId);
    const today = lagos.today();
    const due = await repo.overdueToRemind(client, courseId, today);
    for (const e of due) {
      await repo.recordReminder(client, e.training_enrolment_id);
      await emit(client, { ...reminderEvent(e, course, today), actor: user });
    }
    return { reminded: due.length };
  });
}

/* ------------------------------------------------------------------ *
 * Completion (§6.8)
 * ------------------------------------------------------------------ */

/**
 * The canonical hash of what a certificate states (§6.9): its number, the holder, the course's
 * number and title, the completion date and the publisher. Verify a Document recomputes it with
 * this same function (training.certificate.js).
 */
function certificateHash(f) {
  return canonical.hash("TRAINING_CERTIFICATE", {
    number: f.number,
    holder_name: f.holder_name,
    course_number: f.course_number,
    course_title: f.course_title,
    completed_on: f.completed_on,
    publisher_name: f.publisher_name,
    publisher_title: f.publisher_title,
  });
}

/**
 * Complete a locked place now: completed_at, and with Issue Certificate on, the certificate's
 * number (`training_certificate`) and the canonical hash of what it states, in this transaction.
 */
async function completeNow(client, enrolment, course, actor) {
  const at = new Date();
  let issued = { number: null, hash: null, holderName: null, courseTitle: null };
  if (course.issue_certificate) {
    const { number } = await numbering.allocate(client, "training_certificate");
    const facts = await repo.certificateFacts(client, enrolment.training_enrolment_id);
    issued = {
      number,
      hash: certificateHash({ ...facts, number, completed_on: lagos.dateOf(at) }),
      holderName: facts.holder_name,
      courseTitle: facts.course_title,
    };
  }
  const { number, hash } = issued;
  await repo.complete(client, enrolment.training_enrolment_id, { at, ...issued });
  await emit(client, {
    key: EVENTS.TRAINING_COMPLETED,
    entity: { type: ENROLMENT_ENTITY, id: enrolment.training_enrolment_id },
    actor,
    after: { completed: true, certificate_number: number, certificate_hash: hash },
    payload: {
      training_enrolment_id: enrolment.training_enrolment_id,
      training_course_id: course.training_course_id,
      number: course.number,
      title: course.title,
      certificate_number: number,
      subject_employee_id: enrolment.employee_id,
    },
  });
}

/** Whether a locked place is complete as the course stands: every item done, and proof if asked. */
async function ready(client, enrolment, course) {
  const p = await repo.progressOf(client, enrolment.training_enrolment_id);
  if (!p || p.total === 0 || p.done < p.total) return false;
  return !course.proof_required || Boolean(enrolment.proof_url || enrolment.proof_document_id);
}

/** Complete a place if it is now complete (inside its lock). */
async function completeIfReady(client, enrolmentId, course, actor) {
  const e = await repo.lockEnrolment(client, enrolmentId);
  if (!e || e.completed_at) return false;
  if (!(await ready(client, e, course))) return false;
  await completeNow(client, e, course, actor);
  return true;
}

/** Everyone on a course who is now complete (an item removed, proof no longer asked). */
async function completeReady(client, courseId, actor) {
  const course = await courseOf(client, courseId);
  let after = null;
  for (;;) {
    const rows = await repo.openPlaces(client, courseId, after);
    if (!rows.length) return;
    for (const r of rows) {
      after = r.training_enrolment_id;
      await completeIfReady(client, r.training_enrolment_id, course, actor);
    }
  }
}

/* ------------------------------------------------------------------ *
 * ESS · My Training
 * ------------------------------------------------------------------ */

function employeeOf(user) {
  if (!user || !user.employee_id) throw new AppError("FORBIDDEN", "Only an employee takes training", 403);
  return user.employee_id;
}

/** GET /training/me: one of My Training's lists. */
async function mine(user, query) {
  const page = await repo.mine(pool, employeeOf(user), query, lagos.today());
  return { ...page, data: page.data.map((r) => ({ ...r, completed_at: iso(r.completed_at) })) };
}

/**
 * The course a person may open by `id`: the course's own id, or their own enrolment's (a task's
 * and a notice's link). A course they are not on and that is not open in the Library is a 404.
 */
async function openable(db, user, id) {
  const employeeId = employeeOf(user);
  let course = await repo.getCourse(db, id);
  if (!course) {
    const own = await repo.courseOfOwnEnrolment(db, id, employeeId);
    if (own) course = await repo.getCourse(db, own.training_course_id);
  }
  if (!course || course.status === "draft") throw notFound();
  const enrolment = await repo.enrolmentFor(db, course.training_course_id, employeeId);
  if (!enrolment && !(course.status === "published" && course.library)) throw notFound();
  return { course, enrolment, employeeId };
}

/** GET /training/me/courses/:id: the course as the person takes it. */
async function myCourse(user, id, db = pool) {
  const { course, enrolment } = await openable(db, user, id);
  const [items, doneOn] = await Promise.all([
    repo.items(db, course.training_course_id),
    enrolment ? repo.doneAt(db, enrolment.training_enrolment_id) : new Map(),
  ]);
  const today = lagos.today();
  let status = null;
  if (enrolment) {
    if (enrolment.completed_at) status = "completed";
    else if (enrolment.due_on && enrolment.due_on < today) status = "overdue";
    else status = enrolment.started_at ? "in_progress" : "not_started";
  }
  let proofName = null;
  if (enrolment && enrolment.proof_document_id) {
    const doc = await vault.get(db, enrolment.proof_document_id);
    proofName = doc ? doc.original_name || doc.title || null : null;
  }
  return {
    training_course_id: course.training_course_id,
    number: course.number,
    title: course.title,
    summary: course.summary,
    minutes: minutesOf(course),
    items: items.map((i) => ({ ...toItem(i), done_at: iso(doneOn.get(i.training_item_id)) })),
    proof_required: course.proof_required,
    proof_prompt: course.proof_prompt,
    issue_certificate: course.issue_certificate,
    enrolled: Boolean(enrolment),
    status,
    due_on: enrolment ? enrolment.due_on : null,
    started_at: enrolment ? iso(enrolment.started_at) : null,
    completed_at: enrolment ? iso(enrolment.completed_at) : null,
    proof_url: enrolment ? enrolment.proof_url : null,
    proof_document_name: proofName,
    certificate_number: enrolment && enrolment.certificate_number ? String(enrolment.certificate_number) : null,
    certificate_ready: Boolean(enrolment && enrolment.certificate_ready),
  };
}

function startedEvent(enrolmentId, course, employeeId, user, { library }) {
  return {
    key: EVENTS.TRAINING_STARTED,
    entity: { type: ENROLMENT_ENTITY, id: enrolmentId },
    actor: user,
    payload: {
      training_enrolment_id: enrolmentId,
      training_course_id: course.training_course_id,
      number: course.number,
      library,
      subject_employee_id: employeeId,
    },
  };
}

/** POST /training/me/courses/:id/start: a Library course enrols them; their own place is started. */
async function start(user, id) {
  const courseId = await tx(async (client) => {
    const { course, enrolment, employeeId } = await openable(client, user, id);
    if (enrolment) {
      const e = await repo.lockEnrolment(client, enrolment.training_enrolment_id);
      if (!e.started_at && !e.completed_at) {
        await repo.setStarted(client, e.training_enrolment_id);
        await emit(client, startedEvent(e.training_enrolment_id, course, employeeId, user, { library: false }));
      }
      return course.training_course_id;
    }
    const created = await repo.insertLibraryEnrolment(client, course.training_course_id, employeeId);
    if (created) await emit(client, startedEvent(created, course, employeeId, user, { library: true }));
    return course.training_course_id;
  });
  return myCourse(user, courseId);
}

/** The person's own place on the item's course, locked; a Library course not started is refused. */
async function ownPlace(client, user, itemId) {
  const item = await repo.itemOf(client, itemId);
  if (!item) throw itemNotFound();
  const { course, enrolment, employeeId } = await openable(client, user, item.training_course_id);
  if (!enrolment) throw new AppError("NOT_STARTED", "Start the course first", 409);
  const e = await repo.lockEnrolment(client, enrolment.training_enrolment_id);
  return { item, course, e, employeeId };
}

/** POST /training/me/items/:id/done: Mark Done; the first starts the course, the last may complete it. */
async function done(user, itemId) {
  const courseId = await tx(async (client) => {
    const { item, course, e, employeeId } = await ownPlace(client, user, itemId);
    if (e.completed_at) return course.training_course_id;
    if (!e.started_at) {
      await repo.setStarted(client, e.training_enrolment_id);
      await emit(client, startedEvent(e.training_enrolment_id, course, employeeId, user, { library: false }));
    }
    if (await repo.markDone(client, e.training_enrolment_id, itemId))
      await emit(client, {
        key: EVENTS.TRAINING_ITEM_DONE,
        entity: { type: ENROLMENT_ENTITY, id: e.training_enrolment_id },
        actor: user,
        payload: { training_enrolment_id: e.training_enrolment_id, training_item_id: itemId, position: Number(item.position) },
      });
    // The lock is held: its own completion check (a reload of the place sees the start).
    if (await ready(client, e, course)) await completeNow(client, e, course, user);
    return course.training_course_id;
  });
  return myCourse(user, courseId);
}

/** POST /training/me/items/:id/undone: allowed until the course is complete. */
async function undone(user, itemId) {
  const courseId = await tx(async (client) => {
    const { course, e } = await ownPlace(client, user, itemId);
    if (e.completed_at) throw new AppError("COURSE_COMPLETED", "A completed course stays as it is", 409);
    if (await repo.markUndone(client, e.training_enrolment_id, itemId))
      await emit(client, {
        key: EVENTS.TRAINING_ITEM_UNDONE,
        entity: { type: ENROLMENT_ENTITY, id: e.training_enrolment_id },
        actor: user,
        payload: { training_enrolment_id: e.training_enrolment_id, training_item_id: itemId },
      });
    return course.training_course_id;
  });
  return myCourse(user, courseId);
}

/**
 * POST /training/me/courses/:id/proof: Add Proof, a link or an uploaded file (claimed into the vault
 * as the person's), once every item is done; it completes the course.
 */
async function proof(user, id, body) {
  const courseId = await tx(async (client) => {
    const { course, enrolment, employeeId } = await openable(client, user, id);
    if (!enrolment) throw new AppError("NOT_STARTED", "Start the course first", 409);
    const e = await repo.lockEnrolment(client, enrolment.training_enrolment_id);
    if (e.completed_at) throw new AppError("COURSE_COMPLETED", "A completed course stays as it is", 409);
    if (!course.proof_required) throw new AppError("PROOF_NOT_ASKED", "This course asks for no proof", 409);
    const p = await repo.progressOf(client, e.training_enrolment_id);
    if (!p.total || p.done < p.total) throw new AppError("ITEMS_LEFT", "Mark every item done first", 409);
    if (body.document_id)
      await vault.claim(client, {
        document_id: body.document_id,
        doc_type: "training_proof",
        entity: { type: ENROLMENT_ENTITY, id: e.training_enrolment_id },
        subject_employee_id: employeeId,
        actor: user,
      });
    await repo.setProof(client, e.training_enrolment_id, { url: body.url, document_id: body.document_id });
    await emit(client, {
      key: EVENTS.TRAINING_PROOF_ADDED,
      entity: { type: ENROLMENT_ENTITY, id: e.training_enrolment_id },
      actor: user,
      after: { proof_url: body.url || null, proof_document_id: body.document_id || null },
      payload: { training_enrolment_id: e.training_enrolment_id, training_course_id: course.training_course_id },
    });
    const withProof = { ...e, proof_url: body.url || null, proof_document_id: body.document_id || null };
    if (await ready(client, withProof, course)) await completeNow(client, withProof, course, user);
    return course.training_course_id;
  });
  return myCourse(user, courseId);
}

/** The person's note on a course as the contract carries it: empty, never saved, before the first. */
const toNote = (courseId, row) => ({
  training_course_id: courseId,
  body: row ? row.body : "",
  updated_at: row ? iso(row.updated_at) : null,
});

/** GET /training/me/courses/:id/note: the person's own note on a course they may open (§6.13). */
async function myNote(user, id) {
  const { course, employeeId } = await openable(pool, user, id);
  return toNote(course.training_course_id, await repo.noteOf(pool, course.training_course_id, employeeId));
}

/**
 * PUT /training/me/courses/:id/note: saves the whole note as the person types (§6.13). Any course
 * they may open, before Start and after completion alike; the event carries its length, never its
 * text, so the audit holds nothing the person wrote.
 */
async function saveNote(user, id, { body }) {
  return tx(async (client) => {
    const { course, employeeId } = await openable(client, user, id);
    const row = await repo.saveNote(client, course.training_course_id, employeeId, body);
    await emit(client, {
      key: EVENTS.TRAINING_NOTE_SAVED,
      entity: { type: COURSE_ENTITY, id: course.training_course_id },
      actor: user,
      payload: {
        training_course_id: course.training_course_id,
        subject_employee_id: employeeId,
        characters: body.length,
        first: Boolean(row.created),
      },
    });
    return toNote(course.training_course_id, row);
  });
}

/**
 * POST /training/me/courses/:id/note/export: Download Word on My Notes (§6.13). The note as last
 * saved, so the screen saves what is typed first; answered 202 (ExportFile) while the worker makes
 * it, and the person's alone (the uploader's read rule; nobody else, `training.manage` included).
 */
async function exportNote(user, id) {
  return tx(async (client) => {
    const { course, employeeId } = await openable(client, user, id);
    const note = await repo.noteOf(client, course.training_course_id, employeeId);
    if (!note || !note.body.trim()) throw new AppError("NOTE_EMPTY", "Write a note first", 409);
    const doc = await exportFiles.reserve(client, {
      doc_type: NOTE_EXPORT,
      entity: { type: NOTE_EXPORT, id: crypto.randomUUID() },
      subject_employee_id: employeeId,
      file_name: exportFilename({ base: `my-notes-${course.number}`, env: config.APP_ENV, extension: "docx" }),
      title: `My Notes, ${course.title}`,
      actor: user,
    });
    await emit(client, {
      key: EVENTS.TRAINING_NOTE_EXPORT_REQUESTED,
      entity: { type: COURSE_ENTITY, id: course.training_course_id },
      actor: user,
      payload: {
        training_course_id: course.training_course_id,
        subject_employee_id: employeeId,
        requested_by: user.user_id,
        document_id: doc.document_id,
      },
    });
    return exportFiles.present(doc);
  });
}

/**
 * training.note_export_requested, in the worker: the note made into the Word file the request
 * reserved: the course's title, "My Notes", the person and the day it was saved, then the note.
 * Someone no longer active, or not the note's owner, gets a failed file instead.
 */
async function buildNoteExport(event, ctx) {
  const p = event.payload || {};
  if (!p.document_id) return;
  const asker = p.requested_by ? await grantsCache.getAuthUser(pool, p.requested_by) : null;
  if (!asker || asker.status !== "active" || asker.employee_id !== p.subject_employee_id)
    return exportFiles.fail(p.document_id, "Only the person whose notes these are may have this file.");
  await exportFiles.make(p.document_id, ctx, async () => {
    const [course, note, person] = await Promise.all([
      repo.getCourse(pool, p.training_course_id),
      repo.noteOf(pool, p.training_course_id, p.subject_employee_id),
      require("../organisation/organisation.repo").findEmployeeById(pool, p.subject_employee_id),
    ]);
    if (!course || !note) throw new Error("training.note_export: the course or the note is gone");
    const name = person ? `${person.first_name} ${person.last_name}`.trim() : "";
    return buildDocx({
      title: course.title,
      subtitle: ["My Notes", name, `Saved ${formatDate(note.updated_at)}`].filter(Boolean).join(" · "),
      body: note.body,
      author: name,
    });
  });
}

/* ------------------------------------------------------------------ *
 * The worker's: tasks and notices, joiners, leavers, the task's close
 * ------------------------------------------------------------------ */

/** Who set a place's task: the assigner, as an actor tasks.create accepts. */
async function setterOf(db, userId, cache) {
  if (cache.has(userId)) return cache.get(userId);
  const u = userId ? await repo.userOf(db, userId) : null;
  const actor = u && u.employee_id ? { user_id: u.user_id, employee_id: u.employee_id, display_name: null } : null;
  cache.set(userId, actor);
  return actor;
}

/** One place's task and notice, in its own transaction; a place done meanwhile is passed by. */
async function settleOne(r, setters) {
  const actor = await setterOf(pool, r.set_by_user_id, setters);
  if (!actor) {
    logger.warn({ training_enrolment_id: r.training_enrolment_id }, "training task not set: its assigner has no employee");
    return false;
  }
  return tx(async (client) => {
    const e = await repo.lockEnrolment(client, r.training_enrolment_id);
    if (!e || e.completed_at || e.task_id || !e.training_assignment_id) return false;
    const course = await courseOf(client, e.training_course_id);
    const task = await tasks().create(
      actor,
      { scope: "all", scope_ids: null, employee_id: actor.employee_id },
      {
        title: `Complete ${course.title}`.slice(0, 200),
        ...(e.due_on ? { due_on: e.due_on } : {}),
        primary_assignee_id: e.employee_id,
        entity_type: ENROLMENT_ENTITY,
        entity_id: e.training_enrolment_id,
      },
      { client },
    );
    await repo.setTask(client, e.training_enrolment_id, task.task_id);
    await emit(client, {
      key: EVENTS.TRAINING_ENROLLED,
      entity: { type: ENROLMENT_ENTITY, id: e.training_enrolment_id },
      actor,
      payload: {
        training_enrolment_id: e.training_enrolment_id,
        training_course_id: course.training_course_id,
        number: course.number,
        title: course.title,
        due_on: e.due_on,
        task_id: task.task_id,
        subject_employee_id: e.employee_id,
      },
    });
    return true;
  });
}

/**
 * Each assigned place with no task yet (on one course, or every course for the sweep): its task
 * "Complete <course>" set by the assigner and its notice, a place per transaction, 50 read at a
 * time; each place is visited once a run, so one that fails waits for the next run.
 * @returns {Promise<number>} the places settled
 */
async function settleEnrolments(courseId = null) {
  const setters = new Map();
  let after = null;
  let settled = 0;
  for (;;) {
    const rows = await repo.awaitingTasks(pool, courseId, after, TASK_BATCH);
    if (!rows.length) return settled;
    for (const r of rows) {
      after = r.training_enrolment_id;
      try {
        if (await settleOne(r, setters)) settled += 1;
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        logger.warn({ err, training_enrolment_id: r.training_enrolment_id }, "training task not set");
      }
    }
  }
}

/** The task of a completed place closes itself (training.close_task). */
async function closeTask(enrolmentId, actorUserId) {
  const u = actorUserId ? await repo.userOf(pool, actorUserId) : null;
  await tx((client) =>
    tasks().completeForRecord(client, u ? { user_id: u.user_id, employee_id: u.employee_id } : null, {
      entity_type: ENROLMENT_ENTITY,
      entity_id: enrolmentId,
    }),
  );
}

/** Enrol one assignment's new matches (joiners only: never its named people), then their tasks. */
async function enrolOne(assignment, today, employeeId = null) {
  const n = await tx(async (client) => {
    await repo.lockCourse(client, assignment.training_course_id);
    const r = await repo.enrol(client, assignment.training_assignment_id, today, { employeeId, named: false });
    return r.enrolled + r.moved;
  });
  return n;
}

/**
 * A joiner, or someone who moved into a department or role (training.enrol_joiners): enrolled on
 * every open assignment that now reaches them, from today.
 * @param {{employee_id?: string, user_id?: string}} who
 */
async function enrolJoiner({ employee_id: employeeId = null, user_id: userId = null }) {
  let id = employeeId;
  if (!id && userId) {
    const u = await repo.userOf(pool, userId);
    id = u ? u.employee_id : null;
  }
  if (!id) return 0;
  const today = lagos.today();
  let enrolled = 0;
  const courses = new Set();
  for (const a of await repo.openAssignments(pool, { employeeId: id, today })) {
    const n = await enrolOne(a, today, id);
    if (n) courses.add(a.training_course_id);
    enrolled += n;
  }
  for (const courseId of courses) await settleEnrolments(courseId);
  return enrolled;
}

/** The daily backstop (`training-joiners`, 06:00 Lagos): every open assignment's joiners, then every task still to set. */
async function sweep() {
  const today = lagos.today();
  let enrolled = 0;
  for (const a of await repo.openAssignments(pool, {})) enrolled += await enrolOne(a, today);
  const settled = await settleEnrolments(null);
  return { enrolled, settled };
}

/** A leaver's open places are removed and their tasks cancelled; completed ones stay (§11). */
async function closeLeaver(employeeId) {
  let closed = 0;
  for (const r of await repo.openEnrolmentsOf(pool, employeeId)) {
    await tx(async (client) => {
      const e = await repo.lockEnrolment(client, r.training_enrolment_id);
      if (!e || e.completed_at) return;
      await tasks().cancelForRecord(client, null, { entity_type: ENROLMENT_ENTITY, entity_id: e.training_enrolment_id, reason: "Left MyCity" });
      await repo.deleteEnrolment(client, e.training_enrolment_id);
      await emit(client, {
        key: EVENTS.TRAINING_ENROLMENT_CLOSED,
        entity: { type: ENROLMENT_ENTITY, id: e.training_enrolment_id },
        actor: null,
        before: { training_course_id: e.training_course_id, started_at: iso(e.started_at) },
        payload: { training_enrolment_id: e.training_enrolment_id, training_course_id: e.training_course_id, employee_id: employeeId },
      });
      closed += 1;
    });
  }
  return closed;
}

/* ------------------------------------------------------------------ *
 * Reminders (§6.11)
 * ------------------------------------------------------------------ */

/** The reminder's `find` (training.events.js): each step of each open place that has come due. */
async function remindersDue(db, { now }) {
  return (await repo.remindersDue(db, now)).map((r) => ({
    entity_type: ENROLMENT_ENTITY,
    entity_id: r.training_enrolment_id,
    occurrence: `${r.due_on}:${r.step}`,
    due_at: r.due_at,
    work_hours: true,
  }));
}

/** The reminder's `check`, in the firing's transaction: still open, the same due date, still at work. */
async function reminderCheck(client, row, { now }) {
  const e = await repo.lockEnrolment(client, row.entity_id);
  if (!e || e.completed_at || !e.due_on) return null;
  const [dueOn] = String(row.occurrence || "").split(":");
  if (dueOn !== e.due_on) return null;
  const today = lagos.today(now);
  if (!(await repo.atWork(client, e.employee_id, today))) return null;
  const course = await repo.getCourse(client, e.training_course_id);
  if (!course) return null;
  await repo.recordReminder(client, e.training_enrolment_id);
  const { entity, payload } = reminderEvent(e, course, today);
  return { entity, payload };
}

/* ------------------------------------------------------------------ *
 * Praxis AI's reads (training.ai.js)
 * ------------------------------------------------------------------ */

/** People overdue on any course, a page at a time, for `training.manage`. */
async function overdue(query) {
  return repo.overdueAcross(pool, query, lagos.today());
}

/* ------------------------------------------------------------------ *
 * The assistant's summary (docs/guides/praxis-ai.md §6.13, Workspace, Knowledge Hub, Community, Home and Settings)
 * ------------------------------------------------------------------ */

/** Where a person stands on a course, as People's Status chips read it; a grouping's parts. */
const STANDING = Object.freeze([
  { key: "completed", label: "Completed" },
  { key: "in_progress", label: "In Progress" },
  { key: "overdue", label: "Overdue", optional: true },
  { key: "not_started", label: "Not Started" },
]);
const DIM_WORDS = Object.freeze({ course: "Places by course", department: "Places by department" });

/**
 * The places on courses in figures: with `training.manage` (and the CEO) every place, as Training counts
 * them; anyone else their own, as My Training shows them. Every place unless a period (enrolled) is
 * asked; by course or department stacked by where each person stands, by status, completions by month.
 * Never a person's proof or notes. Runs on the client the assistant hands over.
 * @param {{query: Function}} client
 * @param {object} params   TrainingSummaryQuery, parsed
 * @param {object} actor    the asking person
 */
async function aiSummary(client, params, actor, now = new Date()) {
  const { figure, group, series, askedPeriod, stacked } = require("../../shared/ai/summary");
  const period = askedPeriod(params, now);
  const by = DIM_WORDS[params.by] ? params.by : "course";
  const manager = await canManage(client, actor);
  if (!manager && !actor.employee_id) return { figures: [], groups: [], series: [], total: 0 };
  const r = await repo.aiSummary(
    client,
    { state: params.state, department_id: params.department_id, from: period && period.from, to: period && period.to, by },
    { employeeId: manager ? null : actor.employee_id, today: lagos.today(now) },
  );
  const f = r.figures;
  const counted = new Map(r.by_status.map((x) => [x.key, x.value]));
  const places = f.places || 0;
  const groups = [
    group(by, DIM_WORDS[by], stacked(r.by_dim, STANDING)),
    group("status", "Places by status", STANDING.filter((s) => counted.has(s.key)).map((s) => ({ key: s.key, label: s.label, value: counted.get(s.key) }))),
  ];
  const figures = [
    figure("courses", "Courses", f.courses || 0),
    figure("library", "Library courses", f.library || 0),
    figure("people", "People", f.people || 0),
    figure("places", "Places", places),
    figure("completed", "Completed", f.completed || 0),
    figure("in_progress", "In progress", f.in_progress || 0),
    figure("overdue", "Overdue", f.overdue || 0),
    figure("not_started", "Not started", f.not_started || 0),
    figure("certificates", "Certificates issued", f.certificates || 0),
  ];
  if (places) figures.push(figure("completion_rate", "Completion rate", Math.round(((f.completed || 0) * 1000) / places) / 10, "percent"));
  return { figures, groups, series: [series("completed", "Completions by month", r.by_month)], total: places };
}

module.exports = {
  aiSummary,
  certificateHash,
  openable,
  youtubeIdOf,
  toItem,
  audienceText,
  canManage,
  list,
  get,
  create,
  update,
  addItem,
  editItem,
  removeItem,
  reorder,
  publish,
  archive,
  assign,
  assignments,
  withdraw,
  people,
  remind,
  mine,
  myCourse,
  start,
  done,
  undone,
  proof,
  myNote,
  saveNote,
  exportNote,
  buildNoteExport,
  settleEnrolments,
  closeTask,
  enrolJoiner,
  sweep,
  closeLeaver,
  remindersDue,
  reminderCheck,
  overdue,
};
