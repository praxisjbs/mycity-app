import type { IconName, TrailItem } from "@mycity/ui";
import { moduleKeyOf } from "@/lib/routes";
import { AHEAD, BACK, type Place, type TrailView } from "@/lib/trail";
import { moduleByKey } from "./catalogue";

/**
 * What a place on the trail is called (FRONTEND_FOUNDATION F29): a record by
 * the name its screen gave it, else its screen's name, with the module (and,
 * for a record, its screen) under it, and the module's glyph.
 */
export function describePlace(place: Place): { title: string; sub?: string; icon: IconName } {
  const url = new URL(place.url, window.location.origin);
  const seg = url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || null;
  const mod = moduleByKey(seg ? moduleKeyOf(seg) : null);
  if (!mod) return { title: place.title ?? "MyCity App", icon: "home" };
  const tab = mod.tabs.find((t) => t.slug === url.searchParams.get("tab")) ?? mod.tabs[0];
  const screen = tab?.label ?? mod.label;
  if (url.searchParams.get("id")) return { title: place.title ?? screen, sub: `${mod.label} · ${screen}`, icon: mod.icon };
  return { title: screen, sub: mod.label, icon: mod.icon };
}

/** Where an arrow goes, for its hover: a record's name, or the module and screen. */
export function nameOfPlace(place: Place | undefined): string | null {
  if (!place) return null;
  const d = describePlace(place);
  return new URL(place.url, window.location.origin).searchParams.get("id") || !d.sub ? d.title : `${d.sub} · ${d.title}`;
}

/** The trail as TrailMenu lists it: the one ahead, the place on screen, then up to BACK places back. */
export function trailItems({ places, index }: TrailView): TrailItem[] {
  const out: TrailItem[] = [];
  for (let offset = AHEAD; offset >= -BACK; offset--) {
    const place = places[index + offset];
    if (place) out.push({ offset, ...describePlace(place) });
  }
  return out;
}
