"use strict";
/**
 * Worksites: a code from a name, the contract's bounds, and the routes. Adding,
 * changing, retiring and assigning run against Postgres in
 * tests/integration/attendance.test.js. The places here are invented.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const { codeOf } = require("./worksites.service");

describe("a worksite's code", () => {
  test("made from its name, in capitals, words joined by a hyphen", () => {
    expect(codeOf("Testbed Office")).toBe("TESTBED-OFFICE");
    expect(codeOf("  Ikeja / Field Hub #2 ")).toBe("IKEJA-FIELD-HUB-2");
    expect(codeOf("***")).toBe("WORKSITE");
  });
});

describe("the contract", () => {
  const ok = (body) => c.worksites.WorksiteCreate.safeParse(body).success;
  const base = { name: "Testbed Office", latitude: 6.5, longitude: 3.4, radius_m: 100 };

  test("a centre, a radius from 25 to 1000 m, and Africa/Lagos unless another zone is given", () => {
    expect(c.worksites.WorksiteCreate.parse(base).timezone).toBe("Africa/Lagos");
    expect(ok({ ...base, radius_m: 24 })).toBe(false);
    expect(ok({ ...base, radius_m: 1001 })).toBe(false);
    expect(ok({ ...base, latitude: 91 })).toBe(false);
    expect(ok({ ...base, timezone: "Europe/London" })).toBe(true);
    expect(ok({ ...base, timezone: "not a zone" })).toBe(false);
  });

  test("a centre outside its range is refused with the whole range; the ends themselves are kept", () => {
    const words = (body) => c.worksites.WorksiteCreate.safeParse(body).error.issues.map((i) => `${i.path[0]}: ${i.message}`);
    expect(words({ ...base, latitude: 91, longitude: 181 })).toEqual(["latitude: From -90 to 90", "longitude: From -180 to 180"]);
    expect(words({ ...base, latitude: -91, longitude: -181 })).toEqual(["latitude: From -90 to 90", "longitude: From -180 to 180"]);
    expect(words({ ...base, radius_m: 1001 })).toEqual(["radius_m: From 25 to 1,000 m"]);
    expect(words({ ...base, radius_m: 24 })).toEqual(["radius_m: From 25 to 1,000 m"]);
    expect(words({ ...base, radius_m: 100.5 })).toEqual(["radius_m: Whole metres only"]);
    for (const [latitude, longitude] of [[90, 180], [-90, -180]]) expect(ok({ ...base, latitude, longitude })).toBe(true);
    expect(c.worksites.WorksiteUpdate.safeParse({ latitude: 90.0001 }).error.issues[0].message).toBe("From -90 to 90");
  });

  test("a change must change something", () => {
    expect(c.worksites.WorksiteUpdate.safeParse({}).success).toBe(false);
    expect(c.worksites.WorksiteUpdate.safeParse({ active: false }).success).toBe(true);
  });
});

describe("the routes", () => {
  test("every route carries the people grant", () => {
    const routes = routesOf(require("./worksites.routes").router);
    expect(routes.length).toBe(6);
    for (const r of routes) expect(r.permission && r.permission.key).toBe("people");
  });
});
