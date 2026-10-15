import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every text pair the screens use keeps WCAG AA (4.5:1) in both themes. The
 * values are read from tokens.css itself, so a changed token that breaks a pair
 * fails here, not in an axe run on one screen.
 */

/** Read from disk: the test run does not process CSS imports. */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tokens.css"), "utf8");

/** The `--name: #RRGGBB` declarations of the first block whose selector matches. */
function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf("}", m.index));
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/g)) out[d[1]!] = d[2]!;
  return out;
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const light = block(/:root,\s*\[data-theme="light"\]\s*\{/);
const dark = { ...light, ...block(/\n\[data-theme="dark"\]\s*\{/) };
const systemDark = { ...light, ...block(/:root:not\(\[data-theme="light"\]\)\s*\{/) };

const SOFT = ["success", "warning", "destructive", "info"] as const;
const SURFACES = ["background", "card", "popover", "muted"];
const INKS = ["foreground", "muted-foreground", "subtle-foreground", "accent-foreground", "eyebrow"];

/** [text, surface] pairs that must reach AA in the given theme. */
function pairs(theme: "light" | "dark"): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const s of SURFACES) for (const t of INKS) out.push([t, s]);
  out.push(["foreground", "accent"], ["subtle-foreground", "accent"], ["accent-foreground", "accent"]);
  if (theme === "dark") out.push(["muted-foreground", "accent"], ["eyebrow", "accent"]);
  for (const s of SOFT) {
    out.push([s, `${s}-soft`], [s, "background"], [s, "card"]);
    for (const t of ["foreground", "muted-foreground", "subtle-foreground"]) out.push([t, `${s}-soft`]);
  }
  out.push(["primary-foreground", "primary"], ["secondary-foreground", "secondary"], ["sidebar-foreground", "sidebar"], ["sidebar-muted", "sidebar"], ["sidebar-accent-foreground", "sidebar-accent"], ["sidebar-muted", "sidebar-accent"]);
  out.push(["paper-foreground", "paper"], ["paper-muted", "paper"], ["paper-faint", "paper"], ["paper-faint", "paper-head"], ["paper-brand", "paper"]);
  return out;
}

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
