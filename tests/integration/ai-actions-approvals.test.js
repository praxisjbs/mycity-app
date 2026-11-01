"use strict";
/**
 * Praxis AI's My Approvals card on the real migrations (docs/guides/praxis-ai.md §6.11;
 * decisions 11 and 16; the handoff's PR4): the requests waiting on a person approved, rejected
 * or returned from the chat through decide(), after Confirm It's You; a rejection without a reason
 * held on its field; one's own request refused; a request decided on its own record refused with
 * that record's screen on its line.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-approvals
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
const grantsCache = require("../../src/shared/rbac/grants-cache");
const workingWeek = require("../../src/shared/time/working-week");
const definitions = require("../../src/shared/workflow/definitions");
const registry = require("../../src/shared/ai/registry");
const { q, one, drain, fresh, script, callRead, say, harness } = require("./helpers/praxis");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

function week(weeksAhead) {
  const d = new Date(Date.now() + weeksAhead * 7 * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return Array.from({ length: 5 }, (_, i) => new Date(d.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

describeDb("Praxis AI's My Approvals card against the real migrations", () => {
  let app;
  let h;
  let annual;

  /** A leave request by `who`, which waits on their line manager: its approval's instance id. */
  const waiting = async (who, day) => {
    const res = await h.as(who).post("/ess/leave").send({ leave_type_id: annual, starts_on: day, ends_on: day, reason: "A day off" });
    expect([who, day, res.status, res.body.error]).toEqual([who, day, 201, undefined]);
    return res.body;
  };

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    workingWeek.invalidateCalendar();
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "one", first: "Musa", last: "Danjuma", email: "one@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
      { who: "two", first: "Zainab", last: "Lawal", email: "two@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
    ]);
    for (const who of ["one", "two"]) await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.manager.employee_id, h.people[who].employee_id]);
    await grantsCache.bumpTeamVersion();
    await drain();
    annual = (await h.as("one").get("/leave/types?active=true")).body.data.find((t) => t.code === "annual").leave_type_id;
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

  test("approvals.decide: the requests waiting on me approved from the chat after Confirm It's You, each through decide()", async () => {
    const days = week(2);
    const a = await waiting("one", days[0]);
    const b = await waiting("two", days[1]);
    const ids = [a.workflow_instance_id, b.workflow_instance_id];
    const sent = script(callRead("approvals__mine", {}), say({ text: "Two requests wait on you. Here they are to approve.", action: { key: "approvals.decide", values: { workflow_instance_ids: ids, decision: "approve" }, suggested: false } }));
    const asked = await h.ask("manager", { question: "Approve everything waiting on me.", shows: ["cards", "pane"] });
    expect(asked.status).toBe(200);
    expect(sent[0].messages[0].content).toMatch(/- approvals\.decide: /);
    const card = asked.body.card;
    expect(card).toMatchObject({ action_key: "approvals.decide", module_key: "settings", label: "Decide Requests", schema: "workflow.ApprovalDecide", risk: "approval", confirm: "fresh_sign_in", bulk: 25, values: { workflow_instance_ids: ids, decision: "approve" }, problems: {} });
    expect(card.records.map((r) => r.label)).toEqual(["Leave Request, Musa Danjuma", "Leave Request, Zainab Lawal"]);
    expect(card.fields.find((f) => f.name === "decision")).toMatchObject({ label: "Decision", kind: "choice", options: ["approve", "reject", "request_changes"] });
    await h.stale("manager");
    expect((await h.press("manager", card.ai_action_draft_id)).status).toBe(403);
    await h.confirmPassword("manager");
    const pressed = await h.press("manager", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([
      { type: "workflow_instance", id: a.workflow_instance_id, label: "Leave Request, Musa Danjuma", ok: true, message: "approved", link: expect.stringMatching(/^\/people\?tab=leave&id=/) },
      { type: "workflow_instance", id: b.workflow_instance_id, label: "Leave Request, Zainab Lawal", ok: true, message: "approved", link: expect.stringMatching(/^\/people\?tab=leave&id=/) },
    ]);
    for (const id of ids) expect((await h.as("manager").get(`/workflow/instances/${id}`)).body.state).toBe("approved");
    expect((await h.as("manager").get("/workflow/mine")).body.data).toEqual([]);
  });

  test("a rejection without a reason is a problem on the field; given one, the request is returned with it", async () => {
    const [day] = week(3);
    const r = await waiting("one", day);
    script(say({ text: "Here it is.", action: { key: "approvals.decide", values: { workflow_instance_ids: [r.workflow_instance_id], decision: "request_changes" }, suggested: false } }));
    const asked = await h.ask("manager", { question: "Send it back for changes.", shows: ["cards"] });
    expect(asked.body.card.problems).toEqual({ reason: ["Say why"] });
    await h.confirmPassword("manager");
    expect((await h.press("manager", asked.body.card.ai_action_draft_id)).status).toBe(422);
    const pressed = await h.press("manager", asked.body.card.ai_action_draft_id, { values: { workflow_instance_ids: [r.workflow_instance_id], decision: "request_changes", reason: "Pick another week" } });
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines[0]).toMatchObject({ ok: true, message: "returned for changes" });
    expect(await one("SELECT decision, reason FROM workflow_decision WHERE workflow_instance_id = $1 ORDER BY decided_at DESC LIMIT 1", [r.workflow_instance_id])).toEqual({ decision: "request_changes", reason: "Pick another week" });
  });

  test("nobody decides their own request: the card is refused at the press and the request still waits", async () => {
    const [day] = week(4);
    const own = await waiting("two", day);
    script(say({ text: "Approve mine.", action: { key: "approvals.decide", values: { workflow_instance_ids: [own.workflow_instance_id], decision: "approve" }, suggested: false } }));
    const asked = await h.ask("two", { question: "Approve my own request.", shows: ["cards"] });
    expect(asked.body.card.records).toEqual([expect.objectContaining({ label: "Leave Request, Zainab Lawal" })]);
    await h.confirmPassword("two");
    const pressed = await h.press("two", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(403);
    expect(pressed.body.error.code).toBe("SELF_APPROVAL");
    expect((await h.as("two").get(`/workflow/instances/${own.workflow_instance_id}`)).body.state).toBe("pending");
  });

  test("a request decided on its own record is refused with that record's screen on its line, and nothing else on the card is lost", async () => {
    const days = week(5);
    const onRecord = await waiting("one", days[0]);
    const plain = await waiting("two", days[1]);
    // A leave request is decided in My Approvals; for this case the flow reads as one decided on its record (a sanction's).
    jest.spyOn(definitions, "decidedOnRecord").mockImplementation((key) => key === "leave.approval");
    script(say({ text: "Two to approve.", action: { key: "approvals.decide", values: { workflow_instance_ids: [onRecord.workflow_instance_id, plain.workflow_instance_id], decision: "approve" }, suggested: false } }));
    const asked = await h.ask("manager", { question: "Approve both.", shows: ["cards"] });
    await h.confirmPassword("manager");
    const pressed = await h.press("manager", asked.body.card.ai_action_draft_id);
    // Every request here is of the same flow, so both lines carry the record's screen and the press is a refusal the person reads on the card.
    expect(pressed.status).toBe(409);
    expect(pressed.body.error.code).toBe("DECIDE_ON_RECORD");
    expect((await h.as("manager").get(`/workflow/instances/${plain.workflow_instance_id}`)).body.state).toBe("pending");
    expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [asked.body.card.ai_action_draft_id])).toEqual({ status: "shown" });
  });

  test("a request the person may not read is refused at the press with nothing run", async () => {
    const [day] = week(6);
    const theirs = await waiting("one", day);
    script(say({ text: "Approve it.", action: { key: "approvals.decide", values: { workflow_instance_ids: [theirs.workflow_instance_id], decision: "approve" }, suggested: false } }));
    const asked = await h.ask("two", { question: "Approve Musa's request.", shows: ["cards"] });
    expect(asked.body.card.records).toEqual([expect.objectContaining({ id: theirs.workflow_instance_id, label: "workflow instance" })]);
    await h.confirmPassword("two");
    const pressed = await h.press("two", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(404);
    expect(pressed.body.error).toMatchObject({ code: "APPROVAL_NOT_YOURS", fields: { workflow_instance_ids: ["Not yours to read"] } });
    expect((await h.as("manager").get(`/workflow/instances/${theirs.workflow_instance_id}`)).body.state).toBe("pending");
  });
});
