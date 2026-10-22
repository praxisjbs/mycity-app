import { useEffect } from "react";
import { useSearchParams } from "@/lib/router";
import type { ModuleScreenProps } from "@/shell/screens";
import { useModal } from "@mycity/ui";
import { Analytics } from "./Analytics";
import { CalendarTab, EventForm } from "./CalendarTab";
import { TaskForm } from "./TaskForms";
import { Tasks } from "./Tasks";
import { Today } from "./Today";

export { TaskForm } from "./TaskForms";

/**
 * My Workspace: Today, Tasks, Calendar and Analytics (#4 to #7; docs/guides/workspace.md §10).
 * A manager sets the week and the day for their reporting line; the employee adds their own
 * beside it (A24). Every list is the server's page of 25.
 */
export default function Workspace({ tab }: ModuleScreenProps) {
  const [params, setParams] = useSearchParams();
  const modal = useModal();
  /* Deep link from Home's New button or the assistant: /workspace?tab=tasks&new=1&title=… */
  useEffect(() => {
    if (params.get("new") !== "1") return;
    const title = params.get("title") ?? "";
    setParams({ new: null, title: null }, { replace: true });
    if (tab === "calendar") modal.open({ title: "New Event", body: (close) => <EventForm close={close} title={title} /> });
    else modal.open({ title: "New Task", body: (close) => <TaskForm close={close} title={title} /> });
  }, [params, setParams, modal, tab]);
  if (tab === "tasks") return <Tasks />;
  if (tab === "calendar") return <CalendarTab />;
  if (tab === "analytics") return <Analytics />;
  return <Today />;
}
