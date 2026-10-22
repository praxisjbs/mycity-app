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
 * beside it (A24). A month's priority tasks are commitments, sent and approved as a set; Today
 * carries the week (docs/guides/performance.md §6.11, §6.18). Every list is the server's page of 25.
 */
export default function Workspace({ tab, id }: ModuleScreenProps) {
  const [params, setParams] = useSearchParams();
  const modal = useModal();
  /*
   * Deep link from Home's New button or the assistant: /workspace?tab=tasks&new=1&title=… (&commitment=1).
   * The form reads its own fields from the address (TaskPrefill, CalendarEventPrefill).
   */
  useEffect(() => {
    if (params.get("new") !== "1") return;
    const commitment = params.get("commitment") === "1";
    setParams({ new: null, commitment: null }, { replace: true });
    if (tab === "calendar") modal.open({ title: "New Event", body: (close) => <EventForm close={close} /> });
    else modal.open({ title: commitment ? "New Commitment" : "New Task", body: (close) => <TaskForm close={close} commitment={commitment} /> });
  }, [params, setParams, modal, tab]);
  if (tab === "tasks") return <Tasks openId={id} />;
  if (tab === "calendar") return <CalendarTab />;
  if (tab === "analytics") return <Analytics />;
  return <Today />;
}
