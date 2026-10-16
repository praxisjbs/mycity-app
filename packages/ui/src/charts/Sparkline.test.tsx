import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("draws a bare line with no axes or text of its own", async () => {
    const { container } = render(<Sparkline label="Attendance" values={[18, 21, 22, 20, 24]} />);
    await waitFor(() => expect(container.querySelector("polyline")).not.toBeNull());
    expect(container.querySelectorAll("text")).toHaveLength(0);
    expect(container.querySelectorAll("line")).toHaveLength(0);
  });

  it("names itself with its first and last figure, so the direction is readable", () => {
    render(<Sparkline label="Attendance" values={[18, 21, 24]} />);
    expect(screen.getByRole("img", { name: "Attendance, 18 to 24" })).toBeInTheDocument();
  });

  it("draws nothing for fewer than two points", () => {
    const { container } = render(<Sparkline label="Attendance" values={[18]} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws a flat line when every figure is the same, rather than dividing by nothing", async () => {
    const { container } = render(<Sparkline label="Attendance" values={[20, 20, 20]} />);
    await waitFor(() => expect(container.querySelector("polyline")).not.toBeNull());
    const points = container.querySelector("polyline")!.getAttribute("points")!.split(" ");
    const ys = points.map((p) => p.split(",")[1]);
    expect(new Set(ys).size).toBe(1);
  });

  it("draws in the series it is given", async () => {
    const { container } = render(<Sparkline label="Attendance" values={[1, 2]} series={3} />);
    await waitFor(() => expect(container.querySelector("polyline")).toHaveAttribute("stroke", "var(--chart-3)"));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Sparkline label="Attendance" values={[18, 21, 22, 20, 24]} />);
    await waitFor(() => expect(container.querySelector("polyline")).not.toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});
