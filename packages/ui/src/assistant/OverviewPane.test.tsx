import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { chartValue, figureText, OverviewPane } from "./OverviewPane";
import { chartRows } from "./pane";

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

  it("reads a chart's values in naira when its unit is ngn, a short list's own amounts", async () => {
    const chart = { kind: "bar" as const, title: "Allocated by department", labels: ["Programmes", "Operations"], series: [{ label: "Allocated", values: [3500000, 2000000] }], unit: "ngn" };
    render(<OverviewPane overview={{ title: null, figures: [{ key: "rows", label: "Budgets", value: 2, unit: "count" }], chart }} />);
    expect(await screen.findByText("Programmes: ₦3,500,000.00")).toBeInTheDocument();
    expect(chartValue({ unit: "ngn" })(750000.5)).toBe("₦750,000.50");
    expect(chartValue({ unit: null })(1240)).toBe("1,240");
    expect(chartValue({})(12)).toBe("12");
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

  it("draws View Data and Download PDF under a chart, each pressed once", async () => {
    let views = 0;
    let downloads = 0;
    let done: () => void = () => undefined;
    render(
      <OverviewPane
        overview={STACKED}
        onViewData={() => {
          views += 1;
        }}
        onDownload={() => {
          downloads += 1;
          return new Promise<void>((resolve) => {
            done = resolve;
          });
        }}
      />,
    );
    const pdf = screen.getByRole("button", { name: "Download PDF" });
    await userEvent.click(pdf);
    // Busy until the file lands: a second press asks nothing more (F26), and View Data waits beside it.
    await userEvent.click(pdf);
    expect(downloads).toBe(1);
    done();
    await waitFor(() => expect(pdf).not.toHaveAttribute("aria-busy", "true"));
    await userEvent.click(screen.getByRole("button", { name: "View Data" }));
    expect(views).toBe(1);
  });

  it("draws no foot without a chart", () => {
    render(<OverviewPane overview={{ ...OVERVIEW, chart: null }} onViewData={() => undefined} onDownload={() => Promise.resolve()} />);
    expect(screen.queryByRole("button", { name: "View Data" })).toBeNull();
  });

  it("gives a chart's figures as a table, a Total for a stacked bar", () => {
    const t = chartRows(STACKED.chart, "Department", (v) => String(v));
    expect(t.columns).toEqual(["Department", "Spent", "Committed", "Remaining", "Over Budget", "Total"]);
    expect(t.rows[1]).toEqual(["Technology", "1100000", "400000", "0", "300000", "1800000"]);
    expect(t.numeric).toEqual([1, 2, 3, 4, 5]);
    expect(chartRows(OVERVIEW.chart, "Department", String).columns).toEqual(["Department", "By Department"]);
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
