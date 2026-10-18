import { useMe } from "@/auth/AuthProvider";
import type { ModuleScreenProps } from "@/shell/screens";
import { mayUseTab } from "./access";
import { Alerts } from "./Alerts";
import { Gated } from "./Gated";
import { Overview } from "./Overview";
import { Reports } from "./Reports";
import { Team } from "./Team";

/**
 * Home (docs/guides/home.md §2): Overview for every employee, and Team, Alerts and Reports for
 * the holders of their capabilities (./access). Anyone else finds those tabs in their place,
 * locked (./Gated), and the tab reads nothing.
 */
export default function Home({ tab, id }: ModuleScreenProps) {
  const me = useMe();
  if (tab === "team") return mayUseTab(me, "team") ? <Team /> : <Gated title="Team" />;
  if (tab === "alerts") return mayUseTab(me, "alerts") ? <Alerts linked={id} /> : <Gated title="Alerts" />;
  if (tab === "reports") return mayUseTab(me, "reports") ? <Reports linked={id} /> : <Gated title="Reports" />;
  return <Overview linked={id} />;
}
