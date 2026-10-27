"use strict";
/**
 * Reviews, without a database (docs/guides/performance.md §6.9, §6.10, §6.12 to §6.17): who sees
 * which part of a review and what they may do, the proposed score of a person's own line, what
 * counts as missed, the chain's steps, the round's deadlines, the tidy's guard and the routes.
 */
const ww = require("../../shared/time/working-week");
const { scoring } = require("@mycity/contract");
const c = require("@mycity/contract");
const sequence = require("./reviews.sequence");
const progress = require("../targets/targets.progress");
const service = require("./reviews.service");
const cycle = require("./reviews.cycle");
const { figures } = require("./reviews.dictation");

const cal = ww.makeCalendar({ days: [1, 2, 3, 4, 5, 6], holidays: ["2026-10-01", "2026-12-25", "2026-12-28", "2027-01-01"] });
const rules = scoring.DEFAULT_RULES;

const ROLES = { employee: false, reviewer: false, dotted: false, second_level: false, hr: false, ceo: false, in_scope: false, full: false, named: false };
const as = (who) => ({ ...ROLES, ...who, named: true, full: Boolean(who.second_level || who.hr || who.ceo) && !who.employee });

describe("a late check-in, Score Without Check-In and Withdrawn (§11)", () => {
  const late = { status: "check_in", check_in_submitted_at: null };
  const scored = { status: "with_reviewer", check_in_submitted_at: null, no_check_in_at: "2026-11-05T09:00:00Z" };
  const reviewer = as({ reviewer: true });

  test("once the due date has passed the reviewer opens the review, but nothing of the drafts", () => {
    expect(() => sequence.assertMayRead(late, reviewer, { late: true })).not.toThrow();
    expect(sequence.partsFor(late, reviewer)).toMatchObject({ check_in: false, self: false, scores: false });
    const item = { actual_value: "9", evidence_note: "log", self_score: "1", self_reason: "y", proposed_score: "0.9", score: null };
    expect(sequence.itemFor(item, sequence.partsFor(late, reviewer))).toMatchObject({ actual_value: null, self_score: null, self_reason: null, proposed_score: null });
    expect(sequence.allowed(late, reviewer, { late: true })).toMatchObject({ score_without_check_in: true, score: false });
    expect(sequence.allowed(late, reviewer).score_without_check_in).toBe(false);
    expect(sequence.allowed(late, as({ employee: true }), { late: true }).score_without_check_in).toBe(false);
  });

  test("scored without it, the drafts stay the employee's; the reviewer scores", () => {
    expect(sequence.partsFor(scored, reviewer)).toMatchObject({ check_in: false, self: false, scores: true });
    expect(sequence.partsFor(scored, as({ employee: true }))).toMatchObject({ check_in: true, self: true });
    expect(sequence.allowed(scored, reviewer)).toMatchObject({ score: true, submit: true, score_without_check_in: false });
  });

  test("Operations & People withdraw an open review; a withdrawn one offers nothing", () => {
    const hr = as({ hr: true });
    expect(sequence.allowed(scored, hr).withdraw).toBe(true);
    expect(sequence.allowed({ status: "closed" }, hr).withdraw).toBe(false);
    expect(sequence.allowed(scored, reviewer).withdraw).toBe(false);
    const withdrawn = { status: "withdrawn", check_in_submitted_at: null };
    expect(Object.values(sequence.allowed(withdrawn, hr, { decide: true })).some(Boolean)).toBe(false);
  });

  test("a withdrawn review's chain ends at HR's stage: what happened is done, the rest skipped", () => {
    const base = { employee: { display_name: "Ada" }, reviewer: { display_name: "Tolu" }, review_type: "manager", second_level: null };
    const steps = service.chainOf({ ...base, status: "withdrawn", check_in_submitted_at: null, submitted_at: "2026-11-06T10:00:00Z", withdrawn_at: "2026-11-07T10:00:00Z" }, []);
    expect(steps.map((x) => [x.key, x.state])).toEqual([["check_in", "skipped"], ["reviewer", "done"], ["second_level", "skipped"], ["hr", "done"]]);
    expect(steps[3]).toMatchObject({ person: "Operations & People", at: "2026-11-07T10:00:00.000Z" });
  });

  test("the PDF prints the reason, and no check-in for the employee's own lines", () => {
    const pdf = require("./reviews.pdf");
    const review = {
      employee: { display_name: "Ada", job_title: null, department: null },
      reviewer: { display_name: "Tolu" },
      round_name: "October 2026",
      score_month: "0.5",
      score_to_date: "0.5",
      rating: "partly_meets",
      no_check_in_at: "2026-11-05T09:00:00Z",
      no_check_in_reason: "No check-in by 3 November",
    };
    const own = { section: "results", line: { title: "Stories", target_value: "10" }, actual_value: "9", evidence_kind: "note", evidence_note: "log", self_score: "1", self_reason: "y", action_text: "a", proposed_score: null, score: "0.5", override_reason: "Seen at work", auto: false };
    const auto = { section: "accountability", line: { title: "Monthly update on time" }, actual_text: "Late", proposed_score: "0", score: "0", auto: true };
    const v = pdf.variables(review, [own, auto], { done: [], ongoing: [], next_month: [] }, []);
    expect(v.no_check_in_reason).toBe("No check-in by 3 November");
    expect(v.lines[0]).toMatchObject({ actual: "No check-in", evidence: "No check-in", self: "No check-in", action: null, note: "Reviewer: Seen at work" });
    expect(v.lines[1]).toMatchObject({ actual: "Late", evidence: "System record", final: "0.00" });
    expect(c.reviews.ReviewSummaryVars.safeParse(v).success).toBe(true);
  });
});

describe("self first, and who sees which part (A17, §6.12, §8)", () => {
  const open = { status: "check_in", check_in_submitted_at: null };
  const sent = { status: "with_reviewer", check_in_submitted_at: "2026-11-03T10:00:00Z" };
  const closed = { status: "closed", check_in_submitted_at: "2026-11-03T10:00:00Z", rating: "below" };

  test("the reviewer is answered 409 CHECK_IN_FIRST until the check-in is in; a stranger 404", () => {
    expect(() => sequence.assertMayRead(open, as({ reviewer: true }))).toThrow(expect.objectContaining({ code: "CHECK_IN_FIRST", status: 409 }));
    expect(() => sequence.assertMayRead(sent, as({ reviewer: true }))).not.toThrow();
    expect(() => sequence.assertMayRead(open, ROLES)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => sequence.assertMayRead(open, { ...ROLES, in_scope: true })).not.toThrow();
  });

  test("the employee sees their check-in always and the reviewer's parts only once closed", () => {
    const me = as({ employee: true });
    expect(sequence.partsFor(sent, me)).toMatchObject({ check_in: true, scores: false, reviewer_notes: false, input: false, context: false });
    expect(sequence.partsFor(closed, me)).toMatchObject({ check_in: true, scores: true, reviewer_notes: true, input: true, conduct: true });
  });

  test("the dotted manager reads the submitted check-in and their input, never the scores", () => {
    const dotted = as({ dotted: true });
    expect(sequence.partsFor(open, dotted).check_in).toBe(false);
    expect(sequence.partsFor(sent, dotted)).toMatchObject({ check_in: true, scores: false, reviewer_notes: false, input: true, context: false });
  });

  test("a reader in scope alone sees the stage, and the scores once closed", () => {
    const scoped = { ...ROLES, in_scope: true };
    expect(sequence.partsFor(sent, scoped)).toMatchObject({ check_in: false, scores: false });
    expect(sequence.partsFor(closed, scoped)).toMatchObject({ check_in: false, scores: true, reviewer_notes: false, conduct: false });
  });

  test("an item sent to a reader leaves out what they may not see", () => {
    const item = { actual_value: "8", evidence_note: "log", action_text: "x", self_reason: "y", proposed_score: "0.8", self_score: "0.9", score: "0.8", override_reason: "z", comment: "c" };
    const dotted = sequence.itemFor(item, sequence.partsFor(sent, as({ dotted: true })));
    expect(dotted).toMatchObject({ actual_value: "8", self_reason: "y", score: null, override_reason: null, comment: null });
    const scoped = sequence.itemFor(item, sequence.partsFor(sent, { ...ROLES, in_scope: true }));
    expect(scoped).toMatchObject({ actual_value: null, action_text: null, proposed_score: null, self_score: null, score: null });
  });

  test("what each may do now", () => {
    const review = { ...sent, review_kind: "monthly", dotted_employee_id: "d", dotted_input: null };
    expect(sequence.allowed(review, as({ reviewer: true }))).toMatchObject({ score: true, submit: true, return_check_in: true, ask_input: true, give_input: false });
    expect(sequence.allowed(review, as({ dotted: true }))).toMatchObject({ score: false, give_input: true });
    expect(sequence.allowed({ ...review, status: "with_hr" }, as({ hr: true }), { decide: true })).toMatchObject({ decide: true, mark_conduct: true });
    expect(sequence.allowed({ ...closed, review_kind: "monthly" }, as({ hr: true }))).toMatchObject({ start_pip: true });
    expect(sequence.allowed({ ...closed, review_kind: "monthly" }, as({ hr: true }), { has_pip: true }).start_pip).toBe(false);
    // Operations & People's own review: they decide nothing of it.
    expect(sequence.allowed({ ...review, status: "with_hr" }, as({ hr: true, employee: true }), { decide: true })).toMatchObject({ decide: false, mark_conduct: false });
    expect(sequence.allowed({ ...review, status: "with_hr", review_kind: "probation" }, as({ hr: true })).decide_probation).toBe(true);
  });
});

describe("a person's own line: the proposed score (§6.9, §6.14)", () => {
  const ctx = { rules, cal, month: "2026-10-01", now: new Date("2026-11-03T10:00:00Z") };

  test("no evidence is Not Assessable, with no score, never zero", () => {
    expect(progress.proposeOwn({ measure: "numeric", target_value: "4" }, { actual_value: "3", evidence_kind: null }, ctx)).toEqual({
      proposed_score: null,
      assessable: false,
    });
  });

  test("numeric: actual over target, capped at 1; lower is better the other way up", () => {
    const own = (line, actual) => progress.proposeOwn(line, { actual_value: actual, evidence_kind: "note" }, ctx).proposed_score;
    // John Ojelola's Results line 3: 3 of 4 placements.
    expect(own({ measure: "numeric", target_value: "4" }, "3")).toBe("0.75");
    expect(own({ measure: "numeric", target_value: "4" }, "6")).toBe("1");
    expect(own({ measure: "numeric", target_value: "2", direction: "lower" }, "4")).toBe("0.5");
  });

  test("a milestone: 1 on time, 0.5 within 10 business days, 0 later or not delivered once due", () => {
    const line = { measure: "milestone", milestone_due_on: "2026-10-15" };
    const at = (done) => progress.proposeOwn(line, { achieved_on: done, evidence_kind: "document" }, ctx).proposed_score;
    expect(at("2026-10-15")).toBe("1");
    expect(at("2026-10-28")).toBe("0.5");
    expect(at("2026-11-02")).toBe("0");
    expect(at(null)).toBe("0");
    expect(progress.proposeOwn({ measure: "milestone", milestone_due_on: "2026-12-15" }, { evidence_kind: "note" }, ctx).proposed_score).toBeNull();
  });

  test("a monthly standard: met, missed by up to 5 points, or missed", () => {
    const std = (actual) =>
      progress.proposeOwn({ measure: "standard", target_value: "95", unit: "%" }, { actual_value: actual, evidence_kind: "link" }, ctx).proposed_score;
    expect([std("96"), std("91"), std("80")]).toEqual(["1", "0.5", "0"]);
    const binary = (v) => progress.proposeOwn({ measure: "binary" }, { actual_value: v, evidence_kind: "note" }, ctx).proposed_score;
    expect([binary("1"), binary("0"), binary(null)]).toEqual(["1", "0", null]);
  });

  test("which sources the system fills", () => {
    expect(progress.AUTOMATIC).toEqual(["commitments", "update_on_time", "team_reviews", "team_result", "function_kpi", "key_result", "tasks"]);
    expect(progress.isAutomatic("own")).toBe(false);
  });
});

describe("a missed line needs a corrective action (§6.16)", () => {
  const review = (month) => ({ month, period_ends_on: "2026-12-31" });
  test("under 1 at its last chance: a standard, binary or milestone line any month, a numeric line in the quarter's last", () => {
    expect(service.missed({ employee_target_id: "l", measure: "standard", score: "0.5" }, review("2026-10-01"))).toBe(true);
    expect(service.missed({ employee_target_id: "l", measure: "numeric", score: "0.6" }, review("2026-10-01"))).toBe(false);
    expect(service.missed({ employee_target_id: "l", measure: "numeric", score: "0.6" }, review("2026-12-01"))).toBe(true);
    expect(service.missed({ employee_target_id: "l", measure: "binary", score: "1" }, review("2026-10-01"))).toBe(false);
    expect(service.missed({ employee_target_id: "l", measure: "standard", score: null }, review("2026-10-01"))).toBe(false);
    expect(service.missed({ employee_target_id: null, criterion: "quality", score: "0.2" }, review("2026-10-01"))).toBe(false);
  });
});

describe("the chain (§6.12)", () => {
  const person = (n) => ({ display_name: n });
  const base = { employee: person("Ada"), reviewer: person("Tolu"), second_level: person("Kunle"), review_type: "manager" };
  test("each step done, current or waiting; second level skipped for a reviewer with none", () => {
    const at = (status, extra = {}) => service.chainOf({ ...base, status, ...extra }, []).map((s) => s.state);
    expect(at("check_in")).toEqual(["current", "waiting", "waiting", "waiting"]);
    expect(at("with_reviewer")).toEqual(["done", "current", "waiting", "waiting"]);
    expect(at("returned")).toEqual(["done", "current", "waiting", "waiting"]);
    expect(at("with_hr", { submitted_at: "2026-11-05T00:00:00Z", second_level_employee_id: null, second_level: null })).toEqual(["done", "done", "skipped", "current"]);
    expect(at("closed")).toEqual(["done", "done", "done", "done"]);
    expect(service.chainOf({ ...base, status: "closed", review_type: "self" }, []).map((s) => s.state)).toEqual(["done", "skipped", "skipped", "skipped"]);
  });
  test("names who decided each stage, from the approval's decisions", () => {
    const steps = service.chainOf({ ...base, status: "closed" }, [
      { stage_key: "second_level", decision: "approve", name: "Kunle Bello", decided_at: "2026-11-09T09:00:00Z" },
      { stage_key: "operations_people", decision: "approve", name: "Ngozi Eze", decided_at: "2026-11-12T09:00:00Z" },
    ]);
    expect(steps.slice(2).map((s) => [s.person, s.at])).toEqual([
      ["Kunle Bello", "2026-11-09T09:00:00.000Z"],
      ["Ngozi Eze", "2026-11-12T09:00:00.000Z"],
    ]);
  });
});

describe("a month's round (§6.2)", () => {
  test("September 2026's deadlines count Monday to Friday and step over 1 October; the months of a quarter", () => {
    expect(cycle.deadlines("2026-09-01", rules, cal)).toEqual({
      opens_on: "2026-10-02",
      check_in_due_on: "2026-10-05",
      head_check_in_due_on: "2026-10-06",
      review_due_on: "2026-10-08",
      second_level_due_on: "2026-10-12",
      close_due_on: "2026-10-15",
    });
    expect(cycle.monthsOf({ starts_on: "2026-10-01" })).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
  });
  test("a scorecard with no named reviewer is reviewed by its role's first holder, else its manager; the CEO's by the CEO", async () => {
    expect(await cycle.reviewerFor(null, { is_ceo: true, employee_id: "ceo" })).toEqual({ reviewer_employee_id: "ceo", review_type: "self" });
    expect(await cycle.reviewerFor(null, { reviewer_employee_id: "m", effective_manager_id: "m" })).toEqual({ reviewer_employee_id: "m", review_type: "manager" });
    expect(await cycle.reviewerFor(null, { reviewer_employee_id: "x", effective_manager_id: "m" })).toEqual({ reviewer_employee_id: "x", review_type: "designated" });
    expect(await cycle.reviewerFor(null, { effective_manager_id: "m" })).toEqual({ reviewer_employee_id: "m", review_type: "manager" });
    expect(await cycle.reviewerFor(null, {})).toBeNull();
  });
  test("Open Round refuses a month outside the quarter and one not ended, each under its own rule (fault #8 on staging, 27/10/2026)", async () => {
    const plans = require("../goals/goals.plans");
    const lagos = require("../../shared/time/lagos");
    const period = { performance_period_id: "p", starts_on: "2026-10-01", status: "active" };
    const asked = jest.spyOn(plans, "periodOf").mockResolvedValue(period);
    const today = jest.spyOn(lagos, "today").mockReturnValue("2026-10-26");
    try {
      const refusal = (month) => cycle.createRound({ user_id: "u" }, { performance_period_id: "p", month }).catch((e) => [e.code, e.status, e.fields]);
      expect(await refusal("2026-10-01")).toEqual(["ROUND_MONTH_NOT_ENDED", 422, { month: ["Not ended yet"] }]);
      expect(await refusal("2027-01-01")).toEqual(["ROUND_MONTH_NOT_IN_QUARTER", 422, { month: ["Not this quarter"] }]);
    } finally {
      asked.mockRestore();
      today.mockRestore();
    }
  });
});

describe("Tidy never brings in a figure (§6.17)", () => {
  test("the figures of a text, with or without thousands separators", () => {
    expect([...figures("3 of 4 placements, ₦1,250,000 on 15/11")]).toEqual(["3", "4", "1250000", "15", "11"]);
  });
});

describe("the routes", () => {
  const { routesOf } = require("../../http/route");
  const routes = routesOf(require("./reviews.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("mount at /performance, each the contract's", () => {
    expect(require("./reviews.routes").basePath).toBe("/performance");
    expect(find("GET", "/reviews/:id").contract).toMatchObject({ params: c.common.IdParams, response: c.reviews.ReviewDetail });
    expect(find("PUT", "/reviews/:id/scores").contract).toMatchObject({ body: c.reviews.ReviewScoresSave, response: c.reviews.ReviewDetail });
    expect(find("POST", "/reviews/:id/return").contract.response).toBe(c.reviews.Review);
    expect(find("POST", "/reviews/:id/items/:item_id/dictation").contract.params).toBe(c.reviews.ReviewItemParams);
  });

  test("running the cycle needs performance.manage, after the grant; reading and the reviewer's work the grant alone", () => {
    const manage = [
      ["POST", "/rounds"],
      ["POST", "/rounds/:id/close"],
      ["POST", "/reviews/:id/conduct"],
      ["POST", "/reviews/:id/probation-outcome"],
      ["POST", "/reviews/:id/withdraw"],
      ["POST", "/pips"],
      ["PATCH", "/pips/:id"],
      ["POST", "/pips/:id/close"],
    ];
    for (const r of routes) {
      const needs = manage.some(([m, p]) => m === r.method && p === r.path);
      expect([r.method, r.path, r.permission.key, r.capability || null]).toEqual([r.method, r.path, "performance", needs ? "performance.manage" : null]);
    }
    expect(find("POST", "/reviews/:id/probation-outcome").permission.action).toBe("approve");
    expect(find("POST", "/reviews/:id/submit").permission.action).toBe("view");
  });
});
