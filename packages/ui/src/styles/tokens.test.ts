import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import appearanceSchemas from "@mycity/contract/schemas/appearance.js";

/**
 * Every text pair the screens use keeps WCAG AA (4.5:1) in both themes. The
 * values are read from tokens.css itself, so a changed token that breaks a pair
 * fails here, not in an axe run on one screen. The pair table and the ratio
 * maths are the contract's (packages/contract/schemas/appearance.js), the ones
 * Settings · Appearance holds a pasted dark palette to, so there is one copy.
 */

/** The contract's colour helpers, typed for this test (the schema file is CommonJS). */
const appearance = appearanceSchemas as unknown as {
  pairs: (theme: "light" | "dark") => Array<[string, string]>;
  contrast: (a: string, b: string) => number;
  deriveDark: (seeds: Record<string, string>) => { tokens: Record<string, string>; problems: Record<string, string> };
  DEFAULT_DARK: Record<string, string>;
  DARK_PRESETS: ReadonlyArray<{ key: string; seeds: Record<string, string> }>;
  AA_TEXT: number;
};

/** Read from disk: the test run does not process CSS imports. */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

/** The `--name: value` declarations of the first block whose selector matches. */
function declarations(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf("}", m.index));
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  return out;
}

/** Only the #RRGGBB values: the ones a text pair can be measured on. */
const hexOnly = (all: Record<string, string>) => Object.fromEntries(Object.entries(all).filter(([, v]) => /^#[0-9A-Fa-f]{6}$/.test(v)));
const block = (selector: RegExp) => hexOnly(declarations(selector));

const { pairs, contrast: ratio } = appearance;

const light = block(/:root,\s*\[data-theme="light"\]\s*\{/);
const dark = { ...light, ...block(/\n\[data-theme="dark"\]\s*\{/) };
const systemDark = { ...light, ...block(/:root:not\(\[data-theme="light"\]\)\s*\{/) };

describe("tokens.css contrast", () => {
  for (const [name, theme, values] of [
    ["light", "light", light],
    ["dark (chosen)", "dark", dark],
    ["dark (device)", "dark", systemDark],
  ] as const) {
    it(`keeps every text pair at AA in ${name}`, () => {
      const failing = pairs(theme)
        .map(([t, s]) => {
          const fg = values[t];
          const bg = values[s];
          if (!fg || !bg) return `${t} on ${s}: missing`;
          const r = ratio(fg, bg);
          return r >= 4.5 ? null : `${t} ${fg} on ${s} ${bg}: ${r.toFixed(2)}`;
        })
        .filter(Boolean);
      expect(failing).toEqual([]);
    });
  }

  /*
   * The public site's ground (PublicPage, data-canvas): every ink keeps AA on the tint and on its
   * glow, and the two inks the canvas deepens (muted-foreground, eyebrow) still hold every pair the
   * originals are held to, since inside the canvas they stand in for them on every surface.
   */
  for (const [name, theme, values] of [
    ["light", "light", light],
    ["dark (chosen)", "dark", dark],
    ["dark (device)", "dark", systemDark],
  ] as const) {
    it(`keeps the public canvas's text at AA in ${name}`, () => {
      const swap: Record<string, string> = { "muted-foreground": "canvas-muted-foreground", eyebrow: "canvas-eyebrow" };
      const onCanvas: Array<[string, string]> = ["canvas", "canvas-glow"].flatMap((s) =>
        ["foreground", "canvas-muted-foreground", "subtle-foreground", "accent-foreground", "canvas-eyebrow"].map((t) => [t, s] as [string, string]),
      );
      const deepened = pairs(theme)
        .filter(([t]) => swap[t])
        .map(([t, s]) => [swap[t]!, s] as [string, string]);
      const failing = [...onCanvas, ...deepened]
        .map(([t, s]) => {
          const fg = values[t];
          const bg = values[s];
          if (!fg || !bg) return `${t} on ${s}: missing`;
          const r = ratio(fg, bg);
          return r >= 4.5 ? null : `${t} ${fg} on ${s} ${bg}: ${r.toFixed(2)}`;
        })
        .filter(Boolean);
      expect(failing).toEqual([]);
    });
  }

  /*
   * The public site's own surfaces and inks (public.css): every ink on the site's card and hover tint,
   * the body's soft ink, its fields and menus, the inks of its hero and footer on the theme's ground (and the
   * on-deep inks they stand for, on Deep Green), the search box's ink on white and on the site's paper
   * and the solid button's.
   */
  for (const [name, values] of [
    ["light", light],
    ["dark (chosen)", dark],
    ["dark (device)", systemDark],
  ] as const) {
    it(`keeps the public site's own inks at AA in ${name}`, () => {
      const surfaces = ["canvas", "canvas-glow", "canvas-card", "canvas-hover"];
      const pairsOnSite: Array<[string, string]> = [
        ...surfaces.flatMap((s) => ["foreground", "canvas-soft", "canvas-muted-foreground", "accent-foreground"].map((t) => [t, s] as [string, string])),
        ...["on-deep", "on-deep-hero", "on-deep-lede", "on-deep-chip", "on-deep-back", "on-deep-link", "on-deep-note", "on-deep-label", "on-deep-base", "on-deep-gold"].map(
          (t) => [t, "deep"] as [string, string],
        ),
        ...["canvas-field", "canvas-popover"].flatMap((s) =>
          ["foreground", "canvas-muted-foreground", "accent-foreground", "subtle-foreground"].map((t) => [t, s] as [string, string]),
        ),
        ...["site-ink", "site-ink-hero", "site-ink-lede", "site-ink-chip", "site-ink-back", "site-ink-link", "site-ink-note", "site-ink-label", "site-ink-base", "site-ink-gold", "site-accent"].map(
          (t) => [t, "site-ground"] as [string, string],
        ),
        ["search-ink", "paper"],
        ["search-muted", "paper"],
        ["search-ink", "canvas-paper"],
        ["search-muted", "canvas-paper"],
        ["solid-foreground", "solid"],
        ["primary-foreground", "primary"],
      ];
      const failing = pairsOnSite
        .map(([t, s]) => {
          const fg = values[t];
          const bg = values[s];
          if (!fg || !bg) return `${t} on ${s}: missing`;
          const r = ratio(fg, bg);
          return r >= 4.5 ? null : `${t} ${fg} on ${s} ${bg}: ${r.toFixed(2)}`;
        })
        .filter(Boolean);
      expect(failing).toEqual([]);
    });
  }

  it("writes the device dark block the same as the chosen one", () => {
    expect(systemDark).toEqual(dark);
    expect(declarations(/:root:not\(\[data-theme="light"\]\)\s*\{/)).toEqual(declarations(/\n\[data-theme="dark"\]\s*\{/));
  });

  it("ships the dark theme Settings · Appearance derives from MyCity's own four colours", () => {
    const derived = appearance.deriveDark(appearance.DEFAULT_DARK);
    expect(derived.problems).toEqual({});
    expect(declarations(/\n\[data-theme="dark"\]\s*\{/)).toMatchObject(derived.tokens);
  });

  it("keeps every pair at AA for each dark preset, light tokens beneath it", () => {
    for (const preset of appearance.DARK_PRESETS) {
      const values = { ...light, ...hexOnly(appearance.deriveDark(preset.seeds).tokens) };
      const failing = pairs("dark").filter(([t, s]) => values[t] && values[s] && ratio(values[t]!, values[s]!) < appearance.AA_TEXT);
      expect([preset.key, failing]).toEqual([preset.key, []]);
    }
  });

  it("keeps the phone sizes in either density", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 760px)"));
    expect(phone).toMatch(/:root,\s*\[data-density\]\s*\{[^}]*--tap:\s*44px/);
    expect(phone).toMatch(/--text-field:\s*16px/);
    const comfortable = css.indexOf('[data-density="comfortable"] {');
    expect(comfortable).toBeGreaterThan(-1);
    expect(comfortable).toBeLessThan(css.indexOf("@media (max-width: 760px)"));
  });
});
