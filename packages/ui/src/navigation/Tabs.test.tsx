import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { TabPanel, Tabs, visibleTabs, type TabItem } from "./Tabs";

const ITEMS: TabItem[] = [
  { value: "register", label: "Register", href: "#/attendance?tab=register" },
  { value: "assignments", label: "Field Assignments", href: "#/attendance?tab=assignments", count: 3 },
  { value: "requests", label: "Location Requests", href: "#/attendance?tab=requests" },
];

describe("Tabs", () => {
  it("is a named tablist driven by value, with a slot on each tab and a count", () => {
    render(<Tabs label="Attendance" value="assignments" items={ITEMS} />);
    expect(screen.getByRole("tablist", { name: "Attendance" })).toBeInTheDocument();
    const tab = screen.getByRole("tab", { name: "Field Assignments 3" });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveAttribute("data-ui", "button");
    expect(tab).toHaveAttribute("href", "#/attendance?tab=assignments");
    expect(tab).not.toHaveAttribute("aria-controls");
    expect(screen.getByRole("tablist").className).toContain("overflow-x-auto");
  });

  it("colours a count by its tone: quiet by default, yellow for what waits, red when urgent", () => {
    render(
      <Tabs
        label="People"
        value="employees"
        items={[
          { value: "employees", label: "Employees", count: 2, tone: "primary" },
          { value: "leave", label: "Leave", count: 1, tone: "err" },
          { value: "devices", label: "Devices", count: 4 },
        ]}
      />,
    );
    const badge = (name: string) => screen.getByRole("tab", { name }).querySelector("[data-count]")!;
    expect(badge("Employees 2").className).toContain("bg-primary");
    expect(badge("Leave 1").className).toContain("bg-destructive");
    expect(badge("Devices 4").className).toContain("bg-muted");
  });

  it("routes a plain click through onValueChange instead of reloading", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Tabs label="Attendance" value="register" onValueChange={onValueChange} items={ITEMS} />);
    const tab = screen.getByRole("tab", { name: "Location Requests" });
    await user.click(tab);
    expect(onValueChange).toHaveBeenCalledWith("requests");
    // fireEvent returns false when the default (following the link) was prevented.
    expect(fireEvent.click(tab)).toBe(false);
    expect(fireEvent.click(tab, { ctrlKey: true })).toBe(true);
  });

  it("moves with the arrow keys and activates on Enter (manual activation)", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Tabs label="Attendance" value="register" onValueChange={onValueChange} items={ITEMS.map(({ href: _href, ...t }) => t)} />);
    await user.tab();
    expect(screen.getByRole("tab", { name: "Register" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Field Assignments 3" })).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
    await user.keyboard("{End}{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("requests");
  });

  it("shows the panel of the active tab", async () => {
    const user = userEvent.setup();
    function Host() {
      const [tab, setTab] = useState("profile");
      return (
        <Tabs label="Employee" value={tab} onValueChange={setTab} items={[{ value: "profile", label: "Profile" }, { value: "leave", label: "Leave" }]}>
          <TabPanel value="profile">Ada Okafor, Operations</TabPanel>
          <TabPanel value="leave">12 days left</TabPanel>
        </Tabs>
      );
    }
    render(<Host />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Ada Okafor");
    await user.click(screen.getByRole("tab", { name: "Leave" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("12 days left");
    expect(screen.getByRole("tab", { name: "Leave" })).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
  });

  it("has no accessibility violations, as a strip and with panels", async () => {
    const strip = render(<Tabs label="Attendance" value="register" items={ITEMS} />);
    expect(await axe(strip.container)).toHaveNoViolations();
    strip.unmount();
    const { container } = render(
      <Tabs label="Employee" value="profile" items={[{ value: "profile", label: "Profile" }, { value: "leave", label: "Leave" }]}>
        <TabPanel value="profile">Ada Okafor</TabPanel>
        <TabPanel value="leave">12 days left</TabPanel>
      </Tabs>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  describe("on a desktop too narrow for every tab", () => {
    const ESS: TabItem[] = ["My Profile", "My Attendance", "My Devices", "My Leave", "My Queries", "My Documents"].map((label) => ({
      value: label.toLowerCase().replace(" ", "-"),
      label,
    }));

    /** jsdom lays nothing out: each tab is 100 px wide (with the gap) and the strip `room` px. */
    function lay(room: number) {
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(98);
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(room);
    }
    afterEach(() => {
      vi.restoreAllMocks();
      setViewport(1440);
    });

    it("keeps what fits, with room for More Tabs, and always the active tab", () => {
      const w = [100, 100, 100, 100, 100, 100];
      expect(visibleTabs(w, 700, 0)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(visibleTabs(w, 450, 0)).toEqual([0, 1, 2, 3]);
      expect(visibleTabs(w, 450, 5)).toEqual([0, 1, 2, 5]);
      expect(visibleTabs(w, 120, 3)).toEqual([3]);
      expect(visibleTabs(w, 0, 2)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("folds the rest into More Tabs, and a hidden tab opens from it", async () => {
      setViewport(1440);
      lay(450);
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      const items = ESS.map((t, i) => (i === 5 ? { ...t, count: 2 } : t));
      render(<Tabs label="Employee Self-Service" value="my-profile" onValueChange={onValueChange} items={items} />);
      expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["My Profile", "My Attendance", "My Devices", "My Leave"]);
      const more = screen.getByRole("button", { name: "More Tabs" });
      await user.click(more);
      await user.click(await screen.findByRole("menuitem", { name: /My Documents/ }));
      expect(onValueChange).toHaveBeenCalledWith("my-documents");
    });

    it("brings the active tab into the row when it would have been hidden", () => {
      setViewport(1440);
      lay(450);
      render(<Tabs label="Employee Self-Service" value="my-documents" items={ESS} />);
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual(["My Profile", "My Attendance", "My Devices", "My Documents"]);
      expect(screen.getByRole("tab", { name: "My Documents" })).toHaveAttribute("aria-selected", "true");
    });

    it("shows every tab and no More Tabs when they fit, and on a phone, which scrolls", () => {
      setViewport(1440);
      lay(1200);
      const wide = render(<Tabs label="Employee Self-Service" value="my-profile" items={ESS} />);
      expect(screen.getAllByRole("tab")).toHaveLength(6);
      expect(screen.queryByRole("button", { name: "More Tabs" })).toBeNull();
      wide.unmount();
      setViewport(390);
      lay(300);
      render(<Tabs label="Employee Self-Service" value="my-profile" items={ESS} />);
      expect(screen.getAllByRole("tab")).toHaveLength(6);
      expect(screen.queryByRole("button", { name: "More Tabs" })).toBeNull();
    });
  });
});
