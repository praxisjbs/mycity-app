"use strict";
/**
 * Praxis AI's leave cards on the real migrations (docs/guides/praxis-ai.md §6.11; decisions 11
 * and 16; the handoff's PR4): a person's own request through Request Leave's service; four
 * requests approved from the chat by their line manager after Confirm It's You with a passkey,
 * and two rejected with a reason after a PIN; a request of one's own refused; a request outside
 * the person's scope on a bulk card refused at the press with nothing run.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-leave
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
const workingWeek = require("../../src/shared/time/working-week");
const registry = require("../../src/shared/ai/registry");
const { q, one, drain, fresh, script, callRead, say, harness } = require("./helpers/praxis");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

/** The Monday at least `weeksAhead` weeks from today, as YYYY-MM-DD, and the weekdays after it. */
function week(weeksAhead) {
  const d = new Date(Date.now() + weeksAhead * 7 * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return Array.from({ length: 5 }, (_, i) => new Date(d.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

describeDb("Praxis AI's leave cards against the real migrations", () => {
  let app;
  let h;
  let annual;
  const requests = {};

  const request = async (who, day, reason = "A day off") => {
    const res = await h.as(who).post("/ess/leave").send({ leave_type_id: annual, starts_on: day, ends_on: day, reason });
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
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "one", first: "Musa", last: "Danjuma", email: "one@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
      { who: "two", first: "Zainab", last: "Lawal", email: "two@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
      { who: "three", first: "Emeka", last: "Obi", email: "three@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
      { who: "four", first: "Hauwa", last: "Bello", email: "four@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
      { who: "outsider", first: "Bisi", last: "Ade", email: "outsider@mycity.test", job: "Accounts Officer", role: "employee", password: "Staff#Member2026", department: "Finance" },
    ]);
    for (const who of ["one", "two", "three", "four"]) await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [h.people.manager.employee_id, h.people[who].employee_id]);
    await grantsCache.bumpTeamVersion();
    await drain();
    const types = await h.as("one").get("/leave/types?active=true");
    annual = types.body.data.find((t) => t.code === "annual").leave_type_id;
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

  test("my_leave.request: the person's own request as a card, sent through Request Leave's own service and waiting on the line manager", async () => {
    const [mon, tue] = week(2);
    script(callRead("my_leave__balances", {}), say({ text: "Here is the request to send.", action: { key: "my_leave.request", values: { leave_type_id: annual, starts_on: mon, ends_on: tue, reason: "A family wedding" }, suggested: false } }));
    const asked = await h.ask("one", { question: "Request two days of annual leave from next Monday for a family wedding.", shows: ["cards", "pane"], context: { module: "ess", tab: "my-leave" } });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    expect(asked.body.card).toMatchObject({ action_key: "my_leave.request", label: "Request Leave", schema: "leave.LeaveRequestCreate", risk: "standard", confirm: "press", records: [], values: { leave_type_id: annual, starts_on: mon, ends_on: tue, reason: "A family wedding" }, problems: {} });
    expect(asked.body.card.fields.map((f) => [f.name, f.label])).toEqual([["leave_type_id", "Leave Type"], ["starts_on", "First Day"], ["ends_on", "Last Day"], ["reason", "Note"]]);
    const pressed = await h.press("one", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([{ type: "leave_request", id: expect.any(String), label: "Annual, 2 days", ok: true, message: "sent", link: expect.stringMatching(/^\/ess\?tab=my-leave&id=/) }]);
    const mine = await h.as("one").get(`/ess/leave/${pressed.body.lines[0].id}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ status: "submitted", days: 2, reason: "A family wedding", waiting_on: "Line Manager" });
    requests.wedding = mine.body;
  });

  test("leave.approve: four requests approved from the chat by the line manager, after Confirm It's You with a passkey (decision 11)", async () => {
    const days = week(3);
    const ids = [];
    for (const [i, who] of ["one", "two", "three", "four"].entries()) ids.push((await request(who, days[i])).leave_request_id);
    script(callRead("leave__requests", { status: "submitted" }), say({ text: "Here are the four to approve.", action: { key: "leave.approve", values: { leave_request_ids: ids }, suggested: false } }));
    const asked = await h.ask("manager", { question: "Approve the leave requests waiting on me.", shows: ["cards", "pane"], context: { module: "people", tab: "leave" } });
    expect(asked.status).toBe(200);
    const card = asked.body.card;
    expect(card).toMatchObject({ action_key: "leave.approve", label: "Approve Leave", schema: "leave.LeaveApprove", risk: "approval", confirm: "fresh_sign_in", bulk: 25, status: "shown", problems: {} });
    expect(card.records.map((r) => r.label)).toEqual(["Musa Danjuma, Annual, 1 day", "Zainab Lawal, Annual, 1 day", "Emeka Obi, Annual, 1 day", "Hauwa Bello, Annual, 1 day"]);
    expect(card.records.every((r) => /^\/people\?tab=leave&id=/.test(r.link))).toBe(true);
    expect(card.fields.find((f) => f.name === "reason")).toMatchObject({ label: "Reason", required: false, long: true });

    await h.stale("manager");
    const stale = await h.press("manager", card.ai_action_draft_id);
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe("REAUTH_REQUIRED");
    await h.confirmPasskey("manager");
    const pressed = await h.press("manager", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.status).toBe("done");
    expect(pressed.body.lines.map((l) => [l.ok, l.message])).toEqual([[true, "approved"], [true, "approved"], [true, "approved"], [true, "approved"]]);
    expect(pressed.body.lines.map((l) => l.label)).toEqual(card.records.map((r) => r.label));
    expect(await one("SELECT confirmed_how FROM ai_action_run WHERE ai_action_run_id = $1", [pressed.body.ai_action_run_id])).toEqual({ confirmed_how: "fresh_sign_in" });
    for (const id of ids) expect((await h.as("manager").get(`/leave/requests/${id}`)).body.status).toBe("approved");
    expect((await one("SELECT count(*)::int AS n FROM workflow_decision WHERE decision = 'approve' AND actor_id = $1", [h.people.manager.user_id])).n).toBe(4);
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'assistant.action_confirmed' AND entity_id = $1", [card.ai_action_draft_id])).n).toBe(1);
  });

  test("leave.reject: two requests rejected with a reason after Confirm It's You with the PIN; the reason is on each decision", async () => {
    const days = week(4);
    const ids = [(await request("one", days[0])).leave_request_id, (await request("two", days[1])).leave_request_id];
    script(say({ text: "Here are the two to reject.", action: { key: "leave.reject", values: { leave_request_ids: ids, reason: "The team is short that week" }, suggested: false } }));
    const asked = await h.ask("manager", { question: "Reject both: the team is short that week.", shows: ["cards"] });
    expect(asked.body.card).toMatchObject({ action_key: "leave.reject", label: "Reject Leave", risk: "approval", values: { leave_request_ids: ids, reason: "The team is short that week" } });
    expect(asked.body.card.fields.find((f) => f.name === "reason")).toMatchObject({ required: true });
    await h.stale("manager");
    expect((await h.press("manager", asked.body.card.ai_action_draft_id)).status).toBe(403);
    await h.confirmPin("manager");
    const pressed = await h.press("manager", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines.map((l) => [l.ok, l.message])).toEqual([[true, "rejected"], [true, "rejected"]]);
    for (const id of ids) expect((await h.as("manager").get(`/leave/requests/${id}`)).body.status).toBe("rejected");
    expect((await q("SELECT reason FROM workflow_decision WHERE decision = 'reject' AND actor_id = $1", [h.people.manager.user_id])).rows.map((r) => r.reason)).toEqual(["The team is short that week", "The team is short that week"]);
  });

  test("leave.reject without a reason is a problem on the field at the draft, and the press is refused until it is given", async () => {
    const [day] = week(5);
    const id = (await request("three", day)).leave_request_id;
    script(say({ text: "Here it is.", action: { key: "leave.reject", values: { leave_request_ids: [id] }, suggested: false } }));
    const asked = await h.ask("manager", { question: "Reject it.", shows: ["cards"] });
    expect(asked.body.card.problems).toEqual({ reason: [expect.any(String)] });
    await h.confirmPassword("manager");
    const refused = await h.press("manager", asked.body.card.ai_action_draft_id);
    expect(refused.status).toBe(422);
    expect(Object.keys(refused.body.error.fields)).toEqual(["reason"]);
    const edited = await h.as("manager").put(`/ai/cards/${asked.body.card.ai_action_draft_id}`).send({ values: { leave_request_ids: [id], reason: "Not that week" } });
    expect(edited.body.problems).toEqual({});
    const pressed = await h.press("manager", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect((await h.as("manager").get(`/leave/requests/${id}`)).body.status).toBe("rejected");
  });

  test("nobody approves their own request: a card naming one's own request is refused, and the request still waits", async () => {
    const [day] = week(6);
    const own = await request("manager", day);
    script(say({ text: "Approve mine.", action: { key: "leave.approve", values: { leave_request_ids: [own.leave_request_id] }, suggested: false } }));
    const asked = await h.ask("manager", { question: "Approve my own leave.", shows: ["cards"] });
    await h.confirmPassword("manager");
    const pressed = await h.press("manager", asked.body.card.ai_action_draft_id);
    expect([403, 404]).toContain(pressed.status);
    expect(["SELF_APPROVAL", "LEAVE_NOT_YOURS"]).toContain(pressed.body.error.code);
    expect((await h.as("manager").get(`/ess/leave/${own.leave_request_id}`)).body.status).toBe("submitted");
    expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [asked.body.card.ai_action_draft_id])).toEqual({ status: "shown" });
  });

  test("a request outside the person's scope on a bulk card refuses the whole press, and the one in scope is untouched (decision 16)", async () => {
    const days = week(7);
    const inside = await request("four", days[0]);
    const outside = await request("outsider", days[1]);
    script(say({ text: "Two to approve.", action: { key: "leave.approve", values: { leave_request_ids: [inside.leave_request_id, outside.leave_request_id] }, suggested: false } }));
    const asked = await h.ask("manager", { question: "Approve these two.", shows: ["cards"] });
    expect(asked.body.card.records).toEqual([
      expect.objectContaining({ id: inside.leave_request_id, label: "Hauwa Bello, Annual, 1 day" }),
      expect.objectContaining({ id: outside.leave_request_id, label: "leave request" }),
    ]);
    await h.confirmPassword("manager");
    const pressed = await h.press("manager", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(404);
    expect(pressed.body.error).toMatchObject({ code: "LEAVE_NOT_YOURS", fields: { leave_request_ids: ["Not in your scope"] } });
    expect((await h.as("manager").get(`/leave/requests/${inside.leave_request_id}`)).body.status).toBe("submitted");
    expect((await one("SELECT count(*)::int AS n FROM ai_action_run WHERE ai_action_draft_id = $1 AND status = 'done'", [asked.body.card.ai_action_draft_id])).n).toBe(0);
  });

  test("a member of staff is never offered leave.approve: the model is told so, and a card it names anyway is refused at the draft", async () => {
    const sent = script(say({ text: "Approve them.", action: { key: "leave.approve", values: { leave_request_ids: [requests.wedding.leave_request_id] }, suggested: false } }));
    const asked = await h.ask("one", { question: "Approve all the leave requests waiting.", shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(sent[0].messages[0].content).not.toMatch(/- leave\.approve:/);
    expect(asked.body.card).toBeNull();
  });
});
