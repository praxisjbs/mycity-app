"use strict";
/**
 * ⌘K for training (docs/guides/knowledge.md §9). Those who build courses (`training.manage`) find
 * every course by its number or title, opening Knowledge Hub · Training. Everyone finds their own
 * courses and the Library's by title or number, opening ESS · My Training on the course: the query
 * is pinned to the caller (`owner`), as My Training lists them. A draft is nobody's but its builders'.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = [
  recordProvider({
    type: "training_course",
    module: "knowledge",
    capability: "training.manage",
    label: "Courses",
    words: ["course", "courses", "learning"],
    from: "training_course c",
    key: "c.training_course_id",
    columns: ["c.number", "c.title"],
    select: "c.training_course_id AS id, c.number AS ref, c.title AS title, NULL::text AS sub, c.status AS status",
    order: "c.title",
  }),
  recordProvider({
    type: "training_enrolment",
    module: "ess",
    label: "My Training",
    words: ["course", "courses", "certificate", "learning"],
    from: `training_course c
      JOIN app_user u ON u.status = 'active'
      LEFT JOIN training_enrolment te ON te.training_course_id = c.training_course_id AND te.employee_id = u.employee_id`,
    key: "c.training_course_id",
    columns: ["c.title", "c.number"],
    select: `c.training_course_id AS id, c.number AS ref, c.title AS title,
      CASE WHEN te.completed_at IS NOT NULL THEN 'Completed' WHEN te.training_enrolment_id IS NOT NULL THEN 'Assigned' ELSE 'Library' END AS sub,
      NULL::text AS status`,
    where: `c.status <> 'draft'
      AND (te.training_enrolment_id IS NOT NULL OR (c.status = 'published' AND c.library))`,
    order: "c.title",
    owner: { column: "u.user_id" },
  }),
];
