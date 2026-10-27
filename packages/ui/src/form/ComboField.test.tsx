import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import type { DataViewList } from "../data/DataView";
import { Field } from "./Field";
import { ComboField } from "./ComboField";
import { SAMPLE_UNITS, type SampleUnit } from "./fixtures";

const list = (over: Partial<DataViewList<SampleUnit>> = {}): DataViewList<SampleUnit> => ({
  rows: SAMPLE_UNITS,
  page: { number: 1, size: 25, total: SAMPLE_UNITS.length, pages: 1, has_next: false },
  loading: false,
  error: null,
  q: "",
  setQ: vi.fn(),
  ...over,
});

/** The field as a form holds it: the text lives outside, and is handed back on each change. */
function Held({ start = "", onChange, l = list(), ...rest }: { start?: string; onChange?: (v: string) => void; l?: DataViewList<SampleUnit>; placeholder?: string }) {
  const [value, setValue] = useState(start);
  return (
    <ComboField
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      list={l}
      option={(u) => u.unit}
      sub={(u) => `Used ${u.uses}`}
      {...rest}
    />
  );
}

describe("ComboField", () => {
  it("opens the server's suggestions when the person gets to it, each with its use", async () => {
    render(<Held placeholder="users" />);
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.click(screen.getByRole("combobox"));
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["%Used 31", "usersUsed 9", "daysUsed 6", "₦Used 4", "partnersUsed 1"]);
  });

  it("asks the server to narrow as it is typed, never filtering the rows it has", async () => {
    const setQ = vi.fn();
    render(<Held l={list({ setQ })} />);
    await userEvent.type(screen.getByRole("combobox"), "us");
    expect(setQ).toHaveBeenLastCalledWith("us");
    // Every row the server gave is still shown: nothing is filtered here.
    expect(screen.getAllByRole("option").filter((o) => !/^Add/.test(o.textContent ?? ""))).toHaveLength(SAMPLE_UNITS.length);
  });

  it("keeps what is typed, and offers it as its own row until a suggestion says the same", async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "tickets");
    expect(onChange).toHaveBeenLastCalledWith("tickets");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Add “tickets”");
  });

  it("does not offer to add a unit the list already has, whatever its case", async () => {
    render(<Held start="Users" />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("option", { name: /^Add/ })).toBeNull();
  });

  it("picks a suggestion into the field and closes", async () => {
    const onChange = vi.fn();
    const setQ = vi.fn();
    render(<Held onChange={onChange} l={list({ setQ })} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: /users/ }));
    expect(onChange).toHaveBeenLastCalledWith("users");
    expect(screen.getByRole("combobox")).toHaveValue("users");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(setQ).toHaveBeenLastCalledWith("");
  });

  it("Add keeps the typed text, trimmed, and closes", async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox"), "  tickets ");
    await userEvent.click(screen.getByRole("option", { name: /^Add/ }));
    expect(onChange).toHaveBeenLastCalledWith("tickets");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("moves with the arrow keys, picks with Enter, and Esc closes without clearing", async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", expect.stringMatching(/-1$/));
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("users");

    await userEvent.clear(box);
    await userEvent.type(box, "kg");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveValue("kg");
  });

  it("Enter with no row in hand only closes the list", async () => {
    render(<Held start="kg" />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox")).toHaveValue("kg");
  });

  it("tells the form when the person leaves, not when focus moves inside it", async () => {
    const onBlur = vi.fn();
    render(
      <>
        <ComboField value="" onChange={vi.fn()} onBlur={onBlur} list={list()} option={(u) => u.unit} />
        <button type="button">Elsewhere</button>
      </>,
    );
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: /users/ }));
    expect(onBlur).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("says it is showing the first page of a longer list", async () => {
    render(<Held l={list({ page: { number: 1, size: 25, total: 64, pages: 3, has_next: true } })} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText(/First 5 of 64/)).toBeInTheDocument();
  });

  it("opens no list when there is nothing to offer", async () => {
    render(<Held l={list({ rows: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } })} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.type(screen.getByRole("combobox"), "ha");
    expect(screen.getByRole("option", { name: /^Add/ })).toBeInTheDocument();
  });

  it("inside a Field, its label names the box and the list, and its error is read with them", async () => {
    render(
      <Field label="Unit" state="bad" message="Required">
        <Held />
      </Field>,
    );
    const box = screen.getByLabelText("Unit", { selector: "input" });
    expect(box).toHaveRole("combobox");
    expect(box).toHaveAccessibleDescription("Required");
    expect(box).toHaveAttribute("aria-invalid", "true");
    await userEvent.click(box);
    expect(screen.getByRole("listbox", { name: "Unit" })).toBeInTheDocument();
  });

  it("gives every row a 44 px target on a phone", async () => {
    render(<Held start="kg" />);
    await userEvent.click(screen.getByRole("combobox"));
    screen.getAllByRole("option").forEach((o) => expect(o.className).toContain("phone:min-h-tap"));
  });

  it("has no accessibility violations, open or closed", async () => {
    const { container } = render(
      <Field label="Unit" optional>
        <Held start="kg" />
      </Field>,
    );
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("combobox"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
