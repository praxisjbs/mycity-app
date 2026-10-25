import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { DataView, type DataViewColumn, type DataViewList } from "./DataView";
import { HelpTerm } from "../help/HelpTerm";
import { installOverlayTestEnv } from "../overlay/test-env";
import { ApiError } from "./createApi";

// The phone sort sheet is a Vaul drawer: jsdom has no pointer capture of its own.
beforeAll(installOverlayTestEnv);

const phone = () => setViewport(390);
const desktop = () => setViewport(1440);

interface Row {
  employee_id: string;
  display_name: string;
  department: string;
  days: number;
}

const ROWS: Row[] = [
  { employee_id: "e1", display_name: "Ada Obi", department: "Finance", days: 4 },
  { employee_id: "e2", display_name: "Chidi Eze", department: "People", days: 12 },
];

const COLUMNS: DataViewColumn<Row>[] = [
  { key: "display_name", label: "Name", sortable: true, render: (r) => r.display_name },
  { key: "department", label: "Department", sortable: true, render: (r) => r.department },
  { key: "days", label: "Days", align: "n", render: (r) => r.days },
  { key: "note", label: "Note", desktop: true, render: () => "" },
];

const list = (over: Partial<DataViewList<Row>> = {}): DataViewList<Row> => ({
  rows: ROWS,
  page: { number: 1, size: 25, total: 312, pages: 13, has_next: true },
  loading: false,
  error: null,
  setPage: vi.fn(),
  q: "",
  setQ: vi.fn(),
  sort: undefined,
  setSort: vi.fn(),
  ...over,
});

const view = (props: Partial<Parameters<typeof DataView<Row>>[0]> = {}) =>
  render(<DataView columns={COLUMNS} rowKey={(r) => r.employee_id} caption="Employees" noun="employee" {...props} />);

describe("DataView on desktop", () => {
  it("draws a table with a caption, the rows and the server's true total", () => {
    desktop();
    view({ list: list() });
    expect(screen.getByRole("table", { name: "Employees" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Ada Obi" })).toBeInTheDocument();
    expect(screen.getByText("1 to 25 of 312 employees")).toBeInTheDocument();
  });

  it("an empty cell draws the shared marker, never a typed dash", () => {
    desktop();
    const { container } = view({ rows: [{ employee_id: "e3", display_name: "Ngozi Bello", department: "", days: 0 }] });
    expect(container.querySelector("[data-empty]")).not.toBeNull();
  });

  it("a sortable header cycles ascending, descending, then the list's own order", async () => {
    desktop();
    const setSort = vi.fn();
    const { rerender } = view({ list: list({ setSort }) });
    await userEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(setSort).toHaveBeenLastCalledWith("display_name");

    rerender(<DataView columns={COLUMNS} rowKey={(r) => r.employee_id} caption="Employees" list={list({ sort: "display_name", setSort })} />);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(setSort).toHaveBeenLastCalledWith("-display_name");

    rerender(<DataView columns={COLUMNS} rowKey={(r) => r.employee_id} caption="Employees" list={list({ sort: "-display_name", setSort })} />);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(setSort).toHaveBeenLastCalledWith(undefined);
  });

  it("a header holding a help term keeps it, and sorts from the glyph beside it", async () => {
    desktop();
    const setSort = vi.fn();
    const columns: DataViewColumn<Row>[] = [
      { key: "display_name", label: <HelpTerm help="The name they go by">Name</HelpTerm>, sortLabel: "Name", sortable: true, render: (r) => r.display_name },
      { key: "department", label: "Department", render: (r) => r.department },
    ];
    const { container } = view({ list: list({ setSort }), columns });
    await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    await vi.waitFor(() => expect(setSort).toHaveBeenLastCalledWith("display_name"));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a column that is not sortable has no header button and no aria-sort", () => {
    desktop();
    view({ list: list() });
    const header = screen.getByRole("columnheader", { name: "Days" });
    expect(header).not.toHaveAttribute("aria-sort");
    expect(within(header).queryByRole("button")).toBeNull();
  });

  it("sort is not offered at all when the list cannot sort", () => {
    desktop();
    view({ list: list({ setSort: undefined }) });
    expect(screen.queryByRole("button", { name: /Name/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Name" })).not.toHaveAttribute("aria-sort");
  });

  it("a row opens by click and by Enter", async () => {
    desktop();
    const onRowClick = vi.fn();
    view({ list: list(), onRowClick });
    const row = screen.getByRole("cell", { name: "Ada Obi" }).closest("tr")!;
    await userEvent.click(row);
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0]);
  });
});

describe("DataView selection", () => {
  it("ticks a row, ticks the page, and shows how many are picked", async () => {
    desktop();
    const onChange = vi.fn();
    const { rerender } = view({ list: list(), selection: { keys: [], onChange, actions: <button type="button">Approve Leave</button> } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    expect(onChange).toHaveBeenLastCalledWith(["e1"]);

    await userEvent.click(screen.getByRole("checkbox", { name: "Select Page" }));
    expect(onChange).toHaveBeenLastCalledWith(["e1", "e2"]);

    rerender(
      <DataView
        columns={COLUMNS}
        rowKey={(r) => r.employee_id}
        caption="Employees"
        list={list()}
        selection={{ keys: ["e1", "e2"], onChange, actions: <button type="button">Approve Leave</button> }}
      />,
    );
    expect(screen.getByText("2 Selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Leave" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Select Page" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("Clear Selection empties the set", async () => {
    desktop();
    const onChange = vi.fn();
    view({ list: list(), selection: { keys: ["e1"], onChange, actions: null } });
    await userEvent.click(screen.getByRole("button", { name: "Clear Selection" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("the bulk bar is not there until something is picked", () => {
    desktop();
    view({ list: list(), selection: { keys: [], onChange: vi.fn(), actions: null } });
    expect(screen.queryByText(/Selected/)).toBeNull();
  });
});

describe("DataView on a phone", () => {
  it("is a card list with no table at all (gate 11)", () => {
    phone();
    view({ list: list() });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("Ada Obi")).toBeInTheDocument();
  });

  it("drops a desktop-only column and keeps at most three value pairs", () => {
    phone();
    view({ list: list() });
    expect(screen.queryByText("Note")).toBeNull();
    // One label pair per card, and no card carries the desktop-only column.
    expect(screen.getAllByText("Department")).toHaveLength(ROWS.length);
  });

  it("offers sort in an action sheet, since there is no table header", async () => {
    phone();
    const setSort = vi.fn();
    view({ list: list({ setSort }) });
    await userEvent.click(screen.getByRole("button", { name: "Sort" }));
    // On a phone the menu is an action sheet of plain buttons, not a desktop menu.
    await userEvent.click(screen.getByRole("button", { name: /Department Down/ }));
    await vi.waitFor(() => expect(setSort).toHaveBeenLastCalledWith("-department"));
  });

  it("the whole card opens the row", async () => {
    phone();
    const onRowClick = vi.fn();
    view({ list: list(), onRowClick });
    await userEvent.click(screen.getByRole("button", { name: "Ada Obi" }));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });

  it("a tick on a card that opens its row picks the row, never opens it", async () => {
    phone();
    const onRowClick = vi.fn();
    const onChange = vi.fn();
    view({ list: list(), onRowClick, selection: { keys: [], onChange, actions: null } });
    const tick = screen.getByRole("checkbox", { name: "Select Ada Obi" });
    // jsdom does no hit-testing, so the classes stand in for it: the tick sits above the card's stretched button, inside the card.
    expect(tick).toHaveClass("relative", "z-10");
    expect(tick.closest("li")).toHaveClass("relative", "isolate");
    await userEvent.click(tick);
    expect(onChange).toHaveBeenCalledWith(["e1"]);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("DataView states", () => {
  it("shows the search box only when the list can search, and sends what is typed", async () => {
    desktop();
    const setQ = vi.fn();
    view({ list: list({ setQ }), search: "Search People" });
    await userEvent.type(screen.getByRole("searchbox"), "ada");
    expect(setQ).toHaveBeenCalled();
  });

  it("an empty list says nothing matches while searching, and nothing yet otherwise", () => {
    desktop();
    const { rerender } = view({ list: list({ rows: [], page: undefined }) });
    expect(screen.getByText("Nothing Here Yet")).toBeInTheDocument();
    rerender(<DataView columns={COLUMNS} rowKey={(r) => r.employee_id} caption="Employees" list={list({ rows: [], page: undefined, q: "zzz" })} />);
    expect(screen.getByText("Nothing Matches")).toBeInTheDocument();
  });

  it("an error replaces the empty state, with Try Again", async () => {
    desktop();
    const reload = vi.fn();
    view({ list: list({ rows: [], error: new ApiError(500, null), reload }) });
    await userEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the first page shows placeholder lines; a reload dims the rows and says aria-busy", () => {
    desktop();
    const { rerender, container } = view({ list: list({ rows: [], loading: true }) });
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    rerender(<DataView columns={COLUMNS} rowKey={(r) => r.employee_id} caption="Employees" list={list({ loading: true })} />);
    expect(container.querySelector("tbody")).toHaveAttribute("aria-busy", "true");
  });

  it("Export queues the whole filtered list, not the page on screen", async () => {
    desktop();
    const onExport = vi.fn().mockResolvedValue({});
    view({ list: list(), onExport });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("takes rows without a list, and then draws no pager", () => {
    desktop();
    view({ rows: ROWS });
    expect(screen.getByRole("cell", { name: "Ada Obi" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("takes the state as plain props for a set already in hand", async () => {
    desktop();
    const onPage = vi.fn();
    const onReload = vi.fn();
    const { rerender, container } = view({ rows: [], loading: true });
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    rerender(<DataView columns={COLUMNS} rowKey={(r) => r.employee_id} caption="Employees" rows={[]} error={new ApiError(500, null)} onReload={onReload} />);
    await userEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(onReload).toHaveBeenCalledTimes(1);

    rerender(
      <DataView
        columns={COLUMNS}
        rowKey={(r) => r.employee_id}
        caption="Employees"
        noun="employee"
        rows={ROWS}
        page={{ number: 1, size: 25, total: 312, pages: 13, has_next: true }}
        onPage={onPage}
      />,
    );
    expect(screen.getByText("1 to 25 of 312 employees")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenLastCalledWith(2);
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("has no accessibility violations as a table or as cards", async () => {
    desktop();
    const { container, unmount } = view({ list: list(), search: "Search People", onRowClick: vi.fn(), selection: { keys: ["e1"], onChange: vi.fn(), actions: null }, title: "Employees" });
    expect(await axe(container)).toHaveNoViolations();
    unmount();
    phone();
    const second = view({ list: list(), onRowClick: vi.fn(), title: "Employees" });
    expect(await axe(second.container)).toHaveNoViolations();
  });
});
