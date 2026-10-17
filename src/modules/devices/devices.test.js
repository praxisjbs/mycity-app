"use strict";
/**
 * Devices: the device decision under each policy mode, the cap, and the routes. The
 * registration (the session's own device, the fresh sign-in, the cap under two tabs at
 * once) runs against Postgres in tests/integration/attendance.test.js. Devices here are
 * invented.
 */
const { routesOf } = require("../../http/route");
const guard = require("./devices.guard");

describe("the device decision", () => {
  const judge = (over) =>
    guard.evaluateDevice({ mode: "warn", status: "registered", first_seen: false, has_session_device: true, ...over });

  test("a registered device is known and accepted under every mode", () => {
    for (const mode of ["off", "warn", "block"])
      expect(judge({ mode })).toEqual({ state: "registered", known: true, reason: null, result: "accepted", exception: null });
  });

  test("an unregistered device: off accepts, warn reviews, block rejects", () => {
    expect(judge({ mode: "off", status: "observed" })).toMatchObject({ known: false, result: "accepted", exception: null });
    expect(judge({ mode: "warn", status: "observed" })).toMatchObject({ known: false, result: "review", exception: "unknown_device", reason: "not_registered" });
    expect(judge({ mode: "block", status: "observed" })).toMatchObject({ known: false, result: "rejected", exception: null });
  });

  test("a device seen for the first time is unknown, named new", () => {
    expect(judge({ status: "observed", first_seen: true })).toMatchObject({ state: "observed", reason: "new", result: "review" });
  });

  test("a removed device is unknown again", () => {
    expect(judge({ status: "removed" })).toMatchObject({ state: "removed", reason: "removed", result: "review" });
    expect(judge({ status: "removed", mode: "block" })).toMatchObject({ result: "rejected" });
  });

  test("a session with no device is unknown; there is no exemption by role", () => {
    expect(judge({ has_session_device: false, status: null })).toMatchObject({ state: "none", reason: "no_device", result: "review" });
    expect(judge({ has_session_device: false, status: null, mode: "off" })).toMatchObject({ result: "accepted" });
  });

  test("three registered at most", () => {
    expect(guard.canRegister(0, 3)).toBe(true);
    expect(guard.canRegister(2, 3)).toBe(true);
    expect(guard.canRegister(3, 3)).toBe(false);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./devices.routes").router);

  test("my devices are self and take no device identifier; People's carry the people grant", () => {
    expect(routes.length).toBe(6);
    for (const r of routes) {
      if (r.path.startsWith("/mine")) expect(r.contract.self).toBe(true);
      else expect(r.permission && r.permission.key).toBe("people");
    }
    const register = routes.find((r) => r.method === "POST" && r.path === "/mine");
    expect(Object.keys(register.contract.body.shape)).toEqual(["label"]);
  });
});
