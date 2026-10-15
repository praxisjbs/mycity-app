/* Screen URLs, with no React, so vite.config.ts can build the route list from them too. */

/** Module key ("praxis_ai") → URL segment ("praxis-ai"). */
export const segmentOf = (moduleKey: string) => moduleKey.replace(/_/g, "-");
/** URL segment → module key. */
export const moduleKeyOf = (segment: string) => segment.replace(/-/g, "_");

/** Build a screen URL: hrefFor("people", "employees", { id }) → "/people?tab=employees&id=…". */
export function hrefFor(moduleKey: string, tab?: string | null, extra: Record<string, string | null | undefined> = {}): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") params.set(k, v);
  const qs = params.toString();
  return `/${segmentOf(moduleKey)}${qs ? `?${qs}` : ""}`;
}
