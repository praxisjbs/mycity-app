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
    /* Each bar's fill is drawn over its track and stretched from the left up to the step in hand. */
    const fills = items.map((li) => li.querySelector(".bg-secondary")!);
    expect(fills.map((f) => f.classList.contains("scale-x-100"))).toEqual([true, true, false, false]);
    expect(fills.map((f) => f.classList.contains("scale-x-0"))).toEqual([false, false, true, true]);
    expect(items.every((li) => li.classList.contains("bg-border"))).toBe(true);
    expect(within(items[1]!).getByText("Step 2 of 4: Access")).toHaveClass("sr-only");
  });

  it("lists the steps by name when vertical, each numbered: those done said so, the one in hand marked", () => {
    const { rerender } = render(<StepBar steps={steps} at={2} vertical />);
    const items = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["1Done: Name", "2Done: Access", "3Details", "4Review"]);
    expect(items[2]).toHaveAttribute("aria-current", "step");
    expect(items.map((li) => li.dataset.step ?? "")).toEqual(["done", "done", "on", ""]);
    rerender(<StepBar steps={steps} at={2} vertical complete />);
    expect(within(screen.getByRole("list")).getAllByRole("listitem").every((li) => li.dataset.step === "done" && !li.hasAttribute("aria-current"))).toBe(true);
    rerender(<StepBar steps={steps} at={2} vertical decorative />);
    expect(screen.queryByRole("list")).toBeNull();
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
