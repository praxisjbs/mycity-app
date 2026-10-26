import { describe, expect, it, vi } from "vitest";
import { MODULES } from "./catalogue";
import { bottomItems, bottomKey, moreGroups, railItems } from "./nav";

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
    expect(groups[3]!.tiles.map((t) => t.label)).toEqual(["Knowledge", "Praxis"]);
    for (const g of groups) for (const t of g.tiles) expect(t.label.split(/\s+/)).toHaveLength(1);
  });

  it("the rail lists every module the person may open, by area, with counts and the one URL shape", () => {
    const items = railItems(staff, badges);
    expect(items).toHaveLength(staff.length);
    expect(items.find((i) => i.key === "praxis_ai")).toMatchObject({ href: "/praxis-ai", group: "System" });
    expect(items.find((i) => i.key === "home")!.group).toBeUndefined();
  });

  it("marks the bottom bar's own places, and More for the rest", () => {
    expect(bottomKey("ess")).toBe("ess");
    expect(bottomKey("payroll")).toBe("more");
    expect(bottomKey(null)).toBeNull();
  });
});
