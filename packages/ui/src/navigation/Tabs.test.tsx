import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { TabPanel, Tabs, type TabItem } from "./Tabs";

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
});
