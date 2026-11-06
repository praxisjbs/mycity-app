"use strict";
/**
 * The Talent Pool: the rules that need no database (docs/guides/recruitment.md §6.9). Add, renew,
 * Invite to Apply, Remove, the purge and the export on the real schema are in
 * tests/integration/recruitment-pool.test.js.
 */
const service = require("./talent_pool.service");
const routes = require("./talent_pool.routes");
const { routesOf } = require("../../http/route");

describe("an entry", () => {
  const row = {
    talent_pool_entry_id: "t",
    candidate_id: "k",
    name: "Kemi Bello",
    email: "k@example.test",
    application_id: null,
    applied_vacancy_id: null,
    reason: "Strong second choice",
    added_by_name: null,
    created_at: "2026-11-05T10:00:00Z",
    expires_at: "2028-11-05T10:00:00Z",
    invited_at: null,
    invited_vacancy_id: null,
    hired_from_pool: false,
    removed_at: null,
  };

  test("shows the AI read's score once there is one, else the estimate with Provisional", () => {
    expect(service.entry({ ...row, screening_score: "71.00", provisional_score: "40.00" })).toMatchObject({ score: 71, score_provisional: false });
    expect(service.entry({ ...row, screening_score: null, provisional_score: "40.00" })).toMatchObject({ score: 40, score_provisional: true });
    expect(service.entry({ ...row, screening_score: null, provisional_score: null })).toMatchObject({ score: null, score_provisional: false });
  });
});

describe("routes", () => {
  test("view lists, create adds, edit invites, delete removes, export exports", () => {
    const rs = routesOf(routes.router);
    const action = (m, p) => rs.find((r) => r.method === m && r.path === p).permission.action;
    expect(action("GET", "/")).toBe("view");
    expect(action("POST", "/")).toBe("create");
    expect(action("POST", "/:id/invite")).toBe("edit");
    expect(action("POST", "/:id/remove")).toBe("delete");
    expect(action("POST", "/exports")).toBe("export");
  });
});
