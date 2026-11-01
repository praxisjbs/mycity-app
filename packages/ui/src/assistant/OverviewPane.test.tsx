import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("has no accessibility violations", async () => {
    const { container } = render(<OverviewPane overview={OVERVIEW} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
