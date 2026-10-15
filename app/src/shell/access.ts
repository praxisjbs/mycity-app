import type { Me } from "@/api/types/identity";
import { MODULES, type ModuleDef, type TabDef } from "./catalogue";

/**
 * What the shell shows a person. A courtesy only: the API refuses whatever a
 * grant does not allow, so a hidden button is never the protection.
 */
export function visibleModules(me: Me): ModuleDef[] {
  return MODULES.filter((m) => me.grants[m.key]?.includes("view"));
}

const FULL = (me: Me) => me.grants.settings?.includes("view") || me.is_ceo;

export function visibleTabs(me: Me, mod: ModuleDef): TabDef[] {
  return mod.tabs.filter((t) => {
    if (mod.key === "home" && t.slug === "team") return me.manages_people || me.is_ceo;
    if (mod.key === "home" && (t.slug === "reports" || t.slug === "alerts")) return FULL(me) || me.manages_people;
    if (mod.key === "people" && !FULL(me)) return t.slug === "attendance" || t.slug === "organogram";
    /* Announcements is the posting and read-tracking side; staff read them in #announcements. */
    if (mod.key === "community" && t.slug === "announcements") return !!me.grants.people?.includes("create");
    if (mod.key === "queries" && !FULL(me)) return t.slug === "queries";
    if (mod.key === "expenses" && !FULL(me)) return ["my-requests", "approvals", "budgets"].includes(t.slug) && (t.slug !== "approvals" || me.manages_people);
    if (mod.key === "performance" && !FULL(me) && !me.manages_people) return t.slug !== "analytics";
    return true;
  });
}
