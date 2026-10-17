"use strict";
/**
 * The documents module's rules that need no database: what a purpose means,
 * what an upload answers with, and the gates on every route. How a document is
 * read, versioned, verified and served runs against Postgres in
 * tests/integration/documents-api.test.js.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const { UPLOAD_CAPS } = require("../../shared/http/body-limits");
const docTypes = require("../../shared/documents/types");
const service = require("./documents.service");
const { EMPLOYEE_DOC_TYPES, STAGED_DOC_TYPE } = require("./documents.events");

describe("what a file is for", () => {
  test("a purpose the app does not have is refused, naming the field", () => {
    expect(() => service.purposeFor("anything")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_PURPOSE", status: 422 }),
    );
  });

  test("every purpose the contract offers has a size cap and a type list", () => {
    for (const purpose of c.documents.UploadPurpose.options) {
      expect(service.purposeFor(purpose)).toBe(purpose);
      expect(UPLOAD_CAPS[purpose]).toBeGreaterThan(0);
    }
  });

  test("a file with no purpose is a document", () => {
    expect(service.purposeFor(undefined)).toBe("document");
  });
});

describe("the document types this module stores under", () => {
  test("each is registered, and an employee's documents follow the People grant", () => {
    for (const type of EMPLOYEE_DOC_TYPES) {
      expect(docTypes.typeOf(type)).toMatchObject({ module: "people" });
    }
    expect(docTypes.typeOf(EMPLOYEE_DOC_TYPES[2])).toMatchObject({
      sensitivity: "restricted",
    });
  });

  test("a staged upload belongs to the person who sent it, not to People", () => {
    expect(docTypes.typeOf(STAGED_DOC_TYPE)).toMatchObject({
      module: "ess",
      sensitivity: "personal",
    });
  });

  test("none of them may be signed until a milestone says so", () => {
    for (const type of [...EMPLOYEE_DOC_TYPES, STAGED_DOC_TYPE]) {
      expect(docTypes.signatureCeiling(type)).toEqual({ signable: false, wet: false });
    }
  });
});

describe("what an upload answers with", () => {
  test("the id a record stores, and the tray's line", () => {
    expect(
      service.refOf({
        document_id: "d1",
        original_name: "Scan.pdf",
        bytes: "2048",
        mime: "application/pdf",
      }),
    ).toEqual({
      document_id: "d1",
      file_name: "Scan.pdf",
      size_bytes: 2048,
      mime_type: "application/pdf",
    });
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./documents.routes").router);
  const find = (method, path) =>
    routes.find((r) => r.method === method && r.path === path);

  test("an employee's documents are the People grant, within scope", () => {
    expect(find("GET", "/employees/:id/documents").permission).toEqual({
      key: "people",
      action: "view",
    });
    expect(find("POST", "/employees/:id/documents").permission).toEqual({
      key: "people",
      action: "edit",
    });
    expect(find("POST", "/employees/:id/document-requests").permission).toEqual({
      key: "people",
      action: "edit",
    });
  });

  test("reading a file is the vault's rule, so the route only asks for a session", () => {
    for (const path of ["/documents/:id", "/documents/:id/content", "/documents/:id/variant/:kind"]) {
      const route = find("GET", path);
      expect(route.permission).toBeNull();
      expect(route.contract.self).toBe(true);
    }
  });

  test("a route that streams bytes declares no JSON shape", () => {
    expect(find("GET", "/documents/:id/content").contract.no_content).toBe(true);
    expect(find("GET", "/documents/:id/variant/:kind").contract.no_content).toBe(true);
  });

  test("every write names a body from the contract", () => {
    for (const route of routes.filter((r) => ["post", "put", "patch"].includes(r.method))) {
      expect(route.contract.body).toBeDefined();
    }
  });
});
