/**
 * An email recoloured for the dark theme, by partial inversion: only the colours
 * that would be wrong on a dark page move.
 *
 *   - a light background (a white page, a pale panel) becomes dark;
 *   - dark text (black, charcoal, navy) becomes light;
 *   - a border follows its own lightness, unless it is a coloured accent line;
 *   - a colour already right for a dark page is left exactly as sent, so a dark
 *     brand header with gold type comes through untouched;
 *   - images are never touched.
 *
 * Hue is kept and lightness mirrored in OKLab, which is perceptual: a pale
 * yellow note becomes a dark ochre, navy text a light blue, not greys.
 *
 * White lands exactly on our card colour and black on our foreground (both read
 * from the live tokens by EmailFrame), so a recoloured email sits on the same
 * surface as the screen around it. A message whose stylesheet carries
 * `prefers-color-scheme` brought its own dark design and is left alone.
 *
 * CSS is walked by a character scanner that respects quotes and parentheses,
 * never by a pattern over whole declarations: the only patterns here match one
 * colour token, so no sender's markup can make the walk slow or skip a colour.
 */

export type Rgb = [number, number, number];

/** Where white lands (our card) and where black lands (our foreground). */
export interface DarkTheme {
  bg: Rgb;
  fg: Rgb;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

/** sRGB to OKLab. */
export function toOklab([r, g, b]: Rgb): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab to sRGB, clamped into gamut. */
export function fromOklab([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

export type Role = "bg" | "fg" | "border";

/**
 * A border this colourful is an accent (a brand's gold rule) and keeps its
 * colour; a grey divider darkens with the page or it glares. Borders only: a
 * coloured background is always moved, because the text on it is moved too.
 */
const ACCENT_CHROMA = 0.06;

/** Where one colour lands on a dark page, or the colour itself when it is already right there. */
export function mapColour(rgb: Rgb, role: Role, theme: DarkTheme): Rgb {
  const [L, a, b] = toOklab(rgb);
  if (role === "border" && Math.hypot(a, b) >= ACCENT_CHROMA) return rgb;
  if (role === "bg" || (role === "border" && L > 0.5)) {
    if (L <= 0.5) return rgb;
    /* (0.5, 1] onto (mid, card]: a neutral page takes our surface's tint, a coloured panel keeps its hue. */
    const [cardL, cardA, cardB] = toOklab(theme.bg);
    const k = Math.max(0, (0.5 - cardL) / 0.5);
    const t = (L - 0.5) / 0.5;
    return fromOklab([cardL + (1 - L) * k, a * 0.85 + cardA * t, b * 0.85 + cardB * t]);
  }
  if (L >= 0.5) return rgb;
  /* [0, 0.5) onto (mid, ink]: black lands on our foreground, mirrored. */
  const [inkL, inkA, inkB] = toOklab(theme.fg);
  const k = Math.max(0, (inkL - 0.5) / 0.5);
  const t = (0.5 - L) / 0.5;
  return fromOklab([inkL - L * k, a + inkA * t, b + inkB * t]);
}

/** Every CSS named colour, so no name is recoloured while another is missed. */
const NAMED: Record<string, string> = {
  aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff",
  beige: "f5f5dc", bisque: "ffe4c4", black: "000000", blanchedalmond: "ffebcd", blue: "0000ff",
  blueviolet: "8a2be2", brown: "a52a2a", burlywood: "deb887", cadetblue: "5f9ea0", chartreuse: "7fff00",
  chocolate: "d2691e", coral: "ff7f50", cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c",
  cyan: "00ffff", darkblue: "00008b", darkcyan: "008b8b", darkgoldenrod: "b8860b", darkgray: "a9a9a9",
  darkgreen: "006400", darkgrey: "a9a9a9", darkkhaki: "bdb76b", darkmagenta: "8b008b", darkolivegreen: "556b2f",
  darkorange: "ff8c00", darkorchid: "9932cc", darkred: "8b0000", darksalmon: "e9967a", darkseagreen: "8fbc8f",
  darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f", darkturquoise: "00ced1",
  darkviolet: "9400d3", deeppink: "ff1493", deepskyblue: "00bfff", dimgray: "696969", dimgrey: "696969",
  dodgerblue: "1e90ff", firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22", fuchsia: "ff00ff",
  gainsboro: "dcdcdc", ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080",
  green: "008000", greenyellow: "adff2f", grey: "808080", honeydew: "f0fff0", hotpink: "ff69b4",
  indianred: "cd5c5c", indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa",
  lavenderblush: "fff0f5", lawngreen: "7cfc00", lemonchiffon: "fffacd", lightblue: "add8e6", lightcoral: "f08080",
  lightcyan: "e0ffff", lightgoldenrodyellow: "fafad2", lightgray: "d3d3d3", lightgreen: "90ee90", lightgrey: "d3d3d3",
  lightpink: "ffb6c1", lightsalmon: "ffa07a", lightseagreen: "20b2aa", lightskyblue: "87cefa",
  lightslategray: "778899", lightslategrey: "778899", lightsteelblue: "b0c4de", lightyellow: "ffffe0",
  lime: "00ff00", limegreen: "32cd32", linen: "faf0e6", magenta: "ff00ff", maroon: "800000",
  mediumaquamarine: "66cdaa", mediumblue: "0000cd", mediumorchid: "ba55d3", mediumpurple: "9370db",
  mediumseagreen: "3cb371", mediumslateblue: "7b68ee", mediumspringgreen: "00fa9a", mediumturquoise: "48d1cc",
  mediumvioletred: "c71585", midnightblue: "191970", mintcream: "f5fffa", mistyrose: "ffe4e1", moccasin: "ffe4b5",
  navajowhite: "ffdead", navy: "000080", oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23",
  orange: "ffa500", orangered: "ff4500", orchid: "da70d6", palegoldenrod: "eee8aa", palegreen: "98fb98",
  paleturquoise: "afeeee", palevioletred: "db7093", papayawhip: "ffefd5", peachpuff: "ffdab9", peru: "cd853f",
  pink: "ffc0cb", plum: "dda0dd", powderblue: "b0e0e6", purple: "800080", rebeccapurple: "663399",
  red: "ff0000", rosybrown: "bc8f8f", royalblue: "4169e1", saddlebrown: "8b4513", salmon: "fa8072",
  sandybrown: "f4a460", seagreen: "2e8b57", seashell: "fff5ee", sienna: "a0522d", silver: "c0c0c0",
  skyblue: "87ceeb", slateblue: "6a5acd", slategray: "708090", slategrey: "708090", snow: "fffafa",
  springgreen: "00ff7f", steelblue: "4682b4", tan: "d2b48c", teal: "008080", thistle: "d8bfd8",
  tomato: "ff6347", turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff",
  whitesmoke: "f5f5f5", yellow: "ffff00", yellowgreen: "9acd32",
};

interface Parsed {
  rgb: Rgb;
  alpha: number;
}

function parseHex(hex: string): Parsed | null {
  const h = hex.replace(/^#/, "");
  if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/i.test(h)) return null;
  const full = h.length <= 4 ? h.split("").map((c) => c + c).join("") : h;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { rgb: [n(0), n(2), n(4)], alpha: full.length === 8 ? n(6) / 255 : 1 };
}

const channel = (v: string) => (v.endsWith("%") ? (parseFloat(v) / 100) * 255 : parseFloat(v));
const alphaOf = (v: string | undefined) => (v === undefined ? 1 : v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** One colour token as channels and alpha, or null for anything that is not a colour. */
export function parseColour(token: string): Parsed | null {
  const t = token.trim().toLowerCase();
  if (t.startsWith("#")) return parseHex(t);
  if (NAMED[t]) return parseHex(NAMED[t]);
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(t);
  if (!fn) return null;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (fn[1]!.startsWith("rgb")) {
    const rgb = parts.slice(0, 3).map(channel);
    if (rgb.some((x) => !Number.isFinite(x))) return null;
    return { rgb: rgb.map((x) => Math.round(Math.min(255, Math.max(0, x)))) as Rgb, alpha: alphaOf(parts[3]) };
  }
  const h = parseFloat(parts[0]!);
  const s = parseFloat(parts[1]!) / 100;
  const l = parseFloat(parts[2]!) / 100;
  if (![h, s, l].every(Number.isFinite)) return null;
  return { rgb: hslToRgb(((h % 360) + 360) % 360, s, l), alpha: alphaOf(parts[3]) };
}

function formatColour({ rgb, alpha }: Parsed): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(alpha * 1000) / 1000})`;
}

/** One colour token, a `url(...)` passed over whole (so `url(red.png)` is not red), or a word. */
const TOKEN = /url\([^()]*\)|#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^()]*\)|\b[a-z]+\b/gi;

/** Every colour inside one declaration's value, moved for its role; a gradient's stops each move. */
export function mapValue(value: string, role: Role, theme: DarkTheme): string {
  return value.replace(TOKEN, (tok) => {
    if (/^url\(/i.test(tok)) return tok;
    const parsed = parseColour(tok);
    return parsed ? formatColour({ rgb: mapColour(parsed.rgb, role, theme), alpha: parsed.alpha }) : tok;
  });
}

/** Which properties carry a colour, and as what. */
function roleOf(prop: string): Role | null {
  if (["color", "-webkit-text-fill-color", "caret-color", "text-decoration-color", "column-rule-color"].includes(prop)) return "fg";
  if (prop === "background" || prop === "background-color" || prop === "background-image") return "bg";
  if (prop === "outline" || prop === "outline-color" || prop.startsWith("border")) return /radius|width|spacing|collapse|style|image/.test(prop) ? null : "border";
  return null;
}

/** The first `:` outside quotes and parentheses, or -1. */
function topLevelColon(piece: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < piece.length; i += 1) {
    const ch = piece[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

/** Split a declaration list on `;` outside quotes and parentheses, rewriting each value; anything unchanged comes back as it was. */
export function rewriteDeclarations(text: string, fn: (prop: string, value: string) => string | null): string {
  let out = "";
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  const flush = (end: number, sep: string) => {
    const piece = text.slice(start, end);
    const colon = topLevelColon(piece);
    if (colon === -1) {
      out += piece + sep;
      return;
    }
    const next = fn(piece.slice(0, colon).trim().toLowerCase(), piece.slice(colon + 1));
    out += (next === null ? piece : piece.slice(0, colon + 1) + next) + sep;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      flush(i, ";");
      start = i + 1;
    }
  }
  flush(text.length, "");
  return out;
}

/** One declaration list: an inline `style`, or the inside of one CSS block. */
export function recolourDeclarations(text: string, theme: DarkTheme): string {
  return rewriteDeclarations(text, (prop, value) => {
    const role = roleOf(prop);
    return role ? mapValue(value, role, theme) : null;
  });
}

/** A whole stylesheet: each run between braces is a declaration list; a selector there has no colour property, so it passes through. */
export function recolourStylesheet(css: string, theme: DarkTheme): string {
  let out = "";
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "}") {
      out += recolourDeclarations(css.slice(start, i), theme) + ch;
      start = i + 1;
    }
  }
  return out + recolourDeclarations(css.slice(start), theme);
}

/** Does this message bring its own dark design? */
export function hasOwnDarkMode(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll("style")).some((s) => /prefers-color-scheme/i.test(s.textContent ?? ""));
}

/** Recolour a parsed body in place: inline styles, `bgcolor` and `color` attributes, and `<style>` blocks. Images are left alone. */
export function recolourFragment(root: ParentNode, theme: DarkTheme): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const tag = el.tagName.toLowerCase();
    if (tag === "style") {
      el.textContent = recolourStylesheet(el.textContent ?? "", theme);
      continue;
    }
    const style = el.getAttribute("style");
    if (style) el.setAttribute("style", recolourDeclarations(style, theme));
    const bg = el.getAttribute("bgcolor");
    if (bg) el.setAttribute("bgcolor", mapValue(bg, "bg", theme));
    const fg = el.getAttribute("color");
    if (fg) el.setAttribute("color", mapValue(fg, tag === "hr" ? "border" : "fg", theme));
  }
}

/**
 * A body as HTML, recoloured for a dark page. Parsed in a <template>, which is
 * inert: nothing in it loads or runs while it is rewritten.
 */
export function recolourHtml(html: string, theme: DarkTheme): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  if (hasOwnDarkMode(tpl.content)) return html;
  recolourFragment(tpl.content, theme);
  return tpl.innerHTML;
}
