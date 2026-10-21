"use strict";
/**
 * The staff surface's two budgets (docs/guides/community.md §6): an upload counts against the
 * upload limiter only, every other request against the staff limiter only, so a screen busy
 * with reads never blocks a file and a burst of files never blocks the screen.
 */
const express = require("express");
const request = require("supertest");
const { staffLimiter, uploadLimiter } = require("../../src/middleware/rate-limit");

function app() {
  const a = express();
  a.set("trust proxy", true);
  a.use(staffLimiter, uploadLimiter);
  a.post("/media", (req, res) => res.status(201).end());
  a.get("/messages", (req, res) => res.status(200).end());
  return a;
}

const remaining = (res) => Number(/remaining=(\d+)/.exec(res.headers.ratelimit ?? "")?.[1]);

describe("rate limits on the staff surface", () => {
  test("uploads have their own 60 a minute and leave the staff budget alone", async () => {
    const a = app();
    const from = (r) => r.set("X-Forwarded-For", "10.77.0.1");
    const before = await from(request(a).get("/messages"));
    expect(before.status).toBe(200);

    for (let i = 0; i < 60; i += 1) {
      const up = await from(request(a).post("/media")).attach("file", Buffer.from("x"), `f${i}.png`);
      expect(up.status).toBe(201);
    }
    const refused = await from(request(a).post("/media")).attach("file", Buffer.from("x"), "f60.png");
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("RATE_LIMITED");

    // The reads are untouched: one more request spent since the first read, not sixty.
    const after = await from(request(a).get("/messages"));
    expect(after.status).toBe(200);
    expect(remaining(after)).toBe(remaining(before) - 1);
  });

  test("a plain write is the staff budget's, not the upload budget's", async () => {
    const a = app();
    const from = (r) => r.set("X-Forwarded-For", "10.77.0.2");
    const write = await from(request(a).post("/media")).send({ body: "hello" });
    expect(write.status).toBe(201);
    const up = await from(request(a).post("/media")).attach("file", Buffer.from("x"), "f.png");
    expect(remaining(up)).toBe(59);
  });
});
