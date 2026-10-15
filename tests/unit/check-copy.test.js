"use strict";
/**
 * The copy rules the screen gates share (scripts/check/lib/copy.js,
 * FRONTEND_GUIDE §5). A wrong word count or Title Case rule would pass or
 * fail every screen at once, so the edges are pinned here.
 */
const {
  LIMITS,
  wordCount,
  longestSentence,
  titleCaseViolation,
  explainerTitle,
  bannedButton,
  hasDash,
} = require("../../scripts/check/lib/copy");

describe("wordCount", () => {
  test("counts tokens with a letter; numbers, dates and money are free", () => {
    expect(wordCount("22 / 25 clocked in")).toBe(2);
    expect(wordCount("09/10/2026 · ₦1,250,000.00")).toBe(0);
    expect(wordCount("  Clear   Alert ")).toBe(2);
  });
});

describe("longestSentence", () => {
  test("splits on full stops and measures the longest", () => {
    expect(longestSentence("Short one. This one has exactly six words.")).toBe(6);
    expect(longestSentence("")).toBe(0);
  });
});

describe("titleCaseViolation", () => {
  test.each([
    "Clear Alert",
    "Queries & Sanctions",
    "Statement of Work",
    "Attendance, Last 14 Days",
    "Employee Self-Service",
    "Export PDF",
    "My Payslips",
    "Over by",
    "Clock-in Prompt",
    "Today's Register",
    "go.mycityapp.io",
    "iOS Devices",
    "A Year in Review",
  ])("accepts %s", (t) => expect(titleCaseViolation(t)).toBeNull());

  test.each([
    ["Create rule", "rule"],
    ["Your day", "day"],
    ["clear Alert", "clear"],
    ["Employee Self-service", "Self-service"],
    ["Of the Week", null],
  ])("flags %s", (t, word) => {
    if (word === null) expect(titleCaseViolation(t)).toBeNull();
    else expect(titleCaseViolation(t)).toBe(word);
  });
});

describe("explainerTitle", () => {
  test.each(["How a report is built", "Why the mailbox is ours", "What append only means", "About this system"])(
    "flags the explainer %s",
    (t) => expect(explainerTitle(t)).toMatch(/starts with/),
  );
  test.each(["Alerts are not notifications", "A user is not an employee"])("flags the sentence %s", (t) =>
    expect(explainerTitle(t)).toMatch(/is a sentence/),
  );
  test.each(["Recent Runs", "Team Roster", "While You Were Away"])("accepts %s", (t) => expect(explainerTitle(t)).toBeNull());
});

describe("bannedButton", () => {
  test("refuses labels that name no action", () => {
    expect(bannedButton("Submit")).toBe(true);
    expect(bannedButton(" ok ")).toBe(true);
    expect(bannedButton("Create Rule")).toBe(false);
  });
});

describe("hasDash", () => {
  test("finds em dashes, en dashes and spaced double hyphens in copy", () => {
    expect(hasDash("Unverified — no usable GPS evidence")).toBe(true);
    expect(hasDash("9:00 – 17:00")).toBe(true);
    expect(hasDash("Wait -- what")).toBe(true);
  });
  test("allows the empty-value marker and CSS variables", () => {
    expect(hasDash("—")).toBe(false);
    expect(hasDash(" - ")).toBe(false);
    expect(hasDash("color:var(--ink-3)")).toBe(false);
    expect(hasDash("Clock-in at 09:00")).toBe(false);
  });
});

describe("LIMITS", () => {
  test("is frozen, so a gate cannot loosen a limit at run time", () => {
    expect(Object.isFrozen(LIMITS)).toBe(true);
    expect(LIMITS.sentence).toBe(20);
  });
});
