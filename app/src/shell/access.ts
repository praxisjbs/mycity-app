import type { Me } from "@/api/types/identity";
import { MODULES, type ModuleDef, type TabDef } from "./catalogue";

/**
 * What the shell shows a person. A courtesy only: the API refuses whatever a
 * grant does not allow, so a hidden button is never the protection.
 */
export function visibleModules(me: Me): ModuleDef[] {
  return MODULES.filter((m) => me.grants[m.key]?.includes("view") || (m.key === "settings" && (healthView(me) || integrationsView(me))));
}

/**
 * Status, Performance and Faults sit in Settings but are held by system_health
 * (docs/guides/system-health.md §8), and Integrations by integrations
 * (docs/guides/integrations.md §8): the Implementation Team and the System Administrator
 * see them, Operations & People and Management do not, and a person who holds one of
 * these keys without Settings still reaches its tabs from a notice. ⌘K answers the same
 * way (src/shared/search/screens.js).
 */
const SYSTEM_HEALTH_TABS = ["status", "performance", "faults"];
const healthView = (me: Me) => me.is_ceo || !!me.grants.system_health?.includes("view");
const integrationsView = (me: Me) => me.is_ceo || !!me.grants.integrations?.includes("view");

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
     * Home keeps its four tabs for everyone who may open it. Team, Alerts and Reports
     * follow capabilities: a tab whose capability the person lacks draws its locked state
     * (features/home/access.ts, docs/guides/home.md §10.1), so the tabs never move, and
     * only ⌘K hides it (src/shared/search/screens.js tabVisible).
     */
    /* Knowledge Hub · Policies is where policies are written (docs/guides/policies.md §8); staff read theirs on Policy Updates. */
    if (mod.key === "knowledge" && t.slug === "policies") return hasCapability(me, "policies.manage");
    if (mod.key === "settings" && SYSTEM_HEALTH_TABS.includes(t.slug)) return healthView(me);
    if (mod.key === "settings" && t.slug === "integrations") return integrationsView(me);
    if (mod.key === "settings") return !!FULL(me);
    /* A line manager decides their team's leave on People · Leave, the list scoped to their team (docs/guides/ess.md §2). */
    if (mod.key === "people" && !FULL(me)) return t.slug === "attendance" || t.slug === "organogram" || (t.slug === "leave" && me.manages_people);
    /* Announcements is the posting and read-tracking side, for those who post (`announcements.post`, as every route asks); staff read them in #announcements. */
    if (mod.key === "community" && t.slug === "announcements") return hasCapability(me, "announcements.post");
    if (mod.key === "queries" && !FULL(me)) return t.slug === "queries";
    if (mod.key === "expenses" && !FULL(me)) return ["my-requests", "approvals", "budgets"].includes(t.slug) && (t.slug !== "approvals" || me.manages_people);
    if (mod.key === "performance" && !FULL(me) && !me.manages_people) return t.slug !== "analytics";
    return true;
  });
}
