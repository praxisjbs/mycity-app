"use strict";
/**
 * Praxis AI's mail card on the real migrations (docs/guides/praxis-ai.md §6.11; decision 19;
 * the handoff's PR4): a mail drafted from the chat is saved as a draft and queued through the
 * mailbox's own send, from the person's connected mailbox with the company signature baked in;
 * a person with no mailbox connected is refused at the press; a body with a gap left to fill is
 * held on its field. The mail server is an in-memory stand-in behind the provider's own methods.
 * The signatures (decision 40): Save My Signature through the Signature tab's own save, the mobile
 * written to the employee record; Configure Signature for holders of mailbox.signature alone, only
 * what it names changed.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-mailbox
 */
process.env.GEMINI_API_KEY = "test-key";
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const mailbox = require("../../src/modules/mailbox/mailbox.service");
const registry = require("../../src/shared/ai/registry");
const { one, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

/** A mail server in memory, as the mailbox suites use: it accepts one password and sends nothing anywhere. */
function fakeServer() {
  const LIST = [
    { path: "INBOX", delimiter: ".", flags: [], specialUse: "\\Inbox" },
    { path: "INBOX.Sent", delimiter: ".", flags: [], specialUse: "\\Sent" },
    { path: "INBOX.Archive", delimiter: ".", flags: [], specialUse: "\\Archive" },
    { path: "INBOX.Junk", delimiter: ".", flags: [], specialUse: "\\Junk" },
    { path: "INBOX.Trash", delimiter: ".", flags: [], specialUse: "\\Trash" },
    { path: "INBOX.Drafts", delimiter: ".", flags: [], specialUse: "\\Drafts" },
  ];
  return {
    password: "mail-pass-1",
    provider: () => ({
      verify: async () => true,
      listFolders: async () => LIST,
      fetchSince: async (_path, { lastUid = 0 }) => ({ uidValidity: 7, lastUid, messages: [], more: false }),
      markSeen: async () => true,
      move: async () => true,
      remove: async (_path, ids) => ids.length,
      send: async () => ({ messageId: "<sent@mycity.test>", raw: Buffer.from("raw") }),
      copyToSent: async () => "INBOX.Sent",
    }),
  };
}

describeDb("Praxis AI's mail card against the real migrations", () => {
  let app;
  let h;
  const server = fakeServer();

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    mailbox.useProvider(server.provider);
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "bola", first: "Bola", last: "Ade", email: "bola@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026" },
      { who: "admin", first: "Kemi", last: "Bello", email: "sysadmin@mycity.test", job: "Systems Administrator", role: "administrator", password: "Systems#Keeper2026" },
    ]);
    const connected = await h.as("bola").post("/mailbox/connection").send({ email: "bola@mycity.test", password: server.password });
    expect(connected.status).toBe(200);
    registry.load();
    fresh();
  }, 120_000);

  afterAll(async () => {
    mailbox.useProvider(null);
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fresh();
  });

  const values = { to_addresses: ["ada@partner.test"], subject: "Venue visit on Thursday", body: "Dear Ada,\n\nThis confirms our visit to the venue on Thursday 19 November at 10:00.\n\nWe look forward to seeing you." };

  test("mail.send: a mail written from the chat is saved as a draft and queued as Send does, from the person's own mailbox, the signature baked in", async () => {
    const sent = script(say({ text: "Here is the email to send.", action: { key: "mail.send", values, suggested: false } }));
    const asked = await h.ask("bola", { question: "Email ada@partner.test to confirm the venue visit on Thursday at 10.", shows: ["cards", "pane"] });
    expect(asked.status).toBe(200);
    expect(sent[0].messages[0].content).toMatch(/- mail\.send: /);
    const card = asked.body.card;
    expect(card).toMatchObject({ action_key: "mail.send", module_key: "mailbox", label: "Send Mail", schema: "mailbox.MailCompose", risk: "standard", confirm: "press", records: [], values: { ...values, cc_addresses: [] }, problems: {} });
    expect(card.fields.map((f) => [f.name, f.label, f.kind])).toEqual([["to_addresses", "To", "list"], ["cc_addresses", "Cc", "list"], ["subject", "Subject", "text"], ["body", "Message", "text"]]);
    expect((await one("SELECT count(*)::int AS n FROM mail_send_queue")).n).toBe(0);

    const pressed = await h.press("bola", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([{ type: "mail_send_queue", id: expect.any(String), label: "Mail queued", ok: true, message: "queued", link: "/mailbox?tab=sent" }]);
    const queued = await one("SELECT q.status, q.payload, q.user_id, d.subject, d.body_html, d.to_addresses FROM mail_send_queue q JOIN mail_draft d ON d.mail_draft_id = q.mail_draft_id WHERE q.mail_send_queue_id = $1", [pressed.body.lines[0].id]);
    expect(queued).toMatchObject({ status: "queued", user_id: h.people.bola.user_id, subject: "Venue visit on Thursday", to_addresses: ["ada@partner.test"] });
    expect(queued.body_html).toBe("<p>Dear Ada,</p><p>This confirms our visit to the venue on Thursday 19 November at 10:00.</p><p>We look forward to seeing you.</p>");
    // The signature is drawn as Send draws it: present on the queued payload (or null when none is set up), never typed by the model.
    expect(Object.prototype.hasOwnProperty.call(queued.payload, "signature")).toBe(true);
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'mail_message.queued' AND actor_user_id = $1", [h.people.bola.user_id])).n).toBe(1);
  });

  test("no mailbox connected: the card is drawn and refused at the press, with nothing queued", async () => {
    script(say({ text: "Here is the email.", action: { key: "mail.send", values, suggested: false } }));
    const asked = await h.ask("ceo", { question: "Email the partner to confirm Thursday.", shows: ["cards"] });
    expect(asked.body.card).toMatchObject({ action_key: "mail.send", status: "shown" });
    const pressed = await h.press("ceo", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(409);
    expect(pressed.body.error).toMatchObject({ code: "NO_MAILBOX", message: "Connect your mailbox first" });
    expect((await one("SELECT count(*)::int AS n FROM mail_send_queue WHERE user_id = $1", [h.people.ceo.user_id])).n).toBe(0);
    expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [asked.body.card.ai_action_draft_id])).toEqual({ status: "shown" });
  });

  test("a mail with a gap left to fill is held on its field before anyone presses (decision 19)", async () => {
    script(say({ text: "Here is the email.", action: { key: "mail.send", values: { ...values, body: "Dear [name],\n\nSee you on Thursday." }, suggested: false } }));
    const asked = await h.ask("bola", { question: "Email the partner.", shows: ["cards"] });
    expect(asked.body.card.problems).toEqual({ body: ["Fill the gap"] });
    const refused = await h.press("bola", asked.body.card.ai_action_draft_id);
    expect(refused.status).toBe(422);
    expect(refused.body.error.fields).toEqual({ body: ["Fill the gap"] });
    expect((await one("SELECT count(*)::int AS n FROM mail_send_queue")).n).toBe(1);
  });

  /** The card the model drafts for a question, as the answer carries it. */
  const drawn = async (who, key, given, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values: given, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    return asked.body.card;
  };

  test("signatures.save: Save My Signature through the tab's own save: the office line and a switch, then the mobile, written to the employee record", async () => {
    const card = await drawn("bola", "signatures.save", { office_line: "0201 234 5678", show_whatsapp: false }, "Put my office line on my signature and hide WhatsApp.");
    expect(card).toMatchObject({ action_key: "signatures.save", label: "Save My Signature", schema: "mailbox.MySignatureSave", records: [], problems: {} });
    expect(card.fields.map((f) => f.name)).toEqual(["mobile", "office_line", "show_mobile", "show_whatsapp"]);
    const pressed = await h.press("bola", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines[0]).toMatchObject({ type: "mail_signature", label: "Bola Ade", ok: true, message: "saved", link: "/mailbox?tab=signature" });
    const mine = (await h.as("bola").get("/mailbox/signature")).body;
    expect(mine).toMatchObject({ office_line: "+2342012345678", show_whatsapp: false });

    const mobile = await drawn("bola", "signatures.save", { mobile: "0803 123 4599" });
    expect((await h.press("bola", mobile.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT phone FROM employee WHERE employee_id = $1", [h.people.bola.employee_id])).toEqual({ phone: "+2348031234599" });
  });

  test("signatures.configure: Configure Signature for holders of mailbox.signature alone, only the links named changed, the rest as saved", async () => {
    expect(await drawn("bola", "signatures.configure", { linkedin_url: "https://linkedin.com/company/mycity" })).toBeNull();
    const before = (await h.as("admin").get("/mailbox/signature/config")).body;
    const card = await drawn("admin", "signatures.configure", { linkedin_url: "https://linkedin.com/company/mycity", show_social_links: true }, "Add our LinkedIn to the company signature.");
    expect(card).toMatchObject({ label: "Configure Signature", schema: "mailbox.SignatureConfigChange", problems: {} });
    const pressed = await h.press("admin", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    const after = (await h.as("admin").get("/mailbox/signature/config")).body;
    expect(after).toMatchObject({ linkedin_url: "https://linkedin.com/company/mycity", show_social_links: true });
    for (const k of ["app_store_url", "google_play_url", "instagram_url", "x_url", "confidentiality_note", "show_whatsapp", "show_app_links", "show_legal"]) expect([k, after[k]]).toEqual([k, before[k]]);
    expect((await drawn("admin", "signatures.configure", { x_url: "x.com/mycity" })).problems).toEqual({ x_url: ["Not a web address"] });
    expect((await drawn("admin", "signatures.configure", {})).problems).toEqual({ show_whatsapp: ["Nothing to change"] });
  });
});
