"use strict";
/**
 * Knowledge Hub · Training and ESS · My Training (docs/guides/knowledge.md §4, §5, §6.5 to §6.11).
 *
 * A course is an ordered list of items: an uploaded file, a video link (YouTube plays in the
 * course), an outside course link, or a written lesson (Markdown). People with `training.manage`
 * build it, publish it once with their signature (printed on every certificate), and assign it to
 * everyone, departments, roles or named people with a number of days to finish; a Library course
 * may be taken by anyone. A person marks each item done, adds proof when the course asks for it,
 * and on completion receives a numbered certificate.
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");
const { RichTextBlock, SignaturePng } = require("./policies");

const longEnough = (n) => (v) => v.trim().length >= n;
const reasonText = text(500).refine(longEnough(10), "At least 10 characters");
const httpsUrl = z.string().trim().max(2000).url("Paste a link").regex(/^https:\/\//, "Use an https link");

const CourseState = z.enum(["draft", "published", "archived"]);
const ItemKind = z.enum(["file", "video", "link", "lesson"]);
/** Where a person stands on a course, worked out against today in Lagos. */
const EnrolmentStatus = z.enum(["not_started", "in_progress", "completed", "overdue"]);
/** ESS · My Training's lists. */
const MyTrainingList = z.enum(["to_do", "in_progress", "completed", "library"]);

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

/** One item as a builder and a learner see it. */
const TrainingItem = z
  .object({
    training_item_id: uuid,
    position: z.number().int().min(1).max(40),
    kind: ItemKind,
    title: z.string(),
    url: z.string().nullable(),
    /** A YouTube link's video id, which the course plays inside; null for any other link. */
    youtube_id: z.string().nullable(),
    document_id: uuid.nullable(),
    document_name: z.string().nullable(),
    document_type: z.string().nullable(),
    /** A lesson as the editor loads it: its Markdown drawn as HTML by the one converter. */
    lesson_html: z.string().nullable(),
    /** The same, as the reader draws it. */
    lesson: z.array(RichTextBlock).nullable(),
    minutes: z.number().int().min(1).max(600).nullable(),
  })
  .strict();

const itemTitle = text(120).refine(longEnough(2), "Name the item");
/** The words of the editor's HTML, for the length a person sees. */
const wordsOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
/**
 * A lesson as the editor sends it (HTML). The server keeps it as Markdown through the one
 * converter (shared/documents/markdown.js) and refuses one longer than 20,000 characters there.
 */
const lessonHtml = z
  .string()
  .max(100_000, "Too long")
  .refine((v) => wordsOf(v).length >= 20, "At least 20 characters");
const minutes = z.number().int().min(1, "At least 1").max(600, "At most 600").optional();

/** Add Item, and the whole item again when it changes (PATCH sends the same): one shape per kind. */
const ItemCreate = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), title: itemTitle, document_id: uuid, minutes }).strict(),
  z.object({ kind: z.literal("video"), title: itemTitle, url: httpsUrl, minutes }).strict(),
  z.object({ kind: z.literal("link"), title: itemTitle, url: httpsUrl, minutes }).strict(),
  z.object({ kind: z.literal("lesson"), title: itemTitle, lesson_html: lessonHtml, minutes }).strict(),
]);

/** The items in their new order: every item of the course, once. */
const ItemOrder = z.object({ item_ids: z.array(uuid).min(1).max(40) }).strict();

/* ------------------------------------------------------------------ *
 * Courses
 * ------------------------------------------------------------------ */

const CourseCounts = z
  .object({
    assigned: z.number().int().min(0),
    in_progress: z.number().int().min(0),
    completed: z.number().int().min(0),
    overdue: z.number().int().min(0),
  })
  .strict();

/** One course, for `training.manage`. */
const Course = z
  .object({
    training_course_id: uuid,
    number: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    state: CourseState,
    library: z.boolean(),
    proof_required: z.boolean(),
    proof_prompt: z.string().nullable(),
    issue_certificate: z.boolean(),
    items: z.array(TrainingItem),
    /** The sum of the items' minutes; null when none is set. */
    minutes: z.number().int().min(1).nullable(),
    published_at: isoDateTime.nullable(),
    published_by_name: z.string().nullable(),
    signer_name: z.string().nullable(),
    signer_title: z.string().nullable(),
    archived_at: isoDateTime.nullable(),
    archive_reason: z.string().nullable(),
    counts: CourseCounts,
  })
  .strict();

/** A row of Knowledge Hub · Training. */
const CourseRow = z
  .object({
    training_course_id: uuid,
    number: z.string(),
    title: z.string(),
    state: CourseState,
    library: z.boolean(),
    items: z.number().int().min(0),
    assigned: z.number().int().min(0),
    completed: z.number().int().min(0),
    overdue: z.number().int().min(0),
    updated_at: isoDateTime,
  })
  .strict();
const CoursePage = Paged(CourseRow);

const CourseListQuery = listQuery({ state: CourseState.optional() }, ["title", "number", "updated_at"]);

const courseTitle = text(120).refine(longEnough(4), "At least 4 characters");

/** New Course: a draft with no items. */
const CourseCreate = z.object({ title: courseTitle, summary: optionalText(300) }).strict();

/** A course's title, summary and settings; only what changes is sent. */
const CourseUpdate = z
  .object({
    title: courseTitle.optional(),
    summary: optionalText(300),
    library: z.boolean().optional(),
    proof_required: z.boolean().optional(),
    proof_prompt: optionalText(120),
    issue_certificate: z.boolean().optional(),
  })
  .strict();

/** Publish Course: the publisher's signature, printed on every certificate (K7). */
const CoursePublish = z.object({ signature: SignaturePng }).strict();

/** Archive Course. */
const CourseReason = z.object({ reason: reasonText }).strict();

/** Draft Lesson: a pasted text or an uploaded PDF, never both (§6.5). */
const LessonWithAi = z
  .object({
    title: itemTitle,
    text: optionalText(20_000),
    document_id: uuid.optional(),
  })
  .strict()
  .refine((v) => (v.text ? 1 : 0) + (v.document_id ? 1 : 0) === 1, { message: "Paste the text or pick a PDF", path: ["text"] });

/** What Draft Lesson suggests, as the editor loads it; nothing is saved until the builder takes it. */
const LessonSuggestion = z.object({ lesson_html: z.string() }).strict();

/* ------------------------------------------------------------------ *
 * Assignments
 * ------------------------------------------------------------------ */

/** Assign Training: everyone, or any mix of departments, roles and named people (§6.7). */
const AssignmentCreate = z
  .object({
    everyone: z.boolean(),
    department_ids: z.array(uuid).max(50).default([]),
    role_ids: z.array(uuid).max(20).default([]),
    employee_ids: z.array(uuid).max(300).default([]),
    due_within_days: z.number().int().min(1, "At least 1 day").max(365, "At most 365 days").nullable().optional(),
    keep_assigning: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.everyone || v.department_ids.length + v.role_ids.length + v.employee_ids.length > 0, {
    message: "Pick who takes it",
    path: ["everyone"],
  });

const NamedRef = (idKey) => z.object({ [idKey]: uuid, name: z.string() }).strict();

/** An assignment as Knowledge Hub · Training lists it. */
const Assignment = z
  .object({
    training_assignment_id: uuid,
    training_course_id: uuid,
    everyone: z.boolean(),
    departments: z.array(NamedRef("department_id")),
    roles: z.array(NamedRef("role_id")),
    people: z.array(PersonRef),
    /** Who it reaches, in words ("Everyone", "Marketing and 2 people"). */
    audience_text: z.string(),
    due_within_days: z.number().int().min(1).max(365).nullable(),
    keep_assigning: z.boolean(),
    enrolled: z.number().int().min(0),
    withdrawn_at: isoDateTime.nullable(),
    created_at: isoDateTime,
    created_by_name: z.string().nullable(),
  })
  .strict();
const AssignmentPage = Paged(Assignment);

/* ------------------------------------------------------------------ *
 * Enrolments
 * ------------------------------------------------------------------ */

/** A person on a course, for `training.manage` (Training · People). */
const EnrolmentRow = z
  .object({
    training_enrolment_id: uuid,
    person: PersonRef,
    status: EnrolmentStatus,
    /** Assigned, or started from the Library. */
    assigned: z.boolean(),
    due_on: isoDate.nullable(),
    started_at: isoDateTime.nullable(),
    completed_at: isoDateTime.nullable(),
    items_done: z.number().int().min(0),
    items_total: z.number().int().min(0),
    proof_url: z.string().nullable(),
    proof_document_id: uuid.nullable(),
    certificate_number: z.string().nullable(),
    certificate_ready: z.boolean(),
  })
  .strict();
const EnrolmentPage = Paged(EnrolmentRow);

const EnrolmentListQuery = listQuery({ status: EnrolmentStatus.optional() }, ["due_on", "started_at", "completed_at"]);

/** Remind Overdue's answer. */
const RemindResult = z.object({ reminded: z.number().int().min(0) }).strict();

/* ------------------------------------------------------------------ *
 * ESS · My Training
 * ------------------------------------------------------------------ */

/** A course on one of the person's lists. */
const MyCourseRow = z
  .object({
    training_course_id: uuid,
    number: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    minutes: z.number().int().min(1).nullable(),
    items_total: z.number().int().min(0),
    items_done: z.number().int().min(0),
    /** Null for a Library course the person has not started. */
    status: EnrolmentStatus.nullable(),
    due_on: isoDate.nullable(),
    completed_at: isoDateTime.nullable(),
    certificate_number: z.string().nullable(),
    certificate_ready: z.boolean(),
  })
  .strict();
const MyCoursePage = Paged(MyCourseRow);

const MyTrainingQuery = listQuery({ list: MyTrainingList.default("to_do") });

/** An item as the person takes it: done or not. */
const MyItem = TrainingItem.extend({ done_at: isoDateTime.nullable() }).strict();

/** A course as the person takes it. */
const MyCourse = z
  .object({
    training_course_id: uuid,
    number: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    minutes: z.number().int().min(1).nullable(),
    items: z.array(MyItem),
    proof_required: z.boolean(),
    proof_prompt: z.string().nullable(),
    issue_certificate: z.boolean(),
    /** False for a Library course not yet started. */
    enrolled: z.boolean(),
    status: EnrolmentStatus.nullable(),
    due_on: isoDate.nullable(),
    started_at: isoDateTime.nullable(),
    completed_at: isoDateTime.nullable(),
    proof_url: z.string().nullable(),
    proof_document_name: z.string().nullable(),
    certificate_number: z.string().nullable(),
    certificate_ready: z.boolean(),
  })
  .strict();

/** Add Proof: a certificate link or an uploaded file, never both. */
const ProofAdd = z
  .object({ url: httpsUrl.optional(), document_id: uuid.optional() })
  .strict()
  .refine((v) => (v.url ? 1 : 0) + (v.document_id ? 1 : 0) === 1, { message: "Paste a link or pick a file", path: ["url"] });

/* ------------------------------------------------------------------ *
 * The certificate of completion (templates/documents/training-certificate.html, §6.9)
 * ------------------------------------------------------------------ */

const dataUrl = (type) => z.string().regex(new RegExp(`^data:${type};base64,[A-Za-z0-9+/]+=*$`));

/** What the certificate prints: the facts as issued, the publisher's signature and the QR. */
const CertificateDocumentVars = z
  .object({
    number: z.string(),
    holder_name: z.string(),
    course_title: z.string(),
    items: z.number().int().min(1),
    items_word: z.enum(["item", "items"]),
    /** The course's length in words ("2 hours", "45 minutes"); null when no item has minutes. */
    length: z.string().nullable(),
    completed_on: isoDate,
    issued_on: isoDate,
    year: z.string().regex(/^\d{4}$/),
    signer_name: z.string(),
    signer_title: z.string().nullable(),
    signature: dataUrl("image/png"),
    qr: dataUrl("image/png"),
    /** Where the QR leads, for those who type it: go.mycityapp.io/verify. */
    verify_at: z.string(),
  })
  .strict();

const TABLES = {
  CertificateDocumentVars: { table: null, reason: "the variables of templates/documents/training-certificate.html" },
  TrainingItem: {
    table: "training_item",
    virtual: {
      youtube_id: "read from url",
      document_name: "the document's file name",
      document_type: "the document's media type",
      lesson_html: "lesson_markdown, as the editor loads it",
      lesson: "lesson_markdown, as the reader draws it",
    },
  },
  ItemOrder: { table: null, reason: "the items' new order, written to training_item.position" },
  CourseCounts: { table: null, reason: "counted from training_enrolment" },
  Course: {
    table: "training_course",
    virtual: {
      state: "status",
      items: "its training_item rows",
      minutes: "the items' minutes, summed",
      published_by_name: "the publisher's name",
      counts: "counted from training_enrolment",
    },
  },
  CourseRow: {
    table: "training_course",
    virtual: {
      state: "status",
      items: "its training_item rows, counted",
      assigned: "counted from training_enrolment",
      completed: "counted from training_enrolment",
      overdue: "counted from training_enrolment",
    },
  },
  CoursePage: { table: null, reason: "a page of courses" },
  CourseListQuery: { table: null, reason: "list controls, not a row" },
  CourseCreate: { table: "training_course" },
  CourseUpdate: { table: "training_course" },
  CoursePublish: { table: null, reason: "the signature, stored in the vault as training_course.signature_document_id" },
  CourseReason: { table: null, reason: "the archive reason, written to training_course.archive_reason" },
  LessonWithAi: { table: null, reason: "what Draft Lesson reads; nothing is saved" },
  LessonSuggestion: { table: "training_item", virtual: { lesson_html: "the model's Markdown as the editor loads it; kept as lesson_markdown once added" } },
  AssignmentCreate: {
    table: "training_assignment",
    virtual: {
      department_ids: "training_assignment_audience rows",
      role_ids: "training_assignment_audience rows",
      employee_ids: "training_assignment_audience rows",
    },
  },
  Assignment: {
    table: "training_assignment",
    virtual: {
      departments: "its training_assignment_audience rows, by name",
      roles: "its training_assignment_audience rows, by name",
      people: "its training_assignment_audience rows, as people",
      audience_text: "who it reaches, in words",
      enrolled: "counted from training_enrolment",
      created_by_name: "who assigned it",
    },
  },
  AssignmentPage: { table: null, reason: "a page of a course's assignments" },
  EnrolmentRow: {
    table: "training_enrolment",
    virtual: {
      person: "the employee, as a person",
      status: "worked out against today in Lagos",
      assigned: "training_assignment_id is set",
      items_done: "counted from training_item_progress",
      items_total: "the course's items, counted",
      certificate_ready: "the certificate's PDF is made",
    },
  },
  EnrolmentPage: { table: null, reason: "a page of a course's people" },
  EnrolmentListQuery: { table: null, reason: "list controls, not a row" },
  RemindResult: { table: null, reason: "how many people Remind Overdue reminded" },
  MyCourseRow: {
    table: "training_course",
    virtual: {
      minutes: "the items' minutes, summed",
      items_total: "the course's items, counted",
      items_done: "counted from training_item_progress",
      status: "the person's training_enrolment, against today in Lagos",
      due_on: "the person's training_enrolment",
      completed_at: "the person's training_enrolment",
      certificate_number: "the person's training_enrolment",
      certificate_ready: "the person's training_enrolment has its PDF",
    },
  },
  MyCoursePage: { table: null, reason: "a page of the person's courses" },
  MyTrainingQuery: { table: null, reason: "list controls, not a row" },
  MyItem: {
    table: "training_item",
    virtual: {
      youtube_id: "read from url",
      document_name: "the document's file name",
      document_type: "the document's media type",
      lesson_html: "lesson_markdown, as the editor loads it",
      lesson: "lesson_markdown, as the reader draws it",
      done_at: "the person's training_item_progress",
    },
  },
  MyCourse: {
    table: "training_course",
    virtual: {
      items: "its training_item rows with the person's progress",
      minutes: "the items' minutes, summed",
      enrolled: "the person has a training_enrolment",
      status: "the person's training_enrolment, against today in Lagos",
      due_on: "the person's training_enrolment",
      started_at: "the person's training_enrolment",
      completed_at: "the person's training_enrolment",
      proof_url: "the person's training_enrolment",
      proof_document_name: "the proof document's file name",
      certificate_number: "the person's training_enrolment",
      certificate_ready: "the person's training_enrolment has its PDF",
    },
  },
  ProofAdd: { table: null, reason: "the proof, written to training_enrolment.proof_url or proof_document_id" },
};

module.exports = {
  TABLES,
  CourseState,
  ItemKind,
  EnrolmentStatus,
  MyTrainingList,
  TrainingItem,
  ItemCreate,
  ItemOrder,
  CourseCounts,
  Course,
  CourseRow,
  CoursePage,
  CourseListQuery,
  CourseCreate,
  CourseUpdate,
  CoursePublish,
  CourseReason,
  LessonWithAi,
  LessonSuggestion,
  AssignmentCreate,
  Assignment,
  AssignmentPage,
  EnrolmentRow,
  EnrolmentPage,
  EnrolmentListQuery,
  RemindResult,
  MyCourseRow,
  MyCoursePage,
  MyTrainingQuery,
  MyItem,
  MyCourse,
  ProofAdd,
  CertificateDocumentVars,
};
