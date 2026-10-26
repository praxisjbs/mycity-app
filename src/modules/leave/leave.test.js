"use strict";
/**
 * Leave: the rules a request's dates must meet, and the shape of the routes. The whole
 * flow (asking, the approval, People's scope, cancelling) runs against Postgres in
 * tests/integration/leave.test.js.
 */
const { routesOf } = require("../../http/route");
const workingWeek = require("../../shared/time/working-week");
const rules = require("./leave.balance");
const { OUTCOME } = require("./leave.events");

// Monday to Saturday, as MyCity works (A22), with one public holiday.
const cal = workingWeek.makeCalendar({
  days: [1, 2, 3, 4, 5, 6],
  holidays: [{ holiday_date: "2027-04-02", name: "Good Friday" }],
});

describe("how long a request is", () => {
  test("working days, both ends included; Sunday and a public holiday are not counted", () => {
    expect(rules.daysOf("2027-03-29", "2027-04-04", cal)).toBe(5); // Mon to Sun, Friday a holiday
    expect(rules.daysOf("2027-02-06", "2027-02-06", cal)).toBe(1); // a Saturday
  });

  test("a span with no working day, a span over New Year and a backwards span are refused", () => {
    expect(() => rules.daysOf("2027-02-07", "2027-02-07", cal)).toThrow(
      expect.objectContaining({ code: "LEAVE_NO_WORKING_DAYS", status: 422 }),
    );
    expect(() => rules.daysOf("2027-12-30", "2028-01-03", cal)).toThrow(
      expect.objectContaining({ code: "LEAVE_SPANS_YEARS" }),
    );
    expect(() => rules.daysOf("2027-02-05", "2027-02-04", cal)).toThrow(
      expect.objectContaining({ code: "LEAVE_ENDS_BEFORE_START" }),
    );
  });
});

describe("the allowance", () => {
  const annual = { name: "Annual", entitled: 20, remaining: 4 };

  test("a request that fits is let through; one that does not names what is left", () => {
    expect(() => rules.assertWithinAllowance(annual, 4)).not.toThrow();
    expect(() => rules.assertWithinAllowance(annual, 5)).toThrow(
      expect.objectContaining({ code: "LEAVE_ALLOWANCE_EXCEEDED", message: "Only 4 Annual days are left this year" }),
    );
  });

  test("the Last Day's mark gives the days asked for and the days left, short enough for the form to show", () => {
    const { wordCount } = require("../../../scripts/check/lib/copy");
    const markOf = (balance, days) => {
      try {
        rules.assertWithinAllowance(balance, days);
      } catch (e) {
        return e.fields.ends_on[0];
      }
      return null;
    };
    // The QA case: 19 Annual days left, 02/11/2026 to 15/12/2026 is 32 working days.
    expect(markOf({ name: "Annual", entitled: 20, remaining: 19 }, 32)).toBe("32 working days, 19 left");
    expect(markOf({ name: "Annual", entitled: 20, remaining: 0 }, 1)).toBe("1 working day, 0 left");
    // A year already over its allowance reads 0 left, never a negative.
    expect(markOf({ name: "Annual", entitled: 20, remaining: -2 }, 3)).toBe("3 working days, 0 left");
    // The form shows a server's mark as it is only when it fits its four words (else "Check this value").
    expect(wordCount(markOf({ name: "Annual", entitled: 20, remaining: 19 }, 32))).toBeLessThanOrEqual(4);
  });

  test("a type with no allowance has no ceiling", () => {
    expect(() => rules.assertWithinAllowance({ name: "Unpaid", entitled: null, remaining: null }, 200)).not.toThrow();
    expect(() => rules.assertWithinAllowance(undefined, 3)).not.toThrow();
  });
});

describe("the contract, which the form checks as it is filled", () => {
  const { leave } = require("@mycity/contract");
  const span = { leave_type_id: "33333333-3333-4333-8333-333333333333", reason: "" };
  const endsOn = (schema, body) => {
    const r = schema.safeParse(body);
    return r.success ? null : r.error.issues.filter((i) => i.path[0] === "ends_on").map((i) => i.message);
  };

  test("a Last Day in another year is refused on the Last Day, for the employee and for People", () => {
    const newYear = { ...span, starts_on: "2026-12-28", ends_on: "2027-01-04" };
    expect(endsOn(leave.LeaveRequestCreate, newYear)).toEqual(["Ends in another year"]);
    expect(endsOn(leave.LeaveRecordCreate, { ...newYear, employee_id: "44444444-4444-4444-8444-444444444444" })).toEqual(["Ends in another year"]);
    expect(endsOn(leave.LeaveRequestCreate, { ...span, starts_on: "2026-12-28", ends_on: "2026-12-31" })).toBeNull();
  });

  test("a backwards span says only that it ends before it starts", () => {
    expect(endsOn(leave.LeaveRequestCreate, { ...span, starts_on: "2027-01-02", ends_on: "2026-12-30" })).toEqual(["Ends before it starts"]);
  });
});

describe("an approval's end", () => {
  test("every end state of the flow maps to a request status", () => {
    expect(OUTCOME).toEqual({
      approved: "approved",
      timeout_approved: "approved",
      rejected: "rejected",
      timeout_rejected: "rejected",
      cancelled: "cancelled",
    });
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./leave.routes").router);

  test("every People route carries a permission; nothing decides a request here", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.permission).not.toBeNull();
      expect(r.path).not.toMatch(/approve|reject|decision/);
    }
  });

  test("the lists page through the contract's controls, with no page size", () => {
    const list = routes.find((r) => r.method === "GET" && r.path === "/requests");
    const keys = Object.keys(list.contract.query.shape);
    expect(keys).toEqual(expect.arrayContaining(["page", "q", "sort", "status", "from", "to"]));
    expect(keys).not.toEqual(expect.arrayContaining(["limit"]));
  });
});
