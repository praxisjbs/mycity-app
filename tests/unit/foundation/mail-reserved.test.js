"use strict";
/**
 * An address at a name that can never take mail (RFC 2606, RFC 6761), such as the staging seed's
 * invented `@example.test` candidates, is never handed to the mail server: it is logged as not sent
 * instead of bouncing back to the sender. A real address is sent as before, and captured mail (no
 * sender set up) keeps every address.
 */

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

/** System mail over a working sender; nodemailer, the route check and the pace stand in for the network. */
function mailWithSender() {
  const sendMail = jest.fn(async (m) => ({ messageId: "m1", accepted: [].concat(m.to).map((a) => (typeof a === "string" ? a : a.address)), rejected: [] }));
  jest.doMock("nodemailer", () => ({ createTransport: () => ({ sendMail, close: () => {} }) }));
  jest.doMock("../../../src/shared/integrations/settings", () => ({
    of: async () => ({
      code: "mail_sender",
      source: "saved",
      values: { host: "mail.mycityapp.io", port: 465, security: "tls", username: "no-reply@mycityapp.io", from: "no-reply@mycityapp.io", per_hour: 40 },
      secrets: { password: "x" },
      unreadable: [],
      saved_at: "2026-10-21T05:00:00.000Z",
      paused_at: null,
    }),
  }));
  const routed = jest.fn(async () => {});
  jest.doMock("../../../src/services/mail/deliverability/route-check", () => ({ assertRoutable: routed }));
  const reserve = jest.fn(async () => ({ ok: true }));
  jest.doMock("../../../src/services/mail/pace", () => ({ reserve, MailPacedError: class extends Error {} }));
  const { logger } = require("../../../src/config/logger");
  const info = jest.spyOn(logger, "info").mockImplementation(() => {});
  return { mail: require("../../../src/services/mail/system-mail.service"), sendMail, routed, reserve, info };
}

describe("a name that can never take mail", () => {
  test("is the reserved names and every name under them, and nothing else", () => {
    const { neverDelivered } = require("../../../src/services/mail/system-mail.service");
    for (const a of ["ada@example.test", "ADA@Example.Test", "b@mail.example.test", "c@site.example", "d@x.invalid", "e@localhost", "f@example.com", "g@sub.example.org", { address: "h@example.net" }])
      expect(neverDelivered(a)).toBe(true);
    for (const a of ["ada@mycityapp.io", "ada@gmail.com", "ada@contest.ng", "ada@example.com.ng", "ada@testing.com", "ada@myexample.com", { address: "h@mycity.io" }])
      expect(neverDelivered(a)).toBe(false);
  });

  test("a message only to such names is never handed to the server, and is logged as not sent", async () => {
    const { mail, sendMail, routed, reserve, info } = mailWithSender();
    const out = await mail.send({ to: { name: "Tolu Ade", email: "tolu.ade@example.test" }, template: "candidate-not-progressed", data: {} });
    expect(out).toEqual({ message_id: null, accepted: [], rejected: [], not_sent: ["tolu.ade@example.test"] });
    expect(sendMail).not.toHaveBeenCalled();
    expect(routed).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith({ template: "candidate-not-progressed", to: ["tolu.ade@example.test"] }, expect.stringContaining("not sent"));
  });

  test("beside a real address it is left off, and the real one is sent as before", async () => {
    const { mail, sendMail, routed, reserve } = mailWithSender();
    const out = await mail.sendPlain({ to: ["ops@mycityapp.io", "seed@example.test"], cc: "nobody@example.test", subject: "Health", text: "All well" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: ["ops@mycityapp.io"], cc: undefined });
    expect(routed).toHaveBeenCalledWith(expect.objectContaining({ to: ["ops@mycityapp.io"] }));
    expect(reserve).toHaveBeenCalledWith(1, expect.anything());
    expect(out.accepted).toEqual(["ops@mycityapp.io"]);
  });

  test("a real address alone is untouched", async () => {
    const { mail, sendMail } = mailWithSender();
    await mail.sendPlain({ to: "ops@mycityapp.io", subject: "Health", text: "All well" });
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: ["ops@mycityapp.io"] });
  });

  test("captured mail (no sender set up) keeps every address, so tests still read it", async () => {
    jest.doMock("../../../src/shared/integrations/settings", () => ({ of: async () => null }));
    const mail = require("../../../src/services/mail/system-mail.service");
    mail.__reset();
    await mail.sendPlain({ to: "seed@example.test", subject: "Hello", text: "Hi" });
    expect(mail.capturedMail().map((m) => m.to)).toEqual([["seed@example.test"]]);
  });
});
