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
    // The company's own documents sit under Company, the Document Centre's place on the rail (after Mailbox).
    expect(areas.map((a) => a.label)).toEqual(["Company", "People", "Queries & Sanctions", "Recruitment", "Payroll", "Partnerships", "Expenses", "Knowledge Hub"]);
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
  test("reads need the documents view grant; company writes their own action; categories documents.manage too", () => {
    const rs = routesOf(routes.router);
    const by = Object.fromEntries(rs.map((r) => [`${r.method} ${r.path}`, [r.permission.key, r.permission.action, r.capability || null]]));
    expect(by).toEqual({
      "GET /documents": ["documents", "view", null],
      "GET /documents/summary": ["documents", "view", null],
      "GET /documents/:id": ["documents", "view", null],
      "GET /filters": ["documents", "view", null],
      "POST /documents": ["documents", "create", null],
      "PATCH /documents/:id": ["documents", "edit", null],
      "POST /documents/:id/versions": ["documents", "edit", null],
      "POST /documents/:id/archive": ["documents", "delete", null],
      "POST /documents/:id/restore": ["documents", "delete", null],
      "GET /categories": ["documents", "view", null],
      "GET /categories/:id": ["documents", "view", null],
      "POST /categories": ["documents", "edit", "documents.manage"],
      "PATCH /categories/:id": ["documents", "edit", "documents.manage"],
      "POST /categories/:id/archive": ["documents", "edit", "documents.manage"],
      "POST /categories/:id/restore": ["documents", "edit", "documents.manage"],
      "GET /tags": ["documents", "view", null],
      "POST /letterhead": ["documents", "view", null],
    });
  });
});

describe("company documents", () => {
  const access = require("./library.access");

  test("a keeper of the library reads every company document; nobody without a user id reads any", () => {
    expect(access.readable({ all: true }, [])).toBe("TRUE");
    expect(access.readable(null, [])).toBe("FALSE");
    expect(access.readable({ all: false, view: true, user_id: null, role_ids: [] }, [])).toBe("FALSE");
  });

  test("the uploader reads their own; the documents grant adds a category's audience; an archived one is the keepers' alone", () => {
    const own = [];
    const sql = access.readable({ all: false, view: false, user_id: "u-1", role_ids: ["r-1"] }, own);
    expect(own).toEqual(["u-1"]);
    expect(sql).toContain("cd.archived_at IS NULL");
    expect(sql).not.toContain("audience");
    const seen = [];
    expect(access.readable({ all: false, view: true, user_id: "u-1", role_ids: ["r-1"] }, seen)).toContain("dc.audience = 'everyone'");
    expect(seen).toEqual(["u-1", ["r-1"]]);
  });

  test("the expiry reminder tells 60, 30 and 7 days ahead and on the day", () => {
    expect(service.AHEAD).toEqual([60, 30, 7, 0]);
  });

  test("the text of a Word file is its paragraphs, in order", async () => {
    const { buildDocx } = require("../../shared/documents/docx");
    const text = require("./library.text");
    const file = await buildDocx({ title: "Service Agreement", body: "Chowdeck agrees.\n\tDelivery in Lekki & Ikeja." });
    expect(await text.wordText(file)).toBe("Service Agreement\nChowdeck agrees.\n Delivery in Lekki & Ikeja.");
    expect(text.isLibraryType("company_document")).toBe(true);
    expect(text.isLibraryType("community_media")).toBe(false);
  });

  test("the Word letterhead carries its header, its picture and its footer on every page", async () => {
    const JSZip = require("jszip");
    const { buildDocx } = require("../../shared/documents/docx");
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    const zip = await JSZip.loadAsync(
      await buildDocx({ header: { picture: { buffer: png, width: 120, height: 40 }, text: "MyCity", rule: "FFDF55" }, footer: "MyCity App Ltd · Lagos" }),
    );
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["word/header1.xml", "word/footer1.xml", "word/media/logo.png", "word/_rels/header1.xml.rels"]));
    expect(await zip.file("word/header1.xml").async("string")).toContain('w:color="FFDF55"');
    expect(await zip.file("word/footer1.xml").async("string")).toContain("MyCity App Ltd · Lagos");
    expect(await zip.file("word/document.xml").async("string")).toContain('<w:headerReference w:type="default" r:id="rIdHeader"/>');
  });
});
