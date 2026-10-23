"use strict";
/** Mailbox's rules that need no database or real mail server (the API is covered in tests/integration/mailbox.test.js). */
const net = require("node:net");
const { kindOf, mapFolders, cursorFor } = require("./folders");
const {
  threadKeyFor,
  baseSubject,
  normaliseReferences,
  snippetOf,
} = require("./threading");
const { mapSmtpError, mapImapError, retryPlan } = require("../../services/mail/smtp-errors");
const { cleanHtml, textToHtml } = require("./visible");
const { outgoingHtml, textOf } = require("./compose");
const { settingsFor } = require("./autodiscover");
const { normalise, bareAddress, ImapSmtpProvider } = require("./providers/imap-smtp.provider");
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

/** A stand-in IMAP server on a local port: it greets, then answers each command as `answer` says. */
function imapServer(answer) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on("error", () => undefined);
      socket.write("* OK ready\r\n");
      let buffered = "";
      socket.on("data", (chunk) => {
        buffered += chunk;
        for (let at = buffered.indexOf("\r\n"); at >= 0; at = buffered.indexOf("\r\n")) {
          const [tag, command] = buffered.slice(0, at).split(" ");
          buffered = buffered.slice(at + 2);
          answer(socket, tag, String(command).toUpperCase());
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** Signs in and says OK to everything else. */
function obliging(socket, tag, command) {
  if (command === "CAPABILITY") socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK done\r\n`);
  else socket.write(`${tag} OK done\r\n`);
}

const at = (server) => ({
  email: "bola@mycity.test",
  username: "bola",
  password: "mail-pass-1",
  incoming_host: "127.0.0.1",
  incoming_port: server.address().port,
  tls: false,
});

describe("a mail server that hangs up or goes silent (faults #2 and #3, 22/10/2026)", () => {
  const servers = [];
  afterEach(() => servers.splice(0).forEach((s) => s.close()));

  test("hanging up during sign-in fails the call, never the process", async () => {
    const server = await imapServer((socket, tag, command) =>
      command === "AUTHENTICATE" ? socket.end() : obliging(socket, tag, command),
    );
    servers.push(server);
    await expect(new ImapSmtpProvider(at(server)).listFolders()).rejects.toThrow();
    // The library raises its own error a turn later; heard, it ends nothing.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  test("silence fails the call once the connection's wait is up, never the process", async () => {
    const server = await imapServer((socket, tag, command) => {
      if (command !== "LIST") obliging(socket, tag, command);
    });
    servers.push(server);
    const provider = new ImapSmtpProvider(at(server), { socketTimeout: 200 });
    await expect(provider.listFolders()).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  test("a short-lived connection waits 2 minutes on a silent server; IDLE keeps the library's 5", () => {
    const provider = new ImapSmtpProvider({ email: "bola@mycity.test", password: "mail-pass-1", incoming_host: "mycityapp.io" });
    expect(provider.socketTimeout).toBe(2 * 60 * 1000);
    expect(provider.imap().options.socketTimeout).toBeUndefined();
  });
});

test("every mailbox route carries the mailbox grant", () => {
  for (const r of routesOf(router))
    expect(r.permission && r.permission.key).toBe("mailbox");
});
