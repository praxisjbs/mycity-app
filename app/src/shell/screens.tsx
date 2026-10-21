import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * One lazily loaded bundle per module, so the first paint carries only the
 * shell and the module in view. Each module's default export renders its tabs:
 * `<Module tab="employees" id="…" />`.
 */
export interface ModuleScreenProps {
  tab: string;
  id: string | null;
}

type Loader = LazyExoticComponent<ComponentType<ModuleScreenProps>>;

export const SCREENS: Record<string, Loader> = {
  home: lazy(() => import("@/features/home")),
  workspace: lazy(() => import("@/features/workspace")),
  ess: lazy(() => import("@/features/ess")),
  community: lazy(() => import("@/features/community")),
  mailbox: lazy(() => import("@/features/mailbox")),
  people: lazy(() => import("@/features/people")),
  performance: lazy(() => import("@/features/performance")),
  queries: lazy(() => import("@/features/queries")),
  recruitment: lazy(() => import("@/features/recruitment")),
  payroll: lazy(() => import("@/features/payroll")),
  partnerships: lazy(() => import("@/features/partnerships")),
  expenses: lazy(() => import("@/features/expenses")),
  knowledge: lazy(() => import("@/features/knowledge")),
  praxis_ai: lazy(() => import("@/features/assistant")),
  ai_control: lazy(() => import("@/features/ai-control")),
  settings: lazy(() => import("@/features/settings")),
};
