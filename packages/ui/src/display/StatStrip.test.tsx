import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { StatStrip, type StatStripItem } from "./StatStrip";

const ITEMS: StatStripItem[] = [
  { label: "Submitted", value: 18 },
  { label: "Approved", value: 14, tone: "ok" },
  { label: "Queried", value: 3, tone: "warn" },
  { label: "Declined", value: 1, tone: "err" },
  { label: "Average Days", value: "2.4" },
];

describe("StatStrip", () => {
  it("draws each figure with its label, as a named list", () => {
    render(<StatStrip items={ITEMS} label="Claim Figures" />);
    expect(screen.getByRole("list", { name: "Claim Figures" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("Submitted")).toHaveAttribute("data-ui", "title");
  });

  it("a figure's help is a help term on its label", () => {
    render(<StatStrip items={[{ label: "Average Read", value: "64%", help: "Across published announcements, the share of the audience who have opened each one." }]} />);
    expect(screen.getByRole("button", { name: "Average Read" })).toHaveAttribute("data-help-term");
  });

  it("tones a figure that is good or bad news", () => {
    render(<StatStrip items={ITEMS} />);
    expect(screen.getByText("14").className).toContain("text-success");
    expect(screen.getByText("1").className).toContain("text-destructive");
  });

  it("hides the fifth figure and any marked desktop on a phone (gate 11)", () => {
    render(<StatStrip items={[...ITEMS.slice(0, 2), { label: "Internal Note", value: "4", desktop: true }]} />);
    expect(screen.getByText("Internal Note").closest("li")!.className).toContain("phone:hidden");
    expect(screen.getByText("Submitted").closest("li")!.className).not.toContain("phone:hidden");
  });

  it("the fifth figure onward is desktop only, however it is marked", () => {
    render(<StatStrip items={ITEMS} />);
    expect(screen.getByText("Average Days").closest("li")!.className).toContain("phone:hidden");
  });

  it("a figure that opens something is a button with its own line", async () => {
    const onOpen = vi.fn();
    render(<StatStrip items={[{ label: "Queried", value: 3, onOpen, action: "View All" }]} />);
    await userEvent.click(screen.getByRole("button", { name: /Queried/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("View All")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<StatStrip items={[...ITEMS, { label: "Queried Again", value: 2, onOpen: vi.fn(), action: "View All" }]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
