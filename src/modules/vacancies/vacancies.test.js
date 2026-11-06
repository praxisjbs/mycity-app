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

  test("never takes a path the careers routes hold beside it (/jobs/summary)", () => {
    expect(slugs.base("Summary", null)).toBe("summary-role");
    expect(slugs.base("Summary", "Lagos")).toBe("summary-lagos");
    for (const word of slugs.RESERVED) expect(slugs.base(word, null)).not.toBe(word);
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

  test("the careers page has four public routes and no permission; the summary is matched before a slug", () => {
    const rs = routesOf(publicRoutes.router);
    expect(rs.map((r) => `${r.method} ${r.path}`).sort()).toEqual(["GET /", "GET /:slug", "GET /summary", "POST /:slug/apply"]);
    for (const r of rs) expect(r.kind).toBe("public");
    const order = rs.map((r) => r.path);
    expect(order.indexOf("/summary")).toBeLessThan(order.indexOf("/:slug"));
  });
});

describe("the public index's summary (guide §6.1)", () => {
  const repo = require("./vacancies.repo");
  const c = require("@mycity/contract");
  const row = (slug, closes) => ({
    vacancy_id: `id-${slug}`,
    slug,
    title: slug,
    department: "Content",
    department_code: "CNT",
    location: "Lekki Phase 1, Lagos",
    work_pattern: "hybrid",
    work_pattern_note: "2 days in office",
    employment_type: "full_time",
    status: "open",
    close_reason: null,
    closes_at: closes,
    published_at: new Date("2026-11-01T09:00:00Z"),
  });
  afterEach(() => jest.restoreAllMocks());

  test("counts the careers list, names its departments and cities, and takes its first three as Closing Soon", async () => {
    const page = jest.spyOn(repo, "publicPage").mockResolvedValue({
      data: [row("a-lagos", new Date("2026-11-11T22:59:59Z")), row("b-lagos", new Date("2026-11-18T22:59:59Z")), row("c-lagos", null), row("d-lagos", null)],
      page: { number: 1, size: 25, total: 12, pages: 1, has_next: false },
    });
    jest.spyOn(repo, "publicDepartments").mockResolvedValue([{ code: "CNT", name: "Content", open: 2 }, { code: "ENG", name: "Engineering", open: 10 }]);
    jest.spyOn(repo, "publicCities").mockResolvedValue([{ name: "Lagos", open: 11 }, { name: "Abuja", open: 1 }]);
    jest.spyOn(repo, "settings").mockResolvedValue({ about_company: "MyCityApp is a digital city and lifestyle platform.", default_traits: [], updated_at: null });
    const out = await careers.summary();
    expect(page).toHaveBeenCalledWith(expect.anything(), {});
    const wire = JSON.parse(JSON.stringify(out));
    expect(c.vacancies.PublicJobsSummary.parse(wire)).toEqual(wire);
    expect(out.open).toBe(12);
    expect(out.closing_soon.map((x) => x.slug)).toEqual(["a-lagos", "b-lagos", "c-lagos"]);
    expect(out.closing_soon[0]).not.toHaveProperty("vacancy_id");
    expect(out.departments.map((d) => d.code)).toEqual(["CNT", "ENG"]);
    expect(out.cities).toEqual([{ name: "Lagos", open: 11 }, { name: "Abuja", open: 1 }]);
    expect(out.about_company[0]).toMatchObject({ kind: "paragraph" });
  });

  test("with nothing open and no About MyCityApp, every figure is empty", async () => {
    jest.spyOn(repo, "publicPage").mockResolvedValue({ data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } });
    jest.spyOn(repo, "publicDepartments").mockResolvedValue([]);
    jest.spyOn(repo, "publicCities").mockResolvedValue([]);
    jest.spyOn(repo, "settings").mockResolvedValue({ about_company: null, default_traits: [], updated_at: null });
    expect(await careers.summary()).toEqual({ open: 0, departments: [], cities: [], closing_soon: [], about_company: null });
  });
});

describe("must-meet conditions name no protected trait (guide §6.4)", () => {
  const UNFAIR = [
    ["Ladies only", "sex"],
    ["Must be under 30", "age"],
    ["Igbo only", "ethnicity"],
    ["Men only", "sex"],
    ["Male candidates preferred", "sex"],
    ["Must be 25-35", "age"],
    ["Aged 25 to 35", "age"],
    ["Not older than 35", "age"],
    ["Must be 25 years or older", "age"],
    ["Between 22 and 30", "age"],
    ["Young and energetic", "age"],
    ["Date of birth after 1995", "age"],
    ["Must be Hausa", "ethnicity"],
    ["A native Igbo speaker", "ethnicity"],
    ["Mother tongue Yoruba", "ethnicity"],
    ["Northerners only", "ethnicity"],
    ["Must be a Muslim", "religion"],
    ["Born again Christian", "religion"],
    ["Must be married", "family"],
    ["Must be single", "family"],
    ["Not pregnant", "family"],
    ["No children", "family"],
    ["No disability", "disability"],
    ["Able-bodied", "disability"],
    ["Genotype AA", "disability"],
    ["Indigene of Lagos State", "origin"],
    ["State of origin: Anambra", "origin"],
    ["From Anambra only", "origin"],
  ];
  test.each(UNFAIR)("%p is refused as %p", (text, trait) => {
    expect(service.traitsNamed(text)).toContain(trait);
  });

  const FAIR = [
    "Lives in Lagos",
    "A degree in finance",
    "Fluent in English",
    "Five years of sales experience",
    "Over 10 years in sales",
    "Over 15 years in sales",
    "At least 20 years of experience",
    "Speaks Yoruba",
    "Experience working with children",
    "Responds in under 30 minutes",
    "Manages a team of 20 people",
    "Acts in good faith",
    "Knowledge of the Nigerian market",
    "Experience selling women's clothing",
    "National sales experience",
    "Lives in Ibadan",
    "Bachelor's degree in marketing",
    "Can work at heights",
  ];
  test.each(FAIR)("%p passes", (text) => {
    expect(service.traitsNamed(text)).toEqual([]);
  });

  test("names each refused condition by its index", () => {
    expect(service.protectedConditions(["Lives in Lagos", "Ladies only", "Igbo only"])).toEqual([1, 2]);
  });
});
