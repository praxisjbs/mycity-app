"use strict";
/**
 * Projects: work that belongs together, gathered on a board of its own
 * (docs/guides/workspace.md §3 step 14, §6 Projects).
 *
 * Anyone starts a project and owns it; everyone sees the list. A project gives nobody a
 * task: the tasks in it keep their own visibility, so its board and its counts hold only
 * the tasks the reader could see anyway. A task is in one project or none
 * (`task.project_id`).
 *
 * Statuses:
 *   active      takes new tasks
 *   completed   the work is over; keeps its tasks, takes no new one until reopened
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDate, isoDateTime, blank, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");

const ProjectStatus = z.enum(["active", "completed"]);

/** A project as a task names it. */
const ProjectRef = z
  .object({
    project_id: uuid,
    number: z.string(),
    name: z.string(),
  })
  .strict();

/** One project, as the list and its page show it. `open` and `done` count the tasks the reader can see. */
const Project = z
  .object({
    project_id: uuid,
    number: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    owner: PersonRef.nullable(),
    due_on: isoDate.nullable(),
    status: ProjectStatus,
    completed_at: isoDateTime.nullable(),
    open: z.number().int().min(0),
    done: z.number().int().min(0),
    can_edit: z.boolean(),
    created_at: isoDateTime,
  })
  .strict();
const ProjectPage = Paged(Project);

/** GET /projects: the active ones unless asked for the completed. */
const ProjectListQuery = listQuery(
  {
    status: ProjectStatus.default("active"),
  },
  ["name", "due_on", "created_at"],
);

/** POST /projects: the caller owns it. */
const ProjectCreate = z
  .object({
    name: text(120),
    description: optionalText(2000),
    due_on: blank(isoDate),
  })
  .strict();

/** What a screen button may fill on New Project through the address (praxis-ai.md §6.4). */
const ProjectPrefill = z
  .object({
    name: text(120).optional(),
    description: optionalText(2000),
    due_on: isoDate.optional(),
  })
  .strict();

/** PATCH /projects/:id: its owner, or a reader whose grant is `all`. `completed` completes it, `active` reopens it. */
const ProjectEdit = z
  .object({
    name: text(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    due_on: isoDate.nullable().optional(),
    status: ProjectStatus.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Change at least one field");

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  ProjectRef: { table: "project" },
  Project: {
    table: "project",
    virtual: {
      owner: "the person in project.owner_employee_id",
      open: "count of the project's open tasks the reader can see",
      done: "count of the project's done tasks the reader can see",
      can_edit: "the reader owns it, or their workspace grant is all",
    },
  },
  ProjectPage: { table: null, reason: "a page of projects" },
  ProjectListQuery: { table: null, reason: "list controls and filters for the projects" },
  ProjectCreate: { table: "project" },
  ProjectPrefill: { table: "project" },
  ProjectEdit: { table: "project" },
};

module.exports = {
  TABLES,
  ProjectStatus,
  ProjectRef,
  Project,
  ProjectPage,
  ProjectListQuery,
  ProjectCreate,
  ProjectPrefill,
  ProjectEdit,
};
