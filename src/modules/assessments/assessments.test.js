"use strict";
/**
 * Assessments: the rules that need no database (docs/guides/recruitment.md §6.7). The library, the
 * sittings, the public page and the clock on the real schema are in
 * tests/integration/recruitment-assessments.test.js.
 */
const scoring = require("./assessments.scoring");
const timer = require("./assessments.timer");
const routes = require("./assessments.routes");
const publicRoutes = require("./assessments.public.routes");
const { routesOf } = require("../../http/route");

describe("scoring", () => {
  const choice = { assessment_question_id: "a", question_type: "choice", options: [{ points: 0 }, { points: 4 }], max_score: 4 };
  const text = { assessment_question_id: "b", question_type: "text", max_score: 10 };

  test("a choice's most is its best option; the method follows the questions", () => {
    expect(scoring.maxOf(choice)).toBe(4);
    expect(scoring.maxOf(text)).toBe(10);
    expect(scoring.scoringMethod([choice])).toBe("auto");
    expect(scoring.scoringMethod([text])).toBe("manual");
    expect(scoring.scoringMethod([choice, text])).toBe("mixed");
  });

  test("the key is kept apart from the options, sealed to its question", () => {
    const { options, key } = scoring.keyOf([
      { text: "Agree", points: 3 },
      { text: "Disagree", points: 1 },
    ]);
    expect(options.map((o) => o.text)).toEqual(["Agree", "Disagree"]);
    expect(options[0]).not.toHaveProperty("points");
    const sealed = scoring.sealKey("q-1", key);
    expect(sealed).not.toContain("Agree");
    expect(scoring.openKey("q-1", sealed)).toEqual(key);
    expect(() => scoring.openKey("q-2", sealed)).toThrow();
    expect(scoring.award({ question_type: "choice" }, options[0].id, key)).toBe(3);
    expect(scoring.award({ question_type: "choice" }, "nope", key)).toBe(0);
    expect(scoring.award({ question_type: "text" }, "words", key)).toBe(null);
  });

  test("the score waits for every mark; an unanswered question counts zero", () => {
    const qs = [choice, text];
    expect(scoring.scoreOf(qs, new Map([["a", { answered: true, awarded: 4 }], ["b", { answered: true, awarded: null }]]))).toBe(null);
    expect(scoring.scoreOf(qs, new Map([["a", { answered: true, awarded: 4 }], ["b", { answered: true, awarded: 5 }]]))).toBe(64.3);
    expect(scoring.scoreOf(qs, new Map([["a", { answered: true, awarded: 4 }]]))).toBe(28.6);
  });
});

describe("the clock", () => {
  test("a timed test ends its minutes after Start; an untimed brief at 23:59 Lagos on its due day", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    expect(timer.dueAt({ duration_minutes: 45 }, now).toISOString()).toBe("2026-11-05T10:45:00.000Z");
    expect(timer.dueAt({ duration_minutes: null, due_days: 5 }, now).toISOString()).toBe("2026-11-10T22:59:59.000Z");
    expect(timer.pastDue({ status: "in_progress", due_at: "2026-11-05T09:59:00Z" }, now)).toBe(true);
    expect(timer.pastDue({ status: "submitted", due_at: "2026-11-05T09:59:00Z" }, now)).toBe(false);
  });
});

describe("routes", () => {
  test("every staff route holds a recruitment grant; writes need create, edit or (the file) export", () => {
    const rs = routesOf(routes.router);
    for (const r of rs) expect(r.permission && r.permission.key).toBe("recruitment");
    for (const r of rs.filter((x) => x.method !== "GET")) expect(["create", "edit"]).toContain(r.permission.action);
    expect(rs.find((r) => r.path === "/:id/export").permission.action).toBe("export");
  });

  test("the public page has five routes, each behind its link", () => {
    const rs = routesOf(publicRoutes.router);
    expect(rs.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "GET /:token",
      "POST /:token/answers/:question_id/file",
      "POST /:token/start",
      "POST /:token/submit",
      "PUT /:token/answers/:question_id",
    ]);
  });
});
