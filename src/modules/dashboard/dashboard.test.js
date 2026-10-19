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
      ["field", 0],
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

/* ------------------------------------------------------------------ *
 * The Overview's routes, controller, layout and activity
 * ------------------------------------------------------------------ */

describe("the routes", () => {
  const { routesOf } = require("../../http/route");
  const routes = routesOf(require("./dashboard.routes").router);
  const find = (method, path) => routes.find((r) => r.method === method && r.path === path);

  test("mount at /home, and every one is the contract's", () => {
    expect(require("./dashboard.routes").basePath).toBe("/home");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /overview",
      "POST /overview/export",
      "GET /overview/export/:id",
      "GET /kpi-picker",
      "PUT /kpi-picks",
      "DELETE /kpi-picks",
      "GET /kpi/:key/meta",
      "GET /kpi/:key",
      "GET /team/summary",
      "GET /team/attendance",
      "GET /team",
      "GET /roles/:role_id/kpis",
      "PUT /roles/:role_id/kpis",
      "DELETE /roles/:role_id/kpis",
    ]);
    expect(find("GET", "/overview").contract.response).toBe(dashboard.HomeOverview);
    // The Overview Export is a run of the reports engine, in the reports contract.
    expect(find("POST", "/overview/export").contract).toMatchObject({
      body: c.reports.HomeReportRunNow,
      response: c.reports.HomeReportRun,
    });
    // The screen that pressed Export waits on its own run here, with no `home.reports` to ask Reports.
    expect(find("GET", "/overview/export/:id").contract).toMatchObject({
      params: c.common.IdParams,
      response: c.reports.HomeReportRun,
    });
    expect(find("GET", "/overview/export/:id").capability).toBeNull();
    expect(find("GET", "/team/summary").contract.response).toBe(dashboard.HomeTeamSummary);
    expect(find("GET", "/team").contract).toMatchObject({ query: dashboard.HomeTeamQuery, response: dashboard.HomeTeamPage });
    expect(find("GET", "/team/attendance").contract).toMatchObject({
      query: dashboard.HomeTeamAttendanceQuery,
      response: dashboard.HomeTeamAttendancePage,
    });
    expect(find("PUT", "/kpi-picks").contract.body).toBe(dashboard.HomeKpiPicks);
    expect(find("PUT", "/roles/:role_id/kpis").contract.body).toBe(dashboard.HomeRoleKpisSave);
    for (const r of routes.filter((x) => x.method === "DELETE")) expect(r.contract.no_content).toBe(true);
  });

  test("Home's own behind `home` view, a role's cards behind `settings`", () => {
    for (const r of routes) {
      const expected = r.path.startsWith("/roles/")
        ? { key: "settings", action: r.method === "GET" ? "view" : "edit" }
        : { key: "home", action: "view" };
      expect([r.method, r.path, r.permission]).toEqual([r.method, r.path, expected]);
    }
  });

  test("the Team tab, and only it, also needs `home.team`, checked after the grant that sets its scope", () => {
    for (const r of routes) {
      const expected = r.path === "/team" || r.path.startsWith("/team/") ? "home.team" : null;
      expect([r.method, r.path, r.capability]).toEqual([r.method, r.path, expected]);
    }
  });

  test("the Team tab's lists page at 25 through the contract's controls, and sort only as it allows", () => {
    for (const path of ["/team", "/team/attendance"]) {
      const { query } = find("GET", path).contract;
      expect([path, Object.keys(query.shape)]).toEqual([path, expect.arrayContaining(["page", "q", "sort", "department_id"])]);
      expect(query.safeParse({ limit: "100" }).success).toBe(false);
    }
    expect(Object.keys(find("GET", "/team").contract.query.shape)).toEqual(
      expect.arrayContaining(["status", "no_clock_out_yesterday"]),
    );
    expect(dashboard.HomeTeamQuery.safeParse({ sort: "-clock_in_at" }).success).toBe(true);
    expect(dashboard.HomeTeamQuery.safeParse({ sort: "status" }).success).toBe(false);
    expect(dashboard.HomeTeamAttendanceQuery.safeParse({ sort: "-on_time" }).success).toBe(true);
    expect(dashboard.HomeTeamAttendanceQuery.safeParse({ status: "late" }).success).toBe(false);
  });

  test("a card's records are paged at 25 through the contract's controls, and /meta is defined first", () => {
    const list = find("GET", "/kpi/:key");
    expect(list.contract.params).toBe(dashboard.HomeKpiParams);
    expect(list.contract.response).toBe(dashboard.HomeKpiDetailPage);
    expect(Object.keys(list.contract.query.shape)).toEqual(expect.arrayContaining(["page", "q", "group"]));
    const at = (path) => routes.findIndex((r) => r.method === "GET" && r.path === path);
    expect(at("/kpi/:key/meta")).toBeLessThan(at("/kpi/:key"));
  });
});

describe("the controller", () => {
  const controller = require("./dashboard.controller");
  const service = require("./dashboard.service");

  const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => {
      res.statusCode = code;
      return res;
    });
    res.json = jest.fn((body) => {
      res.body = body;
      return res;
    });
    res.end = jest.fn(() => res);
    return res;
  };

  const page = () => ({
    data: [
      {
        id: ID,
        cells: { employee: { kind: "text", text: "Ada Obi" }, salary: { kind: "money", amount: "350000.00" } },
        link: null,
      },
    ],
    page: { number: 1, size: 25, total: 1, pages: 1, has_next: false },
  });

  const request = (user) => ({ user, validated: { params: { key: "headcount" }, query: { page: 1 } } });

  test("the records behind a card leave through the field mask", async () => {
    jest.spyOn(service, "kpiPage").mockResolvedValue(page());
    jest.spyOn(grantsCache, "getMaskedFieldKeys").mockResolvedValue(["employee.salary"]);
    const res = response();
    await controller.kpiPage(request({ user_id: ID, is_ceo: false }), res);
    expect(res.body.data[0].cells).toEqual({ employee: { kind: "text", text: "Ada Obi" }, salary: null });
    expect(dashboard.HomeKpiDetailPage.parse(res.body)).toEqual(res.body);
    expect(service.kpiPage).toHaveBeenCalledWith(expect.objectContaining({ user_id: ID }), "headcount", { page: 1 });
  });

  test("the CEO is never masked", async () => {
    jest.spyOn(service, "kpiPage").mockResolvedValue(page());
    const masks = jest.spyOn(grantsCache, "getMaskedFieldKeys").mockResolvedValue(["employee.salary"]);
    const res = response();
    await controller.kpiPage(request({ user_id: ID, is_ceo: true }), res);
    expect(res.body.data[0].cells.salary).toEqual({ kind: "money", amount: "350000.00" });
    expect(masks).not.toHaveBeenCalled();
  });

  test("going back to the roles' cards answers 204 with no body", async () => {
    const reset = jest.spyOn(service, "resetPicks").mockResolvedValue(undefined);
    const res = response();
    await controller.resetPicks({ user: { user_id: ID }, ip: "10.0.0.1" }, res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.json).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith({ user_id: ID, ip: "10.0.0.1" });
  });
});

describe("the sections of each Home view", () => {
  const layout = require("./dashboard.layout");
  const workingWeek = require("../../shared/time/working-week");
  const roster = require("../attendance/attendance.roster");
  const leaveService = require("../leave/leave.service");
  const cal = workingWeek.makeCalendar({
    days: [1, 2, 3, 4, 5, 6],
    holidays: [{ holiday_date: "2026-10-01", name: "Independence Day" }],
    hours: { 6: { starts_at: "09:00", ends_at: "15:00" } },
  });
  const all = { scope: "all", scope_ids: null, employee_id: ID };
  const user = { user_id: ID, employee_id: ID, role_ids: [], is_ceo: false };

  test("every Home view is laid out, and nothing else", () => {
    expect(Object.keys(layout.VIEWS).sort()).toEqual([...c.identity.HomeView.options].sort());
  });

  test("a quarter is the calendar's", () => {
    expect(layout.quarterOf("2026-10-14")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(layout.quarterOf("2026-02-28")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(layout.quarterOf("2026-06-30")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
  });

  test("the chart's 14 working days end today when it is worked, else on the last one; a holiday is skipped", () => {
    const wednesday = layout.attendanceDays("2026-10-14", cal);
    expect(wednesday.history).toHaveLength(layout.HISTORY_DAYS);
    expect(wednesday.history[13]).toBe("2026-10-14");
    expect(wednesday.history).not.toContain("2026-10-01");
    expect(wednesday.history).not.toContain("2026-10-11");
    expect(wednesday.history[0]).toBe("2026-09-28");
    expect(wednesday.month).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
    expect(layout.attendanceDays("2026-10-18", cal).history[13]).toBe("2026-10-17");
  });

  test("a section whose module the reader cannot view is null; Your Week is on every Overview", async () => {
    jest.spyOn(workingWeek, "loadCalendar").mockResolvedValue(cal);
    jest.spyOn(leaveService, "listFor").mockResolvedValue({ data: [] });
    const summary = jest.spyOn(roster, "summary");
    const sections = await layout.sectionsFor({ query: jest.fn() }, {
      user,
      view: "operations",
      today: "2026-10-14",
      scopes: new Map([["ess", all]]),
    });
    for (const key of ["clocked_in", "chart", "donut", "day_strip", "pipeline", "goals", "my_goals", "upcoming_leave"])
      expect([key, sections[key]]).toEqual([key, null]);
    expect(sections.week.map((day) => day.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
    ]);
    expect(sections.week[5]).toMatchObject({ starts_at: "09:00", ends_at: "15:00", holiday: null, items: [] });
    expect(summary).not.toHaveBeenCalled();
  });

  test("Your Week reads each working day's own page of events and tasks, Monday carrying the week before's", async () => {
    const calendar = require("./sources/calendar.source");
    const tasks = require("./sources/tasks.source");
    const lagos = require("../../shared/time/lagos");
    jest.spyOn(workingWeek, "loadCalendar").mockResolvedValue(cal);
    jest.spyOn(leaveService, "listFor").mockResolvedValue({ data: [] });
    const meeting = (date) => ({ calendar_event_id: ID, title: `Meeting ${date}`, starts_at: lagos.instant(date, "10:00"), all_day: false });
    const events = jest.spyOn(calendar, "eventsStarting").mockImplementation(async (_client, span) => ({
      data: [meeting(lagos.dateOf(span.from))],
    }));
    const due = jest.spyOn(tasks, "dueBetween").mockResolvedValue({ data: [] });
    const sections = await layout.sectionsFor({ query: jest.fn() }, {
      user,
      view: "staff",
      today: "2026-10-14",
      scopes: new Map([["workspace", all]]),
    });
    const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
    expect(events).toHaveBeenCalledTimes(days.length);
    expect(due).toHaveBeenCalledTimes(days.length);
    for (const [i, date] of days.entries()) {
      const span = { employee_id: ID, from: lagos.startOfDay(date), to: lagos.endOfDayExclusive(date) };
      expect(events).toHaveBeenNthCalledWith(i + 1, expect.anything(), { ...span, running: i === 0 }, { page: 1 });
      expect(due).toHaveBeenNthCalledWith(i + 1, expect.anything(), span, { page: 1 });
    }
    expect(sections.week.map((day) => day.items.map((item) => item.title))).toEqual(days.map((date) => [`Meeting ${date}`]));
  });

  test("a section whose read fails is logged and left null, and the others still answer", async () => {
    jest.spyOn(workingWeek, "loadCalendar").mockResolvedValue(cal);
    jest.spyOn(leaveService, "listFor").mockResolvedValue({ data: [] });
    jest.spyOn(roster, "summary").mockRejectedValue(new Error("connection reset"));
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const sections = await layout.sectionsFor({ query: jest.fn() }, {
      user,
      view: "operations",
      today: "2026-10-14",
      scopes: new Map([["people", all]]),
    });
    expect(sections).toMatchObject({ clocked_in: null, chart: null, donut: null });
    expect(sections.week).toHaveLength(6);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ part: "attendance" }), expect.any(String));
  });

  test("Staff draws its own day and none of the organisation's sections", () => {
    expect(layout.VIEWS.staff).toEqual({ day_strip: true, my_goals: true, upcoming_leave: true });
    for (const view of ["operations", "ceo", "partnerships"]) {
      expect([view, layout.VIEWS[view].day_strip]).toEqual([view, undefined]);
      expect([view, layout.VIEWS[view].pipeline]).toEqual([view, true]);
    }
    expect(layout.VIEWS.ceo.goals).toBeUndefined();
  });
});

describe("Activity Today", () => {
  const activity = require("./dashboard.activity");
  const scope = (s) => ({ scope: s, scope_ids: s === "all" ? null : [ID], employee_id: ID });

  test("an allow-list of keys from catalogued modules, with nothing private on it", () => {
    for (const [key, { module, reach }] of Object.entries(activity.ALLOWED)) {
      expect([key, catalog.isModule(module), ["person", "public"].includes(reach)]).toEqual([key, true, true]);
      expect(key).not.toMatch(/^(mail|mail_[a-z_]+|direct_[a-z_]+|auth|notification|channel_message|account)\./);
    }
    expect(activity.MODULES).toEqual(["people", "community"]);
  });

  test("only the modules the reader may view; a person's events follow their scope", () => {
    expect(activity.visibleWhere(new Map(), [])).toBeNull();

    const params = [];
    const where = activity.visibleWhere(new Map([["people", scope("team")]]), params);
    expect(where).toContain("se.employee_id = ANY(");
    expect(params).toEqual(["people", expect.arrayContaining(["employee.created", "leave_request.approved"]), [ID]]);
    expect(where).not.toContain("community");

    const open = [];
    const public_ = activity.visibleWhere(new Map([["community", scope("own")]]), open);
    expect(public_).not.toContain("se.employee_id");
    expect(open).toEqual(["community", ["recognition.posted", "celebration.posted"]]);
  });
});

describe("the Team tab", () => {
  const team = require("./dashboard.team");
  const roster = require("../attendance/attendance.roster");
  const TEAM = Object.freeze({ scope: "team", scope_ids: [ID], employee_id: ID });
  const NOW = new Date("2026-10-14T11:00:00Z");
  const db = { query: jest.fn() };
  const emptyPage = { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };
  const wire = (value) => JSON.parse(JSON.stringify(value));

  /** A roster row as attendance.roster.page() answers one. */
  const rosterRow = (patch = {}) => ({
    employee_id: ID,
    first_name: "Ada",
    last_name: "Obi",
    job_title: "Field Officer",
    department_id: "5f0e9c1c-7d4e-4d0a-9c8e-2b0a7e3f1a10",
    department: "Programmes",
    work_pattern: "on_site",
    status: "late",
    clock_in_at: new Date("2026-10-14T08:12:00Z"),
    clock_out_at: null,
    late_minutes: 12,
    worksite: "Head Office",
    no_clock_out_yesterday: true,
    flagged: true,
    ...patch,
  });

  /** A day's roster summary as attendance.roster.summary() answers one. */
  const daySummary = {
    date: "2026-10-14",
    working_day: true,
    expected: 5,
    present: 3,
    on_site: 1,
    remote: 1,
    late: 1,
    absent: 0,
    on_leave: 1,
    not_in: 1,
    no_clock_out_yesterday: 2,
    flagged: 2,
  };

  test("its cards are the catalogue's four Team cards, each a live `home` card behind `home.team`, never on the picker", () => {
    expect(team.CARDS).toEqual(["team_present", "team_on_site", "team_remote", "team_flags"]);
    expect(team.CAPABILITY).toBe("home.team");
    for (const id of team.CARDS)
      expect(kpi.BY_ID.get(id)).toMatchObject({ status: "live", module: "home", capability: "home.team", pickable: false });
    expect(catalog.isCapability(team.CAPABILITY)).toBe(true);
  });

  test("a Team card that leaves the tab's scope or its capability stops the require", () => {
    const drift = (change, message) => {
      try {
        jest.isolateModules(() => {
          jest.doMock("./kpi-catalog/tiles/people", () => {
            const real = jest.requireActual("./kpi-catalog/tiles/people");
            return { ...real, ENTRIES: change(real.ENTRIES) };
          });
          expect(() => require("./dashboard.team")).toThrow(message);
        });
      } finally {
        jest.dontMock("./kpi-catalog/tiles/people");
      }
    };
    const patch = (id, p) => (entries) => entries.map((e) => (e.id === id ? { ...e, ...p } : e));
    drift(patch("team_flags", { module: "people" }), /team_flags/);
    drift(patch("team_remote", { pickable: true }), /team_remote/);
    drift((entries) => entries.filter((e) => e.id !== "team_on_site"), /"team_on_site" is not in the KPI catalogue/);
  });

  test("the query's filters reach the roster on the day asked, the yes-or-no as a boolean", () => {
    expect(team.filtersOf({ status: "late", department_id: ID, q: "ada", no_clock_out_yesterday: "true" }, "2026-10-14")).toEqual({
      date: "2026-10-14",
      status: "late",
      department_id: ID,
      q: "ada",
      no_clock_out_yesterday: true,
    });
    expect(team.filtersOf({ no_clock_out_yesterday: "false" }, "2026-10-14").no_clock_out_yesterday).toBe(false);
    expect(team.filtersOf({}, "2026-10-14").no_clock_out_yesterday).toBeUndefined();
  });

  test("a roster row is a Team Roster row; KPI and Open Tasks stay null until M2", () => {
    const row = team.rowOf(rosterRow());
    expect(row).toMatchObject({
      employee: { employee_id: ID, display_name: "Ada Obi", job_title: "Field Officer", department: "Programmes" },
      status: "late",
      worksite: "Head Office",
      no_clock_out_yesterday: true,
      kpi_percent: null,
      open_tasks: null,
    });
    expect(dashboard.HomeTeamRow.parse(wire(row))).toEqual(wire(row));
    const month = team.monthRowOf({ ...rosterRow(), expected: 9, on_time: 6, late: 2, absent: 1, on_leave: 2 });
    expect(dashboard.HomeTeamAttendanceRow.parse(month)).toEqual(month);
    expect(month).toMatchObject({ expected: 9, on_time: 6, late: 2, absent: 1, on_leave: 2 });
  });

  test("the summary: the grant's scope and the four cards from one read of the roster, in that scope", async () => {
    const read = jest.spyOn(roster, "summary").mockResolvedValue(daySummary);
    const answer = await team.summary({ user_id: ID, employee_id: ID }, TEAM, { now: NOW, db });
    expect(dashboard.HomeTeamSummary.parse(answer)).toEqual(answer);
    expect(answer).toMatchObject({ date: "2026-10-14", scope: "team" });
    expect(answer.cards.map((card) => [card.key, card.value, card.denominator, card.caption])).toEqual([
      ["team_present", 3, 5, "1 on leave"],
      ["team_on_site", 1, null, null],
      ["team_remote", 1, null, null],
      ["team_flags", 2, null, "1 late, 2 no clock-out"],
    ]);
    expect(answer.cards[3].tone).toBe("warn");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(db, { date: "2026-10-14" }, TEAM);
  });

  test("Flags counts each person once, so someone late with no clock-out yesterday is one flag", async () => {
    jest.spyOn(roster, "summary").mockResolvedValue({ ...daySummary, late: 2, no_clock_out_yesterday: 2, flagged: 3 });
    const { cards } = await team.summary({ user_id: ID }, TEAM, { now: NOW, db });
    expect(cards.find((card) => card.key === "team_flags")).toMatchObject({ value: 3, caption: "2 late, 2 no clock-out" });
  });

  test("a roster that cannot be read leaves the cards out rather than showing zeros", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(roster, "summary").mockRejectedValue(new Error("relation gone"));
    const answer = await team.summary({ user_id: ID }, TEAM, { now: NOW, db });
    expect(answer).toEqual({ date: "2026-10-14", scope: "team", cards: [] });
    expect(warn).toHaveBeenCalledTimes(4);
  });

  test("the roster: today's page in the grant's scope, as the contract shapes it", async () => {
    const page = jest
      .spyOn(roster, "page")
      .mockResolvedValue({ data: [rosterRow()], page: { number: 2, size: 25, total: 26, pages: 2, has_next: false } });
    const query = { page: 2, status: "late", no_clock_out_yesterday: "true", sort: { field: "clock_in_at", dir: "desc" } };
    const answer = await team.roster(TEAM, query, { now: NOW, db });
    expect(dashboard.HomeTeamPage.parse(wire(answer))).toEqual(wire(answer));
    expect(answer.page.total).toBe(26);
    expect(page).toHaveBeenCalledWith(
      db,
      { date: "2026-10-14", status: "late", department_id: undefined, q: undefined, no_clock_out_yesterday: true },
      TEAM,
      query,
    );
  });

  test("Attendance This Month: from the 1st of this month in Lagos to today", async () => {
    const month = jest.spyOn(roster, "month").mockResolvedValue({
      data: [{ ...rosterRow(), expected: 9, on_time: 6, late: 2, absent: 1, on_leave: 2 }],
      page: { number: 1, size: 25, total: 1, pages: 1, has_next: false },
    });
    // 23:30 on the 31st, UTC, is already the 1st of November in Lagos.
    const answer = await team.month(TEAM, { department_id: ID }, { now: new Date("2026-10-31T23:30:00Z"), db });
    expect(dashboard.HomeTeamAttendancePage.parse(answer)).toEqual(answer);
    expect(month).toHaveBeenCalledWith(
      db,
      { from: "2026-11-01", to: "2026-11-01", department_id: ID, q: undefined },
      TEAM,
      { department_id: ID },
    );
  });

  test("the assistant: an empty page without `home.team`, the roster in the asker's scope with it, and the CEO always", async () => {
    const caps = jest.spyOn(grantsCache, "getCapabilities");
    const page = jest.spyOn(roster, "page").mockResolvedValue({ data: [rosterRow()], page: { ...emptyPage.page, total: 1, pages: 1 } });
    const actor = { user_id: ID, employee_id: ID, scope: TEAM };

    caps.mockResolvedValue(["alerts.clear"]);
    expect(await team.forAssistant(db, actor, { page: 1 }, { now: NOW })).toEqual(emptyPage);
    expect(page).not.toHaveBeenCalled();

    caps.mockResolvedValue(["home.team"]);
    const mine = await team.forAssistant(db, actor, { page: 1 }, { now: NOW });
    expect(mine.data.map((r) => r.employee.display_name)).toEqual(["Ada Obi"]);
    expect(page).toHaveBeenLastCalledWith(db, expect.objectContaining({ date: "2026-10-14" }), TEAM, { page: 1 });

    caps.mockClear();
    await team.forAssistant(db, { ...actor, is_ceo: true }, { page: 1 }, { now: NOW });
    expect(caps).not.toHaveBeenCalled();
  });

  test("over HTTP, each list reads in the route's scope and leaves through the field mask", async () => {
    const controller = require("./dashboard.controller");
    jest.spyOn(grantsCache, "getMaskedFieldKeys").mockResolvedValue([]);
    const list = jest.spyOn(team, "roster").mockResolvedValue({ data: [team.rowOf(rosterRow())], page: emptyPage.page });
    const month = jest.spyOn(team, "month").mockResolvedValue(emptyPage);
    const summary = jest.spyOn(team, "summary").mockResolvedValue({ date: "2026-10-14", scope: "team", cards: [] });
    const res = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() });
    const req = { user: { user_id: ID, employee_id: ID }, scope: "team", scope_ids: [ID], validated: { query: { page: 1 } } };

    const sent = res();
    await controller.team(req, sent);
    expect(list).toHaveBeenCalledWith(TEAM, { page: 1 });
    expect(sent.json.mock.calls[0][0].data[0].employee.display_name).toBe("Ada Obi");
    await controller.teamAttendance(req, res());
    expect(month).toHaveBeenCalledWith(TEAM, { page: 1 });
    await controller.teamSummary(req, res());
    expect(summary).toHaveBeenCalledWith(req.user, TEAM);
  });
});

describe("the prune, the assistant and ⌘K", () => {
  const outbox = require("../../shared/events/outbox");
  const events = require("./dashboard.events");
  const service = require("./dashboard.service");
  const { EVENTS: ACCESS } = require("../access/access.events");

  test("Home's events, and the prune registered after every access change that can hide a card", async () => {
    expect(events.EVENTS).toEqual({
      HOME_KPI_PICKS_CHANGED: "home.kpi_picks_changed",
      HOME_ROLE_KPIS_CHANGED: "home.role_kpis_changed",
    });
    expect(events.PRUNE_ON).toEqual([ACCESS.PERMISSION_CHANGED, ACCESS.FIELD_VISIBILITY_CHANGED, ACCESS.CAPABILITY_CHANGED]);
    const prune = jest.spyOn(service, "pruneRoleCards").mockResolvedValue(undefined);
    for (const key of events.PRUNE_ON) {
      const handler = outbox.handlersFor(key).find((h) => h.name === events.PRUNE_HANDLER);
      expect([key, Boolean(handler)]).toEqual([key, true]);
      await handler.fn({ key, payload: { role_id: ID, code: "manager" } });
    }
    expect(prune.mock.calls).toEqual([[ID], [ID], [ID]]);
  });

  test("the assistant reads the asker's own cards and their Team, and routes to Home's tabs; it writes nothing", () => {
    const manifest = require("./dashboard.ai");
    expect(manifest.module).toBe("home");
    expect(manifest.reads.map((r) => [r.key, r.permission, r.list])).toEqual([
      ["cards.mine", ["home", "view"], false],
      ["team.today", ["home", "view"], true],
    ]);
    expect(manifest.reads[0].params).toBe(c.common.EmptyBody);
    expect(manifest.reads[1].params).toBe(c.dashboard.HomeTeamQuery);
    expect(manifest.routes.map((route) => route.screen)).toEqual([
      "home.overview",
      "home.overview",
      "home.overview",
      "home.team",
    ]);
    for (const route of manifest.routes)
      if (route.params) expect([route.params.kpi, kpi.isPickable(route.params.kpi)]).toEqual([route.params.kpi, true]);
  });

  test("⌘K: the cards the reader may see, by title, paged at 25, opening the Overview on the card", async () => {
    const provider = require("./dashboard.search");
    const shown = new Set(["my_leave_left", "leave_pending", "team_present", "goals_on_track"]);
    jest.spyOn(eligibility, "forUser").mockResolvedValue({ eligible: shown, scopes: new Map() });
    const result = await provider.search({}, { term: "Leave", page: 1, user: { user_id: ID } });
    expect(result.items.map((i) => i.id)).toEqual(["leave_pending", "my_leave_left"]);
    expect(result.items[1]).toEqual({
      id: "my_leave_left",
      type: "home_kpi",
      ref: null,
      title: "My Leave Left",
      sub: null,
      status: null,
      link: "/home?tab=overview&id=my_leave_left",
    });
    expect(result.page).toMatchObject({ number: 1, size: 25, total: 2, has_next: false });
    // A Team card belongs to its tab, and a hidden one to M2: neither is found.
    expect((await provider.search({}, { term: "present", page: 1, user: {} })).items).toEqual([]);
    expect((await provider.search({}, { term: "goals", page: 1, user: {} })).items).toEqual([]);
  });

  test("⌘K pages the whole catalogue at 25", async () => {
    const provider = require("./dashboard.search");
    jest.spyOn(eligibility, "forUser").mockResolvedValue({ eligible: new Set(kpi.LIVE_IDS), scopes: new Map() });
    const first = await provider.search({}, { term: "", page: 1, user: {} });
    const second = await provider.search({}, { term: "", page: 2, user: {} });
    expect(first.items).toHaveLength(Math.min(25, kpi.PICKABLE_IDS.length));
    expect(first.page.total).toBe(kpi.PICKABLE_IDS.length);
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual([...kpi.PICKABLE_IDS]);
  });
});
