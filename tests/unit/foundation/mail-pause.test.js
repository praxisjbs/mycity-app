"use strict";
/**
 * System mail paused, and addresses the mail server refused (docs/guides/integrations.md
 * §6.15, §6.16): what the queues do with paused mail, a link that stopped working while it
 * waited, a refusal that is final, notices pushed in place of their email, the Status check
 * and the place a fault names.
 */

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function fakeJob(data) {
  return {
    data,
    timestamp: Date.now(),
    moved: null,
    moveToDelayed(at, token) {
      this.moved = { at, token };
    },
    updateData: jest.fn(async function (next) {
      this.data = next;
    }),
  };
}

describe("a message the mail queue holds or finishes", () => {
  const invite = (link) => ({ to: "ada@mycity.io", template: "user-invite", data: { link_url: link } });

  test("paused: it waits 15 minutes, tagged so Resume releases it", async () => {
    jest.doMock("../../../src/services/mail/system-mail.service", () => ({
      send: async () => {
        throw Object.assign(new Error("system mail is paused"), { code: "MAIL_PAUSED" });
      },
    }));
    const emailSend = require("../../../src/jobs/handlers/email-send");
    const job = fakeJob({ to: "ada@mycity.io", template: "scheduled-report", data: {} });
    const before = Date.now();
    await expect(emailSend(job, "tok")).rejects.toMatchObject({ name: "DelayedError" });
    expect(job.data.held_for).toBe("pause");
    expect(job.moved.at).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
  });

  test("refused for good: the job finishes, reported once as a warning, never retried", async () => {
    const reportRefused = jest.fn();
    jest.doMock("../../../src/services/mail/system-mail.service", () => ({
      reportRefused,
      send: async () => {
        throw Object.assign(new Error("refused"), { code: "MAIL_REFUSED", rejected: ["ada@gheil.com"], smtpCode: 550 });
      },
    }));
    const emailSend = require("../../../src/jobs/handlers/email-send");
    await expect(emailSend(fakeJob({ to: "ada@gheil.com", template: "scheduled-report", data: {} }), "tok")).resolves.toEqual({
      template: "scheduled-report",
      refused: 1,
    });
    expect(reportRefused).toHaveBeenCalledWith(expect.objectContaining({ code: "MAIL_REFUSED" }), { queue: "email-send", template: "scheduled-report" });
  });

  test("an invitation whose link was replaced or expired is dropped, not sent", async () => {
    const send = jest.fn();
    jest.doMock("../../../src/services/mail/system-mail.service", () => ({ send }));
    jest.doMock("../../../src/modules/identity/identity.service", () => ({ linkStillOpen: async (url) => url.endsWith("good") }));
    const emailSend = require("../../../src/jobs/handlers/email-send");
    await expect(emailSend(fakeJob(invite("https://hub.x/welcome?token=old")), "tok")).resolves.toEqual({ template: "user-invite", skipped: "link_closed" });
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValue({ message_id: "m1", accepted: ["ada@mycity.io"], rejected: [] });
    await expect(emailSend(fakeJob(invite("https://hub.x/welcome?token=good")), "tok")).resolves.toMatchObject({ message_id: "m1" });
  });
});

describe("system mail while paused", () => {
  /** System mail over a sender that is paused; the route check stands in for the network. */
  function pausedMail() {
    // The tests above replace the real module; these need it.
    jest.dontMock("../../../src/services/mail/system-mail.service");
    jest.doMock("../../../src/shared/integrations/settings", () => ({
      of: async () => ({
        code: "mail_sender",
        source: "saved",
        values: { host: "mail.example.test", port: 465, security: "tls", username: "no-reply@example.test", from: "no-reply@example.test", per_hour: 10 },
        secrets: { password: "x" },
        unreadable: [],
        saved_at: "2026-10-21T05:00:00.000Z",
        paused_at: "2026-10-21T06:00:00.000Z",
      }),
      bump: async () => {},
      forget: () => {},
    }));
    jest.doMock("../../../src/services/mail/deliverability/route-check", () => ({
      assertRoutable: async () => {
        throw Object.assign(new Error("reached the route check"), { code: "ROUTED" });
      },
    }));
    return require("../../../src/services/mail/system-mail.service");
  }

  test("a notice, a digest or a report stops before anything is rendered or counted", async () => {
    const mail = pausedMail();
    for (const template of ["notification", "digest", "scheduled-report", "payslip-ready"])
      await expect(mail.send({ to: "ada@mycity.io", template, data: {} })).rejects.toMatchObject({ code: "MAIL_PAUSED" });
    expect(await mail.paused()).toBe(true);
  });

  test("an invitation, a reset and the test email still go on to be sent", async () => {
    const mail = pausedMail();
    for (const template of ["user-invite", "password-reset", "integration-test"])
      await expect(mail.send({ to: "ada@mycity.io", template, data: {} })).rejects.toMatchObject({ code: "ROUTED" });
  });

  test("Status reads Mail as degraded and paused, which keeps the release ready", async () => {
    const mail = pausedMail();
    expect(await mail.health()).toEqual({ status: "degraded", mode: "paused", paused_at: "2026-10-21T06:00:00.000Z" });
    const health = require("../../../src/modules/system_health/system_health.service");
    const v = { status: "degraded", mode: "paused" };
    expect(health.detailOf("mail", v)).toBe("Paused: invitations and password resets only");
    expect(health.pausedMail("mail", v)).toBe(true);
    expect(health.pausedMail("mail", { status: "degraded", mode: "not_set_up" })).toBe(false);
  });
});

describe("what counts as a refused address", () => {
  const { refusalOf } = require("../../../src/services/mail/system-mail.service");
  const envelope = (response, rejected) =>
    Object.assign(new Error("Can't send mail - all recipients were rejected"), {
      code: "EENVELOPE",
      command: "RCPT TO",
      response,
      responseCode: Number(response.slice(0, 3)),
      rejected,
    });

  test("cPanel's 550 for a mailbox or a domain that does not exist", () => {
    const reply =
      "550-The mail server could not deliver mail to ada@gheil.com.  The\n550-account or domain may not exist, they may be blacklisted, or missing the\n550 proper dns entries.";
    expect(refusalOf(envelope(reply, ["ada@gheil.com"]))).toEqual({ rejected: ["ada@gheil.com"], smtpCode: 550, reply });
  });

  test("not a server over its own hourly limit, a deferral, or another failure", () => {
    expect(refusalOf(envelope("550 Domain mycityapp.io has exceeded the max emails per hour (50/50 (100%)) allowed.", ["a@x.com"]))).toBeNull();
    expect(refusalOf(envelope("451 Temporary local problem, try later", ["a@x.com"]))).toBeNull();
    expect(refusalOf(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }))).toBeNull();
  });
});

describe("a notice due by email while mail is paused", () => {
  function deliverWith({ paused }) {
    const enqueued = [];
    const send = jest.fn(async () => ({ message_id: "m", accepted: [], rejected: [] }));
    jest.doMock("../../../src/services/mail/system-mail.service", () => ({ paused: async () => paused, send, reportRefused: jest.fn() }));
    jest.doMock("../../../src/services/realtime/emitter", () => ({ toUser: () => false }));
    jest.doMock("../../../src/jobs/queues", () => ({ enqueue: async (...args) => enqueued.push(args) }));
    jest.doMock("../../../src/modules/notifications/notifications.service", () => ({
      PUSH_RETRY: { attempts: 8 },
      quietUntil: async () => new Map(),
      passesQuiet: () => false,
      asNotice: async (row) => row,
    }));
    jest.doMock("../../../src/config/db", () => ({
      pool: {
        query: async () => ({ rows: [{ user_id: "u1", email: "ada@mycity.io", first_name: "Ada", last_name: "Obi" }] }),
      },
    }));
    return { deliver: require("../../../src/jobs/handlers/notification-deliver"), enqueued, send };
  }

  const rows = [
    { notification_id: "n1", user_id: "u1", channels: ["in_app", "email"], title: "Payslip ready" },
    { notification_id: "n2", user_id: "u1", channels: ["in_app", "email", "push"], title: "New sign-in" },
  ];

  test("is pushed instead, its push switch off or not, and never emailed later", async () => {
    const { deliver, enqueued, send } = deliverWith({ paused: true });
    const out = await deliver(fakeJob({ notifications: rows, event: { key: "payslip.published" } }), "tok");
    expect(send).not.toHaveBeenCalled();
    expect(out).toMatchObject({ email: 0, email_paused: 2, push_queued: 2 });
    const data = enqueued.map(([queue, , d]) => [queue, d.notification_id, d.instead_of_email === true]);
    expect(data).toEqual([
      ["notification-push", "n1", true],
      ["notification-push", "n2", false],
    ]);
  });

  test("a day-old notice woken late is not pushed in place of its email", async () => {
    const { deliver, enqueued } = deliverWith({ paused: true });
    const job = fakeJob({ notifications: [rows[0]], event: { key: "payslip.published" } });
    job.timestamp = Date.now() - 25 * 60 * 60 * 1000;
    await deliver(job, "tok");
    expect(enqueued).toEqual([]);
  });

  test("with mail on, it is emailed and pushed only where push is on, as before", async () => {
    const { deliver, enqueued, send } = deliverWith({ paused: false });
    const out = await deliver(fakeJob({ notifications: rows, event: { key: "payslip.published" } }), "tok");
    expect(send).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ email: 2, email_paused: 0, push_queued: 1 });
    expect(enqueued.map(([, , d]) => d.notification_id)).toEqual(["n2"]);
  });
});

describe("the place a fault names", () => {
  test("is the first line of the stack that says where, not a second line of the message", () => {
    const { fingerprint } = require("../../../src/shared/observability/error-reporter");
    const err = new Error("Can't send mail: 550-The mail server could not deliver mail to <email>.\n550-account or domain may not exist");
    err.stack = `Error: ${err.message}\n    at SMTPConnection._formatError (/srv/x/node_modules/nodemailer/lib/smtp-connection/index.js:814:19)\n    at next (/srv/x/a.js:1:1)`;
    expect(fingerprint(err)).toMatch(/\|at SMTPConnection\._formatError \(\/srv\/x\/node_modules\/nodemailer\/lib\/smtp-connection\/index\.js\)$/);
  });
});
