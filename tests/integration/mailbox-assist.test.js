"use strict";
/**
 * Write With AI, Tidy Up, Dictate and Summarise Thread, end to end (docs/guides/mailbox.md §1.1,
 * §3 steps 12 to 14, §6): the real migrations on a throwaway database, the whole app through HTTP.
 * The model and the transcription are stand-ins at their service's door, so what the mailbox sends
 * them (the conversation, the tokens in place of contact details) and what it does with their
 * answers (restored, checked, kept) is what is tested; one press goes through the real AI layer to
 * show that with no provider set up the stub cannot write a draft.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/mailbox-assist
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");
const { AppError } = require("../../src/shared/errors");
const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const vault = require("../../src/shared/documents/vault");
const realtime = require("../../src/services/realtime/emitter");
const mailbox = require("../../src/modules/mailbox/mailbox.service");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => undefined),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => undefined),
  DEFAULTS: {},
}));
jest.mock("../../src/services/ai/llm.service", () => ({
  ...jest.requireActual("../../src/services/ai/llm.service"),
  complete: jest.fn(),
}));
jest.mock("../../src/services/ai/transcription", () => ({
  ...jest.requireActual("../../src/services/ai/transcription"),
  transcribe: jest.fn(),
}));
const queues = require("../../src/jobs/queues");
const ai = require("../../src/services/ai/llm.service");
const transcription = require("../../src/services/ai/transcription");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
const PASSWORD = "Brand-new9Pass";
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("\x42\x82\x84webm"), Buffer.alloc(64)]);

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

/** A mail server in memory, as the mailbox suite's: folders of messages by UID. */
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
    messageId: `<a${seq}@partner.test>`,
    inReplyTo: null,
    references: [],
    from: "ada@partner.test",
    fromName: "Ada Obi",
    to: ["bola@mycity.test"],
    cc: [],
    subject: "Venue visit",
    html: null,
    text: "",
    date: new Date(Date.now() + seq * 1000),
    seen: true,
    attachments: [],
    ...over,
  };
};

/** A real run on the ledger, as complete() would open, so a kept summary can name it. */
async function runOf(purpose) {
  const r = await one(
    `INSERT INTO ai_run (purpose, module_key, vendor, model, prompt_key, prompt_version, prompt_sha, status)
     VALUES ($1, 'mailbox', 'gemini', 'gemini-test-flash', $1, 1, 'sha', 'ok') RETURNING run_id`,
    [purpose],
  );
  return r.run_id;
}

/** What complete() answers once the model's reply has passed the schema the mailbox gave it. */
async function answered(req, value) {
  const parsed = req.output.safeParse(value);
  if (!parsed.success) throw new Error(`the mailbox's own check refused it: ${JSON.stringify(parsed.error.issues)}`);
  return { output: parsed.data, text: JSON.stringify(value), provisional: true, run_id: await runOf(req.purpose), vendor: "gemini", model: "gemini-test-flash", cost_ngn: "0.00" };
}

/** The token the shield put where `before` leads, in what the model was sent. */
function tokenAfter(req, before) {
  const m = new RegExp(`${before}(KEPT\\d{3})`).exec(JSON.stringify(req.input));
  return m ? m[1] : null;
}

describeDb("Write With AI and Summarise Thread against the real migrations", () => {
  let app;
  let token;
  let other;
  let threadId;
  let lastMessageId;
  let spamMessageId;
  let spamThreadId;
  const server = fakeServer();

  const api = (t = token) => ({
    get: (path) => request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
    post: (path) => request(app).post(`/api/v1${path}`).set("Authorization", `Bearer ${t}`),
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
      job_title: "Partnerships Lead",
      department_name: "Partnerships",
      start_date: "2024-01-05",
      employment_type: "full_time",
      work_pattern: "on_site",
    });
    await tx(async (client) => {
      await createAdmin(client, { employee: sample("Amaka", "Eze", "ceo@mycity.test"), role_code: "management", is_ceo: true }, PASSWORD);
      await createAdmin(client, { employee: sample("Bola", "Ade", "bola@mycity.test"), role_code: "operations_people", is_ceo: false }, PASSWORD);
    });
    await drain();
    let ip = 0;
    const login = async (email) => {
      ip += 1;
      const r = await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.43.0.${ip}`).send({ email, password: PASSWORD });
      return r.body.access_token;
    };
    token = await login("bola@mycity.test");
    other = await login("ceo@mycity.test");

    const root = mail({
      text: "Dear Bola,\n\nCan your team visit the Ikeja venue next week? Call me on 0803 123 4567 or write to ada.obi@partner.test.\n\nAda Obi",
    });
    server.deliver("INBOX", root);
    server.deliver(
      "INBOX.Sent",
      mail({
        from: "bola@mycity.test",
        fromName: "Bola Ade",
        to: ["ada@partner.test"],
        subject: "Re: Venue visit",
        inReplyTo: root.messageId,
        references: [root.messageId],
        text: "Ada,\n\nYes, we can. Which day suits you?\n\nBola\n\nOn Mon, 19 Oct 2026 at 09:14, Ada Obi <ada@partner.test>\nwrote:\n> Can your team visit the Ikeja venue next week?",
      }),
    );
    server.deliver(
      "INBOX",
      mail({
        subject: "Re: Venue visit",
        inReplyTo: root.messageId,
        references: [root.messageId],
        text: "Thursday at 11:00 works for us. Please confirm and send the visit list.\n\nAda\n\nOn Tue, 20 Oct 2026, Bola Ade wrote:\n> Which day suits you?",
      }),
    );
    server.deliver("INBOX.Junk", mail({ from: "win@spam.test", fromName: "Lottery", subject: "You won", text: "Send your bank details" }));

    const connected = await api().post("/mailbox/connection").send({ email: "bola@mycity.test", password: server.password });
    expect(connected.status).toBe(200);
    await mailbox.sync(connected.body.mail_account_id);
    const inbox = (await api().get("/mailbox/threads?folder=inbox")).body.data;
    threadId = inbox.find((t) => /Venue visit/.test(t.subject)).mail_thread_id;
    const thread = (await api().get(`/mailbox/threads/${threadId}`)).body;
    expect(thread.messages).toHaveLength(3);
    lastMessageId = thread.messages[2].mail_message_id;
    spamThreadId = (await api().get("/mailbox/threads?folder=spam")).body.data[0].mail_thread_id;
    spamMessageId = (await api().get(`/mailbox/threads/${spamThreadId}`)).body.messages[0].mail_message_id;
  });

  afterAll(async () => {
    mailbox.useProvider(null);
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });
  beforeEach(() => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    ai.complete.mockReset();
    transcription.transcribe.mockReset();
  });
  afterEach(() => jest.restoreAllMocks());

  test("a reply drafted from the conversation: contact details leave as tokens and come back in the draft", async () => {
    let sent;
    ai.complete.mockImplementationOnce(async (req) => {
      sent = req;
      const phone = tokenAfter(req, "Call me on ");
      expect(phone).toMatch(/^KEPT\d{3}$/);
      return answered(req, {
        kind: "draft",
        subject: null,
        body_markdown: `Dear Ada,\n\nThursday at 11:00 is confirmed. I will send the visit list today; you can reach me on ${phone} meanwhile.\n\nKind regards,`,
        questions: [],
      });
    });
    const r = await api()
      .post("/mailbox/assist")
      .send({ mode: "write", in_reply_to: lastMessageId, to_addresses: ["ada@partner.test"], subject: "Re: Venue visit", instruction: "confirm thursday" });
    expect(r.status).toBe(200);
    expect(sent).toMatchObject({ purpose: "mail-draft", module: "mailbox", egress: "external" });

    // This conversation only, oldest first, each message's own words with its quote cut away.
    const words = sent.input.conversation.map((m) => m.words);
    expect(words).toHaveLength(3);
    expect(words[1]).toBe("Ada,\n\nYes, we can. Which day suits you?\n\nBola");
    expect(sent.input.conversation.map((m) => m.yours)).toEqual([false, true, false]);
    expect(sent.input.compose).toMatchObject({ kind: "reply", to: [{ name: "Ada Obi" }], subject: "Re: Venue visit" });
    expect(sent.input.you).toMatchObject({ name: "Bola Ade", job_title: "Partnerships Lead", department: "Partnerships" });
    expect(sent.input.may_ask).toBe(true);
    // Nothing the redaction would mask reached the model.
    const raw = JSON.stringify(sent.input);
    for (const secret of ["0803 123 4567", "ada.obi@partner.test", "ada@partner.test", "bola@mycity.test"]) expect(raw).not.toContain(secret);

    expect(r.body).toMatchObject({ available: true, kind: "draft", subject: null, questions: [] });
    expect(r.body.body_html).toContain("<p>Dear Ada,</p>");
    expect(r.body.body_html).toContain("0803 123 4567");
    expect(r.body.body_html).not.toMatch(/KEPT\d/);
    expect(r.body.ai_run_id).toEqual(expect.any(String));
  });

  test("questions first when a fact only the person knows is missing; Write Anyway forbids them", async () => {
    ai.complete.mockImplementationOnce((req) => answered(req, { kind: "questions", subject: null, body_markdown: null, questions: ["How many people are on the visit list?"] }));
    const asked = await api().post("/mailbox/assist").send({ mode: "write", in_reply_to: lastMessageId, instruction: "send the list" });
    expect(asked.body).toMatchObject({ available: true, kind: "questions", body_html: null, questions: ["How many people are on the visit list?"] });

    let checked;
    ai.complete.mockImplementationOnce(async (req) => {
      expect(req.input.may_ask).toBe(false);
      expect(req.input.answers).toEqual([{ question: "How many people are on the visit list?", answer: "Four" }]);
      checked = req.output.safeParse({ kind: "questions", subject: null, body_markdown: null, questions: ["Which four?"] });
      return answered(req, { kind: "draft", subject: null, body_markdown: "Dear Ada,\n\nFour of us will visit on Thursday.\n\nKind regards,", questions: [] });
    });
    const anyway = await api()
      .post("/mailbox/assist")
      .send({ mode: "write", in_reply_to: lastMessageId, instruction: "send the list", answers: [{ question: "How many people are on the visit list?", answer: "Four" }], write_anyway: true });
    expect(checked.success).toBe(false);
    expect(anyway.body).toMatchObject({ kind: "draft" });
    expect(anyway.body.body_html).toContain("Four of us");
  });

  test("an answer with a gap to fill never passes the mailbox's check", async () => {
    let refused;
    ai.complete.mockImplementationOnce(async (req) => {
      refused = req.output.safeParse({ kind: "draft", subject: null, body_markdown: "Dear [Recipient Name],\n\nSee you on <date>.\n\nKind regards,\n[Your Name]", questions: [] });
      return answered(req, { kind: "draft", subject: null, body_markdown: "Dear Ada,\n\nSee you on Thursday.\n\nKind regards,", questions: [] });
    });
    await api().post("/mailbox/assist").send({ mode: "write", in_reply_to: lastMessageId });
    expect(refused.success).toBe(false);
    expect(refused.error.issues.map((i) => i.message).join(" ")).toMatch(/\[Recipient Name\].*<date>|<date>.*\[Recipient Name\]/s);
  });

  test("a new message needs something to write; Tidy Up needs words; a subject is suggested only when empty", async () => {
    const none = await api().post("/mailbox/assist").send({ mode: "write", to_addresses: ["ada@partner.test"] });
    expect(none.status).toBe(422);
    expect(none.body.error).toMatchObject({ code: "NOTHING_TO_WRITE", fields: { instruction: ["Say what to write"] } });
    const empty = await api().post("/mailbox/assist").send({ mode: "tidy", body_html: "<p></p>" });
    expect(empty.body.error).toMatchObject({ code: "NOTHING_TO_WRITE", fields: { body_html: ["Write the email first"] } });

    const draft = { kind: "draft", subject: "Ikeja venue visit on Thursday", body_markdown: "Dear Ada,\n\nThank you.\n\nKind regards,", questions: [] };
    ai.complete.mockImplementationOnce(async (req) => {
      // Addresses reach the model as tokens too; an outside address with no name in the conversation has none.
      expect(req.input.compose).toMatchObject({ kind: "new", to: [{ address: expect.stringMatching(/^KEPT\d{3}$/), name: null }] });
      return answered(req, draft);
    });
    const fresh = await api().post("/mailbox/assist").send({ mode: "write", to_addresses: ["amaka@mycity.test"], instruction: "thank ada" });
    expect(fresh.body.subject).toBe("Ikeja venue visit on Thursday");

    ai.complete.mockImplementationOnce((req) => answered(req, draft));
    const titled = await api().post("/mailbox/assist").send({ mode: "write", subject: "Thanks", instruction: "thank ada" });
    expect(titled.body.subject).toBeNull();

    // A colleague's name comes from the staff list; the person's own words go to Tidy Up.
    ai.complete.mockImplementationOnce(async (req) => {
      expect(req).toMatchObject({ purpose: "mail-tidy" });
      expect(req.input.compose.to).toEqual([{ name: "Amaka Eze", address: expect.stringMatching(/^KEPT\d{3}$/) }]);
      expect(req.input.draft).toBe("hi amaka pls see the attached list");
      expect(req.input.compose.attachments).toEqual(["visit-list.xlsx"]);
      return answered(req, { kind: "draft", subject: null, body_markdown: "Hello Amaka,\n\nPlease see the attached list.\n\nKind regards,", questions: [] });
    });
    const tidy = await api()
      .post("/mailbox/assist")
      .send({ mode: "tidy", to_addresses: ["ceo@mycity.test"], subject: "List", attachment_names: ["visit-list.xlsx"], body_html: "<p>hi amaka pls see the attached list</p>" });
    expect(tidy.body.body_html).toBe("<p>Hello Amaka,</p>\n<p>Please see the attached list.</p>\n<p>Kind regards,</p>");
  });

  test("Spam is never read by AI, and nobody reaches another person's mail", async () => {
    const reply = await api().post("/mailbox/assist").send({ mode: "write", in_reply_to: spamMessageId });
    expect(reply.status).toBe(422);
    expect(reply.body.error.code).toBe("SPAM_NOT_READ");
    expect((await api().post(`/mailbox/threads/${spamThreadId}/summary`).send({})).body.error.code).toBe("SPAM_NOT_READ");
    expect(ai.complete).not.toHaveBeenCalled();
    // The CEO has no mailbox of their own here, and no way into Bola's.
    expect((await api(other).post(`/mailbox/threads/${threadId}/summary`).send({})).status).toBe(409);
  });

  test("no provider set up: the stub cannot write a real draft, so Write With AI is off", async () => {
    const real = jest.requireActual("../../src/services/ai/llm.service");
    ai.complete.mockImplementationOnce((req) => real.complete(req));
    const r = await api().post("/mailbox/assist").send({ mode: "write", in_reply_to: lastMessageId });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ available: false, kind: null, subject: null, body_html: null, questions: [], ai_run_id: null });
    expect((await one("SELECT vendor FROM ai_run WHERE purpose = 'mail-draft' ORDER BY started_at DESC LIMIT 1")).vendor).toBe("stub");

    ai.complete.mockRejectedValueOnce(new AppError("AI_DISABLED", "AI features are switched off.", 503));
    expect((await api().post("/mailbox/assist").send({ mode: "write", in_reply_to: lastMessageId })).body.available).toBe(false);
  });

  test("Summarise Thread keeps its summary until new mail arrives", async () => {
    const summary = {
      gist: "Ada asked for a venue visit; Thursday at 11:00 suits her.",
      key_points: ["Ada proposed the Ikeja venue.", "Thursday at 11:00 works for her team."],
      asked_of_you: ["Ada asks you to confirm Thursday and send the visit list."],
    };
    ai.complete.mockImplementationOnce(async (req) => {
      expect(req).toMatchObject({ purpose: "mail-summary", module: "mailbox", egress: "external" });
      expect(req.input.conversation).toHaveLength(3);
      return answered(req, summary);
    });
    const first = await api().post(`/mailbox/threads/${threadId}/summary`).send({});
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ available: true, mail_thread_id: threadId, ...summary, message_count: 3 });
    const event = await one("SELECT payload FROM event_log WHERE event_key = 'mail_thread.summarised'");
    expect(event.payload).toEqual({ mail_thread_id: threadId, message_count: 3, ai_run_id: first.body.ai_run_id });

    const again = await api().post(`/mailbox/threads/${threadId}/summary`).send({});
    expect(again.body).toEqual(first.body);
    expect(ai.complete).toHaveBeenCalledTimes(1);

    server.deliver("INBOX", mail({ subject: "Re: Venue visit", inReplyTo: "<a1@partner.test>", references: ["<a1@partner.test>"], text: "Also, parking is at the back gate." }));
    await mailbox.sync((await api().get("/mailbox/connection")).body.mail_account_id);
    ai.complete.mockImplementationOnce((req) => answered(req, { ...summary, key_points: [...summary.key_points, "Parking is at the back gate."] }));
    const fresh = await api().post(`/mailbox/threads/${threadId}/summary`).send({});
    expect(fresh.body).toMatchObject({ message_count: 4, key_points: expect.arrayContaining(["Parking is at the back gate."]) });
    expect((await one("SELECT count(*)::int AS n FROM mail_thread_summary")).n).toBe(1);

    ai.complete.mockRejectedValueOnce(new AppError("AI_CAP_REACHED", "This month's AI budget is used up.", 503));
    server.deliver("INBOX", mail({ subject: "Re: Venue visit", inReplyTo: "<a1@partner.test>", references: ["<a1@partner.test>"], text: "See you." }));
    await mailbox.sync((await api().get("/mailbox/connection")).body.mail_account_id);
    expect((await api().post(`/mailbox/threads/${threadId}/summary`).send({})).body).toMatchObject({ available: false, gist: null });
  });

  test("Dictate: the recording is held only until it is written down, and nobody else can use it", async () => {
    const up = await api().post("/mailbox/dictation").attach("file", WEBM, "dictation.webm");
    expect(up.status).toBe(201);
    const id = up.body.document_id;
    expect(await one("SELECT doc_type, entity_type FROM document WHERE document_id = $1", [id])).toEqual({ doc_type: "mail_dictation", entity_type: "mail_account" });
    // A recording is never made playable: it is read once and removed.
    await drain();
    expect(queues.enqueue).not.toHaveBeenCalledWith("av-transcode", expect.anything(), expect.anything(), expect.anything());

    expect((await api(other).post(`/mailbox/dictation/${id}/transcript`).send({})).status).toBe(409);
    transcription.transcribe.mockResolvedValueOnce({ text: " Tell Ada Thursday works. ", draft: false, provisional: true, run_id: null, vendor: "groq", model: "whisper-large-v3" });
    const words = await api().post(`/mailbox/dictation/${id}/transcript`).send({});
    expect(words.status).toBe(200);
    expect(words.body).toEqual({ text: "Tell Ada Thursday works.", draft: false });
    expect(transcription.transcribe).toHaveBeenCalledWith(expect.objectContaining({ document_id: id, module: "mailbox", purpose: "mail-dictation" }));
    expect(await one("SELECT 1 AS n FROM document WHERE document_id = $1", [id])).toBeUndefined();
    expect((await api().post(`/mailbox/dictation/${id}/transcript`).send({})).status).toBe(404);

    // A failed transcription still removes the recording.
    const second = (await api().post("/mailbox/dictation").attach("file", WEBM, "dictation.webm")).body.document_id;
    transcription.transcribe.mockRejectedValueOnce(new AppError("AI_UNAVAILABLE", "The AI service is not answering. Try again in a few minutes.", 503));
    expect((await api().post(`/mailbox/dictation/${second}/transcript`).send({})).status).toBe(503);
    expect(await one("SELECT 1 AS n FROM document WHERE document_id = $1", [second])).toBeUndefined();
  });

  test("a recording a closed tab left behind is swept once it is an hour old", async () => {
    const left = (await api().post("/mailbox/dictation").attach("file", WEBM, "dictation.webm")).body.document_id;
    expect((await vault.purgeTransient()).removed).toBe(0);
    await q("UPDATE document SET created_at = now() - interval '61 minutes' WHERE document_id = $1", [left]);
    expect((await vault.purgeTransient()).removed).toBe(1);
    expect(await one("SELECT 1 AS n FROM document WHERE document_id = $1", [left])).toBeUndefined();
  });
});
