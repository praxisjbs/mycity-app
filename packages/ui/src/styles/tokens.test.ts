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
