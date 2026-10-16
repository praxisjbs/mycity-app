import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Pill } from "./Pill";
import { TapList } from "./TapList";

const ITEMS = [
  { key: "p1", title: "September 2026", sub: "Paid 25/09/2026" },
  { key: "p2", title: "August 2026", sub: "Paid 25/08/2026" },
];

describe("TapList", () => {
  it("draws a named list whose rows are buttons", () => {
    render(<TapList items={ITEMS} label="Payslips" />);
    expect(screen.getByRole("list", { name: "Payslips" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /September 2026/ })).toBeInTheDocument();
  });

  it("opens the row it is given", async () => {
    const onSelect = vi.fn();
    render(<TapList items={[{ ...ITEMS[0]!, onSelect }]} />);
    await userEvent.click(screen.getByRole("button", { name: /September 2026/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("carries what sits before the chevron", () => {
    render(<TapList items={[{ ...ITEMS[0]!, end: <Pill tone="ok">Paid</Pill> }]} />);
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("runs to the screen's edges when flat", () => {
    const { container } = render(<TapList items={ITEMS} flat />);
    expect(container.firstElementChild!.className).toContain("-mx-3.5");
  });

  it("gives every row a 44 px target on a phone", () => {
    render(<TapList items={ITEMS} />);
    screen.getAllByRole("button").forEach((b) => expect(b.className).toContain("phone:min-h-tap"));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<TapList items={ITEMS.map((i) => ({ ...i, onSelect: vi.fn(), end: <Pill tone="ok">Paid</Pill> }))} label="Payslips" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
