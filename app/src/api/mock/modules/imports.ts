import { at, fail, ok, paged, route, sid } from "../core";

/**
 * Settings · Imports on the in-browser mock (laptops and CI only, F12 to F14).
 *
 * The reads answer with the contract's shapes so the history and the wizard's
 * first step draw as they do live. The wizard itself cannot run here: a sheet
 * is multipart, and the mock holds no bytes, so uploading says so instead of
 * pretending to import something.
 */

const IMPORTERS = [
  {
    key: "employees",
    label: "Employees",
    entity: "employee",
    permission: "people.create",
    match_keys: ["staff_number", "work_email"],
    fields: [
      { key: "staff_number", label: "Staff Number", type: "text", required: false, aliases: ["staff id", "staff no", "employee id", "employee number"], options: [], ref: null, pass: 1, create_missing: false, masked: false, example: "00019", hint: "Left empty, the system issues the next one" },
      { key: "full_name", label: "Name", type: "text", required: true, aliases: ["full name", "staff name"], options: [], ref: null, pass: 1, create_missing: false, masked: false, example: "Tobiloba Iyanuoluwa Dada", hint: "VACANT marks a post nobody holds yet" },
      { key: "job_title", label: "Designation", type: "text", required: true, aliases: ["job title", "role", "position", "title"], options: [], ref: null, pass: 1, create_missing: false, masked: false, example: "Content & Listing Associate", hint: null },
      { key: "department", label: "Department", type: "reference", required: true, aliases: ["team", "unit"], options: [], ref: "department", pass: 1, create_missing: true, masked: false, example: "Backend Operations", hint: null },
      { key: "work_email", label: "Work Email", type: "email", required: false, aliases: ["email"], options: [], ref: null, pass: 1, create_missing: false, masked: false, example: "name@mycityapp.io", hint: null },
      { key: "line_manager", label: "Line Manager", type: "reference", required: false, aliases: ["manager", "reports to"], options: [], ref: "employee", pass: 2, create_missing: false, masked: false, example: "Bode Oluwasanmi", hint: "A name, a post, or a post with a dotted line beside it" },
    ],
  },
];

const batch = (n: number, status: string, stats: Record<string, unknown>, file: string, days: number) => ({
  import_batch_id: sid(`imp:${n}`),
  number: `IMP-${String(n).padStart(4, "0")}`,
  importer_key: "employees",
  importer_label: "Employees",
  document_id: sid(`impdoc:${n}`),
  file_name: file,
  sheet: "Staff",
  header_row: 2,
  mapping: { columns: [] },
  options: {},
  status,
  stats,
  created_by_name: "Ngozi Umeh",
  created_at: at(days, "10:12"),
  previewed_at: at(days, "10:14"),
  committed_at: status === "committed" || status === "reverted" ? at(days, "10:18") : null,
  reverted_at: status === "reverted" ? at(days - 1, "09:40") : null,
});

const BATCHES = [
  batch(3, "previewed", { rows: 4, create: 2, update: 1, unchanged: 0, warning: 0, error: 1, duplicate: 0, missing: {} }, "New joiners October.xlsx", 1),
  batch(2, "reverted", { rows: 6, create: 6, update: 0, unchanged: 0, warning: 0, error: 0, duplicate: 0, missing: {} }, "Interns 2026.xlsx", 9),
  batch(1, "committed", { rows: 18, create: 18, update: 0, unchanged: 0, warning: 0, error: 0, duplicate: 0, missing: {} }, "Staff list.xlsx", 14),
];

route("GET /api/v1/imports/importers", () => ok({ importers: IMPORTERS }));

route("GET /api/v1/imports", (req) =>
  paged(BATCHES, req, {
    search: (b) => [b.number, b.file_name, b.importer_label],
    filters: {
      importer: (b, v) => b.importer_key === v,
      status: (b, v) => b.status === v,
    },
  }),
);

route("GET /api/v1/imports/:id", (req) => {
  const found = BATCHES.find((b) => b.import_batch_id === req.params.id);
  return found ? ok(found) : fail(404, "NOT_FOUND", "That import does not exist.");
});

route("GET /api/v1/imports/:id/rows", (req) =>
  paged(
    [
      {
        import_row_id: sid(`row:${req.params.id}:4`),
        row_number: 4,
        raw: { Name: "", Designation: "Trading Officer" },
        values: null,
        status: "error",
        problems: [{ field: "full_name", message: "Name is required" }],
        action: null,
        target_id: null,
        diff: null,
      },
      {
        import_row_id: sid(`row:${req.params.id}:6`),
        row_number: 6,
        raw: { Name: "Kemi Alabi", Designation: "Settlement Lead" },
        values: { full_name: "Kemi Alabi", job_title: "Settlement Lead" },
        status: "ok",
        problems: [],
        action: "update",
        target_id: sid("emp:kemi"),
        diff: { job_title: ["Trading Officer", "Settlement Lead"] },
      },
    ],
    req,
    {
      filters: {
        /* "problem" is the preview's list, as on the API: errors, duplicates and warnings;
           "change" is every row that changes a record already there. */
        status: (r, v) =>
          r.status === v ||
          (v === "problem" && ["error", "duplicate", "warning"].includes(r.status)) ||
          (v === "change" && r.action === "update" && r.status !== "error"),
      },
    },
  ),
);

route("POST /api/v1/imports/:id/revert", () =>
  fail(422, "MOCK_ONLY", "Importing works once the API is connected."),
);
