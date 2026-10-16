import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { BandChart, type BandChartRow } from "./BandChart";

const ROWS: BandChartRow[] = [
  { label: "Grade 1", sub: "18 people", from: 2, to: 18, middle: 10, value: "₦120K to ₦900K" },
  { label: "Grade 2", sub: "11 people", from: 14, to: 38, middle: 26, value: "₦700K to ₦1.9M" },
];

describe("BandChart", () => {
  it("draws a row per grade with its name, its people and its range", async () => {
    render(<BandChart title="Salary Structure" rows={ROWS} scale="₦0 to ₦5M" />);
    expect(screen.getByText("Grade 1")).toBeInTheDocument();
    expect(screen.getByText("18 people")).toBeInTheDocument();
    expect(screen.getByText("₦120K to ₦900K")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("listitem")).not.toHaveLength(0));
  });

  it("shows what the scale runs from and to", () => {
    render(<BandChart title="Salary Structure" rows={ROWS} scale="₦0 to ₦5M" />);
    expect(screen.getByText("₦0 to ₦5M")).toBeInTheDocument();
  });

  it("reads each grade and its range as words", () => {
    render(<BandChart title="Salary Structure" rows={ROWS} />);
    expect(screen.getByText("Grade 2: ₦700K to ₦1.9M")).toBeInTheDocument();
  });

  it("puts the positions in CSS variables, never a length in a class", async () => {
    const { container } = render(<BandChart title="Salary Structure" rows={[ROWS[0]!]} />);
    await waitFor(() => expect(container.querySelector("[style]")).not.toBeNull());
    const scale = container.querySelector<HTMLElement>("[style]")!;
    expect(scale.style.getPropertyValue("--band-from")).toBe("2%");
    expect(scale.style.getPropertyValue("--band-span")).toBe("16%");
    expect(scale.style.getPropertyValue("--band-mid")).toBe("10%");
    expect(scale.style.getPropertyValue("--band-ink")).toBe("var(--chart-1)");
  });

  it("holds a band inside the scale however far out its figures are", async () => {
    const { container } = render(<BandChart title="Salary Structure" rows={[{ label: "Grade 9", from: -20, to: 320, middle: 400, value: "Out of range" }]} />);
    await waitFor(() => expect(container.querySelector("[style]")).not.toBeNull());
    const scale = container.querySelector<HTMLElement>("[style]")!;
    expect(scale.style.getPropertyValue("--band-from")).toBe("0%");
    expect(scale.style.getPropertyValue("--band-span")).toBe("100%");
    expect(scale.style.getPropertyValue("--band-mid")).toBe("100%");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<BandChart title="Salary Structure" rows={ROWS} scale="₦0 to ₦5M" caption="Midpoints marked" />);
    await waitFor(() => expect(container.querySelector("[style]")).not.toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});
