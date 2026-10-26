import { useMemo } from "react";
import contractPlan from "@mycity/contract/plan.js";
import type { Opens } from "@mycity/contract/plan.js";
import { createDeliveryPlan, screenOpens } from "@mycity/ui";
import { MODULES } from "@/shell/catalogue";
import { moduleKeyOf } from "./routes";

/**
 * What opens where in the staff app (FRONTEND_FOUNDATION F14): the delivery
 * plan from docs/PROGRESS.md and MILESTONES §4, read at build time, bound to
 * this app. The rule lives in @mycity/contract/plan, which the API decides by too:
 *
 *   production  a screen opens when its PROGRESS row has API, UI and Mobile ticked
 *   staging     a screen opens as soon as API is ticked, on the seeded data
 *   mock        laptops and CI only: the Prototype View switch, Full Design or
 *               As Delivered at the current milestone
 *
 * Before that, the shell shows Coming Soon (shell/Planned.tsx).
 */
export const plan = createDeliveryPlan(__DELIVERY_PLAN__, {
  viewKey: "mc-view",
  mode: import.meta.env.VITE_API_MODE,
  dev: import.meta.env.DEV,
});

/** The plan's key for one screen: "<PROGRESS section>|<tab slug>". */
export const planKey = (moduleKey: string, tab: string) => contractPlan.planKey(moduleKey, tab);

/** Should this screen open, or show Coming Soon? */
export const useScreenState = (moduleKey: string, tab: string) => plan.useScreenState(planKey(moduleKey, tab));

/** The screen a link lands on: "/expenses?tab=approvals&id=…" is Expenses, Approvals; null for a link that is not a screen. */
export function screenOfLink(href: string): { moduleKey: string; tab: string | null } | null {
  return contractPlan.screenOfLink(href, moduleKeyOf);
}

/** What opens in this build, for a whole list at once: a screen, a module (any of its tabs) and the screen a link lands on. */
export type { Opens };

/** This app's tabs of a module, by the shell's catalogue; undefined for no module. */
const tabsOf = (moduleKey: string) => MODULES.find((m) => m.key === moduleKey)?.tabs.map((t) => t.slug);

/** The module and link answers from the one screen rule; a link outside the app's screens is never held back. */
export function opensFrom(screen: (moduleKey: string, tab: string) => boolean): Opens {
  return contractPlan.opensFrom(screen, tabsOf, moduleKeyOf);
}

/**
 * The same rule as useScreenState, for lists: ⌘K and Home leave out what would only open
 * Coming Soon (an Expenses card or request before Milestone 8), for every role.
 */
export function useOpens(): Opens {
  const rule = plan.useOpenRule();
  const { view } = plan.useView();
  return useMemo(() => {
    const current = plan.currentMilestone();
    return opensFrom((moduleKey, tab) => screenOpens(plan.screenOf(planKey(moduleKey, tab)), rule, view, current));
  }, [rule, view]);
}
