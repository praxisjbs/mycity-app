"use strict";
/**
 * The organisation module's own reasoning, without a database: how a Name cell is split,
 * how a Line Manager cell is read, which columns of a sheet are worth importing, and what
 * the History tab says. The people here are invented.
 *
 * The rest of the module (the register, the 360, the tree, the importer and the roster
 * loader) is tested against the real schema in tests/integration/organisation.test.js.
 */
const fs = require("node:fs");
const path = require("node:path");
const managerText = require("./manager-text");
const service = require("./organisation.service");
const employee360 = require("./employee-360.service");
const engine = require("../../shared/import/engine");
const { FIELDS } = require("./employee.import");
const loader = require("../../../scripts/db/load-staff");

describe("a Name cell", () => {
  test("becomes a first, middle and last name", () => {
    expect(service.splitName("Ngozi Chiamaka Umeh")).toEqual({
      first_name: "Ngozi",
      middle_name: "Chiamaka",
      last_name: "Umeh",
    });
    expect(service.splitName("  Tariq   Bello ")).toEqual({
      first_name: "Tariq",
      middle_name: undefined,
      last_name: "Bello",
    });
  });

  test("a single word is both names, so a record is never half empty", () => {
    expect(service.splitName("Sade")).toEqual({
      first_name: "Sade",
      middle_name: undefined,
      last_name: "Sade",
    });
  });

  test("a title before the name is dropped, and capitals or small letters are put in name case", () => {
    expect(service.splitName("Engr. Tunde Bakare")).toEqual({ first_name: "Tunde", middle_name: undefined, last_name: "Bakare" });
    expect(service.cleanName("Mrs  ADA obi")).toBe("Ada Obi");
    expect(service.cleanName("TOBILOBA IYANUOLUWA DADA")).toBe("Tobiloba Iyanuoluwa Dada");
    expect(service.cleanName("shola-o'adido")).toBe("Shola-O'Adido");
    expect(service.cleanName("McCarthy Ojo")).toBe("McCarthy Ojo");
    /* A title alone is somebody's name, not a title to drop. */
    expect(service.cleanName("Chief")).toBe("Chief");
  });

  test("VACANT is a post, not a person", () => {
    expect(managerText.isVacantName("VACANT")).toBe(true);
    expect(managerText.isVacantName("vacant ")).toBe(true);
    expect(managerText.isVacantName("Ngozi Umeh")).toBe(false);
  });
});

describe("a Line Manager cell", () => {
  test("a name on its own", () => {
    const { primary, dotted } = managerText.parse("Ngozi Umeh");
    expect(primary.name).toBe("Ngozi Umeh");
    expect(dotted).toBeNull();
  });

  test("a name and the post beside it", () => {
    const { primary } = managerText.parse("Tariq - Head of Delivery");
    expect(primary.name).toBe("Tariq");
    expect(primary.title).toBe("Head of Delivery");
  });

  test("a post with a dotted line beside it", () => {
    const { primary, dotted } = managerText.parse(
      "Head of Trading, with dotted line to Head of Delivery",
    );
    expect(primary.text).toBe("Head of Trading");
    expect(dotted.text).toBe("Head of Delivery");
  });

  test("an empty cell asks for nothing", () => {
    expect(managerText.parse("   ")).toEqual({ primary: null, dotted: null });
  });
});

describe("a post named in a sheet's own words", () => {
  test("matches a longer title it names in full", () => {
    expect(managerText.matchesTitle("Head of Delivery", "Head of Delivery & Logistics")).toBe(true);
  });

  test("forgives one wrong letter in a long word", () => {
    expect(managerText.matchesTitle("Head Markerting", "Head Marketing")).toBe(true);
  });

  test("short forms of the C-suite are written out", () => {
    expect(managerText.matchesTitle("CEO", "Chief Executive Officer")).toBe(true);
    expect(managerText.matchesTitle("CTO", "Chief Technology Officer")).toBe(true);
  });

  test("one word on its own names nothing wider than itself", () => {
    expect(managerText.matchesTitle("Head", "Head of Delivery")).toBe(false);
  });

  test("a post it does not name is not a match", () => {
    expect(managerText.matchesTitle("Head of Trading", "Head of Delivery")).toBe(false);
    expect(managerText.matchesTitle("Head of Delivery", "Head")).toBe(false);
  });
});

describe("the columns of a sheet worth importing", () => {
  const importer = { fields: FIELDS };
  const grid = [
    ["Name", "Designation", "Team", "DOB", "Phone"],
    ["Ngozi Umeh", "Analyst", "Delivery", "12/12", "#0000000000"],
    ["Tariq Bello", "Analyst", "Delivery", "26/09", "#0000000000"],
  ];
  const mapping = {
    columns: [
      { index: 0, header: "Name", field: "full_name" },
      { index: 1, header: "Designation", field: "job_title" },
      { index: 2, header: "Team", field: "department" },
      { index: 3, header: "DOB", field: "date_of_birth" },
      { index: 4, header: "Phone", field: "phone" },
    ],
  };

  test("a column the whole sheet gets wrong is left out, with the reason", () => {
    const { fields, dropped } = loader.mappingFor(engine, importer, grid, 0, mapping);
    expect(fields).toEqual({ 0: "full_name", 1: "job_title", 2: "department", 3: null, 4: null });
    expect(dropped.map((d) => d.field).sort()).toEqual(["date_of_birth", "phone"]);
    expect(dropped[0].reason).toMatch(/every one of the 2 filled cells/);
  });

  test("a column with one good cell among bad ones is still imported", () => {
    const mixed = [grid[0], grid[1], ["Sade Akin", "Analyst", "Delivery", "03/07/1991", "08031234567"]];
    const { fields, dropped } = loader.mappingFor(engine, importer, mixed, 0, mapping);
    expect(fields[3]).toBe("date_of_birth");
    expect(fields[4]).toBe("phone");
    expect(dropped).toEqual([]);
  });
});

describe("the roles a post is given", () => {
  const roles = {
    default: { roles: ["employee"] },
    by_job_title: {
      "Chief Executive Officer": { roles: ["management"], is_ceo: true },
      "Head of Delivery": { roles: ["head_of_department"], work_email: "delivery@mycity.test" },
    },
  };

  test("by the post's own name", () => {
    expect(loader.rolesForTitle(roles, "Chief Executive Officer")).toEqual({
      roles: ["management"],
      is_ceo: true,
    });
  });

  test("by the exact title only, case and punctuation aside", () => {
    expect(loader.rolesForTitle(roles, "head of delivery").roles).toEqual(["head_of_department"]);
  });

  test("a title that only shares a post's words is staff, so nobody borrows a post's roles", () => {
    expect(loader.rolesForTitle(roles, "Deputy Head of Delivery").roles).toEqual(["employee"]);
    expect(loader.rolesForTitle(roles, "Executive Assistant to the Chief Executive Officer")).toEqual({ roles: ["employee"] });
  });

  test("anyone else is staff", () => {
    expect(loader.rolesForTitle(roles, "Analyst").roles).toEqual(["employee"]);
  });

  test("a work email is offered for a post whose sheet cell is empty", () => {
    expect(loader.emailsByJobTitle(roles)).toEqual({ "Head of Delivery": "delivery@mycity.test" });
  });
});

describe("a staff sheet's cells", () => {
  const field = (key) => FIELDS.find((f) => f.key === key);

  test("a staff number a spreadsheet read as a number gets its leading zeros back", () => {
    expect(engine.coerce(field("staff_number"), 19, { pad: 5 })).toEqual({ value: "00019", error: null });
    expect(engine.coerce(field("staff_number"), "T0019", { pad: 5 })).toEqual({ value: "T0019", error: null });
  });

  test("a phone number in a number cell, with or without 234, is read", () => {
    expect(engine.coerce(field("phone"), 8031234567).value).toBe("+2348031234567");
    expect(engine.coerce(field("phone"), 2348031234567).value).toBe("+2348031234567");
    expect(engine.coerce(field("phone"), "+234 (0) 803 123 4567").value).toBe("+2348031234567");
  });

  test("the other ways sheets write a choice are read, and only offered once", () => {
    expect(engine.coerce(field("work_pattern"), "WFH").value).toBe("remote");
    expect(engine.coerce(field("work_pattern"), "Onsite").value).toBe("on_site");
    expect(engine.coerce(field("employment_type"), "Contract").value).toBe("contractor");
    expect(engine.coerce(field("gender"), "F").value).toBe("female");
    const registry = require("../../shared/import/registry");
    expect(registry.optionsOf(field("employment_type")).map((o) => o.label)).toEqual(["Full Time", "Part Time", "Contractor", "Consultant", "Intern"]);
  });

  test("a year alone in a date column is not a date", () => {
    expect(engine.coerce(field("start_date"), 1991).error).toBe("is a number, not a date");
    expect(engine.coerce(field("start_date"), "1991").error).toBe("is a number, not a date");
  });

  test("a Name cell is tidied before it is compared, and VACANT stays VACANT", () => {
    expect(engine.coerce(field("full_name"), "Dr. NGOZI umeh").value).toBe("Ngozi Umeh");
    expect(engine.coerce(field("full_name"), "VACANT").value).toBe("VACANT");
  });

  test("for the roster, an unreadable optional cell is left out with a note, not the whole row", () => {
    const importer = require("../../shared/import/registry").get("employees") || { fields: FIELDS, matchKeys: ["staff_number", "work_email"], schema: require("@mycity/contract").organisation.EmployeeImportRow };
    const grid = [
      ["Name", "Designation", "Team", "Gender"],
      ["Ngozi Umeh", "Analyst", "Delivery", "N/A"],
    ];
    const columns = { columns: grid[0].map((header, index) => ({ index, header, field: ["full_name", "job_title", "department", "gender"][index] })) };
    const [byHand] = engine.buildRows(importer, grid, 0, columns);
    expect(byHand.status).toBe("error");
    const [roster] = engine.buildRows(importer, grid, 0, columns, { options: { skip_unreadable_optional: true } });
    expect(roster.status).toBe("ok");
    expect(roster.values).not.toHaveProperty("gender");
    expect(roster.problems[0].message).toMatch(/^Gender should be one of: .*; left out$/);
  });
});

describe("a sheet's columns, matched", () => {
  const mapping = require("../../shared/import/mapping");

  test("a column's own name wins over another column's alias, wherever they stand", () => {
    const { columns } = mapping.autoMap(["Title", "Name", "Designation", "Email", "Work Email", "ID"], FIELDS);
    expect(columns.map((c) => c.field)).toEqual([null, "full_name", "job_title", null, "work_email", null]);
  });

  test("an alias still maps a column nothing else claims", () => {
    const { columns } = mapping.autoMap(["Staff ID", "Full Name", "Position", "Team"], FIELDS);
    expect(columns.map((c) => c.field)).toEqual(["staff_number", "full_name", "job_title", "department"]);
  });
});

describe("the staff importer the register offers", () => {
  const modules = require("../../http/module-loader");
  const registry = require("../../shared/import/registry");

  test("the API registers it, so Import Staff has somewhere to go", () => {
    /* The imports API lists what the registry holds (B's Settings · Imports), and the
       worker runs the same files. If the API process did not load them, a staff sheet
       would have nowhere to go on a screen (docs/guides/foundation.md §1.1). */
    modules.loadImporters({ strict: true });
    expect(registry.all().map((i) => i.key)).toContain("employees");
    const employees = registry.get("employees");
    expect(employees.permission).toEqual(["people", "create"]);
    expect(employees.entity).toBe("employee");
    expect(employees.matchKeys).toEqual(["staff_number", "work_email"]);
    expect(employees.alsoEntities).toEqual(["org_seat"]);
    expect(typeof employees.isReferenced).toBe("function");
  });

  test("the deploy loads the roster on both environments, after the migrations", () => {
    const gate = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "deploy", "deploy-gate"), "utf8");
    const migrate = gate.slice(gate.indexOf("migrate() {"), gate.indexOf("# Switch, restart"));
    expect(migrate).toMatch(/scripts\/db\/migrate\.js/);
    expect(migrate).toMatch(/scripts\/db\/load-staff\.js/);
    expect(migrate.indexOf("migrate.js")).toBeLessThan(migrate.indexOf("load-staff.js"));
    /* migrate() is what both stage (staging) and promote (production) call. */
    expect(gate).toMatch(/migrate stg "\$sha"/);
    expect(gate).toMatch(/migrate prod "\$sha"/);
    /* A row the sheet gets wrong is a warning, never a stopped deploy. */
    expect(migrate).toMatch(/load-staff\.js\) \|\|\n?\s*say "warning/);
  });
});

describe("the History tab's line", () => {
  test("names what was done and which fields changed", () => {
    expect(
      employee360.summaryOf({ action: "employee.updated", changed_fields: ["job_title", "phone"] }),
    ).toBe("Record changed: job_title, phone");
    expect(employee360.summaryOf({ action: "employee.created", changed_fields: [] })).toBe(
      "Record created",
    );
    expect(
      employee360.summaryOf({ action: "employee.reporting_line_changed", changed_fields: [] }),
    ).toBe("Reporting line changed");
  });
});

describe("Download PDF's drawing", () => {
  const { layout, initialsOf } = require("./org-chart.layout");
  const { render } = require("../../shared/documents/render");
  const variables = require("../../shared/templates/variables");
  const store = require("../../shared/templates/template-store");
  require("./organisation.events");

  /** A node as the org chart read gives it. */
  const node = (id, manager, extra = {}) => ({
    node_id: id,
    node_kind: "employee",
    employee_id: id,
    org_seat_id: null,
    display_name: `Ada ${id}`,
    job_title: `Post ${id}`,
    department: "Delivery",
    manager_node_id: manager,
    dotted_manager_node_id: null,
    dotted_line_to: null,
    is_ceo: false,
    vacant: false,
    meta: null,
    ...extra,
  });
  const at = (drawing, name) => {
    const c = drawing.cards.find((k) => k.name === name);
    return c && [c.x, c.y];
  };

  test("draws the desktop's tree: each card over its branch, the CEO's tree first", () => {
    const drawing = layout([
      node("R", null),
      node("A", null, { is_ceo: true }),
      node("B", "A"),
      node("C", "A"),
      node("D", "B"),
      node("E", "B"),
    ]);
    expect(drawing.cards.map((c) => c.name)).toEqual(["Ada A", "Ada B", "Ada D", "Ada E", "Ada C", "Ada R"]);
    expect(at(drawing, "Ada A")).toEqual([53, 0]);
    expect(at(drawing, "Ada B")).toEqual([28, 50]);
    expect(at(drawing, "Ada D")).toEqual([3, 100]);
    expect(at(drawing, "Ada E")).toEqual([53, 100]);
    expect(at(drawing, "Ada C")).toEqual([103, 50]);
    expect(at(drawing, "Ada R")).toEqual([153, 0]);
    /* A line down from the CEO, one across to its two reports, and one down to each. */
    expect(drawing.lines).toEqual(
      expect.arrayContaining([
        { x: 75, y: 38, w: 0, h: 6, across: false },
        { x: 50, y: 44, w: 75, h: 0, across: true },
        { x: 50, y: 44, w: 0, h: 6, across: false },
        { x: 125, y: 44, w: 0, h: 6, across: false },
      ]),
    );
    expect(drawing.chart).toEqual({ width: 200, height: 138, scale: 1 });
    expect(drawing.page).toEqual({ width: 297, height: 238 });
  });

  test("five or more reports with nobody under them hang in two columns down a line", () => {
    const leaves = ["L1", "L2", "L3", "L4", "L5"].map((id) => node(id, "M"));
    const drawing = layout([node("M", null, { is_ceo: true }), ...leaves]);
    expect(at(drawing, "Ada M")).toEqual([28, 0]);
    expect(["L1", "L2", "L3", "L4", "L5"].map((id) => at(drawing, `Ada ${id}`))).toEqual([
      [3, 50],
      [53, 50],
      [3, 92],
      [53, 92],
      [3, 134],
    ]);
    expect(drawing.lines).toEqual(
      expect.arrayContaining([
        { x: 50, y: 38, w: 0, h: 115, across: false },
        { x: 47, y: 69, w: 3, h: 0, across: true },
        { x: 50, y: 69, w: 3, h: 0, across: true },
        { x: 47, y: 153, w: 3, h: 0, across: true },
      ]),
    );
    expect(drawing.chart).toEqual({ width: 100, height: 172, scale: 1 });

    /* Four stay in a row, and so do five when one of them has a report of their own. */
    expect(layout([node("M", null), ...leaves.slice(0, 4)]).chart.width).toBe(200);
    expect(layout([node("M", null), ...leaves, node("X", "L5")]).chart.width).toBe(250);
  });

  test("a card says what the screen's does: initials, title, department, dotted line, an open role", () => {
    const drawing = layout([
      node("A", null, { display_name: "Ifeoma Mbonu", is_ceo: true, meta: "Since 2023 · Remote" }),
      node("S", "A", { node_kind: "seat", employee_id: null, display_name: "Head of Finance", department: "Finance", vacant: true }),
      node("B", "A", { display_name: "Rabi'a Zawiya", dotted_line_to: "Ifeoma Mbonu" }),
    ]);
    expect(drawing.cards).toEqual([
      expect.objectContaining({ initials: "IM", title: "Post A", ceo: true, meta: "Since 2023 · Remote", vacant: false }),
      expect.objectContaining({ initials: "", name: "Head of Finance", title: "Vacant · Finance", vacant: true, ceo: false }),
      expect.objectContaining({ initials: "RZ", dotted: "Ifeoma Mbonu", meta: null }),
    ]);
    expect(initialsOf("Sade")).toBe("S");
    expect(initialsOf("  Tobiloba Iyanuoluwa Dada ")).toBe("TD");
  });

  test("a chart wider or taller than a PDF page allows is drawn smaller", () => {
    const wide = layout(["A", "B", "C", "D"].map((id) => node(id, null)), { maxSide: 100 });
    expect(wide.chart).toEqual({ width: 200, height: 38, scale: 0.5 });
    expect(wide.page.width).toBe(297);
    /* Five hung under one card make it 172 mm tall: 100 / 172, to three places, rounded down. */
    const tall = layout([node("M", null), ...["L1", "L2", "L3", "L4", "L5"].map((id) => node(id, "M"))], { maxSide: 100 });
    expect(tall.chart).toEqual({ width: 100, height: 172, scale: 0.581 });
  });

  test("the template names only its declared variables and places every card and line", () => {
    const t = store.shipped("document", "org-chart");
    expect(() => variables.assertTemplate("document", "org-chart", t.body)).not.toThrow();
    const drawing = layout([node("A", null, { is_ceo: true }), node("B", "A", { dotted_line_to: "Ada A" })]);
    const data = variables.parseData("document", "org-chart", { ...drawing, seats: 2, filled: 2, open: 0 });
    const html = render(t.body, data);
    expect(html).toContain("size: 297mm 210mm");
    expect(html).toContain("left: 3mm; top: 0mm;");
    expect(html).toContain("left: 3mm; top: 50mm;");
    expect(html).toContain("Dotted line · Ada A");
    expect(html).toMatch(/<strong>2 seats<\/strong> · 2 filled · 0 open/);
  });
});
