/**
 * Settings · Appearance applied to the hub (F30; docs/guides/foundation.md §6.15). What /auth/me
 * hands over (the dark tokens when the palette is not MyCity's own, the two faces and the
 * defaults) is written into one <style> element: the dark tokens over tokens.css's two dark
 * blocks, the chosen dark and the device's, and the faces on <html>. Its selectors outrank
 * tokens.css's, so the order the stylesheets arrive in does not matter.
 *
 * The CSS is kept on this device (`mc-appearance-css`), with the defaults
 * (`mc-appearance-defaults`), for the staff app's boot script (app/public/boot.js), which paints
 * the saved palette before the bundle loads. Only token names and the colours the contract
 * derives pass into it.
 */
import { fontStack, loadFont } from "./fonts";
import { applyDefaults, type Density, type ThemeChoice } from "./preferences";

/** The contract's AppearanceApplied, as the shell receives it on /auth/me. */
export interface AppliedAppearance {
  dark: Record<string, string> | null;
  fonts: { heading: string; body: string };
  theme_default: ThemeChoice;
  density_default: Density;
}

/** The element and the keys the boot script reads; change them together. */
export const APPEARANCE_STYLE_ID = "mc-appearance";
const CSS_KEY = "mc-appearance-css";
const DEFAULTS_KEY = "mc-appearance-defaults";

const TOKEN = /^[a-z][a-z0-9-]*$/;
const COLOUR = /^(#[0-9A-Fa-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (?:0|1|0?\.\d+)\))$/;

/** A palette as CSS declarations, each token a colour the contract writes; anything else is left out. */
export function tokenDeclarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .filter(([name, value]) => TOKEN.test(name) && COLOUR.test(value))
    .map(([name, value]) => `--${name}: ${value};`)
    .join(" ");
}

/** The CSS for an appearance: the faces always, the dark palette when there is one. */
export function appearanceCss(a: AppliedAppearance): string {
  let css = `:root:root { --face-body: ${fontStack(a.fonts.body)}; --face-heading: ${fontStack(a.fonts.heading)}; }`;
  if (a.dark) {
    const dark = tokenDeclarations(a.dark);
    css += ` :root[data-theme="dark"], :root [data-theme="dark"] { ${dark} }`;
    css += ` @media (prefers-color-scheme: dark) { :root:root:not([data-theme="light"]) { ${dark} } }`;
  }
  return css;
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked; the appearance still applies for this visit */
  }
}

/** Applies an appearance to the page and keeps it for the next first paint. */
export function applyAppearance(a: AppliedAppearance): void {
  const css = appearanceCss(a);
  let el = document.getElementById(APPEARANCE_STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = APPEARANCE_STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  void loadFont(a.fonts.body);
  void loadFont(a.fonts.heading);
  applyDefaults({ theme: a.theme_default, density: a.density_default });
  remember(CSS_KEY, css);
  remember(DEFAULTS_KEY, JSON.stringify({ theme: a.theme_default, density: a.density_default }));
}
