import { createDeliveryPlan } from "@mycity/ui";

/**
 * What opens where on the public site (FRONTEND_FOUNDATION F14): the delivery
 * plan from docs/PROGRESS.md ("Public site" rows) and MILESTONES §4, read at
 * build time, bound to this site. The rule lives in @mycity/ui (lib/plan.ts):
 * production opens a page when API, UI and Mobile are ticked, staging when API
 * is ticked, and the mock (laptops and CI only) has the Prototype View switch.
 * A stranger on production is never shown a milestone or a date.
 */
export const plan = createDeliveryPlan(__DELIVERY_PLAN__, {
  viewKey: "mc-public-view",
  mode: import.meta.env.VITE_API_MODE,
  dev: import.meta.env.DEV,
});

/** Each page's row in PROGRESS.md's "Public site" section, by its path. */
export const PATH: Record<string, string> = {
  careers: "/jobs", vacancy: "/jobs/<slug>", apply: "/apply/<token>", assess: "/assess/<token>", sign: "/sign/<token>", verify: "/verify/<number>",
};

/** Should this page open, or show Coming Soon? */
export const useScreenState = (page: string) => plan.useScreenState(`Public site|${PATH[page]}`);
