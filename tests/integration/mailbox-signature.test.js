"use strict";
/**
 * Email signatures, end to end (docs/guides/mailbox.md §3 steps 7 to 10): the real migrations
 * on a throwaway database, the whole app through HTTP, and a mail server in memory behind the
 * provider's own methods, so what a recipient would receive is what the test reads.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/mailbox-signature
 */
const request = require("supertest");
const sharp = require("sharp");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const realtime = require("../../src/services/realtime/emitter");
const mailbox = require("../../src/modules/mailbox/mailbox.service");
const signatures = require("../../src/modules/mailbox/signature/signature.service");
const { picked } = require("../helpers/places");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => undefined),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

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

/** A mail server in memory that takes the password, lists folders and keeps what was sent. */
function fakeServer() {
  const s = { password: "mail-pass-1", sent: [] };
  const LIST = [
    { path: "INBOX", delimiter: ".", flags: [], specialUse: "\\Inbox" },
    { path: "INBOX.Sent", delimiter: ".", flags: [], specialUse: "\\Sent" },
    { path: "INBOX.Archive", delimiter: ".", flags: [], specialUse: "\\Archive" },
    { path: "INBOX.Junk", delimiter: ".", flags: [], specialUse: "\\Junk" },
    { path: "INBOX.Trash", delimiter: ".", flags: [], specialUse: "\\Trash" },
    { path: "INBOX.Drafts", delimiter: ".", flags: [], specialUse: "\\Drafts" },
  ];
  s.provider = () => ({
    async verify() {
      return true;
    },
    async listFolders() {
      return LIST;
    },
    async fetchSince(_path, { lastUid = 0 }) {
      return { uidValidity: 7, lastUid, messages: [], more: false };
    },
    async send(msg) {
      const messageId = `<sent-${s.sent.length + 1}@mycity.test>`;
      s.sent.push({ ...msg, messageId });
      return { messageId, raw: Buffer.from("raw"), sentPath: "INBOX.Sent" };
    },
  });
  return s;
}

const sample = (first, last, email, over = {}) => ({
  first_name: first,
  last_name: last,
  work_email: email,
  phone: "08031234567",
  job_title: "Content Associate",
  department_name: "HR & Operations",
  start_date: "2024-01-05",
  employment_type: "full_time",
  work_pattern: "on_site",
  ...over,
});

describeDb("Email signatures against the real migrations", () => {
  let app;
  let staff;
  let admin;
  let ceo;
  const server = fakeServer();
  let ipSeq = 0;

  const api = (t) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
    post: (path) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
    put: (path) => request(app).put(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
    patch: (path) => request(app).patch(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
    del: (path) => request(app).delete(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
  });
  const send = async (body) => {
    const res = await api(staff).post("/mailbox/messages").send({ subject: "Hello", body_html: "<p>Hi</p>", ...body });
    expect(res.status).toBe(201);
    await mailbox.flush(res.body.mail_send_queue_id);
    return { res, out: server.sent.at(-1) };
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    mailbox.useProvider(server.provider);
    ({ app } = buildApp({ strict: true, accessLog: false }));
    await tx(async (client) => {
      await createAdmin(client, { employee: sample("Amaka", "Eze", "ceo@mycity.test"), role_code: "management", is_ceo: true }, PASSWORD);
      await createAdmin(client, { employee: sample("Tolu", "Bello", "tolu@mycity.test", { job_title: "Chief Technology Officer" }), role_code: "administrator", is_ceo: false }, PASSWORD);
      await createAdmin(client, { employee: sample("Chidi", "Okafor", "chidi@mycity.test"), role_code: "employee", is_ceo: false }, PASSWORD);
    });
    await drain();
    const login = async (email) => {
      ipSeq += 1;
      const r = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.43.0.${ipSeq}`).send({ email, password: PASSWORD });
      return r.body.access_token;
    };
    ceo = await login("ceo@mycity.test");
    admin = await login("tolu@mycity.test");
    staff = await login("chidi@mycity.test");
  });

  afterAll(async () => {
    mailbox.useProvider(null);
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });
  beforeEach(() => jest.spyOn(realtime, "toUser").mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  test("the Signature tab: built from the record, both drawings, a line left out when there is no value", async () => {
    const res = await api(staff).get("/mailbox/signature");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Chidi Okafor",
      job_title: "Content Associate",
      department: "HR & Operations",
      email: "chidi@mycity.test",
      mobile: "+2348031234567",
      office_line: null,
      show_mobile: true,
      show_whatsapp: true,
      whatsapp_allowed: true,
    });
    const full = res.body.full_html;
    expect(full).toContain("Chidi Okafor");
    expect(full).toContain('href="tel:+2348031234567"');
    expect(full).toContain("+234 803 123 4567");
    expect(full).toContain('href="https://wa.me/2348031234567"');
    expect(full).toContain('src="data:image/png;base64,');
    expect(full).toContain("MyCity App");
    // No RC number, links or note entered yet: none of their lines are drawn.
    expect(full).not.toMatch(/RC |Get the App|undefined|null/);
    expect(res.body.slim_html).toContain("Chidi Okafor");
    expect(res.body.slim_html).toContain("Content Associate");
    expect(res.body.slim_html).not.toContain("<img");
  });

  test("numbers: the mobile changes the employee record, the office line and switches are the signature's own", async () => {
    const res = await api(staff).patch("/mailbox/signature").send({ mobile: "0809 876 5432", office_line: "0201 234 5678" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mobile: "+2348098765432", office_line: "+2342012345678" });
    expect(res.body.full_html).toContain("+234 809 876 5432");
    expect(res.body.full_html).toContain("+234 201 234 5678");
    expect((await one("SELECT phone FROM employee WHERE work_email = 'chidi@mycity.test'")).phone).toBe("+2348098765432");
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'employee.updated'")).n).toBeGreaterThan(0);
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'mail_signature.changed'")).n).toBe(1);

    const hidden = await api(staff).patch("/mailbox/signature").send({ show_mobile: false });
    expect(hidden.body.show_mobile).toBe(false);
    expect(hidden.body.full_html).not.toContain("+234 809 876 5432");
    expect(hidden.body.full_html).not.toContain("wa.me");
    // The slim line falls back to the office line.
    expect(hidden.body.slim_html).toContain("+234 201 234 5678");

    const shown = await api(staff).patch("/mailbox/signature").send({ show_mobile: true, office_line: "" });
    expect(shown.body).toMatchObject({ show_mobile: true, office_line: null });
    expect(shown.body.full_html).toContain("+234 809 876 5432");

    expect((await api(staff).patch("/mailbox/signature").send({})).status).toBe(422);
    const bad = await api(staff).patch("/mailbox/signature").send({ mobile: "12" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields).toHaveProperty("mobile");
    // An empty mobile leaves the record's as it is, as on Edit Profile.
    expect((await api(staff).patch("/mailbox/signature").send({ mobile: "", show_whatsapp: true })).body.mobile).toBe("+2348098765432");
  });

  test("preview: the slim line on a reply and on colleague-only mail, the full signature otherwise", async () => {
    const preview = async (body) => (await api(staff).post("/mailbox/signature/preview").send(body)).body;
    expect((await preview({})).variant).toBe("full");
    expect((await preview({ to_addresses: ["ops@partner.test"] })).variant).toBe("full");
    expect((await preview({ to_addresses: ["tolu@mycity.test"], cc_addresses: ["CEO@MyCity.test"] })).variant).toBe("slim");
    expect((await preview({ to_addresses: ["tolu@mycity.test"], bcc_addresses: ["ops@partner.test"] })).variant).toBe("full");
    const reply = await preview({ in_reply_to: "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c99", to_addresses: ["ops@partner.test"] });
    expect(reply).toMatchObject({ variant: "slim" });
    expect(reply.html).toContain("Chidi Okafor");
  });

  test("Configure: only mailbox.signature holders; links become icons and switches take lines away", async () => {
    const refused = await api(staff).get("/mailbox/signature/config");
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("CAPABILITY_REQUIRED");
    expect((await api(staff).put("/mailbox/signature/config").send({})).status).toBe(403);

    const empty = await api(admin).get("/mailbox/signature/config");
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ instagram_url: null, show_whatsapp: true, show_legal: true, updated_at: null });

    const body = {
      app_store_url: "https://apps.apple.com/ng/app/mycity/id1234567890",
      google_play_url: "",
      instagram_url: "https://instagram.com/mycityapp",
      tiktok_url: "",
      linkedin_url: "https://www.linkedin.com/company/mycityapp",
      x_url: "",
      facebook_url: "",
      youtube_url: "",
      confidentiality_note: "This email and its attachments are confidential.",
      show_whatsapp: false,
      show_app_links: true,
      show_social_links: true,
      show_legal: true,
    };
    const saved = await api(admin).put("/mailbox/signature/config").send(body);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ instagram_url: "https://instagram.com/mycityapp", google_play_url: null, show_whatsapp: false });
    expect(saved.body.updated_at).not.toBeNull();
    // The CEO holds every authority.
    expect((await api(ceo).put("/mailbox/signature/config").send(body)).status).toBe(200);
    expect((await one("SELECT count(*)::int AS n FROM mail_signature_config")).n).toBe(1);
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'mail_signature.config_changed'")).n).toBe(2);

    const http = await api(admin).put("/mailbox/signature/config").send({ ...body, instagram_url: "http://instagram.com/mycityapp" });
    expect(http.status).toBe(422);
    expect(http.body.error.fields.instagram_url).toEqual(["Not a web address"]);

    const mine = (await api(staff).get("/mailbox/signature")).body;
    expect(mine.whatsapp_allowed).toBe(false);
    expect(mine.full_html).not.toContain("wa.me");
    expect(mine.full_html).toContain('href="https://instagram.com/mycityapp"');
    expect(mine.full_html).toContain('alt="Instagram"');
    expect(mine.full_html).toContain('alt="LinkedIn"');
    expect(mine.full_html).not.toContain('alt="TikTok"');
    expect(mine.full_html).toContain("Get the App");
    expect(mine.full_html).toContain('alt="App Store"');
    expect(mine.full_html).not.toContain('alt="Google Play"');
    expect(mine.full_html).toContain("This email and its attachments are confidential.");
  });

  test("organisation and brand: the company line, the RC number, and the White Logo on the band", async () => {
    const org = await api(ceo).patch("/settings/organisation").send({
      legal_name: "MyCity App Ltd",
      trading_name: "MyCity App",
      registration_number: "1234567",
      address: picked("Admiralty Way, Lekki, Lagos"),
      website: "https://mycityapp.io",
    });
    expect(org.status).toBe(200);
    let full = (await api(staff).get("/mailbox/signature")).body.full_html;
    expect(full).toContain("MyCity App Ltd");
    expect(full).toContain("RC 1234567");
    expect(full).toContain("Lekki, Lagos");
    expect(full).toContain('href="https://mycityapp.io"');

    const logo = await sharp({ create: { width: 240, height: 48, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const up = await api(ceo).post("/settings/organisation/brand/logo_white").field("purpose", "brand").attach("file", logo, "white-logo.png");
    expect(up.status).toBe(201);
    expect((await api(ceo).get("/settings/organisation")).body.logo_white).toMatchObject({ document_id: up.body.document_id });
    full = (await api(staff).get("/mailbox/signature")).body.full_html;
    // The White Logo carries the name, so the band draws it alone, 24 px high.
    expect(full).toMatch(/<img src="data:image\/png;base64,[^"]+" width="120" height="24" alt="MyCity App"/);

    expect((await api(ceo).del("/settings/organisation/brand/logo_white")).status).toBe(200);
    full = (await api(staff).get("/mailbox/signature")).body.full_html;
    expect(full).not.toContain('alt="MyCity App"');
    expect(full).toMatch(/>MyCity App<\/td>/);
  });

  test("sending: the full signature with its pictures inline, stored once; a reply carries the slim line above the quote", async () => {
    const connected = await api(staff).post("/mailbox/connection").send({ email: "chidi@mycity.test", password: server.password });
    expect(connected.status).toBe(200);
    await mailbox.sync(connected.body.mail_account_id);

    const { out } = await send({ mail_draft_id: "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c21", to_addresses: ["ops@partner.test"], subject: "Partnership" });
    expect(out.html.indexOf("<p>Hi</p>")).toBeLessThan(out.html.indexOf("Chidi Okafor"));
    const inline = out.attachments.filter((a) => a.cid);
    expect(inline.length).toBeGreaterThanOrEqual(4); // the pin, two socials, one app
    for (const a of inline) {
      expect(a.contentType).toBe("image/png");
      expect(out.html).toContain(`cid:${a.cid}`);
      expect(a.cid).toMatch(/@mycity\.test$/);
    }
    expect(out.html).not.toContain("data:image");
    expect(out.text).toMatch(/^Hi\n\nChidi Okafor\nContent Associate/);

    // The Sent copy draws the same pictures from the vault, and lists no file.
    const sentThread = (await api(staff).get("/mailbox/threads?folder=sent")).body.data.find((t) => t.subject === "Partnership");
    const message = (await api(staff).get(`/mailbox/threads/${sentThread.mail_thread_id}`)).body.messages[0];
    expect(message.attachments).toEqual([]);
    expect(message.inline_parts.map((p) => p.content_id).sort()).toEqual(inline.map((a) => a.cid).sort());
    expect(message.body_html).toContain("cid:");
    const picture = message.inline_parts[0].document_id;
    expect((await api(admin).get(`/documents/${picture}/content`)).status).toBe(200);

    // A second message reuses every stored picture.
    const stored = (await one("SELECT count(*)::int AS n FROM document WHERE doc_type = 'mail_signature_image'")).n;
    await send({ mail_draft_id: "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c22", to_addresses: ["events@partner.test"], subject: "Second" });
    expect((await one("SELECT count(*)::int AS n FROM document WHERE doc_type = 'mail_signature_image'")).n).toBe(stored);

    // A reply: the slim line, after the words and above the quote, no pictures.
    const quoted = "<p>Thanks, see you Monday.</p><p></p><p>On 19/10/2026 09:30, Ops wrote:</p><blockquote><p>Can you confirm?</p></blockquote>";
    const reply = (await send({ mail_draft_id: "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c23", to_addresses: ["ops@partner.test"], subject: "Re: Partnership", body_html: quoted, in_reply_to: message.mail_message_id })).out;
    expect(reply.html.indexOf("Thanks, see you Monday.")).toBeLessThan(reply.html.indexOf("Chidi Okafor"));
    expect(reply.html.indexOf("Chidi Okafor")).toBeLessThan(reply.html.indexOf("wrote:"));
    expect(reply.attachments.filter((a) => a.cid)).toEqual([]);
    expect(reply.text).toMatch(/Thanks, see you Monday\.\n\nChidi Okafor, Content Associate\nMyCity App[^\n]*\n\nOn 19\/10\/2026 09:30, Ops wrote:/);

    // Colleagues only: the slim line.
    const internal = (await send({ mail_draft_id: "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c24", to_addresses: ["tolu@mycity.test"], subject: "Internal" })).out;
    expect(internal.html).toContain("Chidi Okafor");
    expect(internal.attachments).toEqual([]);
  });

  test("a queued message keeps the signature it was given; one that cannot be built leaves without it", async () => {
    const at = new Date(Date.now() + 3600000).toISOString();
    const queued = await api(staff).post("/mailbox/messages").send({ mail_draft_id: "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c25", to_addresses: ["ops@partner.test"], subject: "Later", body_html: "<p>Later</p>", release_at: at });
    expect(queued.status).toBe(201);
    await api(staff).patch("/mailbox/signature").send({ mobile: "0701 111 2222" });
    await q("UPDATE mail_send_queue SET release_at = now() WHERE mail_send_queue_id = $1", [queued.body.mail_send_queue_id]);
    await mailbox.flush(queued.body.mail_send_queue_id);
    const later = server.sent.at(-1);
    expect(later.subject).toBe("Later");
    expect(later.html).toContain("+234 809 876 5432");
    expect(later.html).not.toContain("+234 701 111 2222");

    jest.spyOn(signatures, "bake").mockRejectedValueOnce(new Error("record unreadable"));
    const { out } = await send({ mail_draft_id: "6f0e8f7b-6c3c-4a35-9f2a-0d4b1b8a7c26", to_addresses: ["ops@partner.test"], subject: "Without" });
    expect(out.subject).toBe("Without");
    expect(out.html).not.toContain("Chidi Okafor");
    expect(out.text).toBe("Hi");
  });
});
