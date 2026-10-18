"use strict";
/**
 * Middleware in isolation: rbac scope rules and capabilities, record scope SQL, idempotency,
 * the error envelope for database errors, and upload limits.
 */
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../../../src/config/db", () => ({ pool: { query: jest.fn() }, query: jest.fn() }));
jest.mock("../../../src/shared/rbac/grants-cache", () => ({
  getAuthUser: jest.fn(),
  getGrants: jest.fn(),
  getTeamEmployeeIds: jest.fn(),
  getCapabilities: jest.fn(),
}));

const { pool } = require("../../../src/config/db");
const grants = require("../../../src/shared/rbac/grants-cache");
const { config } = require("../../../src/config/env");
const { requirePermission, requireAnyPermission, requireCapability, requireAnyCapability, readPermissions } = require("../../../src/middleware/rbac");
const { scopeClause, assertInScope } = require("../../../src/shared/rbac/scope");
const { idempotency } = require("../../../src/middleware/idempotency");
const { errorHandler } = require("../../../src/middleware/error-handler");
const upload = require("../../../src/middleware/upload");
require("../../../src/middleware/async-safe");

const EMP = "22222222-2222-4222-8222-222222222222";

async function runMw(mw, user) {
  const req = { user };
  let error = null;
  await mw(req, {}, (e) => { error = e || null; }).catch((e) => { error = e; });
  return { req, error };
}

beforeEach(() => jest.clearAllMocks());

describe("rbac", () => {
  const staff = { user_id: "u1", employee_id: EMP, role_ids: ["r1", "r2"], is_ceo: false };

  test("the widest scope across roles wins", async () => {
    grants.getGrants.mockResolvedValue([{ can_view: true, scope: "own" }, { can_view: true, scope: "all" }]);
    const { req } = await runMw(requirePermission("people", "view"), staff);
    expect(req.scope).toBe("all");
    expect(req.scope_ids).toBeNull();
  });

  test("a role that does not grant the action does not lend its scope", async () => {
    grants.getGrants.mockResolvedValue([{ can_view: false, scope: "all" }, { can_view: true, scope: "own" }]);
    const { req } = await runMw(requirePermission("people", "view"), staff);
    expect(req.scope).toBe("own");
    expect(req.scope_ids).toEqual([EMP]);
  });

  test("team scope resolves to the reporting tree", async () => {
    grants.getGrants.mockResolvedValue([{ can_edit: true, scope: "team" }]);
    grants.getTeamEmployeeIds.mockResolvedValue([EMP, "e2"]);
    const { req } = await runMw(requirePermission("performance", "edit"), staff);
    expect(req.scope_ids).toEqual([EMP, "e2"]);
    expect(req.permission).toEqual({ key: "performance", action: "edit" });
  });

  test("ESS is own scope whatever the grant says, even for the CEO", async () => {
    grants.getGrants.mockResolvedValue([{ can_view: true, scope: "all" }]);
    expect((await runMw(requirePermission("ess", "view"), staff)).req.scope).toBe("own");
    expect((await runMw(requirePermission("ess", "view"), { ...staff, is_ceo: true })).req.scope).toBe("own");
  });

  test("no grant is a 403", async () => {
    grants.getGrants.mockResolvedValue([]);
    const { error } = await runMw(requirePermission("payroll", "approve"), staff);
    expect(error).toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
  });

  test("a truthy but non-boolean is_ceo is not the CEO", async () => {
    grants.getGrants.mockResolvedValue([]);
    const { error } = await runMw(requirePermission("payroll", "view"), { ...staff, is_ceo: "yes" });
    expect(error).toMatchObject({ status: 403 });
  });

  test("any-of takes the widest grant held", async () => {
    grants.getGrants.mockImplementation(async ({ module }) =>
      module === "people" ? [{ can_view: true, scope: "own" }] : [{ can_view: true, scope: "team" }]);
    grants.getTeamEmployeeIds.mockResolvedValue([EMP]);
    const { req } = await runMw(requireAnyPermission([["people", "view"], ["performance", "view"]]), staff);
    expect(req.scope).toBe("team");
  });

  test("capabilities are checked on the user, CEO excepted", async () => {
    grants.getCapabilities.mockResolvedValue(["alerts.clear"]);
    expect((await runMw(requireCapability("home.team"), staff)).error).toMatchObject({ code: "CAPABILITY_REQUIRED", status: 403 });
    expect((await runMw(requireCapability("alerts.clear"), staff)).error).toBeNull();
    expect((await runMw(requireCapability("home.team"), { ...staff, is_ceo: true })).error).toBeNull();
    expect(grants.getCapabilities).toHaveBeenCalledTimes(2);
  });

  test("any-of passes on one capability held, and refuses none", async () => {
    const either = requireAnyCapability(["alerts.clear", "alerts.manage"]);
    grants.getCapabilities.mockResolvedValue(["alerts.manage"]);
    expect((await runMw(either, staff)).error).toBeNull();
    grants.getCapabilities.mockResolvedValue(["home.team"]);
    expect((await runMw(either, staff)).error).toMatchObject({ code: "CAPABILITY_REQUIRED", status: 403 });
    grants.getCapabilities.mockClear();
    expect((await runMw(either, { ...staff, is_ceo: true })).error).toBeNull();
    expect(grants.getCapabilities).not.toHaveBeenCalled();
  });

  test("a capability check sets no scope: the permission check before it does", async () => {
    grants.getCapabilities.mockResolvedValue(["home.team"]);
    const { req } = await runMw(requireCapability("home.team"), staff);
    expect(req.scope).toBeUndefined();
    expect(req.permission).toBeUndefined();
  });

  test("a code outside the catalogue is refused when the route is defined, not at the first request", () => {
    expect(() => requireCapability("home.teams")).toThrow(/"home\.teams" is not a capability/);
    expect(() => requireCapability()).toThrow(/is not a capability/);
    expect(() => requireAnyCapability(["alerts.clear", "alerts.delete"])).toThrow(/"alerts\.delete" is not a capability/);
    expect(() => requireAnyCapability([])).toThrow(/give capability codes/);
    expect(() => requireAnyCapability("alerts.clear")).toThrow(/give capability codes/);
  });

  test("each check carries its code, for route() and the gates to read", () => {
    expect(requireCapability("home.reports").capability).toBe("home.reports");
    const codes = ["alerts.clear", "alerts.manage"];
    const mw = requireAnyCapability(codes);
    expect(mw.capabilities).toEqual(codes);
    codes.push("home.team");
    expect(mw.capabilities).toEqual(["alerts.clear", "alerts.manage"]);
    expect(requireCapability("home.reports").permission).toBeUndefined();
  });

  test("readPermissions answers without throwing", async () => {
    grants.getGrants.mockResolvedValue([{ can_export: true, scope: "all" }]);
    expect(await readPermissions({ user: staff }, [["people", "export"], ["people", "delete"], ["nope", "view"]]))
      .toEqual([true, false, false]);
  });
});

describe("record scope SQL", () => {
  test("all adds nothing; team and own add one parameter", () => {
    const p1 = [];
    expect(scopeClause({ scope: "all", scope_ids: null }, { column: "e.employee_id" }, p1)).toEqual({ and: "", where: "" });
    expect(p1).toEqual([]);
    const p2 = ["x"];
    expect(scopeClause({ scope: "team", scope_ids: [EMP] }, { column: "e.employee_id" }, p2).and)
      .toBe("AND e.employee_id = ANY($2::uuid[])");
    expect(p2[1]).toEqual([EMP]);
  });

  test("a record outside scope is a 404, not a 403", () => {
    expect(() => assertInScope({ scope: "own", scope_ids: [EMP] }, "other")).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => assertInScope({ scope: "own", scope_ids: [EMP] }, null)).toThrow();
    expect(() => assertInScope({ scope: "all", scope_ids: null }, "anyone")).not.toThrow();
  });
});

describe("idempotency", () => {
  const tok = jwt.sign({ sub: "u1", sid: "s1", typ: "access" }, config.JWT_ACCESS_SECRET);
  let created;
  function app() {
    const a = express();
    a.use(express.json());
    a.use(idempotency);
    a.post("/x", (_req, res) => {
      created += 1;
      res.status(201).json({ id: created });
    });
    a.use(errorHandler);
    return a;
  }
  beforeEach(() => { created = 0; });

  test("first request claims, runs and records its response", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ key: "k" }] }).mockResolvedValue({ rows: [] });
    const res = await request(app()).post("/x").set("Authorization", `Bearer ${tok}`).set("Idempotency-Key", "key-00000001").send({ a: 1 });
    expect(res.status).toBe(201);
    expect(created).toBe(1);
    const update = pool.query.mock.calls.find(([sql]) => /UPDATE idempotency_key/.test(sql));
    expect(update[1]).toEqual(["key-00000001", 201, JSON.stringify({ id: 1 })]);
  });

  test("a replay returns the stored response and does no work", async () => {
    const { hashRequest } = require("../../../src/middleware/idempotency");
    const hash = hashRequest("u1", "POST", "/x", { a: 1 });
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ state: "completed", status_code: 201, response_body: { id: 7 }, request_hash: hash }],
    });
    const res = await request(app()).post("/x").set("Authorization", `Bearer ${tok}`).set("Idempotency-Key", "key-00000001").send({ a: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 7 });
    expect(res.headers["idempotency-replayed"]).toBe("true");
    expect(created).toBe(0);
  });

  test("the same key for a different body is refused", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ state: "completed", status_code: 201, response_body: {}, request_hash: "other" }],
    });
    const res = await request(app()).post("/x").set("Authorization", `Bearer ${tok}`).set("Idempotency-Key", "key-00000001").send({ a: 2 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  test("still running is a 409 with Retry-After", async () => {
    const { hashRequest } = require("../../../src/middleware/idempotency");
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ state: "in_flight", request_hash: hashRequest("u1", "POST", "/x", {}) }],
    });
    const res = await request(app()).post("/x").set("Authorization", `Bearer ${tok}`).set("Idempotency-Key", "key-00000001").send({});
    expect(res.status).toBe(409);
    expect(res.headers["retry-after"]).toBe("2");
  });

  test("no valid token: nothing is claimed and the request passes through", async () => {
    const res = await request(app()).post("/x").set("Idempotency-Key", "key-00000001").send({});
    expect(res.status).toBe(201);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("the table being unavailable never blocks the write", async () => {
    pool.query.mockRejectedValue(new Error("relation does not exist"));
    const res = await request(app()).post("/x").set("Authorization", `Bearer ${tok}`).set("Idempotency-Key", "key-00000001").send({});
    expect(res.status).toBe(201);
  });
});

describe("error envelope for database errors", () => {
  function appThrowing(err) {
    const a = express();
    a.use(require("../../../src/middleware/request-id").requestId);
    a.get("/", () => { throw err; });
    a.use(errorHandler);
    return a;
  }

  test("a unique violation is a 409 and the row values never leave", async () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "employee_work_email_key"'), {
      code: "23505", detail: "Key (work_email)=(ada@mycity.io) already exists.", constraint: "employee_work_email_key",
    });
    const res = await request(appThrowing(err)).get("/");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_EXISTS");
    expect(JSON.stringify(res.body)).not.toMatch(/ada@mycity\.io|work_email_key|duplicate key/);
  });

  test("anything unknown is a generic 500 with a reference, and no message or stack", async () => {
    const res = await request(appThrowing(new Error("SELECT * FROM secret_table failed"))).get("/");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/secret_table/);
    expect(res.body.error.reference).toBe(res.headers["x-request-id"]);
  });
});

describe("upload", () => {
  function app(mw) {
    const a = express();
    a.post("/", mw, (req, res) => res.json({ got: upload.readUpload(req) ? upload.readUpload(req).size : null }));
    a.use(errorHandler);
    return a;
  }

  test("a file over the purpose's cap is a 413 that says the limit", async () => {
    const res = await request(app(upload.single("file", { purpose: "avatar" })))
      .post("/").attach("file", Buffer.alloc(6 * 1024 * 1024), "big.png");
    expect(res.status).toBe(413);
    expect(res.body.error.message).toMatch(/5 MB/);
  });

  test("a required file that is missing is a 422 on the field", async () => {
    const res = await request(app(upload.single("file", { purpose: "document" }))).post("/").field("x", "1");
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({ file: ["is required"] });
  });

  test("a file within the cap arrives in memory", async () => {
    const res = await request(app(upload.single("file", { purpose: "document" })))
      .post("/").attach("file", Buffer.from("%PDF-1.7 test"), "a.pdf");
    expect(res.body.got).toBe(13);
  });

  test("an unknown purpose fails when the route is defined", () => {
    expect(() => upload.single("file", { purpose: "spreadsheet" })).toThrow(/unknown purpose/);
  });
});
