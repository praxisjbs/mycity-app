import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { BarChart, type BarChartBar } from "./BarChart";

const BARS: BarChartBar[] = [
  { label: "Jan", value: 14 },
  { label: "Feb", value: 22 },
  { label: "Mar", value: 9 },
];

describe("BarChart", () => {
  it("draws a bar per figure once the chunk arrives", async () => {
    const { container } = render(<BarChart title="Claims by Month" bars={BARS} />);
    await waitFor(() => expect(container.querySelectorAll("rect")).toHaveLength(3));
  });

  it("reads every bar as a label and a figure", () => {
    render(<BarChart title="Claims by Month" bars={BARS} />);
    expect(screen.getByText("Jan: 14")).toBeInTheDocument();
    expect(screen.getByText("Mar: 9")).toBeInTheDocument();
  });

  it("puts every bar in one series by default", async () => {
    const { container } = render(<BarChart label="Claims" bars={BARS} />);
    await waitFor(() => expect(container.querySelectorAll("rect")).toHaveLength(3));
    container.querySelectorAll("rect").forEach((rect) => expect(rect).toHaveAttribute("fill", "var(--chart-1)"));
  });

  it("gives each bar its own colour for categories that are not one measure", async () => {
    const { container } = render(<BarChart label="Headcount" bars={BARS} colourPerBar />);
    await waitFor(() => expect(container.querySelectorAll("rect")).toHaveLength(3));
    const fills = [...container.querySelectorAll("rect")].map((r) => r.getAttribute("fill"));
    expect(new Set(fills).size).toBe(3);
  });

  it("lets one bar stand apart from the rest", async () => {
    const { container } = render(<BarChart label="Claims" bars={[BARS[0]!, { label: "Feb", value: 22, series: 5 }]} />);
    await waitFor(() => expect(container.querySelectorAll("rect")).toHaveLength(2));
    expect(container.querySelectorAll("rect")[1]).toHaveAttribute("fill", "var(--chart-5)");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<BarChart title="Claims by Month" bars={BARS} caption="Approved claims only" />);
    await waitFor(() => expect(container.querySelectorAll("rect")).toHaveLength(3));
    expect(await axe(container)).toHaveNoViolations();
  });
});
