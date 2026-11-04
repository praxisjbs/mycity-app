import { useCallback } from "react";
import type { AiScreenContext } from "@mycity/contract/contract.gen.ts";
import { goHistory } from "@mycity/ui";
import { hrefFor, moduleKeyOf } from "@/lib/routes";
import { useRouter } from "@/lib/router";
import { useTrail } from "@/lib/trail";
import { moduleByKey } from "@/shell/catalogue";

/**
 * The screen Praxis AI was opened from (docs/guides/praxis-ai.md §1.2 decision 12). The opener's
 * address travels as `from` on the full-screen Praxis AI's address, so a reload keeps it, and is
 * read two ways: as the question's context (AiScreenContext: the module, the tab, the record open
 * there, its search and its filters, so "these" means that screen's records), and as where Back
 * goes. On a phone the floating button's chat reads the screen underneath the same way.
 */

/** The address keys that are the shell's or the router's own, never one of a screen's filters. */
const NOT_FILTERS = new Set(["tab", "id", "q", "page", "sort", "action", "new", "from", "n", "pane", "step", "view", "env", "screen"]);
const FILTER_KEY = /^[a-z][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The module and tab an address opens, from the shell's catalogue; null off a screen. */
function screenOf(address: string): { module: string; tab: string; url: URL } | null {
  let url: URL;
  try {
    url = new URL(address, "http://hub.invalid");
  } catch {
    return null;
  }
  const seg = url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  if (!seg) return null;
  const module = moduleKeyOf(seg);
  const mod = moduleByKey(module);
  if (!mod) return null;
  const tab = url.searchParams.get("tab") ?? mod.tabs[0]?.slug;
  if (!tab || !mod.tabs.some((t) => t.slug === tab)) return null;
  return { module, tab, url };
}

/** The question's context for an address: its screen, the record open there, its search and its filters. */
export function contextOf(address: string | null | undefined): AiScreenContext | null {
  if (!address) return null;
  const screen = screenOf(address);
  if (!screen) return null;
  const { module, tab, url } = screen;
  const ctx: AiScreenContext = { module, tab };
  const id = url.searchParams.get("id");
  if (id && UUID.test(id)) ctx.id = id;
  const q = url.searchParams.get("q")?.trim();
  if (q) ctx.q = q.slice(0, 200);
  const filters: Record<string, string> = {};
  for (const [k, v] of url.searchParams) if (!NOT_FILTERS.has(k) && FILTER_KEY.test(k) && v && v.length <= 200) filters[k] = v;
  if (Object.keys(filters).length) ctx.filters = filters;
  return ctx;
}

/** The full-screen Praxis AI, opened from `address` (or from nowhere: ⌘K, the menu), with the screen as `from`. */
export function askHref(address: string | null): string {
  return hrefFor("praxis_ai", "ask", address && screenOf(address) && !address.startsWith(`/${"praxis-ai"}`) ? { from: address } : {});
}

/** The screen `from` names, in words (People · Leave), for Back; null when there is no screen to return to. */
export function fromLabel(from: string | null | undefined): string | null {
  if (!from) return null;
  const screen = screenOf(from);
  if (!screen) return null;
  const mod = moduleByKey(screen.module)!;
  const tab = mod.tabs.find((t) => t.slug === screen.tab)!;
  return mod.tabs.length > 1 ? `${mod.label} · ${tab.label}` : mod.label;
}

/** The same place: path and query, whatever the order of the query's keys. */
function sameAddress(a: string, b: string): boolean {
  const x = new URL(a, "http://hub.invalid");
  const y = new URL(b, "http://hub.invalid");
  const sorted = (p: URLSearchParams) => [...p].sort(([k1], [k2]) => k1.localeCompare(k2)).toString();
  return x.pathname === y.pathname && sorted(x.searchParams) === sorted(y.searchParams);
}

/**
 * Back from the full-screen Praxis AI (decision 12): to the screen it was opened from, as a step
 * back in the window's history when that screen is the step behind (so its scroll and filters are
 * as they were, F29), else by its address; with no screen to return to, to History.
 */
export function useBackTo(from: string | null): () => void {
  const { navigate } = useRouter();
  const trail = useTrail();
  return useCallback(() => {
    if (!from) {
      navigate(hrefFor("praxis_ai", "history"));
      return;
    }
    const behind = trail.places[trail.index - 1];
    if (behind && sameAddress(behind.url, from)) goHistory(-1);
    else navigate(from);
  }, [from, trail, navigate]);
}
