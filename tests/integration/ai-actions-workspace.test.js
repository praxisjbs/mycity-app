"use strict";
/**
 * Praxis AI's Workspace cards on the real migrations (docs/guides/praxis-ai.md §6.11; the
 * handoff's PR4): Mark Done on several tasks at once through the board's own move (a cancelled
 * one its own line, the rest done), a comment on a task, an event with its attendees through
 * Create Event's own service, a task outside the person's board refused at the press, a
 * stranger among the attendees refused on the field, and a comment with a gap left to fill held
 * on its field before anyone presses. Every other form of My Workspace in the chat (decision 33):
 * Save Task, Add Step, Save Step (a step by its words), Add Link, Late Reasons for their keepers
 * alone (the capability), Create and Save Project, Save Event and Save Support Needed (a week by
 * its words), each through the screen's own service, an edit naming its record and refused where
 * the screen refuses it.
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
    // Shared with a department, its lead is given (decision 34 asks for it otherwise): Ada leads it.
    const values = { title: "Review milestone 3", priority: "normal", due_on: null, primary_assignee_id: h.people.ops.employee_id, member_ids: [staff], department_id: department, watcher_department_id: department };
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

  /** A task Ops sets for themselves through the board's own route. */
  const opsTask = async (title) => {
    const res = await h.as("ops").post("/tasks").send({ title });
    expect(res.status).toBe(201);
    return res.body;
  };
  /** The card the model drafts for a question, as the answer carries it. */
  const drawn = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    return asked.body.card;
  };

  test("tasks.edit: Save Task names the task and only what changes, runs Edit Task's own service, and is refused off the person's board", async () => {
    const t = await opsTask("Draft the budget");
    const staff = h.people.staff.employee_id;
    const card = await drawn("ops", "tasks.edit", { task_id: t.task_id, due_on: "2026-11-20", priority: "high", primary_assignee_id: staff }, "Give the budget draft to Tunde, high priority, due on the 20th.");
    expect(card).toMatchObject({ action_key: "tasks.edit", label: "Save Task", schema: "tasks.TaskChange", problems: {} });
    expect(card.records).toEqual([expect.objectContaining({ type: "task", id: t.task_id, label: `${t.number} Draft the budget` })]);
    expect(card.names).toEqual([expect.objectContaining({ type: "employee", id: staff, label: "Tunde Ade" })]);
    expect(card.fields.map((f) => f.name)).toEqual(["task_id", "title", "description", "due_on", "priority", "cadence", "primary_assignee_id", "member_ids", "department_id", "project_id"]);
    expect(card.fields[0]).toMatchObject({ name: "task_id", label: "Task", picks: null });
    expect(card.fields.find((f) => f.name === "primary_assignee_id")).toMatchObject({ label: "For", picks: "task_assignee" });
    // A commitment, a repeat and Counts Towards stay on the panel: never carried, whatever the model wrote.
    const carried = await drawn("ops", "tasks.edit", { task_id: t.task_id, priority: "low", is_commitment: true, recurrence: { freq: "daily" } });
    expect(carried.values).toEqual({ task_id: t.task_id, priority: "low" });
    const pressed = await h.press("ops", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([{ type: "task", id: t.task_id, label: `${t.number} Draft the budget`, ok: true, message: "saved", link: expect.stringMatching(/^\/workspace\?tab=tasks&id=/) }]);
    const after = await one("SELECT priority, primary_assignee_id, to_char(due_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS due FROM task WHERE task_id = $1", [t.task_id]);
    expect(after).toEqual({ priority: "high", primary_assignee_id: staff, due: "2026-11-20" });
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'task.edited' AND entity_id = $1", [t.task_id])).n).toBe(1);

    // Nothing to change: the problem sits on the task's own field, and the press runs nothing.
    const empty = await drawn("ops", "tasks.edit", { task_id: t.task_id });
    expect(empty.problems).toEqual({ task_id: ["Nothing to change"] });
    // Someone else's task is refused at the press by the board's own check.
    const theirs = await opsTask("Ops' own plan");
    const refusedCard = await drawn("staff", "tasks.edit", { task_id: theirs.task_id, title: "Mine now" });
    const refused = await h.press("staff", refusedCard.ai_action_draft_id);
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe("TASK_NOT_YOURS");
    expect(await one("SELECT title FROM task WHERE task_id = $1", [theirs.task_id])).toEqual({ title: "Ops' own plan" });
  });

  test("tasks.add_step and tasks.edit_step: a step added through the panel's own service, then ticked by its words; a step no task holds says so", async () => {
    const t = await opsTask("Plan the launch");
    // Asked for without its words, the step is asked for first.
    script(say({ text: "Here is the step.", action: { key: "tasks.add_step", values: { task_id: t.task_id }, suggested: false } }));
    const ask = await h.ask("ops", { question: "Add a step to the launch plan.", shows: ["cards"] });
    expect(ask.body).toMatchObject({ content: "What is the step?", card: null });

    const add = await drawn("ops", "tasks.add_step", { task_id: t.task_id, title: "Order the banners", due_on: "2026-11-18" });
    expect(add).toMatchObject({ action_key: "tasks.add_step", label: "Add Step", schema: "tasks.TaskStepAdd", problems: {} });
    expect(add.records).toEqual([expect.objectContaining({ type: "task", id: t.task_id, label: `${t.number} Plan the launch` })]);
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.status).toBe(200);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "task", id: t.task_id, label: "Order the banners", ok: true, message: "step added" })]);
    const step = await one("SELECT task_step_id, done_at FROM task_step WHERE task_id = $1 AND title = 'Order the banners'", [t.task_id]);
    expect(step.done_at).toBeNull();

    // Ticked by its words: matched among the task's own steps, named on the card, never shown as an id.
    const tick = await drawn("ops", "tasks.edit_step", { task_id: t.task_id, task_step_id: "banners", done: true }, "Tick the banners step.");
    expect(tick).toMatchObject({ action_key: "tasks.edit_step", label: "Save Step", schema: "tasks.TaskStepChange", problems: {} });
    expect(tick.values).toEqual({ task_id: t.task_id, task_step_id: step.task_step_id, done: true });
    expect(tick.names).toEqual([expect.objectContaining({ type: "task_step", id: step.task_step_id, label: "Order the banners" })]);
    const ticked = await h.press("ops", tick.ai_action_draft_id);
    expect(ticked.status).toBe(200);
    expect(ticked.body.lines).toEqual([expect.objectContaining({ label: "Order the banners", ok: true, message: "ticked" })]);
    expect((await one("SELECT done_at FROM task_step WHERE task_step_id = $1", [step.task_step_id])).done_at).not.toBeNull();

    // Words no step of the task has stay unmatched: the card says No such step on the field.
    const none = await drawn("ops", "tasks.edit_step", { task_id: t.task_id, task_step_id: "book the venue", done: true });
    expect(none.problems).toEqual({ task_step_id: ["No such step"] });
    expect(none.names).toEqual([]);
  });

  test("tasks.wait_on: Add Link names the task it waits on and runs Wait On Task's own service; never itself", async () => {
    const report = await opsTask("Write the launch report");
    const figures = await opsTask("Gather the launch figures");
    const card = await drawn("ops", "tasks.wait_on", { task_id: report.task_id, depends_on_task_id: figures.task_id }, "The report waits on the figures.");
    expect(card).toMatchObject({ action_key: "tasks.wait_on", label: "Add Link", schema: "tasks.TaskWaitOn", problems: {} });
    expect(card.records).toEqual([expect.objectContaining({ id: report.task_id, label: `${report.number} Write the launch report` })]);
    expect(card.names).toEqual([expect.objectContaining({ type: "task", id: figures.task_id, label: `${figures.number} Gather the launch figures` })]);
    expect(card.fields.find((f) => f.name === "depends_on_task_id")).toMatchObject({ label: "Waits On", picks: "task" });
    const pressed = await h.press("ops", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ id: report.task_id, ok: true, message: "waiting" })]);
    expect(await one("SELECT count(*)::int AS n FROM task_dependency WHERE task_id = $1 AND depends_on_task_id = $2", [report.task_id, figures.task_id])).toEqual({ n: 1 });

    const self = await drawn("ops", "tasks.wait_on", { task_id: report.task_id, depends_on_task_id: report.task_id });
    expect(self.problems).toEqual({ depends_on_task_id: ["Pick another task"] });
    // A task the person cannot see is never named: Tunde's errand may not wait on Ops' report, which is off his board.
    const errand = await h.as("staff").post("/tasks").send({ title: "Tunde's errand" });
    const unseen = await drawn("staff", "tasks.wait_on", { task_id: errand.body.task_id, depends_on_task_id: report.task_id });
    expect(unseen.problems).toEqual({ depends_on_task_id: ["Pick one"] });
    expect(unseen.names).toEqual([]);
  });

  test("late_reasons.add and late_reasons.switch: offered to a keeper of Late Reasons alone, as their routes are; a reason switched by its words", async () => {
    const authorise = require("../../src/shared/ai/authorise");
    const grantsCache = require("../../src/shared/rbac/grants-cache");
    const userOf = (who) => grantsCache.getAuthUser(pool, h.people[who].user_id);
    const offered = async (who) => (await authorise.allowedActions(await userOf(who))).map((a) => a.key);
    expect(await offered("ops")).toEqual(expect.arrayContaining(["late_reasons.add", "late_reasons.switch"]));
    expect(await offered("staff")).not.toEqual(expect.arrayContaining(["late_reasons.add"]));
    expect(await offered("staff")).not.toEqual(expect.arrayContaining(["late_reasons.switch"]));
    await expect(authorise.checkAction(await userOf("staff"), "late_reasons.add", { label: "Waiting on Supplier" })).rejects.toMatchObject({ code: "AI_ACTION_FORBIDDEN" });
    // The model naming it for someone without the capability draws no card.
    const notTheirs = await drawn("staff", "late_reasons.add", { label: "Waiting on Supplier" });
    expect(notTheirs).toBeNull();

    const add = await drawn("ops", "late_reasons.add", { label: "Waiting on Supplier" }, "Add a late reason: Waiting on Supplier.");
    expect(add).toMatchObject({ action_key: "late_reasons.add", label: "Add Reason", schema: "tasks.LateReasonCreate", records: [], problems: {} });
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.status).toBe(200);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "task_late_reason", label: "Waiting on Supplier", ok: true, message: "added" })]);
    const row = await one("SELECT task_late_reason_id, code, active FROM task_late_reason WHERE label = 'Waiting on Supplier'");
    expect(row).toMatchObject({ code: "waiting_on_supplier", active: true });

    const off = await drawn("ops", "late_reasons.switch", { task_late_reason_id: "waiting on supplier", active: false }, "Switch off Waiting on Supplier.");
    expect(off).toMatchObject({ action_key: "late_reasons.switch", label: "Switch Reason", schema: "tasks.LateReasonSwitch", problems: {} });
    expect(off.values).toEqual({ task_late_reason_id: row.task_late_reason_id, active: false });
    expect(off.records).toEqual([expect.objectContaining({ type: "task_late_reason", id: row.task_late_reason_id, label: "Waiting on Supplier" })]);
    const switched = await h.press("ops", off.ai_action_draft_id);
    expect(switched.status).toBe(200);
    expect(switched.body.lines).toEqual([expect.objectContaining({ label: "Waiting on Supplier", ok: true, message: "switched off" })]);
    expect(await one("SELECT active FROM task_late_reason WHERE task_late_reason_id = $1", [row.task_late_reason_id])).toEqual({ active: false });
  });

  test("projects.create and projects.edit: a project started and completed through the page's own service; another's project refused at the press", async () => {
    script(say({ text: "Here is the project.", action: { key: "projects.create", values: { due_on: "2026-12-18" }, suggested: false } }));
    const ask = await h.ask("staff", { question: "Start a project due on the 18th of December.", shows: ["cards"] });
    expect(ask.body).toMatchObject({ content: "What is the project called?", card: null });

    const start = await drawn("staff", "projects.create", { name: "Lekki Launch", due_on: "2026-12-18" }, "Start a project called Lekki Launch.");
    expect(start).toMatchObject({ action_key: "projects.create", label: "Create Project", schema: "projects.ProjectCreate", records: [], problems: {} });
    const started = await h.press("staff", start.ai_action_draft_id);
    expect(started.status).toBe(200);
    expect(started.body.lines).toEqual([expect.objectContaining({ type: "project", label: expect.stringMatching(/ Lekki Launch$/), ok: true, message: "started", link: expect.stringMatching(/^\/workspace\?tab=projects&id=/) })]);
    const project = await one("SELECT project_id, number::text AS number, status, owner_employee_id FROM project WHERE name = 'Lekki Launch'");
    expect(project).toMatchObject({ status: "active", owner_employee_id: h.people.staff.employee_id });

    const done = await drawn("staff", "projects.edit", { project_id: project.project_id, status: "completed" }, "Mark Lekki Launch completed.");
    expect(done).toMatchObject({ action_key: "projects.edit", label: "Save Project", schema: "projects.ProjectChange", problems: {} });
    expect(done.records).toEqual([expect.objectContaining({ type: "project", id: project.project_id, label: `${project.number} Lekki Launch` })]);
    const completed = await h.press("staff", done.ai_action_draft_id);
    expect(completed.status).toBe(200);
    expect(await one("SELECT status, completed_at IS NOT NULL AS stamped FROM project WHERE project_id = $1", [project.project_id])).toEqual({ status: "completed", stamped: true });
    expect((await one("SELECT count(*)::int AS n FROM event_log WHERE event_key = 'project.completed' AND entity_id = $1", [project.project_id])).n).toBe(1);

    // Ops' own project: on Tunde's list, never his to change.
    const theirs = await h.as("ops").post("/projects").send({ name: "Ops Review" });
    expect(theirs.status).toBe(201);
    const card = await drawn("staff", "projects.edit", { project_id: theirs.body.project_id, name: "Tunde's Review" });
    const refused = await h.press("staff", card.ai_action_draft_id);
    expect(refused.status).toBe(403);
    expect(refused.body.error.fields).toEqual({ project_id: ["Not yours to change"] });
    expect(await one("SELECT name FROM project WHERE project_id = $1", [theirs.body.project_id])).toEqual({ name: "Ops Review" });
  });

  test("calendar.edit: Save Event moves an event its maker made through Edit Event's own service, naming who comes; an attendee may not change it", async () => {
    const made = await h.as("ops").post("/calendar").send({ title: "Budget review", event_type: "meeting", starts_at: "2026-11-24T10:00:00+01:00", ends_at: "2026-11-24T11:00:00+01:00" });
    expect(made.status).toBe(201);
    const id = made.body.calendar_event_id;
    const staff = h.people.staff.employee_id;
    const card = await drawn("ops", "calendar.edit", { calendar_event_id: id, starts_at: "2026-11-24T11:00:00+01:00", ends_at: "2026-11-24T12:00:00+01:00", attendee_ids: [staff] }, "Move the budget review to 11 and invite Tunde.");
    expect(card).toMatchObject({ action_key: "calendar.edit", label: "Save Event", schema: "calendar.CalendarEventChange", problems: {} });
    expect(card.records).toEqual([expect.objectContaining({ type: "calendar_event", id, label: "Budget review" })]);
    expect(card.names).toEqual([expect.objectContaining({ type: "employee", id: staff, label: "Tunde Ade" })]);
    expect(card.fields.find((f) => f.name === "attendee_ids")).toMatchObject({ label: "Attendees", picks: "colleague" });
    const pressed = await h.press("ops", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "calendar_event", id, label: "Budget review", ok: true, message: "saved" })]);
    const event = await h.as("ops").get(`/calendar/${id}`);
    expect(event.body.starts_at).toBe("2026-11-24T10:00:00.000Z");
    expect(event.body.attendees.map((a) => a.employee.employee_id)).toEqual([staff]);

    // An end before its start is the form's own problem, on its field.
    const backwards = await drawn("ops", "calendar.edit", { calendar_event_id: id, starts_at: "2026-11-24T12:00:00+01:00", ends_at: "2026-11-24T11:00:00+01:00" });
    expect(backwards.problems).toEqual({ ends_at: ["Ends before it starts"] });
    // Tunde is invited and sees it; only its maker changes it.
    const theirs = await drawn("staff", "calendar.edit", { calendar_event_id: id, title: "Tunde's review" });
    const refused = await h.press("staff", theirs.ai_action_draft_id);
    expect(refused.status).toBe(403);
    expect(refused.body.error.fields).toEqual({ calendar_event_id: ["Not yours to change"] });
  });

  test("week.support: Save Support Needed writes the person's own line for the week they name, through Write Support Needed's own service", async () => {
    const monday = require("../../src/modules/workspace/workspace.week").thisMonday();
    const card = await drawn("staff", "week.support", { week_starts_on: "this week", support_needed: "Help from Finance with the budget figures", summary_text: "Not mine to write" }, "This week I need help from Finance with the budget figures.");
    expect(card).toMatchObject({ action_key: "week.support", label: "Save Support Needed", schema: "workspace.WeekSave", records: [], problems: {} });
    // The week by its words is its Monday; Tidy With AI's summary is never carried.
    expect(card.values).toEqual({ week_starts_on: monday, support_needed: "Help from Finance with the budget figures" });
    expect(card.fields.map((f) => f.name)).toEqual(["week_starts_on", "support_needed"]);
    const pressed = await h.press("staff", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([{ type: "week", id: monday, label: `Week of ${monday.split("-").reverse().join("/")}`, ok: true, message: "saved", link: "/workspace?tab=today" }]);
    expect(await one("SELECT support_needed, summary_text FROM weekly_summary WHERE employee_id = $1 AND week_starts_on = $2", [h.people.staff.employee_id, monday])).toEqual({ support_needed: "Help from Finance with the budget figures", summary_text: null });

    // Any day of a week names it.
    const midweek = await drawn("staff", "week.support", { week_starts_on: "2026-11-25", support_needed: "A second laptop" });
    expect(midweek.values.week_starts_on).toBe("2026-11-23");
    // Without the line, it is asked for first.
    script(say({ text: "Here is the line.", action: { key: "week.support", values: { week_starts_on: monday }, suggested: false } }));
    const ask = await h.ask("staff", { question: "Write my support needed for this week.", shows: ["cards"] });
    expect(ask.body).toMatchObject({ content: "What support do you need?", card: null });
  });

  test("a task for me, its lead written as the person's own name or as me, is theirs: no Pick one, and a name nothing matches never breaks the card's names", async () => {
    const own = h.people.staff.employee_id;
    for (const lead of ["Tunde Ade", "me"]) {
      script(say({ text: "Here is the task.", action: { key: "tasks.create", values: { title: "Send the weekly report", due_on: "2026-11-20", priority: "normal", primary_assignee_id: lead }, suggested: false } }));
      const card = (await h.ask("staff", { question: "Create a task for me to send the weekly report on the 20th, normal priority.", shows: ["cards"] })).body.card;
      expect([lead, card]).toEqual([lead, expect.objectContaining({ action_key: "tasks.create", problems: {}, values: expect.objectContaining({ primary_assignee_id: own }) })]);
      expect(card.names).toEqual(expect.arrayContaining([expect.objectContaining({ id: own, label: "Tunde Ade" })]));
    }
    // A name nothing matches stays as written, marked Pick one, and the card's names still read (no id lookup on words).
    script(say({ text: "Here is the task.", action: { key: "tasks.create", values: { title: "Send the weekly report", due_on: "2026-11-20", priority: "normal", primary_assignee_id: "Somebody Unknown" }, suggested: false } }));
    const unknown = (await h.ask("staff", { question: "Create a task for Somebody Unknown.", shows: ["cards"] })).body.card;
    expect(unknown.problems).toEqual({ primary_assignee_id: ["Pick one"] });
  });

  test("a task shared with a department asks who leads it first, with that department's people to tap; the lead written by name is matched, so the card is never drawn with Pick a lead (decision 34)", async () => {
    const department = (await one("SELECT department_id FROM employee WHERE employee_id = $1", [h.people.ops.employee_id])).department_id;
    const values = { title: "Research transaction fees", due_on: "2026-11-20", priority: "urgent", department_id: department };
    script(say({ text: "Here is the task.", action: { key: "tasks.create", values, suggested: false } }));
    const lead = await h.ask("ops", { question: "Create an urgent task for HR & Operations to research transaction fees by the 20th.", shows: ["cards"] });
    expect(lead.body).toMatchObject({ content: "Who leads it?", card: null });
    expect(lead.body.choices).toEqual(expect.arrayContaining(["Tunde Ade", "Ada Obi"]));
    // The person taps Tunde Ade; the model writes the lead by name, and the server matches it among the department's people.
    script(say({ text: "Here is the task.", action: { key: "tasks.create", values: { ...values, primary_assignee_id: "Tunde Ade" }, suggested: false } }));
    const whole = await h.ask("ops", { question: "Tunde Ade", ai_conversation_id: lead.body.ai_conversation_id, shows: ["cards"] });
    expect(whole.body.card).toMatchObject({ action_key: "tasks.create", problems: {}, values: expect.objectContaining({ primary_assignee_id: h.people.staff.employee_id }) });
    expect(whole.body.card.names).toEqual(expect.arrayContaining([expect.objectContaining({ id: h.people.staff.employee_id, label: "Tunde Ade" })]));
    const pressed = await h.press("ops", whole.body.card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(await one("SELECT primary_assignee_id FROM task WHERE task_id = $1", [pressed.body.lines[0].id])).toEqual({ primary_assignee_id: h.people.staff.employee_id });
    // Not shared with a department: no lead is asked, and the task is the person's own.
    script(say({ text: "Here is the task.", action: { key: "tasks.create", values: { title: "File the receipts", due_on: null, priority: "low" }, suggested: false } }));
    expect((await h.ask("ops", { question: "A low priority task to file the receipts, no due day.", shows: ["cards"] })).body.card).toMatchObject({ action_key: "tasks.create", problems: {} });
  });

  test("a card naming no record asks which, with the person's own records to tap; the one tapped is matched by its words (decision 34)", async () => {
    const t = await opsTask("Order the conference badges");
    script(say({ text: "Here is the comment.", action: { key: "tasks.comment", values: { body: "The printer confirmed Friday." }, suggested: false } }));
    const which = await h.ask("ops", { question: "Comment that the printer confirmed Friday.", shows: ["cards"] });
    expect(which.body).toMatchObject({ content: "Which task is it on?", card: null });
    expect(which.body.choices.length).toBeGreaterThan(0);
    expect(which.body.choices.length).toBeLessThanOrEqual(6);
    expect(which.body.choices.every((label) => /^\S+ /.test(label))).toBe(true);
    // The person names the task by its words; the model writes them as they were said.
    script(say({ text: "Here is the comment.", action: { key: "tasks.comment", values: { task_id: "conference badges", body: "The printer confirmed Friday." }, suggested: false } }));
    const named = await h.ask("ops", { question: "The conference badges one.", ai_conversation_id: which.body.ai_conversation_id, shows: ["cards"] });
    expect(named.body.card).toMatchObject({ action_key: "tasks.comment", problems: {}, values: { task_id: t.task_id, body: "The printer confirmed Friday." } });
    expect(named.body.card.records).toEqual([expect.objectContaining({ id: t.task_id, label: `${t.number} Order the conference badges` })]);
    // A tapped answer reads as the record's citation, number and title, and is matched the same way.
    script(say({ text: "Here is the step.", action: { key: "tasks.add_step", values: { task_id: `${t.number} Order the conference badges`, title: "Confirm the count" }, suggested: false } }));
    const step = await h.ask("ops", { question: "Add a step to it: confirm the count.", shows: ["cards"] });
    expect(step.body.card).toMatchObject({ action_key: "tasks.add_step", problems: {}, values: expect.objectContaining({ task_id: t.task_id }) });
    // An event the person made, by its title.
    const made = await h.as("ops").post("/calendar").send({ title: "Badge pickup", event_type: "meeting", starts_at: "2026-11-27T10:00:00+01:00", ends_at: "2026-11-27T10:30:00+01:00" });
    script(say({ text: "Here it is.", action: { key: "calendar.edit", values: { location: "Front desk" }, suggested: false } }));
    const event = await h.ask("ops", { question: "Move the badge pickup to the front desk.", shows: ["cards"] });
    expect(event.body).toMatchObject({ content: "Which event is it?", card: null });
    expect(event.body.choices).toContain("Badge pickup");
    script(say({ text: "Here it is.", action: { key: "calendar.edit", values: { calendar_event_id: "Badge pickup", location: "Front desk" }, suggested: false } }));
    const moved = await h.ask("ops", { question: "Badge pickup", ai_conversation_id: event.body.ai_conversation_id, shows: ["cards"] });
    expect(moved.body.card).toMatchObject({ action_key: "calendar.edit", problems: {}, values: { calendar_event_id: made.body.calendar_event_id, location: "Front desk" } });
  });
});
