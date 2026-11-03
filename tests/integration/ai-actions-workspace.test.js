"use strict";
/**
 * Praxis AI's Workspace cards on the real migrations (docs/guides/praxis-ai.md §6.11; the
 * handoff's PR4): Mark Done on several tasks at once through the board's own move (a cancelled
 * one its own line, the rest done), a comment on a task, an event with its attendees through
 * Create Event's own service, a task outside the person's board refused at the press, a
 * stranger among the attendees refused on the field, and a comment with a gap left to fill held
 * on its field before anyone presses.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-workspace
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
const { q, one, fresh, script, callRead, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

describeDb("Praxis AI's Workspace cards against the real migrations", () => {
  let app;
  let h;
  const tasks = {};

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026" },
      { who: "staff", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026" },
    ]);
    for (const [key, title] of [["one", "Send the weekly report"], ["two", "Call the venue"], ["gone", "A task that was cancelled"]]) {
      const res = await h.as("ops").post("/tasks").send({ title });
      expect(res.status).toBe(201);
      tasks[key] = res.body;
    }
    const cancelled = await h.as("ops").post(`/tasks/${tasks.gone.task_id}/cancel`).send({ cancel_reason: "No longer needed" });
    expect(cancelled.status).toBe(200);
    const mine = await h.as("staff").post("/tasks").send({ title: "A field visit" });
    expect(mine.status).toBe(201);
    tasks.staff = mine.body;
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

  test("tasks.create is gathered one question at a time with answers to tap, then drawn naming everyone, and pressed (decisions 28, 29, 31)", async () => {
    const staff = h.people.staff.employee_id;
    const shows = ["cards", "pane"];
    // The model drafts too early, with only whom it is for: the server asks for the title first, with no card.
    let sent = script(callRead("colleagues__list", { q: "Tunde" }), say({ text: "Here is the task for Tunde.", action: { key: "tasks.create", values: { primary_assignee_id: staff }, suggested: false } }));
    const first = await h.ask("ops", { question: "Assign a task to Tunde.", shows });
    expect(first.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(first.body).success).toBe(true);
    expect(first.body).toMatchObject({ content: "What is the task?", card: null, choices: [], link: null, table: null });
    expect(sent[0].messages[0].content).toMatch(/- tasks\.create: [^\n]*ask first, one at a time[^\n]*title \("What is the task\?"\)/);
    // colleagues.list finds anyone with a login by name, for anyone (praxis-ai.md §6.9).
    expect(first.body.reads[0]).toMatchObject({ key: "colleagues.list", outcome: "read" });
    expect(await one("SELECT metadata->'ask' AS ask FROM ai_message WHERE ai_message_id = $1", [first.body.ai_message_id])).toEqual({ ask: { action: "tasks.create", field: "title", choices: [] } });
    const conv = first.body.ai_conversation_id;

    // The title given, the due day is asked, with today's answers to tap; the model is told what was asked.
    sent = script(say({ text: "Here is the task.", action: { key: "tasks.create", values: { primary_assignee_id: staff, title: "Send the weekly report" }, suggested: false } }));
    const second = await h.ask("ops", { question: "Send the weekly report.", ai_conversation_id: conv, shows });
    expect(second.body).toMatchObject({ content: "When is it due?", card: null });
    expect(second.body.choices).toEqual(["Today", "Tomorrow", expect.stringMatching(/^(Next )?Friday$/), "No Due Day"]);
    expect(sent[0].messages.map((m) => m.content).join("\n")).toMatch(/\[Asked for: tasks\.create title\]/);

    // No due day is an answer (null); the priority is asked next.
    script(say({ text: "Here is the task.", action: { key: "tasks.create", values: { primary_assignee_id: staff, title: "Send the weekly report", due_on: null }, suggested: false } }));
    const third = await h.ask("ops", { question: "No Due Day", ai_conversation_id: conv, shows });
    expect(third.body).toMatchObject({ content: "How urgent is it?", card: null, choices: ["Low", "Normal", "High", "Urgent"] });

    // Everything given: the card is drawn, naming whom it is for, and counting nothing on its verb.
    script(say({ text: "Here is the task to create for Tunde.", action: { key: "tasks.create", values: { primary_assignee_id: staff, title: "Send the weekly report", due_on: null, priority: "normal" }, suggested: false } }));
    const fourth = await h.ask("ops", { question: "Normal", ai_conversation_id: conv, shows });
    expect(fourth.body.choices).toEqual([]);
    expect(fourth.body.card).toMatchObject({ action_key: "tasks.create", records: [], problems: {} });
    expect(fourth.body.card.names).toEqual([{ type: "employee", id: staff, label: "Tunde Ade", link: expect.any(String) }]);
    expect(fourth.body.card.fields.find((f) => f.name === "primary_assignee_id")).toMatchObject({ label: "For", picks: "task_assignee" });
    const pressed = await h.press("ops", fourth.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(await one("SELECT title, priority, due_at, primary_assignee_id FROM task WHERE task_id = $1", [pressed.body.lines[0].id])).toEqual({ title: "Send the weekly report", priority: "normal", due_at: null, primary_assignee_id: staff });

    // The model's own question passes through with its answers to tap; a suggested card is never held back.
    script(say({ text: "Which Tunde?", ask: { action: "tasks.create", field: "primary_assignee_id", choices: ["Tunde Ade, Field Officer", "Tunde Bello, Driver"] } }));
    const which = await h.ask("ops", { question: "Give Tunde a task.", shows });
    expect(which.body).toMatchObject({ content: "Which Tunde?", card: null, choices: ["Tunde Ade, Field Officer", "Tunde Bello, Driver"] });
    script(say({ text: "Shall I set a follow-up task?", action: { key: "tasks.create", values: { title: "Follow up on the report" }, suggested: true } }));
    const suggested = await h.ask("ops", { question: "What is on my board?", shows });
    expect(suggested.body.card).toMatchObject({ action_key: "tasks.create", suggested: true });
  });

  test("a task card names the people and departments it holds; sharing with both is a problem Edit clears; its watchers may open the task (decisions 30 and 31)", async () => {
    const staff = h.people.staff.employee_id;
    const department = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.ops.employee_id])).department_id;
    const values = { title: "Review milestone 3", priority: "normal", due_on: null, member_ids: [staff], department_id: department, watcher_department_id: department };
    script(say({ text: "Here is the task.", action: { key: "tasks.create", values, suggested: false } }));
    const asked = await h.ask("ops", { question: "Create a task to review milestone 3 with Tunde and the department watching.", shows: ["cards"] });
    const card = asked.body.card;
    expect(card.problems).toEqual({ department_id: ["People or a department"] });
    expect(card.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "employee", id: staff, label: "Tunde Ade" }), expect.objectContaining({ type: "department", id: department, label: "HR & Operations" })]));
    expect(card.records).toEqual([]);
    // Edit leaves the department out: the problem goes, the names follow.
    const { department_id: _dropped, ...people } = values;
    const edited = await h.as("ops").put(`/ai/cards/${card.ai_action_draft_id}`).send({ values: people });
    expect(edited.status).toBe(200);
    expect(edited.body.problems).toEqual({});

    // Ops sets a task for themselves, watched by Tunde, who could not see it before; watching gives him sight of it.
    script(say({ text: "Here is the task.", action: { key: "tasks.create", values: { title: "Pick the caterer", priority: "high", due_on: null, watcher_ids: [staff] }, suggested: false } }));
    const watched = await h.ask("ops", { question: "Create a task for me to pick the caterer, high priority, no due day; Tunde watches it.", shows: ["cards"] });
    expect(watched.body.card.names).toEqual([expect.objectContaining({ id: staff, label: "Tunde Ade" })]);
    const made = await h.press("ops", watched.body.card.ai_action_draft_id);
    expect(made.status).toBe(200);
    const panel = await h.as("staff").get(`/tasks/${made.body.lines[0].id}`);
    expect(panel.status).toBe(200);
    expect(panel.body).toMatchObject({ watching: true, can_edit: false });
  });

  test("tasks.complete: several tasks done in one press through the board's own move; a cancelled one is its own line", async () => {
    const ids = [tasks.one.task_id, tasks.two.task_id, tasks.gone.task_id];
    script(callRead("tasks__list", {}), say({ text: "Here are the three to mark done.", action: { key: "tasks.complete", values: { task_ids: ids }, suggested: false } }));
    const asked = await h.ask("ops", { question: "Mark my three tasks as done.", shows: ["cards", "pane"], context: { module: "workspace", tab: "tasks" } });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    const card = asked.body.card;
    expect(card).toMatchObject({ action_key: "tasks.complete", label: "Mark Done", schema: "tasks.TaskComplete", risk: "standard", confirm: "press", bulk: 25, status: "shown", problems: {} });
    // The records are named through the module's own repo, as the person sees them on the board.
    expect(card.records.map((r) => r.label)).toEqual([`${tasks.one.number} Send the weekly report`, `${tasks.two.number} Call the venue`, `${tasks.gone.number} A task that was cancelled`]);
    expect(card.records.every((r) => r.type === "task" && /^\/workspace\?tab=tasks&id=/.test(r.link))).toBe(true);
    expect(card.fields.find((f) => f.name === "task_ids")).toMatchObject({ label: "Tasks", kind: "list" });
    expect(card.fields.find((f) => f.name === "late_reason")).toMatchObject({ label: "Late Reason", required: false });

    const pressed = await h.press("ops", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.status).toBe("done");
    expect(pressed.body.lines).toEqual([
      { type: "task", id: tasks.one.task_id, label: `${tasks.one.number} Send the weekly report`, ok: true, message: "done", link: expect.stringMatching(/^\/workspace\?tab=tasks&id=/) },
      { type: "task", id: tasks.two.task_id, label: `${tasks.two.number} Call the venue`, ok: true, message: "done", link: expect.stringMatching(/^\/workspace\?tab=tasks&id=/) },
      { type: "task", id: tasks.gone.task_id, label: tasks.gone.task_id, ok: false, message: "This task was cancelled", link: expect.stringMatching(/^\/workspace\?tab=tasks&id=/) },
    ]);
    expect((await q("SELECT status FROM task WHERE task_id = ANY($1::uuid[]) ORDER BY status", [[tasks.one.task_id, tasks.two.task_id, tasks.gone.task_id]])).rows.map((r) => r.status)).toEqual(["cancelled", "done", "done"]);
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'task.completed' AND entity_id = ANY($1::text[])", [[tasks.one.task_id, tasks.two.task_id]])).n).toBe(2);
    expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [card.ai_action_draft_id])).toEqual({ status: "done" });
  });

  test("tasks.complete: a task outside the person's board is refused at the press, and nothing on the card runs", async () => {
    const theirs = await h.as("staff").post("/tasks").send({ title: "Still to do" });
    expect(theirs.status).toBe(201);
    script(say({ text: "Two to mark done.", action: { key: "tasks.complete", values: { task_ids: [theirs.body.task_id, tasks.one.task_id] }, suggested: false } }));
    const asked = await h.ask("staff", { question: "Mark both done.", shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(asked.body.card.records).toEqual([
      expect.objectContaining({ id: theirs.body.task_id, label: `${theirs.body.number} Still to do` }),
      expect.objectContaining({ id: tasks.one.task_id, label: "task" }),
    ]);
    const pressed = await h.press("staff", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(404);
    expect(pressed.body.error).toMatchObject({ code: "TASK_NOT_YOURS", fields: { task_ids: ["Not on your board"] } });
    expect(await one("SELECT status FROM task WHERE task_id = $1", [theirs.body.task_id])).toEqual({ status: "todo" });
    expect(await one("SELECT status FROM ai_action_draft WHERE ai_action_draft_id = $1", [asked.body.card.ai_action_draft_id])).toEqual({ status: "shown" });
  });

  test("tasks.comment: the task filled from the screen the question came from, the comment written by the task's own service; a gap left to fill is held on the field", async () => {
    script(say({ text: "Here is the comment.", action: { key: "tasks.comment", values: { body: "The draft is with Ada for review." }, suggested: false } }));
    const asked = await h.ask("ops", { question: "Comment that the draft is with Ada.", shows: ["cards"], context: { module: "workspace", tab: "tasks", id: tasks.two.task_id } });
    expect(asked.status).toBe(200);
    expect(asked.body.card).toMatchObject({ action_key: "tasks.comment", label: "Add Comment", values: { task_id: tasks.two.task_id, body: "The draft is with Ada for review." }, problems: {} });
    expect(asked.body.card.records).toEqual([expect.objectContaining({ type: "task", id: tasks.two.task_id, label: `${tasks.two.number} Call the venue` })]);
    expect(asked.body.card.fields.find((f) => f.name === "body")).toMatchObject({ label: "Comment", kind: "text", long: true });
    const pressed = await h.press("ops", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([{ type: "task", id: tasks.two.task_id, label: "Comment added", ok: true, message: "commented", link: expect.stringMatching(/^\/workspace\?tab=tasks&id=/) }]);
    const comments = await h.as("ops").get(`/tasks/${tasks.two.task_id}/comments`);
    expect(comments.body.data.map((x) => x.body)).toEqual(["The draft is with Ada for review."]);

    script(say({ text: "Here is the comment.", action: { key: "tasks.comment", values: { task_id: tasks.two.task_id, body: "Sent to [name] today." }, suggested: false } }));
    const gap = await h.ask("ops", { question: "Comment that it was sent.", shows: ["cards"] });
    expect(gap.body.card.problems).toEqual({ body: ["Fill the gap"] });
    const refused = await h.press("ops", gap.body.card.ai_action_draft_id);
    expect(refused.status).toBe(422);
    expect(refused.body.error.fields).toEqual({ body: ["Fill the gap"] });
  });

  test("calendar.create: an event with its attendees named, booked through Create Event's own service; a stranger among the attendees is refused on the field", async () => {
    const values = { title: "Venue visit", event_type: "meeting", starts_at: "2026-11-19T10:00:00+01:00", ends_at: "2026-11-19T11:00:00+01:00", attendee_ids: [h.people.staff.employee_id], location: "Yaba office" };
    script(say({ text: "Here is the meeting to book.", action: { key: "calendar.create", values, suggested: false } }));
    const asked = await h.ask("ops", { question: "Book a venue visit with Tunde on Thursday at 10.", shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(asked.body.card).toMatchObject({ action_key: "calendar.create", label: "Create Event", schema: "calendar.CalendarEventCreate", values: expect.objectContaining({ title: "Venue visit", all_day: false, visibility: "attendees" }), problems: {} });
    // One event is made: the people invited are named on the card, never counted as records (decision 31).
    expect(asked.body.card.records).toEqual([]);
    expect(asked.body.card.names).toEqual([expect.objectContaining({ type: "employee", id: h.people.staff.employee_id, label: "Tunde Ade" })]);
    expect(asked.body.card.fields.find((f) => f.name === "starts_at")).toMatchObject({ label: "Starts", kind: "datetime" });
    expect(asked.body.card.fields.find((f) => f.name === "attendee_ids")).toMatchObject({ label: "Attendees", picks: "colleague" });
    const pressed = await h.press("ops", asked.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([{ type: "calendar_event", id: expect.any(String), label: "Venue visit", ok: true, message: "booked", link: expect.stringMatching(/^\/workspace\?tab=calendar&id=/) }]);
    const event = await h.as("ops").get(`/calendar/${pressed.body.lines[0].id}`);
    expect(event.status).toBe(200);
    expect(event.body.attendees.map((a) => a.employee.employee_id)).toEqual([h.people.staff.employee_id]);

    script(say({ text: "Here is the meeting.", action: { key: "calendar.create", values: { ...values, attendee_ids: ["00000000-0000-4000-8000-00000000009f"] }, suggested: false } }));
    const stranger = await h.ask("ops", { question: "Book it with someone else.", shows: ["cards"] });
    // Nobody by that id: nothing names it, so the card marks it Pick one at the draft, never shows it,
    // and the press is refused before Create Event's service runs (decision 32).
    expect(stranger.body.card.names).toEqual([]);
    expect(stranger.body.card.problems).toEqual({ attendee_ids: ["Pick one"] });
    const refused = await h.press("ops", stranger.body.card.ai_action_draft_id);
    expect(refused.status).toBe(422);
    expect(refused.body.error.fields).toEqual({ attendee_ids: ["Pick one"] });
    expect(await one("SELECT status, problems FROM ai_action_draft WHERE ai_action_draft_id = $1", [stranger.body.card.ai_action_draft_id])).toEqual({ status: "shown", problems: { attendee_ids: ["Pick one"] } });
  });
});
