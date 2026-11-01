"use strict";
/**
 * Praxis AI's module without a database (docs/guides/praxis-ai.md §5, §6.5, §6.8): who may reach
 * each route, a conversation's title, the questions Try Asking offers, and an answer as History
 * shows it. Asking, History and voice run against Postgres in tests/integration/assistant.test.js.
 *
 * Every person and record here is invented.
 */
const { routesOf } = require("../../http/route");
const { titleOf } = require("./assistant.service");
const suggestions = require("./assistant.suggestions");
const { present } = require("./assistant.history");

describe("the routes", () => {
  const routes = routesOf(require("./assistant.routes").router);
  const by = Object.fromEntries(routes.map((r) => [`${r.method} ${r.path}`, r]));

  test("asking, feedback and voice need praxis_ai create; reading and removing one's own words need view", () => {
    expect(Object.keys(by).sort()).toEqual([
      "DELETE /conversations/:id",
      "DELETE /history",
      "GET /answers/:id/reads/:n",
      "GET /cards/:id",
      "GET /conversations",
      "GET /conversations/:id/turns",
      "GET /history/questions",
      "GET /history/summary",
      "GET /suggestions",
      "POST /answers/:id/feedback",
      "POST /answers/:id/reads/:n/export",
      "POST /ask",
      "POST /cards/:id/cancel",
      "POST /cards/:id/confirm",
      "POST /history/export",
      "POST /transcribe",
      "PUT /cards/:id",
    ]);
    // A card's edit, press and cancel are the asker's own (create); the action's own grant is checked inside (§6.11).
    for (const key of ["POST /ask", "POST /answers/:id/feedback", "POST /transcribe", "PUT /cards/:id", "POST /cards/:id/confirm", "POST /cards/:id/cancel"])
      expect(by[key].permission).toMatchObject({ key: "praxis_ai", action: "create" });
    // One's own History, its figures, its export, a read run again and a card: view, whatever the grant's scope (decision 7).
    for (const key of ["GET /suggestions", "GET /conversations", "GET /conversations/:id/turns", "DELETE /conversations/:id", "DELETE /history", "GET /history/summary", "GET /history/questions", "POST /history/export", "GET /answers/:id/reads/:n", "POST /answers/:id/reads/:n/export", "GET /cards/:id"])
      expect(by[key].permission).toMatchObject({ key: "praxis_ai", action: "view" });
    for (const r of routes) expect(r.capability).toBeNull();
  });
});

describe("a conversation's title", () => {
  test("its first question, cut at 120 characters on a word", () => {
    expect(titleOf("  Who is   late today? ")).toBe("Who is late today?");
    const long = `${"Which leave requests are waiting on me and ".repeat(4)}end`;
    const t = titleOf(long);
    expect(t.length).toBeLessThanOrEqual(120);
    expect(long.startsWith(t)).toBe(true);
    expect(t.endsWith(" ")).toBe(false);
  });
});

describe("Try Asking", () => {
  test("only questions the person's reads can answer, six at most, most useful first", () => {
    expect(suggestions.forReads([{ key: "my_leave.balances" }, { key: "holidays.list" }])).toEqual([
      "How many leave days do I have left?",
      "When is the next public holiday?",
    ]);
    const all = suggestions.QUESTIONS.map(([key]) => ({ key }));
    expect(suggestions.forReads(all, { capabilities: ["home.team"] })).toHaveLength(6);
    expect(suggestions.forReads(all, { capabilities: ["home.team"] })[0]).toBe("Who is in today, and who is late?");
    expect(suggestions.forReads([{ key: "payroll.runs" }])).toEqual([]);
  });

  test("a read that answers only with a capability offers its question only to its holders, and the CEO", () => {
    const reads = [{ key: "team.today" }, { key: "activity.list" }, { key: "alerts.mine" }];
    expect(suggestions.forReads(reads)).toEqual(["What happened today?"]);
    expect(suggestions.forReads(reads, { capabilities: ["alerts.clear"] })).toEqual(["What happened today?", "Which alerts are open right now?"]);
    expect(suggestions.forReads(reads, { is_ceo: true })).toEqual(["Who is in today, and who is late?", "What happened today?", "Which alerts are open right now?"]);
  });

  test("every question belongs to a read some module declares", () => {
    const registry = require("../../shared/ai/registry");
    for (const [key] of suggestions.QUESTIONS) expect(registry.read(key)).not.toBeNull();
  });
});

describe("progress over realtime (decision 23)", () => {
  const realtime = require("../../services/realtime/emitter");
  const { readWords, progressFor } = require("./assistant.service");

  test("a read's words for the line: its key as words, 'list' dropped", () => {
    expect(readWords("leave.requests")).toBe("leave requests");
    expect(readWords("employees.list")).toBe("employees");
    expect(readWords("my_leave.balances")).toBe("my leave balances");
    expect(readWords("activity.list")).toBe("activity");
  });

  test("each read is pushed to the asker's room with the question's key; a push that fails changes nothing", () => {
    const sent = jest.spyOn(realtime, "toUser").mockReturnValue(true);
    const tell = progressFor({ user_id: "u1" }, "k-1");
    tell({ n: 2, key: "leave.requests", kind: "read", of: 5 });
    expect(sent).toHaveBeenCalledWith("u1", "ai:progress", { ask_key: "k-1", n: 2, of: 5, read_key: "leave.requests", kind: "read", words: "leave requests" });
    sent.mockImplementation(() => {
      throw new Error("no redis");
    });
    expect(() => tell({ n: 3, key: "tasks.list", kind: "read", of: 5 })).not.toThrow();
    sent.mockRestore();
  });
});

describe("an answer as History shows it", () => {
  test("its table, button and reads from what was kept; a citation's link and a row's link worked out now", () => {
    const shown = present(
      {
        ai_message_id: "00000000-0000-4000-8000-000000000001",
        ai_conversation_id: "00000000-0000-4000-8000-000000000002",
        question: "Whose leave waits on me?",
        content: "Two requests wait on you.",
        metadata: {
          table: { columns: ["Employee"], rows: [["Ayo Bello"]], numeric: [], refs: [{ type: "employee", id: "00000000-0000-4000-8000-000000000003" }] },
          link: null,
          reads: [{ key: "leave.requests", params: { page: 1 }, rows: 2, total: 2, first: 1 }],
          declined: null,
          more: false,
        },
        feedback: "up",
        created_at: new Date("2026-10-22T09:30:00Z"),
        citations_total: 1,
      },
      [{ entity_type: "employee", entity_id: "00000000-0000-4000-8000-000000000003", label: "Ayo Bello", read_key: "employees.list" }],
      [{ entity_type: "employee", count: 1 }],
    );
    const c = require("@mycity/contract");
    expect(c.assistant.AiAnswer.safeParse(shown).success).toBe(true);
    expect(shown.reads).toEqual([{ n: 1, key: "leave.requests", kind: "read", module_key: null, params: { page: 1 }, outcome: "read", rows: 2, total: 2, first: 1, masked: [] }]);
    expect(shown.citations[0]).toMatchObject({ entity_type: "employee", label: "Ayo Bello", read_key: "employees.list" });
    expect(shown.citations[0].link).toMatch(/^\/people\?/);
    expect(shown.table.links).toEqual(["/people?tab=employees&id=00000000-0000-4000-8000-000000000003"]);
    // Resting on one record, From names it and opens it (decision 9).
    expect(shown.sources).toEqual([{ kind: "record", entity_type: "employee", label: "Ayo Bello", count: 1, link: shown.citations[0].link }]);
    expect(shown.created_at).toBe("2026-10-22T09:30:00.000Z");
  });

  test("a table kept before rows had links, and an answer read from several records", () => {
    const shown = present(
      {
        ai_message_id: "00000000-0000-4000-8000-000000000001",
        ai_conversation_id: "00000000-0000-4000-8000-000000000002",
        question: "Who is in today?",
        content: "Twenty people.",
        metadata: { table: { columns: ["Employee"], rows: [["Ayo Bello"], ["Ngozi Eze"]], numeric: [] }, reads: [] },
        created_at: new Date("2026-10-22T09:30:00Z"),
        citations_total: 23,
      },
      [],
      [{ entity_type: "attendance_record", count: 20 }, { entity_type: "employee", count: 2 }, { entity_type: "home_alert", count: 1 }],
    );
    expect(shown.table.links).toEqual([null, null]);
    expect(shown.sources.map((s) => [s.kind, s.label, s.count, s.link])).toEqual([
      ["type", "attendance record", 20, null],
      ["type", "employee", 2, null],
      ["type", "alert", 1, null],
    ]);
  });
});
