"use strict";
/**
 * The API serves both frontend builds, by host, and keeps each surface's API
 * off the other host.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-dist-"));
const staffDir = path.join(tmp, "app");
const publicDir = path.join(tmp, "public-app");
fs.mkdirSync(path.join(staffDir, "assets"), { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(staffDir, "index.html"), "<!doctype html><title>hub</title>");
fs.writeFileSync(path.join(staffDir, "sw.js"), "self.addEventListener('install',()=>{})");
fs.writeFileSync(path.join(staffDir, "assets", "app.3f9c.js"), "console.log(1)");
fs.writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><title>go</title>");

process.env.STAFF_ORIGIN = "http://hub.localhost:8080";
process.env.PUBLIC_ORIGIN = "http://go.localhost:8080";
process.env.APP_DIST_DIR = staffDir;
process.env.PUBLIC_APP_DIST_DIR = publicDir;

const { buildApp } = require("../../../src/app");
const { app } = buildApp({ strict: true, accessLog: false, modulesDir: path.join(__dirname, "fixtures", "good") });
const hub = (p) => request(app).get(p).set("Host", "hub.localhost:8080");
const go = (p) => request(app).get(p).set("Host", "go.localhost:8080");

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("each host gets its own build", () => {
  test("hub serves the staff app, deep links fall back to index.html, never cached", async () => {
    const res = await hub("/people/employees/123");
    expect(res.status).toBe(200);
    expect(res.text).toContain("<title>hub</title>");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'self'/);
  });

  test("hashed assets are cached for a year; the service worker is always revalidated", async () => {
    expect((await hub("/assets/app.3f9c.js")).headers["cache-control"]).toMatch(/max-age=31536000, immutable/);
    expect((await hub("/sw.js")).headers["cache-control"]).toBe("no-cache");
  });

  test("go serves the public site, and has no service worker", async () => {
    expect((await go("/careers/analyst")).text).toContain("<title>go</title>");
    const sw = await go("/sw.js");
    expect(sw.text).not.toContain("addEventListener");
  });

  test("an API path never falls back to index.html", async () => {
    const res = await hub("/api/v1/nothing-here");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("the host guard", () => {
  test("the staff API is not reachable on go.", async () => {
    const res = await go("/api/v1/things");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  test("Socket.io is not reachable on go.", async () => {
    expect((await go("/socket.io/?EIO=4")).status).toBe(404);
  });

  test("the public API is not reachable on hub.", async () => {
    expect((await hub("/api/public/v1/careers")).status).toBe(404);
    expect((await go("/api/public/v1/careers")).status).toBe(200);
  });

  test("health answers on every host", async () => {
    expect((await go("/api/health")).status).toBe(200);
    expect((await request(app).get("/api/health").set("Host", "10.0.0.5")).status).toBe(200);
  });
});
