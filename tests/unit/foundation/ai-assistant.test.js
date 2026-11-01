"use strict";
/**
 * Praxis AI's engine without a network or a database (docs/guides/praxis-ai.md §6.1 to §6.4):
 * a scripted model calls reads, every read runs with the asking person's rights, at most five,
 * a repeat or the limit forces an answer, a broken answer is sent back once and then answered in
 * plain words, and what the screen shows is drawn from the rows, the offered routes and the
 * records read, never from the model's own figures.
 */
const orchestrator = require("../../../src/services/ai/assistant/orchestrator");
const answer = require("../../../src/services/ai/assistant/answer");
const authorise = require("../../../src/shared/ai/authorise");
const registry = require("../../../src/shared/ai/registry");
const search = require("../../../src/shared/search/search.service");
const jobs = require("../../../src/services/ai/jobs");
const skips = require("../../../src/services/ai/skips");
const prices = require("../../../src/services/ai/prices");
const governance = require("../../../src/services/ai/governance");
const ledger = require("../../../src/services/ai/ledger");
const integrations = require("../../../src/shared/integrations/settings");
const usage = require("../../../src/shared/integrations/usage");
const { AppError } = require("../../../src/shared/errors");
const fieldMask = require("../../../src/shared/rbac/field-mask");
const c = require("@mycity/contract");

const ACTOR = { user_id: "u1", employee_id: "e1", display_name: "Ada Obi", role_ids: ["r1"], is_ceo: false };
const db = {
  query: async (sql) => {
    if (/FROM employee e/.test(sql)) return { rows: [{ first_name: "Ada", last_name: "Obi", job_title: "Operations Lead", department: "HR & Operations" }] };
    if (/FROM role/.test(sql)) return { rows: [{ name: "Operations & People" }] };
    return { rows: [] };
  },
};
const READER = { grants: { praxis_ai: ["view"], ess: ["view"], workspace: ["view", "create"] }, capabilities: [], is_ceo: false, manages_people: false };

/** Two reads the person may run. */
const READS = [
  { key: "leave.requests", description: "Leave requests waiting on someone", params: c.common.PageQuery, permission: ["ess", "view"], module: "ess", list: true },
  { key: "tasks.list", description: "Tasks, filtered by who they are for", params: c.common.PageQuery, permission: ["workspace", "view"], module: "workspace", list: true },
];
const ROUTES = [{ intent: "book a meeting", screen: "workspace.calendar", module: "workspace", tab: "calendar", params: { new: "1" }, prefill: c.calendar.CalendarEventPrefill, owner: "calendar" }];

const call = (name, args = {}, id = `c-${Math.random().toString(36).slice(2, 7)}`) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const reply = (text, toolCalls = [], finish = toolCalls.length ? "tool_calls" : "stop") => ({ text, toolCalls, usage: { input_tokens: 5, output_tokens: 5 }, finish_reason: finish });
const DRAFT = (over = {}) => JSON.stringify({ text: "Two requests wait on you.", table: null, route: null, prefill: null, more: false, ...over });

/** A page as authorise.runRead returns it. */
const page = (rows, { total = rows.length, has_next = false } = {}) => ({
  list: true,
  page: { number: 1, size: 25, total, pages: 1, has_next },
  data: rows,
  citations: rows.map((r) => ({ type: "leave_request", id: r.id, label: r.employee, link: `/people?tab=leave&id=${r.id}`, read: "leave.requests" })),
});

let steps;
let finished;
/** The scripted model: each call answers the next reply in `script`. */
function model(script) {
  const fn = jest.fn(async () => {
    const next = script.shift();
    if (!next) throw new Error("the script ran out");
    if (next instanceof Error) throw next;
    return next;
  });
  return { gemini: { complete: fn }, stub: { complete: jest.fn(async () => reply(DRAFT({ text: "[AI placeholder]" }))) } };
}
const ask = (vendors, over = {}) => orchestrator.answer({ db, actor: ACTOR, question: "Whose leave waits on me?", vendors, now: new Date("2026-10-22T09:30:00Z"), ...over });

beforeEach(async () => {
  steps = [];
  finished = [];
  usage.__reset();
  await skips.clear("gemini");
  jest.spyOn(governance, "check").mockResolvedValue({ settings: {} });
  jest.spyOn(ledger, "startRun").mockResolvedValue("run-1");
  jest.spyOn(ledger, "recordStep").mockImplementation(async (_db, _id, s) => {
    steps.push([s.kind, s.outcome]);
    return "0.00";
  });
  jest.spyOn(ledger, "finishRun").mockImplementation(async (_db, _id, f) => finished.push(f));
  jest.spyOn(ledger, "refused").mockResolvedValue("run-refused");
  jest.spyOn(jobs, "resolve").mockResolvedValue({
    scope: "action",
    key: "data-answers",
    stored: false,
    links: [{ provider: "gemini", model: "gemini-3.8-flash", display_name: "Flash", position: 1, state: "ready", until: null }],
  });
  jest.spyOn(prices, "forStep").mockResolvedValue(prices.zero());
  jest.spyOn(integrations, "secret").mockResolvedValue("key");
  jest.spyOn(search, "readerOf").mockResolvedValue(READER);
  jest.spyOn(authorise, "allowedReads").mockResolvedValue(READS);
  // The real manifests declare summaries since PR3; this suite has no database for their grants.
  jest.spyOn(authorise, "allowedSummaries").mockResolvedValue([]);
  jest.spyOn(registry, "read").mockImplementation((k) => READS.find((r) => r.key === k) || null);
  jest.spyOn(registry, "routes").mockReturnValue(ROUTES);
});
afterEach(() => jest.restoreAllMocks());

describe("one question", () => {
  test("a read's rows reach the model redacted (§6.3.5): a field the person sees stays, payment and identity numbers never do", async () => {
    const row = { id: "l1", employee: "Ayo Bello", salary: "250000.00", personal_phone: "08031234567", bvn: "12345678901", nin: "98765432109" };
    jest.spyOn(authorise, "runRead").mockResolvedValue(page([row]));
    const sentRows = async (hidden) => {
      jest.spyOn(fieldMask, "maskedKeysFor").mockResolvedValue(hidden);
      const vendors = model([reply("", [call("leave__requests", {}, "c1")]), reply(DRAFT())]);
      const out = await ask(vendors);
      const tool = vendors.gemini.complete.mock.calls[1][0].messages.find((m) => m.role === "tool");
      return { rows: JSON.parse(tool.content).rows, out };
    };
    const seen = await sentRows([]);
    expect(seen.rows).toEqual([{ id: "l1", employee: "Ayo Bello", salary: "250000.00", personal_phone: "08031234567", bvn: null, nin: null }]);
    // The table and citations are drawn from the rows as read, not as the model was sent them.
    expect(seen.out.reads[0].rows[0].bvn).toBe("12345678901");
    const hidden = await sentRows(["employee.salary"]);
    expect(hidden.rows[0]).toMatchObject({ salary: null, personal_phone: "08031234567", bvn: null });
  });

  test("only the person's reads are offered; a call runs with their rights and its page goes back as data", async () => {
    jest.spyOn(authorise, "runRead").mockResolvedValue(page([{ id: "l1", employee: "Ayo Bello", starts_on: "2026-10-27" }]));
    const vendors = model([reply("", [call("leave__requests", { page: 1 }, "c1")]), reply(DRAFT())]);
    const out = await ask(vendors);
    const first = vendors.gemini.complete.mock.calls[0][0];
    expect(first.tools.map((t) => t.function.name)).toEqual(["leave__requests", "tasks__list"]);
    expect(first.messages[0].content).toContain("Asking: Ada Obi, Operations Lead, in HR & Operations, (Operations & People).");
    expect(first.messages[0].content).toContain("Today: Thursday 22/10/2026 (2026-10-22), 10:30 in Lagos.");
    // Each prefill field with the form its value takes, so a day is not written day first and dropped.
    expect(first.messages[0].content).toContain(
      '- "book a meeting": Calendar; prefill fields: title, event_type (one of meeting, deadline, campaign, event), starts_at (YYYY-MM-DDTHH:MM:SS+01:00), ends_at (YYYY-MM-DDTHH:MM:SS+01:00), location',
    );
    expect(authorise.runRead).toHaveBeenCalledWith(db, ACTOR, "leave.requests", { page: 1 });
    const second = vendors.gemini.complete.mock.calls[1][0].messages;
    expect(second.find((m) => m.role === "tool")).toMatchObject({ tool_call_id: "c1" });
    expect(JSON.parse(second.find((m) => m.role === "tool").content)).toMatchObject({ read: 1, key: "leave.requests", total: 1, rows: [{ employee: "Ayo Bello" }] });
    expect(out.draft.text).toBe("Two requests wait on you.");
    expect(out.reads).toEqual([expect.objectContaining({ n: 1, key: "leave.requests", ok: true, module: "ess", total: 1 })]);
    expect(finished).toEqual([expect.objectContaining({ status: "ok" })]);
  });

  test("five reads at most: the sixth is refused, and the next round answers with no tools", async () => {
    jest.spyOn(authorise, "runRead").mockImplementation(async () => page([{ id: "x", employee: "X" }]));
    const six = [1, 2, 3, 4, 5, 6].map((p) => call("tasks__list", { page: p }, `c${p}`));
    const vendors = model([reply("", six), reply(DRAFT())]);
    const out = await ask(vendors);
    expect(authorise.runRead).toHaveBeenCalledTimes(5);
    const msgs = vendors.gemini.complete.mock.calls[1][0];
    expect(JSON.parse(msgs.messages.filter((m) => m.role === "tool")[5].content).error).toBe("read_limit");
    expect(msgs.tools).toBeNull();
    expect(msgs.json).toBe(true);
    expect(out.reads).toHaveLength(5);
  });

  test("a prefill's list (New Event's attendees) travels as one comma-separated value; anything else of the kind is dropped", () => {
    const contract = require("@mycity/contract");
    const route = { prefill: contract.calendar.CalendarEventPrefill, params: { new: "1" } };
    const A = "00000000-0000-4000-8000-00000000000a";
    const B = "00000000-0000-4000-8000-00000000000b";
    expect(answer.prefillOf(route, { title: "Stand walk", attendee_ids: [A, B] })).toEqual({ title: "Stand walk", attendee_ids: `${A},${B}` });
    expect(answer.prefillOf(route, { attendee_ids: ["not an id"] })).toEqual({});
    expect(answer.prefillOf(route, { attendee_ids: [{ id: A }] })).toEqual({});
  });

  test("the same read twice is not run again; the model must answer next", async () => {
    jest.spyOn(authorise, "runRead").mockResolvedValue(page([]));
    const vendors = model([reply("", [call("leave__requests", { page: 1 })]), reply("", [call("leave__requests", { page: 1 })]), reply(DRAFT())]);
    await ask(vendors);
    expect(authorise.runRead).toHaveBeenCalledTimes(1);
    expect(vendors.gemini.complete.mock.calls[2][0].tools).toBeNull();
  });

  test("a refused read is 'not_available' to the model, and the answer says it was declined", async () => {
    jest.spyOn(authorise, "runRead").mockRejectedValue(new AppError("AI_READ_FORBIDDEN", "That information is not available to you.", 403));
    const vendors = model([reply("", [call("leave__requests", {})]), reply(DRAFT({ text: "That is not available to you." }))]);
    const out = await ask(vendors);
    expect(JSON.parse(vendors.gemini.complete.mock.calls[1][0].messages.find((m) => m.role === "tool").content)).toEqual({ read: 1, key: "leave.requests", error: "not_available" });
    const shown = answer.build({ draft: out.draft, reads: out.reads, routes: out.routes, screens: out.screens });
    expect(shown).toMatchObject({ declined: "not_available", citations: [], rows_read: 0, module_key: null });
  });

  test("parameters that do not parse go back once, uncounted; a second time counts as nothing returned", async () => {
    const bad = new AppError("AI_READ_INVALID", "bad", 422, { page: ["Expected number"] });
    jest.spyOn(authorise, "runRead").mockRejectedValue(bad);
    const vendors = model([reply("", [call("leave__requests", { page: "x" })]), reply("", [call("leave__requests", { page: "y" })]), reply(DRAFT())]);
    const out = await ask(vendors);
    const tools = (i) => JSON.parse(vendors.gemini.complete.mock.calls[i][0].messages.filter((m) => m.role === "tool").slice(-1)[0].content);
    expect(tools(1)).toMatchObject({ error: "invalid_parameters", fields: { page: ["Expected number"] } });
    expect(tools(2)).toMatchObject({ error: "no_result" });
    expect(out.reads).toHaveLength(1);
  });

  test("an answer that does not parse is sent back once, then answered in plain words with no tools", async () => {
    jest.spyOn(authorise, "runRead").mockResolvedValue(page([{ id: "l1", employee: "Ayo Bello" }]));
    const vendors = model([reply("", [call("leave__requests", {})]), reply("not json"), reply("still not json", [], "length"), reply("Ayo Bello's leave waits on you.")]);
    const out = await ask(vendors);
    expect(vendors.gemini.complete.mock.calls[2][0].messages.slice(-1)[0].content).toMatch(/could not be used/);
    const rescue = vendors.gemini.complete.mock.calls[3][0];
    expect(rescue.tools).toBeNull();
    expect(JSON.parse(rescue.messages[1].content)).toMatchObject({ question: "Whose leave waits on me?", data: [{ read: "leave.requests", rows: [{ employee: "Ayo Bello" }] }] });
    expect(out.draft).toEqual({ text: "Ayo Bello's leave waits on you.", table: null, route: null, prefill: null, more: false, action: null, overview: null });
    expect(steps.map((s) => s[0])).toEqual(["completion", "completion", "retry", "retry"]);
  });

  test("nothing usable even in plain words: AI_BAD_OUTPUT, and the run is closed as failed", async () => {
    const vendors = model([reply("x"), reply("y"), reply("   ")]);
    await expect(ask(vendors)).rejects.toMatchObject({ code: "AI_BAD_OUTPUT" });
    expect(finished).toEqual([expect.objectContaining({ status: "failed", error_code: "AI_BAD_OUTPUT" })]);
  });

  test("anything unexpected is AI_FAILED (500) to the screen, as the run records it (§5)", async () => {
    jest.spyOn(authorise, "allowedReads").mockRejectedValue(new TypeError("reads is not iterable"));
    await expect(ask(model([]))).rejects.toMatchObject({ code: "AI_FAILED", status: 500, message: "The assistant could not answer. Try again." });
  });

  test("past the question's budget the model is not asked again", async () => {
    jest.spyOn(authorise, "runRead").mockResolvedValue(page([]));
    const vendors = model([reply("", [call("leave__requests", {})]), reply(DRAFT())]);
    await expect(ask(vendors, { deadlineMs: -1 })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(vendors.gemini.complete).not.toHaveBeenCalled();
  });

  test("earlier turns are replayed with what they read, the last ten only", async () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ question: `q${i}`, answer: `a${i}`, reads: i === 11 ? [{ key: "leave.requests", params: { page: 1 }, rows: 25, total: 40 }] : [] }));
    const vendors = model([reply(DRAFT())]);
    await ask(vendors, { history, question: "Show the next 25" });
    const msgs = vendors.gemini.complete.mock.calls[0][0].messages;
    expect(msgs.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "Show the next 25"]);
    expect(msgs.slice(-2)[0].content).toBe('a11\n[Read: leave.requests {"page":1}: 25 row(s) of 40]');
  });

  test("no provider set up: the stub's placeholder, and no read is offered", async () => {
    jobs.resolve.mockResolvedValue({ scope: "action", key: "data-answers", stored: false, links: [{ provider: "gemini", model: "m", display_name: "m", position: 1, state: "not_set_up", until: null }] });
    jest.spyOn(authorise, "runRead");
    const vendors = model([]);
    const out = await ask(vendors);
    expect(out.stub).toBe(true);
    expect(out.draft.text).toBe("[AI placeholder]");
    expect(vendors.stub.complete.mock.calls[0][0].tools).toBeNull();
    expect(authorise.runRead).not.toHaveBeenCalled();
  });
});

describe("what the screen shows", () => {
  const READ = {
    n: 1,
    key: "leave.requests",
    ok: true,
    module: "ess",
    params: { page: 1 },
    rows: [
      { id: "l1", employee: "Ayo Bello", starts_on: "2026-10-27", days: 3, amount: "125000.00", tags: ["a"] },
      { id: "l2", employee: "Ngozi Eze", starts_on: "2026-11-02", days: 1, amount: "0.00", tags: [] },
    ],
    refs: [{ type: "leave_request", id: "l1" }, null],
    total: 40,
    page: { number: 1, size: 25, total: 40, pages: 2, has_next: true },
    citations: [
      { type: "leave_request", id: "l1", label: "Ayo Bello", link: "/x?id=l1", read: "leave.requests" },
      { type: "leave_request", id: "l2", label: "Ngozi Eze", link: "/x?id=l2", read: "leave.requests" },
    ],
  };
  const SCREENS = [{ module: "workspace", tab: "calendar", label: "Calendar", path: "/workspace?tab=calendar" }];

  test("a table's cells are the read's rows, formatted for a person; a field the rows lack or a list is left out", () => {
    const shown = answer.build({
      draft: { text: "Two.", table: { read: 1, fields: ["employee", "starts_on", "days", "amount", "tags", "nope"], labels: ["Employee", "Starts", "Days", "Amount", "Tags", "Nope"] }, route: null, prefill: null, more: true },
      reads: [READ],
      routes: [],
      screens: [],
    });
    expect(shown.table).toEqual({
      columns: ["Employee", "Starts", "Days", "Amount"],
      rows: [
        ["Ayo Bello", "27/10/2026", "3", "₦125,000.00"],
        ["Ngozi Eze", "02/11/2026", "1", "₦0.00"],
      ],
      numeric: [2, 3],
      // Each row opens its record; a row with no record opens nothing.
      links: ["/people?tab=leave&id=l1", null],
    });
    // What is kept is the record, not its link, which is worked out each time the answer is shown.
    expect(shown.metadata.table.refs).toEqual([{ type: "leave_request", id: "l1" }, null]);
    expect(shown.metadata.table.links).toBeUndefined();
    // From: the kind of record and how many, never each record by name (decision 9).
    expect(shown.sources).toEqual([{ kind: "type", entity_type: "leave_request", label: "leave request", count: 2, link: null }]);
    expect(shown).toMatchObject({ more: true, rows_read: 2, module_key: "ess", citations_total: 2, declined: null });
    expect(shown.citations[0]).toEqual({ entity_type: "leave_request", entity_id: "l1", label: "Ayo Bello", link: "/x?id=l1", read_key: "leave.requests" });
    expect(shown.metadata.reads).toEqual([{ n: 1, key: "leave.requests", kind: "read", module_key: "ess", params: { page: 1 }, outcome: "read", rows: 2, total: 40, first: 1 }]);
  });

  test("the screen button is an offered route by its intent, with only the prefill its schema takes", () => {
    const shown = answer.build({
      draft: { text: "Book it on Calendar.", table: null, route: "Book a meeting", prefill: { title: "Budget review", nonsense: "x" }, more: false },
      reads: [],
      routes: ROUTES,
      screens: SCREENS,
    });
    expect(shown.link.label).toBe("Open Calendar");
    expect(shown.link.path).toContain("new=1");
    expect(shown.link.path).toContain("title=Budget");
    expect(shown.link.path).not.toContain("nonsense");
    expect(shown.declined).toBe("change");
    // The route's own params win, a value the field refuses is dropped, and a list is never a value.
    const sneaky = answer.build({
      draft: { text: "x", table: null, route: "book a meeting", prefill: { new: "0", starts_at: "2026-10-23T10:00:00+01:00", event_type: "interview", location: ["a"] }, more: false },
      reads: [],
      routes: ROUTES,
      screens: SCREENS,
    });
    const q = new URL(sneaky.link.path, "http://x").searchParams;
    expect(Object.fromEntries(q)).toEqual({ tab: "calendar", new: "1", starts_at: "2026-10-23T10:00:00+01:00" });
    const none = answer.build({ draft: { text: "No.", table: null, route: "delete everyone", prefill: null, more: false }, reads: [], routes: ROUTES, screens: SCREENS });
    expect(none.link).toBeNull();
  });

  test("citations come from the reads, de-duplicated and at most fifty, with the total; 'more' only when a page has another", () => {
    const many = { ...READ, page: { ...READ.page, has_next: false }, citations: Array.from({ length: 60 }, (_, i) => ({ type: "employee", id: `e${i}`, label: `P${i}`, link: null, read: "employees.list" })) };
    const shown = answer.build({ draft: { text: "x", table: null, route: null, prefill: null, more: true }, reads: [many, { ...many, n: 2 }], routes: [], screens: [] });
    expect(shown.citations).toHaveLength(50);
    expect(shown.citations_total).toBe(60);
    expect(shown.more).toBe(false);
  });

  test("the table comes only from a read that answered", () => {
    const shown = answer.build({ draft: { text: "x", table: { read: 2, fields: ["employee"], labels: ["Employee"] }, route: null, prefill: null, more: false }, reads: [READ, { n: 2, key: "tasks.list", ok: false, declined: true, rows: [], citations: [] }], routes: [], screens: [] });
    expect(shown.table).toBeNull();
  });
});
