import { useState } from "react";
import { FloatingButton, type FabAction } from "@mycity/ui";
import { useAuth } from "@/auth/AuthProvider";
import { useClock } from "@/features/attendance/ClockButton";
import { hrefFor, useRouter } from "@/lib/router";
import { moduleByKey } from "./catalogue";
import { useRegisteredAction, useRegisteredSecond } from "./screen-action";

/**
 * The phone's floating button (F18). The fan: the screen's own New action when
 * it registered one (useScreenAction), and its second one after it (Home's Add
 * Work Site), Clock In or Out, Praxis AI, Help (the
 * Knowledge Hub's FAQs), each only when the person may use it. Hide Here keeps
 * it hidden on this page until the person leaves it: `page` is the path, so
 * coming back to the page shows it again.
 */
export function Fab({ page }: { page: string }) {
  const { can } = useAuth();
  const { navigate } = useRouter();
  const screen = useRegisteredAction();
  const second = useRegisteredSecond();
  const clock = useClock();
  const [hiddenOn, setHiddenOn] = useState<string | null>(null);

  const actions: FabAction[] = [];
  if (screen) actions.push({ key: "screen", label: screen.label, icon: screen.icon ?? "plus", onSelect: screen.onSelect });
  if (second && second.label !== screen?.label) actions.push({ key: "second", label: second.label, icon: second.icon ?? "plus", onSelect: second.onSelect });
  if (can("attendance") || can("ess")) {
    if (clock.ready && !clock.unavailable) actions.push({ key: "clock", label: clock.label, icon: "clock", onSelect: clock.open });
  }
  if (can("praxis_ai")) actions.push({ key: "ai", label: moduleByKey("praxis_ai")?.label ?? "Assistant", icon: "spark", onSelect: () => navigate(hrefFor("praxis_ai", "ask")) });
  if (can("knowledge")) actions.push({ key: "help", label: "Help", icon: "help", onSelect: () => navigate(hrefFor("knowledge", "faqs")) });

  return <FloatingButton actions={actions} hidden={hiddenOn === page} onHideHere={() => setHiddenOn(page)} />;
}
