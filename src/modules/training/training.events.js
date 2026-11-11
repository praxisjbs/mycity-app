"use strict";
/**
 * What the training module records, who it tells, and the work that follows a commit
 * (docs/guides/knowledge.md §7). Loaded by the API and the worker.
 *
 *   training_course.created        New Course: a numbered draft
 *   training_course.updated        its title, summary or settings changed
 *   training_course.item_changed   an item added, changed, removed or the items reordered
 *   training_course.published      Publish Course, signed by the publisher (K7)
 *   training_course.archived       Archive Course: its open assignments withdrawn with it
 *   training.assigned              Assign Training: everyone it reaches now enrolled in the press's
 *                                  transaction; `training.notify_assigned` sets each person's task
 *                                  and notice after commit
 *   training.assignment_withdrawn  Withdraw Assignment: enrolments not started removed, their tasks
 *                                  cancelled in the same transaction
 *   training.enrolled              one person's assigned place, its task set: they are told
 *                                  "Training assigned" (emitted by the worker, one per person)
 *   training.started               a person started a course (Start, or their first Mark Done)
 *   training.item_done,            an item marked done or undone: audit only, progress is not
 *   training.item_undone           notified
 *   training.proof_added           Add Proof: a link or a file, completing the course
 *   training.completed             completion (§6.8), its certificate number allocated in the same
 *                                  transaction: `training.close_task` closes the task and
 *                                  `training.issue_certificate` generates the certificate (§6.9)
 *   training.certificate_ready     its PDF is stored: the person is told "Certificate ready"
 *   training.enrolment_closed      a leaver's open enrolment removed and its task cancelled
 *   training.reminder_due          the reminder engine's `training_due`, or Remind Overdue
 *
 * New joiners are enrolled by `training.enrol_joiners` on employee.created, employee.updated and
 * access.roles_set, and by the `training-joiners` job every morning at 06:00 Lagos as a backstop.
 * Payloads carry ids, numbers, titles and dates: never a lesson's text or a proof.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const { defineDocType } = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");
const vault = require("../../shared/documents/vault");
const grantsCache = require("../../shared/rbac/grants-cache");
const c = require("@mycity/contract");
const reminders = require("../notifications/notifications.reminders");
const { formatDate } = require("../../shared/time/day-first");

const EVENTS = defineEvents("knowledge", {
  "training_course.created": { summary: "A course was started" },
  "training_course.updated": { summary: "A course's title, summary or settings changed" },
  "training_course.item_changed": { summary: "A course's items changed" },
  "training_course.published": { summary: "A course was published" },
  "training_course.archived": { summary: "A course was archived" },
  "training.assigned": { summary: "A course was assigned" },
  "training.assignment_withdrawn": { summary: "A course's assignment was withdrawn" },
  "training.enrolled": { summary: "Someone was assigned a course" },
  "training.started": { summary: "Someone started a course" },
  "training.item_done": { summary: "Someone marked a course's item done" },
  "training.item_undone": { summary: "Someone marked a course's item not done" },
  "training.proof_added": { summary: "Someone added proof to a course" },
  "training.completed": { summary: "Someone completed a course" },
  "training.certificate_ready": { summary: "A certificate of completion was issued" },
  "training.enrolment_closed": { summary: "A leaver's course was closed" },
  "training.reminder_due": { summary: "Someone was reminded of a course" },
});

/** The record a person's place on a course is, in notices, tasks, search and links. */
const ENROLMENT_ENTITY = "training_enrolment";
const COURSE_ENTITY = "training_course";
/** The reminder engine's key (§6.11). */
const REMINDER_KEY = "training_due";
/** The certificate of completion's PDF (§6.9). */
const CERTIFICATE_DOC_TYPE = "training_certificate";

/** An item's file: read by everyone who may take the course (the `knowledge` grant). */
defineDocumentType("training_material", { label: "Training material", module: "knowledge", sensitivity: "normal" });
/** The publisher's signature, printed on every certificate of the course (K7). */
defineDocumentType("training_signature", { label: "Training signature", module: "knowledge", sensitivity: "normal" });
/** A person's proof of an outside course: theirs and `training.manage`'s. */
defineDocumentType("training_proof", { label: "Training proof", module: "knowledge", sensitivity: "personal" });

/*
 * The certificate: one A4 landscape page it draws itself (training.certificate.js), its number the
 * enrolment's (allocated at completion), personal, stored once and locked.
 */
defineDocType(CERTIFICATE_DOC_TYPE, {
  label: "Training certificate",
  module: "knowledge",
  template: "training-certificate",
  numbering: null,
  sensitivity: "personal",
  landscape: true,
  title: (data) => data.number,
  draw: (data, context) => require("./training.certificate").draw(data, context),
});
defineVariables("document", "training-certificate", c.training.CertificateDocumentVars);

/**
 * A training enrolment's files (its proof, its certificate) are the person's and `training.manage`'s
 * only (§8); the CEO holds every capability.
 */
vault.defineAccess(ENROLMENT_ENTITY, async (client, user, doc) => {
  if (!user) return false;
  if (user.is_ceo === true) return true;
  if (doc.subject_employee_id && user.employee_id && doc.subject_employee_id === user.employee_id) return true;
  return (await grantsCache.getCapabilities(client, user.user_id)).includes("training.manage");
});

defineNotification(EVENTS.TRAINING_CERTIFICATE_READY, {
  to: [{ subject: true }],
  title: "Certificate ready",
  body: (e) => `${e.payload.title}, ${e.payload.certificate_number}.`,
});

defineNotification(EVENTS.TRAINING_ENROLLED, {
  to: [{ subject: true }],
  title: "Training assigned",
  body: (e) => (e.payload.due_on ? `${e.payload.title}, due ${formatDate(e.payload.due_on)}.` : `${e.payload.title}.`),
});

defineNotification(EVENTS.TRAINING_REMINDER_DUE, {
  to: [{ subject: true }],
  title: (e) => (e.payload.overdue ? "Training overdue" : "Training due"),
  body: (e) => `${e.payload.title}, due ${formatDate(e.payload.due_on)}.`,
});

/*
 * The reminder (§6.11) runs on the one reminder engine (docs/guides/notifications.md §7.1): 3 days
 * before the due date, on it, then weekly while overdue, at most three times; in the working day.
 * The service is required when the engine calls it: it requires this file for its event keys.
 */
reminders.defineReminder(REMINDER_KEY, {
  event: EVENTS.TRAINING_REMINDER_DUE,
  module: "knowledge",
  find: (db, ctx) => require("./training.service").remindersDue(db, ctx),
  check: (client, row, ctx) => require("./training.service").reminderCheck(client, row, ctx),
});

const service = () => require("./training.service");

/** Each newly assigned person's task and notice, in small transactions after commit (§11: 300 people). */
outbox.register(EVENTS.TRAINING_ASSIGNED, "training.notify_assigned", (event) =>
  service().settleEnrolments(event.payload.training_course_id),
);

/** The certificate is generated after the completion commits; its PDF follows in the worker (§6.9). */
outbox.register(EVENTS.TRAINING_COMPLETED, "training.issue_certificate", (event) =>
  require("./training.certificate").issue(event.payload.training_enrolment_id),
);

/** Its PDF stored: "Certificate ready" to the person. */
outbox.register(vault.EVENTS.DOCUMENT_GENERATED, "training.certificate_ready", (event) =>
  event.payload && event.payload.doc_type === CERTIFICATE_DOC_TYPE ? require("./training.certificate").ready(event.payload.document_id) : null,
);

/** The task closes itself when the course completes (§6.7). */
outbox.register(EVENTS.TRAINING_COMPLETED, "training.close_task", (event) =>
  service().closeTask(event.payload.training_enrolment_id, event.actor_user_id || null),
);

/*
 * Someone who joins, or moves into a department or role an open assignment names, is enrolled from
 * that day (§6.7). A login's roles arrive on access.roles_set, about the login.
 */
for (const key of ["employee.created", "employee.updated"])
  outbox.register(key, "training.enrol_joiners", (event) =>
    service().enrolJoiner({ employee_id: (event.payload && event.payload.employee_id) || event.entity.id }),
  );
outbox.register("access.roles_set", "training.enrol_joiners", (event) => service().enrolJoiner({ user_id: event.entity.id }));

/** A leaver's open enrolments and their tasks are closed; a certificate already issued stays (§11). */
outbox.register("employee.archived", "training.close_leaver", (event) =>
  service().closeLeaver((event.payload && event.payload.employee_id) || event.entity.id),
);

module.exports = { EVENTS, ENROLMENT_ENTITY, COURSE_ENTITY, REMINDER_KEY, CERTIFICATE_DOC_TYPE };
