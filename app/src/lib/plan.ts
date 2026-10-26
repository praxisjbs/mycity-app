import { useMemo } from "react";
import { createDeliveryPlan, screenOpens } from "@mycity/ui";
import { MODULES } from "@/shell/catalogue";
import { moduleKeyOf } from "./routes";

/**
 * What opens where in the staff app (FRONTEND_FOUNDATION F14): the delivery
 * plan from docs/PROGRESS.md and MILESTONES §4, read at build time, bound to
 * this app. The rule lives in @mycity/ui (lib/plan.ts):
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

/** PROGRESS.md's section heading for each module key. */
const SECTION: Record<string, string> = {
  home: "Home", workspace: "My Workspace", ess: "Employee Self-Service", community: "Staff Community", mailbox: "Mailbox",
  people: "People", performance: "Performance", queries: "Queries & Sanctions", recruitment: "Recruitment", payroll: "Payroll",
  partnerships: "Partnerships", expenses: "Expenses", knowledge: "Knowledge Hub", praxis_ai: "Praxis AI", ai_control: "AI Control",
  settings: "Settings",
};

/** The plan's key for one screen: "<PROGRESS section>|<tab slug>". */
export const planKey = (moduleKey: string, tab: string) => `${SECTION[moduleKey]}|${tab}`;

/** Should this screen open, or show Coming Soon? */
export const useScreenState = (moduleKey: string, tab: string) => plan.useScreenState(planKey(moduleKey, tab));

/** The screen a link lands on: "/expenses?tab=approvals&id=…" is Expenses, Approvals; null for a link that is not a screen. */
export function screenOfLink(href: string): { moduleKey: string; tab: string | null } | null {
  const found = /^\/([a-z][a-z-]*)(?:\?([^#]*))?/.exec(href);
  if (!found) return null;
  return { moduleKey: moduleKeyOf(found[1] ?? ""), tab: new URLSearchParams(found[2] ?? "").get("tab") };
}

/** What opens in this build, for a whole list at once: a screen, a module (any of its tabs) and the screen a link lands on. */
export interface Opens {
  screen: (moduleKey: string, tab: string) => boolean;
  module: (moduleKey: string) => boolean;
  link: (href: string) => boolean;
}

/** The module and link answers from the one screen rule; a link outside the app's screens is never held back. */
export function opensFrom(screen: (moduleKey: string, tab: string) => boolean): Opens {
  const module = (moduleKey: string) => (MODULES.find((m) => m.key === moduleKey)?.tabs ?? []).some((t) => screen(moduleKey, t.slug));
  const link = (href: string) => {
    const at = screenOfLink(href);
    if (!at || !MODULES.some((m) => m.key === at.moduleKey)) return true;
    return at.tab ? screen(at.moduleKey, at.tab) : module(at.moduleKey);
  };
  return { screen, module, link };
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
