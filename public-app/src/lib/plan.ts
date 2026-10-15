import { useCallback, useSyncExternalStore } from "react";
import { useEnvironment } from "./environment";
import { todayIso } from "@mycity/ui";

/**
 * Which public pages are open, by the delivery plan (docs/PROGRESS.md and
 * MILESTONES.md, read at build time into __DELIVERY_PLAN__ by vite.config.ts).
 *
 * Production: a screen opens once its PROGRESS row has API, UI and Mobile all
 * ticked. Until then it shows Coming Soon with its milestone and date.
 *
 * Everywhere else (development, the demo build, staging): the prototype view
 * switch, as in demo.html's ESS bar. "Full Design" (the default) opens every
 * screen; "As Delivered at Mn" opens what is delivered by the current milestone
 * and shows Coming Soon for the rest. The current milestone is the earliest one
 * not yet done: a milestone is done once its demo day has passed or every one of
 * its screens is ticked. It is worked out from today's date, so it moves on by
 * itself. Re-planning a screen is a change to the M column in PROGRESS.
 */
export type Milestone = (typeof __DELIVERY_PLAN__.milestones)[number];
export type View = "full" | "delivered";

const PLAN = __DELIVERY_PLAN__;
export const MILESTONES = PLAN.milestones;

/** Each page's row in PROGRESS.md's "Public site" section, by its path. */
export const PATH: Record<string, string> = {
  careers: "/jobs", vacancy: "/jobs/<slug>", apply: "/apply/<token>", assess: "/assess/<token>", sign: "/sign/<token>", verify: "/verify/<number>",
};

export function planOf(page: string): { m: string; delivered: boolean } | null {
  return PLAN.screens[`Public site|${PATH[page]}`] ?? null;
}
export const milestone = (key: string): Milestone | undefined => MILESTONES.find((m) => m.key === key);

/** The milestone being delivered now: the earliest one with screens that is neither past its demo day nor fully ticked. */
export function currentMilestone(today = todayIso()): Milestone | undefined {
  const rows = Object.values(PLAN.screens);
  const planned = MILESTONES.filter((m) => m.n >= 1 && rows.some((r) => r.m === m.key));
  const done = (m: Milestone) => (!!m.demo && m.demo < today) || rows.filter((r) => r.m === m.key).every((r) => r.delivered);
  return planned.find((m) => !done(m)) ?? planned[planned.length - 1];
}
const mNum = (key: string) => Number(key.slice(1));

/* The chosen view: a per-browser convenience, like the theme. */
const KEY = "mc-public-view";
const listeners = new Set<() => void>();
function readView(): View {
  try {
    return localStorage.getItem(KEY) === "delivered" ? "delivered" : "full";
  } catch {
    return "full";
  }
}
let view: View = readView();
export function setView(v: View) {
  view = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage can be blocked; the choice still holds for this visit */
  }
  listeners.forEach((l) => l());
}
export function useView() {
  const v = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => view, () => "full");
  return { view: v, setView: useCallback(setView, []) };
}

/** Production is a live build that is not on staging. Development and the demo build never are. */
export function useIsProduction(): boolean {
  const env = useEnvironment();
  return !import.meta.env.DEV && import.meta.env.VITE_API_MODE === "live" && env !== "staging";
}

/** Should this page open, or show Coming Soon? */
export function useScreenState(page: string): { open: boolean; plan: { m: string; delivered: boolean } | null; production: boolean } {
  const production = useIsProduction();
  const { view: v } = useView();
  const plan = planOf(page);
  if (production) return { open: !!plan?.delivered, plan, production };
  if (v === "full" || !plan) return { open: true, plan, production };
  const now = currentMilestone();
  return { open: plan.delivered || !now || mNum(plan.m) <= now.n, plan, production };
}
