"use strict";
/**
 * Numbering, geofence, rolling windows, stage history, dedup, public tokens,
 * query helpers and effective dating. Database calls go to a recording double;
 * the SQL itself is exercised against real Postgres in tests/integration.
 */
jest.mock("../../../src/config/db", () => ({ pool: { query: jest.fn() }, query: jest.fn() }));

const { pool } = require("../../../src/config/db");
const numbering = require("../../../src/shared/numbering/numbering");
const { SCHEMES, validateScheme } = require("../../../src/shared/numbering/schemes");
const geo = require("../../../src/shared/geo/geo");
const win = require("../../../src/shared/rules/window-counter");
const state = require("../../../src/shared/state/state-history");
const dedup = require("../../../src/shared/dedup/dedup");
const tokens = require("../../../src/shared/tokens/public-token");
const qh = require("../../../src/shared/db/query-helpers");
const ed = require("../../../src/shared/db/effective-dated");
const { DEPTH } = require("../../../src/shared/db/tx");
const { requirePublicToken } = require("../../../src/middleware/public-token");

function client(responses = []) {
  const calls = [];
  const c = {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next || { rows: [], rowCount: 0 };
    }),
  };
  return c;
}

describe("numbering", () => {
  test("formats every default scheme as BACKEND_STRUCTURE §7 says", () => {
    expect(numbering.format(SCHEMES.employee, "all", 1)).toBe("00001");
    expect(numbering.format(SCHEMES.query, "all", 28)).toBe("QRY-0028");
    expect(numbering.format(SCHEMES.report_run, "all", 214)).toBe("RPT-0214");
    expect(numbering.format(SCHEMES.payroll_run, "2026-10", 1)).toBe("PAY-2026-10");
    expect(numbering.format(SCHEMES.payslip, "2026-10", 1)).toBe("PAY-2026-10-0001");
  });

  test("a scheme may have no prefix only if it has a sequence part", () => {
    const base = { prefix: "", separator: "", reset: "never", include_period: false };
    expect(validateScheme({ ...base, padding: 5 })).toEqual([]);
    expect(validateScheme({ ...base, padding: 0 })).toContain("a scheme with no prefix needs a sequence part");
  });

  test("every default scheme is valid", () => {
    for (const [t, s] of Object.entries(SCHEMES)) expect([t, validateScheme(s)]).toEqual([t, []]);
  });

  test("the contract holds a saved scheme to the same rules, on the field each is about", () => {
    const { NumberingSchemeSave } = require("@mycity/contract").settings;
    const problems = (s) => {
      const r = NumberingSchemeSave.safeParse({ prefix: "EXP", padding: 4, separator: "-", reset: "never", include_period: false, ...s });
      return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
    };
    // Fault #3, 21/10/2026: a yearly scheme without its period was refused only on Save.
    expect(problems({ reset: "yearly" })).toEqual({ include_period: "Needed when it resets" });
    expect(problems({ reset: "monthly", include_period: true })).toEqual({});
    expect(problems({ prefix: "", padding: 0 })).toEqual({ padding: "Add sequence digits" });
    expect(problems({ padding: 0 })).toEqual({ padding: "Add digits or period" });
    expect(problems({ padding: 0, reset: "yearly", include_period: true })).toEqual({});
    // Each default scheme saves as it stands.
    for (const [t, s] of Object.entries(SCHEMES)) expect([t, problems(s)]).toEqual([t, {}]);
  });

  test("allocate refuses to run outside a transaction", async () => {
    await expect(numbering.allocate(client(), "query")).rejects.toThrow(/inside atomically/);
  });

  test("allocate reads the scheme and increments the counter for the period of the record's date", async () => {
    const c = client([
      { rows: [{ prefix: "PAY", padding: 4, separator: "-", reset: "monthly", include_period: true }] },
      { rows: [{ last_value: "7" }] },
    ]);
    c[DEPTH] = 1;
    const out = await numbering.allocate(c, "payslip", { date: "2026-10-31" });
    expect(out).toEqual({ number: "PAY-2026-10-0007", seq: 7, period: "2026-10" });
    expect(c.calls[1].sql).toMatch(/ON CONFLICT \(doc_type, period\) DO UPDATE/);
    expect(c.calls[1].params).toEqual(["payslip", "2026-10"]);
  });

  test("a missing scheme row fails loudly, naming the type", async () => {
    const c = client([{ rows: [] }]);
    c[DEPTH] = 1;
    await expect(numbering.allocate(c, "query")).rejects.toMatchObject({ code: "NUMBERING_SCHEME_MISSING" });
  });

  test("a type the code never declared is a programming error", async () => {
    const c = client();
    c[DEPTH] = 1;
    await expect(numbering.allocate(c, "invoice")).rejects.toThrow(/schemes\.js/);
  });

  test("readiness lists the types with no scheme row", async () => {
    const c = client([{ rows: [{ doc_type: "employee", ...SCHEMES.employee }] }]);
    const r = await numbering.checkSchemes(c);
    expect(r.status).toBe("down");
    expect(r.missing).toContain("query");
    expect(r.missing).not.toContain("employee");
  });
});

describe("geo", () => {
  const office = { latitude: 6.4281, longitude: 3.4219 };

  test("Victoria Island to Ikeja is about 18 km", () => {
    const d = geo.distanceM(office, { latitude: 6.6018, longitude: 3.3515 });
    expect(d).toBeGreaterThan(18000);
    expect(d).toBeLessThan(21000);
  });

  test("a usable point has both coordinates, in range", () => {
    expect(geo.isPoint({ latitude: 6.4285, longitude: 3.4221 })).toBe(true);
    expect(geo.isPoint(null)).toBe(false);
    expect(geo.isPoint({ latitude: null, longitude: 3 })).toBe(false);
    expect(geo.isPoint({ latitude: 91, longitude: 3 })).toBe(false);
  });
});

describe("rolling window", () => {
  const rule = { threshold: 3, window_days: 30 };

  test("three late arrivals within 30 days trigger; the window includes its first day", () => {
    const r = win.evaluate(rule, ["2026-10-02", "2026-10-15", "2026-10-31", "2026-09-30"], "2026-10-31");
    expect(r).toMatchObject({ count: 3, triggered: true, window_from: "2026-10-02", window_to: "2026-10-31" });
  });

  test("the date the threshold was first reached", () => {
    expect(win.firstBreach(rule, ["2026-09-01", "2026-10-02", "2026-10-15", "2026-10-31"])).toBe("2026-10-31");
    expect(win.firstBreach(rule, ["2026-01-01", "2026-03-01", "2026-05-01"])).toBeNull();
  });
});

describe("stage history", () => {
  const machine = state.defineMachine("candidate", {
    applied: ["screening", "rejected"],
    screening: ["interview", "rejected"],
    interview: ["offer", "rejected"],
    offer: [],
    rejected: [],
  });

  test("an allowed move writes one history row", async () => {
    const c = client([{ rows: [{ entity_state_history_id: "h1", changed_at: new Date() }] }]);
    await state.transition(c, machine, { entity_id: "c1", from: "applied", to: "screening", actor_id: "u1" });
    expect(c.calls[0].params.slice(0, 4)).toEqual(["candidate", "c1", "applied", "screening"]);
  });

  test("a move the machine does not allow is a 409 naming both states", async () => {
    await expect(state.transition(client(), machine, { entity_id: "c1", from: "applied", to: "offer" }))
      .rejects.toMatchObject({ status: 409, message: "A candidate cannot move from applied to offer" });
  });

  test("a machine that names an unknown state does not load", () => {
    expect(() => state.defineMachine("deal", { open: ["won"] })).toThrow(/unknown state "won"/);
  });

  test("time at each stage", () => {
    const s = state.stagesFrom([
      { to_state: "applied", changed_at: "2026-10-01T09:00:00Z" },
      { to_state: "screening", changed_at: "2026-10-02T09:00:00Z" },
    ], new Date("2026-10-04T09:00:00Z"));
    expect(s.map((x) => [x.state, x.seconds])).toEqual([["applied", 86400], ["screening", 172800]]);
  });
});

describe("dedup", () => {
  const signals = [
    { key: "work_email", weight: 60, normalize: dedup.norm.email, label: "Same work email" },
    { key: "phone", weight: 30, normalize: dedup.norm.phone, label: "Same phone number" },
    { key: "full_name", weight: 40, normalize: dedup.norm.name, label: "Same name", similar: true },
  ];

  test("phone numbers in any Nigerian format meet", () => {
    expect(dedup.norm.phone("0803 123 4567")).toBe(dedup.norm.phone("+234 803 123 4567"));
  });

  test("names ignore titles, accents, order and punctuation", () => {
    expect(dedup.norm.name("Dr. Adaézé OKAFOR")).toBe(dedup.norm.name("okafor adaeze"));
    expect(dedup.norm.company("Zenith Ventures Ltd.")).toBe("zenith");
  });

  test("ranks by score with reasons, drops weak matches", () => {
    const input = { work_email: "Ada@MyCity.io", phone: "08031234567", full_name: "Adaeze N. Okafor" };
    const ranked = dedup.rank(input, [
      { id: "a", work_email: "ada@mycity.io", phone: "+2348031234567", full_name: "Adaeze Okafor" },
      { id: "b", work_email: "other@mycity.io", phone: null, full_name: "Bola Ade" },
      { id: "c", work_email: null, phone: "0803 123 4567", full_name: "Adaeze Okafor" },
    ], signals);
    expect(ranked.map((r) => r.id)).toEqual(["a", "c"]);
    expect(ranked[0].score).toBe(100);
    expect(ranked[1].reasons).toEqual(["Same phone number", "Same name (similar)"]);
  });
});

describe("public tokens", () => {
  test("issue stores only the hash, and hands the token back once", async () => {
    const c = client([{ rows: [{ public_token_id: "t1", expires_at: new Date() }] }]);
    const out = await tokens.issue(c, { scope: "offer.sign", subject_type: "offer", subject_id: "o1", ttl_hours: 168, single_use: true });
    expect(tokens.looksLikeToken(out.token)).toBe(true);
    expect(c.calls[0].params[0]).toBe(tokens.hash(out.token));
    expect(c.calls[0].params).not.toContain(out.token);
  });

  test("bad scope or a ttl beyond 90 days is refused", async () => {
    await expect(tokens.issue(client(), { scope: "sign", subject_type: "offer", subject_id: "o1", ttl_hours: 1 })).rejects.toThrow(/scope/);
    await expect(tokens.issue(client(), { scope: "offer.sign", subject_type: "offer", subject_id: "o1", ttl_hours: 24 * 91 })).rejects.toThrow(/ttl/);
  });

  test("resolve never queries for something that is not a token", async () => {
    const c = client();
    expect(await tokens.resolve(c, "' OR 1=1 --", { scope: "offer.view" })).toBeNull();
    expect(c.query).not.toHaveBeenCalled();
  });

  test("the middleware answers every failure with the same 404", async () => {
    const mw = requirePublicToken("offer.view");
    pool.query.mockResolvedValueOnce({ rows: [] });
    const good = "A".repeat(43);
    await expect(mw({ params: { token: good } }, {}, () => {})).rejects.toMatchObject({ status: 404 });
    await expect(mw({ params: { token: "short" } }, {}, () => {})).rejects.toMatchObject({ status: 404, message: "This link is not valid or has expired" });
  });

  test("the middleware sets req.public_token on success", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ public_token_id: "t1", scope: "offer.view", subject_type: "offer", subject_id: "o1" }] });
    const req = { params: { token: "B".repeat(43) } };
    await requirePublicToken("offer.view")(req, {}, () => {});
    expect(req.public_token.subject_id).toBe("o1");
  });
});

describe("query helpers", () => {
  test("a key from input that is not an identifier is a 422 naming it, never SQL", async () => {
    await expect(qh.insertOne(client(), "department", { 'name"; DROP TABLE x; --': "a" }))
      .rejects.toMatchObject({ status: 422, code: "INVALID_FIELD" });
  });

  test("writable refuses mass assignment", async () => {
    await expect(qh.updateOne(client(), "employee", "employee_id", "e1", { is_ceo: true }, { writable: ["job_title"] }))
      .rejects.toMatchObject({ status: 422, fields: { is_ceo: ["cannot be set here"] } });
  });

  test("undefined means not given; values are bound", async () => {
    const c = client([{ rows: [{ id: 1 }] }]);
    await qh.insertOne(c, "department", { name: "Finance", code: undefined });
    expect(c.calls[0].sql).toBe('INSERT INTO "department" ("name") VALUES ($1) RETURNING *');
    expect(c.calls[0].params).toEqual(["Finance"]);
  });

  test("updateOne touches updated_at", async () => {
    const c = client([{ rows: [{}] }]);
    await qh.updateOne(c, "department", "department_id", "d1", { name: "HR" }, { touch: "updated_at" });
    expect(c.calls[0].sql).toBe('UPDATE "department" SET "name" = $2, "updated_at" = now() WHERE "department_id" = $1 RETURNING *');
  });
});

describe("list sort (F20)", () => {
  const { z } = require("zod");
  const common = require("../../../packages/contract/schemas/common");
  const { orderBy } = require("../../../src/shared/http/paged");

  const Query = common.listQuery({ status: z.enum(["active", "left"]).optional() }, ["display_name", "created_at"]);
  const SORTS = { display_name: "e.last_name, e.first_name", created_at: "e.created_at" };

  test("one key, a leading minus for descending", () => {
    expect(Query.parse({ sort: "display_name" }).sort).toEqual({ field: "display_name", dir: "asc" });
    expect(Query.parse({ sort: "-created_at" }).sort).toEqual({ field: "created_at", dir: "desc" });
  });

  test("a field the list does not allow-list is a 422 naming sort", () => {
    const bad = Query.safeParse({ sort: "salary" });
    expect(bad.success).toBe(false);
    expect(bad.error.issues[0].path).toEqual(["sort"]);
  });

  test("a list with no sortable fields has no sort key at all", () => {
    expect(common.listQuery().safeParse({ sort: "anything" }).success).toBe(false);
  });

  test("sort cannot be redefined as a filter, and page and q still cannot", () => {
    for (const key of common.RESERVED_CONTROLS) {
      expect(() => common.listQuery({ [key]: z.string() })).toThrow(/standard list control/);
    }
  });

  test("sortable fields are snake_case, named, and named once", () => {
    expect(() => common.sortParam([])).toThrow(/at least one/);
    expect(() => common.sortParam(["Bad-Name"])).toThrow(/snake_case/);
    expect(() => common.sortParam(["a", "a"])).toThrow(/twice/);
  });

  test("orderBy builds SQL from the repo's map, never from the request", () => {
    expect(orderBy(Query.parse({}), SORTS, "e.employee_id")).toBe("e.last_name, e.first_name, e.employee_id");
    expect(orderBy(Query.parse({ sort: "created_at" }), SORTS, "e.employee_id")).toBe("e.created_at, e.employee_id");
  });

  test("descending puts NULLs last, on every column of the expression", () => {
    expect(orderBy(Query.parse({ sort: "-display_name" }), SORTS, "e.employee_id"))
      .toBe("e.last_name DESC NULLS LAST, e.first_name DESC NULLS LAST, e.employee_id");
  });

  test("every order finishes on the unique column, so pages cannot repeat a row", () => {
    for (const sort of [undefined, "display_name", "-display_name", "created_at", "-created_at"]) {
      expect(orderBy(Query.parse(sort ? { sort } : {}), SORTS, "e.employee_id")).toMatch(/, e\.employee_id$/);
    }
  });

  test("a key the contract allowed but the repo has no SQL for falls back to the default order", () => {
    expect(orderBy({ sort: { field: "nothing_here", dir: "desc" } }, SORTS, "e.employee_id"))
      .toBe("e.last_name, e.first_name, e.employee_id");
  });

  test("orderBy refuses a list with no columns or no tiebreak", () => {
    expect(() => orderBy({}, {}, "e.id")).toThrow(/no sortable columns/);
    expect(() => orderBy({}, SORTS)).toThrow(/unique column/);
  });
});

describe("effective dating", () => {
  test("asOf builds the inclusive-from, exclusive-to condition", () => {
    expect(ed.asOf("s", 2)).toBe("(s.effective_from <= $2::date AND (s.effective_to IS NULL OR s.effective_to > $2::date))");
  });

  test("a new version closes the open one and starts the next", async () => {
    const c = client([{ rows: [] }, { rows: [] }, { rowCount: 1 }, { rows: [{ ok: 1 }] }]);
    await ed.addVersion(c, { table: "salary_assignment", key: { employee_id: "e1" }, from: "2026-11-01", data: { gross_monthly: "500000.00" } });
    expect(c.calls[0].sql).toMatch(/FOR UPDATE/);
    expect(c.calls[2].sql).toMatch(/SET effective_to = \$2::date/);
    expect(c.calls[3].params).toEqual(["500000.00", "e1", "2026-11-01", null]);
  });

  test("a date on or before an existing later version is refused", async () => {
    const c = client([{ rows: [] }, { rows: [{ effective_from: "2026-12-01" }] }]);
    await expect(ed.addVersion(c, { table: "salary_assignment", key: { employee_id: "e1" }, from: "2026-11-01", data: {} }))
      .rejects.toMatchObject({ status: 409, code: "VERSION_EXISTS" });
  });
});

describe("phone numbers (contract)", () => {
  const { phone } = require("../../../packages/contract/schemas/common");

  test("a Nigerian number in any local form becomes +234", () => {
    expect(phone.parse("0704 136 2752")).toBe("+2347041362752");
    expect(phone.parse("+234 803 123 4567")).toBe("+2348031234567");
  });

  test("a number abroad, written in international form, is kept", () => {
    expect(phone.parse("+44 7884 050144")).toBe("+447884050144");
    expect(phone.parse("+41779539483")).toBe("+41779539483");
  });

  test("a short +234 number is refused, not taken for a foreign one", () => {
    expect(phone.safeParse("+2348031234").success).toBe(false);
    expect(phone.safeParse("803 123").success).toBe(false);
  });
});
