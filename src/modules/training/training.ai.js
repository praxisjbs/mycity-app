"use strict";
/**
 * What the assistant may read about training (docs/guides/knowledge.md §9):
 *
 *   training.mine      the asker's own courses: To Do, In Progress or Completed, with due dates
 *   training.library   the Library's courses the asker has not started
 *   training.progress  every course with assigned, completed and overdue, for `training.manage`;
 *                      anyone else is answered with nothing
 *   training.overdue   the people overdue on any course, for `training.manage`
 *   training.summary   the places in figures: everyone's for `training.manage`, otherwise the asker's own
 *
 * Every list is a page of 25 through the same service as the screen. No actions (§9): building
 * a course is design work on the screen, publishing needs the publisher's signature, and an
 * assignment reaches many people at once, so the assistant sends the person to Knowledge Hub ·
 * Training, and to ESS · My Training to take a course.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./training.service");

const EMPTY = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };

module.exports = defineManifest({
  module: "knowledge",
  // The forms stay on the screen (§9, decision 35's `design`).
  not_offered: {
    CourseCreate: "design: New Course starts a course built item by item on Knowledge Hub, Training, then published with a drawn signature",
    CourseUpdate: "design: a course's title, summary and settings are set beside its items on Knowledge Hub, Training",
    ItemCreate: "design: an item is an upload, a video or course link or a lesson written in the editor, put in order on the screen",
    AssignmentCreate: "design: Assign Training reaches many people at once with a task and a notice each, so it is pressed on the screen",
    TrainingNoteSave: "personal: My Notes are the person's own words on a course, read and written by them alone on ESS, My Training",
  },
  summaries: [
    {
      key: "training.summary",
      description: "Training in figures: places, completed, in progress, overdue, the completion rate, certificates; by course, department or month (everyone's for training managers, else my own)",
      params: c.training.TrainingSummaryQuery,
      permission: ["knowledge", "view"],
      run: (client, params, actor) => service.aiSummary(client, params, actor),
    },
  ],
  reads: [
    {
      key: "training.mine",
      summary: "none: my own short list",
      description: "List my own training courses: to do, in progress or completed, with their due dates and progress",
      params: c.training.MyTrainingQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => (actor.employee_id ? service.mine(actor, params) : EMPTY),
      cite: (row) => ({ type: "training_enrolment", id: row.training_course_id, label: `${row.number} ${row.title}` }),
    },
    {
      key: "training.library",
      summary: "training.summary",
      description: "List the open Library courses anyone may take that I have not started",
      params: c.training.MyTrainingQuery,
      permission: ["ess", "view"],
      run: (_client, params, actor) => (actor.employee_id ? service.mine(actor, { ...params, list: "library" }) : EMPTY),
      cite: (row) => ({ type: "training_enrolment", id: row.training_course_id, label: `${row.number} ${row.title}` }),
    },
    {
      key: "training.progress",
      summary: "training.summary",
      description: "List every training course with how many people are assigned, completed and overdue (for people who manage training)",
      params: c.training.CourseListQuery,
      permission: ["knowledge", "view"],
      run: async (_client, params, actor) => ((await service.canManage(pool, actor)) ? service.list(params) : EMPTY),
      cite: (row) => ({ type: "training_course", id: row.training_course_id, label: `${row.number} ${row.title}` }),
    },
    {
      key: "training.overdue",
      summary: "training.summary",
      description: "List the people overdue on a training course, with the course and its due date (for people who manage training)",
      params: c.common.PageQuery,
      permission: ["knowledge", "view"],
      run: async (_client, params, actor) => ((await service.canManage(pool, actor)) ? service.overdue(params) : EMPTY),
      cite: (row) => ({ type: "training_course", id: row.training_course_id, label: `${row.number} ${row.title}` }),
    },
  ],
  routes: [
    { intent: "build or assign a training course", screen: "knowledge.training" },
    { intent: "remind people overdue on a course", screen: "knowledge.training" },
    { intent: "take a course or see my certificates", screen: "ess.my-training" },
  ],
});
