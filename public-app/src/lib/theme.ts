import { useCallback, useSyncExternalStore } from "react";

/**
 * Light or dark, by the visitor's own toggle; a visitor who never toggles gets
 * their device setting. The choice is a per-browser convenience (localStorage,
 * read before first paint in index.html). It is not a session: the public site
 * holds none (A9).
 */
type Theme = "light" | "dark";
const KEY = "mc-public-theme";
const listeners = new Set<() => void>();
const root = () => document.documentElement;

function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function currentTheme(): Theme {
  const set = root().getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return systemDark() ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  root().setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage can be blocked; the theme still applies for this visit */
  }
  listeners.forEach((l) => l());
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", l);
      return () => {
        listeners.delete(l);
        mq.removeEventListener("change", l);
      };
    },
    currentTheme,
    () => "light" as Theme,
  );
  const toggle = useCallback(() => setTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}
