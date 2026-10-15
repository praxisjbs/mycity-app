import { useSyncExternalStore } from "react";

/**
 * Which environment this page is talking to (MILESTONES §6, A4: staging is
 * marked, never crippled). The same build runs on staging and production, so
 * it is decided at runtime, never at build time:
 *
 *   - the address: hub.staging.mycityapp.io and go.staging.mycityapp.io (also set
 *     before first paint by index.html, so the bar never flashes in late);
 *   - the API's own word: `X-Mycity-Environment: staging` on any response
 *     (src/middleware/environment-marker.js), read by api/client.ts.
 *
 * Staging sets `data-env="staging"` on <html>; styles/index.css turns that into
 * --env-bar, the height the bar takes. It also swaps the tab icon for
 * /favicon-staging.svg (the pin on amber) and gives the browser's own bar the
 * staging amber (`theme-color`, read from the --warning token), so a staging tab
 * is told apart from a live one even when the page is out of view (MILESTONES §6).
 * In development, `?env=staging` shows all of it.
 */
type Env = "staging" | "other";
const listeners = new Set<() => void>();
const root = () => document.documentElement;

export const isStagingHost = (host: string) => /(^|\.)staging\./.test(host);

export function markStaging() {
  const first = root().getAttribute("data-env") !== "staging";
  root().setAttribute("data-env", "staging");
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) link.href = "/favicon-staging.svg";
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  const amber = getComputedStyle(root()).getPropertyValue("--warning").trim();
  if (amber) meta.content = amber;
  if (first) listeners.forEach((l) => l());
}

/** Called with each API response's X-Mycity-Environment value. */
export function noteEnvironmentHeader(value: string | null) {
  if (value === "staging") markStaging();
}

export function initEnvironment() {
  if (isStagingHost(window.location.hostname)) markStaging();
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("env") === "staging") markStaging();
}

export function useEnvironment(): Env {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (root().getAttribute("data-env") === "staging" ? "staging" : "other"),
    () => "other" as Env,
  );
}
