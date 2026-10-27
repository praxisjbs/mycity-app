"use strict";
/**
 * Query rules: when offences reach a rule, what the query they raise says, a rule's code
 * and the routes' grants. Counting real attendance days and raising the query run against
 * Postgres in tests/integration/queries.test.js.
 */
const { routesOf } = require("../../http/route");
const { reached, queryOf, dayList } = require("./query_rules.evaluator");
const { codeFrom, countable } = require("./query_rules.service");

const days = (...dates) => dates.map((date) => ({ date, minutes: 10 }));

describe("reaching a rule", () => {
  const three = { measure: "count", threshold: 3 };

  test("a count rule breaches on the offence that reaches it, and names that day", () => {
    expect(reached(three, days("2026-10-02", "2026-10-15"))).toEqual({ breached: false, total: 2, breach_date: null });
    expect(reached(three, days("2026-10-02", "2026-10-15", "2026-10-31"))).toEqual({
      breached: true,
      total: 3,
      breach_date: "2026-10-31",
    });
  });

  test("a minutes rule sums late minutes; nothing counted is never a breach", () => {
    const hours = { measure: "minutes", threshold: 300 };
    expect(reached(hours, [{ date: "2026-10-02", minutes: 200 }]).breached).toBe(false);
    expect(reached(hours, [{ date: "2026-10-02", minutes: 200 }, { date: "2026-10-09", minutes: 100 }]).breached).toBe(true);
    expect(reached({ measure: "count", threshold: 0 }, []).breached).toBe(false);
  });
});

describe("the query a breach raises", () => {
  test("named after the rule, the counted days day-first in its details, one evidence item a day", () => {
    const rule = { name: "Repeated Lateness", source_event: "lateness", measure: "count", window_days: 30 };
    const offences = [
      { date: "2026-10-02", minutes: 12 },
      { date: "2026-10-15", minutes: 25 },
      { date: "2026-10-31", minutes: 7 },
    ];
    const q = queryOf(rule, offences, 3);
    expect(q.subject).toBe("Repeated Lateness");
    expect(q.details).toBe("Late arrival on 02/10/2026, 15/10/2026 and 31/10/2026 (3 in 30 days). Please explain.");
    expect(q.evidence).toEqual([
      { label: "Late arrival, 12 minutes", date: "2026-10-02" },
      { label: "Late arrival, 25 minutes", date: "2026-10-15" },
      { label: "Late arrival, 7 minutes", date: "2026-10-31" },
    ]);
    expect(dayList(["2026-10-02"])).toBe("02/10/2026");
  });
});

describe("a rule", () => {
  test("its code is made from its name; only what a module counts can be switched on", () => {
    expect(codeFrom("Repeated Lateness")).toBe("repeated_lateness");
    expect(["lateness", "absence", "missing_clock_out", "unenrolled_device", "overdue_task", "low_performance"].every(countable)).toBe(true);
    expect(countable("missed_target")).toBe(false);
  });

  test("reads need the queries grant; every write needs queries.configure too", () => {
    const routes = routesOf(require("./query_rules.routes").router);
    for (const r of routes) {
      expect(r.permission.key).toBe("queries");
      if (r.method === "GET") expect([r.permission.action, r.capability]).toEqual(["view", null]);
      else expect(r.capability).toBe("queries.configure");
    }
    expect(routes).toHaveLength(7);
  });
});
