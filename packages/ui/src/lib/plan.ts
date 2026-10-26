/**
 * What opens where, by the delivery plan (FRONTEND_FOUNDATION F14), for both
 * apps. The plan is read from the docs at build time (vite.shared.js
 * deliveryPlan(): each screen's milestone and its API, UI and Mobile ticks from
 * docs/PROGRESS.md; each milestone's name and demo date from MILESTONES §4) and
 * handed to the code as __DELIVERY_PLAN__. Each app binds it once:
 *
 *   export const plan = createDeliveryPlan(__DELIVERY_PLAN__, { viewKey: "mc-view", mode, dev });
 *   const { open, screen, rule } = plan.useScreenState("Employee Self-Service|my-profile");
 *
 * The rule, from where the build runs:
 *
 *   production  a live build on a production host: a screen opens when its
 *               PROGRESS row has API, UI and Mobile all ticked
 *   staging     a live build on a staging host (or a laptop on the live API):
 *               a screen opens as soon as API is ticked, so its owner can check
 *               it on the seeded data
 *   mock        the in-browser mock (laptops and CI only, never released): the
 *               Prototype View switch, Full Design (every screen) or As Delivered
 *               at the current milestone
 *
 * Before its rule opens it, a screen shows Coming Soon. Re-planning a screen is
 * a change to the M column in PROGRESS, nothing in code.
 */
import { useCallback, useSyncExternalStore } from "react";
import contractPlan from "@mycity/contract/plan.js";
import type * as Shared from "@mycity/contract/plan.js";
import { todayIso } from "./format";
import { useEnvironment } from "./environment";

/** One milestone from MILESTONES §4. */
export type PlanMilestone = Shared.PlanMilestone;
/** One screen's row in PROGRESS: its milestone, and which ticks it has. */
export type PlanScreen = Shared.PlanScreen;
/** The whole plan, as vite.shared.js deliveryPlan() writes it. */
export type DeliveryPlan = Shared.DeliveryPlan;
/** Which rule decides what opens. */
export type OpenRule = Shared.OpenRule;
/** The Prototype View switch, in mock mode only. */
export type PlanView = Shared.PlanView;

/*
 * The rule itself is @mycity/contract/plan's, which the API decides by too (Need You, ⌘K, Home's
 * cards), so a screen the app shows as Coming Soon is never offered by the server either.
 */

/** The rule for where this build runs. */
export function openRule(options: { mode: string | undefined; dev: boolean; environment: "staging" | "other" }): OpenRule {
  return contractPlan.openRule(options);
}

/** The milestone being delivered now: the earliest one with screens that is neither past its demo day nor fully ticked. */
export function currentMilestone(plan: DeliveryPlan, today = todayIso()): PlanMilestone | undefined {
  return contractPlan.currentMilestone(plan, today);
}

/** Does this screen open under this rule? A screen missing from the plan opens only in mock mode. */
export function screenOpens(screen: PlanScreen | null, rule: OpenRule, view: PlanView, current?: PlanMilestone): boolean {
  return contractPlan.screenOpens(screen, rule, view, current);
}

/** What useScreenState returns. */
export interface ScreenState {
  open: boolean;
  /** The screen's row in the plan, or null when it has none. */
  screen: PlanScreen | null;
  rule: OpenRule;
  /** Shorthand for rule === "production": strangers on the public site see no milestone or date. */
  production: boolean;
}

/** Binds the plan to one app: its storage key for the view switch, its API mode and whether it is a dev server. */
export function createDeliveryPlan(plan: DeliveryPlan, options: { viewKey: string; mode: string | undefined; dev: boolean }) {
  const listeners = new Set<() => void>();
  const read = (): PlanView => {
    try {
      return localStorage.getItem(options.viewKey) === "delivered" ? "delivered" : "full";
    } catch {
      return "full";
    }
  };
  let view: PlanView = read();

  function setView(v: PlanView) {
    view = v;
    try {
      localStorage.setItem(options.viewKey, v);
    } catch {
      /* storage can be blocked; the choice still holds for this visit */
    }
    listeners.forEach((l) => l());
  }

  function useView() {
    const v = useSyncExternalStore(
      (l) => (listeners.add(l), () => listeners.delete(l)),
      () => view,
      () => "full" as PlanView,
    );
    return { view: v, setView: useCallback(setView, []) };
  }

  function useOpenRule(): OpenRule {
    return openRule({ mode: options.mode, dev: options.dev, environment: useEnvironment() });
  }

  function useScreenState(key: string): ScreenState {
    const rule = useOpenRule();
    const { view: v } = useView();
    const screen = plan.screens[key] ?? null;
    return { open: screenOpens(screen, rule, v, currentMilestone(plan)), screen, rule, production: rule === "production" };
  }

  return {
    milestones: plan.milestones,
    screenOf: (key: string): PlanScreen | null => plan.screens[key] ?? null,
    milestone: (key: string): PlanMilestone | undefined => plan.milestones.find((m) => m.key === key),
    currentMilestone: (today?: string) => currentMilestone(plan, today),
    setView,
    useView,
    useOpenRule,
    useScreenState,
  };
}

/** One app's bound plan. */
export type BoundPlan = ReturnType<typeof createDeliveryPlan>;
