import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { useState } from "react";
import { MoneyField, readMoney, toMoneyString } from "./MoneyField";

describe("MoneyField", () => {
  it("keeps digits, commas and a point as typed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Amount">
        <MoneyField value="" onChange={onChange} />
      </Field>,
    );
    await user.type(screen.getByLabelText("Amount"), "N");
    expect(onChange).toHaveBeenLastCalledWith("");
    await user.type(screen.getByLabelText("Amount"), "5");
    expect(onChange).toHaveBeenLastCalledWith("5");
  });

  it("toMoneyString turns what was typed into the wire string, never a float", () => {
    expect(toMoneyString("250,000")).toBe("250000.00");
    expect(toMoneyString("250000.5")).toBe("250000.50");
    expect(toMoneyString("0.1")).toBe("0.10");
    expect(toMoneyString("0")).toBe("0.00");
    expect(toMoneyString("-100")).toBe("-100.00");
    expect(toMoneyString("-.5")).toBe("-0.50");
    expect(toMoneyString("")).toBe("");
  });

  it("never turns a negative into a positive: a minus typed or pasted is kept and refused", () => {
    for (const typed of ["-100", "₦-100", "-₦100", "\u2212100", "(100)"]) expect(readMoney(typed)).toEqual({ text: "-100", problem: "Not below zero", final: true });
    expect(readMoney("-")).toEqual({ text: "-", problem: "Not below zero", final: true });
    // Zero, separators in their places, two decimals and a pasted ₦ are amounts as they read.
    for (const typed of ["0", "0.00", "1,250,000.50", "250000.5", ".5"]) expect(readMoney(typed)).toEqual({ text: typed });
    expect(readMoney("₦ 250,000")).toEqual({ text: "250,000" });
    expect(readMoney("100-")).toEqual({ text: "100" });
  });

  it("refuses an amount it would otherwise have to change: a second point, a comma out of place, a third decimal, too many digits", () => {
    expect(readMoney("1.234.567")).toEqual({ text: "1.234.567", problem: "Check the amount", final: true });
    expect(readMoney("1,00")).toEqual({ text: "1,00", problem: "Check the amount" });
    expect(readMoney("100,5")).toEqual({ text: "100,5", problem: "Check the amount" });
    expect(readMoney("100.456")).toEqual({ text: "100.456", problem: "Two decimals at most", final: true });
    expect(readMoney("12345678901234567")).toEqual({ text: "12345678901234567", problem: "Too large", final: true });
    expect(readMoney("1234567890123456")).toEqual({ text: "1234567890123456" });
  });

  it("tells its form what is wrong as typed, and that it is right again", async () => {
    const user = userEvent.setup();
    const onProblem = vi.fn();
    function Salary() {
      const [v, setV] = useState("");
      return (
        <Field label="Gross Monthly">
          <MoneyField value={v} onChange={setV} onProblem={onProblem} />
        </Field>
      );
    }
    render(<Salary />);
    const input = screen.getByLabelText("Gross Monthly");
    await user.type(input, "-100");
    expect(input).toHaveValue("-100");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onProblem).toHaveBeenLastCalledWith("Not below zero", true);
    await user.clear(input);
    await user.type(input, "100");
    expect(input).toHaveValue("100");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(onProblem).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Field label="Amount">
        <MoneyField value="1,250,000" onChange={() => undefined} />
      </Field>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
