"use strict";
/** Mailbox's rules that need no database or mail server (the API is covered in tests/integration/mailbox.test.js). */
const { kindOf, mapFolders, cursorFor } = require("./folders");
const {
  threadKeyFor,
  baseSubject,
  normaliseReferences,
  snippetOf,
} = require("./threading");
const { mapSmtpError, mapImapError, retryPlan } = require("./smtp-errors");
const { cleanHtml, textToHtml } = require("./visible");
const { outgoingHtml, textOf } = require("./compose");
const { settingsFor } = require("./autodiscover");
const { normalise, bareAddress } = require("./providers/imap-smtp.provider");
const { routesOf } = require("../../http/route");
const { router } = require("./mailbox.routes");

describe("folders", () => {
  test("special-use flags first, then INBOX, then names", () => {
    expect(kindOf({ path: "INBOX.Sent Messages", flags: ["\\Sent"] })).toBe(
      "sent",
    );
    expect(kindOf({ path: "INBOX", flags: [] })).toBe("inbox");
    expect(kindOf({ path: "INBOX.Junk", delimiter: ".", flags: [] })).toBe(
      "spam",
    );
    expect(
      kindOf({ path: "INBOX.Deleted Items", delimiter: ".", flags: [] }),
    ).toBe("trash");
    expect(
      kindOf({ path: "INBOX.Receipts", delimiter: ".", flags: [] }),
    ).toBeNull();
  });
  test("each kind is claimed once; the rest are kept but not synced", () => {
    const rows = mapFolders([
      { path: "Sent", flags: ["\\Sent"] },
      { path: "Sent Items", flags: [] },
      { path: "INBOX", flags: [] },
    ]);
    expect(rows.map((r) => [r.remote_key, r.kind])).toEqual([
      ["INBOX", "inbox"],
      ["Sent", "sent"],
      ["Sent Items", null],
    ]);
  });
  test("a renumbered folder is read again from the start", () => {
    expect(cursorFor({ uidvalidity: 5, last_uid: 40 }, 5)).toEqual({
      last_uid: 40,
      rescanned: false,
    });
    expect(cursorFor({ uidvalidity: 5, last_uid: 40 }, 6)).toEqual({
      last_uid: 0,
      rescanned: true,
    });
    expect(cursorFor({ uidvalidity: null, last_uid: null }, 6)).toEqual({
      last_uid: 0,
      rescanned: false,
    });
  });
});

describe("threading", () => {
  test("the root of References, else In-Reply-To, else the message's own id; never the subject", () => {
    expect(
      threadKeyFor({
        messageId: "<c@x>",
        inReplyTo: "<b@x>",
        references: ["<a@x>", "<b@x>"],
      }),
    ).toBe("<a@x>");
    expect(threadKeyFor({ messageId: "<c@x>", inReplyTo: "b@x" })).toBe(
      "<b@x>",
    );
    expect(threadKeyFor({ messageId: "c@x" })).toBe("<c@x>");
    expect(normaliseReferences("<a@x> <a@x>  <b@x>")).toEqual([
      "<a@x>",
      "<b@x>",
    ]);
  });
  test("reply prefixes come off, a bounded number of times", () => {
    expect(baseSubject("Re: Fwd: RE: Venue list")).toBe("Venue list");
    expect(baseSubject(`${"Re: ".repeat(50)}x`)).toMatch(/^Re: /);
    expect(snippetOf("  a\n\nb  ")).toBe("a b");
  });
});

describe("what a mail server's refusal means", () => {
  test("the ladder: password, sender, recipient, temporary, other", () => {
    expect(
      mapSmtpError({
        code: "EAUTH",
        responseCode: 535,
        response: "535 Incorrect authentication data",
      }).code,
    ).toBe("MAIL_AUTH_FAILED");
    expect(
      mapSmtpError({ responseCode: 550, response: "550 Sender verify failed" })
        .code,
    ).toBe("SENDER_REFUSED");
    expect(
      mapSmtpError({ responseCode: 550, response: "550 5.1.1 User unknown" })
        .code,
    ).toBe("RECIPIENT_REFUSED");
    expect(
      mapSmtpError({ responseCode: 451, response: "451 Greylisted, try again" })
        .code,
    ).toBe("MAIL_DEFERRED");
    expect(
      mapSmtpError({ responseCode: 552, response: "552 Message size exceeds" })
        .code,
    ).toBe("MESSAGE_REFUSED");
    expect(
      mapImapError({ authenticationFailed: true, message: "Command failed" })
        .code,
    ).toBe("MAIL_AUTH_FAILED");
    expect(
      mapImapError({
        code: "ENOTFOUND",
        message: "getaddrinfo ENOTFOUND mail.x.test",
      }).code,
    ).toBe("MAIL_SERVER_NOT_FOUND");
  });
  test("a permanent refusal is never retried; a deferral is, three times", () => {
    expect(
      retryPlan(
        mapSmtpError({ responseCode: 550, response: "User unknown" }),
        1,
      ).retryAt,
    ).toBeNull();
    const now = Date.parse("2026-10-17T09:00:00Z");
    expect(
      retryPlan(
        mapSmtpError({ responseCode: 451, response: "try again" }),
        0,
        now,
      ).retryAt.toISOString(),
    ).toBe("2026-10-17T09:00:30.000Z");
    expect(
      retryPlan(
        mapSmtpError({ responseCode: 451, response: "try again" }),
        3,
        now,
      ).retryAt,
    ).toBeNull();
  });
});

describe("HTML in and out", () => {
  test("received mail: no scripts, handlers, javascript: or frames; links open outside", () => {
    const out = cleanHtml(
      '<p onclick="x()">Hi <a href="javascript:alert(1)">a</a> <a href="https://x.test">b</a></p><script>alert(1)</script><iframe src="https://x"></iframe><div style="color:red;background:url(javascript:x)">c</div>',
    );
    expect(out).not.toMatch(/script|onclick|javascript|iframe/);
    expect(out).toContain(
      'href="https://x.test" target="_blank" rel="noopener noreferrer"',
    );
    expect(out).toContain("color:red");
    expect(cleanHtml("<script>only</script>")).toBeNull();
    expect(textToHtml("a & b\nc\n\nd")).toBe("<p>a &amp; b<br>c</p><p>d</p>");
  });
  test("sent mail: the composer's tools only, and a plain text part", () => {
    const html = outgoingHtml(
      '<h2>Agenda</h2><p><strong>Monday</strong> <a href="http://x.test">x</a><img src="https://t"></p><ul><li>One</li></ul>',
    );
    expect(html).not.toMatch(/img|http:/);
    expect(textOf(html)).toBe("Agenda\n\nMonday x\n\n- One");
  });
});

describe("autodiscover", () => {
  test("a company address goes to its own domain on 993 and 465, where the certificate is; consumer mail is refused", () => {
    expect(settingsFor("Ada@MyCityApp.io")).toMatchObject({
      incoming_host: "mycityapp.io",
      outgoing_host: "mycityapp.io",
      incoming_port: 993,
      outgoing_port: 465,
      username: "ada@mycityapp.io",
      tls: true,
    });
    expect(
      settingsFor("ada@mycityapp.io", {
        MAIL_IMAP_HOST: "server123.web-hosting.com",
      }).incoming_host,
    ).toBe("server123.web-hosting.com");
    expect(() => settingsFor("ada@gmail.com")).toThrow(
      "Use your company address",
    );
  });
});

describe("the provider", () => {
  test("a parsed message: addresses, read state from \\Seen, files with their cid", () => {
    const m = normalise(
      {
        messageId: "<a@x>",
        from: { value: [{ address: "o@mtn.ng", name: " MTN " }] },
        to: { value: [{ address: "b@mycity.test" }] },
        subject: "Hi",
        text: "Hello",
        attachments: [
          {
            filename: "a.pdf",
            contentType: "application/pdf",
            size: 3,
            content: Buffer.from("abc"),
            cid: "x1",
          },
        ],
      },
      { uid: 9, flags: new Set(["\\Seen"]) },
    );
    expect(m).toMatchObject({
      uid: 9,
      from: "o@mtn.ng",
      fromName: "MTN",
      to: ["b@mycity.test"],
      seen: true,
    });
    expect(m.attachments[0]).toMatchObject({
      filename: "a.pdf",
      contentId: "x1",
      inline: false,
    });
  });
  test("the envelope sender is the bare address", () => {
    expect(bareAddress('"Bola Ade" <bola@mycity.test>')).toBe(
      "bola@mycity.test",
    );
  });
});

test("every mailbox route carries the mailbox grant", () => {
  for (const r of routesOf(router))
    expect(r.permission && r.permission.key).toBe("mailbox");
});
