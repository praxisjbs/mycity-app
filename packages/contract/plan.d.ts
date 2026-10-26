/** Types for plan.js, the delivery plan the staff app, the public site and the API share (F14). */

/** One milestone from MILESTONES §4. */
export interface PlanMilestone {
  key: string;
  n: number;
  name: string;
  /** Its demo day, ISO; null when the table gives none. */
  demo: string | null;
}

/** One screen's row in PROGRESS: its milestone, and which ticks it has. */
export interface PlanScreen {
  m: string;
  /** API ticked: staging opens it. */
  api: boolean;
  /** API, UI and Mobile all ticked: production opens it. */
  delivered: boolean;
}

/** The whole plan, as readPlan reads it. */
export interface DeliveryPlan {
  milestones: PlanMilestone[];
  screens: Record<string, PlanScreen>;
}

/** Which rule decides what opens. */
export type OpenRule = "production" | "staging" | "mock";

/** The Prototype View switch, in mock mode only. */
export type PlanView = "full" | "delivered";

/** What a whole list asks of the plan. */
export interface Opens {
  screen: (moduleKey: string, tab: string) => boolean;
  module: (moduleKey: string) => boolean;
  link: (href: string) => boolean;
}

export declare const SECTIONS: Readonly<Record<string, string>>;
export declare function readPlan(read: (rel: string) => string): DeliveryPlan;
export declare function openRule(options: { mode: string | undefined; dev: boolean; environment: "staging" | "other" }): OpenRule;
export declare function currentMilestone(plan: DeliveryPlan, today: string): PlanMilestone | undefined;
export declare function screenOpens(screen: PlanScreen | null, rule: OpenRule, view: PlanView, current?: PlanMilestone): boolean;
export declare function planKey(moduleKey: string, tab: string): string;
export declare function screenOfLink(href: string, moduleKeyOf: (segment: string) => string): { moduleKey: string; tab: string | null } | null;
export declare function opensFrom(
  screen: (moduleKey: string, tab: string) => boolean,
  tabsOf: (moduleKey: string) => string[] | undefined,
  moduleKeyOf: (segment: string) => string,
): Opens;

declare const plan: {
  SECTIONS: typeof SECTIONS;
  readPlan: typeof readPlan;
  openRule: typeof openRule;
  currentMilestone: typeof currentMilestone;
  screenOpens: typeof screenOpens;
  planKey: typeof planKey;
  screenOfLink: typeof screenOfLink;
  opensFrom: typeof opensFrom;
};
export default plan;
