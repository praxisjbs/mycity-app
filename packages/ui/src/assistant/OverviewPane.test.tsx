import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { figureText, OverviewPane } from "./OverviewPane";

const OVERVIEW = {
  title: "Seven late arrivals this month, most in Operations.",
  figures: [
    { key: "late", label: "Late Arrivals", value: 7, unit: "count" },
    { key: "minutes", label: "Minutes Late", value: 143, unit: "minutes" },
    { key: "share", label: "Share of Days", value: "4.5", unit: "percent" },
  ],
  chart: { kind: "bar" as const, title: "Late arrivals by department", labels: ["Operations", "Finance"], series: [{ label: "By Department", values: [5, 2] }] },
};

const STACKED = {
  title: null,
  figures: [
    { key: "allocated", label: "Allocated", value: "4500000.00", unit: "ngn" },
    { key: "spent", label: "Spent", value: "2600000.00", unit: "ngn" },
    { key: "remaining", label: "Remaining", value: "1100000.00", unit: "ngn" },
  ],
  chart: {
    kind: "stacked_bar" as const,
    title: "Budget by department",
    labels: ["Finance", "Technology"],
    series: [
      { label: "Spent", values: [1500000, 1100000] },
      { label: "Committed", values: [500000, 400000] },
      { label: "Remaining", values: [1000000, 0] },
      { label: "Over Budget", values: [0, 300000] },
    ],
  },
};

describe("OverviewPane", () => {
  it("shows the figures by their unit and the chart the server drew", async () => {
    render(<OverviewPane overview={OVERVIEW} />);
    expect(screen.getByText("Late Arrivals")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("143 minutes")).toBeInTheDocument();
    expect(screen.getByText("4.5%")).toBeInTheDocument();
    expect(screen.getByText("Late arrivals by department")).toHaveAttribute("data-copy", "content");
    expect(await screen.findByText("By Department")).toBeInTheDocument();
  });

  it("says No Figures Yet without a summary", () => {
    render(<OverviewPane overview={null} />);
    expect(screen.getByRole("heading", { name: "No Figures Yet" })).toBeInTheDocument();
  });

  it("reads a figure by its unit", () => {
    expect(figureText({ value: "125000.00", unit: "ngn" })).toBe("₦125,000.00");
    expect(figureText({ value: 12, unit: "days" })).toBe("12 days");
    expect(figureText({ value: 1240, unit: "count" })).toBe("1,240");
    expect(figureText({ value: 40, unit: "percent" })).toBe("40%");
  });

  it("draws a stacked bar with a key of its parts and reads each part and the total", async () => {
    const { container } = render(<OverviewPane overview={STACKED} />);
    expect(screen.getByText("₦4,500,000.00")).toBeInTheDocument();
    expect(screen.getByText("Budget by department")).toHaveAttribute("data-copy", "content");
    expect(screen.getByRole("img", { name: "Budget by department" })).toBeInTheDocument();
    // The key names every part; Spent and Remaining are figures' names as well.
    expect(screen.getByText("Committed")).toBeInTheDocument();
    expect(screen.getByText("Over Budget")).toBeInTheDocument();
    expect(screen.getAllByText("Spent")).toHaveLength(2);
    expect(screen.getByText("Finance: Spent 1,500,000, Committed 500,000, Remaining 1,000,000, Over Budget 0, Total 3,000,000")).toBeInTheDocument();
    expect(screen.getByText("Technology: Spent 1,100,000, Committed 400,000, Remaining 0, Over Budget 300,000, Total 1,800,000")).toBeInTheDocument();
    // Every part above 0 is drawn, not just the first series.
    await waitFor(() => expect(container.querySelectorAll("path")).toHaveLength(6));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<OverviewPane overview={OVERVIEW} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations with a stacked bar", async () => {
    const { container } = render(<OverviewPane overview={STACKED} />);
    await waitFor(() => expect(container.querySelectorAll("path").length).toBeGreaterThan(0));
    expect(await axe(container)).toHaveNoViolations();
  });
});
