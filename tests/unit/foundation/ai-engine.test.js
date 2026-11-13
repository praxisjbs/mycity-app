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
const registry = require("../../../src/shared/ai/registry");
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

  test("an action's fields, picks, names and asks are checked at load (decisions 29 and 31)", () => {
    const good = defineManifest({
      module: "workspace",
      actions: [{ ...ACTION, fields: ["title", "due_on", "watcher_ids"], picks: { watcher_ids: "colleague" }, names: async () => [], asks: [{ field: "due_on", question: "When is it due?", choices: () => ["Today"], none: true }, { field: "title", question: "What is the task?" }] }],
    });
    const a = good.actions[0];
    expect(a.fields).toEqual(["title", "due_on", "watcher_ids"]);
    expect(a.picks).toEqual({ watcher_ids: "colleague" });
    expect(a.asks.map((q) => [q.field, q.none])).toEqual([["due_on", true], ["title", false]]);
    expect(defineManifest({ module: "workspace", actions: [ACTION] }).actions[0]).toMatchObject({ fields: null, picks: {}, names: null, asks: [] });
    const refused = (over) => () => defineManifest({ module: "workspace", actions: [{ ...ACTION, ...over }] });
    expect(refused({ fields: ["nope"] })).toThrow(/fields names "nope"/);
    expect(refused({ fields: ["title", "title"] })).toThrow(/each once/);
    expect(refused({ fields: ["title"], picks: { watcher_ids: "colleague" } })).toThrow(/picks names "watcher_ids", which the card does not carry/);
    expect(refused({ picks: { watcher_ids: "anyone" } })).toThrow(/picks\.watcher_ids is one of colleague/);
    expect(refused({ names: [] })).toThrow(/names is \(values, actor, db\)/);
    expect(refused({ asks: [{ field: "due_on", question: "Due" }] })).toThrow(/one short question/);
    expect(refused({ asks: [{ field: "due_on", question: "When will this task you set for your colleague be due?" }] })).toThrow(/at most 8 words/);
    expect(refused({ asks: [{ field: "due_on", question: "When is it due?", choices: ["A", "B", "C", "D", "E", "F", "G"] }] })).toThrow(/at most 6 short choices/);
    expect(refused({ asks: [{ field: "due_on", question: "When is it due?", after: "now" }] })).toThrow(/an ask takes no "after"/);
    expect(refused({ fields: ["title"], asks: [{ field: "due_on", question: "When is it due?" }] })).toThrow(/asks names "due_on", which the card does not carry/);
    expect(refused({ asks: [{ field: "title", question: "What is it?" }, { field: "title", question: "What is it?" }] })).toThrow(/twice/);
    // One turn asking for several fields: one short question a field, each a field the card carries.
    const grouped = defineManifest({ module: "workspace", actions: [{ ...ACTION, asks: [{ field: "title", also: ["due_on"], question: "What is the task? When is it due?" }] }] }).actions[0];
    expect(grouped.asks[0]).toMatchObject({ field: "title", also: ["due_on"] });
    expect(refused({ asks: [{ field: "title", also: ["due_on"], question: "What is the task?" }] })).toThrow(/2 short questions, one a field/);
    expect(refused({ asks: [{ field: "title", also: ["title"], question: "What is it? What is it?" }] })).toThrow(/also names one to three other fields/);
    expect(refused({ fields: ["title"], asks: [{ field: "title", also: ["due_on"], question: "What is it? When is it due?" }] })).toThrow(/also names one to three other fields/);
    expect(refused({ then: { label: "Next" } })).toThrow(/then is \(result, values\)/);
  });

  test("a field written by name (resolve) and answers read from the person's records (options) are checked at load (decision 32)", () => {
    const options = async () => ["Annual Leave, 12 days left"];
    const resolve = { primary_assignee_id: async () => null };
    const a = defineManifest({ module: "workspace", actions: [{ ...ACTION, picks: { primary_assignee_id: "task_assignee", project_id: "project" }, resolve, asks: [{ field: "primary_assignee_id", question: "Who is it for?", options }] }] }).actions[0];
    expect(Object.keys(a.resolve)).toEqual(["primary_assignee_id"]);
    expect(a.asks[0]).toMatchObject({ field: "primary_assignee_id", choices: [], options });
    // The new picker kind is the contract's own.
    expect(c.assistant.AiCardPicks.options).toContain("leave_type");
    expect(defineManifest({ module: "workspace", actions: [ACTION] }).actions[0].resolve).toEqual({});
    const refused = (over) => () => defineManifest({ module: "workspace", actions: [{ ...ACTION, ...over }] });
    expect(refused({ resolve: [] })).toThrow(/resolve is \{ field: \(value, actor, db, values\) => id \}/);
    expect(refused({ resolve: { nope: async () => null } })).toThrow(/resolve names "nope"/);
    expect(refused({ fields: ["title"], resolve: { primary_assignee_id: async () => null } })).toThrow(/resolve names "primary_assignee_id", which the card does not carry/);
    expect(refused({ resolve: { primary_assignee_id: "by name" } })).toThrow(/resolve\.primary_assignee_id is \(value, actor, db, values\) => id/);
    expect(refused({ asks: [{ field: "title", question: "What is it?", options: ["A"] }] })).toThrow(/options are \(\{ actor, db, today, values \}\) => a list/);
    expect(refused({ asks: [{ field: "title", question: "What is it?", options, choices: ["A"] }] })).toThrow(/choices or options, not both/);
  });

  test("a question asked only in some states (when) and one naming a record (read) are checked at load (decision 34)", () => {
    const a = defineManifest({
      module: "workspace",
      actions: [
        {
          ...ACTION,
          asks: [
            { field: "primary_assignee_id", question: "Who leads it?", when: "project_id" },
            { field: "project_id", question: "Which project?", read: "projects.list", params: { status: "active" }, type: "project" },
            { field: "due_on", question: "When is it due?", when: { field: "priority", not: ["low"] } },
          ],
        },
      ],
    }).actions[0];
    expect(a.asks.map((q) => [q.field, q.when, q.read, q.params, q.type])).toEqual([
      ["primary_assignee_id", "project_id", null, {}, null],
      ["project_id", null, "projects.list", { status: "active" }, "project"],
      ["due_on", { field: "priority", not: ["low"] }, null, {}, null],
    ]);
    const refused = (ask) => () => defineManifest({ module: "workspace", actions: [{ ...ACTION, asks: [{ field: "project_id", question: "Which project?", ...ask }] }] });
    expect(refused({ when: "project_id" })).toThrow(/when names another field the card carries/);
    expect(refused({ when: "nope" })).toThrow(/when names another field/);
    expect(refused({ when: { field: "priority" } })).toThrow(/when is a field, or \{ field, not: \[values\] \}/);
    expect(refused({ when: { field: "priority", not: [], also: 1 } })).toThrow(/when is a field, or/);
    expect(refused({ read: "Projects" })).toThrow(/read is a read's key/);
    expect(refused({ read: "projects.list", choices: ["A"] })).toThrow(/takes read, options or choices, one of them/);
    expect(refused({ params: { status: "active" } })).toThrow(/params are the read's own, beside read/);
    expect(refused({ type: "project" })).toThrow(/type is a citation's type, beside read/);
  });

  test("the next question honours when: asked only while its field holds a value, or one outside its not list (decision 34)", () => {
    const action = {
      key: "things.decide",
      asks: [
        { field: "lead", question: "Who leads it?", choices: [], none: false, when: "department" },
        { field: "reason", question: "Why?", choices: [], none: false, when: { field: "decision", not: ["approve"] } },
      ],
    };
    expect(engine.cards.nextAsk(action, {})).toBeNull();
    expect(engine.cards.nextAsk(action, { department: "d1" })).toMatchObject({ field: "lead" });
    expect(engine.cards.nextAsk(action, { department: "d1", lead: "e1" })).toBeNull();
    expect(engine.cards.nextAsk(action, { decision: "approve" })).toBeNull();
    expect(engine.cards.nextAsk(action, { decision: "reject" })).toMatchObject({ field: "reason", question: "Why?" });
    expect(engine.cards.nextAsk(action, { decision: "reject", reason: "Short that week" })).toBeNull();
  });

  test("gate 23 rule 7: every field an action's input requires is asked before its card is drawn; a default, a field the card leaves out or an unconditional ask accounts for it (decision 34)", () => {
    const awareness = require("../../../scripts/check/ai-awareness");
    const input = c.tasks.TaskCommentAdd;
    const make = (asks, fields = null) => ({ key: "tasks.comment", input, fields, asks });
    expect(awareness.requiredAsked([make([{ field: "task_id" }, { field: "body" }])], jsonSchemaOf)).toEqual([]);
    const missing = awareness.requiredAsked([make([{ field: "body" }])], jsonSchemaOf);
    expect(missing).toEqual([expect.stringMatching(/^tasks\.comment: its input requires task_id, which no ask asks before the card is drawn.*decision 34/)]);
    // An ask asked only in some states does not stand for a field the input always requires.
    expect(awareness.requiredAsked([make([{ field: "task_id", when: "body" }, { field: "body" }])], jsonSchemaOf)).toHaveLength(1);
    // A field the card does not carry is never drawn, so never asked.
    expect(awareness.requiredAsked([make([{ field: "body" }], ["body"])], jsonSchemaOf)).toEqual([]);
    // A required field with a default (a calendar event's attendees) is filled, never asked.
    expect(awareness.requiredAsked([{ key: "calendar.create", input: c.calendar.CalendarEventCreate, fields: null, asks: [{ field: "title" }, { field: "starts_at" }, { field: "ends_at" }] }], jsonSchemaOf)).toEqual([]);
  });

  test("a question naming a record answers from a list read that exists and takes its params, checked once every manifest is loaded (decision 34)", () => {
    const ask = (over) => ({ ...ACTION, key: `things.${Object.keys(over).join("_") || "plain"}`, asks: [{ field: "project_id", question: "Which project?", read: "projects.list", ...over }] });
    const loadWith = (action) => () => registry.load({ extra: [{ folder: "things", manifest: defineManifest({ module: "workspace", actions: [action] }) }] });
    expect(loadWith(ask({ read: "nothings.list" }))).toThrow(/read "nothings\.list" is no read a manifest declares/);
    expect(loadWith(ask({ read: "my_profile.get" }))).toThrow(/is not a list, so it has no rows to offer/);
    expect(loadWith(ask({ params: { status: "lost" } }))).toThrow(/does not take params/);
    expect(loadWith(ask({}))).not.toThrow();
    registry.reset();
  });

  test("an action held to a capability names one the catalogue has; the task pick is the contract's (decision 33)", () => {
    const a = defineManifest({ module: "workspace", actions: [{ ...ACTION, capability: "workspace.late_reasons" }] }).actions[0];
    expect(a.capability).toBe("workspace.late_reasons");
    expect(defineManifest({ module: "workspace", actions: [ACTION] }).actions[0].capability).toBeNull();
    const refused = (over) => () => defineManifest({ module: "workspace", actions: [{ ...ACTION, ...over }] });
    expect(refused({ capability: "workspace.everything" })).toThrow(/capability is a code in shared\/access\/access\.catalog\.js/);
    expect(refused({ capability: ["workspace.late_reasons"] })).toThrow(/capability is a code/);
    // A route that asks only view and a capability (Home's alert rules): view stands with the capability, never alone.
    expect(defineManifest({ module: "workspace", actions: [{ ...ACTION, permission: ["workspace", "view"], capability: "workspace.late_reasons" }] }).actions[0].permission).toEqual(["workspace", "view"]);
    expect(refused({ permission: ["workspace", "view"] })).toThrow(/an action needs/);
    expect(c.assistant.AiCardPicks.options).toContain("task");
    expect(defineManifest({ module: "workspace", actions: [{ ...ACTION, picks: { project_id: "task" } }] }).actions[0].picks).toEqual({ project_id: "task" });
  });

  test("the People, Queries and Policies picks are the contract's, and allows names a carried text field with a test of its gaps (decision 33)", () => {
    for (const pick of ["employee", "worksite", "policy", "place", "site_member"]) expect(c.assistant.AiCardPicks.options).toContain(pick);
    const letterName = (gap) => gap === "{{ subject }}";
    const a = defineManifest({ module: "workspace", actions: [{ ...ACTION, picks: { primary_assignee_id: "employee" }, allows: { title: letterName } }] }).actions[0];
    expect(a.picks).toEqual({ primary_assignee_id: "employee" });
    expect(a.allows.title).toBe(letterName);
    expect(defineManifest({ module: "workspace", actions: [ACTION] }).actions[0].allows).toEqual({});
    const refused = (over) => () => defineManifest({ module: "workspace", actions: [{ ...ACTION, ...over }] });
    expect(refused({ allows: { nope: letterName } })).toThrow(/allows names "nope", which the card does not carry/);
    expect(refused({ allows: { title: "{{ subject }}" } })).toThrow(/allows\.title is \(gap\) => boolean/);
    expect(refused({ fields: ["description"], allows: { title: letterName } })).toThrow(/allows names "title"/);
    expect(refused({ picks: { primary_assignee_id: "anyone" } })).toThrow(/picks\.primary_assignee_id is one of/);
  });

  test("an action held to any one of several capabilities names two or more of the catalogue's, never beside one capability", () => {
    const a = defineManifest({ module: "performance", actions: [{ ...ACTION, permission: ["performance", "create"], capabilities: ["goals.company", "goals.function"] }] }).actions[0];
    expect([a.capability, a.capabilities]).toEqual([null, ["goals.company", "goals.function"]]);
    expect(defineManifest({ module: "workspace", actions: [ACTION] }).actions[0].capabilities).toBeNull();
    const refused = (over) => () => defineManifest({ module: "performance", actions: [{ ...ACTION, permission: ["performance", "create"], ...over }] });
    expect(refused({ capabilities: ["goals.company"] })).toThrow(/capabilities is a list of two or more codes/);
    expect(refused({ capabilities: ["goals.company", "goals.everything"] })).toThrow(/capabilities is a list of two or more codes/);
    expect(refused({ capabilities: "goals.company" })).toThrow(/capabilities is a list/);
    expect(refused({ capability: "goals.company", capabilities: ["goals.company", "goals.function"] })).toThrow(/capability or capabilities, not both/);
  });

  test("a record named by its words: the whole words, then the one they begin, then the one that holds them; never one of several", () => {
    const { oneNamed } = require("../../../src/shared/ai/named");
    const types = [{ name: "Annual", code: "annual" }, { name: "Compassionate Leave", code: "compassionate" }, { name: "Sick", code: "sick" }];
    const type = (said) => (oneNamed(types, said, (t) => [t.name, t.code], { drop: ["leave"] }) || {}).name || null;
    expect(["Annual Leave", "annual", "Compassionate", "SICK LEAVE", "leave", "Maternity", ""].map(type)).toEqual(["Annual", "Annual", "Compassionate Leave", "Sick", null, null, null]);
    const steps = [{ title: "Order the banners" }, { title: "Book the venue" }, { title: "Order the flyers" }];
    const step = (said) => (oneNamed(steps, said, (x) => [x.title]) || {}).title || null;
    expect(["order the banners", "banners", "Order the", "venue", "the", "paint"].map(step)).toEqual(["Order the banners", "Order the banners", null, "Book the venue", null, null]);
    // "&" is said "and", either way round: a model writes "Travel & Transport" for "Travel and Transport".
    const cats = [{ name: "Travel and Transport" }, { name: "Branding & Printing" }, { name: "Office and Admin" }];
    const cat = (said) => (oneNamed(cats, said, (x) => [x.name]) || {}).name || null;
    expect(["Travel & Transport", "travel and transport", "Branding and Printing", "Office & Admin"].map(cat)).toEqual(["Travel and Transport", "Travel and Transport", "Branding & Printing", "Office and Admin"]);
  });

  test("a record's words as an answer to tap fit 60 characters, cut at a word and marked, and still name their record (decision 34)", () => {
    const { choiceWords, oneNamed } = require("../../../src/shared/ai/named");
    expect(choiceWords("BM-KR2.1 Grow followers")).toBe("BM-KR2.1 Grow followers");
    const long = "BM-KR2.1 Grow the city stories audience on every channel we run, Lagos first";
    const cut = choiceWords(long);
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(cut).toBe("BM-KR2.1 Grow the city stories audience on every channel…");
    const krs = [{ code: "BM-KR2.1", statement: long.slice(9) }, { code: "BM-KR2.10", statement: "Publish 36 city stories" }];
    expect(oneNamed(krs, cut, (k) => [k.code, k.statement])).toBe(krs[0]);
    expect(choiceWords(`${"x".repeat(70)}`)).toBe(`${"x".repeat(59)}…`);
    expect(choiceWords(null)).toBe("");
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

  test("gate 23 rule 2 reads a form's call whole, its values' type named or not, a schema on a later line counting", () => {
    const { formCalls } = require("../../../scripts/check/ai-awareness");
    const code = 'const f = useContractForm<Values>(\n  { a: "" },\n  k ? bodySchema(g.KeyResultEdit, (v) => edit(v)) : bodySchema(g.KeyResultCreate),\n);\nconst h = useContractForm({ body: "" }, community.WishCreate);';
    expect(formCalls(code)).toEqual([
      'useContractForm<Values>(\n  { a: "" },\n  k ? bodySchema(g.KeyResultEdit, (v) => edit(v)) : bodySchema(g.KeyResultCreate),\n)',
      'useContractForm({ body: "" }, community.WishCreate)',
    ]);
  });

  test("gate 23 rule 6: every create and edit form is in the chat, reached via another action, never for a named reason, or a listed gap; the list only shrinks (decision 33)", () => {
    const awareness = require("../../../scripts/check/ai-awareness");
    const actionKeys = new Set(["tasks.create", "tasks.comment"]);
    const form = (name, over = {}) => ({ module: "tasks", name, offeredAs: null, reason: null, moduleReason: null, ...over });
    const fine = awareness.formsAccountedFor({
      forms: [
        form("TaskCreate", { offeredAs: "tasks.create" }),
        form("TaskCommentCreate", { reason: "via tasks.comment: the panel's own comment form" }),
        form("PunchCreate", { reason: "device: made on the device at the site" }),
        form("KeySave", { moduleReason: "secret: keys and connections are configuration" }),
        form("TaskEdit", { reason: "a task is edited on its panel" }),
      ],
      actionKeys,
      gaps: { "tasks.TaskEdit": "My Workspace · Tasks · Edit Task" },
      // A gap the base held and this change closed is fine: the list shrank.
      baseGaps: { "tasks.TaskEdit": "My Workspace · Tasks · Edit Task", "tasks.TaskStepEdit": "My Workspace · Tasks · Edit Task Step" },
    });
    expect(fine.problems).toEqual([]);
    expect(fine.counts).toEqual({ offered: 1, via: 1, never: 2, gaps: 1 });
    // A new form that is none of these fails, and cannot be added to the list.
    expect(awareness.formsAccountedFor({ forms: [form("TaskArchiveCreate")], actionKeys, gaps: {}, baseGaps: {} }).problems).toEqual([expect.stringMatching(/^tasks\.TaskArchiveCreate: a create or edit form not in the chat/)]);
    expect(awareness.formsAccountedFor({ forms: [form("TaskArchiveCreate")], actionKeys, gaps: { "tasks.TaskArchiveCreate": "x" }, baseGaps: {} }).problems).toEqual([expect.stringMatching(/gained tasks\.TaskArchiveCreate: the list only shrinks/)]);
    // A gap now in the chat, or naming no form, comes off.
    expect(awareness.formsAccountedFor({ forms: [form("TaskEdit", { offeredAs: "tasks.edit" })], actionKeys, gaps: { "tasks.TaskEdit": "x", "tasks.TaskGone": "y" }, baseGaps: null }).problems).toEqual([
      expect.stringMatching(/^tasks\.TaskEdit is offered as tasks\.edit: take it off/),
      expect.stringMatching(/names tasks\.TaskGone, which is no create or edit schema of a built module/),
    ]);
    // A via naming no action, and a reason with no never word, account for nothing.
    expect(awareness.formsAccountedFor({ forms: [form("TaskMoveCreate", { reason: "via tasks.move: the board" })], actionKeys, gaps: {}, baseGaps: null }).problems).toEqual([expect.stringMatching(/via tasks\.move, which no manifest declares/)]);
    expect(awareness.formsAccountedFor({ forms: [form("TaskLinkCreate", { reason: "dangerous: links" })], actionKeys, gaps: {}, baseGaps: null }).problems[0]).toMatch(/not in the chat/);
    expect(awareness.NEVER).toEqual(["secret", "device", "personal", "file", "ai", "design"]);
    expect(awareness.reasonOf("personal: a home location")).toEqual({ kind: "never", word: "personal" });
    expect(awareness.reasonOf("via mail.send: the composer's own")).toEqual({ kind: "via", key: "mail.send" });
    expect(awareness.FORM_SCHEMA.test("HolidaySave") && awareness.FORM_SCHEMA.test("OrganisationPatch") && !awareness.FORM_SCHEMA.test("TaskComplete")).toBe(true);
  });

  test("the gaps list ships as module.Schema ids, each with where its form lives", () => {
    const { gaps, about } = require("../../../scripts/check/ai-forms-gaps.json");
    expect(about).toMatch(/only shrinks/);
    for (const [id, note] of Object.entries(gaps)) expect([id, /^[a-z_]+\.[A-Z][A-Za-z0-9]*(Create|Edit|Update|Patch|Save)$/.test(id), typeof note === "string" && note.length > 3]).toEqual([id, true, true]);
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
    // What the check matched (a person written by name, now their id) stays while another field has a problem (decision 32).
    const matched = cards.draft({ action, fieldNames, values: { title: "", primary_assignee_id: "Ada Obi", bogus: 1 }, checked: { ok: false, values: { title: "", primary_assignee_id: "e1", bogus: 1 }, problems: { title: ["At least 1 character"] }, records: [] }, now });
    expect(matched.values).toEqual({ title: "", primary_assignee_id: "e1" });
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
    expect(by.title).toMatchObject({ label: "Title", kind: "text", required: true, options: null, long: false });
    // A text of 300 characters or more is written in a box of several lines (praxis-ai.md §6.11).
    expect(by.description).toMatchObject({ kind: "text", long: true });
    expect(by.due_on).toMatchObject({ label: "Due Day", kind: "date", required: false });
    expect(by.priority).toMatchObject({ kind: "choice", options: expect.arrayContaining(["normal"]) });
    expect(by.primary_assignee_id).toMatchObject({ label: "Primary Assignee", kind: "id" });
    expect(by.member_ids.kind).toBe("list");
    expect(cards.fillFromContext({ title: "x" }, ["title", "task_id"], { id: "t1" })).toEqual({ title: "x", task_id: "t1" });
    expect(cards.fillFromContext({ title: "x" }, ["title", "task_id", "project_id"], { id: "t1" })).toEqual({ title: "x" });
    expect(cards.fillFromContext({ title: "x", task_id: "kept" }, ["title", "task_id"], { id: "t1" })).toEqual({ title: "x", task_id: "kept" });
    expect(by.title.picks).toBeNull();
  });

  test("a card may carry only some fields, in its order, each id field with its picker; a draft keeps the names apart from the records (decision 31)", () => {
    const fields = cards.fieldsOf(jsonSchemaOf(c.tasks.TaskCreate), { watcher_ids: "Watchers" }, { fields: ["watcher_ids", "title", "nope"], picks: { watcher_ids: "colleague" } });
    expect(fields.map((f) => [f.name, f.label, f.picks])).toEqual([["watcher_ids", "Watchers", "colleague"], ["title", "Title", null]]);
    const drawn = cards.draft({ action: { key: "tasks.create", risk: "standard", bulk: 1 }, fieldNames: ["title"], values: { title: "x" }, checked: { ok: true, values: { title: "x" }, problems: {}, records: [], names: [{ type: "employee", id: "e1", label: "Ada Obi" }] } });
    expect(drawn.records).toEqual([]);
    expect(drawn.names).toEqual([{ type: "employee", id: "e1", label: "Ada Obi" }]);
  });

  test("a picked field that is not a list reads as an id whatever its type, so a place's token is read by its line, never printed (decision 33)", () => {
    const fields = cards.fieldsOf(jsonSchemaOf(c.worksites.WorksiteAdd), {}, { picks: { address: "place" } });
    expect(fields.find((f) => f.name === "address")).toMatchObject({ kind: "id", picks: "place" });
    expect(fields.find((f) => f.name === "name")).toMatchObject({ kind: "text", picks: null });
    const site = cards.fieldsOf(jsonSchemaOf(c.attendance.TemporarySiteAdd), {}, { picks: { address: "place", employee_ids: "site_member" } });
    expect(site.find((f) => f.name === "employee_ids")).toMatchObject({ kind: "list", picks: "site_member" });
    expect(site.find((f) => f.name === "purpose").options).not.toContain("temporary_home");
  });

  test("shape: the model's numbers in the forms the contract takes, anything else left for the schema (every card)", () => {
    const js = jsonSchemaOf(c.expenses.ExpenseRequestAdd);
    expect(cards.shape(js, { quantity: 1, unit_price: 700000, description: "Invoice JBS/001", submit: "false" })).toEqual({ quantity: "1", unit_price: "700000.00", description: "Invoice JBS/001", submit: false });
    expect(cards.shape(js, { quantity: 1.5, unit_price: "700000" }).unit_price).toBe("700000.00");
    expect(cards.shape(js, { unit_price: "₦700,000.5" }).unit_price).toBe("700000.50");
    expect(cards.shape(js, { unit_price: 12.345 }).unit_price).toBe(12.345);
    expect(cards.shape(js, { unit_price: "seven hundred" }).unit_price).toBe("seven hundred");
    expect(cards.shape(js, { unit_price: "7,00,000" }).unit_price).toBe("7,00,000");
    expect(cards.shape(js, { account_number: 123456789 }).account_number).toBe("123456789");
    expect(cards.shape(js, { other: 5 })).toEqual({ other: 5 });
    // A number field takes a number written as text; a nullable money field shaped all the same.
    const budget = jsonSchemaOf(c.budgets.ProjectBudgetSet);
    const moneyField = Object.keys(budget.properties).find((k) => /amount|budget/.test(k) && !/_id$/.test(k));
    expect(cards.shape(budget, { [moneyField]: 1500000 })[moneyField]).toBe("1500000.00");
    // The card draws a quantity sent as text as a one-line number field, never a box of lines.
    const fields = cards.fieldsOf(js);
    expect(fields.find((f) => f.name === "quantity")).toMatchObject({ kind: "number", long: false });
    expect(fields.find((f) => f.name === "unit_price")).toMatchObject({ kind: "money" });
  });

  test("nextAsk: the first field an action asks for that the values leave out, once in a run, never more than six in a row (decision 29)", () => {
    const asking = {
      key: "tasks.create",
      asks: [
        { field: "title", question: "What is the task?", choices: [], none: false },
        { field: "due_on", question: "When is it due?", choices: ({ today }) => [today ? "Today" : "Soon", "No Due Day"], none: true },
        { field: "priority", question: "How urgent is it?", choices: ["Low", "Normal", "Low"], none: false },
      ],
    };
    expect(cards.nextAsk(asking, {}, [], { today: "2026-11-01" })).toEqual({ action: "tasks.create", field: "title", question: "What is the task?", choices: [] });
    expect(cards.nextAsk(asking, { title: "  " }, []).field).toBe("title");
    expect(cards.nextAsk(asking, { title: "Report" }, [], { today: "2026-11-01" })).toEqual({ action: "tasks.create", field: "due_on", question: "When is it due?", choices: ["Today", "No Due Day"] });
    // None is an answer where the ask allows it: no due day said is given.
    expect(cards.nextAsk(asking, { title: "Report", due_on: null }, []).field).toBe("priority");
    expect(cards.nextAsk(asking, { title: "Report", due_on: null }, []).choices).toEqual(["Low", "Normal"]);
    // Priority null is not an answer, so it is asked; once asked in this run, it is not asked again.
    expect(cards.nextAsk(asking, { title: "Report", due_on: "2026-11-06", priority: null }, []).field).toBe("priority");
    expect(cards.nextAsk(asking, { title: "Report", due_on: "2026-11-06" }, [{ action: "tasks.create", field: "priority" }])).toBeNull();
    expect(cards.nextAsk(asking, { title: "Report" }, [{ action: "tasks.create", field: "due_on" }]).field).toBe("priority");
    // Another action's question asked before is not this one's.
    expect(cards.nextAsk(asking, { title: "Report" }, [{ action: "calendar.create", field: "due_on" }]).field).toBe("due_on");
    expect(cards.nextAsk(asking, {}, Array.from({ length: cards.ASK_RUN_MAX }, () => ({ action: "x", field: "y" })))).toBeNull();
    expect(cards.nextAsk({ key: "a.b" }, {}, [])).toBeNull();
    // A list may be answered with none (an empty list) only where none is allowed.
    const meeting = { key: "calendar.create", asks: [{ field: "attendee_ids", question: "Who should come?", choices: ["Just Me"], none: true }] };
    expect(cards.nextAsk(meeting, { attendee_ids: [] }, [])).toBeNull();
    expect(cards.nextAsk(meeting, {}, []).choices).toEqual(["Just Me"]);
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
    expect(o.chart).toEqual({ kind: "bar", title: "Late arrivals by department", labels: ["Operations", "IT"], series: [{ label: "By department", values: [7, 5] }], unit: null });
    expect(pane.overviewOf({ summary: "attendance.summary", figures: [], chart: { kind: "bar", title: "x", group: "site", series: null } }, [summary]).chart).toBeNull();
    expect(pane.overviewOf({ summary: "other.summary", figures: [] }, [summary])).toBeNull();
    expect(pane.overviewOf(null, [summary])).toBeNull();
  });

  test("Overview: a chart over series, and a title that names a number the chart does not carry is replaced", () => {
    const o = pane.overviewOf({ summary: "attendance.summary", figures: [], chart: { kind: "line", title: "Late by day", group: null, series: ["by_day"] } }, [summary]);
    expect(o.chart).toEqual({ kind: "line", title: "Late by day", labels: ["2026-11-01", "2026-11-02"], series: [{ label: "Late by day", values: [3, 9] }], unit: null });
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
    // The rule is handed the tool, so an action held to a capability is expected for its holders alone.
    const held = [{ key: "reasons.add", kind: "action", module: "workspace", permission: ["workspace", "edit"], capability: "workspace.late_reasons" }];
    const holds = (role, _module, _action, tool) => role === "ceo" || !tool.capability;
    expect(engine.matrix.casesFor({ tools: held, roles: ["ceo", "staff"], may: holds }).map((k) => `${k.role} ${k.expect}`)).toEqual(["ceo allowed", "staff refused"]);
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
