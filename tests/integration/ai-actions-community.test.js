"use strict";
/**
 * Praxis AI's Staff Community cards on the real migrations (docs/guides/praxis-ai.md §6.11;
 * decision 19; the handoff's PR4): "Tell Ada" drafts a direct message the person sends with one
 * press, in the conversation with her (opened if there was none) through the chat's own service;
 * a post in #general; a recipient who is not on the staff refused on the field; a channel the
 * person may not post in refused; a suggested card never runs unasked. Every other form of Staff
 * Community in the chat (decisions 33 and 40): Create Channel (its purpose posted as New Channel
 * posts it), Save Channel by the channel's name for its admin alone, Post Recognition, Send Wishes on
 * a card named by whose it is, Save Message on the person's own newest message within its window,
 * and Publish Announcement and Save Announcement for holders of announcements.post alone.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-community
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
const realtime = require("../../src/services/realtime/emitter");
const registry = require("../../src/shared/ai/registry");
const { q, one, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("Praxis AI's Staff Community cards against the real migrations", () => {
  let app;
  let h;
  let general;
  let announcements;

  beforeAll(async () => {
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    jest.spyOn(realtime, "toChannel").mockReturnValue(true);
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ada", first: "Ada", last: "Obi", email: "ada@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026" },
      { who: "tunde", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026" },
    ]);
    const channels = (await h.as("tunde").get("/community/channels")).body.data;
    general = channels.find((ch) => ch.name === "general").community_channel_id;
    announcements = channels.find((ch) => ch.name === "announcements").community_channel_id;
    registry.load();
    fresh();
  }, 120_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(realtime, "toUser").mockReturnValue(true);
    jest.spyOn(realtime, "toChannel").mockReturnValue(true);
    fresh();
  });

  test("community.message: Tell Ada drafts a direct message the person sends with one press, in the conversation with her", async () => {
    const sent = script(say({ text: "Here is the message to send Ada.", action: { key: "community.message", values: { employee_id: h.people.ada.employee_id, body: "The weekly report is ready for you." }, suggested: false } }));
    const asked = await h.ask("tunde", { question: "Tell Ada the weekly report is ready for her.", shows: ["cards", "pane"] });
    expect(asked.status).toBe(200);
    expect(sent[0].messages[0].content).toMatch(/- community\.message: .*may be offered unasked/);
    const card = asked.body.card;
    expect(card).toMatchObject({ action_key: "community.message", label: "Send Message", schema: "community.DirectMessageSend", risk: "standard", confirm: "press", suggested: false, values: { employee_id: h.people.ada.employee_id, body: "The weekly report is ready for you." }, problems: {} });
    expect(card.records).toEqual([expect.objectContaining({ type: "employee", id: h.people.ada.employee_id, label: "Ada Obi", link: expect.stringMatching(/^\/people\?tab=employees&id=/) })]);
    expect(card.fields.map((f) => [f.name, f.label, f.kind, f.long])).toEqual([["employee_id", "To", "id", false], ["body", "Message", "text", true]]);
    expect((await one("SELECT count(*)::int AS n FROM community_message")).n).toBe(0);

    const pressed = await h.press("tunde", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([{ type: "direct_message", id: expect.any(String), label: "Message sent", ok: true, message: "sent", link: expect.stringMatching(/^\/community\?tab=direct-messages&id=/) }]);
    const conversations = (await h.as("ada").get("/community/direct")).body.data;
    expect(conversations).toHaveLength(1);
    const messages = (await h.as("ada").get(`/community/channels/${conversations[0].community_channel_id}/messages`)).body.data;
    expect(messages.map((m) => [m.message_type, m.body])).toEqual([["text", "The weekly report is ready for you."]]);
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'direct_message.sent' AND entity_id = $1", [pressed.body.lines[0].id])).n).toBe(1);
  });

  test("a recipient who is not on the staff is refused on the field, and a colleague with no login too", async () => {
    script(say({ text: "Here it is.", action: { key: "community.message", values: { employee_id: "00000000-0000-4000-8000-0000000000ee", body: "Hello" }, suggested: false } }));
    const asked = await h.ask("tunde", { question: "Message the auditor.", shows: ["cards"] });
    expect(asked.body.card.records).toEqual([expect.objectContaining({ id: "00000000-0000-4000-8000-0000000000ee", label: "employee" })]);
    const pressed = await h.press("tunde", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(422);
    expect(pressed.body.error).toMatchObject({ code: "NOT_A_COLLEAGUE", fields: { employee_id: ["Not a colleague"] } });
    expect((await one("SELECT count(*)::int AS n FROM community_message")).n).toBe(1);
    expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [asked.body.card.ai_action_draft_id])).toEqual({ status: "shown" });
  });

  test("community.post: a post in #general through the chat's own service; #announcements, where nobody posts straight in, is refused", async () => {
    script(say({ text: "Here is the post.", action: { key: "community.post", values: { community_channel_id: general, body: "The office closes at 3 on Friday." }, suggested: false } }));
    const asked = await h.ask("ada", { question: "Post in general that the office closes at 3 on Friday.", shows: ["cards"] });
    expect(asked.body.card).toMatchObject({ action_key: "community.post", label: "Post Message", schema: "community.ChannelPost", problems: {} });
    expect(asked.body.card.records).toEqual([expect.objectContaining({ type: "channel", id: general, label: "#general" })]);
    const pressed = await h.press("ada", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([{ type: "channel_message", id: expect.any(String), label: "Posted", ok: true, message: "posted", link: expect.stringMatching(/^\/community\?tab=channels&id=/) }]);
    const messages = (await h.as("tunde").get(`/community/channels/${general}/messages`)).body.data;
    expect(messages.some((m) => m.body === "The office closes at 3 on Friday.")).toBe(true);

    script(say({ text: "Here is the post.", action: { key: "community.post", values: { community_channel_id: announcements, body: "Closing early" }, suggested: false } }));
    const refused = await h.ask("ada", { question: "Post it in announcements.", shows: ["cards"] });
    const press = await h.press("ada", refused.body.card.ai_action_draft_id);
    expect(press.status).toBe(403);
    expect(press.body.error.code).toBe("CANNOT_POST");
  });

  test("a suggested card is shown as a question and never runs unasked: Not Now cancels it and nothing was sent (decision 20)", async () => {
    script(say({ text: "Ada's leave is approved. Shall I tell her?", action: { key: "community.message", values: { employee_id: h.people.ada.employee_id, body: "Your leave is approved." }, suggested: true } }));
    const asked = await h.ask("tunde", { question: "Is Ada's leave approved?", shows: ["cards"] });
    expect(asked.body.card).toMatchObject({ action_key: "community.message", suggested: true, status: "shown" });
    const before = (await one("SELECT count(*)::int AS n FROM community_message")).n;
    const cancelled = await h.as("tunde").post(`/ai/cards/${asked.body.card.ai_action_draft_id}/cancel`).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect((await one("SELECT count(*)::int AS n FROM community_message")).n).toBe(before);
    expect((await h.press("tunde", asked.body.card.ai_action_draft_id)).body.error.code).toBe("CARD_CANCELLED");
  });

  /** The card the model drafts for a question, as the answer carries it. */
  const drawn = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    return asked.body.card;
  };
  /** What the answer asks instead of a card when the model left out a field the card needs (decision 34). */
  const askedFor = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(asked.body.card).toBeNull();
    return asked.body;
  };
  /** Draw it and press it; the press's answer. */
  const pressed = async (who, key, values, question) => {
    const card = await drawn(who, key, values, question);
    return { card, res: await h.press(who, card.ai_action_draft_id) };
  };

  test("channels.create and channels.edit: a channel created with its purpose posted as New Channel posts it, then renamed by its name, by its admin alone", async () => {
    const made = await pressed("tunde", "channels.create", { name: "lagos-visits", description: "Planning the Lagos visits", member_ids: [h.people.ada.employee_id] }, "Make a channel for the Lagos visits with Ada.");
    expect(made.card).toMatchObject({ label: "Create Channel", schema: "community.ChannelCreate", records: [], problems: {} });
    expect(made.card.names).toEqual([expect.objectContaining({ type: "employee", id: h.people.ada.employee_id, label: "Ada Obi" })]);
    expect(made.res.status).toBe(200);
    expect(made.res.body.lines[0]).toMatchObject({ type: "channel", label: "#lagos-visits", ok: true, message: "created" });
    const channel = made.res.body.lines[0].id;
    expect((await one("SELECT body FROM community_message WHERE community_channel_id = $1 AND message_type = 'text'", [channel])).body).toBe("Created #lagos-visits: Planning the Lagos visits");
    expect((await drawn("tunde", "channels.create", { name: "Lagos Visits!" })).problems).toEqual({ name: ["Not a valid name"] });

    const renamed = await pressed("tunde", "channels.edit", { community_channel_id: "#lagos-visits", name: "lagos-trips" }, "Rename #lagos-visits to lagos-trips.");
    expect(renamed.card).toMatchObject({ label: "Save Channel", schema: "community.ChannelChange", values: { community_channel_id: channel, name: "lagos-trips" } });
    expect(renamed.card.records).toEqual([expect.objectContaining({ type: "channel", id: channel, label: "#lagos-visits" })]);
    expect(renamed.res.status).toBe(200);
    expect(await one("SELECT name, description FROM community_channel WHERE community_channel_id = $1", [channel])).toEqual({ name: "lagos-trips", description: "Planning the Lagos visits" });
    // Ada is a member, not its admin; #general is everyone's.
    const notAdmin = await pressed("ada", "channels.edit", { community_channel_id: channel, description: "Mine now" });
    expect([notAdmin.res.status, notAdmin.res.body.error.code]).toEqual([403, "NOT_CHANNEL_ADMIN"]);
    const system = await pressed("ada", "channels.edit", { community_channel_id: general, name: "everyone" });
    expect([system.res.status, system.res.body.error.code]).toEqual([422, "SYSTEM_CHANNEL"]);
  });

  test("community.recognise and community.wish: a recognition in #general for a colleague named, never oneself; wishes on a card named by whose birthday it is", async () => {
    const thanks = await pressed("tunde", "community.recognise", { to_employee_id: h.people.ada.employee_id, message: "Thank you for the venue help" }, "Recognise Ada for the venue help.");
    expect(thanks.card).toMatchObject({ label: "Post Recognition", schema: "community.RecognitionCreate", records: [] });
    expect(thanks.card.names).toEqual([expect.objectContaining({ label: "Ada Obi" })]);
    expect(thanks.res.status).toBe(200);
    expect(await one("SELECT community_channel_id, body FROM community_message WHERE message_type = 'recognition' ORDER BY sent_at DESC LIMIT 1")).toEqual({ community_channel_id: general, body: "Thank you for the venue help" });
    const self = await pressed("tunde", "community.recognise", { to_employee_id: h.people.tunde.employee_id });
    expect([self.res.status, self.res.body.error.code]).toEqual([422, "SELF_RECOGNITION"]);

    // Ada moderates #general and posts the CEO's birthday card there by hand.
    const card = await h.as("ada").post(`/community/channels/${general}/messages`).send({ message_type: "birthday", subject_employee_id: h.people.ceo.employee_id });
    expect(card.status).toBe(201);
    const wish = await pressed("tunde", "community.wish", { community_message_id: "Amaka Eze's birthday", body: "Happy birthday, Amaka!" }, "Wish Amaka a happy birthday.");
    expect(wish.card).toMatchObject({ label: "Send Wishes", schema: "community.WishSend", values: { community_message_id: card.body.community_message_id } });
    expect(wish.card.records).toEqual([expect.objectContaining({ label: "Amaka Eze's birthday" })]);
    expect(wish.res.status).toBe(200);
    expect(await one("SELECT body FROM community_wish WHERE community_message_id = $1", [card.body.community_message_id])).toEqual({ body: "Happy birthday, Amaka!" });
    expect((await drawn("tunde", "community.wish", { community_message_id: "Bola's anniversary", body: "Well done" })).problems).toEqual({ community_message_id: ["No such card"] });
  });

  test("community.edit_message: the person's own newest message, named by where it is and never by its words, changed within 15 minutes; another's, or one too old, refused", async () => {
    const posted = await h.as("tunde").post(`/community/channels/${general}/messages`).send({ message_type: "text", body: "The visit is on Thursday" });
    expect(posted.status).toBe(201);
    const id = posted.body.community_message_id;
    const fixed = await pressed("tunde", "community.edit_message", { community_channel_id: "#general", community_message_id: "my last message", body: "The visit is on Friday at 10" }, "Change my last message in #general: the visit is Friday at 10.");
    expect(fixed.card).toMatchObject({ label: "Save Message", schema: "community.MessageChange", values: { community_channel_id: general, community_message_id: id } });
    expect(fixed.card.records).toEqual([expect.objectContaining({ type: "channel_message", id, label: "Your message in #general" })]);
    expect(JSON.stringify(fixed.card.records)).not.toMatch(/Thursday/);
    expect(fixed.res.status).toBe(200);
    expect(await one("SELECT body, edited_at IS NOT NULL AS edited FROM community_message WHERE community_message_id = $1", [id])).toEqual({ body: "The visit is on Friday at 10", edited: true });

    const hers = await h.as("ada").post(`/community/channels/${general}/messages`).send({ message_type: "text", body: "Bring the banners" });
    const notMine = await pressed("tunde", "community.edit_message", { community_channel_id: general, community_message_id: hers.body.community_message_id, body: "No banners" });
    expect([notMine.res.status, notMine.res.body.error.code]).toEqual([403, "NOT_YOURS"]);
    await q("UPDATE community_message SET sent_at = now() - interval '20 minutes' WHERE community_message_id = $1", [id]);
    const late = await pressed("tunde", "community.edit_message", { community_channel_id: general, community_message_id: id, body: "Saturday" });
    expect([late.res.status, late.res.body.error.fields]).toEqual([409, { body: ["Too late to edit"] }]);
  });

  test("announcements.publish and announcements.edit: for holders of announcements.post alone, one press as the screen's; a scheduled one changed by its headline, the rest as it stands", async () => {
    expect(await drawn("tunde", "announcements.publish", { title: "Office closed", body: "The office is closed on Friday." })).toBeNull();
    const now = await pressed("ada", "announcements.publish", { title: "Office closed on Friday", body: "The Lagos office is closed this Friday for maintenance.", audience: "all_staff" }, "Tell everyone the office is closed on Friday.");
    expect(now.card).toMatchObject({ label: "Publish Announcement", schema: "announcements.AnnouncementPost", risk: "standard", confirm: "press", values: { audience: "all_staff", urgency: "normal" } });
    expect(now.res.status).toBe(200);
    expect(now.res.body.lines[0]).toMatchObject({ type: "announcement", label: "Office closed on Friday", message: "published" });
    expect(await one("SELECT status, audience FROM announcement WHERE announcement_id = $1", [now.res.body.lines[0].id])).toEqual({ status: "published", audience: { kind: "all", department_ids: [] } });
    expect((await one("SELECT count(*)::int AS n FROM community_message WHERE community_channel_id = $1 AND message_type = 'announcement'", [announcements])).n).toBe(1);

    const department = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.ada.employee_id])).department_id;
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const scheduled = await pressed("ada", "announcements.publish", { title: "Town hall next week", body: "Join the town hall in the main hall.", audience: "departments", department_ids: [department], publish_at: later });
    expect(scheduled.card.names).toEqual([expect.objectContaining({ type: "department", id: department })]);
    expect(scheduled.res.body.lines[0]).toMatchObject({ message: "scheduled" });
    const townHall = scheduled.res.body.lines[0].id;
    // For chosen departments with none named: which departments is asked first (decision 34).
    expect(await askedFor("ada", "announcements.publish", { title: "Picnic", body: "A picnic for the team.", audience: "departments" })).toMatchObject({ content: "Which departments?" });

    const moved = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const edit = await pressed("ada", "announcements.edit", { announcement_id: "Town hall", publish_at: moved, urgency: "important" }, "Move the town hall announcement a day later.");
    expect(edit.card).toMatchObject({ label: "Save Announcement", schema: "announcements.AnnouncementChange", values: { announcement_id: townHall }, records: [expect.objectContaining({ type: "announcement", label: "Town hall next week" })] });
    expect(edit.res.status).toBe(200);
    expect(await one("SELECT title, urgency, audience, publish_at = $2::timestamptz AS moved FROM announcement WHERE announcement_id = $1", [townHall, moved])).toEqual({ title: "Town hall next week", urgency: "important", audience: { kind: "departments", department_ids: [department] }, moved: true });
    const gone = await pressed("ada", "announcements.edit", { announcement_id: now.res.body.lines[0].id, title: "Office closed all week" });
    expect([gone.res.status, gone.res.body.error.code]).toEqual([409, "ALREADY_POSTED"]);
  });

  test("a Staff Community card naming no record asks which first, with the person's own to tap; the answer tapped is matched by its words (decision 34)", async () => {
    // Save Channel: the channels Tunde runs, never #general.
    const channel = await askedFor("tunde", "channels.edit", { description: "Trips around Lagos" });
    expect(channel).toMatchObject({ content: "Which channel?", choices: ["#lagos-trips"] });
    expect(await drawn("tunde", "channels.edit", { community_channel_id: "#lagos-trips", description: "Trips around Lagos" })).toMatchObject({ problems: {} });

    // Send Wishes: the cards of the last two weeks, by whose they are; then the wish.
    expect(await askedFor("tunde", "community.wish", { body: "Many happy returns!" })).toMatchObject({ content: "Whose card is it?", choices: ["Amaka Eze's birthday"] });
    expect(await askedFor("tunde", "community.wish", { community_message_id: "Amaka Eze's birthday" })).toMatchObject({ content: "What is your wish?" });

    // Save Message: where it is, the person's own channels to tap, then their newest message or poll there.
    const where = await askedFor("tunde", "community.edit_message", { body: "Friday at 11" });
    expect(where).toMatchObject({ content: "Where is the message?" });
    expect(where.choices).toEqual(expect.arrayContaining(["#general", "#lagos-trips"]));
    expect(await askedFor("tunde", "community.edit_message", { community_channel_id: "#general", body: "Friday at 11" })).toMatchObject({ content: "Which message?", choices: ["My Newest Message", "My Newest Poll"] });

    // Post Recognition: a colleague from the directory, a name tapped matched to them.
    const whom = await askedFor("tunde", "community.recognise", { message: "Thanks for the banners" });
    expect(whom).toMatchObject({ content: "Who are you recognising?" });
    expect(whom.choices).toContain("Ada Obi");
    expect(await drawn("tunde", "community.recognise", { to_employee_id: "Ada Obi", message: "Thanks for the banners" })).toMatchObject({ values: { to_employee_id: h.people.ada.employee_id }, problems: {} });

    // Save Announcement: those still waiting to go out, by headline; departments only for chosen departments.
    expect(await askedFor("ada", "announcements.edit", { urgency: "normal" })).toMatchObject({ content: "Which announcement?", choices: ["Town hall next week"] });
    const name = (await one("SELECT d.name FROM department d JOIN employee e ON e.department_id = d.department_id WHERE e.employee_id = $1", [h.people.ada.employee_id])).name;
    const departments = await askedFor("ada", "announcements.publish", { title: "Picnic", body: "A picnic for the team.", audience: "departments" });
    expect(departments.choices).toContain(name);
    expect(await drawn("ada", "announcements.publish", { title: "Picnic", body: "A picnic for the team.", audience: "departments", department_ids: [name] })).toMatchObject({ values: { department_ids: [expect.any(String)] }, problems: {} });
  });
});
