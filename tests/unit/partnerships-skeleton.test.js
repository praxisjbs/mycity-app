"use strict";
/**
 * M7's scaffolding (docs/guides/partnerships.md Appendix A, PR 1): the seven Partnerships modules are
 * mounted on the staff surface at /api/v1/partnerships, and every route any of them defines is held
 * to the `partnerships` permission key; the four place owners are registered with their renames; the
 * numbering, the approval and the capabilities the guide names exist in the code.
 */
const path = require("node:path");
const { routesOf } = require("../../src/http/route");
const owners = require("../../src/shared/places/owners");
const { SCHEMES, validateScheme } = require("../../src/shared/numbering/schemes");
const definitions = require("../../src/shared/workflow/definitions");
const catalog = require("../../src/shared/access/access.catalog");
const routeMap = require("../../src/shared/route-map");

const MODULES = ["partners", "partner_pipeline", "leads", "interactions", "proposals", "agreements", "partnership_analytics"];
const routesFile = (m) => require(path.join(__dirname, "../../src/modules", m, `${m}.routes.js`));

describe("the Partnerships modules", () => {
  test.each(MODULES)("%s is mounted on /partnerships, on the staff surface", (m) => {
    const def = routesFile(m);
    expect(def.basePath).toBe("/partnerships");
    expect(def.surface).toBe("staff");
    expect(typeof def.router).toBe("function");
  });

  test.each(MODULES)("every route %s defines asks for the partnerships key", (m) => {
    for (const r of routesOf(routesFile(m).router)) {
      expect([r.method, r.path, r.permission && r.permission.key]).toEqual([r.method, r.path, "partnerships"]);
    }
  });

  test("Categories is the second tab, after Pipeline, as the shell and ⌘K have it", () => {
    expect(routeMap.SCREENS.partnerships).toEqual(["pipeline", "categories", "partners", "leads", "proposals", "contracts-and-mous", "analytics"]);
  });
});

describe("what PR 1 puts in the code", () => {
  test("the four address fields are owners, each with its rename, none personal", () => {
    require("../../src/modules/partners/partners.events");
    require("../../src/modules/leads/leads.events");
    require("../../src/modules/partner_pipeline/partner_pipeline.events");
    const mine = owners.OWNERS.filter((o) => ["partners", "leads", "partner_pipeline"].includes(o.module));
    expect(mine.map((o) => [o.name, o.level, o.personal])).toEqual([
      ["partner.headquarters", "area", false],
      ["partner.cities", "city", false],
      ["lead.cities", "city", false],
      ["deal.venue", "address", false],
    ]);
    for (const o of mine) expect(typeof owners.renameOf(o.name)).toBe("function");
  });

  test("a partner, lead, deal, proposal and agreement are numbered as §4.3 has them; an MOU is an agreement", () => {
    const shape = (t) => `${SCHEMES[t].prefix}${SCHEMES[t].separator}${SCHEMES[t].include_period ? "YYYY-" : ""}${"0".repeat(SCHEMES[t].padding)}`;
    expect(["partner", "lead", "deal", "proposal", "agreement"].map(shape)).toEqual(["PAR-0000", "LED-0000", "DEAL-YYYY-0000", "PRO-0000", "AGR-YYYY-0000"]);
    expect(SCHEMES.deal.reset).toBe("yearly");
    expect(SCHEMES.agreement.reset).toBe("yearly");
    expect(SCHEMES.mou).toBeUndefined();
    for (const t of ["partner", "lead", "deal", "agreement"]) expect(validateScheme(SCHEMES[t])).toEqual([]);
  });

  test("the agreement approval is the Head of Department of the owner's department, then the CEO", () => {
    const def = definitions.DEFAULTS["partnership.agreement"];
    expect(definitions.problemsOf(def)).toEqual([]);
    expect(def.stages.map((s) => [s.key, s.approver, s.sla_hours])).toEqual([
      ["head_of_department", { type: "employee_in_context", value: "department_head_employee_id" }, 72],
      ["ceo", { type: "ceo" }, 72],
    ]);
  });

  test("the two capabilities are catalogued in partnerships, money held by General Management", () => {
    const codes = catalog.CAPABILITY_CATALOG.filter((x) => x.module === "partnerships").map((x) => x.code);
    expect(codes).toEqual(["partnerships.configure", "partnerships.money"]);
    expect(catalog.GENERAL_MANAGEMENT_CAPABILITIES).toContain("partnerships.money");
    expect(catalog.GENERAL_MANAGEMENT_CAPABILITIES).not.toContain("partnerships.configure");
  });
});
