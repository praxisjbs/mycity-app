// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { commitmentMonths, commitmentPill } from "./Commitment";

/**
 * How a commitment reads on a card, a panel and the Commitments view (docs/guides/performance.md
 * §6.11, §10): its state as a pill, an unapproved one saying whether its month was sent or came
 * back, and the two months a new one may be for.
 */
describe("a commitment's state", () => {
  it("says whether an unapproved month was sent, returned or not sent yet", () => {
    expect(commitmentPill("awaiting_approval", "submitted")).toEqual({ tone: "warn", text: "Awaiting Approval" });
    expect(commitmentPill("awaiting_approval", "returned")).toEqual({ tone: "err", text: "Returned" });
    expect(commitmentPill("awaiting_approval", null)).toEqual({ tone: "neutral", text: "Not Sent" });
    expect(commitmentPill("awaiting_approval", "draft").text).toBe("Not Sent");
  });

  it("names each approved state in words, with colour that is never alone", () => {
    expect(commitmentPill("on_time", "approved")).toEqual({ tone: "ok", text: "On Time" });
    expect(commitmentPill("late", "approved")).toEqual({ tone: "warn", text: "Late" });
    expect(commitmentPill("missed", "approved")).toEqual({ tone: "err", text: "Missed" });
    expect(commitmentPill("rescoped", "approved").text).toBe("Rescoped");
    expect(commitmentPill("due", "approved").text).toBe("Due");
  });
});

describe("a commitment's month", () => {
  it("is this month or the next, across a year's end", () => {
    expect(commitmentMonths("2026-10-22").map(([v]) => v)).toEqual(["2026-10-01", "2026-11-01"]);
    expect(commitmentMonths("2026-12-30").map(([v]) => v)).toEqual(["2026-12-01", "2027-01-01"]);
    expect(commitmentMonths("2026-10-22")[0][1]).toBe("October 2026");
  });
});
