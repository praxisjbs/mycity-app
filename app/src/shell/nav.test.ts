import { describe, expect, it, vi } from "vitest";
import { MODULES } from "./catalogue";
import { bottomItems, bottomKey, moreGroups, railItems, tabItems } from "./nav";

const staff = MODULES.filter((m) => ["home", "workspace", "ess", "community", "mailbox", "performance", "expenses", "knowledge", "praxis_ai"].includes(m.key));
const badges = { workspace: 4, community: 3, mailbox: 12, expenses: 1 };

describe("shell navigation", () => {
  it("the bottom bar is Home, Workspace, Community, Self-Service and More (F16), More counting the rest", () => {
    const openMore = vi.fn();
    const items = bottomItems(staff, badges, openMore, false);
    expect(items.map((i) => i.label)).toEqual(["Home", "Workspace", "Community", "Self-Service", "More"]);
    expect(items[1]).toMatchObject({ href: "/workspace", count: 4 });
    expect(items[4]).toMatchObject({ key: "more", count: 13, expanded: false });
    items[4]!.onSelect!();
    expect(openMore).toHaveBeenCalledOnce();
  });

  it("More shows only the modules the person may open, grouped Work, People, Business, System, one word each (F17)", () => {
    const groups = moreGroups(staff, badges);
    expect(groups.map((g) => g.label)).toEqual(["Work", "People", "Business", "System"]);
    expect(groups[0]!.tiles.map((t) => t.label)).toEqual(["Community", "Mailbox"]);
    expect(groups[1]!.tiles.map((t) => t.label)).toEqual(["Performance"]);
    expect(groups[3]!.tiles.map((t) => t.label)).toEqual(["Knowledge", "Assistant"]);
    for (const g of groups) for (const t of g.tiles) expect(t.label.split(/\s+/)).toHaveLength(1);
  });

  it("the rail lists every module the person may open, by area, with counts and the one URL shape", () => {
    const items = railItems(staff, badges);
    expect(items).toHaveLength(staff.length);
    expect(items.find((i) => i.key === "praxis_ai")).toMatchObject({ href: "/praxis-ai", group: "System" });
    expect(items.find((i) => i.key === "home")!.group).toBeUndefined();
  });

  it("each tab carries its share of the module's count, red while an urgent notice opens there", () => {
    const people = MODULES.find((m) => m.key === "people")!;
    const counts = { modules: { people: 9 }, tabs: { people: { employees: 2, attendance: 4, leave: 3 } } };
    const items = tabItems("people", people.tabs, counts, new Set(["people/leave", "people/devices"]));
    const of = (slug: string) => items.find((i) => i.value === slug)!;
    expect(of("employees")).toMatchObject({ label: "Employees", href: "/people?tab=employees", count: 2, tone: "primary" });
    expect(of("attendance")).toMatchObject({ count: 4, tone: "primary" });
    expect(of("leave")).toMatchObject({ count: 3, tone: "err" });
    // Something urgent there with nothing unread (an announcement opened, not yet acknowledged): at least 1.
    expect(of("devices")).toMatchObject({ count: 1, tone: "err" });
    expect(of("organogram").count).toBe(0);
    expect(tabItems("people", people.tabs, undefined).every((i) => i.count === 0)).toBe(true);
  });

  it("marks the bottom bar's own places, and More for the rest", () => {
    expect(bottomKey("ess")).toBe("ess");
    expect(bottomKey("payroll")).toBe("more");
    expect(bottomKey(null)).toBeNull();
  });
});
