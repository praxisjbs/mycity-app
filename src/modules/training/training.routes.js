"use strict";
/**
 * /api/v1/training (docs/guides/knowledge.md §5).
 *
 * People who build courses: the `knowledge` grant and the `training.manage` capability
 * (Knowledge Hub · Training):
 *   GET    /courses                     every course with its counts (view)
 *   POST   /courses                     New Course, a numbered draft (create)
 *   GET    /courses/:id                 one course: items, settings, counts (view)
 *   PATCH  /courses/:id                 its title, summary and settings (edit)
 *   POST   /courses/:id/items           Add Item, at most 40 (edit)
 *   PATCH  /items/:id                   the whole item again (edit)
 *   DELETE /items/:id                   remove it (edit)
 *   PUT    /courses/:id/order           the items' new order (edit)
 *   POST   /lesson-with-ai              Draft Lesson: a suggestion only (edit)
 *   POST   /courses/:id/publish         Publish Course, signed (edit)
 *   POST   /courses/:id/archive         Archive Course (delete)
 *   POST   /courses/:id/assignments     Assign Training (edit)
 *   GET    /courses/:id/assignments     its assignments (view)
 *   POST   /assignments/:id/withdraw    Withdraw Assignment (edit)
 *   GET    /courses/:id/people          everyone on it and where they stand (view)
 *   POST   /courses/:id/remind          Remind Overdue (edit)
 *   POST   /enrolments/:id/certificate  Download Certificate: anyone's PDF (view; 202)
 *
 * The person's own, `self` (ESS · My Training):
 *   GET    /me                          To Do, In Progress, Completed or Library
 *   GET    /me/courses/:id              a course as I take it (its id, or my enrolment's)
 *   POST   /me/courses/:id/start        Start
 *   POST   /me/items/:id/done           Mark Done
 *   POST   /me/items/:id/undone         Undone, until completion
 *   POST   /me/courses/:id/proof        Add Proof
 *   POST   /me/courses/:id/certificate  Download Certificate: my PDF (202, pending while it renders)
 */
const router = require("express").Router();
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./training.controller");

const t = c.training;
const IdParams = c.common.IdParams;

route(router, "get", "/me",
  { query: t.MyTrainingQuery, response: t.MyCoursePage, self: true, summary: "My training: one of my lists" },
  controller.mine);

route(router, "get", "/me/courses/:id",
  { params: IdParams, response: t.MyCourse, self: true, summary: "A course as I take it" },
  controller.myCourse);

route(router, "post", "/me/courses/:id/start",
  { params: IdParams, body: c.common.EmptyBody, response: t.MyCourse, self: true, summary: "Start a course" },
  controller.start);

route(router, "post", "/me/items/:id/done",
  { params: IdParams, body: c.common.EmptyBody, response: t.MyCourse, self: true, summary: "Mark an item done" },
  controller.done);

route(router, "post", "/me/items/:id/undone",
  { params: IdParams, body: c.common.EmptyBody, response: t.MyCourse, self: true, summary: "Mark an item not done" },
  controller.undone);

route(router, "post", "/me/courses/:id/proof",
  { params: IdParams, body: t.ProofAdd, response: t.MyCourse, self: true, summary: "Add proof, completing the course" },
  controller.proof);

route(router, "post", "/me/courses/:id/certificate",
  { params: IdParams, body: c.common.EmptyBody, response: c.documents.ExportFile, self: true,
    summary: "My certificate of completion, as a PDF" },
  controller.myCertificate);

route(router, "post", "/enrolments/:id/certificate",
  { params: IdParams, body: c.common.EmptyBody, response: c.documents.ExportFile,
    summary: "Someone's certificate of completion, as a PDF" },
  requirePermission("knowledge", "view"), requireCapability("training.manage"), controller.certificate);

route(router, "get", "/courses",
  { query: t.CourseListQuery, response: t.CoursePage, summary: "Every course" },
  requirePermission("knowledge", "view"), requireCapability("training.manage"), controller.list);

route(router, "post", "/courses",
  { body: t.CourseCreate, response: t.Course, summary: "Start a course" },
  requirePermission("knowledge", "create"), requireCapability("training.manage"), controller.create);

route(router, "post", "/lesson-with-ai",
  { body: t.LessonWithAi, response: t.LessonSuggestion, summary: "A lesson drafted from a text or a PDF; nothing is saved" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.lessonWithAi);

route(router, "patch", "/items/:id",
  { params: IdParams, body: t.ItemCreate, response: t.Course, summary: "Change a course's item" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.editItem);

route(router, "delete", "/items/:id",
  { params: IdParams, response: t.Course, summary: "Remove a course's item" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.removeItem);

route(router, "post", "/assignments/:id/withdraw",
  { params: IdParams, body: c.common.EmptyBody, response: t.Assignment, summary: "Withdraw an assignment" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.withdraw);

route(router, "get", "/courses/:id",
  { params: IdParams, response: t.Course, summary: "One course" },
  requirePermission("knowledge", "view"), requireCapability("training.manage"), controller.get);

route(router, "patch", "/courses/:id",
  { params: IdParams, body: t.CourseUpdate, response: t.Course, summary: "Change a course's title, summary or settings" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.update);

route(router, "post", "/courses/:id/items",
  { params: IdParams, body: t.ItemCreate, response: t.Course, summary: "Add an item to a course" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.addItem);

route(router, "put", "/courses/:id/order",
  { params: IdParams, body: t.ItemOrder, response: t.Course, summary: "Put a course's items in order" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.reorder);

route(router, "post", "/courses/:id/publish",
  { params: IdParams, body: t.CoursePublish, response: t.Course, summary: "Publish a course, signed" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.publish);

route(router, "post", "/courses/:id/archive",
  { params: IdParams, body: t.CourseReason, response: t.Course, summary: "Archive a course" },
  requirePermission("knowledge", "delete"), requireCapability("training.manage"), controller.archive);

route(router, "post", "/courses/:id/assignments",
  { params: IdParams, body: t.AssignmentCreate, response: t.Assignment, summary: "Assign a course" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.assign);

route(router, "get", "/courses/:id/assignments",
  { params: IdParams, query: c.common.PageQuery, response: t.AssignmentPage, summary: "A course's assignments" },
  requirePermission("knowledge", "view"), requireCapability("training.manage"), controller.assignments);

route(router, "get", "/courses/:id/people",
  { params: IdParams, query: t.EnrolmentListQuery, response: t.EnrolmentPage, summary: "Everyone on a course" },
  requirePermission("knowledge", "view"), requireCapability("training.manage"), controller.people);

route(router, "post", "/courses/:id/remind",
  { params: IdParams, body: c.common.EmptyBody, response: t.RemindResult, summary: "Remind everyone overdue on a course" },
  requirePermission("knowledge", "edit"), requireCapability("training.manage"), controller.remind);

module.exports = { basePath: "/training", surface: "staff", router };
