import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import type { DataViewList } from "../data/DataView";
import { RecordPicker } from "./RecordPicker";

interface Worksite {
  worksite_id: string;
  name: string;
  area: string;
}

const SITES: Worksite[] = [
  { worksite_id: "w1", name: "Lekki Office", area: "Lagos Island" },
  { worksite_id: "w2", name: "Ikeja Depot", area: "Lagos Mainland" },
];

const list = (over: Partial<DataViewList<Worksite>> = {}): DataViewList<Worksite> => ({
  rows: SITES,
  page: { number: 1, size: 25, total: 2, pages: 1, has_next: false },
  loading: false,
  error: null,
  q: "",
  setQ: vi.fn(),
  ...over,
});

const picker = (props: Partial<Parameters<typeof RecordPicker<Worksite>>[0]> = {}) =>
  render(
    <RecordPicker
      list={list()}
      value={[]}
      onChange={vi.fn()}
      id={(w) => w.worksite_id}
      title={(w) => w.name}
      sub={(w) => w.area}
      placeholder="Search Sites"
      {...props}
    />,
  );

describe("RecordPicker", () => {
  it("shows the page the server returned, as a named listbox", () => {
    picker();
    const box = screen.getByRole("listbox", { name: "Search Sites" });
    expect(within(box).getAllByRole("option")).toHaveLength(2);
    expect(screen.getByText("Lekki Office")).toBeInTheDocument();
    expect(screen.getByText("Lagos Island")).toBeInTheDocument();
  });

  it("sends what is typed to the server, never filtering the rows it has", async () => {
    const setQ = vi.fn();
    picker({ list: list({ setQ }) });
    await userEvent.type(screen.getByRole("searchbox"), "lek");
    expect(setQ).toHaveBeenCalled();
    // Every row the server gave is still shown: nothing is filtered here.
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("picks one and closes, when only one may be picked", async () => {
    const onChange = vi.fn();
    picker({ onChange });
    await userEvent.click(screen.getByRole("option", { name: /Lekki Office/ }));
    expect(onChange).toHaveBeenLastCalledWith([SITES[0]]);
  });

  it("adds and removes when several may be picked", async () => {
    const onChange = vi.fn();
    const { rerender } = picker({ onChange, multiple: true });
    await userEvent.click(screen.getByRole("option", { name: /Ikeja Depot/ }));
    expect(onChange).toHaveBeenLastCalledWith([SITES[1]]);

    rerender(
      <RecordPicker list={list()} value={[SITES[1]!]} onChange={onChange} id={(w) => w.worksite_id} title={(w) => w.name} multiple placeholder="Search Sites" />,
    );
    expect(screen.getByRole("option", { name: /Ikeja Depot/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("option", { name: /Ikeja Depot/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("closes behind its chip when only one may be picked, and reopens on typing", async () => {
    const setQ = vi.fn();
    render(
      <RecordPicker list={list({ setQ })} value={[SITES[0]!]} onChange={vi.fn()} id={(w) => w.worksite_id} title={(w) => w.name} placeholder="Search Sites" />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.type(screen.getByRole("searchbox"), "ik");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("stays open while several are being picked", () => {
    render(
      <RecordPicker list={list()} value={[SITES[0]!]} onChange={vi.fn()} id={(w) => w.worksite_id} title={(w) => w.name} multiple placeholder="Search Sites" />,
    );
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("lets a picked record go from its chip", async () => {
    const onChange = vi.fn();
    render(
      <RecordPicker list={list()} value={[SITES[0]!]} onChange={onChange} id={(w) => w.worksite_id} title={(w) => w.name} multiple placeholder="Search Sites" />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Lekki Office" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("says it is showing the first page of a longer list", () => {
    picker({ list: list({ page: { number: 1, size: 25, total: 312, pages: 13, has_next: true } }) });
    const line = screen.getByText(/First 2 of 312/);
    expect(line).toHaveAttribute("aria-live", "polite");
  });

  it("says when the server matched nothing", () => {
    picker({ list: list({ rows: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } }) });
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("gives every row a 44 px target on a phone", () => {
    picker();
    screen.getAllByRole("option").forEach((o) => expect(o.className).toContain("phone:min-h-tap"));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <RecordPicker
        list={list()}
        value={[SITES[0]!]}
        onChange={vi.fn()}
        id={(w) => w.worksite_id}
        title={(w) => w.name}
        sub={(w) => w.area}
        multiple
        placeholder="Search Sites"
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
