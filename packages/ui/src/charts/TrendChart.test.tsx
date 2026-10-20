import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { TrendChart } from "./TrendChart";

const LABELS = ["20/10/2026 09:00", "20/10/2026 09:15", "20/10/2026 09:30", "20/10/2026 09:45"];
const ms = (v: number) => `${Math.round(v)} ms`;

describe("TrendChart", () => {
  it("draws each unbroken run as its own path, so a minute nobody recorded is a gap, not a zero", async () => {
    const { container } = render(<TrendChart title="Response Time" labels={LABELS} lines={[{ name: "p95", values: [400, null, 380, 420] }]} format={ms} />);
    await waitFor(() => expect(container.querySelectorAll("path")).toHaveLength(2));
    // The first run is a lone point: it still shows, as a short stroke.
    expect(container.querySelector("path")?.getAttribute("d")).toMatch(/h 0.01$/);
  });

  it("draws the target across, and names it in the key", async () => {
    const { container } = render(
      <TrendChart title="Response Time" labels={LABELS} lines={[{ name: "p95", values: [400, 300, 380, 420] }]} target={{ value: 800, label: "Target 800 ms" }} format={ms} />,
    );
    await waitFor(() => expect(container.querySelector("[data-target]")).not.toBeNull());
    expect(screen.getByText("Target 800 ms")).toBeInTheDocument();
    // The scale reaches the target even when every figure is under it.
    expect(screen.getByText("1000 ms")).toBeInTheDocument();
  });

  it("the key reads the latest figure, then the point the pointer is over", async () => {
    const { container } = render(
      <TrendChart title="Processor" labels={LABELS} ticks={["09:00", "09:15", "09:30", "09:45"]} max={100} lines={[{ name: "Busy", values: [10, 20, 30, null] }, { name: "Steal", values: [1, 2, 3, null] }]} format={(v) => `${v}%`} />,
    );
    expect(screen.getByText("20/10/2026 09:30")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    const svg = await waitFor(() => {
      const el = container.querySelector("svg");
      expect(el).not.toBeNull();
      return el as SVGSVGElement;
    });
    svg.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 160, right: 300, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(svg, { clientX: 0 });
    expect(screen.getByText("20/10/2026 09:00")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(container.querySelector("[data-rule]")).not.toBeNull();
    fireEvent.pointerLeave(svg);
    expect(container.querySelector("[data-rule]")).toBeNull();
  });

  it("reads every point and every line to a screen reader, gaps included", () => {
    render(<TrendChart title="Response Time" labels={LABELS} lines={[{ name: "p95", values: [400, null, 380, 420] }]} format={ms} />);
    expect(screen.getByText("20/10/2026 09:00: p95 400 ms")).toBeInTheDocument();
    expect(screen.getByText("20/10/2026 09:15: p95 not recorded")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <TrendChart title="Response Time" labels={LABELS} lines={[{ name: "p95", values: [400, 300, 380, 420] }]} target={{ value: 800, label: "Target 800 ms" }} format={ms} />,
    );
    await waitFor(() => expect(container.querySelector("path")).not.toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});
