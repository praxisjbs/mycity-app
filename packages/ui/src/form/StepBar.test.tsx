import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "../testing/axe";
import { StepBar } from "./StepBar";

const steps = ["Name", "Access", "Details", "Review"] as const;

describe("StepBar", () => {
  it("marks the step in hand and fills the bars up to it", () => {
    render(<StepBar steps={steps} at={1} />);
    const items = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items.map((li) => li.getAttribute("aria-current"))).toEqual([null, "step", null, null]);
    expect(items.map((li) => li.className.includes("bg-secondary"))).toEqual([true, true, false, false]);
    expect(items.map((li) => li.className.includes("bg-border"))).toEqual([false, false, true, true]);
    expect(within(items[1]!).getByText("Step 2 of 4: Access")).toHaveClass("sr-only");
  });

  it("says Step 2 of 4, without the title unless titled", () => {
    const { rerender } = render(<StepBar steps={steps} at={1} />);
    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(screen.queryByText("Step 2 of 4 · Access")).toBeNull();
    rerender(<StepBar steps={steps} at={1} titled />);
    expect(screen.getByText("Step 2 of 4 · Access")).toBeInTheDocument();
  });

  it("clamps the step in hand to the steps it has", () => {
    const { rerender } = render(<StepBar steps={steps} at={9} titled />);
    expect(screen.getByText("Step 4 of 4 · Review")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[3]).toHaveAttribute("aria-current", "step");
    rerender(<StepBar steps={steps} at={-2} titled />);
    expect(screen.getByText("Step 1 of 4 · Name")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "step");
  });

  it("draws nothing with no steps", () => {
    const { container } = render(<StepBar steps={[]} at={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<StepBar steps={steps} at={2} titled />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
