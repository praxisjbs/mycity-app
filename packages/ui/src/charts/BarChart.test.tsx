import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { BarChart, type BarChartBar } from "./BarChart";
import { EVERY_LABEL_UP_TO, labelRoom, labelSpots, PART_GAP, stackParts, widthForLabels } from "./BarChart.draw";
import { BUDGET_PARTS, BUDGETS, DEPARTMENTS, MONTH_OF_DAYS } from "./fixtures";

const BARS: BarChartBar[] = [
  { label: "Jan", value: 14 },
  { label: "Feb", value: 22 },
  { label: "Mar", value: 9 },
];

const PARTS = ["Spent", "Committed", "Remaining"];
const STACKED: BarChartBar[] = [
  { label: "Finance", value: 10, parts: [6, 3, 1] },
  { label: "People", value: 5, parts: [2, 2, 1] },
];

/** The labels the drawing shows, left to right. */
const shown = (container: HTMLElement) => [...container.querySelectorAll("text")].map((t) => t.textContent);

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

  it("shows every label when they fit", async () => {
    const { container } = render(<BarChart title="Claims by Month" bars={BARS} />);
    await waitFor(() => expect(shown(container)).toEqual(["Jan", "Feb", "Mar"]));
  });

  it("leaves off the labels of a month of days that would touch, keeping the first and the last", async () => {
    const { container } = render(<BarChart title="Spend by Day" bars={MONTH_OF_DAYS} />);
    await waitFor(() => expect(container.querySelectorAll("rect")).toHaveLength(31));
    const labels = shown(container);
    expect(labels.length).toBeLessThan(31);
    expect(labels[0]).toBe("01/10");
    expect(labels[labels.length - 1]).toBe("31/10");
    // The frame still reads out every day.
    expect(screen.getByText(`02/10: ${MONTH_OF_DAYS[1]!.value}`)).toBeInTheDocument();
  });

  it("never runs a label into the next or past the drawing's edge", () => {
    const labels = MONTH_OF_DAYS.map((d) => d.label);
    for (const width of [320, 640, 940, 1280, 1500]) {
      const spots = labelSpots(labels, width);
      const kept = spots.flatMap((x, i) => (x === null ? [] : [{ i, x }]));
      expect(kept[0]?.i).toBe(0);
      expect(kept[kept.length - 1]?.i).toBe(30);
      const room = labelRoom("01/10");
      for (const { x } of kept) {
        expect(x - room / 2).toBeGreaterThanOrEqual(-1e-9);
        expect(x + room / 2).toBeLessThanOrEqual(width + 1e-9);
      }
      for (let k = 1; k < kept.length; k += 1) expect(kept[k]!.x - kept[k - 1]!.x).toBeGreaterThanOrEqual(room - 1e-9);
    }
  });

  it("puts a label under each bar on a wide card", () => {
    expect(labelSpots(["Jan", "Feb", "Mar"], 1200)).toEqual([200, 600, 1000]);
    expect(labelSpots(MONTH_OF_DAYS.map((d) => d.label), 1500).every((x) => x !== null)).toBe(true);
  });

  it("leaves off days at an even step, so the ones shown are evenly spaced", () => {
    const labels = MONTH_OF_DAYS.map((d) => d.label);
    const kept = labelSpots(labels, 640).flatMap((x, i) => (x === null ? [] : [labels[i]]));
    expect(kept).toEqual(["01/10", "04/10", "07/10", "10/10", "13/10", "16/10", "19/10", "22/10", "25/10", "28/10", "31/10"]);
  });

  it("keeps every category's label, widening the drawing for its card to scroll instead", () => {
    const names = DEPARTMENTS.map((d) => d.label);
    const wide = widthForLabels(names);
    expect(wide).toBeGreaterThan(320);
    expect(labelSpots(names, wide).every((x) => x !== null)).toBe(true);
    // A month of days is thinned instead, so it never needs more than the narrowest drawing.
    expect(MONTH_OF_DAYS.length).toBeGreaterThan(EVERY_LABEL_UP_TO);
    expect(widthForLabels(MONTH_OF_DAYS.map((d) => d.label))).toBe(320);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<BarChart title="Claims by Month" bars={BARS} caption="Approved claims only" />);
    await waitFor(() => expect(container.querySelectorAll("rect")).toHaveLength(3));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("BarChart with stacked parts", () => {
  it("draws each bar as its parts, bottom to top, in series 1 to 6", async () => {
    const { container } = render(<BarChart title="Budget by Department" parts={PARTS} bars={STACKED} />);
    await waitFor(() => expect(container.querySelectorAll("path")).toHaveLength(6));
    const fills = [...container.querySelectorAll("path")].map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]);
    expect(container.querySelectorAll("rect")).toHaveLength(0);
  });

  it("reads each bar as its label, each part's name and figure, then its total", () => {
    render(<BarChart title="Budget by Department" parts={PARTS} bars={STACKED} format={(v) => `₦${v}`} />);
    expect(screen.getByText("Finance: Spent ₦6, Committed ₦3, Remaining ₦1, Total ₦10")).toBeInTheDocument();
    expect(screen.getByText("People: Spent ₦2, Committed ₦2, Remaining ₦1, Total ₦5")).toBeInTheDocument();
  });

  it("names every part in the key under the title", () => {
    render(<BarChart title="Budget by Department" parts={BUDGET_PARTS} bars={BUDGETS} />);
    for (const name of BUDGET_PARTS) expect(screen.getByText(name)).toBeInTheDocument();
  });

  it("draws a negative or missing part as 0", async () => {
    const { container } = render(<BarChart label="Budget" parts={PARTS} bars={[{ label: "Finance", value: 7, parts: [5, -3] }]} />);
    await waitFor(() => expect(container.querySelectorAll("path")).toHaveLength(1));
    expect(container.querySelector("path")).toHaveAttribute("fill", "var(--chart-1)");
    expect(screen.getByText("Finance: Spent 5, Committed 0, Remaining 0, Total 7")).toBeInTheDocument();
  });

  it("stacks on one scale whose top is the largest total, a gap between parts", () => {
    const [first, second, third] = stackParts([6, 3, 1], 10, 140, 132);
    expect(first!.y + first!.height).toBeCloseTo(140);
    expect(first!.y - (second!.y + second!.height)).toBeCloseTo(PART_GAP);
    expect(second!.y - (third!.y + third!.height)).toBeCloseTo(PART_GAP);
    expect(third!.y).toBeCloseTo(8);
    // A smaller total stops short of the top, in proportion.
    const shorter = stackParts([2, 2, 1], 10, 140, 132);
    expect(shorter[shorter.length - 1]!.y).toBeCloseTo(140 - 66);
    // A part of 0 is left out.
    expect(stackParts([4, 0, 0], 10, 140, 132).map((p) => p.k)).toEqual([0]);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<BarChart title="Budget by Department" parts={BUDGET_PARTS} bars={BUDGETS} caption="This year's budgets" />);
    await waitFor(() => expect(container.querySelectorAll("path").length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
