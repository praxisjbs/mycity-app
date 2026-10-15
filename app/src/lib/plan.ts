import { createDeliveryPlan } from "@mycity/ui";

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
  partnerships: "Partnerships", expenses: "Expenses", knowledge: "Knowledge Hub", praxis_ai: "Praxis AI", settings: "Settings",
};

/** The plan's key for one screen: "<PROGRESS section>|<tab slug>". */
export const planKey = (moduleKey: string, tab: string) => `${SECTION[moduleKey]}|${tab}`;

/** Should this screen open, or show Coming Soon? */
export const useScreenState = (moduleKey: string, tab: string) => plan.useScreenState(planKey(moduleKey, tab));
