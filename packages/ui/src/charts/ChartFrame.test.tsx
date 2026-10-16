import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { ChartFrame } from "./ChartFrame";

const VALUES = [
  { label: "Mon", value: "22" },
  { label: "Tue", value: "21" },
];

describe("ChartFrame", () => {
  it("names the drawing by its title and marks it one image", () => {
    render(
      <ChartFrame title="Attendance" values={VALUES}>
        <svg />
      </ChartFrame>,
    );
    expect(screen.getByRole("img", { name: "Attendance" })).toBeInTheDocument();
  });

  it("reads every value as words, so a chart is not a dead end", () => {
    render(
      <ChartFrame title="Attendance" values={VALUES}>
        <svg />
      </ChartFrame>,
    );
    expect(screen.getByText("Mon: 22")).toBeInTheDocument();
    expect(screen.getByText("Tue: 21")).toBeInTheDocument();
  });

  it("puts the caption in its slot, hidden on a phone (gate 8)", () => {
    render(
      <ChartFrame title="Attendance" caption="14 working days">
        <svg />
      </ChartFrame>,
    );
    const caption = screen.getByText("14 working days");
    expect(caption).toHaveAttribute("data-ui", "chart-caption");
    expect(caption.className).toContain("phone:hidden");
  });

  it("takes its own name when the title is not words", () => {
    render(
      <ChartFrame title={<span>Attendance</span>} label="Attendance This Month">
        <svg />
      </ChartFrame>,
    );
    expect(screen.getByRole("img", { name: "Attendance This Month" })).toBeInTheDocument();
  });

  it("scrolls the drawing inside the card, reachable by Tab", () => {
    render(
      <ChartFrame title="Attendance" scrolls>
        <svg />
      </ChartFrame>,
    );
    const drawing = screen.getByRole("img", { name: "Attendance" });
    expect(drawing.className).toContain("overflow-x-auto");
    expect(drawing).toHaveAttribute("tabindex", "0");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <ChartFrame title="Attendance" help="How many people clocked in on each working day." caption="14 working days" values={VALUES}>
        <svg />
      </ChartFrame>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
