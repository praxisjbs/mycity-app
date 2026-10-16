import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { AreaChart } from "./AreaChart";

const VALUES = [18, 21, 22, 20, 24, 23, 12];
const LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

describe("AreaChart", () => {
  it("draws its line once the chunk arrives, and holds the space until then", async () => {
    const { container } = render(<AreaChart title="Attendance" values={VALUES} labels={LABELS} />);
    // The placeholder is decorative: the frame around it already carries the chart's name.
    expect(container.querySelector("[data-skeleton]")).not.toBeNull();
    await waitFor(() => expect(container.querySelector("polyline")).not.toBeNull());
    expect(container.querySelector("[data-skeleton]")).toBeNull();
  });

  it("reads every point as a label and a figure", () => {
    render(<AreaChart title="Attendance" values={VALUES} labels={LABELS} />);
    expect(screen.getByText("Mon: 18")).toBeInTheDocument();
    expect(screen.getByText("Sun: 12")).toBeInTheDocument();
  });

  it("formats the figures for the reader when asked", () => {
    render(<AreaChart title="Signed Value" values={[1300000]} labels={["Jan"]} format={(v) => `₦${v / 1000000}M`} />);
    expect(screen.getByText("Jan: ₦1.3M")).toBeInTheDocument();
  });

  it("draws in the series it is given, from the chart tokens of the theme in use", async () => {
    const { container } = render(<AreaChart values={VALUES} labels={LABELS} label="Attendance" series={4} />);
    await waitFor(() => expect(container.querySelector("polyline")).toHaveAttribute("stroke", "var(--chart-4)"));
  });

  it("drops the grid lines when bare", async () => {
    const { container } = render(<AreaChart values={VALUES} labels={LABELS} label="Attendance" bare />);
    await waitFor(() => expect(container.querySelector("polyline")).not.toBeNull());
    expect(container.querySelectorAll("line")).toHaveLength(0);
  });

  it("hides the drawing from screen readers, since the frame reads the figures", async () => {
    const { container } = render(<AreaChart title="Attendance" values={VALUES} labels={LABELS} />);
    await waitFor(() => expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true"));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<AreaChart title="Attendance" values={VALUES} labels={LABELS} caption="Dips are Saturdays, a half day" />);
    await waitFor(() => expect(container.querySelector("polyline")).not.toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});
