import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import type { DataViewList } from "../data/DataView";
import { PersonPicker, type PickedPerson } from "./PersonPicker";

const PEOPLE: PickedPerson[] = [
  { employee_id: "e1", display_name: "Adaeze Okonkwo", job_title: "Financial Controller", department: "Finance" },
  { employee_id: "e2", display_name: "Chidi Eze", job_title: "People Partner", department: "People" },
  { employee_id: "e3", display_name: "Ngozi Bello", job_title: null, department: null },
];

const list = (over: Partial<DataViewList<PickedPerson>> = {}): DataViewList<PickedPerson> => ({
  rows: PEOPLE,
  page: { number: 1, size: 25, total: 312, pages: 13, has_next: true },
  loading: false,
  error: null,
  q: "",
  setQ: vi.fn(),
  ...over,
});

describe("PersonPicker", () => {
  it("shows each person's name, job and department with their initials", () => {
    render(<PersonPicker list={list()} value={[]} onChange={vi.fn()} />);
    expect(screen.getByText("Adaeze Okonkwo")).toBeInTheDocument();
    expect(screen.getByText("Financial Controller · Finance")).toBeInTheDocument();
    expect(screen.getByText("AO")).toBeInTheDocument();
  });

  it("leaves out a job or a department the list does not carry", () => {
    render(<PersonPicker list={list()} value={[]} onChange={vi.fn()} />);
    const row = screen.getByRole("option", { name: /Ngozi Bello/ });
    expect(row.textContent).not.toContain("·");
  });

  it("picks a person", async () => {
    const onChange = vi.fn();
    render(<PersonPicker list={list()} value={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("option", { name: /Chidi Eze/ }));
    expect(onChange).toHaveBeenLastCalledWith([PEOPLE[1]]);
  });

  it("picks a panel, and names each chip by the person", async () => {
    const onChange = vi.fn();
    render(<PersonPicker list={list()} value={[PEOPLE[0]!]} onChange={onChange} multiple />);
    expect(screen.getByRole("button", { name: "Remove Adaeze Okonkwo" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Chidi Eze/ }));
    expect(onChange).toHaveBeenLastCalledWith([PEOPLE[0], PEOPLE[1]]);
  });

  it("never offers the whole organisation: it shows one page and says so", () => {
    render(<PersonPicker list={list()} value={[]} onChange={vi.fn()} />);
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByText(/First 3 of 312/)).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<PersonPicker list={list()} value={[PEOPLE[0]!]} onChange={vi.fn()} multiple />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
