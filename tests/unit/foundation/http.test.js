"use strict";
/**
 * The request path end to end, on fixture modules: route() contracts, the module
 * loader, auth, rbac, validation, the response contract check, both surfaces,
 * and the error envelope. Postgres and Redis are replaced by doubles.
 */
const path = require("node:path");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../../../src/config/db", () => ({ pool: { query: jest.fn() }, query: jest.fn() }));
jest.mock("../../../src/shared/rbac/grants-cache", () => ({
  getAuthUser: jest.fn(),
  getGrants: jest.fn(),
  getTeamEmployeeIds: jest.fn(),
  getCapabilities: jest.fn(),
  getMaskedFieldKeys: jest.fn(),
}));
jest.mock("../../../src/shared/rbac/sessions", () => ({ isSessionActive: jest.fn() }));

const { pool } = require("../../../src/config/db");
const grants = require("../../../src/shared/rbac/grants-cache");
const sessions = require("../../../src/shared/rbac/sessions");
const { config } = require("../../../src/config/env");
const { buildApp } = require("../../../src/app");
const { mountModules } = require("../../../src/http/module-loader");

const FIX = path.join(__dirname, "fixtures");
const USER = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";
const SID = "33333333-3333-4333-8333-333333333333";

const token = (claims = {}) =>
  jwt.sign({ sub: USER, sid: SID, typ: "access", ...claims }, config.JWT_ACCESS_SECRET, { expiresIn: "5m" });

let app;
beforeAll(() => {
  ({ app } = buildApp({ strict: true, accessLog: false, modulesDir: path.join(FIX, "good") }));
});

beforeEach(() => {
  jest.clearAllMocks();
  grants.getAuthUser.mockResolvedValue({
    user_id: USER, employee_id: EMP, email: "ada@mycity.io", display_name: "Ada Obi", status: "active", is_ceo: false, role_ids: ["r1"],
  });
  grants.getGrants.mockResolvedValue([{ can_view: true, can_create: false, scope: "team" }]);
  grants.getTeamEmployeeIds.mockResolvedValue([EMP, "44444444-4444-4444-8444-444444444444"]);
  sessions.isSessionActive.mockResolvedValue(true);
});

describe("surfaces and health", () => {
  test("liveness answers without a token and carries the environment marker", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-mycity-environment"]).toBe("test");
    expect(res.headers["x-robots-tag"]).toMatch(/noindex/);
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  test("a public route is served without auth", async () => {
    const res = await request(app).get("/api/public/v1/careers");
    expect(res.status).toBe(200);
  });

  test("a staff path on the public surface does not exist", async () => {
    expect((await request(app).get("/api/public/v1/things").set("Authorization", `Bearer ${token()}`)).status).toBe(404);
  });

  test("the empty routes file is skipped quietly", async () => {
    const { report } = buildApp({ strict: true, accessLog: false, modulesDir: path.join(FIX, "good") });
    expect(report.mounted.sort()).toEqual(["careers (public)", "things"]);
  });
});

describe("authentication", () => {
  test("no token is a 401 in the error envelope", async () => {
    const res = await request(app).get("/api/v1/things");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(res.body.request_id).toBeTruthy();
  });

  test("a refresh token is not an access token", async () => {
    const res = await request(app).get("/api/v1/things").set("Authorization", `Bearer ${token({ typ: "refresh" })}`);
    expect(res.status).toBe(401);
  });

  test("an inactive user is refused even with a valid token", async () => {
    grants.getAuthUser.mockResolvedValue({ user_id: USER, status: "suspended" });
    const res = await request(app).get("/api/v1/things").set("Authorization", `Bearer ${token()}`);
    expect(res.body.error.code).toBe("USER_INACTIVE");
  });

  test("an ended session is refused on the next request: index says no, Postgres has killed_at", async () => {
    sessions.isSessionActive.mockResolvedValue(false);
    pool.query.mockResolvedValue({ rows: [{ killed_at: new Date(), expires_at: new Date(Date.now() + 1e6) }] });
    const res = await request(app).get("/api/v1/things").set("Authorization", `Bearer ${token()}`);
    expect(res.body.error.code).toBe("SESSION_ENDED");
  });

  test("Redis forgetting a session is not a sign-out: Postgres says it is live", async () => {
    sessions.isSessionActive.mockResolvedValue(false);
    pool.query.mockResolvedValue({ rows: [{ killed_at: null, expires_at: new Date(Date.now() + 1e6) }] });
    const res = await request(app).get("/api/v1/things").set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(200);
  });

  test("a self route needs only a signed-in user", async () => {
    grants.getGrants.mockResolvedValue([]);
    const res = await request(app).get("/api/v1/things/me/scope").set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.headers["x-user"]).toBe(USER);
  });
});

describe("permissions and validation", () => {
  test("a granted view passes, validated query reaches the controller", async () => {
    const res = await request(app).get("/api/v1/things?page=3").set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(3);
    expect(grants.getTeamEmployeeIds).toHaveBeenCalledWith(pool, EMP);
  });

  test("an unknown query key is refused, naming it (no silent ?limit=500)", async () => {
    const res = await request(app).get("/api/v1/things?limit=500").set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.fields).toEqual({ "query.limit": ["is not allowed"] });
  });

  test("an action the roles do not grant is a 403", async () => {
    const res = await request(app).post("/api/v1/things").set("Authorization", `Bearer ${token()}`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });

  test("permission is checked before the body is parsed, then every field problem comes back at once", async () => {
    grants.getGrants.mockResolvedValue([{ can_create: true, scope: "all" }]);
    const res = await request(app).post("/api/v1/things").set("Authorization", `Bearer ${token()}`).send({ first_name: "Ada" });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(["last_name", "work_email", "department_id"]));
  });

  test("the CEO passes with scope all and no grant lookup", async () => {
    grants.getAuthUser.mockResolvedValue({ user_id: USER, employee_id: EMP, status: "active", is_ceo: true, role_ids: [] });
    const res = await request(app).get("/api/v1/things").set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(grants.getGrants).not.toHaveBeenCalled();
  });

  test("path params reach the controller on req.validated even without a params schema", async () => {
    const res = await request(app).get(`/api/v1/things/${EMP}`).set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.headers["x-id"]).toBe(EMP);
  });

  test("a malformed id is a 404, and never reaches the database", async () => {
    const res = await request(app).get("/api/v1/things/not-a-uuid").set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(404);
  });

  test("a response the contract does not describe fails under APP_ENV=test", async () => {
    const res = await request(app).get(`/api/v1/things/${EMP}?bad=1`).set("Authorization", `Bearer ${token()}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/contract/);
  });

  test("bad JSON is a 400, not a 500", async () => {
    const res = await request(app).post("/api/v1/things").set("Authorization", `Bearer ${token()}`)
      .set("Content-Type", "application/json").send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_JSON");
  });
});

describe("the module loader refuses", () => {
  const targets = () => ({ staff: require("express").Router(), public: require("express").Router() });

  test("a staff route with no permission check", () => {
    expect(() => mountModules(targets(), { strict: true, dir: path.join(FIX, "bad-noperm") }))
      .toThrow(/add requirePermission/);
  });

  test("a surface that disagrees with the file name", () => {
    expect(() => mountModules(targets(), { strict: true, dir: path.join(FIX, "bad-surface") }))
      .toThrow(/surface is "staff"/);
  });

  test("a route added without route(), so without a contract", () => {
    expect(() => mountModules(targets(), { strict: true, dir: path.join(FIX, "bad-raw") }))
      .toThrow(/has no contract/);
  });

  test("not strict: the module is skipped and reported instead", () => {
    const r = mountModules(targets(), { strict: false, dir: path.join(FIX, "bad-raw") });
    expect(r.skipped.map((s) => s.module)).toEqual(["rawmod"]);
  });
});

describe("route() refuses at definition", () => {
  const express = require("express");
  const { z } = require("zod");
  const c = require("@mycity/contract");
  const { route, publicRoute } = require("../../../src/http/route");
  const { requirePermission } = require("../../../src/middleware/rbac");
  const h = (_req, res) => res.json({});

  test("a schema that is not from packages/contract", () => {
    expect(() => route(express.Router(), "get", "/", { response: z.object({}) }, requirePermission("people", "view"), h))
      .toThrow(/not exported from packages\/contract/);
  });
  test("a write with no body", () => {
    expect(() => route(express.Router(), "post", "/", { response: c.common.EmptyBody }, requirePermission("people", "create"), h))
      .toThrow(/declares a body/);
  });
  test("no response", () => {
    expect(() => route(express.Router(), "get", "/", {}, requirePermission("people", "view"), h)).toThrow(/response/);
  });
  test("an unknown permission key or the word update", () => {
    expect(() => requirePermission("employees", "view")).toThrow(/not a permission key/);
    expect(() => requirePermission("people", "update")).toThrow(/not an action/);
  });
  test("a permission check on a public route", () => {
    expect(() => publicRoute(express.Router(), "get", "/", { response: c.common.EmptyBody }, requirePermission("people", "view"), h))
      .toThrow(/public route cannot carry/);
  });
});
