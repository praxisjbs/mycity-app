"use strict";
/**
 * Identity's rules that need no database: how long a session and its tokens live,
 * when a session must end, the cooldown after wrong passwords, what a new password
 * must be, and how a device is named. The flows themselves run against Postgres in
 * tests/integration/identity.test.js.
 */
const c = require("@mycity/contract");
const catalog = require("../../shared/access/access.catalog");
const policy = require("./identity.session-policy");
const throttle = require("./identity.throttle");
const passwordPolicy = require("./identity.password-policy");
const { deviceLabel, platformOf } = require("./identity.device-label");

describe("session policy", () => {
  test("a session lasts two hours and idles out after thirty minutes by default", () => {
    expect(policy.maxAgeSeconds()).toBe(7200);
    expect(policy.idleSeconds()).toBe(1800);
  });

  test("no token outlives its session", () => {
    expect(policy.accessTtlFor(7200)).toBe(900);
    expect(policy.accessTtlFor(300)).toBe(300);
    expect(policy.refreshTtlFor(300)).toBe(300);
    expect(policy.accessTtlFor(0)).toBe(1);
  });

  test("time left is counted from sign-in and never negative", () => {
    expect(policy.remainingSeconds(0)).toBe(7200);
    expect(policy.remainingSeconds(7000)).toBe(200);
    expect(policy.remainingSeconds(9000)).toBe(0);
    // An unknown age is a new session, never a mass sign-out.
    expect(policy.remainingSeconds(null)).toBe(7200);
    expect(policy.remainingSeconds("not a number")).toBe(7200);
  });

  test("the ceiling is checked before the idle limit", () => {
    expect(policy.endReason({ age_seconds: 7200, idle_seconds: 5000 })).toBe("session_max_age");
    expect(policy.endReason({ age_seconds: 600, idle_seconds: 1801 })).toBe("inactivity_timeout");
    expect(policy.endReason({ age_seconds: 600, idle_seconds: 1800 })).toBeNull();
  });

  test("the clock the client locks by", () => {
    expect(policy.clock(3600)).toEqual({ expires_in: 900, session_expires_in: 3600, session_max_age: 7200, session_idle_limit: 1800 });
  });
});

describe("sign-in cooldown", () => {
  const at = (failures, secondsAgo, now = 1_000_000_000) => ({
    user: { failed_login_count: failures, last_failed_login_at: new Date(now - secondsAgo * 1000) },
    now,
  });

  test("the first five wrong passwords cost nothing", () => {
    for (let n = 0; n <= 5; n += 1) {
      const { user, now } = at(n, 0);
      expect(throttle.waitSeconds(user, now)).toBe(0);
    }
  });

  test("after that the wait doubles, counted from the last failure", () => {
    expect(throttle.waitSeconds(at(6, 0).user, at(6, 0).now)).toBe(2);
    expect(throttle.waitSeconds(at(8, 0).user, at(8, 0).now)).toBe(8);
    expect(throttle.waitSeconds(at(8, 5).user, at(8, 5).now)).toBe(3);
    expect(throttle.waitSeconds(at(8, 9).user, at(8, 9).now)).toBe(0);
  });

  test("it never passes fifteen minutes and never latches", () => {
    expect(throttle.waitSeconds(at(40, 0).user, at(40, 0).now)).toBe(15 * 60);
    expect(throttle.waitSeconds(at(40, 15 * 60).user, at(40, 15 * 60).now)).toBe(0);
  });

  test("a wait is said in seconds, then minutes", () => {
    expect(throttle.sayWait(1)).toBe("1 second");
    expect(throttle.sayWait(30)).toBe("30 seconds");
    expect(throttle.sayWait(61)).toBe("2 minutes");
    expect(throttle.sayWait(60)).toBe("1 minute");
  });
});

describe("password policy", () => {
  const fieldOf = async (password, ctx) => {
    try {
      await passwordPolicy.assert(password, ctx);
      return null;
    } catch (err) {
      return { code: err.code, status: err.status, fields: err.fields };
    }
  };

  test("eight characters with both cases, a number and a symbol", async () => {
    expect(await fieldOf("Short1!")).toEqual({ code: "WEAK_PASSWORD", status: 422, fields: { new_password: ["At least 8 characters"] } });
    expect((await fieldOf("ALLUPPER1!")).fields.new_password).toEqual(["Add a lowercase letter"]);
    expect((await fieldOf("alllower1!")).fields.new_password).toEqual(["Add an uppercase letter"]);
    expect((await fieldOf("NoNumber!!")).fields.new_password).toEqual(["Add a number"]);
    expect((await fieldOf("NoSymbol12")).fields.new_password).toEqual(["Add a symbol"]);
    expect(await fieldOf("Good-pass9")).toBeNull();
  });

  test("not the name part of the person's own email, on the field asked for", async () => {
    const r = await fieldOf("Adaeze-2026!", { email: "adaeze@mycityapp.io", field: "password" });
    expect(r.fields).toEqual({ password: ["Contains your email name"] });
    expect(await fieldOf("Adaeze-2026!", { email: "bo@mycityapp.io" })).toBeNull();
  });

  test("every field mark is four words or fewer", async () => {
    const marks = ["Short1!", "ALLUPPER1!", "alllower1!", "NoNumber!!", "NoSymbol12"];
    for (const p of marks) {
      const r = await fieldOf(p);
      expect(r.fields.new_password[0].split(/\s+/).length).toBeLessThanOrEqual(4);
    }
  });

  test("the breach check sends five characters of a hash and matches the rest here", async () => {
    let asked = null;
    // SHA-1 of "password" is 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8.
    const fetchImpl = async (url, init) => {
      asked = { url, init };
      return { ok: true, text: async () => "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0000000000000000000000000000000000A:0" };
    };
    const hit = await passwordPolicy.checkBreached("password", { fetchImpl });
    expect(asked.url).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    expect(asked.init.headers["Add-Padding"]).toBe("true");
    expect(hit).toEqual({ checked: true, breached: true });
    const miss = await passwordPolicy.checkBreached("Good-pass9-unlikely", { fetchImpl });
    expect(miss).toEqual({ checked: true, breached: false });
  });

  test("an unreachable breach service allows the password", async () => {
    const down = async () => {
      throw new Error("offline");
    };
    expect(await passwordPolicy.checkBreached("whatever", { fetchImpl: down })).toEqual({ checked: false, breached: false });
    const refused = async () => ({ ok: false, text: async () => "" });
    expect(await passwordPolicy.checkBreached("whatever", { fetchImpl: refused })).toEqual({ checked: false, breached: false });
  });
});

describe("device label", () => {
  test("browser and system from the User-Agent", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0")).toBe("Edge on Windows");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("")).toBe("Unknown device");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)")).toBe("Mac");
  });
});

describe("the contract and the access catalogue", () => {
  test("the wire's actions are the catalogue's actions, in order", () => {
    expect(c.identity.ACTIONS).toEqual(catalog.ACTIONS);
  });

  test("a new password the contract accepts, the policy's shape accepts too", () => {
    expect(c.identity.NewPassword.safeParse("Good-pass9").success).toBe(true);
    expect(c.identity.PASSWORD_MIN).toBe(8);
  });

  test("the wire's capability code rule is the catalogue's, and every catalogued code passes it", () => {
    expect(c.identity.CAPABILITY_CODE.source).toBe(catalog.CAPABILITY_CODE.source);
    for (const code of catalog.CAPABILITIES) expect(c.identity.CapabilityCode.parse(code)).toBe(code);
    expect(c.identity.CapabilityCode.safeParse("home.alerts.manage").success).toBe(false);
    expect(c.access.RoleSave.shape.capabilities.element).toBe(c.identity.CapabilityCode);
  });

  test("/me carries the capabilities, and Settings · Roles can save every catalogued one", () => {
    expect(c.identity.Me.shape.capabilities.element).toBe(c.identity.CapabilityCode);
    const role = { name: "Leads", grants: [], visible_fields: [], capabilities: catalog.CAPABILITIES };
    expect(c.access.RoleSave.parse(role).capabilities).toEqual(catalog.CAPABILITIES);
  });
});
