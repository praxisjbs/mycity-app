import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { DonutChart } from "./DonutChart";

describe("DonutChart", () => {
  it("draws one share with its figure in the middle", async () => {
    const { container } = render(<DonutChart title="On Time" percent={77} middle="77%" under="on time" />);
    await waitFor(() => expect(screen.getByText("77%")).toBeInTheDocument());
    expect(screen.getByText("on time")).toBeInTheDocument();
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("draws a slice per figure when it is given slices", async () => {
    const { container } = render(
      <DonutChart
        title="Goals"
        middle="14"
        under="met"
        slices={[
          { label: "Met", value: 14 },
          { label: "Missed", value: 3 },
        ]}
      />,
    );
    // The track, then one ring per slice.
    await waitFor(() => expect(container.querySelectorAll("circle")).toHaveLength(3));
    expect(screen.getByText("Met: 14")).toBeInTheDocument();
    expect(screen.getByText("Missed: 3")).toBeInTheDocument();
  });

  it("names itself by its title and its figure", () => {
    render(<DonutChart title="On Time" percent={77} middle="77%" />);
    expect(screen.getByRole("img", { name: "On Time, 77%" })).toBeInTheDocument();
  });

  it("carries the lines beside the ring as a list", () => {
    render(<DonutChart title="On Time" percent={77} middle="77%" lines={["37 on time", "4 late", "7 absent"]} />);
    const lines = screen.getByText("37 on time").closest("ul")!;
    expect(lines.children).toHaveLength(3);
    expect(screen.getByText("7 absent")).toBeInTheDocument();
  });

  it("holds a share inside the ring whatever it is given", async () => {
    const { container } = render(<DonutChart label="Budget" percent={320} middle="100%" />);
    await waitFor(() => expect(container.querySelectorAll("circle")).toHaveLength(2));
    const ring = container.querySelectorAll("circle")[1]!;
    const [drawn] = ring.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(drawn).toBeCloseTo(2 * Math.PI * 42, 0);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<DonutChart title="On Time" percent={77} middle="77%" under="on time" lines={["37 on time"]} caption="This month" />);
    await waitFor(() => expect(screen.getByText("77%")).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
