"use strict";
/**
 * Settings · Appearance (docs/guides/foundation.md §6.15; FRONTEND_FOUNDATION F30, TB 21/10/2026):
 * the hub's dark palette, its fonts and the defaults a person starts with. The public site
 * (go.mycityapp.io), documents and email are not touched by any of it.
 *
 * The dark palette is four colours a person pastes: Background, Card, Brand Green (highlights,
 * links, the selected item's text) and Primary Yellow (buttons, the focus ring). Every other
 * dark token is worked out from them here, by fixed maths, so the screen's preview, the save,
 * the shipped tokens.css and the samples file all hold the same values. Each text pair the
 * screens use (DARK_PAIRS, the one table packages/ui's tokens.test.ts and gate 14 read) must keep
 * WCAG AA, 4.5:1: a derived ink that falls short is lightened, and a derived tint brought closer
 * to the background, until it holds; the colours moved are listed (`nudged`). A pasted colour that
 * no nudge can save (a background too light for white text, a yellow too dark to carry text) is
 * refused on its field. The light theme is MILESTONES §5.1 and is not configurable.
 *
 * Saved values are `setting` rows (appearance.*), read by src/modules/settings/settings.appearance.js.
 */
const { z } = require("zod");
const { isoDateTime } = require("./common");

/* ------------------------------------------------------------------ *
 * Colour maths (WCAG 2 relative luminance, sRGB, HSL)
 * ------------------------------------------------------------------ */

/** #RRGGBB, upper case. */
const HEX = /^#[0-9A-F]{6}$/;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) => `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** WCAG 2 relative luminance of #RRGGBB, 0 (black) to 1 (white). */
function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two colours, 1 to 21. */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** #RRGGBB as hue (0 to 360), saturation and lightness (0 to 100). */
function hslOf(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hexOfHsl(h, s, l) {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hexOf([f(0), f(8), f(4)].map((v) => v * 255));
}

/** `hex` with its HSL lightness moved by `by` points (negative darkens). */
function lighten(hex, by) {
  const { h, s, l } = hslOf(hex);
  return hexOfHsl(h, s, l + by);
}

/** `a` moved toward `b` by `t` (0 is `a`, 1 is `b`), channel by channel. */
function mix(a, b, t) {
  const [x, y] = [rgbOf(a), rgbOf(b)];
  return hexOf(x.map((v, i) => v + (y[i] - v) * t));
}

/** "rgba(1, 34, 29, .82)": `hex` see-through, for the glass panels. */
function rgba(hex, alpha) {
  return `rgba(${rgbOf(hex).join(", ")}, ${String(alpha).replace(/^0/, "")})`;
}

/* ------------------------------------------------------------------ *
 * The text pairs every theme keeps at AA (gate 14)
 * ------------------------------------------------------------------ */

/** AA for text, and for a control's outline against the page (WCAG 1.4.11). */
const AA_TEXT = 4.5;
const AA_BOUNDARY = 3;

const SOFT = Object.freeze(["success", "warning", "destructive", "info"]);
const SURFACES = Object.freeze(["background", "card", "popover", "muted"]);
const INKS = Object.freeze(["foreground", "muted-foreground", "subtle-foreground", "accent-foreground", "eyebrow"]);

/**
 * The [text, surface] pairs that must reach AA in a theme: what packages/ui's tokens.test.ts
 * checks over tokens.css, and what the dark palette is held to when it is derived.
 * @param {"light"|"dark"} theme
 * @returns {Array<[string, string]>}
 */
function pairs(theme) {
  const out = [];
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

/* ------------------------------------------------------------------ *
 * The dark palette
 * ------------------------------------------------------------------ */

/** The four colours a person pastes, in the order the page lists them. */
const DARK_SEED_KEYS = Object.freeze(/** @type {const} */ (["background", "card", "brand_green", "primary_yellow"]));

/**
 * MyCity's dark theme as shipped (MILESTONES §5.2): surfaces on the brand's own hue (171°), the
 * green highlight that reads on them, and Primary Yellow unchanged. tokens.css's dark block is
 * deriveDark() of these, which packages/ui's tokens.test.ts holds equal.
 */
const DEFAULT_DARK = Object.freeze({ background: "#01110E", card: "#01221D", brand_green: "#45C8B0", primary_yellow: "#FFDF55" });

/**
 * The samples shown to MyCity on 21/10/2026, after the Milestone 1 handover asked for a dark
 * theme on charcoal, black or dark grey with the green as a highlight. Any one can be applied
 * as it is, or as the start of a custom palette.
 */
const DARK_PRESETS = Object.freeze([
  Object.freeze({ key: "deep_green", name: "Deep Green", seeds: DEFAULT_DARK }),
  Object.freeze({ key: "charcoal", name: "Charcoal", seeds: Object.freeze({ background: "#141517", card: "#1E2023", brand_green: "#45C8B0", primary_yellow: "#FFDF55" }) }),
  Object.freeze({ key: "black", name: "Black", seeds: Object.freeze({ background: "#000000", card: "#111312", brand_green: "#45C8B0", primary_yellow: "#FFDF55" }) }),
  Object.freeze({ key: "dark_grey", name: "Dark Grey", seeds: Object.freeze({ background: "#1C1C1E", card: "#2A2A2D", brand_green: "#45C8B0", primary_yellow: "#FFDF55" }) }),
]);

/** Status colours on dark (MILESTONES §5.2), and the eyebrow amber lightened for it. */
const STATUS_DARK = Object.freeze({ success: "#32D583", warning: "#FDB022", destructive: "#F97066", info: "#84ADFF" });
const EYEBROW_DARK = "#BD9743";
/** Ink on the yellow, darkest last: the brand's Deep Green first, then black. */
const ON_YELLOW = Object.freeze(["#01221D", "#000000"]);
const WHITE = "#FFFFFF";

/** The lightest a pasted surface may be: white text on it keeps a clear margin over AA. */
const MAX_LUMINANCE = Object.freeze({ background: 0.04, card: 0.06 });
/** The darkest a yellow may be and still carry the button text and the focus ring. */
const MIN_YELLOW_LUMINANCE = 0.3;

/** The tokens the derivation writes, in the order tokens.css lists them. */
const DARK_TOKENS = Object.freeze([
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "muted",
  "muted-foreground", "subtle-foreground", "accent", "accent-foreground", "eyebrow", "border", "input",
  "ring", "primary", "primary-foreground", "sidebar", "sidebar-foreground", "sidebar-muted", "sidebar-accent",
  "sidebar-accent-foreground", "sidebar-primary", "sidebar-primary-foreground", "success", "success-soft",
  "warning", "warning-soft", "destructive", "destructive-soft", "info", "info-soft", "glass",
]);

/** The pasted colours, as #RRGGBB upper case, or the problem with one that is not. */
function normalHex(value) {
  const v = String(value || "").trim().toUpperCase();
  const withHash = v.startsWith("#") ? v : `#${v}`;
  return HEX.test(withHash) ? withHash : null;
}

/**
 * Raises an ink's lightness, half a point at a time, until it keeps `need` on every surface.
 * @returns {string|null} the ink, or null when even white falls short
 */
function raise(ink, surfaces, need = AA_TEXT) {
  const { h, s, l } = hslOf(ink);
  for (let at = l; at <= 100.0001; at += 0.5) {
    const hex = at === l ? ink : hexOfHsl(h, s, at);
    if (surfaces.every((sf) => contrast(hex, sf) >= need)) return hex;
  }
  return null;
}

/**
 * The whole dark palette from its four colours.
 *
 * @param {{background: string, card: string, brand_green: string, primary_yellow: string}} input
 * @returns {{
 *   tokens: Record<string, string>,
 *   nudged: Record<string, string>,
 *   pairs: Array<{text: string, surface: string, ratio: number}>,
 *   problems: Record<string, string>,
 * }}
 *   tokens   every token in DARK_TOKENS (empty when a seed has a problem)
 *   nudged   token → the value it started from, for each moved to keep AA
 *   pairs    every text pair checked, with its ratio
 *   problems seed key → a field error of at most four words
 */
function deriveDark(input) {
  const seeds = {};
  const problems = {};
  for (const key of DARK_SEED_KEYS) {
    const hex = normalHex(input && input[key]);
    if (!hex) problems[key] = "Use #RRGGBB";
    else seeds[key] = hex;
  }
  if (seeds.background && luminance(seeds.background) > MAX_LUMINANCE.background) problems.background = "Too light for dark";
  if (seeds.card && luminance(seeds.card) > MAX_LUMINANCE.card) problems.card = "Too light for dark";
  if (seeds.primary_yellow && luminance(seeds.primary_yellow) < MIN_YELLOW_LUMINANCE) problems.primary_yellow = "Too dark for buttons";
  if (Object.keys(problems).length) return { tokens: {}, nudged: {}, pairs: [], problems };

  const { background: B, card: C, brand_green: G, primary_yellow: Y } = seeds;
  const hue = hslOf(B);
  /** A near-neutral ink, tinted by the background's own hue (none on a grey). */
  const tint = (sat, light) => hexOfHsl(hue.h, Math.min(hue.s, sat), light);
  const t = {};
  const nudged = {};
  const keep = (token, start, surfaces, need) => {
    const v = raise(start, surfaces, need);
    if (v === null) return false;
    if (v !== start) nudged[token] = start;
    t[token] = v;
    return true;
  };

  // Surfaces: the two pasted, a menu a step above the card, a hover two steps above, a recess below the page.
  t.background = B;
  t.card = C;
  t.popover = lighten(C, 2);
  t.accent = lighten(C, 5);
  t.muted = lighten(B, -1);
  const base = [t.background, t.card, t.popover, t.muted];

  // Inks, on every surface they sit on.
  const fits =
    keep("foreground", tint(15, 91.5), [...base, t.accent]) &&
    keep("muted-foreground", tint(12, 69), [...base, t.accent]) &&
    keep("subtle-foreground", tint(11, 59), [...base, t.accent]) &&
    keep("accent-foreground", G, [...base, t.accent]) &&
    keep("eyebrow", EYEBROW_DARK, [...base, t.accent]);
  if (!fits) return { tokens: {}, nudged: {}, pairs: [], problems: { background: "Too light for dark" } };
  t["card-foreground"] = t.foreground;
  t["popover-foreground"] = t.foreground;

  // Lines: dividers drawn faintly in the green; a control's outline at 3:1 on the page and the card.
  t.border = mix(lighten(C, 8), G, 0.12);
  keep("input", mix(lighten(C, 14), G, 0.14), [t.background, t.card], AA_BOUNDARY);
  t.ring = Y;

  // The yellow and the ink on it.
  t.primary = Y;
  const onYellow = ON_YELLOW.find((ink) => contrast(ink, Y) >= AA_TEXT);
  if (!onYellow) return { tokens: {}, nudged: {}, pairs: [], problems: { primary_yellow: "Too dark for buttons" } };
  t["primary-foreground"] = onYellow;

  // The rail: the card's colour, white on it, the hover for the selected item.
  t.sidebar = C;
  t["sidebar-foreground"] = WHITE;
  t["sidebar-accent"] = t.accent;
  t["sidebar-accent-foreground"] = WHITE;
  keep("sidebar-muted", tint(12, 67), [t.sidebar, t["sidebar-accent"]]);
  t["sidebar-primary"] = Y;
  t["sidebar-primary-foreground"] = onYellow;

  // Status, each on a dark tint of its own hue, a little above the page, darkened until the inks on it hold.
  for (const s of SOFT) {
    keep(s, STATUS_DARK[s], [t.background, t.card]);
    const inks = [t[s], t.foreground, t["muted-foreground"], t["subtle-foreground"]];
    const own = hslOf(t[s]);
    let soft = B;
    for (let l = hue.l + 4; l >= 0; l -= 0.5) {
      const tried = hexOfHsl(own.h, Math.min(own.s, 70), l);
      if (inks.every((ink) => contrast(ink, tried) >= AA_TEXT)) {
        soft = tried;
        break;
      }
    }
    t[`${s}-soft`] = soft;
  }

  t.glass = rgba(C, 0.82);

  const checked = pairs("dark")
    .filter(([text, surface]) => t[text] && t[surface] && HEX.test(t[text]) && HEX.test(t[surface]))
    .map(([text, surface]) => ({ text, surface, ratio: Math.round(contrast(t[text], t[surface]) * 100) / 100 }));
  const tokens = Object.fromEntries(DARK_TOKENS.map((k) => [k, t[k]]));
  return { tokens, nudged, pairs: checked, problems: {} };
}

/** The preset a palette is, or null for a custom one. */
function presetOf(seeds) {
  const found = DARK_PRESETS.find((p) => DARK_SEED_KEYS.every((k) => normalHex(seeds && seeds[k]) === p.seeds[k]));
  return found ? found.key : null;
}

/* ------------------------------------------------------------------ *
 * Fonts: a vetted list, self-hosted in packages/ui (lib/fonts.ts)
 * ------------------------------------------------------------------ */

/**
 * Each family is self-hosted (no font service is asked), covers every weight the hub draws (400
 * to 700) and has tabular figures for money. Geist is the default and what documents print in.
 */
const FONTS = Object.freeze([
  Object.freeze({ id: "geist", name: "Geist" }),
  Object.freeze({ id: "inter", name: "Inter" }),
  Object.freeze({ id: "ibm_plex_sans", name: "IBM Plex Sans" }),
  Object.freeze({ id: "plus_jakarta_sans", name: "Plus Jakarta Sans" }),
  Object.freeze({ id: "source_sans_3", name: "Source Sans 3" }),
  Object.freeze({ id: "open_sans", name: "Open Sans" }),
]);
const FontId = z.enum(["geist", "inter", "ibm_plex_sans", "plus_jakarta_sans", "source_sans_3", "open_sans"]);
const DEFAULT_FONTS = Object.freeze({ heading: "geist", body: "geist" });

/* ------------------------------------------------------------------ *
 * The wire
 * ------------------------------------------------------------------ */

/** A colour as a person pastes it: #RRGGBB or RRGGBB, any case; stored upper case with its #. */
const HexColour = z
  .string()
  .trim()
  .refine((v) => normalHex(v) !== null, "Use #RRGGBB")
  .transform((v) => /** @type {string} */ (normalHex(v)));

const DarkPresetKey = z.enum(["deep_green", "charcoal", "black", "dark_grey"]);
const ThemeDefault = z.enum(["system", "light", "dark"]);
const DensityDefault = z.enum(["compact", "comfortable"]);

/** The four colours, each refused on its own field when the palette cannot be made from it. */
const AppearanceDarkSeeds = z
  .object({ background: HexColour, card: HexColour, brand_green: HexColour, primary_yellow: HexColour })
  .strict()
  .superRefine((v, ctx) => {
    for (const [key, message] of Object.entries(deriveDark(v).problems))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
  });

const AppearanceFonts = z.object({ heading: FontId, body: FontId }).strict();

/**
 * PATCH /settings/appearance: any of the four parts. `dark: null` goes back to MyCity's own
 * dark theme (Deep Green). A new palette keeps the one it replaces for Restore Previous.
 */
const AppearancePatch = z
  .object({
    dark: AppearanceDarkSeeds.nullable(),
    fonts: AppearanceFonts,
    theme_default: ThemeDefault,
    density_default: DensityDefault,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field" });

const Seeds = z.object({ background: z.string(), card: z.string(), brand_green: z.string(), primary_yellow: z.string() }).strict();

/** GET /settings/appearance: what Settings · Appearance shows and edits. */
const Appearance = z
  .object({
    dark: z
      .object({
        seeds: Seeds,
        /** The preset the palette is, or null for a custom one. */
        preset: DarkPresetKey.nullable(),
        /** Every derived token, with the value it started from when it was moved to keep AA. */
        tokens: z.array(z.object({ token: z.string(), value: z.string(), nudged_from: z.string().nullable() }).strict()),
        pairs: z.array(z.object({ text: z.string(), surface: z.string(), ratio: z.number() }).strict()),
      })
      .strict(),
    presets: z.array(z.object({ key: DarkPresetKey, name: z.string(), seeds: Seeds }).strict()),
    /** The palette Restore Previous brings back, or null when there is none. */
    previous: z.object({ seeds: Seeds, preset: DarkPresetKey.nullable(), replaced_at: isoDateTime }).strict().nullable(),
    fonts: AppearanceFonts,
    font_options: z.array(z.object({ id: FontId, name: z.string() }).strict()),
    theme_default: ThemeDefault,
    density_default: DensityDefault,
    /** The last change, and who made it; null before anyone has saved one. */
    updated_at: isoDateTime.nullable(),
    updated_by: z.string().nullable(),
  })
  .strict();

/**
 * What every screen of the hub applies, on /auth/me: the dark tokens when the palette is not
 * MyCity's own (null: tokens.css as shipped), the two fonts, and the defaults for a person who
 * has not chosen a theme or a density on this device.
 */
const AppearanceApplied = z
  .object({
    dark: z.record(z.string(), z.string()).nullable(),
    fonts: AppearanceFonts,
    theme_default: ThemeDefault,
    density_default: DensityDefault,
  })
  .strict();

const TABLES = {
  AppearanceDarkSeeds: { table: null, reason: "the setting row appearance.dark (setting.value)" },
  AppearanceFonts: { table: null, reason: "the setting row appearance.fonts (setting.value)" },
  AppearancePatch: { table: null, reason: "appearance.* setting rows, one per part" },
  Appearance: { table: null, reason: "appearance.* setting rows, with the palette derived from them" },
  AppearanceApplied: { table: null, reason: "appearance.* setting rows as /auth/me hands them to the hub" },
};

module.exports = {
  TABLES,
  AA_TEXT,
  AA_BOUNDARY,
  DARK_SEED_KEYS,
  DEFAULT_DARK,
  DARK_PRESETS,
  DARK_TOKENS,
  FONTS,
  DEFAULT_FONTS,
  luminance,
  contrast,
  pairs,
  normalHex,
  deriveDark,
  presetOf,
  HexColour,
  FontId,
  DarkPresetKey,
  ThemeDefault,
  DensityDefault,
  AppearanceDarkSeeds,
  AppearanceFonts,
  AppearancePatch,
  Appearance,
  AppearanceApplied,
};
