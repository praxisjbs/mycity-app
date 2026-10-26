"use strict";
/**
 * Policies: the pure rules (docs/guides/policies.md §6). Publishing, approval, acknowledgement and
 * the reminder run against Postgres in tests/integration/policies.test.js.
 *
 * Every person, department and policy here is invented.
 */
jest.mock("../../services/ai/llm.service", () => ({ complete: jest.fn() }));

const ai = require("../../services/ai/llm.service");
const md = require("../../shared/documents/markdown");
const types = require("./policies.types");
const attendanceType = require("../attendance/attendance.policy-type");
const { appliesToText, changesOf, stateOf } = require("./policies.service");
const tidy = require("./policies.tidy");
const { routesOf } = require("../../http/route");

/* ------------------------------------------------------------------ *
 * The types
 * ------------------------------------------------------------------ */

describe("the policy types", () => {
  test("a written document has no type; Attendance is registered by the module that enforces it", () => {
    expect(types.typeOf("document")).toBeNull();
    expect(types.typeOf("attendance").title).toBe("Attendance Policy");
    expect(types.rulesKinds()).toContain("attendance");
  });

  test("an unknown type is refused", () => {
    expect(() => types.typeOf("parking")).toThrow(/No policy type/);
  });

  test("a type missing a part is refused when it registers", () => {
    expect(() => types.register("broken", { title: "Broken" })).toThrow(/has no read/);
  });
});

/* ------------------------------------------------------------------ *
 * Applies To, states and changes
 * ------------------------------------------------------------------ */

describe("Applies To in words", () => {
  const row = { policy_version_id: "v-1", applies_to_everyone: false };
  const dept = (name) => ({ policy_version_id: "v-1", department_id: `d-${name}`, department_name: name });
  const person = (name) => ({ policy_version_id: "v-1", employee_id: `e-${name}`, employee_name: name });

  test("everyone", () => {
    expect(appliesToText({ ...row, applies_to_everyone: true }, [])).toBe("Everyone");
  });

  test("departments, patterns and people, in that order", () => {
    const audience = [dept("Operations"), { policy_version_id: "v-1", work_pattern: "remote" }, person("Ada Testcase")];
    expect(appliesToText(row, audience)).toMatch(/^Operations, .+ and Ada Testcase$/);
  });

  test("more than one person is counted, and another version's rows are ignored", () => {
    const audience = [person("Ada Testcase"), person("Bo Testcase"), { ...dept("Sales"), policy_version_id: "v-2" }];
    expect(appliesToText(row, audience)).toBe("2 people");
  });

  test("nobody picked yet", () => {
    expect(appliesToText(row, [])).toBe("Nobody yet");
  });
});

describe("a version's state", () => {
  const today = "2026-10-20";
  test("submitted and withdrawn read as such whatever the date", () => {
    expect(stateOf({ status: "submitted", effective_from: "2026-10-01" }, today, null)).toBe("awaiting_approval");
    expect(stateOf({ status: "withdrawn", effective_from: "2026-11-01" }, today, null)).toBe("withdrawn");
  });

  test("a first day ahead waits; the one in force is in force; any other published version is past", () => {
    expect(stateOf({ status: "published", effective_from: "2026-10-21", policy_version_id: "a" }, today, "b")).toBe("waiting");
    expect(stateOf({ status: "published", effective_from: "2026-10-20", policy_version_id: "b" }, today, "b")).toBe("in_force");
    expect(stateOf({ status: "published", effective_from: "2026-09-01", policy_version_id: "a" }, today, "b")).toBe("past");
  });
});

describe("what a version changes", () => {
  const everyone = { everyone: true, department_ids: [], work_patterns: [], employee_ids: [] };
  const doc = (over = {}) => ({
    title: "Dress Code",
    body_markdown: "## Dress\n\nSmart casual.",
    rules: null,
    applies_to: everyone,
    applies_to_text: "Everyone",
    ...over,
  });

  test("a first version changes nothing", () => {
    expect(changesOf("document", null, doc())).toEqual({ changed: [], change_lines: [] });
  });

  test("a document's title, audience and text", () => {
    const next = doc({
      title: "Dress Code at Work",
      body_markdown: "## Dress\n\nBusiness casual.",
      applies_to: { ...everyone, everyone: false, department_ids: ["d-1"] },
      applies_to_text: "Operations",
    });
    expect(changesOf("document", doc(), next)).toEqual({
      changed: ["title", "applies_to", "text"],
      change_lines: ["Title: Dress Code to Dress Code at Work", "Applies To: Everyone to Operations", "The text changed"],
    });
  });

  test("the same audience in another order is no change", () => {
    const a = { everyone: false, department_ids: ["d-1", "d-2"], work_patterns: [], employee_ids: [] };
    const b = { ...a, department_ids: ["d-2", "d-1"] };
    expect(changesOf("document", doc({ applies_to: a }), doc({ applies_to: b })).changed).toEqual([]);
  });

  test("an Attendance version lists the visible rules it changes, by name and value", () => {
    const before = attendanceType.suggestions();
    const after = { ...before, grace_minutes: 10, home_geofence_mode: "block" };
    const out = changesOf("attendance", doc({ rules: before }), doc({ rules: after }));
    expect(out.changed).toEqual(["grace_minutes", "home_geofence_mode"]);
    expect(out.change_lines).toEqual(["Grace Minutes: 5 minutes to 10 minutes", "Home Check: Flag to Refuse"]);
  });
});

/* ------------------------------------------------------------------ *
 * The Attendance type
 * ------------------------------------------------------------------ */

describe("the Attendance policy type", () => {
  test("a first draft suggests a 5 minute grace and flags new devices; homes start at 150 m", () => {
    const s = attendanceType.suggestions();
    expect(s).toMatchObject({ grace_minutes: 5, device_mode: "warn", home_radius_m: 150 });
  });

  test("a changed rule tags its section, and only its section", () => {
    const rules = attendanceType.suggestions();
    const out = attendanceType.sections(rules, ["device_mode"]);
    expect(out.map((s) => s.key)).toEqual([
      "hours", "clocking_in", "late", "early", "absence", "forgotten", "location_flags", "overtime",
      "office", "home", "site", "location", "devices", "clock_prompts",
    ]);
    expect(out.find((s) => s.key === "devices").sentences.every((x) => x.changed)).toBe(true);
    expect(out.filter((s) => s.key !== "devices").every((s) => s.sentences.every((x) => !x.changed))).toBe(true);
  });

  test("no grace says so; Refuse at home names the radius", () => {
    const rules = {
      ...attendanceType.suggestions(),
      grace_minutes: 0,
      home_location: { on: true },
      home_geofence_mode: "block",
      home_radius_m: 200,
    };
    const text = attendanceType.sections(rules).flatMap((s) => s.sentences.map((x) => x.text)).join(" ");
    expect(text).toMatch(/There is no grace period/);
    expect(text).toMatch(/more than 200 m from your approved home is refused/);
  });

  test("Home Location starts off; off, working from home is not checked and no home is named", () => {
    const s = attendanceType.suggestions();
    expect(s.home_location).toEqual({ on: false });
    const home = attendanceType.sections({ ...s, home_geofence_mode: "block" }).find((x) => x.key === "home");
    expect(home.sentences.map((x) => x.text)).toEqual(["Working from home, your location is not checked."]);
  });

  test("off, a home's mode is not a check in use: with the rest off, nothing is sent for review", () => {
    const rules = { ...attendanceType.suggestions(), office_geofence_mode: "off", site_geofence_mode: "off", home_geofence_mode: "block" };
    const where = attendanceType.sections(rules).find((x) => x.key === "location").sentences.map((x) => x.text);
    expect(where.join(" ")).not.toMatch(/sent to People for review/);
    const on = attendanceType.sections({ ...rules, home_location: { on: true } }).find((x) => x.key === "location");
    expect(on.sentences.map((x) => x.text).join(" ")).toMatch(/sent to People for review/);
  });

  test("switching Home Location on is one change, its line and its section tagged", () => {
    const before = attendanceType.suggestions();
    const after = { ...before, home_location: { on: true } };
    expect(attendanceType.changed(before, after)).toEqual(["home_location"]);
    expect(attendanceType.changeLines(before, after)).toEqual(["Home Location: Off to On"]);
    const out = attendanceType.sections(after, ["home_location"]);
    expect(out.find((x) => x.key === "home").sentences.every((x) => x.changed)).toBe(true);
  });

  test("the read schema names every rule the draft schema does, each with its default", () => {
    const c = require("@mycity/contract");
    let draft = c.attendance.AttendanceRulesDraft;
    while (!draft.shape) draft = draft._def.schema;
    expect(Object.keys(c.attendance.AttendanceRules.shape).sort()).toEqual(Object.keys(draft.shape).sort());
    const a = c.attendance.AttendanceRules.parse({});
    const b = c.attendance.AttendanceRules.parse({});
    expect(a.late_rule).toEqual(b.late_rule);
    expect(a.late_rule).not.toBe(b.late_rule);
  });

  test("every rule is enforced since PR 3, so every rule is shown", () => {
    const c = require("@mycity/contract");
    expect([...attendanceType.VISIBLE].sort()).toEqual(Object.keys(c.attendance.AttendanceRules.shape).sort());
  });

  test("a working day's wrong time is marked on that day, in four words or fewer", () => {
    const c = require("@mycity/contract");
    const hours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, working: weekday < 6, starts_at: weekday < 6 ? "09:00" : null, ends_at: weekday < 6 ? "17:00" : null }));
    hours[2] = { ...hours[2], working: true, starts_at: "17:00", ends_at: "09:00" };
    hours[4] = { ...hours[4], working: true, starts_at: null, ends_at: "17:00" };
    const draft = c.attendance.AttendanceRulesDraft.safeParse({ hours });
    const issues = draft.error.issues.map((i) => [i.path.join("."), i.message]);
    expect(issues).toEqual(expect.arrayContaining([["hours.2.ends_at", "Ends after it starts"], ["hours.4.starts_at", "Required"]]));
    const none = c.attendance.AttendanceRulesDraft.safeParse({ hours: hours.map((d) => ({ ...d, working: false, starts_at: null, ends_at: null })) });
    expect(none.error.issues.map((i) => i.message)).toContain("Tick a working day");
    for (const [, message] of [...issues, ...none.error.issues.map((i) => [0, i.message])]) expect(message.split(" ").length).toBeLessThanOrEqual(4);
  });
});

describe("the rules of the version that judged something (rulesOfVersion, §6.8)", () => {
  const service = require("./policies.service");
  const c = require("@mycity/contract");
  const VERSION_ID = "11111111-1111-4111-8111-111111111111";
  /** A client that answers the one read with `row`, and records what it was asked. */
  const db = (row) => {
    const asked = [];
    return { asked, query: async (sql, params) => (asked.push(params), { rows: row ? [row] : [] }) };
  };

  test("that version's rules, parsed with the type's defaults filled in", async () => {
    const client = db({ policy_version_id: VERSION_ID, version: 3, rules: { grace_minutes: 10 } });
    const out = await service.rulesOfVersion(client, "attendance", VERSION_ID);
    expect(client.asked).toEqual([["attendance", VERSION_ID]]);
    expect(out.policy_version_id).toBe(VERSION_ID);
    expect(out.version).toBe(3);
    expect(out.rules).toEqual({ ...c.attendance.AttendanceRules.parse({}), grace_minutes: 10 });
  });

  test("the type's defaults for no id, or an id that is not that type's version, read nothing more", async () => {
    const none = db(null);
    expect(await service.rulesOfVersion(none, "attendance", null)).toEqual({
      policy_version_id: null,
      version: null,
      rules: c.attendance.AttendanceRules.parse({}),
    });
    expect(none.asked).toEqual([]);
    expect((await service.rulesOfVersion(db(null), "attendance", VERSION_ID)).policy_version_id).toBeNull();
  });
});

describe("since when a rule has held (heldSince, §6.8)", () => {
  const service = require("./policies.service");
  /** Published versions; the client answers the in-force read for the date it is asked about. */
  const db = (versions) => ({
    query: async (_sql, [, date]) => {
      const inForce = versions
        .filter((x) => x.effective_from <= date)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.version - a.version)[0];
      return { rows: inForce ? [inForce] : [] };
    },
  });
  const v = (n, from, on) => ({ policy_version_id: `version-${n}`, version: n, effective_from: from, rules: { home_location: { on } } });
  const on = (r) => r.home_location.on === true;

  test("the first version of the unbroken run that passes, up to the one in force", async () => {
    const versions = [v(1, "2026-10-01", false), v(2, "2026-10-10", true), v(3, "2026-10-20", true)];
    expect(await service.heldSince(db(versions), "attendance", "2026-10-25", on)).toEqual({
      policy_version_id: "version-2",
      effective_from: "2026-10-10",
    });
  });

  test("null when the version in force fails, or before any version when the defaults do", async () => {
    const versions = [v(1, "2026-10-01", true), v(2, "2026-10-10", false)];
    expect(await service.heldSince(db(versions), "attendance", "2026-10-12", on)).toBeNull();
    expect(await service.heldSince(db(versions), "attendance", "2026-09-30", on)).toBeNull();
  });

  test("switched off and on again is a new stretch, named by the version that switched it back", async () => {
    const versions = [v(1, "2026-10-01", true), v(2, "2026-10-10", false), v(3, "2026-10-20", true)];
    expect((await service.heldSince(db(versions), "attendance", "2026-10-05", on)).policy_version_id).toBe("version-1");
    expect((await service.heldSince(db(versions), "attendance", "2026-10-21", on)).policy_version_id).toBe("version-3");
  });

  test("defaults that pass are a run of their own, with no version", async () => {
    const versions = [v(1, "2026-10-10", false)];
    const off = (r) => r.home_location.on === false;
    expect(await service.heldSince(db(versions), "attendance", "2026-10-12", off)).toEqual({
      policy_version_id: null,
      effective_from: null,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Text in and out
 * ------------------------------------------------------------------ */

describe("pasted text to Markdown", () => {
  test("headings, lists, bold, italic and safe links are kept; everything else is text", () => {
    const html =
      "<h1>Leave</h1><p>Read <b>this</b> and <i>that</i>.</p><ul><li>One</li><li>Two</li></ul>" +
      '<ol><li>First</li></ol><p><a href="https://example.test/a">a link</a> <a href="javascript:x()">bad</a></p>' +
      "<script>alert(1)</script><table><tr><td>A</td><td>B</td></tr></table>";
    expect(md.htmlToMarkdown(html)).toBe(
      "## Leave\n\nRead **this** and *that*.\n\n- One\n- Two\n\n1. First\n\n[a link](https://example.test/a) bad\n\nA · B",
    );
  });

  test("a line that would read as Markdown stays text", () => {
    expect(md.htmlToMarkdown("<p># not a heading</p>")).toBe("​# not a heading");
    expect(md.htmlToMarkdown("<p>2 * 3</p>")).toBe("2 ∗ 3");
  });

  test("Markdown to the blocks a screen draws", () => {
    expect(md.markdownToBlocks("## Title\n\nSome **bold** text.\n\n- a\n- b\n\n1. one")).toEqual([
      { kind: "heading", level: 2, spans: [{ text: "Title", bold: false, italic: false, href: null }] },
      {
        kind: "paragraph",
        spans: [
          { text: "Some ", bold: false, italic: false, href: null },
          { text: "bold", bold: true, italic: false, href: null },
          { text: " text.", bold: false, italic: false, href: null },
        ],
      },
      {
        kind: "bullets",
        items: [[{ text: "a", bold: false, italic: false, href: null }], [{ text: "b", bold: false, italic: false, href: null }]],
      },
      { kind: "numbered", items: [[{ text: "one", bold: false, italic: false, href: null }]] },
    ]);
  });
});

describe("Tidy With AI", () => {
  const user = { user_id: "u-1" };
  const pasted = "<p>LEAVE POLICY</p><p>1. Staff get 20 days. Write to hr@example.test or call +234 800 000 0000.</p>";

  beforeEach(() => ai.complete.mockReset());

  test("the words must be the words sent: case, punctuation and list markers aside", () => {
    expect(tidy.sameWords("Staff get 20 days.", "## Staff\n\n1. get **20** days")).toBe(true);
    expect(tidy.sameWords("Staff get 20 days.", "Staff get 21 days.")).toBe(false);
    expect(tidy.sameWords("Staff get 20 days.", "All staff get 20 days.")).toBe(false);
  });

  test("a clause number may become a list number; a bare number is a word", () => {
    expect(tidy.sameWords("1.1 Staff get 20 days.", "1. Staff get 20 days.")).toBe(true);
    expect(tidy.sameWords("5 days notice is required.", "Days notice is required.")).toBe(false);
  });

  test("contact details never reach the model, and come back in place", () => {
    const { out, restore } = tidy.shield("Mail hr@example.test or see https://example.test/x today.");
    expect(out).toBe("Mail KEPT001 or see KEPT002 today.");
    expect(restore(out)).toBe("Mail hr@example.test or see https://example.test/x today.");
  });

  test("a layout-only answer comes back as the editor's HTML", async () => {
    ai.complete.mockImplementation(async ({ input }) => ({
      text: input.policy_markdown.replace("LEAVE POLICY\n\n\u200b1. Staff", "## LEAVE POLICY\n\n1. Staff"),
    }));
    const out = await tidy.suggest(user, { body_html: pasted });
    expect(ai.complete).toHaveBeenCalledWith(expect.objectContaining({ purpose: "policy-tidy", module: "knowledge", egress: "external" }));
    expect(ai.complete.mock.calls[0][0].input.policy_markdown).not.toMatch(/hr@example|\+234/);
    expect(out.body_html).toMatch(/<h2>LEAVE POLICY<\/h2>/);
    expect(out.body_html).toMatch(/hr@example\.test/);
    expect(out.body_html).toMatch(/\+234 800 000 0000/);
  });

  test("an answer that changed a word is refused, never shown", async () => {
    ai.complete.mockResolvedValue({ text: "## Leave Policy\n\n1. Staff get 25 days. Write to KEPT001 or call KEPT002." });
    await expect(tidy.suggest(user, { body_html: pasted })).rejects.toMatchObject({ code: "AI_CHANGED_WORDS" });
  });

  test("nothing to tidy is refused before the model is asked", async () => {
    await expect(tidy.suggest(user, { body_html: "<p> </p>" })).rejects.toMatchObject({ code: "POLICY_EMPTY" });
    expect(ai.complete).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * The routes
 * ------------------------------------------------------------------ */

describe("the routes", () => {
  const routes = routesOf(require("./policies.routes").router);

  test("the person's own routes are self; every other route needs the knowledge grant and policies.manage", () => {
    expect(routes.length).toBeGreaterThan(20);
    for (const r of routes) {
      if (r.path.startsWith("/me")) {
        expect(r.contract.self).toBe(true);
        expect(r.permission).toBeFalsy();
      } else {
        expect(r.permission && r.permission.key).toBe("knowledge");
        expect(r.capability).toBe("policies.manage");
      }
    }
  });

  test("archiving needs delete; writing needs edit; reading needs view", () => {
    const by = (method, path) => routes.find((r) => r.method === method && r.path === path);
    expect(by("POST", "/:id/archive").permission.action).toBe("delete");
    expect(by("POST", "/:id/publish").permission.action).toBe("edit");
    expect(by("POST", "/tidy").permission.action).toBe("edit");
    expect(by("GET", "/").permission.action).toBe("view");
  });

  test("approve and reject answer with no content", () => {
    for (const path of ["/me/versions/:id/approve", "/me/versions/:id/reject"])
      expect(routes.find((r) => r.path === path).contract.no_content).toBe(true);
  });
});
