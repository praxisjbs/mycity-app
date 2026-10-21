"use strict";
/**
 * The dark palette worked out from four colours (packages/contract/schemas/appearance.js,
 * docs/guides/foundation.md §6.15): every pair the screens use at AA, the colours moved to keep
 * it named, and a pasted colour no nudge can save refused on its own field.
 */
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { appearance: A } = require("@mycity/contract");

const issues = (r) => (r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));

describe("the dark palette from four colours", () => {
  test("every preset derives with no problem, and every text pair it checks keeps 4.5:1", () => {
    for (const p of A.DARK_PRESETS) {
      const d = A.deriveDark(p.seeds);
      expect([p.key, d.problems]).toEqual([p.key, {}]);
      expect(Object.keys(d.tokens)).toEqual([...A.DARK_TOKENS]);
      expect(d.pairs.length).toBeGreaterThan(40);
      expect(d.pairs.filter((x) => x.ratio < A.AA_TEXT)).toEqual([]);
      expect(A.presetOf(p.seeds)).toBe(p.key);
    }
  });

  test("a green too dark to read on the cards is lightened until it does, and says so", () => {
    const d = A.deriveDark({ ...A.DEFAULT_DARK, brand_green: "#014339" });
    expect(d.problems).toEqual({});
    expect(d.nudged["accent-foreground"]).toBe("#014339");
    expect(A.contrast(d.tokens["accent-foreground"], d.tokens.accent)).toBeGreaterThanOrEqual(4.5);
    expect(A.presetOf({ ...A.DEFAULT_DARK, brand_green: "#014339" })).toBeNull();
  });

  test("a background or card too light for white text, or a yellow too dark for buttons, is refused on its field", () => {
    expect(A.deriveDark({ ...A.DEFAULT_DARK, background: "#FFFFFF" }).problems).toEqual({ background: "Too light for dark" });
    expect(A.deriveDark({ ...A.DEFAULT_DARK, card: "#808080" }).problems).toEqual({ card: "Too light for dark" });
    expect(A.deriveDark({ ...A.DEFAULT_DARK, primary_yellow: "#5A4A00" }).problems).toEqual({ primary_yellow: "Too dark for buttons" });
    expect(A.deriveDark({ ...A.DEFAULT_DARK, card: "blue" }).problems).toEqual({ card: "Use #RRGGBB" });
  });

  test("a colour is taken with or without its # and in either case, and stored upper case", () => {
    expect(A.normalHex("1e2023")).toBe("#1E2023");
    expect(A.normalHex(" #abcdef ")).toBe("#ABCDEF");
    expect(A.normalHex("#12345")).toBeNull();
    const r = A.AppearanceDarkSeeds.safeParse({ background: "141517", card: "#1e2023", brand_green: "#45c8b0", primary_yellow: "ffdf55" });
    expect(r.success && r.data).toEqual(A.DARK_PRESETS.find((p) => p.key === "charcoal").seeds);
  });

  test("a change names at least one part, and the fonts are the vetted list", () => {
    expect(issues(A.AppearancePatch.safeParse({}))).toEqual([": Change at least one field"]);
    expect(issues(A.AppearancePatch.safeParse({ fonts: { heading: "comic_sans", body: "geist" } }))).toHaveLength(1);
    expect(issues(A.AppearancePatch.safeParse({ dark: null, theme_default: "dark" }))).toEqual([]);
    expect(A.FONTS.map((f) => f.id)).toEqual(A.FontId.options);
  });
});

describe("the samples shown to MyCity", () => {
  test("docs/MyCity-ERP-Documents/dark-theme-samples.html is what the maths draws today", () => {
    const script = path.join(__dirname, "..", "..", "scripts", "gen", "dark-theme-samples.js");
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });
});
