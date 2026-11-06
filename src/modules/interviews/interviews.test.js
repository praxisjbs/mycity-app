"use strict";
/**
 * Interviews: the rules that need no database (docs/guides/recruitment.md §6.6). Scheduling, the blind
 * card on the real schema, closing, the report and its form are in
 * tests/integration/recruitment-interviews.test.js.
 */
const repo = require("./interviews.repo");
const consolidate = require("./interviews.consolidate");
const routes = require("./interviews.routes");
const { routesOf } = require("../../http/route");

describe("the blind rule", () => {
  test("is one predicate: the reader's own card, or a submitted card of a closed round", () => {
    expect(repo.BLIND("$2")).toBe("(p.employee_id = $2 OR (f.submitted_at IS NOT NULL AND r.status = 'closed'))");
  });
});

describe("the round's score", () => {
  test("is the mean of the submitted cards' scores × 10, one decimal; none submitted is no score", () => {
    expect(consolidate.scoreOf([{ score: 7 }, { score: 8.5 }])).toBe(77.5);
    expect(consolidate.scoreOf([{ score: 6.3333 }])).toBe(63.3);
    expect(consolidate.scoreOf([])).toBe(null);
  });
});

describe("routes", () => {
  test("every route holds a recruitment grant; scheduling and closing need edit, a card needs only a seat", () => {
    const rs = routesOf(routes.router);
    for (const r of rs) expect(r.permission && r.permission.key).toBe("recruitment");
    const action = (m, p) => rs.find((r) => r.method === m && r.path === p).permission.action;
    expect(action("POST", "/")).toBe("edit");
    expect(action("POST", "/:id/close")).toBe("edit");
    expect(action("PUT", "/:id/feedback")).toBe("view");
    expect(action("POST", "/:id/feedback/submit")).toBe("view");
    // The panel picker lists who may sit, for those who schedule; Tidy With AI is a panelist's, on view.
    expect(action("GET", "/panelists")).toBe("edit");
    expect(action("GET", "/assist")).toBe("view");
    expect(action("POST", "/assist")).toBe("view");
  });
});

describe("the round closes by itself", () => {
  const row = (over) => ({ round_status: "open", status: "scheduled", panel_size: 2, submitted_count: 2, scheduled_start: new Date(Date.now() - 60_000).toISOString(), ...over });
  const untouched = { query: () => { throw new Error("no write expected"); } };

  test("not before the interview has started, as Close Round", async () => {
    expect(await consolidate.closeIfDone(untouched, row({ scheduled_start: new Date(Date.now() + 3_600_000).toISOString() }), null)).toBe(false);
  });

  test("not while a seat is still waiting, nor with nobody on the panel, nor once closed or cancelled", async () => {
    expect(await consolidate.closeIfDone(untouched, row({ submitted_count: 1 }), null)).toBe(false);
    expect(await consolidate.closeIfDone(untouched, row({ panel_size: 0, submitted_count: 0 }), null)).toBe(false);
    expect(await consolidate.closeIfDone(untouched, row({ round_status: "closed" }), null)).toBe(false);
    expect(await consolidate.closeIfDone(untouched, row({ status: "cancelled" }), null)).toBe(false);
  });
});
