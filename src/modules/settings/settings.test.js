"use strict";
/**
 * Settings' rules that need no database: the security rules against their .env
 * floors, the working week's shape, and the code lists the contract repeats. The
 * screens' flows run against Postgres in tests/integration/settings.test.js.
 */
const c = require("@mycity/contract");
const { config } = require("../../config/env");
const { DOC_TYPES } = require("../../shared/numbering/schemes");
const rules = require("./settings.security-rules");
const { DOC_LABELS } = require("./settings.service");

const FLOORS = { session_max_age_min: 120, idle_lock_min: 30, password_min_length: 8 };

describe("security rules within the .env floor", () => {
  test("nothing stored: the floors are the rules", () => {
    expect(rules.effective({}, FLOORS)).toEqual(FLOORS);
  });

  test("a stored rule may be stricter", () => {
    expect(rules.effective({ session_max_age_min: 60, idle_lock_min: 15, password_min_length: 12 }, FLOORS)).toEqual({
      session_max_age_min: 60,
      idle_lock_min: 15,
      password_min_length: 12,
    });
  });

  test("a stored rule the floor has since passed gives way to the floor", () => {
    expect(rules.effective({ session_max_age_min: 240, idle_lock_min: 45, password_min_length: 6 }, FLOORS)).toEqual(
      FLOORS,
    );
  });

  test("the idle lock never outlasts the session", () => {
    expect(rules.effective({ session_max_age_min: 20 }, FLOORS).idle_lock_min).toBe(20);
  });

  test("a change looser than its floor is refused, naming the floor", () => {
    const now = rules.effective({}, FLOORS);
    expect(rules.problems({ session_max_age_min: 180 }, now, FLOORS)).toEqual({
      session_max_age_min: ["At most 120 minutes"],
    });
    expect(rules.problems({ idle_lock_min: 45 }, now, FLOORS)).toEqual({ idle_lock_min: ["At most 30 minutes"] });
    expect(rules.problems({ password_min_length: 7 }, now, FLOORS)).toEqual({ password_min_length: ["At least 8"] });
    expect(rules.problems({ session_max_age_min: 20, idle_lock_min: 25 }, now, FLOORS)).toEqual({
      idle_lock_min: ["Within the session length"],
    });
    expect(rules.problems({ session_max_age_min: 60, idle_lock_min: 10, password_min_length: 14 }, now, FLOORS)).toEqual(
      {},
    );
  });

  test("every refusal is a field mark of four words or fewer", () => {
    const marks = Object.values(
      rules.problems({ session_max_age_min: 999, idle_lock_min: 999, password_min_length: 1 }, FLOORS, FLOORS),
    ).flat();
    for (const m of marks) expect(m.split(/\s+/).length).toBeLessThanOrEqual(4);
  });

  test("the floors are the server's .env", () => {
    expect(rules.floors()).toEqual({
      session_max_age_min: config.SESSION_MAX_AGE_MIN,
      idle_lock_min: config.SESSION_INACTIVITY_MIN,
      password_min_length: config.PASSWORD_MIN_LENGTH,
    });
  });

  test("with nothing loaded, the rules in force are the floors", () => {
    rules.reset();
    expect(rules.current()).toEqual(rules.effective({}));
  });
});

describe("the working week's shape", () => {
  const day = (weekday, on, starts_at = "09:00", ends_at = "17:00") => ({
    weekday,
    is_working_day: on,
    starts_at: on ? starts_at : null,
    ends_at: on ? ends_at : null,
  });
  const week = (overrides = {}) =>
    [1, 2, 3, 4, 5, 6, 7].map((d) => overrides[d] || day(d, d < 6));

  test("A22: Monday to Friday 09:00 to 17:00, Saturday 09:00 to 15:00", () => {
    expect(c.settings.WorkingWeekSave.safeParse({ days: week({ 6: day(6, true, "09:00", "15:00") }) }).success).toBe(
      true,
    );
  });

  test("a working day needs an end after its start", () => {
    const r = c.settings.WorkingWeekSave.safeParse({ days: week({ 2: day(2, true, "17:00", "09:00") }) });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toBe("After the start");
  });

  test("each day once, and at least one worked", () => {
    expect(c.settings.WorkingWeekSave.safeParse({ days: week({ 7: day(1, false) }) }).success).toBe(false);
    expect(c.settings.WorkingWeekSave.safeParse({ days: [1, 2, 3, 4, 5, 6, 7].map((d) => day(d, false)) }).success).toBe(
      false,
    );
  });
});

describe("the code lists the contract repeats", () => {
  test("the numbered document types are the code's, each with a label", () => {
    expect([...c.settings.DOC_TYPES].sort()).toEqual([...DOC_TYPES].sort());
    for (const t of DOC_TYPES) expect(DOC_LABELS[t]).toEqual(expect.any(String));
  });

  test("a security change names at least one rule", () => {
    expect(c.settings.SecurityPolicyPatch.safeParse({}).success).toBe(false);
    expect(c.settings.SecurityPolicyPatch.safeParse({ two_step_roles: ["management"] }).success).toBe(true);
  });
});
