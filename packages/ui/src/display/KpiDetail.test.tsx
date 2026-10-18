import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import type { DataViewColumn, DataViewList } from "../data/DataView";
import { KpiDetail, type KpiDetailGroup } from "./KpiDetail";

interface Person {
  id: string;
  display_name: string;
  where: string;
}

const PEOPLE: Person[] = [
  { id: "p1", display_name: "Adaeze Okonkwo", where: "On Site" },
  { id: "p2", display_name: "Chidi Eze", where: "Remote" },
];

const COLUMNS: DataViewColumn<Person>[] = [
  { key: "display_name", label: "Name", render: (r) => r.display_name },
  { key: "where", label: "Where", render: (r) => r.where },
];

const GROUPS: KpiDetailGroup[] = [
  { value: "on_site", label: "On Site", count: 14 },
  { value: "remote", label: "Remote", count: 8 },
];

const list = (over: Partial<DataViewList<Person>> = {}): DataViewList<Person> => ({
  rows: PEOPLE,
  page: { number: 1, size: 25, total: 22, pages: 1, has_next: false },
  loading: false,
  error: null,
  setPage: vi.fn(),
  q: "",
  setQ: vi.fn(),
  ...over,
});

const detail = (props: Partial<Parameters<typeof KpiDetail<Person>>[0]> = {}) =>
  render(<KpiDetail list={list()} columns={COLUMNS} rowKey={(r) => r.id} caption="Clocked In Today" noun="person" nounPlural="people" {...props} />);

describe("KpiDetail", () => {
  it("shows the records behind the number with the server's total", () => {
    setViewport(1440);
    detail();
    expect(screen.getByRole("cell", { name: "Adaeze Okonkwo" })).toBeInTheDocument();
    expect(screen.getByText("22 people")).toBeInTheDocument();
  });

  it("carries its one operational summary line as a live region", () => {
    detail({ summary: "22 of 25 clocked in across the organisation" });
    expect(screen.getByText("22 of 25 clocked in across the organisation")).toHaveAttribute("aria-live", "polite");
  });

  it("offers the groups the rules read, with All first and every count", async () => {
    const onGroup = vi.fn();
    detail({ groups: GROUPS, group: "all", onGroup });
    expect(screen.getByRole("group", { name: "Clocked In Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All 22/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Remote 8/ }));
    expect(onGroup).toHaveBeenLastCalledWith("remote");
  });

  it("counts All from the whole list, not the groups, which can overlap, and keeps it while a group is chosen", async () => {
    const overlapping: KpiDetailGroup[] = [
      { value: "on_site", label: "On Site", count: 14 },
      { value: "late", label: "Late", count: 3 },
      { value: "no_clock_out_yesterday", label: "No Clock-Out Yesterday", count: 2 },
    ];
    const whole = list({ page: { number: 1, size: 25, total: 17, pages: 1, has_next: false } });
    const { rerender } = detail({ groups: overlapping, group: "all", onGroup: vi.fn(), list: whole });
    expect(await screen.findByRole("button", { name: /All 17/ })).toBeInTheDocument();
    const late = list({ rows: PEOPLE.slice(0, 1), page: { number: 1, size: 25, total: 3, pages: 1, has_next: false } });
    rerender(<KpiDetail list={late} columns={COLUMNS} rowKey={(r) => r.id} caption="Clocked In Today" groups={overlapping} group="late" onGroup={vi.fn()} />);
    expect(screen.getByRole("button", { name: /All 17/ })).toBeInTheDocument();
  });

  it("shows no chips for a figure with one group or none", () => {
    const { rerender } = detail({ groups: [{ value: "on_site", label: "On Site", count: 14 }], group: "all", onGroup: vi.fn() });
    expect(screen.queryByRole("group", { name: "Clocked In Today" })).toBeNull();
    rerender(<KpiDetail list={list()} columns={COLUMNS} rowKey={(r) => r.id} caption="Clocked In Today" />);
    expect(screen.queryByRole("group", { name: "Clocked In Today" })).toBeNull();
  });

  it("offers search only once the list is longer than a screenful", () => {
    const { rerender } = detail({ list: list({ page: { number: 1, size: 25, total: 5, pages: 1, has_next: false } }) });
    expect(screen.queryByRole("searchbox")).toBeNull();
    rerender(<KpiDetail list={list()} columns={COLUMNS} rowKey={(r) => r.id} caption="Clocked In Today" />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("opens a record", async () => {
    setViewport(1440);
    const onRowClick = vi.fn();
    detail({ onRowClick });
    await userEvent.click(screen.getByRole("cell", { name: "Chidi Eze" }).closest("tr")!);
    expect(onRowClick).toHaveBeenCalledWith(PEOPLE[1]);
  });

  it("a figure with nothing behind it opens to an empty state, not a blank modal", () => {
    detail({ list: list({ rows: [], page: undefined }) });
    expect(screen.getByText("Nothing Behind This")).toBeInTheDocument();
  });

  it("is cards with no table on a phone", () => {
    setViewport(390);
    detail({ groups: GROUPS, group: "all", onGroup: vi.fn() });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Adaeze Okonkwo")).toBeInTheDocument();
    setViewport(1440);
  });

  it("has no accessibility violations", async () => {
    setViewport(1440);
    const { container } = detail({ summary: "22 of 25 clocked in", groups: GROUPS, group: "all", onGroup: vi.fn() });
    expect(await axe(container)).toHaveNoViolations();
  });
});
