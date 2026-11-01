import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { rowsText, SourcesPane } from "./SourcesPane";
import type { PaneRead } from "./pane";

const READS: PaneRead[] = [
  { n: 1, name: "Leave Requests", kind: "read", outcome: "read", filters: [["Status", "waiting"], ["Page", "1"]], rows: 25, total: 312, masked: [], opens: true },
  { n: 2, name: "Employees", kind: "read", outcome: "refused", filters: [], rows: 0, total: null, masked: ["salary", "bank"] },
];

describe("SourcesPane", () => {
  it("lists every read with its filters, rows, outcome and masks, and opens one in the Table", async () => {
    const onOpenTable = vi.fn();
    render(<SourcesPane reads={READS} when="22/10/2026 09:30" onOpenTable={onOpenTable} />);
    expect(screen.getByText("Read 22/10/2026 09:30")).toBeInTheDocument();
    const first = screen.getByRole("listitem", { name: "Read 1, Leave Requests" });
    expect(within(first).getByText("25 of 312 rows")).toBeInTheDocument();
    expect(within(first).getByText("waiting")).toBeInTheDocument();
    expect(within(first).getByText("Read")).toBeInTheDocument();
    await userEvent.click(within(first).getByRole("button", { name: "Open Table" }));
    expect(onOpenTable).toHaveBeenCalledWith(1);
    const second = screen.getByRole("listitem", { name: "Read 2, Employees" });
    expect(within(second).getByText("Not Available")).toBeInTheDocument();
    expect(within(second).getByText("salary, bank")).toBeInTheDocument();
    expect(within(second).queryByRole("button")).toBeNull();
  });

  it("words the rows by what came back", () => {
    expect(rowsText({ kind: "read", outcome: "read", rows: 25, total: 312 })).toBe("25 of 312 rows");
    expect(rowsText({ kind: "read", outcome: "read", rows: 2, total: 2 })).toBe("2 rows");
    expect(rowsText({ kind: "read", outcome: "read", rows: 1, total: null })).toBe("1 record");
    expect(rowsText({ kind: "summary", outcome: "read", rows: 0, total: 40 })).toBe("40 in all");
    expect(rowsText({ kind: "read", outcome: "refused", rows: 0, total: null })).toBeNull();
  });

  it("says No Reads Made when the answer read nothing", () => {
    render(<SourcesPane reads={[]} />);
    expect(screen.getByRole("heading", { name: "No Reads Made" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<SourcesPane reads={READS} onOpenTable={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
