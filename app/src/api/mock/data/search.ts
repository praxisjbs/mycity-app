import { MODULES } from "@/shell/catalogue";
import type { MockPerson } from "./people";

/** Stands in for the search registry: every screen, and records by name. */
export function SEARCH_INDEX(people: MockPerson[]) {
  const seg = (k: string) => k.replace(/_/g, "-");
  const screens = MODULES.flatMap((m) =>
    m.tabs.map((tab) => ({ kind: "screen" as const, title: tab.label, subtitle: m.label, group: "Screens", path: `/${seg(m.key)}?tab=${tab.slug}` })),
  );
  const staff = people.map((p) => ({
    kind: "record" as const,
    title: p.display_name,
    subtitle: `${p.job_title} · ${p.department}`,
    group: "People",
    path: `/people?tab=employees&id=${p.employee_id}`,
  }));
  return [...screens, ...staff];
}
