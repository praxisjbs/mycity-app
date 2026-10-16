import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { KpiCard } from "./KpiCard";

beforeEach(() => setViewport(1440));

describe("KpiCard", () => {
  it("draws the title, the number and the caption in their slots", () => {
    render(<KpiCard title="Clocked In Today" value="22 of 25" caption="3 late" />);
    expect(screen.getByText("Clocked In Today")).toHaveAttribute("data-ui", "title");
    expect(screen.getByText("22 of 25")).toBeInTheDocument();
    expect(screen.getByText("3 late").closest("[data-ui]")).toHaveAttribute("data-ui", "kpi-caption");
  });

  it("is a plain card without onOpen, and a button with it", async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<KpiCard title="Open Queries" value={4} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<KpiCard title="Open Queries" value={4} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /Open Queries/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("names the trend as a word, so direction is never colour alone", () => {
    render(<KpiCard title="Owed This Month" value="₦1.3M" caption="4 overdue" trend="down" />);
    expect(screen.getByRole("img", { name: "down" })).toBeInTheDocument();
  });

  it("tones the number without tinting the title", () => {
    render(<KpiCard title="Late Arrivals" value={7} tone="warn" />);
    expect(screen.getByText("7").className).toContain("text-warning");
  });

  it("opensOn phone leaves the desktop tile plain and the phone tile clickable", () => {
    const { rerender } = render(<KpiCard title="My Leave Days" value={12} onOpen={vi.fn()} opensOn="phone" />);
    expect(screen.queryByRole("button")).toBeNull();
    setViewport(390);
    rerender(<KpiCard title="My Leave Days" value={12} onOpen={vi.fn()} opensOn="phone" />);
    expect(screen.getByRole("button", { name: /My Leave Days/ })).toBeInTheDocument();
  });

  it("puts a plain tile's support text behind its title as a help term, closed", () => {
    render(<KpiCard title="Over By" value="2 Days" help="How far past its due date the oldest open item is." />);
    expect(screen.getByText("Over By").closest("[data-help-term]")).not.toBeNull();
    expect(screen.queryByText(/How far past/)).not.toBeVisible();
  });

  it("a tile that opens its records carries its help as an \u24d8 outside the button, not a term inside it", () => {
    render(<KpiCard title="Over By" value="2 Days" help="How far past its due date the oldest open item is." onOpen={vi.fn()} />);
    const info = screen.getByRole("button", { name: "About Over By" });
    // jsdom runs the title and the number together where a browser would space them.
    const opener = screen.getByRole("button", { name: /^Over By\s*2 Days$/ });
    expect(opener).not.toBe(info);
    expect(opener.contains(info)).toBe(false);
    expect(screen.getByText("Over By").closest("[data-help-term]")).toBeNull();
  });

  it("has no accessibility violations, plain and clickable", async () => {
    const { container } = render(
      <div>
        <KpiCard title="Clocked In Today" value="22 of 25" caption="3 late" trend="up" />
        <KpiCard title="Open Queries" value={4} onOpen={vi.fn()} help="Queries nobody has answered yet." />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
