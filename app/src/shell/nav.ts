import type { BottomBarItem, LauncherGroup, RailItem } from "@mycity/ui";
import type { NavBadges } from "@/api/types/identity";
import { hrefFor } from "@/lib/routes";
import { AREAS, BOTTOM_BAR, type ModuleDef } from "./catalogue";

/**
 * The shell's navigation, built from the modules a person may open (access.ts,
 * from the /me grants) and the badge counts. Hiding is a courtesy; the API
 * refuses what a grant does not allow.
 *
 *   desktop  the Rail: every module, grouped by area
 *   phone    the BottomBar (F16): Home, Workspace, Community, Self-Service, More;
 *            the MoreSheet (F17): the area modules as one-word tiles, four to a row
 */

/** The rail's items, in catalogue order. */
export function railItems(modules: ModuleDef[], badges: NavBadges | undefined): RailItem[] {
  return modules.map((m) => ({ key: m.key, label: m.label, icon: m.icon, href: hrefFor(m.key), group: m.area || undefined, count: badges?.[m.key] }));
}

/** The key the bottom bar marks for a module: its own place, or More for everything else. */
export const bottomKey = (moduleKey: string | null): string | null =>
  moduleKey && (BOTTOM_BAR as readonly string[]).includes(moduleKey) ? moduleKey : moduleKey ? "more" : null;

/** The bottom bar's five places. A place the person may not open is left out (in practice everyone holds all four). */
export function bottomItems(modules: ModuleDef[], badges: NavBadges | undefined, openMore: () => void, moreOpen: boolean): BottomBarItem[] {
  const places: BottomBarItem[] = BOTTOM_BAR.flatMap((key) => {
    const m = modules.find((x) => x.key === key);
    return m ? [{ key: m.key, label: m.short, icon: m.icon, href: hrefFor(m.key), count: badges?.[m.key] }] : [];
  });
  const moreCount = modules.filter((m) => !(BOTTOM_BAR as readonly string[]).includes(m.key)).reduce((n, m) => n + (badges?.[m.key] ?? 0), 0);
  return [...places, { key: "more", label: "More", icon: "grid", onSelect: openMore, expanded: moreOpen, count: moreCount }];
}

/** More's tiles: every module with an area that the person may open, grouped Work, People, Business, System. */
export function moreGroups(modules: ModuleDef[], badges: NavBadges | undefined): LauncherGroup[] {
  return AREAS.map((area) => ({
    label: area,
    tiles: modules.filter((m) => m.area === area).map((m) => ({ key: m.key, label: m.short, icon: m.icon, href: hrefFor(m.key), count: badges?.[m.key] })),
  }));
}
