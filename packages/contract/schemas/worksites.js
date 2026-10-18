"use strict";
/**
 * Worksites: the offices a punch is matched to, each a centre, a radius and a
 * timezone (docs/guides/attendance.md §6.5). People add, change, retire and restore
 * them, and assign the employees who work there (`employee.worksite_id`, through the
 * organisation service; assigning someone elsewhere moves them). The coordinates are
 * typed until the map's address search is served by our API (F21).
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDateTime, listQuery, Paged } = require("./common");
const { WorkPattern } = require("./organisation");

/** An IANA timezone name; the service checks the zone is one the server knows. */
const timezone = z
  .string()
  .trim()
  .regex(/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+)+)$/, "must be a timezone like Africa/Lagos");

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
/** The fence's radius in metres. MyCity's office is 100 (13 October meeting). */
const radius = z.number().int().min(25).max(1000);

/** A query-string boolean: "true" or "false". */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

const Worksite = z
  .object({
    worksite_id: uuid,
    code: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
    radius_m: z.number().int(),
    timezone: z.string(),
    active: z.boolean(),
    assigned_count: z.number().int().min(0),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();
const WorksitePage = Paged(Worksite);

/** GET /worksites */
const WorksiteListQuery = listQuery({ active: flag.optional() }, ["name", "created_at"]);

/** POST /worksites */
const WorksiteCreate = z
  .object({
    name: text(120),
    address: optionalText(300),
    latitude,
    longitude,
    radius_m: radius,
    timezone: timezone.default("Africa/Lagos"),
  })
  .strict();

/** PATCH /worksites/:id: change it; `active: false` retires it and `true` restores it. */
const WorksiteUpdate = z
  .object({
    name: text(120).optional(),
    address: optionalText(300),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    radius_m: radius.optional(),
    timezone: timezone.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Change something" });

/** Someone assigned to a worksite. */
const WorksiteEmployee = z
  .object({
    employee_id: uuid,
    display_name: z.string(),
    job_title: z.string().nullable(),
    department: z.string().nullable(),
    work_pattern: WorkPattern,
    worksite_id: uuid.nullable(),
  })
  .strict();
const WorksiteEmployeePage = Paged(WorksiteEmployee);

/** POST /worksites/:id/employees */
const WorksiteAssign = z.object({ employee_id: uuid }).strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  Worksite: {
    table: "worksite",
    virtual: { assigned_count: "count of the active employees whose worksite it is" },
  },
  WorksitePage: { table: null, reason: "a page of worksites" },
  WorksiteListQuery: { table: null, reason: "list controls for the worksites" },
  WorksiteCreate: { table: "worksite" },
  WorksiteUpdate: { table: "worksite" },
  WorksiteEmployee: {
    table: "employee",
    virtual: {
      display_name: "employee first and last name",
      department: "department.name",
    },
  },
  WorksiteEmployeePage: { table: null, reason: "a page of the employees assigned to a worksite" },
  WorksiteAssign: { table: "employee" },
};

module.exports = {
  TABLES,
  Worksite,
  WorksitePage,
  WorksiteListQuery,
  WorksiteCreate,
  WorksiteUpdate,
  WorksiteEmployee,
  WorksiteEmployeePage,
  WorksiteAssign,
};
