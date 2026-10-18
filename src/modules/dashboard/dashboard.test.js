"use strict";
/**
 * The KPI catalogue without a database (docs/guides/home.md §6, Cards): every card passes
 * its check and the screen copy rules, a half-defined card stops the require, the guards'
 * zero policy, the shapes the wire takes, who may see a card, and the order that decides
 * which cards a person's Overview shows. The cards' reads and their scope run against the
 * real migrations in tests/integration/home-catalogue.test.js; the source adapters are held
 * to the schema in tests/unit/home-sources.test.js.
 */
const c = require("@mycity/contract");
const copy = require("../../../scripts/check/lib/copy");
const catalog = require("../../shared/access/access.catalog");
const rbac = require("../../middleware/rbac");
const grantsCache = require("../../shared/rbac/grants-cache");
const fieldMask = require("../../shared/rbac/field-mask");
const { logger } = require("../../config/logger");
const workflow = require("../workflow/workflow.service");
const kpi = require("./kpi-catalog");
const shared = require("./kpi-catalog/shared");
const guards = require("./kpi-catalog/guards");
const eligibility = require("./kpi-catalog/eligibility");
const resolve = require("./kpi-catalog/resolve");
const { outcomeOf, leadBalance } = require("./kpi-catalog/tiles/people");

const { dashboard } = c;
const ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const LIVE = kpi.CATALOG.filter((e) => e.status === "live");
const HIDDEN = kpi.CATALOG.filter((e) => e.status === "hidden");

afterEach(() => jest.restoreAllMocks());

/**
 * Run `run` in a fresh module registry where one tiles file holds its real cards and
 * `extra`, so a broken card is tried without touching the catalogue the other tests read.
 */
function withCards(tiles, extra, run) {
  const path = `./kpi-catalog/tiles/${tiles}`;
  try {
    jest.isolateModules(() => {
      const real = jest.requireActual(path);
      jest.doMock(path, () => ({ ENTRIES: [...real.ENTRIES, ...extra] }));
      run();
    });
  } finally {
    jest.dontMock(path);
  }
}

/** A figure for any card: its unit's shape, with every fact a caption or a summary reads. */
function sampleFigure(entry) {
  const facts = {
    late: 2,
    overdue: 1,
    on_leave: 1,
    no_clock_out_yesterday: 1,
    aged: 2,
    agreements: 3,
    requests: 5,
    leave_type: "Annual",
    groups: {},
  };
  if (entry.unit === "money") return { ...facts, amount: "1250000.00" };
  if (entry.unit === "pct" || entry.unit === "pair") return { ...facts, value: 22, denominator: 25 };
  return { ...facts, value: 3 };
}

/** A card that passes the check; each test breaks one thing. */
const validCard = () => ({
  id: "test_card",
  domain: "people",
  label: "Test Card",
  unit: "count",
  module: "people",
  capability: null,
  sensitive_field: null,
  status: "live",
  pickable: true,
  tone: null,
  source: "organisation",
  value: () => null,
  detail: { title: "Test Card", columns: [{ key: "employee", label: "Employee" }], groups: [], list: () => null },
});

/* ------------------------------------------------------------------ *
 * The catalogue
 * ------------------------------------------------------------------ */

describe("the catalogue", () => {
  test("ids are unique, and BY_ID, the live and the pickable lists agree with it", () => {
    const ids = kpi.CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...kpi.BY_ID.keys()]).toEqual(ids);
    expect(kpi.LIVE_IDS).toEqual(LIVE.map((e) => e.id));
    expect(kpi.PICKABLE_IDS).toEqual(LIVE.filter((e) => e.pickable).map((e) => e.id));
  });

  test("its size, groups and units are the contract's", () => {
    expect(kpi.MAX_CARDS).toBe(dashboard.HOME_KPI_MAX);
    expect(kpi.DOMAINS).toEqual(dashboard.HomeKpiDomain.options);
    expect(kpi.UNITS).toEqual(dashboard.HomeKpiUnit.options);
    for (const e of kpi.CATALOG) expect(dashboard.HomeKpiKey.safeParse(e.id).success).toBe(true);
  });

  test("the word limits are the screen copy rules'", () => {
    expect(shared.WORDS).toEqual({
      title: copy.LIMITS.title,
      chip: copy.LIMITS.button,
      caption: copy.LIMITS.kpiCaption,
      sentence: copy.LIMITS.sentence,
    });
  });

  test("every title, column and chip is Title Case chrome, never an explainer", () => {
    const chrome = [];
    for (const e of kpi.CATALOG) {
      chrome.push(e.label);
      if (e.detail) {
        chrome.push(e.detail.title, ...e.detail.columns.map((col) => col.label), ...e.detail.groups.map((g) => g.label));
      }
    }
    for (const text of chrome) {
      expect([text, copy.titleCaseViolation(text)]).toEqual([text, null]);
      expect([text, copy.explainerTitle(text)]).toEqual([text, null]);
      expect(copy.hasDash(text)).toBe(false);
    }
  });

  test("captions and the lines above the records keep to their limits, with no dash", () => {
    for (const e of LIVE) {
      const f = sampleFigure(e);
      const caption = e.caption ? e.caption(f) : null;
      if (caption !== null) {
        expect([e.id, copy.wordCount(caption) <= copy.LIMITS.kpiCaption]).toEqual([e.id, true]);
        expect(copy.hasDash(caption)).toBe(false);
      }
      const summary = e.detail.summary ? e.detail.summary(f) : null;
      if (summary !== null) {
        expect([e.id, copy.longestSentence(summary) <= copy.LIMITS.sentence]).toEqual([e.id, true]);
        expect(copy.hasDash(summary)).toBe(false);
      }
    }
  });

  test("every card names a catalogued module, capability and masked field", () => {
    for (const e of kpi.CATALOG) {
      expect(catalog.isModule(e.module)).toBe(true);
      if (e.capability) expect(catalog.isCapability(e.capability)).toBe(true);
      if (e.sensitive_field) expect(fieldMask.isFieldKey(e.sensitive_field)).toBe(true);
    }
    const capabilityOf = Object.fromEntries(kpi.CATALOG.filter((e) => e.capability).map((e) => [e.id, e.capability]));
    expect(capabilityOf).toEqual({
      team_present: "home.team",
      team_on_site: "home.team",
      team_remote: "home.team",
      team_flags: "home.team",
      alerts_high_open: "alerts.clear",
    });
  });

  test("a person's own cards read the always-own `ess`, and the Team cards Home's own scope", () => {
    for (const e of kpi.CATALOG.filter((x) => x.id.startsWith("my_"))) expect([e.id, e.module]).toEqual([e.id, "ess"]);
    for (const e of kpi.CATALOG.filter((x) => x.id.startsWith("team_"))) {
      expect([e.id, e.module, e.pickable]).toEqual([e.id, "home", false]);
    }
  });

  test("live cards have a value and records; hidden ones carry no query and name their milestone", () => {
    for (const e of LIVE) {
      expect(typeof e.value).toBe("function");
      expect(typeof e.detail.list).toBe("function");
    }
    expect(HIDDEN.map((e) => [e.id, e.until])).toEqual([
      ["goals_on_track", "M2"],
      ["my_targets_on_track", "M2"],
      ["payroll_run_state", "M6"],
    ]);
    for (const e of HIDDEN) {
      expect(e.value).toBeUndefined();
      expect(e.caption).toBeUndefined();
      expect(e.detail).toBeUndefined();
    }
    expect(kpi.BY_ID.get("payroll_run_state").sensitive_field).toBe("employee.salary");
  });

  test("the cards are frozen, so nothing changes one after the check", () => {
    expect(Object.isFrozen(kpi.CATALOG)).toBe(true);
    for (const e of kpi.CATALOG) expect(Object.isFrozen(e)).toBe(true);
  });
});

describe("the check every card passes", () => {
  test("a valid card passes", () => {
    expect(() => shared.assertEntry(validCard())).not.toThrow();
  });

  test.each([
    ["a live card with no value", (e) => delete e.value, /a live card needs value\(\)/],
    ["a live card with no records", (e) => delete e.detail, /a live card needs its detail/],
    ["records with no list", (e) => delete e.detail.list, /detail\.list must be a function/],
    ["a hidden card with a query", (e) => Object.assign(e, { status: "hidden", until: "M2" }), /a hidden card has no value/],
    ["a hidden card with no milestone", (e) => Object.assign(e, { status: "hidden", value: undefined, detail: undefined }), /names the milestone/],
    ["a live card with a milestone", (e) => Object.assign(e, { until: "M2" }), /a live card has no "until"/],
    ["a title over four words", (e) => Object.assign(e, { label: "One Two Three Four Five" }), /over 4 words/],
    ["a title with a dash", (e) => Object.assign(e, { label: "Tasks \u2014 Overdue" }), /has a dash/],
    ["a module nobody declared", (e) => Object.assign(e, { module: "finance" }), /not a module of the access catalogue/],
    ["a capability nobody declared", (e) => Object.assign(e, { capability: "home.everything" }), /not in CAPABILITY_CATALOG/],
    ["a field the mask does not know", (e) => Object.assign(e, { sensitive_field: "employee.shoe_size" }), /not a field-mask key/],
    ["a tone the screen does not draw", (e) => Object.assign(e, { tone: "orange" }), /not a screen tone/],
    ["a source that is neither built nor an adapter", (e) => Object.assign(e, { source: "crm" }), /neither a built module/],
    ["an unknown unit", (e) => Object.assign(e, { unit: "ratio" }), /unknown unit/],
    ["an unknown domain", (e) => Object.assign(e, { domain: "money" }), /unknown domain/],
    ["an id that is not a key", (e) => Object.assign(e, { id: "Head Count" }), /must match/],
    [
      "three columns on a phone besides the first",
      (e) => {
        e.detail.columns = ["a", "b", "c", "d"].map((k) => ({ key: k, label: "Name", phone: true }));
      },
      /at most 2 columns besides the first/,
    ],
    ["a chip over three words", (e) => (e.detail.groups = [{ value: "late", label: "Late By More Than" }]), /over 3 words/],
    ["a column twice", (e) => (e.detail.columns = [{ key: "a", label: "A" }, { key: "a", label: "B" }]), /column "a" twice/],
  ])("refuses %s", (_name, breakIt, message) => {
    const e = validCard();
    breakIt(e);
    expect(() => shared.assertEntry(e)).toThrow(message);
  });

  test("lists every problem at once, not the first", () => {
    const e = Object.assign(validCard(), { module: "finance", tone: "orange", label: "" });
    expect(() => shared.assertEntry(e)).toThrow(/label is missing[\s\S]*not a module[\s\S]*not a screen tone/);
  });

  test("a half-defined card stops the require, so a broken catalogue never boots", () => {
    const half = { ...validCard(), id: "half_card", domain: "finance" };
    delete half.value;
    withCards("finance", [half], () =>
      expect(() => require("./kpi-catalog")).toThrow(/half_card: a live card needs value\(\)/),
    );
  });

  test("an id declared twice, or filed under another domain, stops the require", () => {
    const twice = { ...validCard(), id: "headcount", domain: "work" };
    const astray = { ...validCard(), id: "astray_card", domain: "people" };
    withCards("work", [twice, astray], () =>
      expect(() => require("./kpi-catalog")).toThrow(
        /"headcount" is declared twice[\s\S]*astray_card: domain "people" is filed in tiles\/work\.js/,
      ),
    );
  });

  test("the adapters it names are the files in sources/", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const files = fs
      .readdirSync(path.join(__dirname, "sources"))
      .filter((f) => f.endsWith(".source.js"))
      .map((f) => f.replace(/\.source\.js$/, ""));
    expect([...shared.ADAPTERS].sort()).toEqual(files.sort());
  });
});

/* ------------------------------------------------------------------ *
 * Guards: zero is a figure, failure is absence
 * ------------------------------------------------------------------ */

describe("the guards", () => {
  const g = guards.forCard("test_card");
  const boom = () => Promise.reject(new Error("relation gone"));

  test("a count of 0 is a figure; a bigint string and a NULL count are whole numbers", async () => {
    expect(await g.count(() => 0)).toEqual({ value: 0 });
    expect(await g.count(() => "12")).toEqual({ value: 12 });
    expect(await g.count(() => null)).toEqual({ value: 0 });
  });

  test("a read that fails answers null, logs the card, and never throws", async () => {
    const warn = jest.spyOn(logger, "warn");
    expect(await g.count(boom)).toBeNull();
    expect(await g.ratio(boom)).toBeNull();
    expect(await g.money(boom)).toBeNull();
    expect(await g.figure(boom)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[0][0]).toMatchObject({ kpi: "test_card" });
  });

  test("a count that is not a whole number is a defect, not a figure", async () => {
    jest.spyOn(logger, "warn");
    expect(await g.count(() => -1)).toBeNull();
    expect(await g.count(() => 2.5)).toBeNull();
  });

  test("a ratio keeps what it is out of, and keeps its other facts", async () => {
    expect(await g.ratio(() => ({ value: null, denominator: "0", late: 1 }))).toEqual({ value: 0, denominator: 0, late: 1 });
    expect(await g.ratio(() => ({ value: 22, denominator: 25 }))).toEqual({ value: 22, denominator: 25 });
  });

  test("money is a Naira wire string, never a number, and a NULL sum is 0.00", async () => {
    expect(await g.money(() => ({ amount: "1250000.5", requests: 2 }))).toEqual({ amount: "1250000.50", requests: 2 });
    expect(await g.money(() => ({ amount: null }))).toEqual({ amount: "0.00" });
    const f = await g.money(() => ({ amount: "0" }));
    expect(typeof f.amount).toBe("string");
  });
});

/* ------------------------------------------------------------------ *
 * Reading figures
 * ------------------------------------------------------------------ */

describe("figures", () => {
  const scopes = new Map(kpi.MODULES.map((m) => [m, { scope: "all", scope_ids: null, employee_id: ID }]));
  const ctx = kpi.context({
    user: { user_id: ID, employee_id: ID, role_ids: [], is_ceo: false },
    scopes,
    today: "2026-10-14",
  });

  test("context: today and now in Lagos, and a scope only for a module the reader may view", () => {
    const now = new Date("2026-10-13T23:30:00Z");
    const c2 = kpi.context({ user: {}, scopes: new Map([["people", scopes.get("people")]]), now });
    expect(c2.today).toBe("2026-10-14");
    expect(c2.scope("people")).toEqual(scopes.get("people"));
    expect(() => c2.scope("payroll")).toThrow(/no view on "payroll"/);
  });

  test("against a dead database every live card answers null, one by one, and nothing throws", async () => {
    jest.spyOn(logger, "warn");
    jest.spyOn(workflow, "mineCount").mockRejectedValue(new Error("down"));
    const dead = { query: () => Promise.reject(new Error("down")) };
    const figures = await kpi.figuresFor(dead, kpi.LIVE_IDS, ctx);
    expect(Object.keys(figures)).toEqual(kpi.LIVE_IDS);
    for (const id of kpi.LIVE_IDS) expect([id, figures[id]]).toEqual([id, null]);
  });

  test("a hidden card answers null and an unknown id is left out; neither reads anything", async () => {
    const query = jest.fn();
    const figures = await kpi.figuresFor({ query }, ["goals_on_track", "no_such_card", "goals_on_track"], ctx);
    expect(figures).toEqual({ goals_on_track: null });
    expect(query).not.toHaveBeenCalled();
  });

  test("a figure of the wrong shape for its unit is left out, and logged", async () => {
    const warn = jest.spyOn(logger, "warn");
    const card = (unit, figure) => ({ id: "test_card", status: "live", unit, value: async () => figure });
    expect(await kpi.figureOf(card("count", { value: -2 }), {}, ctx)).toBeNull();
    expect(await kpi.figureOf(card("pair", { value: 2 }), {}, ctx)).toBeNull();
    expect(await kpi.figureOf(card("money", { amount: 12.5 }), {}, ctx)).toBeNull();
    expect(await kpi.figureOf(card("money", { amount: "12.50" }), {}, ctx)).toEqual({ amount: "12.50" });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  test("a card with nothing to count answers null without a failure (My Leave Left with no allowance)", async () => {
    const warn = jest.spyOn(logger, "warn");
    const card = { id: "test_card", status: "live", unit: "days", value: (_c, g) => g.figure(async () => null) };
    expect(await kpi.figureOf(card, {}, ctx)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * The wire: cards, options, records
 * ------------------------------------------------------------------ */

describe("shapes on the wire", () => {
  test("every live card, every option and every records' meta parse with the contract", () => {
    for (const e of LIVE) {
      const f = sampleFigure(e);
      expect(dashboard.HomeKpiCard.parse(kpi.cardOf(e, f))).toBeTruthy();
      expect(dashboard.HomeKpiOption.parse(kpi.optionOf(e))).toBeTruthy();
      expect(dashboard.HomeKpiDetailMeta.parse(kpi.metaOf(e, f))).toBeTruthy();
      expect(dashboard.HomeKpiDetailMeta.parse(kpi.metaOf(e, null))).toBeTruthy();
    }
  });

  test("a zero is drawn and takes no tone; above zero the card's tone shows", () => {
    const overdue = kpi.BY_ID.get("tasks_overdue");
    expect(kpi.cardOf(overdue, { value: 0 })).toMatchObject({ value: 0, tone: null, measurable: true });
    expect(kpi.cardOf(overdue, { value: 3 })).toMatchObject({ value: 3, tone: "warn" });
  });

  test("a ratio keeps what it is out of; over nothing it is not measurable", () => {
    const att = kpi.BY_ID.get("attendance_today");
    expect(kpi.cardOf(att, { value: 0, denominator: 30, late: 0 })).toMatchObject({
      value: 0,
      denominator: 30,
      measurable: true,
      caption: null,
    });
    expect(kpi.cardOf(att, { value: 0, denominator: 0, late: 0 })).toMatchObject({ denominator: 0, measurable: false });
    expect(kpi.cardOf(att, { value: 20, denominator: 25, late: 4 }).caption).toBe("4 late");
  });

  test("money is an amount string with no value; a zero sum takes no tone", () => {
    const pending = kpi.BY_ID.get("expenses_pending");
    expect(kpi.cardOf(pending, { amount: "1000.50", requests: 1 })).toMatchObject({
      value: null,
      amount: "1000.50",
      denominator: null,
      caption: "1 request",
    });
    expect(kpi.cardOf(pending, { amount: "0.00", requests: 0 }).caption).toBe("0 requests");
  });

  test("the chips are counted from the figure, an absent count is 0, and the line needs a figure", () => {
    const att = kpi.BY_ID.get("attendance_today");
    const meta = kpi.metaOf(att, { value: 2, denominator: 3, groups: { on_site: 1, late: 1 } });
    expect(meta.summary).toBe("2 of 3 clocked in");
    expect(meta.groups.map((g) => [g.value, g.count])).toEqual([
      ["on_site", 1],
      ["remote", 0],
      ["late", 1],
      ["not_in", 0],
      ["on_leave", 0],
      ["no_clock_out_yesterday", 0],
    ]);
    expect(kpi.metaOf(att, null).summary).toBeNull();
    expect(meta.columns[0]).toEqual({ key: "employee", label: "Employee", numeric: false, phone: false });
  });

  test("records are asked for by one of the card's own chips, else refused", async () => {
    const att = kpi.BY_ID.get("tasks_overdue");
    await expect(kpi.detailPage(att, {}, { group: "late" }, {})).rejects.toMatchObject({
      code: "KPI_GROUP_UNKNOWN",
      status: 422,
    });
  });

  test("the cells: Naira as money, another currency as written, nothing as null", () => {
    expect(shared.cell.money("12.50", "NGN")).toEqual({ kind: "money", amount: "12.50" });
    expect(shared.cell.money("12.50", "USD")).toEqual({ kind: "text", text: "USD 12.50" });
    expect(shared.cell.money(null, "NGN")).toBeNull();
    expect(shared.cell.text("")).toBeNull();
    expect(shared.cell.time(new Date("2026-10-14T08:05:00Z"))).toEqual({ kind: "time", at: "2026-10-14T08:05:00.000Z" });
    expect(shared.cell.date(null)).toBeNull();
    for (const cell of [shared.cell.pill("ok", "On Site"), shared.cell.number(3), shared.cell.date("2026-10-14")])
      expect(dashboard.HomeKpiCell.parse(cell)).toEqual(cell);
  });

  test("a day of My Attendance counts as the attendance module recorded it, as the roster's totals do", () => {
    const today = "2026-10-14";
    const day = (date, status, day_status) => ({ date, status, day_status });
    expect(outcomeOf(day("2026-10-12", "on_site", "present"), today)).toBe("on_time");
    expect(outcomeOf(day("2026-10-12", "remote", "present"), today)).toBe("on_time");
    expect(outcomeOf(day("2026-10-12", "late", "late"), today)).toBe("late");
    expect(outcomeOf(day("2026-10-12", "absent", "absent"), today)).toBe("absent");
    expect(outcomeOf(day("2026-10-12", "on_leave", "leave"), today)).toBe("on_leave");
    // Not yet closed, or leave not yet recorded: nothing until the day-close writes the day.
    expect(outcomeOf(day("2026-10-12", "not_in", null), today)).toBeNull();
    expect(outcomeOf(day(today, "on_leave", null), today)).toBeNull();
    expect(outcomeOf(day("2026-10-11", null, null), today)).toBeNull();
    expect(outcomeOf(day("2026-10-15", "on_site", "present"), today)).toBeNull();
  });

  test("My Leave Left leads with Annual, else the first type with an allowance, as My Leave does", () => {
    const sick = { code: "sick", entitled: 12 };
    const unpaid = { code: "unpaid", entitled: null };
    const annual = { code: "annual", entitled: 20 };
    expect(leadBalance([unpaid, sick, annual])).toBe(annual);
    expect(leadBalance([unpaid, sick])).toBe(sick);
    expect(leadBalance([unpaid])).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Eligibility
 * ------------------------------------------------------------------ */

describe("who may see a card", () => {
  const none = { viewable: new Set(), capabilities: new Set(), masked: new Set() };
  const liveOn = (module) => LIVE.filter((e) => e.module === module && !e.capability).map((e) => e.id);

  test("a module's view admits exactly its cards without a capability", () => {
    const ids = eligibility.eligibleIds({ ...none, viewable: new Set(["people"]) });
    expect([...ids].sort()).toEqual(liveOn("people").sort());
  });

  test("no grant admits nothing, and the CEO every live card", () => {
    expect(eligibility.eligibleIds(none).size).toBe(0);
    expect([...eligibility.eligibleIds({ ...none, ceo: true })]).toEqual(kpi.LIVE_IDS);
  });

  test("a card with a capability needs it on top of the module", () => {
    const home = { ...none, viewable: new Set(["home"]) };
    expect(eligibility.eligibleIds(home).has("team_present")).toBe(false);
    expect(eligibility.eligibleIds(home).has("approvals_awaiting_you")).toBe(true);
    const manager = { ...home, capabilities: new Set(["home.team", "alerts.clear"]) };
    const ids = eligibility.eligibleIds(manager);
    for (const id of ["team_present", "team_on_site", "team_remote", "team_flags", "alerts_high_open"])
      expect(ids.has(id)).toBe(true);
    expect(eligibility.eligibleIds({ ...none, capabilities: new Set(["home.team"]) }).has("team_present")).toBe(false);
  });

  test("a hidden card is never eligible, whoever reads", () => {
    const everything = { viewable: new Set(catalog.MODULES), capabilities: new Set(catalog.CAPABILITIES), masked: new Set() };
    for (const e of HIDDEN) expect(eligibility.eligibleIds(everything).has(e.id)).toBe(false);
  });

  test("a masked field hides the whole card rather than zeroing it; the CEO is never masked", () => {
    const payrollLive = {
      ...validCard(),
      id: "payroll_live",
      domain: "finance",
      module: "payroll",
      sensitive_field: "employee.salary",
    };
    withCards("finance", [payrollLive], () => {
      const isolated = require("./kpi-catalog/eligibility");
      const payroll = { ...none, viewable: new Set(["payroll"]) };
      expect(isolated.eligibleIds(payroll).has("payroll_live")).toBe(true);
      expect(isolated.eligibleIds({ ...payroll, masked: new Set(["employee.salary"]) }).has("payroll_live")).toBe(false);
      expect(isolated.eligibleIds({ ...none, masked: new Set(["employee.salary"]), ceo: true }).has("payroll_live")).toBe(true);
    });
  });

  test("a person: their view grants with the scope of each, their capabilities and their masks", async () => {
    const team = { scope: "team", scope_ids: [ID], employee_id: ID };
    const own = { scope: "own", scope_ids: [ID], employee_id: ID };
    const grants = { home: team, people: team, ess: own, workspace: own };
    jest.spyOn(rbac, "scopeFor").mockImplementation(async (_user, module) => grants[module] || null);
    jest.spyOn(grantsCache, "getCapabilities").mockResolvedValue(["home.team"]);
    jest.spyOn(fieldMask, "maskedKeysFor").mockResolvedValue([]);
    const user = { user_id: ID, employee_id: ID, role_ids: [ID], is_ceo: false };
    const { eligible, scopes } = await eligibility.forUser({}, user);
    expect([...scopes.keys()].sort()).toEqual(["ess", "home", "people", "workspace"]);
    expect(scopes.get("people")).toBe(team);
    expect(eligible.has("headcount")).toBe(true);
    expect(eligible.has("team_present")).toBe(true);
    expect(eligible.has("my_leave_left")).toBe(true);
    expect(eligible.has("tasks_overdue")).toBe(true);
    expect(eligible.has("alerts_high_open")).toBe(false);
    expect(eligible.has("vacancies_open")).toBe(false);
    expect(rbac.scopeFor).toHaveBeenCalledWith(user, "people", "view");
  });

  test("the CEO: every live card, and no capability or mask is read", async () => {
    const all = { scope: "all", scope_ids: null, employee_id: ID };
    jest.spyOn(rbac, "scopeFor").mockResolvedValue(all);
    const caps = jest.spyOn(grantsCache, "getCapabilities");
    const masks = jest.spyOn(fieldMask, "maskedKeysFor");
    const { eligible, scopes } = await eligibility.forUser({}, { user_id: ID, employee_id: ID, role_ids: [], is_ceo: true });
    expect([...eligible]).toEqual(kpi.LIVE_IDS);
    expect(scopes.size).toBe(kpi.MODULES.length);
    expect(caps).not.toHaveBeenCalled();
    expect(masks).not.toHaveBeenCalled();
  });

  test("a role: its own view rows, capabilities and masks", async () => {
    const rows = {
      permission: [{ module_key: "home" }, { module_key: "people" }],
      capability: [{ code: "home.team" }],
      field_visibility: [],
    };
    const client = {
      query: jest.fn(async (sql) => ({ rows: rows[/FROM (\w+)/.exec(sql)[1]] || rows.capability })),
    };
    const ids = await eligibility.forRole(client, ID);
    expect(ids.has("team_flags")).toBe(true);
    expect(ids.has("headcount")).toBe(true);
    expect(ids.has("my_leave_left")).toBe(false);
    for (const [, params] of client.query.mock.calls) expect(params).toEqual([ID]);
  });
});

/* ------------------------------------------------------------------ *
 * Resolution: which cards show
 * ------------------------------------------------------------------ */

describe("which cards a person's Overview shows", () => {
  const everything = new Set(kpi.LIVE_IDS);
  const without = (...ids) => new Set(kpi.LIVE_IDS.filter((id) => !ids.includes(id)));
  const role = (defaults, locked = []) => ({ default_ids: defaults, locked_ids: locked });

  test("the defaults by Home view are D5's, exactly", () => {
    expect(resolve.HOME_VIEW_DEFAULTS).toEqual({
      operations: ["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active", "headcount"],
      ceo: ["goals_on_track", "approvals_awaiting_you", "partnerships_signed_value", "alerts_high_open", "attendance_today"],
      partnerships: ["partnerships_active", "partnerships_signed_value", "partnerships_quiet_30d", "proposals_out"],
      staff: ["my_targets_on_track", "my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "my_leave_left"],
    });
    expect(Object.keys(resolve.HOME_VIEW_DEFAULTS).sort()).toEqual([...c.identity.HomeView.options].sort());
  });

  test.each([
    [
      "no pick, no role cards: the Home view's, in order",
      { picks: null, roleCards: [], homeView: "operations", eligible: everything },
      { source: "view", ids: ["attendance_today", "tasks_overdue", "expenses_pending", "partnerships_active"] },
    ],
    [
      "the CEO's view: a card hidden until M2 is skipped and the fifth fills its place",
      { picks: null, roleCards: [], homeView: "ceo", eligible: everything },
      { source: "view", ids: ["approvals_awaiting_you", "partnerships_signed_value", "alerts_high_open", "attendance_today"] },
    ],
    [
      "Staff: My Targets waits for M2, My Leave Left fills the row",
      { picks: null, roleCards: [], homeView: "staff", eligible: everything },
      { source: "view", ids: ["my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "my_leave_left"] },
    ],
    [
      "a view's card the reader may not see is not substituted: the row shrinks",
      { picks: null, roleCards: [], homeView: "partnerships", eligible: without("proposals_out") },
      { source: "view", ids: ["partnerships_active", "partnerships_signed_value", "partnerships_quiet_30d"] },
    ],
    [
      "role cards beat the view",
      { picks: undefined, roleCards: [role(["headcount", "leave_pending"])], homeView: "operations", eligible: everything },
      { source: "role", ids: ["headcount", "leave_pending"] },
    ],
    [
      "several roles: joined highest rank first, each card once, four at most",
      {
        picks: null,
        roleCards: [role(["headcount", "leave_pending"]), role(["leave_pending", "tasks_overdue", "proposals_out", "reviews_due"])],
        homeView: "staff",
        eligible: everything,
      },
      { source: "role", ids: ["headcount", "leave_pending", "tasks_overdue", "proposals_out"] },
    ],
    [
      "role cards the reader may not see fall through to the view",
      { picks: null, roleCards: [role(["headcount"])], homeView: "partnerships", eligible: without("headcount") },
      { source: "view", ids: ["partnerships_active", "partnerships_signed_value", "partnerships_quiet_30d", "proposals_out"] },
    ],
    [
      "the person's pick beats their roles'",
      { picks: ["proposals_out"], roleCards: [role(["headcount"])], homeView: "operations", eligible: everything },
      { source: "user", ids: ["proposals_out"] },
    ],
    [
      "an empty pick is a choice: no cards, not the roles' back",
      { picks: [], roleCards: [role(["headcount"])], homeView: "operations", eligible: everything },
      { source: "user", ids: [] },
    ],
    [
      "locked cards lead the person's own pick",
      {
        picks: ["proposals_out", "headcount"],
        roleCards: [role(["headcount", "leave_pending"], ["leave_pending"])],
        homeView: "operations",
        eligible: everything,
      },
      { source: "user", ids: ["leave_pending", "proposals_out", "headcount"] },
    ],
    [
      "locked cards lead even an empty pick",
      { picks: [], roleCards: [role(["leave_pending"], ["leave_pending"])], homeView: "operations", eligible: everything },
      { source: "user", ids: ["leave_pending"] },
    ],
    [
      "every role's locks lead, in role order, then the rest, four at most",
      {
        picks: null,
        roleCards: [role(["headcount", "tasks_overdue"], ["tasks_overdue"]), role(["proposals_out", "reviews_due", "leave_pending"], ["reviews_due"])],
        homeView: "operations",
        eligible: everything,
      },
      { source: "role", ids: ["tasks_overdue", "reviews_due", "headcount", "proposals_out"] },
    ],
    [
      "locks lead the view's defaults too",
      { picks: null, roleCards: [role([], ["headcount"])], homeView: "partnerships", eligible: everything },
      { source: "view", ids: ["headcount", "partnerships_active", "partnerships_signed_value", "partnerships_quiet_30d"] },
    ],
    [
      "a lock the reader may not see is dropped, never shown",
      { picks: ["proposals_out"], roleCards: [role(["headcount"], ["headcount"])], homeView: "operations", eligible: without("headcount") },
      { source: "user", ids: ["proposals_out"] },
    ],
    [
      "a pick that lost its grant drops out and the next survives",
      { picks: ["headcount", "proposals_out", "reviews_due"], roleCards: [], homeView: "staff", eligible: without("headcount") },
      { source: "user", ids: ["proposals_out", "reviews_due"] },
    ],
    [
      "junk, repeats, hidden and Team cards in a pick are dropped",
      {
        picks: ["headcount", 7, null, "headcount", "no_such_card", "goals_on_track", "team_present", "proposals_out"],
        roleCards: [],
        homeView: "staff",
        eligible: everything,
      },
      { source: "user", ids: ["headcount", "proposals_out"] },
    ],
    [
      "never more than four",
      {
        picks: ["headcount", "leave_pending", "tasks_overdue", "proposals_out", "reviews_due"],
        roleCards: [role(["vacancies_open"], ["vacancies_open"])],
        homeView: "staff",
        eligible: everything,
      },
      { source: "user", ids: ["vacancies_open", "headcount", "leave_pending", "tasks_overdue"] },
    ],
    [
      "nothing the reader may see: an empty row",
      { picks: null, roleCards: [role(["headcount"])], homeView: "operations", eligible: new Set() },
      { source: "view", ids: [] },
    ],
    [
      "a Home view that has no defaults: none",
      { picks: null, roleCards: [], homeView: null, eligible: everything },
      { source: "view", ids: [] },
    ],
  ])("%s", (_name, input, expected) => {
    expect(resolve.selectCards(input)).toEqual(expected);
  });

  test("paint: a zero is painted; a card with no figure is left out and named, in order", () => {
    const { cards, hidden } = resolve.paintCards(["tasks_overdue", "headcount", "proposals_out"], {
      tasks_overdue: { value: 0 },
      headcount: null,
      proposals_out: { value: 2 },
    });
    expect(cards.map((card) => [card.key, card.value])).toEqual([
      ["tasks_overdue", 0],
      ["proposals_out", 2],
    ]);
    expect(hidden).toEqual(["headcount"]);
    for (const card of cards) expect(dashboard.HomeKpiCard.parse(card)).toEqual(card);
  });

  test("a role's view defaults, as the role may see them", () => {
    expect(resolve.viewDefaults("staff", everything)).toEqual(["my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "my_leave_left"]);
    expect(resolve.viewDefaults("operations", without("tasks_overdue"))).toEqual([
      "attendance_today",
      "expenses_pending",
      "partnerships_active",
      "headcount",
    ]);
    expect(resolve.viewDefaults("__proto__", everything)).toEqual([]);
  });
});

describe("the card picker", () => {
  const staff = new Set(["my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "my_leave_left", "team_present", "proposals_out"]);

  test("offers only the cards the person may choose, in the catalogue's order, and parses", () => {
    const model = resolve.pickerModel({ picks: null, roleCards: [], homeView: "staff", eligible: staff });
    expect(model.cards.map((o) => o.key)).toEqual(
      kpi.PICKABLE_IDS.filter((id) => staff.has(id) && id !== "team_present"),
    );
    expect(model).toMatchObject({ max: 4, kpi_ids: null, source: "view", locked_ids: [] });
    expect(model.default_ids).toEqual(["my_tasks_overdue", "my_reviews_due", "my_attendance_30d", "my_leave_left"]);
    expect(model.showing_ids).toEqual(model.default_ids);
    expect(dashboard.HomeKpiPicker.parse(model)).toEqual(model);
  });

  test("their own pick as it stands, what they would see without it, and the locks", () => {
    const model = resolve.pickerModel({
      picks: ["proposals_out", "headcount", "my_leave_left"],
      roleCards: [{ default_ids: ["my_reviews_due"], locked_ids: ["my_reviews_due"] }],
      homeView: "staff",
      eligible: staff,
    });
    expect(model.kpi_ids).toEqual(["proposals_out", "my_leave_left"]);
    expect(model.default_ids).toEqual(["my_reviews_due"]);
    expect(model.locked_ids).toEqual(["my_reviews_due"]);
    expect(model.showing_ids).toEqual(["my_reviews_due", "proposals_out", "my_leave_left"]);
    expect(model.source).toBe("user");
    expect(dashboard.HomeKpiPicker.parse(model)).toEqual(model);
  });

  test("an empty pick stays an empty pick", () => {
    const model = resolve.pickerModel({ picks: [], roleCards: [], homeView: "staff", eligible: staff });
    expect(model).toMatchObject({ kpi_ids: [], showing_ids: [], source: "user" });
  });
});
