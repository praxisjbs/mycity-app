"use strict";
/**
 * Candidates: the rules that need no database (docs/guides/recruitment.md §6.2 to §6.5). The routes,
 * Apply end to end, the pipeline on the real schema and the mail are in
 * tests/integration/recruitment-candidates.test.js.
 */
const pipeline = require("./candidates.pipeline");
const screening = require("./candidates.screening");
const { scorecard } = require("./candidates.scorecard");
const { checkAnswers, splitName } = require("./candidates.apply");
const emails = require("./candidates.emails");
const routes = require("./candidates.routes");
const publicRoutes = require("./candidates.public.routes");
const { routesOf } = require("../../http/route");

const ALL = ["application", "screening", "assessment", "interview", "shortlist"];

describe("the pipeline", () => {
  test("a card moves to any stage ahead or one back, among the board's columns", () => {
    expect(pipeline.nextStages("screening", ALL)).toEqual(["application", "assessment", "interview", "shortlist"]);
    expect(pipeline.nextStages("interview", ALL)).toEqual(["assessment", "shortlist"]);
    expect(pipeline.nextStages("screening", ["application", "screening", "interview", "shortlist"])).toEqual([
      "application",
      "interview",
      "shortlist",
    ]);
  });

  test("a move is refused in plain words", () => {
    const at = (stage, status = "active") => ({ stage, status });
    expect(() => pipeline.assertCanMove(at("interview"), "application", ALL)).toThrow("Move one stage back at most");
    expect(() => pipeline.assertCanMove(at("screening"), "assessment", ["application", "screening", "interview", "shortlist"])).toThrow(
      "This role does not use that stage",
    );
    expect(() => pipeline.assertCanMove(at("screening", "not_progressed"), "interview", ALL)).toThrow("Reopen");
    expect(() => pipeline.assertCanMove(at("screening"), "interview", ALL)).not.toThrow();
  });

  test("Offer and after are M5's: never a hand move, one step at a time through M5's own steps", () => {
    const at = (stage, status = "active") => ({ stage, status });
    const board = [...ALL, "offer"];
    expect(pipeline.nextStages("interview", board)).toEqual(["assessment", "shortlist"]);
    expect(pipeline.nextStages("offer", board)).toEqual([]);
    expect(() => pipeline.assertCanMove(at("shortlist"), "offer", board)).toThrow("An offer moves a candidate to Offer");
    expect(() => pipeline.assertCanMove(at("offer"), "shortlist", board)).toThrow("moved on to an offer");
    const { moves } = pipeline.MACHINE;
    expect(moves.shortlist).toContain("offer");
    expect(moves.interview).not.toContain("offer");
    expect(moves.offer).toEqual(["documentation", "shortlist", "not_progressed"]);
    expect(moves.documentation).toEqual(["pre_onboarding", "not_progressed"]);
    expect(moves.pre_onboarding).toEqual(["onboarding", "not_progressed"]);
    expect(moves.onboarding).toEqual(["hired", "not_progressed"]);
    expect(moves.hired).toEqual([]);
    expect(moves.not_progressed).not.toContain("hired");
  });
});

describe("the estimate", () => {
  const q = (id, type, required = true) => ({ vacancy_question_id: id, question_type: type, required });

  test("is the mean of the parts with something to say", () => {
    const app = { years_experience: 4, cv: true, cover_letter: "x".repeat(50), answers: { a: "yes", b: "no", c: "https://example.test/work" } };
    // experience 4 of 8 = 50; completeness 3 of 3 = 100; required yes or no 1 of 2 = 50
    expect(screening.estimate(app, { min_experience_years: 8 }, [q("a", "yes_no"), q("b", "yes_no"), q("c", "text")])).toBe(66.7);
  });

  test("a role with no minimum gives 100 for experience, and no yes or no question leaves that part out", () => {
    expect(screening.estimate({ years_experience: 0, cv: true, cover_letter: "", answers: {} }, { min_experience_years: null }, [])).toBe(66.7);
  });

  test("the shown score is the AI read once there is one, else the estimate, flagged", () => {
    expect(screening.shown({ screening_score: "71.00", provisional_score: "40.00" })).toEqual({ score: 71, provisional: false });
    expect(screening.shown({ screening_score: null, provisional_score: "40.00" })).toEqual({ score: 40, provisional: true });
  });
});

describe("the weighted scorecard", () => {
  const parts = (off = []) =>
    [
      ["screening", 15],
      ["psychometric", 15],
      ["technical", 25],
      ["case_study", 20],
      ["interview", 25],
    ].map(([code, weight]) => ({ code, name: code, active: !off.includes(code), weight: off.includes(code) ? 0 : weight }));

  test("counts only the parts on that have a score, over their own weights", () => {
    const s = scorecard(parts(), { screening: 80, technical: 60, interview: null }, true);
    // (15 × 80 + 25 × 60) ÷ 40
    expect(s.weighted_total).toBe(67.5);
    expect(s.parts_scored).toBe(2);
    expect(s.parts_active).toBe(5);
    expect(s.parts.find((p) => p.code === "screening").provisional).toBe(true);
  });

  test("a part switched off never counts, and no score at all is null", () => {
    const off = ["psychometric", "technical", "case_study"];
    expect(scorecard(parts(off), { screening: 50, technical: 100 }, false).weighted_total).toBe(50);
    expect(scorecard(parts(), {}, false).weighted_total).toBe(null);
  });
});

describe("Apply", () => {
  const qs = [
    { vacancy_question_id: "y", question_type: "yes_no", required: true, options: null },
    { vacancy_question_id: "c", question_type: "choice", required: false, options: ["Lagos", "Abuja"] },
  ];

  test("answers are held to the form's own questions", () => {
    expect(checkAnswers(qs, { y: "Yes", c: "Lagos" })).toEqual({ y: "yes", c: "Lagos" });
    let err;
    try {
      checkAnswers(qs, { c: "Kano", z: "hi" });
    } catch (e) {
      err = e;
    }
    expect(err.status).toBe(422);
    expect(Object.keys(err.fields).sort()).toEqual(["answers.c", "answers.y", "answers.z"]);
  });

  test("a full name splits at its first word", () => {
    expect(splitName(" Ada  Ngozi Obi ")).toEqual({ first_name: "Ada", last_name: "Ngozi Obi" });
  });
});

describe("Candidate Emails", () => {
  test("a shipped email is shown as the Markdown it would be saved as", () => {
    expect(emails.markdownOf('<p style="x">Hello {{ recipient.first_name }},</p><p><a href="{{ apply_url }}" style="y">Apply Now</a></p>')).toBe(
      "Hello {{ recipient.first_name }},\n\n[Apply Now]({{ apply_url }})",
    );
    expect(emails.KEYS).toHaveLength(9);
  });
});

describe("routes", () => {
  test("every staff route holds a recruitment grant; writes need edit or create", () => {
    const rs = routesOf(routes.router);
    for (const r of rs) expect(r.permission && r.permission.key).toBe("recruitment");
    for (const r of rs.filter((x) => x.method !== "GET")) expect(["create", "edit"]).toContain(r.permission.action);
  });

  test("Apply has three public routes, each behind its link", () => {
    const rs = routesOf(publicRoutes.router);
    expect(rs.map((r) => `${r.method} ${r.path}`).sort()).toEqual(["GET /:token", "POST /:token", "POST /:token/cv"]);
    for (const r of rs) expect(r.kind).toBe("public");
  });
});
