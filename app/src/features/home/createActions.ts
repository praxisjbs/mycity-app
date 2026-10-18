import type { IconName } from "@mycity/ui";
import type { Me } from "@/api/types/identity";
import { useScreenState } from "@/lib/plan";
import { hrefFor } from "@/lib/router";
import { hasCapability, visibleModules, visibleTabs } from "@/shell/access";
import { moduleByKey } from "@/shell/catalogue";

/**
 * Home's New (docs/guides/home.md §6 Overview, §10.1): a menu of the create actions the
 * reader holds, each opening the screen that owns it already asked to start (the screen's
 * own `?action=new`, or Workspace's `?new=1`). Home creates nothing itself.
 *
 * An action is offered only when the reader holds what it needs, may open its screen
 * (shell/access.ts, the same rule as the navigation), and the screen is open where this
 * build runs (F14: before its milestone it shows Coming Soon, and an action that lands on
 * Coming Soon is not offered).
 */
export interface CreateAction {
  key: string;
  /** Verb Noun, as the owning screen's own button reads. */
  label: string;
  icon: IconName;
  /** The owning screen, asked to start the action. */
  href: string;
}

interface Offer extends CreateAction {
  module: string;
  tab: string;
  holds: (me: Me) => boolean;
}

const OFFERS: Offer[] = [
  {
    key: "new_task",
    label: "New Task",
    icon: "check",
    module: "workspace",
    tab: "tasks",
    href: hrefFor("workspace", "tasks", { new: "1" }),
    holds: (me) => !!me.grants.workspace?.includes("create"),
  },
  {
    key: "request_leave",
    label: "Request Leave",
    icon: "calendar",
    module: "ess",
    tab: "my-leave",
    href: hrefFor("ess", "my-leave", { action: "new" }),
    holds: (me) => !!me.grants.ess?.includes("create"),
  },
  {
    key: "new_rule",
    label: "New Rule",
    icon: "alert",
    module: "home",
    tab: "alerts",
    href: hrefFor("home", "alerts", { action: "new" }),
    holds: (me) => hasCapability(me, "alerts.manage"),
  },
  {
    key: "new_report",
    label: "New Report",
    icon: "chart",
    module: "home",
    tab: "reports",
    href: hrefFor("home", "reports", { action: "new" }),
    holds: (me) => hasCapability(me, "home.reports"),
  },
];

/** May the person open this tab, as the navigation decides it? */
function reachable(me: Me, moduleKey: string, tab: string): boolean {
  const mod = moduleByKey(moduleKey);
  return !!mod && visibleModules(me).includes(mod) && visibleTabs(me, mod).some((t) => t.slug === tab);
}

/**
 * The create actions a person holds, in the menu's order.
 * @param opens  whether a screen opens in this build (lib/plan.ts), by module and tab
 */
export function createActionsFor(me: Me, opens: (moduleKey: string, tab: string) => boolean): CreateAction[] {
  return OFFERS.filter((o) => o.holds(me) && reachable(me, o.module, o.tab) && opens(o.module, o.tab)).map(({ key, label, icon, href }) => ({ key, label, icon, href }));
}

/** The reader's create actions, against the delivery plan of this build. */
export function useCreateActions(me: Me): CreateAction[] {
  const open: Record<string, boolean> = {
    "workspace.tasks": useScreenState("workspace", "tasks").open,
    "ess.my-leave": useScreenState("ess", "my-leave").open,
    "home.alerts": useScreenState("home", "alerts").open,
    "home.reports": useScreenState("home", "reports").open,
  };
  return createActionsFor(me, (moduleKey, tab) => open[`${moduleKey}.${tab}`] === true);
}
