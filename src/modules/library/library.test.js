"use strict";
/**
 * The Document Centre's Library: the rules that need no database (docs/guides/document-centre.md
 * §6.2, §6.3). The proof that the list never shows what the vault refuses, on the real schema and
 * for every role, is tests/integration/library-access.test.js.
 */
const fs = require("node:fs");
const path = require("node:path");
const library = require("../../shared/documents/library");
const docTypes = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const service = require("./library.service");
const repo = require("./library.repo");
const routes = require("./library.routes");
const { routesOf } = require("../../http/route");

// Every module registers its document types and its vault rules where it declares its events.
const MODULES = path.resolve(__dirname, "..");
for (const m of fs.readdirSync(MODULES)) {
  for (const f of fs.readdirSync(path.join(MODULES, m))) if (f.endsWith(".events.js")) require(path.join(MODULES, m, f));
}

describe("the sources", () => {
  test("every registered document type is listed by a source or named as left out, never forgotten", () => {
    expect(library.unaccounted()).toEqual([]);
  });

  test("nothing kept a day or a request is ever a library type, and nothing left out is also listed", () => {
    const listed = library.sources().flatMap((s) => s.doc_types);
    for (const t of listed) {
      const type = docTypes.typeOf(t);
      expect([t, type.export, type.transient]).toEqual([t, false, false]);
      expect(Object.keys(library.NOT_IN_LIBRARY)).not.toContain(t);
    }
    expect(listed).not.toContain("payslip");
    // A name in NOT_IN_LIBRARY is a real type: a stale line is taken off, not left to mislead.
    for (const t of Object.keys(library.NOT_IN_LIBRARY)) expect([t, Boolean(docTypes.typeOf(t))]).toEqual([t, true]);
  });

  test("a source's rule is the vault's kind: default where the vault has none of its own, its own where it has", () => {
    for (const s of library.sources()) for (const e of s.entities) expect([s.file, e, vault.hasAccess(e)]).toEqual([s.file, e, !s.default]);
  });

  test("a source is refused when it names what is not a type, what is left out, or two rules at once", () => {
    const ok = { area: "people", types: { employee_document: "Employee Document" }, entity: "employee", default: true };
    expect(() => library.librarySource({ ...ok, area: "nowhere" })).toThrow(/module key/);
    expect(() => library.librarySource({ ...ok, types: { made_up_type: "Made Up" } })).toThrow(/not a registered document type/);
    expect(() => library.librarySource({ ...ok, types: { payslip: "Payslip" } })).toThrow(/NOT_IN_LIBRARY/);
    expect(() => library.librarySource({ ...ok, types: { audit_export: "Audit Export" } })).toThrow(/never listed/);
    expect(() => library.librarySource({ ...ok, entity: undefined })).toThrow(/entity/);
    expect(() => library.librarySource({ ...ok, readable: () => "TRUE" })).toThrow(/default: true, or reach and readable/);
    expect(() => library.librarySource({ ...ok, default: undefined })).toThrow(/default: true, or reach and readable/);
    expect(() => library.librarySource({ ...ok, record: { type: "'employee'" } })).toThrow(/record\.id/);
  });
});

describe("who sees a row", () => {
  const reachOf = (user, modules = {}) => {
    const own = new Map();
    for (const s of library.sources()) if (!s.default) own.set(s, null);
    return { user: { user_id: "u-1", employee_id: "e-1", is_ceo: false, ...user }, modules: new Map(Object.entries(modules)), own };
  };

  test("a reader with no grant at all still reads what is about them and what they uploaded, and nothing more", () => {
    const params = [];
    const { sql } = library.readable(reachOf({}), params);
    expect(params).toEqual(["e-1", "u-1"]);
    expect(sql).toContain("d.subject_employee_id = $1::uuid OR d.uploaded_by = $2::uuid");
    expect(sql).not.toContain("TRUE");
  });

  test("a view grant over a team binds the team; without edit a restricted file stays shut", () => {
    const params = [];
    const { sql } = library.readable(reachOf({}, { people: { view: "team", edit: false, team: ["e-1", "e-2"] } }), params);
    expect(params).toContainEqual(["e-1", "e-2"]);
    expect(sql).toMatch(/\(d\.sensitivity <> 'restricted' AND d\.subject_employee_id = ANY\(\$3::uuid\[\]\)\)/);
    const open = [];
    expect(library.readable(reachOf({}, { people: { view: "all", edit: true, team: null } }), open).sql).toMatch(/d\.uploaded_by = \$2::uuid OR TRUE\)/);
  });

  test("every source's SQL sits behind its own types and entities, so no cast meets another type's row", () => {
    const { sql, sources } = library.readable(reachOf({ is_ceo: true }), []);
    expect(sql.startsWith(library.BASE)).toBe(true);
    // The CEO reaches every default source; a source with its own rule answers through its own reach.
    expect(sources.every((s) => s.default)).toBe(true);
    for (const s of sources) expect(sql).toContain(`WHEN d.doc_type = ANY(ARRAY['${s.doc_types.join("', '")}']::text[]) AND d.entity_type = ANY(ARRAY['${s.entities.join("', '")}']::text[]) THEN`);
    expect(sql.endsWith("ELSE FALSE END)")).toBe(true);
  });

  test("a reader who has no user id reaches nothing through a source that asks for one", () => {
    const training = library.sources().find((s) => s.doc_types.includes("training_certificate"));
    expect(training.readable({ all: false, employee_id: null }, [])).toBe("FALSE");
    expect(training.readable({ all: true, employee_id: null }, [])).toBe("TRUE");
    const mine = [];
    expect(training.readable({ all: false, employee_id: "e-9" }, mine)).toBe("d.subject_employee_id = $1::uuid");
    expect(mine).toEqual(["e-9"]);
  });
});

describe("what a row shows", () => {
  test("the filters' options follow the rail's order, each type under its area", () => {
    const { areas, types } = library.options();
    expect(areas.map((a) => a.label)).toEqual(["People", "Queries & Sanctions", "Recruitment", "Payroll", "Partnerships", "Expenses", "Knowledge Hub"]);
    expect(types.find((t) => t.doc_type === "partner_document")).toEqual({ doc_type: "partner_document", label: "Partner Document", area: "partnerships" });
    for (const t of types) expect(t.label).toMatch(/^[A-Z]/);
  });

  test("a type's name is its source's finer kind where it gives one, else the type's own", () => {
    const c = library.columns();
    expect(c.type_label).toContain("COALESCE(");
    expect(c.type_label).toContain("WHEN 'query_letter' THEN 'Query Letter'");
    expect(c.area_label).toContain("WHEN 'expense_invoice' THEN 'Expenses'");
    expect(c.expires_on).toContain("d.expires_on");
  });
});

describe("the list", () => {
  test("Added reads from Lagos's month, year and the last 90 days", () => {
    expect(service.sinceOf(undefined)).toBeNull();
    expect(service.sinceOf("this_month", "2026-11-16").toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(service.sinceOf("this_year", "2026-11-16").toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(service.sinceOf("last_90_days", "2026-11-16").toISOString()).toBe("2026-08-17T23:00:00.000Z");
  });

  test("sorts are the contract's three, each to a column of the row", () => {
    expect(Object.keys(repo.SORTS)).toEqual(["created_at", "title", "expires_on"]);
  });
});

describe("routes", () => {
  test("every route needs the documents view grant, and none writes", () => {
    const rs = routesOf(routes.router);
    expect(rs.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /documents", "GET /documents/summary", "GET /documents/:id", "GET /filters"]);
    for (const r of rs) expect([r.path, r.permission.key, r.permission.action]).toEqual([r.path, "documents", "view"]);
  });
});
