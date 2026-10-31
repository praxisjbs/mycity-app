import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { NumberField, PasswordField, PhoneField, TextAreaField, TextField } from "./TextField";

function Bound({ kind }: { kind: "text" | "number" | "phone" | "area" | "password" }) {
  const [v, setV] = useState("");
  const C = { text: TextField, number: NumberField, phone: PhoneField, area: TextAreaField, password: PasswordField }[kind];
  return (
    <Field label="Value">
      <C value={v} onChange={setV} />
    </Field>
  );
}

describe("TextField family", () => {
  it("TextField passes what is typed and shows the mark", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <Field label="First Name">
        <TextField value="" onChange={onChange} />
      </Field>,
    );
    await user.type(screen.getByLabelText("First Name"), "A");
    expect(onChange).toHaveBeenCalledWith("A");
    rerender(
      <Field label="First Name" state="good">
        <TextField value="Ada" onChange={onChange} />
      </Field>,
    );
    expect(screen.getByLabelText("First Name")).not.toHaveAttribute("aria-invalid");
  });

  it("NumberField keeps digits only, as a string", async () => {
    const user = userEvent.setup();
    render(<Bound kind="number" />);
    await user.type(screen.getByLabelText("Value"), "1a2.5");
    expect(screen.getByLabelText("Value")).toHaveValue("125");
  });

  it("NumberField signed keeps a leading minus and nothing else a figure is written with", async () => {
    const user = userEvent.setup();
    function Signed() {
      const [v, setV] = useState("");
      return (
        <Field label="Actual">
          <NumberField decimal signed value={v} onChange={setV} />
        </Field>
      );
    }
    const { unmount } = render(<Signed />);
    const input = screen.getByLabelText("Actual");
    await user.type(input, "64,000");
    expect(input).toHaveValue("64000");
    await user.clear(input);
    await user.type(input, "-2.5%");
    expect(input).toHaveValue("-2.5");
    await user.clear(input);
    await user.type(input, "5-");
    expect(input).toHaveValue("5");
    await user.clear(input);
    await user.type(input, "−12");
    expect(input).toHaveValue("-12");
    unmount();
    // Unsigned, the minus never gets in.
    render(<Bound kind="number" />);
    await user.type(screen.getByLabelText("Value"), "-7");
    expect(screen.getByLabelText("Value")).toHaveValue("7");
  });

  it("PhoneField shows +234 and keeps phone characters", async () => {
    const user = userEvent.setup();
    render(<Bound kind="phone" />);
    expect(screen.getByText("+234")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Value"), "0803 abc 123");
    expect(screen.getByLabelText("Value")).toHaveValue("0803  123");
  });

  it("PasswordField shows and hides with a named button", async () => {
    const user = userEvent.setup();
    render(<Bound kind="password" />);
    const input = screen.getByLabelText("Value");
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
  });

  it("TextAreaField is a labelled multi-line field", () => {
    render(<Bound kind="area" />);
    expect(screen.getByRole("textbox", { name: "Value" }).tagName).toBe("TEXTAREA");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Bound kind="text" />
        <Bound kind="password" />
        <Bound kind="phone" />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
