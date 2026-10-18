import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { CardPicker, type CardPickerOption } from "./CardPicker";

const CARDS: CardPickerOption[] = [
  { id: "headcount", title: "Headcount" },
  { id: "attendance_today", title: "Clocked In Today", locked: true },
  { id: "tasks_overdue", title: "Overdue Tasks" },
  { id: "expenses_pending", title: "Expenses Awaiting Approval" },
  { id: "partnerships_active", title: "Active Partnerships" },
  { id: "vacancies_open", title: "Open Vacancies" },
];

/** The picker held by a form, as a screen holds it: every change comes back as the new value. */
function Held({ start, onChange }: { start: string[]; onChange?: (next: string[]) => void }) {
  const [value, setValue] = useState(start);
  return (
    <CardPicker
      label="Overview Cards"
      options={CARDS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

/** The ticks in the order they show, by their card's title. */
const order = () => screen.getAllByRole("checkbox").map((c) => c.closest("li")?.querySelector("label")?.textContent);
const tick = (title: string) => screen.getByRole("checkbox", { name: title });
const moveUp = (title: string) => screen.getByRole("button", { name: `Move Up, ${title}` });
const moveDown = (title: string) => screen.getByRole("button", { name: `Move Down, ${title}` });
const status = () => screen.getByRole("status");

describe("CardPicker", () => {
  it("is a named group: the chosen cards in order with the locked ones first, then the rest in the catalogue's order", () => {
    render(<CardPicker label="Overview Cards" options={CARDS} value={["tasks_overdue", "attendance_today", "headcount"]} onChange={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Overview Cards" });
    expect(group).toHaveAccessibleDescription("3 of 4");
    expect(order()).toEqual(["Clocked In Today", "Overdue Tasks", "Headcount", "Expenses Awaiting Approval", "Active Partnerships", "Open Vacancies"]);
    // Two lists: the chosen cards, all ticked, then the rest.
    const ticks = within(group)
      .getAllByRole("list")
      .map((list) => within(list).getAllByRole("checkbox").map((c) => c.getAttribute("aria-checked")));
    expect(ticks).toEqual([
      ["true", "true", "true"],
      ["false", "false", "false"],
    ]);
  });

  it("shows the count of chosen cards out of the most that fit", () => {
    render(<CardPicker label="Overview Cards" options={CARDS} value={["attendance_today", "tasks_overdue", "headcount"]} onChange={vi.fn()} />);
    expect(screen.getByText("3 of 4")).toBeInTheDocument();
  });

  it("keeps a locked card ticked, first and marked Locked even when the value leaves it out, and drops ids with no card", async () => {
    const onChange = vi.fn();
    render(<Held start={["headcount", "payroll_run_state", "headcount"]} onChange={onChange} />);
    expect(order().slice(0, 2)).toEqual(["Clocked In Today", "Headcount"]);
    expect(tick("Clocked In Today")).toBeChecked();
    expect(tick("Clocked In Today")).toBeDisabled();
    expect(tick("Clocked In Today")).toHaveAccessibleDescription("Locked");
    expect(screen.getByText("2 of 4")).toBeInTheDocument();
    await userEvent.click(tick("Open Vacancies"));
    expect(onChange).toHaveBeenLastCalledWith(["attendance_today", "headcount", "vacancies_open"]);
  });

  it("never takes a locked card off and gives it no Move Up or Move Down", async () => {
    const onChange = vi.fn();
    render(<Held start={["attendance_today", "tasks_overdue"]} onChange={onChange} />);
    await userEvent.click(tick("Clocked In Today"));
    await userEvent.click(screen.getByText("Clocked In Today"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Clocked In Today/ })).toBeNull();
  });

  it("puts a ticked card at the end of the chosen ones and takes an unticked one back to the rest", async () => {
    const onChange = vi.fn();
    render(<Held start={["attendance_today", "tasks_overdue"]} onChange={onChange} />);
    await userEvent.click(tick("Active Partnerships"));
    expect(onChange).toHaveBeenLastCalledWith(["attendance_today", "tasks_overdue", "partnerships_active"]);
    expect(order().slice(0, 3)).toEqual(["Clocked In Today", "Overdue Tasks", "Active Partnerships"]);
    // The title is its label: pressing it ticks too.
    await userEvent.click(screen.getByText("Overdue Tasks"));
    expect(onChange).toHaveBeenLastCalledWith(["attendance_today", "partnerships_active"]);
    expect(order()).toEqual(["Clocked In Today", "Active Partnerships", "Headcount", "Overdue Tasks", "Expenses Awaiting Approval", "Open Vacancies"]);
    expect(tick("Overdue Tasks")).not.toBeChecked();
  });

  it("refuses a card past the limit with the field error on it, and clears the error once there is room", async () => {
    const onChange = vi.fn();
    render(<Held start={["attendance_today", "tasks_overdue", "headcount", "expenses_pending"]} onChange={onChange} />);
    await userEvent.click(tick("Open Vacancies"));
    expect(onChange).not.toHaveBeenCalled();
    expect(tick("Open Vacancies")).not.toBeChecked();
    expect(tick("Open Vacancies")).toHaveAttribute("aria-invalid", "true");
    expect(tick("Open Vacancies")).toHaveAccessibleDescription("Pick up to 4 cards");
    expect(screen.getAllByText("Pick up to 4 cards")).toHaveLength(2); // on the card, and in the status line
    expect(status()).toHaveTextContent("Pick up to 4 cards");

    // Another refused card takes the error; only one card carries it.
    await userEvent.click(tick("Active Partnerships"));
    expect(tick("Open Vacancies")).not.toHaveAttribute("aria-invalid");
    expect(tick("Active Partnerships")).toHaveAttribute("aria-invalid", "true");

    await userEvent.click(tick("Headcount"));
    expect(onChange).toHaveBeenLastCalledWith(["attendance_today", "tasks_overdue", "expenses_pending"]);
    expect(tick("Active Partnerships")).not.toHaveAttribute("aria-invalid");
    expect(tick("Active Partnerships")).not.toHaveAccessibleDescription();
    expect(status()).toHaveTextContent("3 of 4");
  });

  it("drops the error as soon as the row changes, by a move or from outside", async () => {
    const full = ["attendance_today", "tasks_overdue", "headcount", "expenses_pending"];
    render(<Held start={full} />);
    await userEvent.click(tick("Open Vacancies"));
    expect(tick("Open Vacancies")).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(moveDown("Overdue Tasks"));
    expect(tick("Open Vacancies")).not.toHaveAttribute("aria-invalid");
    expect(tick("Open Vacancies")).not.toHaveAccessibleDescription();

    const onChange = vi.fn();
    const { rerender } = render(<CardPicker label="Role Cards" options={CARDS} value={full} onChange={onChange} />);
    const role = within(screen.getByRole("group", { name: "Role Cards" }));
    await userEvent.click(role.getByRole("checkbox", { name: "Active Partnerships" }));
    expect(role.getByRole("checkbox", { name: "Active Partnerships" })).toHaveAttribute("aria-invalid", "true");
    // Going back to the role's cards, which are full too, is a new row: no error is carried over.
    rerender(<CardPicker label="Role Cards" options={CARDS} value={["attendance_today", "vacancies_open", "tasks_overdue", "headcount"]} onChange={onChange} />);
    expect(role.getByRole("checkbox", { name: "Active Partnerships" })).not.toHaveAttribute("aria-invalid");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("holds any other limit, counting the locked cards against it", async () => {
    const onChange = vi.fn();
    render(<CardPicker label="Overview Cards" options={CARDS} value={["headcount"]} onChange={onChange} max={2} />);
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    await userEvent.click(tick("Open Vacancies"));
    expect(onChange).not.toHaveBeenCalled();
    expect(tick("Open Vacancies")).toHaveAccessibleDescription("Pick up to 2 cards");
  });

  it("moves a chosen card up and down with worded buttons, never above the locked cards or past the end", async () => {
    const onChange = vi.fn();
    render(<Held start={["attendance_today", "tasks_overdue", "headcount", "expenses_pending"]} onChange={onChange} />);
    expect(moveUp("Overdue Tasks")).toHaveTextContent("Move Up");
    expect(moveDown("Overdue Tasks")).toHaveTextContent("Move Down");
    expect(moveUp("Overdue Tasks")).toHaveAttribute("aria-disabled", "true");
    expect(moveDown("Expenses Awaiting Approval")).toHaveAttribute("aria-disabled", "true");
    expect(moveDown("Overdue Tasks")).not.toHaveAttribute("aria-disabled");

    await userEvent.click(moveUp("Overdue Tasks"));
    await userEvent.click(moveDown("Expenses Awaiting Approval"));
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(moveDown("Overdue Tasks"));
    expect(onChange).toHaveBeenLastCalledWith(["attendance_today", "headcount", "tasks_overdue", "expenses_pending"]);
    await userEvent.click(moveUp("Expenses Awaiting Approval"));
    expect(onChange).toHaveBeenLastCalledWith(["attendance_today", "headcount", "expenses_pending", "tasks_overdue"]);
    expect(order().slice(0, 4)).toEqual(["Clocked In Today", "Headcount", "Expenses Awaiting Approval", "Overdue Tasks"]);
    expect(status()).toHaveTextContent("Expenses Awaiting Approval moved to 3 of 4");
    // Cards not on the row do not move.
    expect(screen.queryByRole("button", { name: /Open Vacancies/ })).toBeNull();
  });

  it("works from the keyboard: Tab reaches every tick and move button, skipping the locked tick, and focus stays with the card as it moves", async () => {
    const user = userEvent.setup();
    render(<Held start={["attendance_today", "tasks_overdue", "headcount"]} />);
    await user.tab();
    expect(tick("Overdue Tasks")).toHaveFocus();
    await user.tab();
    expect(moveUp("Overdue Tasks")).toHaveFocus();
    await user.tab();
    expect(moveDown("Overdue Tasks")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(order().slice(0, 3)).toEqual(["Clocked In Today", "Headcount", "Overdue Tasks"]);
    expect(moveDown("Overdue Tasks")).toHaveFocus();
    expect(moveDown("Overdue Tasks")).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Enter}");
    expect(moveDown("Overdue Tasks")).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(moveUp("Overdue Tasks")).toHaveFocus();
    await user.keyboard(" ");
    expect(order().slice(0, 3)).toEqual(["Clocked In Today", "Overdue Tasks", "Headcount"]);
    expect(moveUp("Overdue Tasks")).toHaveFocus();
    expect(moveUp("Overdue Tasks")).toHaveAttribute("aria-disabled", "true");

    tick("Open Vacancies").focus();
    await user.keyboard(" ");
    expect(order().slice(0, 4)).toEqual(["Clocked In Today", "Overdue Tasks", "Headcount", "Open Vacancies"]);
    expect(tick("Open Vacancies")).toHaveFocus();
    expect(tick("Open Vacancies")).toBeChecked();
    expect(status()).toHaveTextContent("4 of 4");

    await user.keyboard(" ");
    expect(tick("Open Vacancies")).toHaveFocus();
    expect(tick("Open Vacancies")).not.toBeChecked();
  });

  it("follows a value changed from outside, such as going back to the role's cards", () => {
    const { rerender } = render(<CardPicker label="Overview Cards" options={CARDS} value={["headcount"]} onChange={vi.fn()} />);
    rerender(<CardPicker label="Overview Cards" options={CARDS} value={["attendance_today", "partnerships_active", "vacancies_open"]} onChange={vi.fn()} />);
    expect(order().slice(0, 3)).toEqual(["Clocked In Today", "Active Partnerships", "Open Vacancies"]);
    expect(tick("Headcount")).not.toBeChecked();
    expect(screen.getByText("3 of 4")).toBeInTheDocument();
  });

  it("keeps 44 px targets on a phone and leaves the count off it", () => {
    setViewport(390);
    render(<CardPicker label="Overview Cards" options={CARDS} value={["attendance_today", "tasks_overdue", "headcount"]} onChange={vi.fn()} />);
    for (const c of screen.getAllByRole("checkbox")) expect(c.className).toContain("size-tap");
    for (const b of screen.getAllByRole("button")) expect(b.className).toContain("phone:min-h-tap");
    expect(screen.getByText("3 of 4").className).toContain("phone:hidden");
  });

  it("has no accessibility violations, with a locked card and with a refused one", async () => {
    const { container } = render(<Held start={["attendance_today", "tasks_overdue", "headcount", "expenses_pending"]} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(tick("Open Vacancies"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
