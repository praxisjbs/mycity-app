"use strict";
/**
 * Worksites: the offices a punch is matched to, each a centre, a radius and a
 * timezone (docs/guides/attendance.md §6.5). People add, change, retire and restore
 * them, and assign the employees who work there (`employee.worksite_id`, through the
 * organisation service; assigning someone elsewhere moves them). The form fills the
 * coordinates from the address search (`maps.js`, F21); they arrive here as numbers.
 */
const { z } = require("zod");
const { uuid, text, isoDateTime, listQuery, Paged } = require("./common");
const { PlaceInput, PlaceView } = require("./maps");
const { WorkPattern } = require("./organisation");

/** An IANA timezone name; the service checks the zone is one the server knows. */
const timezone = z
  .string()
  .trim()
  .regex(/^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+)+)$/, "must be a timezone like Africa/Lagos");

/** A centre's latitude and longitude; a value outside its range is refused with the whole range. */
const latitude = z.number().min(-90, "From -90 to 90").max(90, "From -90 to 90");
const longitude = z.number().min(-180, "From -180 to 180").max(180, "From -180 to 180");
/** The fence's radius in metres. MyCity's office is 100 (13 October meeting). */
const radius = z.number().int("Whole metres only").min(25, "From 25 to 1,000 m").max(1000, "From 25 to 1,000 m");

/** A query-string boolean: "true" or "false". */
const flag = z.enum(["true", "false"]).transform((v) => v === "true");

const Worksite = z
  .object({
    worksite_id: uuid,
    code: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    /** The address as an edit form reads it (F27): the place, with a token to send it back. */
    address_place: PlaceView.nullable(),
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
    /** Picked or pinned, never typed (F27, docs/guides/addresses.md). */
    address: PlaceInput.optional(),
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
    /** A new place, or null to clear it. */
    address: PlaceInput.nullable().optional(),
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
    /** Their photo at the list size; null shows their initials. */
    photo_url: z.string().nullable(),
  })
  .strict();
const WorksiteEmployeePage = Paged(WorksiteEmployee);

/** POST /worksites/:id/employees */
const WorksiteAssign = z.object({ employee_id: uuid }).strict();

/** Which table each schema is a row of (gate 6, check/contract-columns.js). */
const TABLES = {
  Worksite: {
    table: "worksite",
    virtual: {
      assigned_count: "count of the active employees whose worksite it is",
      address_place: "the worksite's address as a place, from place (owner worksite.address)",
    },
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
      photo_url: "the list size of photo_document_id, as an API path (shared/db/person.js)",
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
