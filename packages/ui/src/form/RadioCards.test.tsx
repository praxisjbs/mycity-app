import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { RadioCards, type RadioCardOption } from "./RadioCards";

type Level = "none" | "view" | "add" | "edit" | "full";

const levels: ReadonlyArray<RadioCardOption<Level>> = [
  { value: "none", label: "No Access", leading: <span data-testid="glyph-none" /> },
  { value: "view", label: "View" },
  { value: "add", label: "Add" },
  { value: "edit", label: "Edit" },
  { value: "full", label: "Full" },
];

/** RadioCards as a screen holds it: the value in state, every choice also reported to the spy. */
function Held({ initial, onChange }: { initial: Level | null; onChange: (value: Level) => void }) {
  const [level, setLevel] = useState<Level | null>(initial);
  return (
    <RadioCards
      label="People Access"
      value={level}
      onChange={(v) => {
        setLevel(v);
        onChange(v);
      }}
      options={levels}
    />
  );
}

describe("RadioCards", () => {
  it("draws a named radio group with one radio per option and hides the glyph", () => {
    render(<RadioCards label="Payroll Access" value="view" onChange={() => undefined} options={levels} />);
    const group = screen.getByRole("radiogroup", { name: "Payroll Access" });
    expect(group).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "View" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "View" }).className).toContain("data-[state=checked]:bg-accent");
    expect(screen.getByRole("radio", { name: "No Access" })).toHaveAttribute("data-ui", "button");
    expect(screen.getByTestId("glyph-none").parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("calls onChange with the chosen value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RadioCards label="Payroll Access" value="view" onChange={onChange} options={levels} />);
    await user.click(screen.getByRole("radio", { name: "Edit" }));
    expect(onChange).toHaveBeenCalledWith("edit");
  });

  it("moves and chooses with the up and down arrow keys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held initial="add" onChange={onChange} />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "Add" })).toHaveFocus();
    /* Radix moves focus a tick after keydown and chooses only while the arrow is held, as a real press is. */
    await user.keyboard("{ArrowDown>}");
    expect(screen.getByRole("radio", { name: "Edit" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("edit");
    expect(screen.getByRole("radio", { name: "Edit" })).toBeChecked();
    await user.keyboard("{/ArrowDown}{ArrowUp>}");
    expect(screen.getByRole("radio", { name: "Add" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("add");
    await user.keyboard("{/ArrowUp}");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("has nothing checked while the value is null, and stays controlled once one is chosen", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { rerender } = render(<RadioCards label="Performance Access" value={null} onChange={() => undefined} options={levels} />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    rerender(<RadioCards label="Performance Access" value="full" onChange={() => undefined} options={levels} />);
    expect(screen.getByRole("radio", { name: "Full" })).toBeChecked();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("shows a disabled option but never chooses it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const options = levels.map((o) => (o.value === "full" ? { ...o, disabled: true } : o));
    render(<RadioCards label="Payroll Access" value="edit" onChange={onChange} options={options} />);
    const full = screen.getByRole("radio", { name: "Full" });
    expect(full).toBeDisabled();
    await user.click(full);
    expect(onChange).not.toHaveBeenCalled();
    expect(full).not.toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Edit" }));
    await user.keyboard("{ArrowDown>}");
    expect(screen.getByRole("radio", { name: "No Access" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("none");
    expect(onChange).not.toHaveBeenCalledWith("full");
    await user.keyboard("{/ArrowDown}");
  });

  it("calls onBlur only when focus leaves the group", async () => {
    const user = userEvent.setup();
    const onBlur = vi.fn();
    render(
      <div>
        <RadioCards label="Payroll Access" value="view" onChange={() => undefined} onBlur={onBlur} options={levels} />
        <button type="button">Save Role</button>
      </div>,
    );
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(onBlur).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save Role" })).toHaveFocus();
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("takes the bad state and its error from the Field", () => {
    render(
      <Field label="Payroll Access" state="bad" message="Choose a level">
        <RadioCards value={null} onChange={() => undefined} options={levels} />
      </Field>,
    );
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group.className).toContain("border-destructive");
    const error = screen.getByText("Choose a level").closest("p")!;
    expect(group.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <RadioCards label="Payroll Access" value="view" onChange={() => undefined} options={levels.map((o) => (o.value === "full" ? { ...o, disabled: true } : o))} />
        <RadioCards label="People Access" value={null} onChange={() => undefined} options={levels} />
        <Field label="Performance Access" state="bad" message="Choose a level">
          <RadioCards value={null} onChange={() => undefined} options={levels} />
        </Field>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
