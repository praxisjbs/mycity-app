"use strict";
/**
 * Praxis AI's Staff Community cards on the real migrations (docs/guides/praxis-ai.md §6.11;
 * decision 19; the handoff's PR4): "Tell Ada" drafts a direct message the person sends with one
 * press, in the conversation with her (opened if there was none) through the chat's own service;
 * a post in #general; a recipient who is not on the staff refused on the field; a channel the
 * person may not post in refused; a suggested card never runs unasked.
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
const { one, fresh, script, say, harness } = require("./helpers/praxis");

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
});
