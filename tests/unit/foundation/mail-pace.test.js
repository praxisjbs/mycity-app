"use strict";
/**
 * System mail pacing (services/mail/pace.js): the rolling hour, and the jobs that wait for a
 * slot instead of failing. The Redis script is the same arithmetic; it runs against a real
 * Redis in the cloud bench (docs/runbooks/dns-and-mail.md §4).
 */
const pace = require("../../../src/services/mail/pace");

describe("the rolling hour", () => {
  beforeEach(() => pace.__reset());
  const t0 = Date.parse("2026-10-16T09:00:00Z");

  test("recipients fit until the limit, then the wait is until the oldest leaves the hour", async () => {
    expect(await pace.reserve(2, { limit: 3, now: t0 })).toEqual({ ok: true, wait_ms: 0, used: 2 });
    expect(await pace.reserve(1, { limit: 3, now: t0 + 60000 })).toEqual({ ok: true, wait_ms: 0, used: 3 });
    const full = await pace.reserve(1, { limit: 3, now: t0 + 120000 });
    expect(full.ok).toBe(false);
    expect(full.wait_ms).toBe(pace.WINDOW_MS - 120000);
    // two at once must wait for both of the first pair to leave, not only the oldest
    expect((await pace.reserve(2, { limit: 3, now: t0 + 120000 })).wait_ms).toBe(pace.WINDOW_MS - 120000);
    expect((await pace.reserve(3, { limit: 3, now: t0 + 120000 })).wait_ms).toBe(pace.WINDOW_MS - 60000);
    expect((await pace.reserve(2, { limit: 3, now: t0 + pace.WINDOW_MS })).ok).toBe(true);
  });

  test("more recipients than an hour allows can never be sent; 0 means no pacing", async () => {
    await expect(pace.reserve(41, { limit: 40, now: t0 })).rejects.toThrow(/more than the hourly sending limit of 40/);
    expect(await pace.reserve(500, { limit: 0, now: t0 })).toEqual({ ok: true, wait_ms: 0, used: 0 });
  });
});

describe("a job over the limit waits instead of failing", () => {
  afterEach(() => jest.resetModules());

  function fakeJob() {
    return { data: { to: "ada@mycity.io", template: "user-invite" }, moved: null, moveToDelayed(at, token) { this.moved = { at, token }; } };
  }

  test("email-send moves itself to delayed and throws DelayedError, using no attempt", async () => {
    jest.doMock("../../../src/services/mail/system-mail.service", () => ({
      send: async () => { throw new (require("../../../src/services/mail/pace").MailPacedError)(120000); },
    }));
    const emailSend = require("../../../src/jobs/handlers/email-send");
    const job = fakeJob();
    const before = Date.now();
    await expect(emailSend(job, "tok")).rejects.toMatchObject({ name: "DelayedError" });
    expect(job.moved.token).toBe("tok");
    expect(job.moved.at).toBeGreaterThanOrEqual(before + 120000);
    expect(job.moved.at).toBeLessThan(before + 120000 + 16000);
  });

  test("with no sender set up, the job waits 15 minutes, tagged so saving a sender releases it", async () => {
    jest.doMock("../../../src/services/mail/system-mail.service", () => ({
      send: async () => {
        throw Object.assign(new Error("system mail is not set up"), { code: "MAIL_NOT_SET_UP" });
      },
    }));
    const emailSend = require("../../../src/jobs/handlers/email-send");
    const job = { ...fakeJob(), updateData: jest.fn(async function (data) { this.data = data; }) };
    const before = Date.now();
    await expect(emailSend(job, "tok")).rejects.toMatchObject({ name: "DelayedError" });
    expect(job.data.held_for).toBe("sender");
    expect(job.moved.at).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
  });

  test("a message with more recipients than the hour allows fails for good", async () => {
    jest.doMock("../../../src/services/mail/system-mail.service", () => ({
      send: async () => { throw new Error("system mail: 60 recipients is more than the hourly sending limit of 40"); },
    }));
    const emailSend = require("../../../src/jobs/handlers/email-send");
    await expect(emailSend(fakeJob(), "tok")).rejects.toMatchObject({ name: "UnrecoverableError" });
  });
});

describe("system mail with no sender set up anywhere (docs/guides/integrations.md §6.8)", () => {
  afterEach(() => jest.resetModules());

  function mailWith(unset) {
    // The tests above replace the real module; these need it.
    jest.dontMock("../../../src/services/mail/system-mail.service");
    jest.doMock("../../../src/config/env", () => {
      const actual = jest.requireActual("../../../src/config/env");
      return { ...actual, config: { ...actual.config, MAIL_UNSET: unset } };
    });
    jest.doMock("../../../src/shared/integrations/settings", () => ({ of: async () => null, secret: async () => null, bump: async () => {}, forget: () => {} }));
    return require("../../../src/services/mail/system-mail.service");
  }

  test("a server holds it: nothing is sent and nothing is faked", async () => {
    const mail = mailWith("hold");
    await expect(mail.send({ to: "ada@mycity.io", template: "user-invite", data: {} })).rejects.toMatchObject({ code: "MAIL_NOT_SET_UP" });
    expect(await mail.health()).toMatchObject({ status: "degraded", mode: "not_set_up" });
  });

  test("a laptop or CI keeps it in memory, as before", async () => {
    const mail = mailWith("capture");
    expect(await mail.health()).toEqual({ status: "up", mode: "captured" });
  });
});
