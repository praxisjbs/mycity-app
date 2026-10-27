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

  test("nothing counted is never a breach", () => {
    expect(reached({ measure: "count", threshold: 0 }, []).breached).toBe(false);
  });
});

describe("the query a breach raises", () => {
  test("named after the rule, the counted days day-first in its details, one evidence item a day", () => {
    const rule = { name: "Unknown Phones", source_event: "unenrolled_device", window_days: 30 };
    const offences = [{ date: "2026-10-02" }, { date: "2026-10-15" }, { date: "2026-10-31" }];
    const q = queryOf(rule, offences);
    expect(q.subject).toBe("Unknown Phones");
    expect(q.details).toBe("Punch from an unregistered device on 02/10/2026, 15/10/2026 and 31/10/2026 (3 in 30 days). Please explain.");
    expect(q.evidence).toEqual(offences.map((o) => ({ label: "Punch from an unregistered device", date: o.date })));
    // A module may name each offence itself (a task's number and title).
    expect(queryOf({ ...rule, source_event: "overdue_task" }, [{ date: "2026-10-02", label: "Task overdue: Stock count" }]).evidence).toEqual([
      { label: "Task overdue: Stock count", date: "2026-10-02" },
    ]);
    expect(dayList(["2026-10-02", "2026-10-02"])).toBe("02/10/2026");
  });
});

describe("a rule", () => {
  test("its code is made from its name; only what a module counts can be switched on", () => {
    expect(codeFrom("Repeated Lateness")).toBe("repeated_lateness");
    expect(["unenrolled_device", "overdue_task", "low_performance"].every(countable)).toBe(true);
    expect(countable("missed_target")).toBe(false);
    // Late arrivals, absences and missing clock-outs are the Attendance policy's rules (guide §6.3).
    expect(["lateness", "absence", "missing_clock_out"].some(countable)).toBe(false);
  });

  test("a new or edited rule never counts what the Attendance policy counts", () => {
    const c = require("@mycity/contract");
    const base = { name: "Late Again", threshold: 3, window_days: 30 };
    for (const source of ["lateness", "absence", "missing_clock_out"]) {
      expect(c.query_rules.QueryRuleCreate.safeParse({ ...base, source_event: source }).success).toBe(false);
      expect(c.query_rules.QueryRuleUpdate.safeParse({ source_event: source }).success).toBe(false);
    }
    expect(c.query_rules.QueryRuleCreate.safeParse({ ...base, source_event: "overdue_task" }).success).toBe(true);
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
