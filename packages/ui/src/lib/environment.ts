/**
 * Which environment a page is talking to (MILESTONES §6, A4: staging is marked,
 * never crippled), for both apps. The same build runs on staging and
 * production, so it is decided at runtime, never at build time:
 *
 *   - the address: hub.staging.mycityapp.io and go.staging.mycityapp.io (also set
 *     before first paint by each app's index.html, so the tab icon never flashes in late);
 *   - the API's own word: `X-Mycity-Environment: staging` on any response
 *     (src/middleware/environment-marker.js), passed to noteEnvironmentHeader by
 *     each app's API client.
 *
 * Staging sets `data-env="staging"` on <html>, which opens screens by the
 * staging rule (lib/plan.ts, F14). It also swaps the tab icon for
 * /favicon-staging.svg (the pin on amber) and gives the browser's own bar the
 * staging amber (`theme-color`, read from the --warning token), so a staging tab
 * is told apart from a live one even when the page is out of view. No bar is
 * drawn on the page itself: the address already says staging (TB, 17/10/2026).
 */
import { useSyncExternalStore } from "react";

/** Staging, or anything else (production, a laptop, CI). */
export type Environment = "staging" | "other";

const listeners = new Set<() => void>();
const root = () => document.documentElement;

/** A staging host name: hub.staging.mycityapp.io, go.staging.mycityapp.io. */
export const isStagingHost = (host: string): boolean => /(^|\.)staging\./.test(host);

/** Marks the page as staging: the attribute, the amber tab icon and the browser bar colour. */
export function markStaging(): void {
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
export function noteEnvironmentHeader(value: string | null): void {
  if (value === "staging") markStaging();
}

/**
 * Reads the address once at start. `allowQuery` (development only) lets
 * `?env=staging` show the staging marks on a laptop.
 */
export function initEnvironment(options: { allowQuery?: boolean } = {}): void {
  if (isStagingHost(window.location.hostname)) markStaging();
  if (options.allowQuery && new URLSearchParams(window.location.search).get("env") === "staging") markStaging();
}

/** The environment in force, re-rendering when the API reveals staging. */
export function useEnvironment(): Environment {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (root().getAttribute("data-env") === "staging" ? "staging" : "other"),
    () => "other" as Environment,
  );
}
