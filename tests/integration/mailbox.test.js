"use strict";
/**
 * Mailbox, end to end (docs/guides/mailbox.md): the real migrations on a throwaway
 * database, the whole app through HTTP, the outbox drained as the worker would. The mail
 * server is an in-memory stand-in behind the provider's own methods, so connect, sync,
 * read, move, empty and send run as they do against IMAP and SMTP; the provider itself
 * is exercised against a real server by hand (docs/runbooks/dns-and-mail.md).
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/mailbox
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const realtime = require("../../src/services/realtime/emitter");
const mailbox = require("../../src/modules/mailbox/mailbox.service");
const mailboxRepo = require("../../src/modules/mailbox/mailbox.repo");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => undefined),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));
const queues = require("../../src/jobs/queues");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Brand-new9Pass";

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}
async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A mail server in memory: folders of messages by UID, the password it accepts, what was sent. */
function fakeServer() {
  const s = {
    password: "mail-pass-1",
    uidValidity: 7,
    folders: { INBOX: [], "INBOX.Sent": [], "INBOX.Archive": [], "INBOX.Junk": [], "INBOX.Trash": [], "INBOX.Drafts": [] },
    sent: [],
    copies: [],
    onCopy: null,
    seen: [],
    moved: [],
    removed: [],
    nextUid: 1,
    deliver(path, m) {
      s.folders[path].push({ uid: s.nextUid++, ...m });
    },
  };
  const LIST = [
    { path: "INBOX", delimiter: ".", flags: [], specialUse: "\\Inbox" },
    { path: "INBOX.Sent", delimiter: ".", flags: [], specialUse: "\\Sent" },
    { path: "INBOX.Archive", delimiter: ".", flags: [], specialUse: "\\Archive" },
    { path: "INBOX.Junk", delimiter: ".", flags: [], specialUse: "\\Junk" },
    { path: "INBOX.Trash", delimiter: ".", flags: [], specialUse: "\\Trash" },
    { path: "INBOX.Drafts", delimiter: ".", flags: [], specialUse: "\\Drafts" },
    { path: "INBOX.Receipts", delimiter: ".", flags: [], specialUse: null },
  ];
  s.provider = (conn) => ({
    async verify() {
      if (conn.password !== s.password) {
        const err = new Error("Invalid credentials (Failure)");
        err.authenticationFailed = true;
        err.leg = "imap";
        throw err;
      }
      return true;
    },
    async listFolders() {
      if (conn.password !== s.password) throw Object.assign(new Error("AUTHENTICATIONFAILED"), { authenticationFailed: true });
      return LIST;
    },
    async fetchSince(path, { lastUid = 0 }) {
      const messages = (s.folders[path] || []).filter((m) => m.uid > lastUid);
      return { uidValidity: s.uidValidity, lastUid: Math.max(lastUid, ...messages.map((m) => m.uid)), messages, more: false };
    },
    async markSeen(path, id) {
      s.seen.push({ path, id });
      return true;
    },
    async move(from, to, id) {
      s.moved.push({ from, to, id });
      const at = (s.folders[from] || []).findIndex((m) => m.messageId === id);
      if (at >= 0) (s.folders[to] ||= []).push(...s.folders[from].splice(at, 1));
      return true;
    },
    async fetchOne(path, id) {
      return (s.folders[path] || []).find((m) => m.messageId === id) || null;
    },
    async remove(path, ids) {
      s.removed.push({ path, ids });
      return ids.length;
    },
    async send(msg) {
      if (msg.to.includes("bounce@nowhere.test")) {
        const err = new Error("550 5.1.1 <bounce@nowhere.test>: Recipient address rejected: User unknown");
        err.responseCode = 550;
        throw err;
      }
      const messageId = `<sent-${s.sent.length + 1}@mycity.test>`;
      s.sent.push({ ...msg, messageId });
      return { messageId, raw: Buffer.from("raw") };
    },
    async copyToSent(raw) {
      if (s.onCopy) await s.onCopy();
      s.copies.push(raw);
      return "INBOX.Sent";
    },
  });
  return s;
}

const mail = (over) => ({
  messageId: `<m${Math.random().toString(36).slice(2)}@partner.test>`,
  inReplyTo: null,
  references: [],
  from: "o.adesanya@mtn.ng",
  fromName: "MTN Partnerships",
  to: ["bola@mycity.test"],
  cc: [],
  subject: "Venue confirmations",
  html: "<p>Hello</p><script>alert(1)</script><img src=\"https://tracker.example/pixel.gif\"><a href=\"javascript:alert(1)\">x</a>",
  text: "Hello",
  date: new Date(),
  seen: false,
  attachments: [],
  ...over,
});

describeDb("Mailbox against the real migrations", () => {
  let app;
  let token;
  let other;
  const server = fakeServer();
  let ipSeq = 0;

  const api = (t = token) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
    post: (path) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
    put: (path) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
    del: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
  });

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    mailbox.useProvider(server.provider);
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: "Content Associate",
      department_name: "HR & Operations",
      start_date: "2024-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    await tx(async (client) => {
      await createAdmin(client, { employee: sample("Amaka", "Eze", "ceo@mycity.test"), role_code: "management", is_ceo: true }, PASSWORD);
      await createAdmin(client, { employee: sample("Bola", "Ade", "bola@mycity.test"), role_code: "operations_people", is_ceo: false }, PASSWORD);
    });
    await drain();
    const login = async (email) => {
      ipSeq += 1;
      const r = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.42.0.${ipSeq}`).send({ email, password: PASSWORD });
      return r.body.access_token;
    };
    token = await login("bola@mycity.test");
    other = await login("ceo@mycity.test");
  });

  afterAll(async () => {
    mailbox.useProvider(null);
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });
  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  test("no mailbox yet: the connection says so and folders refuse", async () => {
    const c = await api().get("/mailbox/connection");
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ mail_account_id: null, status: "disconnected" });
    expect((await api().get("/mailbox/threads?folder=inbox")).status).toBe(409);
  });

  test("connect: a refused password saves nothing; the right one is stored encrypted and starts a sync", async () => {
    const bad = await api().post("/mailbox/connection").send({ email: "bola@mycity.test", password: "wrong" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.password).toEqual(["Password refused"]);
    expect((await one("SELECT count(*)::int AS n FROM mail_account")).n).toBe(0);
    expect((await api().post("/mailbox/connection").send({ email: "someone@gmail.com", password: "x" })).status).toBe(422);

    const ok = await api().post("/mailbox/connection").send({ email: "bola@mycity.test", password: server.password });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ email: "bola@mycity.test", status: "connected" });
    const row = await one(
      "SELECT a.incoming_host, a.outgoing_host, a.outgoing_port, s.key, s.ciphertext FROM mail_account a JOIN integration_secret s ON s.integration_secret_id = a.integration_secret_id",
    );
    expect(row).toMatchObject({ incoming_host: "mycity.test", outgoing_host: "mycity.test", outgoing_port: 465, key: `mail_conn:${ok.body.mail_account_id}` });
    expect(row.ciphertext).not.toContain(server.password);
    await drain();
    expect(queues.enqueue).toHaveBeenCalledWith("mail-sync", "sync", { mail_account_id: ok.body.mail_account_id }, expect.any(Object));
  });

  test("sync: folders mapped to the six, mail threaded and sanitised, read state from the server, files quarantined", async () => {
    const root = mail({ subject: "Venue confirmations" });
    server.deliver("INBOX", root);
    server.deliver("INBOX", mail({ date: new Date(Date.now() + 1000), subject: "Re: Venue confirmations", inReplyTo: root.messageId, references: [root.messageId], seen: true, attachments: [{ filename: "venues.pdf", contentType: "application/pdf", size: 9, content: Buffer.from("%PDF-1.4\n"), contentId: null, inline: false }] }));
    server.deliver("INBOX.Sent", mail({ from: "bola@mycity.test", fromName: "Bola Ade", to: ["ops@partner.test"], subject: "Agenda", seen: true }));
    server.deliver("INBOX.Junk", mail({ subject: "You won", from: "spam@spam.test" }));
    server.deliver("INBOX", mail({ subject: "Old news", date: new Date(Date.now() - 3 * 86400000) }));

    const { mail_account_id: id } = (await api().get("/mailbox/connection")).body;
    const first = await mailbox.sync(id);
    expect(first.filed).toBe(5);
    expect((await mailbox.sync(id)).filed).toBe(0);

    const kinds = (await q("SELECT kind FROM mail_folder WHERE kind IS NOT NULL ORDER BY kind")).rows.map((r) => r.kind);
    expect(kinds).toEqual(["archive", "drafts", "inbox", "sent", "spam", "trash"]);
    expect((await one("SELECT kind FROM mail_folder WHERE remote_key = 'INBOX.Receipts'")).kind).toBeNull();

    const inbox = await api().get("/mailbox/threads?folder=inbox");
    expect(inbox.status).toBe(200);
    expect(inbox.body.page.total).toBe(2);
    const venue = inbox.body.data.find((t) => t.subject === "Venue confirmations");
    expect(venue).toMatchObject({ unread: true, has_attachment: true, message_count: 2, party: { name: "MTN Partnerships", address: "o.adesanya@mtn.ng" } });
    expect((await api().get("/mailbox/threads?folder=inbox&unread=true")).body.page.total).toBe(2);
    expect((await api().get("/mailbox/threads?folder=sent")).body.data[0]).toMatchObject({ subject: "Agenda", party: { address: "ops@partner.test" } });

    const t = await api().get(`/mailbox/threads/${venue.mail_thread_id}`);
    expect(t.body.messages).toHaveLength(2);
    for (const m of t.body.messages) expect(m.body_html).not.toMatch(/script|javascript:/);
    const withFile = t.body.messages.find((m) => m.attachments.length);
    expect(withFile.attachments[0]).toMatchObject({ file_name: "venues.pdf", mime_type: "application/pdf" });
    const doc = await one("SELECT scan_status, entity_type FROM document WHERE document_id = $1", [withFile.attachments[0].document_id]);
    expect(doc).toEqual({ scan_status: "pending", entity_type: "mail_message" });

    const spam = (await api().get("/mailbox/threads?folder=spam")).body.data[0];
    expect((await api().get(`/mailbox/threads/${spam.mail_thread_id}`)).body.messages[0].body_html).toBeNull();

    // Fresh unread inbound mail notifies (the subject, a new line, the first line); a three-day-old
    // message does not.
    await drain();
    const told = (await q("SELECT title, body FROM notification WHERE event_key = 'mail_message.received' ORDER BY created_at")).rows;
    expect(told).toEqual([{ title: "MTN Partnerships", body: "Venue confirmations\nHello" }]);

    // Nobody else reaches it, the CEO included.
    expect((await api(other).get(`/mailbox/threads/${venue.mail_thread_id}`)).status).toBe(409);
  });

  test("⌘K finds the owner's own mail by subject or sender, and nobody else's, the CEO included", async () => {
    const mailGroup = (r) => r.body.groups.find((g) => g.type === "mail_thread");
    const mine = await api().get("/search?q=venue");
    expect(mine.status).toBe(200);
    const hit = mailGroup(mine).items[0];
    expect(hit).toMatchObject({ title: "Venue confirmations", sub: "bola@mycity.test, o.adesanya@mtn.ng" });
    expect(hit.link).toBe(`/mailbox?tab=inbox&id=${hit.id}`);
    expect(mailGroup(await api().get("/search?q=partnerships")).items.map((i) => i.title)).toContain("Venue confirmations");
    expect(mailGroup(await api(other).get("/search?q=venue"))).toBeUndefined();
  });

  test("read and move: local first, then the server", async () => {
    const venue = (await api().get("/mailbox/threads?folder=inbox")).body.data.find((t) => t.subject === "Venue confirmations");
    expect((await api().post(`/mailbox/threads/${venue.mail_thread_id}/read`).send({})).status).toBe(204);
    expect((await api().get("/mailbox/threads?folder=inbox&unread=true")).body.page.total).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.seen.length).toBe(1);

    expect((await api().post(`/mailbox/threads/${venue.mail_thread_id}/move`).send({ to: "archive" })).status).toBe(204);
    expect((await api().get("/mailbox/threads?folder=archive")).body.data.map((t) => t.subject)).toEqual(["Venue confirmations"]);
    expect((await api().get("/mailbox/threads?folder=inbox")).body.page.total).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.moved.every((m) => m.from === "INBOX" && m.to === "INBOX.Archive")).toBe(true);
  });

  test("out of Spam, a message's real body is read again from the server (the owner, 26/10/2026)", async () => {
    const spam = (await api().get("/mailbox/threads?folder=spam")).body.data.find((t) => t.subject === "You won");
    expect((await api().post(`/mailbox/threads/${spam.mail_thread_id}/move`).send({ to: "inbox" })).status).toBe(204);
    await new Promise((r) => setTimeout(r, 100));
    const [message] = (await api().get(`/mailbox/threads/${spam.mail_thread_id}`)).body.messages;
    expect(message.body_html).toContain("Hello");
    expect(message.body_html).not.toContain("<script");
  });

  test("the folder's Attachments figure counts the whole folder", async () => {
    const all = (await api().get("/mailbox/threads?folder=inbox")).body.data;
    const withFiles = await api().get("/mailbox/threads?folder=inbox&attachments=true");
    expect(withFiles.body.page.total).toBe(all.filter((t) => t.has_attachment).length);
    expect(withFiles.body.data.every((t) => t.has_attachment)).toBe(true);
  });

  test("drafts save as typed, send now delivers with its file, a refusal fails without retrying", async () => {
    const draftId = "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c11";
    const file = await api().post("/mailbox/attachments").attach("file", Buffer.from("%PDF-1.4\n"), "agenda.pdf");
    expect(file.status).toBe(201);
    const saved = await api().put(`/mailbox/drafts/${draftId}`).send({ to_addresses: ["ops@partner.test"], subject: "Agenda for Monday", body_html: "<p>Attached.</p><script>x</script>", document_ids: [file.body.document_id] });
    expect(saved.status).toBe(200);
    expect(saved.body.attachments[0]).toMatchObject({ file_name: "agenda.pdf" });
    expect((await api().get("/mailbox/threads?folder=drafts")).body.data[0]).toMatchObject({ mail_draft_id: draftId, subject: "Agenda for Monday", scheduled: null });

    const sent = await api().post("/mailbox/messages").set("Idempotency-Key", "send-agenda-1").send({ mail_draft_id: draftId, to_addresses: ["ops@partner.test"], bcc_addresses: ["boss@mycity.test"], subject: "Agenda for Monday", body_html: "<p>Attached.</p><script>x</script>", document_ids: [file.body.document_id] });
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe("queued");
    await drain();
    expect(queues.enqueue).toHaveBeenCalledWith("mail-send", "send", { mail_send_queue_id: sent.body.mail_send_queue_id }, expect.objectContaining({ jobId: `mail-send-${sent.body.mail_send_queue_id}` }));
    await mailbox.flush(sent.body.mail_send_queue_id);
    const out = server.sent.at(-1);
    expect(out).toMatchObject({ to: ["ops@partner.test"], bcc: ["boss@mycity.test"], subject: "Agenda for Monday" });
    expect(out.html).not.toMatch(/script/);
    expect(out.attachments[0]).toMatchObject({ filename: "agenda.pdf" });
    expect((await one("SELECT status FROM mail_send_queue WHERE mail_send_queue_id = $1", [sent.body.mail_send_queue_id])).status).toBe("sent");
    expect((await api().get("/mailbox/threads?folder=drafts")).body.page.total).toBe(0);
    expect((await api().get("/mailbox/threads?folder=sent")).body.data.map((t) => t.subject)).toContain("Agenda for Monday");

    // A recipient the server refuses: failed at once, not retried, the sender told.
    const bounceId = "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c12";
    const bad = await api().post("/mailbox/messages").send({ mail_draft_id: bounceId, to_addresses: ["bounce@nowhere.test"], subject: "Hello", body_html: "<p>Hi</p>" });
    await mailbox.flush(bad.body.mail_send_queue_id);
    const row = await one("SELECT status, error_code FROM mail_send_queue WHERE mail_send_queue_id = $1", [bad.body.mail_send_queue_id]);
    expect(row).toEqual({ status: "failed", error_code: "RECIPIENT_REFUSED" });
    await drain();
    expect((await one("SELECT title FROM notification WHERE event_key = 'mail_send.failed'")).title).toBe("Not sent: Hello");

    expect((await api().post("/mailbox/messages").send({ mail_draft_id: bounceId, to_addresses: ["not-an-address"] })).status).toBe(422);
  });

  test("a message the server accepted is never sent again, whatever fails after", async () => {
    const draftId = "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c19";
    const queued = await api().post("/mailbox/messages").set("Idempotency-Key", "send-once-1").send({ mail_draft_id: draftId, to_addresses: ["ops@partner.test"], subject: "Sent once", body_html: "<p>Once.</p>" });
    expect(queued.status).toBe(201);
    const id = queued.body.mail_send_queue_id;
    const statusOf = async () => (await one("SELECT status FROM mail_send_queue WHERE mail_send_queue_id = $1", [id])).status;
    const before = server.sent.length;

    // At the copy to Sent, where a dropped connection stopped the worker on 22/10, it already reads sent.
    let atCopy = null;
    server.onCopy = async () => {
      atCopy = await statusOf();
    };
    // Filing it here then fails, as a lost database connection would.
    const filing = jest.spyOn(mailboxRepo, "insertMessage").mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    try {
      await expect(mailbox.flush(id)).rejects.toThrow("Connection terminated unexpectedly");
    } finally {
      filing.mockRestore();
      server.onCopy = null;
    }
    expect(server.sent.length).toBe(before + 1);
    expect(atCopy).toBe("sent");
    expect(await statusOf()).toBe("sent");

    // The sweep of rows stuck in sending, and the job's own retry, send nothing more.
    await mailbox.flush();
    await mailbox.flush(id);
    expect(server.sent.length).toBe(before + 1);
    expect((await api().del(`/mailbox/drafts/${draftId}`)).status).toBe(204);
  });

  test("attach: the composer's request, a phone photograph with its purpose, is taken; an unknown purpose is refused", async () => {
    const jpeg = await require("sharp")({ create: { width: 40, height: 80, channels: 3, background: { r: 32, g: 64, b: 48 } } }).jpeg().toBuffer();
    const photo = await api().post("/mailbox/attachments").field("purpose", "attachment").attach("file", jpeg, "Screenshot_20261018_170215_Edge.jpg");
    expect(photo.status).toBe(201);
    expect(photo.body).toMatchObject({ file_name: "Screenshot_20261018_170215_Edge.jpg", mime_type: "image/jpeg" });
    const wrong = await api().post("/mailbox/attachments").field("purpose", "mail").attach("file", jpeg, "photo.jpg");
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.fields).toHaveProperty("purpose");
  });

  test("inline parts and trusted senders: a signature logo is drawn by its cid, not listed as a file; Always Show Images is the owner's", async () => {
    const png = await require("sharp")({ create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 90, b: 60 } } }).png().toBuffer();
    server.deliver("INBOX", mail({
      from: "news@partner.test",
      subject: "Partner newsletter",
      html: '<p>Hello</p><img src="cid:logo1" alt="Partner"><img src="https://tracker.example/p.gif">',
      attachments: [{ filename: "logo.png", contentType: "image/png", size: png.length, content: png, contentId: "logo1", inline: true }],
    }));
    const { mail_account_id: id } = (await api().get("/mailbox/connection")).body;
    await mailbox.sync(id);
    const row = (await api().get("/mailbox/threads?folder=inbox")).body.data.find((t) => t.subject === "Partner newsletter");
    const read = async () => (await api().get(`/mailbox/threads/${row.mail_thread_id}`)).body.messages[0];
    const m = await read();
    expect(m.body_html).toContain("cid:logo1");
    expect(m.attachments).toEqual([]);
    expect(m.inline_parts).toEqual([expect.objectContaining({ content_id: "logo1", mime_type: "image/png" })]);
    expect(m.images_trusted).toBe(false);

    expect((await api().post("/mailbox/image-trust").send({ sender_address: "News@Partner.test", trusted: true })).status).toBe(204);
    expect((await read()).images_trusted).toBe(true);
    expect((await one("SELECT count(*)::int AS n FROM mail_image_trust")).n).toBe(1);
    await api().post("/mailbox/image-trust").send({ sender_address: "news@partner.test", trusted: true });
    expect((await one("SELECT count(*)::int AS n FROM mail_image_trust")).n).toBe(1);
    await drain();
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'mail_account.images_trusted'")).n).toBe(2);

    expect((await api().post("/mailbox/image-trust").send({ sender_address: "news@partner.test", trusted: false })).status).toBe(204);
    expect((await read()).images_trusted).toBe(false);
    expect((await api().post("/mailbox/image-trust").send({ sender_address: "not an address", trusted: true })).status).toBe(422);
  });

  test("schedule: waits on the queue, shows in Drafts, can be cancelled, refused in the past", async () => {
    const draftId = "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c13";
    const at = new Date(Date.now() + 86400000).toISOString();
    const res = await api().post("/mailbox/messages").send({ mail_draft_id: draftId, to_addresses: ["ops@partner.test"], subject: "Tomorrow", body_html: "<p>Later</p>", release_at: at });
    expect(res.status).toBe(201);
    const row = (await api().get("/mailbox/threads?folder=drafts")).body.data.find((d) => d.mail_draft_id === draftId);
    expect(row.scheduled).toMatchObject({ mail_send_queue_id: res.body.mail_send_queue_id });
    expect(await mailbox.flush()).toEqual([]);
    const cancelled = await api().post(`/mailbox/queue/${res.body.mail_send_queue_id}/cancel`).send({});
    expect(cancelled.body.status).toBe("cancelled");
    expect((await api().post(`/mailbox/queue/${res.body.mail_send_queue_id}/cancel`).send({})).status).toBe(409);
    const past = await api().post("/mailbox/messages").send({ mail_draft_id: draftId, to_addresses: ["ops@partner.test"], release_at: new Date(Date.now() - 60000).toISOString() });
    expect(past.status).toBe(422);
    expect(past.body.error.fields.release_at).toEqual(["Time already passed"]);
  });

  test("a scheduled draft: edited, it keeps one send that carries the edit; scheduled again, it is replaced; discarded, it never goes", async () => {
    const draftId = "0b7d2d6e-3f1a-4c8e-9a51-6c2f4e8d9a21";
    const later = (h) => new Date(Date.now() + h * 3600000).toISOString();
    const first = await api().post("/mailbox/messages").set("Idempotency-Key", "8a1d6c52-1f3e-4b7a-9c0d-2e5f6a7b8c91").send({ mail_draft_id: draftId, to_addresses: ["ops@partner.test"], subject: "Delivery", body_html: "<p>First words</p>", release_at: later(2) });
    expect(first.status).toBe(201);
    const waiting = () => pool.query("SELECT mail_send_queue_id, release_at, payload FROM mail_send_queue WHERE mail_draft_id = $1 AND status = 'queued'", [draftId]).then((r) => r.rows);

    // Edited while scheduled: the waiting send carries what was saved.
    await api().put(`/mailbox/drafts/${draftId}`).send({ to_addresses: ["ops@partner.test"], cc_addresses: [], bcc_addresses: [], subject: "Delivery", body_html: "<p>Better words</p>", document_ids: [], in_reply_to: null });
    let rows = await waiting();
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.body_html).toBe("<p>Better words</p>");

    // Done (the same time) or a new time: one send replaces the other, never two.
    const again = await api().post("/mailbox/messages").set("Idempotency-Key", "8a1d6c52-1f3e-4b7a-9c0d-2e5f6a7b8c92").send({ mail_draft_id: draftId, to_addresses: ["ops@partner.test"], subject: "Delivery", body_html: "<p>Final words</p>", release_at: later(3) });
    expect(again.status).toBe(201);
    rows = await waiting();
    expect(rows.map((r) => r.mail_send_queue_id)).toEqual([again.body.mail_send_queue_id]);
    expect(rows[0].payload.body_html).toBe("<p>Final words</p>");
    const drafts = (await api().get("/mailbox/threads?folder=drafts")).body.data.filter((d) => d.mail_draft_id === draftId);
    expect(drafts).toHaveLength(1);
    // The same press retried keeps the send it made.
    await api().post("/mailbox/messages").set("Idempotency-Key", "8a1d6c52-1f3e-4b7a-9c0d-2e5f6a7b8c92").send({ mail_draft_id: draftId, to_addresses: ["ops@partner.test"], subject: "Delivery", body_html: "<p>Final words</p>", release_at: later(3) });
    expect((await waiting()).map((r) => r.mail_send_queue_id)).toEqual([again.body.mail_send_queue_id]);

    // Discarded while scheduled: its send is cancelled, not orphaned.
    expect((await api().del(`/mailbox/drafts/${draftId}`)).status).toBe(204);
    const left = await pool.query("SELECT status FROM mail_send_queue WHERE mail_send_queue_id = $1", [again.body.mail_send_queue_id]);
    expect(left.rows[0].status).toBe("cancelled");
  });

  test("empty Trash removes for good, here and on the server", async () => {
    const t = (await api().get("/mailbox/threads?folder=inbox")).body.data[0];
    await api().post(`/mailbox/threads/${t.mail_thread_id}/move`).send({ to: "trash" });
    const res = await api().post("/mailbox/folders/trash/empty").send({});
    expect(res.body).toEqual({ removed: 1 });
    expect((await api().get("/mailbox/threads?folder=trash")).body.page.total).toBe(0);
  });

  test("a password changed on the server: the next sync asks to reconnect, and the owner is told", async () => {
    const { mail_account_id: id } = (await api().get("/mailbox/connection")).body;
    server.password = "changed-on-the-server";
    const r = await mailbox.sync(id);
    expect(r.error).toBe("MAIL_AUTH_FAILED");
    expect((await api().get("/mailbox/connection")).body).toMatchObject({ status: "needs_reconnect", last_error_code: "MAIL_AUTH_FAILED" });
    await drain();
    expect((await one("SELECT title FROM notification WHERE event_key = 'mail_account.needs_reconnect'")).title).toBe("Reconnect your mailbox");
    const again = await api().post("/mailbox/connection").send({ email: "bola@mycity.test", password: server.password });
    expect(again.body.status).toBe("connected");
    expect((await one("SELECT count(*)::int AS n FROM mail_account")).n).toBe(1);
  });

  test("disconnect deletes the password", async () => {
    const res = await api().post("/mailbox/connection/disconnect").send({});
    expect(res.body.status).toBe("disconnected");
    expect((await one("SELECT active, ciphertext FROM integration_secret WHERE provider = 'mailbox'"))).toEqual({ active: false, ciphertext: "" });
  });
});
