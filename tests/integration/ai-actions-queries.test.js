"use strict";
/**
 * Praxis AI's Queries & Sanctions cards on the real migrations (docs/guides/praxis-ai.md §6.11,
 * decision 33): Raise Query after Confirm It's You, signed with the signature the person saved
 * (the chat cannot draw one: without it the press says so plainly and Draw Signature opens Edit
 * Signature), never on oneself; the queried person's Send Response on their own open query, by its
 * number, once; Save Rule (New Rule and Edit Rule), Add Step and Save Step on the chain, Add Letter
 * and Save Letter, each held to queries.configure as its route is, a letter's own {{ names }}
 * passing the card's gap guard while any other gap is marked.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-queries
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
const grantsCache = require("../../src/shared/rbac/grants-cache");
const registry = require("../../src/shared/ai/registry");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

/** A one-pixel PNG as the signature pad sends it. */
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describeDb("Praxis AI's Queries & Sanctions cards against the real migrations", () => {
  let app;
  let h;
  let raised = null;

  /** The card the model drafts for a question, as the answer carries it. */
  const drawn = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    return asked.body.card;
  };
  const id = (who) => h.people[who].employee_id;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [id("manager"), id("staff")]);
    await grantsCache.bumpTeamVersion();
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

  test("queries.raise: Raise Query waits on Confirm It's You, says plainly it cannot draw a signature, then signs with the saved one through Raise a Query's own function", async () => {
    const values = { employee_id: id("staff"), subject: "Missed client visit", details: "Missed the client visit on Monday without telling anyone; the client waited an hour." };
    const card = await drawn("ops", "queries.raise", values, "Raise a query on Tunde for missing the client visit on Monday.");
    expect(card).toMatchObject({ action_key: "queries.raise", label: "Raise Query", schema: "queries.QueryRaise", risk: "approval", confirm: "fresh_sign_in", records: [], problems: {} });
    expect(card.names).toEqual([expect.objectContaining({ type: "employee", id: id("staff"), label: "Tunde Ade" })]);
    expect(card.fields.map((f) => f.name)).toEqual(["employee_id", "subject", "details", "policy_id", "policy_clause"]);

    // No signature saved: the press is refused with what to do, and nothing is raised.
    await h.confirmPassword("ops");
    const unsigned = await h.press("ops", card.ai_action_draft_id);
    expect(unsigned.status).toBe(409);
    expect(unsigned.body.error).toMatchObject({ code: "NO_SIGNATURE", message: expect.stringContaining("cannot draw one") });
    expect(await one("SELECT count(*)::int AS n FROM employee_query")).toEqual({ n: 0 });

    // Drawn once on Edit Signature: the same card is now signed with it.
    expect((await h.as("ops").put("/queries/my-signature").send({ signature: SIGNATURE })).status).toBe(200);
    const pressed = await h.press("ops", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "query", label: expect.stringMatching(/^QRY-\d+, Tunde Ade$/), ok: true, message: "raised", link: expect.stringMatching(/^\/queries\?tab=queries&id=/) })]);
    raised = await one("SELECT employee_query_id, number::text AS number, raised_by, status, source, signature_document_id IS NOT NULL AS signed FROM employee_query WHERE employee_id = $1", [id("staff")]);
    expect(raised).toMatchObject({ raised_by: h.people.ops.user_id, status: "awaiting_response", source: "person", signed: true });

    // Never on oneself: Raise a Query's own rule, at the press.
    const self = await drawn("ops", "queries.raise", { ...values, employee_id: id("ops") });
    const refused = await h.press("ops", self.ai_action_draft_id);
    expect([refused.status, refused.body.error.code]).toEqual([422, "QUERY_SELF"]);
    // Staff raise no queries: no card.
    expect(await drawn("staff", "queries.raise", values)).toBeNull();
  });

  test("my_queries.respond: the queried person's Send Response on their own open query, by its number, once", async () => {
    expect(raised).toBeTruthy();
    const words = "I was held up on Third Mainland Bridge and called my manager at 8 to say so.";
    // Which query, when not said, is asked first with the person's own open queries to tap (decision 34).
    script(say({ text: "Here is the response.", action: { key: "my_queries.respond", values: { body: words }, suggested: false } }));
    const which = await h.ask("staff", { question: "Send my response to the query.", shows: ["cards"] });
    expect(which.body).toMatchObject({ content: "Which query is it?", card: null });
    expect(which.body.choices).toEqual([`${raised.number} Missed client visit`]);
    const card = await drawn("staff", "my_queries.respond", { employee_query_id: raised.number, body: words }, `Respond to my query ${raised.number}.`);
    expect(card).toMatchObject({ action_key: "my_queries.respond", label: "Send Response", schema: "queries.QueryRespond", risk: "standard", values: { employee_query_id: raised.employee_query_id, body: words }, problems: {} });
    expect(card.records).toEqual([expect.objectContaining({ type: "query", id: raised.employee_query_id, label: `${raised.number} Missed client visit` })]);
    const pressed = await h.press("staff", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "query", id: raised.employee_query_id, ok: true, message: "response sent", link: expect.stringMatching(/^\/ess\?tab=my-queries&id=/) })]);
    expect(await one("SELECT status FROM employee_query WHERE employee_query_id = $1", [raised.employee_query_id])).toEqual({ status: "under_review" });
    expect((await one("SELECT body FROM query_response WHERE employee_query_id = $1", [raised.employee_query_id])).body).toContain("Third Mainland Bridge");

    // One response a query: a second is refused by the response's own rule.
    const again = await drawn("staff", "my_queries.respond", { employee_query_id: raised.employee_query_id, body: "And one more thing I forgot to say." });
    const refused = await h.press("staff", again.ai_action_draft_id);
    expect([refused.status, refused.body.error.code]).toEqual([409, "QUERY_NOT_OPEN"]);
    // Someone else's query is never theirs to answer: its number names nothing of theirs.
    const theirs = await drawn("manager", "my_queries.respond", { employee_query_id: raised.number, body: words });
    expect(theirs.problems).toEqual({ employee_query_id: ["No such query"] });
  });

  test("query_rules.create and query_rules.edit: Save Rule as a draft, then by its name with its letter named, for holders of queries.configure alone", async () => {
    const add = await drawn("ops", "query_rules.create", { name: "Overdue Tasks", source_event: "overdue_task", threshold: 3, window_days: 30 }, "Add a rule: three overdue tasks in 30 days raises a query.");
    expect(add).toMatchObject({ action_key: "query_rules.create", label: "Save Rule", schema: "query_rules.QueryRuleCreate", problems: {} });
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.status).toBe(200);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "query_rule", label: "Overdue Tasks", ok: true, message: "saved as a draft" })]);
    const rule = await one("SELECT query_rule_id, active, activated_at, threshold::int AS threshold FROM query_rule WHERE name = 'Overdue Tasks'");
    expect(rule).toMatchObject({ active: false, activated_at: null, threshold: 3 });

    const edit = await drawn("ops", "query_rules.edit", { query_rule_id: "Overdue Tasks", threshold: 4, letter_template: "Query Letter" });
    expect(edit).toMatchObject({ label: "Save Rule", schema: "query_rules.QueryRuleChange", values: { query_rule_id: rule.query_rule_id, threshold: 4, letter_template: "query-letter" }, problems: {} });
    expect(edit.records).toEqual([expect.objectContaining({ type: "query_rule", id: rule.query_rule_id, label: "Overdue Tasks" })]);
    expect((await h.press("ops", edit.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT threshold::int AS threshold, letter_template FROM query_rule WHERE query_rule_id = $1", [rule.query_rule_id])).toEqual({ threshold: 4, letter_template: "query-letter" });

    // queries.configure: a line manager may raise queries but never write rules; staff neither.
    expect(await drawn("manager", "query_rules.create", { name: "Late Reports", source_event: "overdue_task", threshold: 2, window_days: 7 })).toBeNull();
    expect(await drawn("staff", "query_rules.edit", { query_rule_id: rule.query_rule_id, threshold: 9 })).toBeNull();
  });

  test("chain.add_step and chain.edit_step: Add Step with its letter named, then retired by its name, through the chain's own functions", async () => {
    const add = await drawn("ops", "chain.add_step", { name: "Final Warning", letter_template: "Warning Letter", financial_effect: "none", valid_days: 365 }, "Add a Final Warning step.");
    expect(add).toMatchObject({ action_key: "chain.add_step", label: "Add Step", schema: "sanctions.ConsequenceStepCreate", values: { letter_template: "warning-letter" }, problems: {} });
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.status).toBe(200);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "consequence_step", label: "Final Warning", ok: true, message: "added" })]);
    const step = await one("SELECT consequence_step_id, letter_template, active FROM consequence_step WHERE name = 'Final Warning'");
    expect(step).toMatchObject({ letter_template: "warning-letter", active: true });

    const retire = await drawn("ops", "chain.edit_step", { consequence_step_id: "final warning", active: false });
    expect(retire).toMatchObject({ label: "Save Step", schema: "sanctions.ConsequenceStepChange", values: { consequence_step_id: step.consequence_step_id, active: false }, problems: {} });
    expect(retire.records).toEqual([expect.objectContaining({ type: "consequence_step", id: step.consequence_step_id, label: "Final Warning" })]);
    expect((await h.press("ops", retire.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT active FROM consequence_step WHERE consequence_step_id = $1", [step.consequence_step_id])).toEqual({ active: false });
    expect(await drawn("manager", "chain.add_step", { name: "Reprimand" })).toBeNull();
  });

  test("letters.create and letters.edit: a letter's own {{ names }} pass the card's gap guard, any other gap is marked; Save Letter renames it and saves its wording as the next version", async () => {
    const wording = "Dear {{ employee.first_name }},\n\nThis is your final warning about {{ subject }}. Your conduct must improve at once, or the next step of the chain follows.";
    const add = await drawn("ops", "letters.create", { name: "Final Warning", purpose: "sanction", title: "FINAL WARNING", body: wording }, "Add a sanction letter called Final Warning.");
    expect(add).toMatchObject({ action_key: "letters.create", label: "Add Letter", schema: "templates.LetterTemplateCreate", problems: {} });
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.status).toBe(200);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "letter_template", label: "Final Warning", ok: true, message: "saved as a draft" })]);
    const letter = await one("SELECT letter_template_id, key, purpose, status FROM letter_template WHERE name = 'Final Warning'");
    expect(letter).toMatchObject({ purpose: "sanction", status: "draft" });

    // A gap left for someone to fill is still marked: only the letter's own names pass.
    const gap = await drawn("ops", "letters.create", { name: "Short Notice", purpose: "sanction", body: "Dear {{ employee.first_name }},\n\nYou must attend a hearing on [insert date] at the head office, without fail." });
    expect(gap.problems).toEqual({ body: ["Fill the gap"] });

    const edit = await drawn("ops", "letters.edit", { letter_template_id: "Final Warning", name: "Last Warning", body: `${wording}\n\nWe expect to see the change within a week.` });
    expect(edit).toMatchObject({ label: "Save Letter", schema: "templates.LetterTemplateChange", values: { letter_template_id: letter.letter_template_id }, problems: {} });
    expect(edit.records).toEqual([expect.objectContaining({ type: "letter_template", id: letter.letter_template_id, label: "Final Warning" })]);
    const saved = await h.press("ops", edit.ai_action_draft_id);
    expect(saved.status).toBe(200);
    expect(saved.body.lines).toEqual([expect.objectContaining({ label: "Last Warning", ok: true, message: "saved" })]);
    expect(await one("SELECT name FROM letter_template WHERE letter_template_id = $1", [letter.letter_template_id])).toEqual({ name: "Last Warning" });
    const versions = await q("SELECT title, body FROM template_version WHERE key = $1 ORDER BY version", [letter.key]);
    expect(versions.rows.map((r) => r.title)).toEqual(["FINAL WARNING", "FINAL WARNING"]);
    expect(versions.rows[1].body).toContain("within a week");
  });
});
