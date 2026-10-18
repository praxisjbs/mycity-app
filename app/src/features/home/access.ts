import type { Me } from "@/api/types/identity";
import { hasCapability, visibleModules, visibleTabs } from "@/shell/access";
import { moduleByKey } from "@/shell/catalogue";

/**
 * Who may use Home's tabs (docs/guides/home.md §8, §10.1). Every `home` viewer sees the
 * four tabs; Team, Alerts and Reports open to the holders of their capabilities, and
 * anyone else finds the tab in its place and locked (./Gated). ⌘K offers only a tab the
 * reader may use (src/shared/search/screens.js tabVisible, the same codes). Hiding is a
 * courtesy: the API refuses each tab's reads without the capability.
 */

/** The tabs a capability opens, and the codes that open each: any one of them will do. */
export const TAB_CAPABILITIES = {
  team: ["home.team"],
  alerts: ["alerts.clear", "alerts.manage"],
  reports: ["home.reports"],
} as const satisfies Record<string, readonly string[]>;

export type GatedTab = keyof typeof TAB_CAPABILITIES;

/**
 * May the person use this tab, or does it show them the locked state? Each code is written
 * out (scripts/check/capabilities.js reads them; a code in a variable could hide a typo), and
 * a test holds this to TAB_CAPABILITIES.
 */
export function mayUseTab(me: Me, tab: GatedTab): boolean {
  switch (tab) {
    case "team":
      return hasCapability(me, "home.team");
    case "alerts":
      return hasCapability(me, "alerts.clear") || hasCapability(me, "alerts.manage");
    case "reports":
      return hasCapability(me, "home.reports");
  }
}

/** May the person open this screen, as the navigation decides it (shell/access.ts)? */
export function reachable(me: Me, moduleKey: string, tab: string): boolean {
  const mod = moduleByKey(moduleKey);
  return !!mod && visibleModules(me).includes(mod) && visibleTabs(me, mod).some((t) => t.slug === tab);
}
