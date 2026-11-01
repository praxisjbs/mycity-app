"use strict";
/**
 * The Praxis AI Engine's own rules (docs/guides/praxis-ai.md §6.11, §6.13, §6.14; the handoff's
 * decisions 10, 11, 14, 16, 20, 21), tested with nothing of MyCity: the manifest v2 shape, the
 * turn loop with a scripted model, the card rules, the pane's Overview and Sources, the matrix
 * generator, and the boundary gate on a throwaway folder.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const c = require("@mycity/contract");
const { defineManifest, RISKS, contractNameOf } = require("../../../src/shared/ai/manifest");
const engine = require("../../../src/services/ai/engine");
const boundary = require("../../../scripts/check/ai-engine-boundary");
const noWrites = require("../../../scripts/check/ai-no-writes");
const { jsonSchemaOf } = require("../../../src/services/ai/structured");

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const READ = { key: "things.list", description: "List the things a person may see", params: c.common.PageQuery, permission: ["workspace", "view"], run: async () => ({ data: [], page: {} }), cite: () => null };
const ACTION = {
  key: "things.create",
  description: "Set a thing for the person or someone they manage",
  input: c.tasks.TaskCreate,
  permission: ["workspace", "create"],
  risk: "standard",
  run: async () => ({ task_id: "t1" }),
};
const SUMMARY = { key: "things.summary", description: "Things by status, as figures never rows", params: c.common.EmptyBody, permission: ["workspace", "view"], run: async () => ({ figures: [] }) };

describe("manifest v2 (§6.11, §6.13)", () => {
  test("reads, summaries, actions and routes load; keys share one namespace; an action gets its label and defaults", () => {
    const m = defineManifest({ module: "workspace", reads: [READ], summaries: [SUMMARY], actions: [ACTION], routes: [{ intent: "see my things", screen: "workspace.tasks" }], not_offered: { TaskStepCreate: "a step belongs to a task's own panel" } });
    expect(m.reads[0].kind).toBe("read");
    expect(m.summaries[0]).toMatchObject({ kind: "summary", list: false });
    expect(m.actions[0]).toMatchObject({ kind: "action", label: "Create Thing", bulk: 1, suggest: false, readback: null, check: null });
    expect(typeof m.actions[0].records).toBe("function");
    expect(m.not_offered).toEqual({ TaskStepCreate: "a step belongs to a task's own panel" });
    expect(contractNameOf(m.actions[0].input)).toBe("tasks.TaskCreate");
    expect(() => defineManifest({ module: "workspace", reads: [READ], actions: [{ ...ACTION, key: "things.list" }] })).toThrow(/declared twice/);
  });

  test("a write by another name, SQL words, a view grant on an action, a risk outside the five, a summary with a page: each refused at load", () => {
    expect(() => defineManifest({ module: "workspace", writes: [] })).toThrow(/a write by another name/);
    expect(() => defineManifest({ module: "workspace", actions: [{ ...ACTION, executor: () => {} }] })).toThrow(/"executor" in an action/);
    expect(() => defineManifest({ module: "workspace", actions: [{ ...ACTION, permission: ["workspace", "view"] }] })).toThrow(/an action needs/);
    expect(() => defineManifest({ module: "workspace", actions: [{ ...ACTION, risk: "scary" }] })).toThrow(new RegExp(`risk is one of ${RISKS.join(", ")}`));
    expect(() => defineManifest({ module: "workspace", actions: [{ ...ACTION, bulk: 26 }] })).toThrow(/bulk is 1 to 25/);
    expect(() => defineManifest({ module: "workspace", actions: [{ ...ACTION, run: "service.create" }] })).toThrow(/run is \(values, actor, ctx\)/);
    expect(() => defineManifest({ module: "workspace", actions: [{ ...ACTION, input: { safeParse: () => ({ success: true }) } }] })).toThrow(/input is a schema exported from packages\/contract/);
    expect(() => defineManifest({ module: "workspace", actions: [{ ...ACTION, labels: { nope: "Nope" } }] })).toThrow(/labels names "nope"/);
    expect(() => defineManifest({ module: "workspace", actions: [{ ...ACTION, label: "Create A Thing Now" }] })).toThrow(/Verb Noun/);
    expect(() => defineManifest({ module: "workspace", summaries: [{ ...SUMMARY, params: c.common.PageQuery }] })).toThrow(/a summary takes no page/);
    expect(() => defineManifest({ module: "workspace", not_offered: { lower: "a reason" } })).toThrow(/names a contract schema/);
    expect(() => defineManifest({ module: "workspace", not_offered: { TaskStepCreate: "" } })).toThrow(/needs a reason/);
  });

  test("gate 19 refuses SQL and a query call inside a manifest, and a write key, comments aside", () => {
    const dir = tmp("mycity-gate19v2-");
    const src = (p) => JSON.stringify(path.resolve(__dirname, "../../..", p));
    write(path.join(dir, "ok", "ok.ai.js"), `// never INSERT INTO here\nconst { defineManifest } = require(${src("src/shared/ai/manifest.js")});\nmodule.exports = defineManifest({ module: "workspace", reads: [] });`);
    expect(noWrites.check({ dir }).problems).toEqual([]);
    write(path.join(dir, "sql", "sql.ai.js"), `const { defineManifest } = require(${src("src/shared/ai/manifest.js")});\nconst sql = "INSERT INTO thing (a) VALUES (1)";\nmodule.exports = defineManifest({ module: "workspace", reads: [] });`);
    write(path.join(dir, "q", "q.ai.js"), `const { defineManifest } = require(${src("src/shared/ai/manifest.js")});\nconst run = (client) => client.query("SELECT 1");\nmodule.exports = defineManifest({ module: "workspace", reads: [] });`);
    const r = noWrites.check({ dir });
    expect(r.problems).toEqual([expect.stringMatching(/q\.ai\.js: calls \.query\(\)/), expect.stringMatching(/sql\.ai\.js: holds SQL/)]);
  });
});

describe("the turn loop (engine/turn.js)", () => {
  /** A scripted model: each reply in turn; what it was sent is kept. */
  function talkOf(replies) {
    const sent = [];
    return {
      sent,
      stub: false,
      round: async (r) => {
        // The loop appends to one messages array: keep what this round saw.
        sent.push({ ...r, messages: [...r.messages] });
        const next = replies.shift();
        if (!next) throw new Error("the script ran out");
        return { text: next.text || "", toolCalls: next.calls || [], turn: { role: "assistant", content: next.text || null }, finish_reason: next.finish || "stop" };
      },
      fail: async (code, message, status) => Object.assign(new Error(message), { code, status }),
    };
  }
  const call = (name, args = {}, id = "c1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const draft = (v) => ({ text: JSON.stringify(v) });
  const parse = (text) => {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, issues: ["not JSON"] };
    }
  };
  const tools = [{ type: "function", function: { name: "things__list", description: "d", parameters: {} } }];
  const limits = { maxReads: 2, maxRounds: 8, deadlineMs: 60_000 };

  test("a call runs through the adapter with its key and parameters, and its content goes back to the model", async () => {
    const talk = talkOf([{ calls: [call("things__list", { page: 2 })] }, draft({ text: "done" })]);
    const ran = [];
    const runTool = async (key, params) => {
      ran.push([key, params]);
      return { kind: "ok", content: JSON.stringify({ read: 1, rows: [] }) };
    };
    const out = await engine.turn.runTurn({ talk, messages: [], tools, output: {}, runTool, parse, rescue: async () => null, limits });
    expect(ran).toEqual([["things.list", { page: 2 }]]);
    expect(out).toEqual({ draft: { text: "done" }, attempts: 1 });
    expect(talk.sent[1].messages.find((m) => m.role === "tool").content).toBe(JSON.stringify({ read: 1, rows: [] }));
  });

  test("the read cap: the third call is read_limit and the next round is forced with no tool to call; the same read twice is already_read", async () => {
    const talk = talkOf([{ calls: [call("things__list", {}, "a"), call("things__list", {}, "b"), call("things__list", { page: 2 }, "c"), call("things__list", { page: 3 }, "d")] }, draft({ text: "forced" })]);
    const runTool = async () => ({ kind: "ok", content: "{}" });
    await engine.turn.runTurn({ talk, messages: [], tools, output: {}, runTool, parse, rescue: async () => null, limits });
    const results = talk.sent[1].messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content).error || "ok");
    // A repeated read counts as an attempt (it was asked for), so the cap of two is reached by the third call.
    expect(results).toEqual(["ok", "already_read", "read_limit", "read_limit"]);
    expect(talk.sent[1].toolChoice).toBe("none");
    expect(talk.sent[1].tools).toBe(tools);
  });

  test("parameters that do not parse go back once uncounted, then count as nothing; the adapter's own words are kept", async () => {
    const talk = talkOf([{ calls: [call("things__list", { page: 0 })] }, { calls: [call("things__list", { page: 0 }, "e")] }, { calls: [call("things__list", { page: 1 }, "f")] }, draft({ text: "ok" })]);
    const kinds = [{ kind: "invalid", fields: { page: ["At least 1"] } }, { kind: "no_result", content: JSON.stringify({ read: 1, error: "no_result" }) }, { kind: "ok", content: "{}" }];
    const runTool = async () => kinds.shift();
    const out = await engine.turn.runTurn({ talk, messages: [], tools, output: {}, runTool, parse, rescue: async () => null, limits });
    expect(out.attempts).toBe(2);
    expect(talk.sent[1].messages.at(-1).content).toBe(JSON.stringify({ key: "things.list", error: "invalid_parameters", fields: { page: ["At least 1"] } }));
    expect(talk.sent[2].messages.at(-1).content).toBe(JSON.stringify({ read: 1, error: "no_result" }));
  });

  test("an answer that does not parse is corrected once, then rescued; a rescue with nothing is AI_BAD_OUTPUT", async () => {
    const talk = talkOf([{ text: "not json" }, { text: "still not" }]);
    const out = await engine.turn.runTurn({ talk, messages: [], tools: [], output: {}, runTool: async () => ({ kind: "ok", content: "{}" }), parse, rescue: async () => ({ text: "rescued" }), limits });
    expect(out.draft).toEqual({ text: "rescued" });
    expect(talk.sent[1].messages.at(-1).content).toMatch(/could not be used:\n- not JSON/);
    const bad = talkOf([{ text: "x" }, { text: "y" }]);
    await expect(engine.turn.runTurn({ talk: bad, messages: [], tools: [], output: {}, runTool: async () => ({ kind: "ok" }), parse, rescue: async () => null, limits })).rejects.toMatchObject({ code: "AI_BAD_OUTPUT", status: 502 });
  });

  test("past the deadline the model is not asked: talk.fail's error is thrown", async () => {
    const talk = talkOf([draft({ text: "late" })]);
    let t = 0;
    await expect(engine.turn.runTurn({ talk, messages: [], tools: [], output: {}, runTool: async () => ({ kind: "ok" }), parse, rescue: async () => null, limits: { ...limits, deadlineMs: 10 }, now: () => (t += 100) })).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(talk.sent).toEqual([]);
  });
});

describe("cards (engine/cards.js)", () => {
  const { cards } = engine;
  const fieldNames = Object.keys(c.tasks.TaskCreate._def.schema ? {} : {}).concat(["title", "description", "priority", "due_on", "primary_assignee_id"]);
  const action = { key: "tasks.create", risk: "standard", bulk: 1 };

  test("a draft keeps only the schema's fields, the parsed values when they parse, problems by field when not, and expires in 30 minutes", () => {
    const now = Date.parse("2026-11-01T10:00:00Z");
    const ok = cards.draft({ action, fieldNames, values: { title: "Send the report", bogus: 1 }, checked: { ok: true, values: { title: "Send the report", priority: "normal" }, problems: {}, records: [] }, now });
    expect(ok).toMatchObject({ action_key: "tasks.create", risk: "standard", confirm: "press", bulk: 1, values: { title: "Send the report", priority: "normal" }, problems: {}, records: [], suggested: false, status: "shown", expires_at: "2026-11-01T10:30:00.000Z" });
    const bad = cards.draft({ action, fieldNames, values: { title: "", bogus: 1 }, suggested: true, checked: { ok: false, values: { title: "" }, problems: { title: ["At least 1 character"] }, records: [] }, now });
    expect(bad.values).toEqual({ title: "" });
    expect(bad.problems).toEqual({ title: ["At least 1 character"] });
    expect(bad.suggested).toBe(true);
  });

  test("the four sensitive classes need a fresh sign-in within five minutes; standard needs a press", () => {
    expect(cards.confirmOf("standard")).toBe("press");
    for (const r of ["approval", "money", "payroll", "delete"]) expect(cards.confirmOf(r)).toBe("fresh_sign_in");
    expect(cards.confirmed("standard", null)).toBe(true);
    expect(cards.confirmed("approval", 299)).toBe(true);
    expect(cards.confirmed("approval", 301)).toBe(false);
    expect(cards.confirmed("delete", null)).toBe(false);
  });

  test("a shown card past its time reads expired; done, running, cancelled and expired cards cannot be pressed or edited", () => {
    const base = { status: "shown", expires_at: "2026-11-01T10:30:00.000Z" };
    expect(cards.statusOf(base, Date.parse("2026-11-01T10:29:59Z"))).toBe("shown");
    expect(cards.statusOf(base, Date.parse("2026-11-01T10:30:00Z"))).toBe("expired");
    expect(() => cards.assertPressable(base, Date.parse("2026-11-01T11:00:00Z"))).toThrow(expect.objectContaining({ code: "CARD_EXPIRED", status: 409 }));
    expect(() => cards.assertPressable({ ...base, status: "done" })).toThrow(expect.objectContaining({ code: "CARD_DONE" }));
    expect(() => cards.assertPressable({ ...base, status: "confirmed" })).toThrow(expect.objectContaining({ code: "CARD_RUNNING" }));
    expect(() => cards.assertPressable({ ...base, status: "cancelled" })).toThrow(expect.objectContaining({ code: "CARD_CANCELLED" }));
    expect(() => cards.assertOpen({ ...base, status: "done" })).toThrow(expect.objectContaining({ code: "CARD_NOT_OPEN" }));
    expect(() => cards.assertPressable(base, Date.parse("2026-11-01T10:00:00Z"))).not.toThrow();
  });

  test("the card's fields come from the input schema: kinds, labels, required, choices; the context's record fills the one empty id field", () => {
    const fields = cards.fieldsOf(jsonSchemaOf(c.tasks.TaskCreate), { due_on: "Due Day" });
    const by = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(by.title).toMatchObject({ label: "Title", kind: "text", required: true, options: null });
    expect(by.due_on).toMatchObject({ label: "Due Day", kind: "date", required: false });
    expect(by.priority).toMatchObject({ kind: "choice", options: expect.arrayContaining(["normal"]) });
    expect(by.primary_assignee_id).toMatchObject({ label: "Primary Assignee", kind: "id" });
    expect(by.member_ids.kind).toBe("list");
    expect(cards.fillFromContext({ title: "x" }, ["title", "task_id"], { id: "t1" })).toEqual({ title: "x", task_id: "t1" });
    expect(cards.fillFromContext({ title: "x" }, ["title", "task_id", "project_id"], { id: "t1" })).toEqual({ title: "x" });
    expect(cards.fillFromContext({ title: "x", task_id: "kept" }, ["title", "task_id"], { id: "t1" })).toEqual({ title: "x", task_id: "kept" });
  });
});

describe("the pane (engine/pane.js)", () => {
  const { pane } = engine;
  const summary = {
    n: 1,
    key: "attendance.summary",
    kind: "summary",
    ok: true,
    result: {
      figures: [{ key: "late", label: "Late arrivals", value: 12, unit: "count" }, { key: "minutes", label: "Minutes late", value: 340, unit: "minutes" }],
      groups: [{ by: "department", label: "By department", rows: [{ key: "ops", label: "Operations", value: 7, count: 7 }, { key: "it", label: "IT", value: 5, count: 5 }] }],
      series: [{ key: "by_day", label: "Late by day", points: [{ at: "2026-11-01", value: 3 }, { at: "2026-11-02", value: 9 }] }],
      total: 12,
    },
  };

  test("Overview: the figures by key and a chart over a group, drawn from the summary's own rows; a figure or group it lacks is dropped", () => {
    const o = pane.overviewOf({ summary: "attendance.summary", figures: ["late", "nope", "minutes"], chart: { kind: "bar", title: "Late arrivals by department", group: "department", series: null } }, [summary]);
    expect(o.figures.map((f) => f.key)).toEqual(["late", "minutes"]);
    expect(o.chart).toEqual({ kind: "bar", title: "Late arrivals by department", labels: ["Operations", "IT"], series: [{ label: "By department", values: [7, 5] }] });
    expect(pane.overviewOf({ summary: "attendance.summary", figures: [], chart: { kind: "bar", title: "x", group: "site", series: null } }, [summary]).chart).toBeNull();
    expect(pane.overviewOf({ summary: "other.summary", figures: [] }, [summary])).toBeNull();
    expect(pane.overviewOf(null, [summary])).toBeNull();
  });

  test("Overview: a chart over series, and a title that names a number the chart does not carry is replaced", () => {
    const o = pane.overviewOf({ summary: "attendance.summary", figures: [], chart: { kind: "line", title: "Late by day", group: null, series: ["by_day"] } }, [summary]);
    expect(o.chart).toEqual({ kind: "line", title: "Late by day", labels: ["2026-11-01", "2026-11-02"], series: [{ label: "Late by day", values: [3, 9] }] });
    const made = pane.overviewOf({ summary: "attendance.summary", figures: ["late"], chart: { kind: "line", title: "48 late this month", group: null, series: ["by_day"] } }, [summary]);
    expect(made.chart.title).toBe("Late by day");
    const kept = pane.overviewOf({ summary: "attendance.summary", figures: ["late"], chart: { kind: "line", title: "12 late this month", group: null, series: ["by_day"] } }, [summary]);
    expect(kept.chart.title).toBe("12 late this month");
  });

  test("Sources: one entry per read in order, with its outcome, rows, total and masks; a summary has no rows", () => {
    const reads = [
      { n: 1, key: "leave.requests", kind: "read", ok: true, params: { page: 1 }, rows: [{}, {}], total: 40, page: { number: 1, size: 25 }, module: "people", masked: ["employee.salary"] },
      { n: 2, key: "payroll.runs", kind: "read", ok: false, declined: true, params: {}, rows: [], module: null },
      summary,
    ];
    expect(pane.sourcesOf(reads)).toEqual([
      { n: 1, key: "leave.requests", kind: "read", module_key: "people", params: { page: 1 }, outcome: "read", rows: 2, total: 40, first: 1, masked: ["employee.salary"] },
      { n: 2, key: "payroll.runs", kind: "read", module_key: null, params: {}, outcome: "refused", rows: 0, total: null, first: null, masked: [] },
      { n: 1, key: "attendance.summary", kind: "summary", module_key: null, params: {}, outcome: "read", rows: 0, total: 12, first: null, masked: [] },
    ]);
  });
});

describe("the matrix generator and the boundary gate", () => {
  test("every tool crossed with every role, each case saying what the rule expects; a probe adds a scope case", () => {
    const tools = [
      { key: "things.list", kind: "read", module: "workspace", permission: ["workspace", "view"] },
      { key: "things.create", kind: "action", module: "workspace", permission: ["workspace", "create"], matrix: { inside: () => 1, outside: () => 2 } },
    ];
    const may = (role, module, action) => role === "ceo" || (role === "staff" && action === "view");
    const cases = engine.matrix.casesFor({ tools, roles: ["ceo", "staff"], may });
    expect(cases.map((k) => `${k.key} ${k.role} ${k.expect}`)).toEqual([
      "things.list ceo allowed",
      "things.list staff allowed",
      "things.create ceo allowed",
      "things.create ceo scoped",
      "things.create staff refused",
    ]);
    expect(engine.matrix.summarise(cases)).toEqual({ total: 5, allowed: 3, refused: 1, scoped: 1 });
  });

  test("gate 24: a file in the engine requiring MyCity, or a file outside reaching past its index, fails", () => {
    const root = tmp("mycity-boundary-");
    const eng = path.join(root, "src", "services", "ai", "engine");
    write(path.join(eng, "index.js"), 'const a = require("./a"); const fs = require("node:fs"); module.exports = { a, fs };');
    write(path.join(eng, "a.js"), "module.exports = 1;");
    write(path.join(root, "src", "services", "ai", "adapter.js"), 'module.exports = require("./engine");');
    expect(boundary.check({ root }).problems).toEqual([]);
    write(path.join(eng, "b.js"), 'module.exports = require("../../../config/db");');
    write(path.join(root, "src", "services", "ai", "peek.js"), 'module.exports = require("./engine/a");');
    const r = boundary.check({ root });
    expect(r.problems).toEqual([expect.stringMatching(/engine\/b\.js: requires "\.\.\/\.\.\/\.\.\/config\/db"/), expect.stringMatching(/peek\.js: requires "\.\/engine\/a", inside the engine/)]);
  });

  test("the real engine folder is clean", () => {
    expect(boundary.check().problems).toEqual([]);
  });
});
