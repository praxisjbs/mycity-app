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

  test("by the words the post uses, so a typo in the sheet still lands", () => {
    expect(loader.rolesForTitle(roles, "Head of Delivry").roles).toEqual(["head_of_department"]);
  });

  test("anyone else is staff", () => {
    expect(loader.rolesForTitle(roles, "Analyst").roles).toEqual(["employee"]);
  });

  test("a work email is offered for a post whose sheet cell is empty", () => {
    expect(loader.emailsByJobTitle(roles)).toEqual({ "Head of Delivery": "delivery@mycity.test" });
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
