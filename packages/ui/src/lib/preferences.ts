/**
 * Theme, density and text size, per person (F5, F30). Each is an attribute on
 * <html> (`data-theme`, `data-density`, `data-text-size`) that tokens.css reads,
 * and a localStorage key that the staff app's boot script reads before first
 * paint, so nobody sees a flash of the wrong theme. Storage is a per-device
 * convenience; when it is blocked the choice still applies for the visit.
 *
 *   theme      "light" | "dark" | "system" (the device's setting; nothing stored)
 *   density    "compact" (the default) | "comfortable"
 *   text size  "small" | "default" (nothing stored) | "large" | "largest"
 *
 * Settings · Appearance may set the theme and density a person starts with
 * (applyDefaults): they apply only while that person has chosen none here.
 */
import { useCallback, useSyncExternalStore } from "react";

/** The theme in force: light or dark. */
export type Theme = "light" | "dark";
/** What a person may choose: light, dark, or the device's setting. */
export type ThemeChoice = Theme | "system";
/** Compact (the default) or Comfortable. */
export type Density = "compact" | "comfortable";
/** A person's text size: the type scale, and on desktop the controls and rows with it (F30). */
export type TextSize = "small" | "default" | "large" | "largest";

/** The text sizes in the order a picker offers them, with their names. */
export const TEXT_SIZES: ReadonlyArray<readonly [TextSize, string]> = [
  ["small", "Small"],
  ["default", "Default"],
  ["large", "Large"],
  ["largest", "Largest"],
];

const keys = { theme: "mc-theme", density: "mc-density", textSize: "mc-text-size" };

/**
 * Sets the storage keys. The staff app uses the defaults (mc-theme, mc-density);
 * the public site keeps its visitors' own key (`mc-public-theme`). Call once,
 * before the first render, with the key the app's index.html reads.
 */
export function configurePreferences(options: { themeKey?: string; densityKey?: string }): void {
  if (options.themeKey) keys.theme = options.themeKey;
  if (options.densityKey) keys.density = options.densityKey;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const root = () => document.documentElement;
const DARK_QUERY = "(prefers-color-scheme: dark)";

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage can be blocked; the choice still applies for this visit */
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    mq.removeEventListener("change", listener);
  };
}

/** What the person chose: light, dark, or the device's setting. */
export function themeChoice(): ThemeChoice {
  const set = root().getAttribute("data-theme");
  return set === "light" || set === "dark" ? set : "system";
}

/** The theme in force now: the choice, or the device's setting. */
export function currentTheme(): Theme {
  const choice = themeChoice();
  if (choice !== "system") return choice;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** Applies and remembers a theme choice; "system" clears the stored one. */
export function setTheme(choice: ThemeChoice): void {
  if (choice === "system") root().removeAttribute("data-theme");
  else root().setAttribute("data-theme", choice);
  store(keys.theme, choice === "system" ? null : choice);
  notify();
}

/** The theme in force, the person's choice, a light and dark toggle, and the setter. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as Theme);
  const choice = useSyncExternalStore(subscribe, themeChoice, () => "system" as ThemeChoice);
  const toggle = useCallback(() => setTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, choice, toggle, setTheme };
}

/** The density in force: compact unless comfortable is set. */
export function currentDensity(): Density {
  return root().getAttribute("data-density") === "comfortable" ? "comfortable" : "compact";
}

/** Applies and remembers a density. */
export function setDensity(density: Density): void {
  if (density === "comfortable") root().setAttribute("data-density", "comfortable");
  else root().removeAttribute("data-density");
  store(keys.density, density === "comfortable" ? density : null);
  notify();
}

/** Compact (the default on desktop) or Comfortable, remembered per person (F5). */
export function useDensity() {
  const density = useSyncExternalStore(subscribe, currentDensity, () => "compact" as Density);
  const toggle = useCallback(() => setDensity(currentDensity() === "compact" ? "comfortable" : "compact"), []);
  return { density, toggle, setDensity };
}

/** The text size in force: Default unless one is set. */
export function currentTextSize(): TextSize {
  const v = root().getAttribute("data-text-size");
  return v === "small" || v === "large" || v === "largest" ? v : "default";
}

/** Applies and remembers a text size; Default clears the stored one. */
export function setTextSize(size: TextSize): void {
  if (size === "default") root().removeAttribute("data-text-size");
  else root().setAttribute("data-text-size", size);
  store(keys.textSize, size === "default" ? null : size);
  notify();
}

/** Small, Default, Large or Largest, remembered per person on this device (F30). */
export function useTextSize() {
  const size = useSyncExternalStore(subscribe, currentTextSize, () => "default" as TextSize);
  return { size, setTextSize };
}

/**
 * The organisation's theme and density (Settings · Appearance) for a person who has chosen
 * neither on this device: a person's own choice always wins, and is never stored by this.
 */
export function applyDefaults(defaults: { theme: ThemeChoice; density: Density }): void {
  if (read(keys.theme) === null) {
    if (defaults.theme === "system") root().removeAttribute("data-theme");
    else root().setAttribute("data-theme", defaults.theme);
  }
  if (read(keys.density) === null) {
    if (defaults.density === "comfortable") root().setAttribute("data-density", "comfortable");
    else root().removeAttribute("data-density");
  }
  notify();
}
