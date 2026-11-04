import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { PaneTabs } from "./PaneTabs";

describe("PaneTabs", () => {
  it("shows the four tabs, disables one with nothing to show, and keeps the layout", () => {
    render(<PaneTabs value="table" onValueChange={vi.fn()} table={<p>The rows</p>} sources={<p>The reads</p>} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Table", "Record", "Sources"]);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Record" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("The rows")).toBeInTheDocument();
  });

  it("a press asks for that tab", async () => {
    const onValueChange = vi.fn();
    render(<PaneTabs value="table" onValueChange={onValueChange} table={<p>The rows</p>} sources={<p>The reads</p>} />);
    await userEvent.click(screen.getByRole("tab", { name: "Sources" }));
    expect(onValueChange).toHaveBeenCalledWith("sources");
  });

  it("a value whose tab is empty falls back to the first with something to show", () => {
    render(<PaneTabs value="overview" onValueChange={vi.fn()} record={<p>The record</p>} />);
    expect(screen.getByRole("tab", { name: "Record" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("The record")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<PaneTabs value="sources" onValueChange={vi.fn()} overview={<p>Figures</p>} sources={<p>The reads</p>} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
