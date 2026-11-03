"use strict";
/**
 * Praxis AI's Knowledge Hub · Policies cards on the real migrations (docs/guides/praxis-ai.md
 * §6.11, decision 33): Start Policy with its title, as New Policy's sheet starts one (everyone,
 * acknowledged within 7 days, no approval); Save Draft by the policy's title, only what changes,
 * the rest kept as the draft holds it; both held to policies.manage as their routes are.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-policies
 */
process.env.GEMINI_API_KEY = "test-key";
const c = require("@mycity/contract");
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
const registry = require("../../src/shared/ai/registry");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("Praxis AI's policy cards against the real migrations", () => {
  let app;
  let h;

  /** The card the model drafts for a question, as the answer carries it. */
  const drawn = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    return asked.body.card;
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "staff", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
    ]);
    await drain();
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
    fresh();
  });

  test("policies.start and policies.draft: Start Policy as New Policy's sheet starts one; Save Draft by its title changes only what the card holds; both for holders of policies.manage alone", async () => {
    script(say({ text: "Here is the policy.", action: { key: "policies.start", values: {}, suggested: false } }));
    const ask = await h.ask("ops", { question: "Start a new policy.", shows: ["cards"] });
    expect(ask.body).toMatchObject({ content: "What is the policy called?", card: null });

    const start = await drawn("ops", "policies.start", { title: "Dress Code" }, "Start a policy called Dress Code.");
    expect(start).toMatchObject({ action_key: "policies.start", label: "Start Policy", schema: "policies.PolicyStart", risk: "standard", records: [], problems: {} });
    expect(start.fields.map((f) => f.name)).toEqual(["title"]);
    const started = await h.press("ops", start.ai_action_draft_id);
    expect(started.status).toBe(200);
    expect(started.body.lines).toEqual([expect.objectContaining({ type: "policy", label: expect.stringMatching(/ Dress Code$/), ok: true, message: "started", link: expect.stringMatching(/^\/knowledge\?tab=policies&policy=/) })]);
    const policy = await one("SELECT policy_id, number::text AS number, kind FROM policy WHERE title = 'Dress Code'");
    expect(policy.kind).toBe("document");
    const draftOf = () =>
      one(
        "SELECT title, applies_to_everyone, needs_acknowledgement, acknowledge_within_days::int AS days, needs_approval, body_markdown FROM policy_version WHERE policy_id = $1 AND status = 'draft'",
        [policy.policy_id],
      );
    expect(await draftOf()).toMatchObject({ title: "Dress Code", applies_to_everyone: true, needs_acknowledgement: true, days: 7, needs_approval: false });

    const words = "Staff dress smartly in the office.\n\nOn Fridays a MyCity shirt and jeans are fine.";
    const draft = await drawn("ops", "policies.draft", { policy_id: "Dress Code", body: words, everyone: false, work_patterns: ["remote"], needs_approval: true }, "Make the Dress Code apply to remote staff and need approval.");
    expect(draft).toMatchObject({ action_key: "policies.draft", label: "Save Draft", schema: "policies.PolicyDraftChange", values: { policy_id: policy.policy_id }, problems: {} });
    expect(draft.records).toEqual([expect.objectContaining({ type: "policy", id: policy.policy_id, label: `${policy.number} Dress Code` })]);
    const saved = await h.press("ops", draft.ai_action_draft_id);
    expect(saved.status).toBe(200);
    expect(saved.body.lines).toEqual([expect.objectContaining({ type: "policy", id: policy.policy_id, ok: true, message: "draft saved" })]);
    const after = await draftOf();
    expect(after).toMatchObject({ title: "Dress Code", applies_to_everyone: false, needs_acknowledgement: true, days: 7, needs_approval: true });
    expect(after.body_markdown).toContain("MyCity shirt");
    const audience = await q("SELECT work_pattern FROM policy_audience a JOIN policy_version v ON v.policy_version_id = a.policy_version_id WHERE v.policy_id = $1 AND v.status = 'draft'", [policy.policy_id]);
    expect(audience.rows.map((r) => r.work_pattern)).toEqual(["remote"]);

    // Only what changes: a new title keeps the text, who it applies to and the approval.
    const retitle = await drawn("ops", "policies.draft", { policy_id: policy.policy_id, title: "Dress Code and Grooming" });
    expect((await h.press("ops", retitle.ai_action_draft_id)).status).toBe(200);
    expect(await draftOf()).toMatchObject({ title: "Dress Code and Grooming", applies_to_everyone: false, needs_approval: true, body_markdown: after.body_markdown });
    expect((await drawn("ops", "policies.draft", { policy_id: policy.policy_id })).problems).toEqual({ policy_id: ["Nothing to change"] });

    // policies.manage, as the routes ask: staff are never drawn either card.
    expect(await drawn("staff", "policies.start", { title: "Casual Fridays" })).toBeNull();
    expect(await drawn("staff", "policies.draft", { policy_id: policy.policy_id, title: "Mine Now" })).toBeNull();
  });
});
