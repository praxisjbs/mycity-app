import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { TablePane } from "./TablePane";

const ROWS = {
  caption: "Leave requests",
  columns: ["Employee", "Days", "Starts"],
  rows: [
    ["Ayo Bello", "3", "27/10/2026"],
    ["Kemi Ade", "2", "02/11/2026"],
  ],
  numeric: [1],
  links: ["/people?tab=leave&id=l1", null],
};

describe("TablePane", () => {
  it("draws the read's rows with the server's page, and a row opens its record", async () => {
    setViewport(1440);
    const onOpenRow = vi.fn();
    const onPage = vi.fn();
    render(<TablePane {...ROWS} page={{ number: 1, size: 25, total: 40, pages: 2, has_next: true }} onPage={onPage} onOpenRow={onOpenRow} />);
    expect(screen.getByRole("table", { name: "Leave requests" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("row", { name: /Ayo Bello/ }));
    expect(onOpenRow).toHaveBeenCalledWith(0);
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("past 200 rows it stops paging and says how many rows there are", () => {
    setViewport(1440);
    render(<TablePane {...ROWS} page={{ number: 8, size: 25, total: 1240, pages: 50, has_next: true }} onPage={vi.fn()} />);
    expect(screen.getByText("Showing the first 200 of 1,240 rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    expect(screen.getByText("Page 8 of 8")).toBeInTheDocument();
  });

  it("draws no Download Excel until a screen wires one", () => {
    setViewport(1440);
    const { rerender } = render(<TablePane {...ROWS} />);
    expect(screen.queryByRole("button", { name: /Export|Excel/ })).toBeNull();
    rerender(<TablePane {...ROWS} onExport={() => Promise.resolve()} />);
    expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
  });

  it("is a card list on a phone", () => {
    setViewport(390);
    render(<TablePane {...ROWS} onOpenRow={vi.fn()} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: /Ayo Bello/ })).toBeInTheDocument();
    setViewport(1440);
  });

  it("has no accessibility violations", async () => {
    setViewport(1440);
    const { container } = render(<TablePane {...ROWS} page={{ number: 1, size: 25, total: 2, pages: 1, has_next: false }} onPage={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
