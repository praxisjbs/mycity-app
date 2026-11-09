"use strict";
/**
 * Mail linked to a partner, end to end (docs/guides/partnerships.md §6.15, Appendix A PR 8): the real
 * migrations on a throwaway database, the app through HTTP, a mail server in memory. Link to Partner on
 * the owner's own conversation logs each message once as an email interaction on the lead, showing the
 * record's readers its excerpt only; new mail as the mailbox syncs is logged too; Spam never; Unlink
 * stops it and keeps what was logged; conversion moves the link; emptying Trash keeps the history; and
 * nobody links or opens another person's mail.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/partnerships-mail
 *
 * Every organisation, person and address is invented.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => undefined),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));

const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const mailbox = require("../../src/modules/mailbox/mailbox.service");
const { EXCERPT_CHARS } = require("../../src/modules/mailbox/binding/context-tabs");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0] || null;
const PASSWORD = "Linked-Mail5Thread";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

async function drain() {
  for (let i = 0; i < 12; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

/** A mail server in memory, as the mailbox suites' own. */
function fakeServer() {
  const s = {
    password: "mail-pass-1",
    folders: { INBOX: [], "INBOX.Sent": [], "INBOX.Archive": [], "INBOX.Junk": [], "INBOX.Trash": [], "INBOX.Drafts": [] },
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
  ];
  s.provider = () => ({
    verify: async () => true,
    listFolders: async () => LIST,
    async fetchSince(path, { lastUid = 0 }) {
      const messages = (s.folders[path] || []).filter((m) => m.uid > lastUid);
      return { uidValidity: 7, lastUid: Math.max(lastUid, ...messages.map((m) => m.uid)), messages, more: false };
    },
    markSeen: async () => true,
    move: async () => true,
    remove: async (path, ids) => ids.length,
    send: async () => ({ messageId: "<sent@mycity.test>", raw: Buffer.from("raw") }),
    copyToSent: async () => "INBOX.Sent",
  });
  return s;
}

let seq = 0;
const mail = (over) => {
  seq += 1;
  return {
    messageId: `<m${seq}@partner.test>`,
    inReplyTo: null,
    references: [],
    from: "ada@harbour.example.test",
    fromName: "Ada Obi",
    to: ["bola@mycity.test"],
    cc: [],
    subject: "Harbour Lights tickets",
    html: null,
    text: "",
    date: new Date(Date.now() - 86400000 + seq * 1000),
    seen: true,
    attachments: [],
    ...over,
  };
};

describeDb("partnerships: mail linked to a lead or partner (§6.15)", () => {
  let app;
  const people = {};
  const tokens = {};
  let ip = 0;
  let accountId;
  let threadId;
  let spamThreadId;
  let lead;
  const server = fakeServer();
  const LONG = `Dear Bola, ${"we would like the ticketing on MyCityApp for all three nights of the festival, with VIP tables. ".repeat(6)}Regards, Ada`;

  const as = (who) => {
    const auth = (r) => {
      ip += 1;
      return r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", `10.78.${Math.floor(ip / 250)}.${(ip % 250) + 1}`);
    };
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path, body = {}) => auth(request(app).post(`/api/v1${path}`)).send(body),
      del: (path) => auth(request(app).delete(`/api/v1${path}`)),
      upload: (name) => auth(request(app).post("/api/v1/documents")).attach("file", PDF, { filename: name, contentType: "application/pdf" }),
    };
  };
  const emp = (who) => people[who].employee.employee_id;
  const ok = (res, status = 200) => {
    expect([res.status, res.body.error]).toEqual([status, undefined]);
    return res.body;
  };
  const emails = async (who, record) => ok(await as(who).get(`/partnerships/interactions?${record}&interaction_type=email`)).data;
  const sync = async () => {
    await mailbox.sync(accountId);
    await drain();
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    mailbox.useProvider(server.provider);
    ({ app } = buildApp({ strict: true, accessLog: false }));
    const sample = (first, last, email, job, department) => ({
      first_name: first, last_name: last, work_email: email, phone: "08031234567", job_title: job, department_name: department,
      start_date: "2026-01-05", employment_type: "full_time", work_pattern: "on_site",
    });
    const make = (key, first, last, email, role, job, department, isCeo = false) =>
      tx(async (client) => {
        people[key] = await createAdmin(client, { employee: sample(first, last, email, job, department), role_code: role, is_ceo: isCeo }, PASSWORD, { allowAdditional: true });
      });
    await make("ceo", "Amaka", "Eze", "ceo@mycity.test", "management", "Chief Executive Officer", "Management", true);
    await make("bola", "Bola", "Ade", "bola@mycity.test", "operations_people", "Partnerships Lead", "Operations");
    await make("staff", "Musa", "Danjuma", "musa@mycity.test", "employee", "Growth Officer", "Growth");
    for (const [i, [code, label, meaning]] of [
      ["prospect_identified", "Prospect Identified", "prospect"],
      ["partnership_signed", "Partnership Signed", "signed"],
      ["closed_lost", "Closed Lost", "closed_lost"],
    ].entries()) {
      await q(
        `INSERT INTO reference_value (domain, code, label, display_order, metadata) VALUES ('partnership_stage', $1, $2, $3, $4::jsonb)
         ON CONFLICT (domain, code) DO UPDATE SET label = EXCLUDED.label, display_order = EXCLUDED.display_order, metadata = EXCLUDED.metadata, active = true`,
        [code, label, (i + 1) * 10, JSON.stringify({ meaning })],
      );
    }
    await q("UPDATE reference_value SET active = false WHERE domain = 'partnership_stage' AND metadata = '{}'::jsonb");
    await drain();
    for (const [key, email] of [["ceo", "ceo@mycity.test"], ["bola", "bola@mycity.test"], ["staff", "musa@mycity.test"]]) {
      const res = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.79.0.${Object.keys(tokens).length + 1}`).send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      tokens[key] = res.body.access_token;
    }
    const category = ok(await as("bola").post("/partnerships/categories", { name: "Event" }), 201).partner_category_id;
    lead = ok(
      await as("bola").post("/partnerships/leads", {
        name: "Harbour Lights Festival",
        partner_category_id: category,
        region: { scope: "national" },
        owner_id: emp("bola"),
        contact: { first_name: "Ada", last_name: "Obi", email: "ada@harbour.example.test", signatory: true },
        deal: { title: "Harbour Lights 2026", owner_id: emp("bola") },
      }),
      201,
    );

    const root = mail({ text: LONG });
    server.deliver("INBOX", root);
    server.deliver("INBOX.Sent", mail({ from: "bola@mycity.test", fromName: "Bola Ade", to: ["ada@harbour.example.test"], cc: ["ops@harbour.example.test"], subject: "Re: Harbour Lights tickets", inReplyTo: root.messageId, references: [root.messageId], text: "Ada, we can. I will send the agreement this week. Bola" }));
    server.deliver("INBOX.Junk", mail({ from: "win@spam.example.test", fromName: "Lottery", subject: "You won", text: "Send your bank details to claim it now" }));
    const connected = ok(await as("bola").post("/mailbox/connection", { email: "bola@mycity.test", password: server.password }));
    accountId = connected.mail_account_id;
    await sync();
    threadId = ok(await as("bola").get("/mailbox/threads?folder=inbox")).data.find((t) => /Harbour Lights/.test(t.subject)).mail_thread_id;
    spamThreadId = ok(await as("bola").get("/mailbox/threads?folder=spam")).data[0].mail_thread_id;
    // A message threaded on the conversation before it is linked, from the owner themself.
    server.root = root;
  }, 180_000);

  afterAll(async () => {
    mailbox.useProvider(null);
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  test("Link to Partner logs each message once on the lead, as an excerpt the record's readers may see", async () => {
    expect(ok(await as("bola").get(`/mailbox/threads/${threadId}/partner`))).toEqual({ mail_thread_id: threadId, record: null, deal: null, bound_at: null, bound_by: null });
    const linked = ok(await as("bola").post(`/mailbox/threads/${threadId}/partner`, { lead_id: lead.lead.lead_id, deal_id: lead.deal.deal_id }));
    expect(linked).toMatchObject({ record: { type: "lead", id: lead.lead.lead_id, name: "Harbour Lights Festival" }, deal: { deal_id: lead.deal.deal_id, title: "Harbour Lights 2026" }, bound_by: "Bola Ade" });

    const logged = await emails("bola", `lead_id=${lead.lead.lead_id}`);
    expect(logged).toHaveLength(2);
    const first = logged.find((i) => i.mail.from === "Ada Obi");
    expect(first).toMatchObject({ interaction_type: "email", subject: "Harbour Lights tickets", deal_id: lead.deal.deal_id, from_mail: true, owner: expect.objectContaining({ display_name: "Bola Ade" }) });
    expect(first.mail).toEqual({ from: "Ada Obi", to: ["bola@mycity.test"], mail_thread_id: threadId });
    expect(first.summary.length).toBeLessThanOrEqual(EXCERPT_CHARS + 1);
    expect(first.summary.endsWith("…")).toBe(true);
    expect(LONG.startsWith(first.summary.slice(0, -1).trim())).toBe(true);
    const reply = logged.find((i) => i.mail.from === "Bola Ade");
    expect(reply.mail.to).toEqual(["ada@harbour.example.test", "ops@harbour.example.test"]);

    // Another reader sees the excerpt, never the thread to open; and it is the record's contact.
    const ceo = await emails("ceo", `lead_id=${lead.lead.lead_id}`);
    expect(ceo).toHaveLength(2);
    expect(ceo.every((i) => i.mail.mail_thread_id === null)).toBe(true);
    const event = await one("SELECT payload FROM event_log WHERE event_key = 'mailbox.thread_bound'");
    expect(event.payload).toMatchObject({ mail_thread_id: threadId, lead_id: lead.lead.lead_id, logged: 2 });

    // A second press logs nothing twice.
    ok(await as("bola").post(`/mailbox/threads/${threadId}/partner`, { lead_id: lead.lead.lead_id }));
    expect(await emails("bola", `lead_id=${lead.lead.lead_id}`)).toHaveLength(2);
  });

  test("new mail on a linked thread is logged as the mailbox syncs; Spam never is", async () => {
    server.deliver("INBOX", mail({ subject: "Re: Harbour Lights tickets", inReplyTo: server.root.messageId, references: [server.root.messageId], text: "Thanks Bola, we look forward to the agreement." }));
    await sync();
    expect(await emails("bola", `lead_id=${lead.lead.lead_id}`)).toHaveLength(3);

    ok(await as("bola").post(`/mailbox/threads/${spamThreadId}/partner`, { lead_id: lead.lead.lead_id }));
    expect(await emails("bola", `lead_id=${lead.lead.lead_id}`)).toHaveLength(3);
    ok(await as("bola").del(`/mailbox/threads/${spamThreadId}/partner`));
  });

  test("nobody links or opens another person's mail, or links a record they cannot see", async () => {
    expect((await as("ceo").get(`/mailbox/threads/${threadId}/partner`)).status).toBe(404);
    expect((await as("ceo").post(`/mailbox/threads/${threadId}/partner`, { lead_id: lead.lead.lead_id })).status).toBe(404);
    expect((await as("bola").post(`/mailbox/threads/${threadId}/partner`, {})).status).toBe(422);
    // Musa (own scope) has no mailbox thread of Bola's, and Bola's lead is not his to see.
    expect((await as("staff").get(`/partnerships/interactions?lead_id=${lead.lead.lead_id}`)).body.data).toEqual([]);
  });

  test("conversion moves the link to the partner, and new mail is logged there", async () => {
    const copy = ok(await as("bola").upload("signed.pdf"), 201);
    const converted = ok(await as("bola").post(`/partnerships/leads/${lead.lead.lead_id}/convert`, { signed_copy_document_id: copy.document_id }));
    const partnerId = converted.partner_id;
    const context = ok(await as("bola").get(`/mailbox/threads/${threadId}/partner`));
    expect(context.record).toMatchObject({ type: "partner", id: partnerId });
    expect(await emails("bola", `partner_id=${partnerId}`)).toHaveLength(3);
    server.deliver("INBOX", mail({ subject: "Re: Harbour Lights tickets", inReplyTo: server.root.messageId, references: [server.root.messageId], text: "Signed and sent back. See you at the festival." }));
    await sync();
    expect(await emails("bola", `partner_id=${partnerId}`)).toHaveLength(4);
    lead.partner_id = partnerId;
  });

  test("Unlink stops new interactions and keeps those logged; emptying Trash keeps the history", async () => {
    const off = ok(await as("bola").del(`/mailbox/threads/${threadId}/partner`));
    expect(off.record).toBeNull();
    expect(await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'mailbox.thread_unbound'")).toEqual({ n: 2 });
    server.deliver("INBOX", mail({ subject: "Re: Harbour Lights tickets", inReplyTo: server.root.messageId, references: [server.root.messageId], text: "One more thing about parking at the venue." }));
    await sync();
    expect(await emails("bola", `partner_id=${lead.partner_id}`)).toHaveLength(4);

    const res = await as("bola").post(`/mailbox/threads/${threadId}/move`, { to: "trash" });
    expect(res.status).toBe(204);
    ok(await as("bola").post("/mailbox/folders/trash/empty"));
    const kept = await emails("bola", `partner_id=${lead.partner_id}`);
    expect(kept).toHaveLength(4);
    expect(kept.every((i) => i.from_mail && i.mail.mail_thread_id === null)).toBe(true);
    expect(kept.map((i) => i.mail.from).sort()).toEqual(["Ada Obi", "Ada Obi", "Ada Obi", "Bola Ade"]);
  });
});
