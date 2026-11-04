"use strict";
/**
 * Vacancies: the rules that need no database (docs/guides/recruitment.md §6.1, §6.3). The routes,
 * the lifecycle on the real schema, the careers page and the cards are in
 * tests/integration/recruitment-vacancies.test.js.
 */
const slugs = require("./vacancies.slug");
const lifecycle = require("./vacancies.lifecycle");
const careers = require("./vacancies.careers");
const service = require("./vacancies.service");
const routes = require("./vacancies.routes");
const publicRoutes = require("./vacancies.public.routes");
const { routesOf } = require("../../http/route");

describe("the slug", () => {
  test("is the title and the city, folded to plain words", () => {
    expect(slugs.base("Head, Sales & Revenue", "Lagos")).toBe("head-sales-revenue-lagos");
    expect(slugs.base("Content Producer", "Lagos")).toBe("content-producer-lagos");
    expect(slugs.base("Développeur Back-end", null)).toBe("developpeur-back-end");
  });

  test("does not repeat a city the title already ends with, and names a title of symbols 'role'", () => {
    expect(slugs.base("Sales Lead Lagos", "Lagos")).toBe("sales-lead-lagos");
    expect(slugs.base("***", "Abuja")).toBe("role-abuja");
  });

  test("is at most 80 characters and never ends on a hyphen", () => {
    const s = slugs.base("a".repeat(70) + " b".repeat(20), "Port Harcourt");
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
  });

  test("takes the lowest suffix free", async () => {
    const client = { query: jest.fn(async () => ({ rows: [{ slug: "sales-lead-lagos" }, { slug: "sales-lead-lagos-2" }] })) };
    await expect(slugs.unique(client, "sales-lead-lagos")).resolves.toBe("sales-lead-lagos-3");
    const free = { query: jest.fn(async () => ({ rows: [] })) };
    await expect(slugs.unique(free, "sales-lead-lagos")).resolves.toBe("sales-lead-lagos");
  });

  test("accepts only the shape the public routes take", () => {
    expect(slugs.looksLikeSlug("content-producer-lagos")).toBe(true);
    expect(slugs.looksLikeSlug("Content")).toBe(false);
    expect(slugs.looksLikeSlug("a--b")).toBe(false);
  });
});

describe("the lifecycle", () => {
  test("draft opens or closes; open pauses or closes; paused opens or closes; closed is the end", () => {
    expect(() => lifecycle.assertCanMove("draft", "open")).not.toThrow();
    expect(() => lifecycle.assertCanMove("open", "paused")).not.toThrow();
    expect(() => lifecycle.assertCanMove("paused", "open")).not.toThrow();
    expect(() => lifecycle.assertCanMove("paused", "closed")).not.toThrow();
    expect(() => lifecycle.assertCanMove("draft", "paused")).toThrow("Only an open vacancy can be paused");
    expect(() => lifecycle.assertCanMove("closed", "open")).toThrow("Only a draft or a paused vacancy can be published");
    expect(() => lifecycle.assertCanMove("closed", "closed")).toThrow("already closed");
  });

  test("publishing asks for every field it needs, each on its own field", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    let err;
    try {
      lifecycle.assertPublishable({ work_pattern: "hybrid", description: "short", requirements: "", closes_at: "2026-11-01T00:00:00Z" }, now);
    } catch (e) {
      err = e;
    }
    expect(err.status).toBe(422);
    expect(Object.keys(err.fields).sort()).toEqual(["closes_on", "department_id", "description", "hiring_manager_id", "location", "requirements"]);
  });

  test("a remote role needs no location to publish", () => {
    const ok = {
      department_id: "d",
      hiring_manager_id: "h",
      work_pattern: "remote",
      description: "x".repeat(80),
      requirements: "Four years building APIs",
      closes_at: "2026-12-01T22:59:59Z",
    };
    expect(() => lifecycle.assertPublishable(ok, new Date("2026-11-04T10:00:00Z"))).not.toThrow();
  });

  test("the careers page reads open, paused, closed or filled; open past its closing time reads closed", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    expect(lifecycle.publicState({ status: "open", closes_at: "2026-12-01T00:00:00Z" }, now)).toBe("open");
    expect(lifecycle.publicState({ status: "open", closes_at: "2026-11-01T00:00:00Z" }, now)).toBe("closed");
    expect(lifecycle.publicState({ status: "paused" }, now)).toBe("paused");
    expect(lifecycle.publicState({ status: "closed", close_reason: "filled" }, now)).toBe("filled");
    expect(lifecycle.publicState({ status: "closed", close_reason: "cancelled" }, now)).toBe("closed");
    expect(lifecycle.takesApplications({ status: "paused" }, now)).toBe(false);
  });
});

describe("what a vacancy's scorecard decides", () => {
  const parts = (on) =>
    ["screening", "psychometric", "technical", "case_study", "interview"].map((code) => ({ code, active: on.includes(code) }));

  test("the board leaves out Assessment and Interview when their parts are off", () => {
    expect(service.boardStages(parts(["screening", "interview"]))).toEqual(["application", "screening", "interview", "shortlist"]);
    expect(service.boardStages(parts(["screening", "technical", "interview"]))).toEqual([
      "application",
      "screening",
      "assessment",
      "interview",
      "shortlist",
    ]);
  });

  test("How We Hire names the steps the role uses", () => {
    expect(careers.howWeHire(["screening", "case_study", "interview"])).toEqual(["apply", "screening", "assessment", "interview"]);
    expect(careers.howWeHire(["interview"])).toEqual(["apply", "interview"]);
  });
});

describe("dates", () => {
  test("a vacancy picked to close on a day closes at 23:59:59 Lagos time", () => {
    expect(service.endOfDay("2026-11-30").toISOString()).toBe("2026-11-30T22:59:59.000Z");
  });

  test("days open run from publish to close, or to today", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(service.daysOpen({ published_at: null }, now)).toBe(null);
    expect(service.daysOpen({ published_at: "2026-10-28T09:00:00Z", closed_at: null }, now)).toBe(7);
    expect(service.daysOpen({ published_at: "2026-10-28T09:00:00Z", closed_at: "2026-10-30T09:00:00Z" }, now)).toBe(2);
  });
});

describe("routes", () => {
  test("every staff route holds a recruitment grant; writes need edit or create", () => {
    const rs = routesOf(routes.router);
    expect(rs.length).toBeGreaterThan(10);
    for (const r of rs) expect(r.permission && r.permission.key).toBe("recruitment");
    const write = rs.filter((r) => r.method !== "GET" && r.path !== "/assist" && !r.path.endsWith("/assist/questions"));
    for (const r of write) expect(["create", "edit"]).toContain(r.permission.action);
  });

  test("the careers page has three public routes and no permission", () => {
    const rs = routesOf(publicRoutes.router);
    expect(rs.map((r) => `${r.method} ${r.path}`).sort()).toEqual(["GET /", "GET /:slug", "POST /:slug/apply"]);
    for (const r of rs) expect(r.kind).toBe("public");
  });
});
