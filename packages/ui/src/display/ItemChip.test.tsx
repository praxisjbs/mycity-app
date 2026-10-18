import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { ItemChip } from "./ItemChip";

const marks = (
  <>
    <span>T</span>
    <span>A</span>
  </>
);

describe("ItemChip", () => {
  it("names the item as content", () => {
    render(<ItemChip onSelect={vi.fn()}>Payroll</ItemChip>);
    const button = screen.getByRole("button", { name: "Payroll" });
    expect(button).toHaveAttribute("data-copy", "content");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("opens the item when the name is clicked", async () => {
    const onSelect = vi.fn();
    render(<ItemChip onSelect={onSelect}>People</ItemChip>);
    await userEvent.click(screen.getByRole("button", { name: "People" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("is a plain label without onSelect", () => {
    render(<ItemChip marks={marks}>Expenses</ItemChip>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Expenses")).toHaveAttribute("data-copy", "content");
  });

  it("puts the marks after the name, outside the button", () => {
    render(
      <ItemChip onSelect={vi.fn()} marks={marks}>
        Performance
      </ItemChip>,
    );
    const button = screen.getByRole("button", { name: "Performance" });
    const t = screen.getByText("T");
    expect(button).not.toContainElement(t);
    expect(button.parentElement).toContainElement(t);
    expect(button.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.className).toContain("pr-1.5");
  });

  it("keeps the full padding when no marks follow", () => {
    render(<ItemChip onSelect={vi.fn()}>Partnerships</ItemChip>);
    expect(screen.getByRole("button").className).toContain("pr-3");
  });

  it("marks the item open now and draws it in the accent", () => {
    const { rerender } = render(
      <ItemChip onSelect={vi.fn()} selected>
        People
      </ItemChip>,
    );
    const button = screen.getByRole("button", { name: "People" });
    expect(button).toHaveAttribute("aria-current", "true");
    expect(button.parentElement!.className).toContain("bg-accent");
    rerender(<ItemChip onSelect={vi.fn()}>People</ItemChip>);
    expect(screen.getByRole("button", { name: "People" })).not.toHaveAttribute("aria-current");
  });

  it("draws an item that is off muted", () => {
    render(
      <ItemChip onSelect={vi.fn()} muted>
        Payroll
      </ItemChip>,
    );
    const outer = screen.getByRole("button", { name: "Payroll" }).parentElement!;
    expect(outer.className).toContain("bg-muted");
    expect(outer.className).toContain("text-subtle-foreground");
  });

  it("takes its accessible name from label when given", () => {
    render(
      <ItemChip onSelect={vi.fn()} label="Payroll, View, Team">
        Payroll
      </ItemChip>,
    );
    expect(screen.getByRole("button", { name: "Payroll, View, Team" })).toBeInTheDocument();
  });

  it("gives the name a 44 px target on a phone", () => {
    render(<ItemChip onSelect={vi.fn()}>People</ItemChip>);
    expect(screen.getByRole("button").className).toContain("phone:h-tap");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <ItemChip onSelect={vi.fn()} marks={marks}>
          People
        </ItemChip>
        <ItemChip onSelect={vi.fn()} marks={marks} selected>
          Performance
        </ItemChip>
        <ItemChip onSelect={vi.fn()} muted label="Payroll, No Access">
          Payroll
        </ItemChip>
        <ItemChip>Expenses</ItemChip>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
