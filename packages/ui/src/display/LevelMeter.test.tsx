import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { LevelMeter } from "./LevelMeter";

const bars = (meter: Element) => Array.from(meter.querySelectorAll("[data-state]"));
const filled = (meter: Element) => meter.querySelectorAll('[data-state="filled"]').length;

describe("LevelMeter", () => {
  it("is an image named by its level and count, with four bars filled up to it", () => {
    render(<LevelMeter value={3} label="Edit" />);
    const meter = screen.getByRole("img", { name: "Edit, 3 of 4" });
    expect(bars(meter)).toHaveLength(4);
    expect(filled(meter)).toBe(3);
    expect(meter.querySelector('[data-state="filled"]')?.className).toContain("bg-secondary");
    expect(meter.querySelector('[data-state="empty"]')?.className).toContain("bg-border");
  });

  it("draws as many bars as max", () => {
    render(<LevelMeter value={2} max={3} label="Add" />);
    const meter = screen.getByRole("img", { name: "Add, 2 of 3" });
    expect(bars(meter)).toHaveLength(3);
    expect(filled(meter)).toBe(2);
  });

  it("clamps the value to the steps and rounds it", () => {
    const { rerender } = render(<LevelMeter value={-1} label="No Access" />);
    expect(filled(screen.getByRole("img", { name: "No Access, 0 of 4" }))).toBe(0);

    rerender(<LevelMeter value={9} label="Full" />);
    expect(filled(screen.getByRole("img", { name: "Full, 4 of 4" }))).toBe(4);

    rerender(<LevelMeter value={1.6} label="Add" />);
    expect(filled(screen.getByRole("img", { name: "Add, 2 of 4" }))).toBe(2);
  });

  it("is hidden from assistive technology when decorative", () => {
    const { container } = render(<LevelMeter value={1} label="View" decorative />);
    expect(screen.queryByRole("img", { hidden: true })).toBeNull();
    const meter = container.firstElementChild!;
    expect(meter).toHaveAttribute("aria-hidden", "true");
    expect(meter).not.toHaveAttribute("aria-label");
    expect(filled(meter)).toBe(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ul>
        <li>
          Payroll <LevelMeter value={3} label="Edit" />
        </li>
        <li>
          People <LevelMeter value={1} label="View" decorative /> View
        </li>
        <li>
          Performance <LevelMeter value={0} label="No Access" />
        </li>
      </ul>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
