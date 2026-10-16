import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Bars } from "./Bars";

const ROWS = [
  { label: "Leads", percent: 100, value: "42 leads" },
  { label: "Qualified", percent: 43, value: "18 leads" },
  { label: "Signed", percent: 9, value: "4 leads" },
];

describe("Bars", () => {
  it("draws a named meter per row with its figure", () => {
    render(<Bars rows={ROWS} />);
    const meter = screen.getByRole("meter", { name: "Qualified" });
    expect(meter).toHaveAttribute("aria-valuenow", "43");
    expect(screen.getByText("18 leads")).toBeInTheDocument();
  });

  it("puts the fill in a CSS variable, never a length in a class", () => {
    render(<Bars rows={[ROWS[1]!]} />);
    const meter = screen.getByRole("meter", { name: "Qualified" });
    expect(meter.style.getPropertyValue("--bar-fill")).toBe("43%");
    expect(meter.style.getPropertyValue("--bar-ink")).toBe("var(--chart-1)");
  });

  it("holds a bar between nothing and full, whatever figure it is given", () => {
    render(
      <Bars
        rows={[
          { label: "Over", percent: 320, value: "x" },
          { label: "Under", percent: -4, value: "y" },
        ]}
      />,
    );
    expect(screen.getByRole("meter", { name: "Over" }).style.getPropertyValue("--bar-fill")).toBe("100%");
    expect(screen.getByRole("meter", { name: "Under" }).style.getPropertyValue("--bar-fill")).toBe("0%");
  });

  it("keeps its note to desktop (gate 8)", () => {
    render(<Bars rows={ROWS} note="Last 30 days" />);
    const note = screen.getByText("Last 30 days");
    expect(note).toHaveAttribute("data-ui", "chart-caption");
    expect(note.className).toContain("phone:hidden");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Bars rows={ROWS} note="Last 30 days" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
