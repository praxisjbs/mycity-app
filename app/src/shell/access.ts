import type { Me } from "@/api/types/identity";
import { MODULES, type ModuleDef, type TabDef } from "./catalogue";

/**
 * What the shell shows a person. A courtesy only: the API refuses whatever a
 * grant does not allow, so a hidden button is never the protection.
 */
export function visibleModules(me: Me): ModuleDef[] {
  return MODULES.filter((m) => me.grants[m.key]?.includes("view"));
}

/**
 * Does the person hold this capability, an authority inside a module beyond its six
 * actions (README §5.2)? The CEO holds every one, as requireCapability passes them.
 * src/shared/search/screens.js answers the same way for ⌘K.
 */
export function hasCapability(me: Me, code: string): boolean {
  return me.is_ceo || me.capabilities.includes(code);
}

const FULL = (me: Me) => me.grants.settings?.includes("view") || me.is_ceo;

export function visibleTabs(me: Me, mod: ModuleDef): TabDef[] {
  return mod.tabs.filter((t) => {
    /*
     * Home's Team, Alerts and Reports follow capabilities. A tab whose capability the
     * person lacks is hidden until that tab is built on the real API; from then it stays
     * in the menu and draws its locked state (docs/guides/home.md §10.1), and only ⌘K
     * hides it.
     */
    if (mod.key === "home" && t.slug === "team") return hasCapability(me, "home.team");
    if (mod.key === "home" && t.slug === "alerts") return hasCapability(me, "alerts.clear") || hasCapability(me, "alerts.manage");
    if (mod.key === "home" && t.slug === "reports") return hasCapability(me, "home.reports");
    if (mod.key === "people" && !FULL(me)) return t.slug === "attendance" || t.slug === "organogram";
    /* Announcements is the posting and read-tracking side; staff read them in #announcements. */
    if (mod.key === "community" && t.slug === "announcements") return !!me.grants.people?.includes("create");
    if (mod.key === "queries" && !FULL(me)) return t.slug === "queries";
    if (mod.key === "expenses" && !FULL(me)) return ["my-requests", "approvals", "budgets"].includes(t.slug) && (t.slug !== "approvals" || me.manages_people);
    if (mod.key === "performance" && !FULL(me) && !me.manages_people) return t.slug !== "analytics";
    return true;
  });
}
