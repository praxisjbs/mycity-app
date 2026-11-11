import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { OrderList, type OrderListItem } from "./OrderList";

beforeAll(installOverlayTestEnv);
beforeEach(() => setViewport(1440));

const ITEMS: OrderListItem[] = [
  { key: "a", name: "Staff Handbook", content: "Staff Handbook" },
  { key: "b", name: "Data Protection Video", content: "Data Protection Video" },
  { key: "c", name: "Key Rules", content: "Key Rules" },
];
const drop = (value: string) => ({ dataTransfer: { getData: () => value, setData: () => undefined } });

describe("OrderList", () => {
  it("draws a named ordered list of its rows", () => {
    render(<OrderList label="Course Items" items={ITEMS} />);
    expect(screen.getByRole("list", { name: "Course Items" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Staff Handbook", "Data Protection Video", "Key Rules"]);
  });

  it("moves a row with Move Up and Move Down, offering only the moves it can make", async () => {
    const onMove = vi.fn();
    render(<OrderList label="Course Items" items={ITEMS} onMove={onMove} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Staff Handbook" }));
    expect(screen.queryByRole("menuitem", { name: "Move Up" })).toBeNull();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move Down" }));
    expect(onMove).toHaveBeenCalledWith("a", 1);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Key Rules" }));
    expect(screen.queryByRole("menuitem", { name: "Move Down" })).toBeNull();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move Up" }));
    expect(onMove).toHaveBeenLastCalledWith("c", 1);
    expect(screen.getByRole("status")).toHaveTextContent("Key Rules moved to place 2 of 3");
  });

  it("puts the row's own actions before the moves", async () => {
    const edit = vi.fn();
    render(<OrderList label="Course Items" items={[{ ...ITEMS[0]!, menu: [{ label: "Edit Item", icon: "edit", onSelect: edit }] }, ITEMS[1]!]} onMove={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Staff Handbook" }));
    const names = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(names).toEqual(["Edit Item", "Move Down"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit Item" }));
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("on desktop, a row dropped on another takes its place", () => {
    const onMove = vi.fn();
    const { container } = render(<OrderList label="Course Items" items={ITEMS} onMove={onMove} />);
    expect(container.querySelectorAll("[draggable=true]")).toHaveLength(3);
    fireEvent.drop(screen.getByText("Staff Handbook").closest("li")!, drop("c"));
    expect(onMove).toHaveBeenCalledWith("c", 0);
    fireEvent.drop(screen.getByText("Key Rules").closest("li")!, drop("c"));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("never drags on a phone (F19), where the menu moves the row", async () => {
    setViewport(390);
    const onMove = vi.fn();
    const { container } = render(<OrderList label="Course Items" items={ITEMS} onMove={onMove} />);
    expect(container.querySelector("[draggable=true]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Data Protection Video" }));
    await userEvent.click(await screen.findByRole("button", { name: "Move Up" }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("b", 0));
  });

  it("holds the list while a move is on its way, so a second press moves nothing", async () => {
    let done: () => void = () => undefined;
    const onMove = vi.fn(() => new Promise<void>((r) => (done = r)));
    render(<OrderList label="Course Items" items={ITEMS} onMove={onMove} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Staff Handbook" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move Down" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Course Items" })).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("button", { name: "Actions for Key Rules" })).toHaveAttribute("aria-busy", "true");
    fireEvent.drop(screen.getByText("Staff Handbook").closest("li")!, drop("c"));
    expect(onMove).toHaveBeenCalledTimes(1);
    done();
    await waitFor(() => expect(screen.getByRole("list", { name: "Course Items" })).not.toHaveAttribute("aria-busy"));
  });

  it("shows what it is given when there are no rows, and no handle without onMove", () => {
    const { container, rerender } = render(<OrderList label="Course Items" items={[]} empty={<p>No Items Yet</p>} />);
    expect(screen.getByText("No Items Yet")).toBeInTheDocument();
    rerender(<OrderList label="Course Items" items={ITEMS} />);
    expect(container.querySelector("[draggable=true]")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<OrderList label="Course Items" items={ITEMS.map((i) => ({ ...i, menu: [{ label: "Edit Item", onSelect: () => undefined }] }))} onMove={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
