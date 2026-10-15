import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { MoneyField, toMoneyString } from "./MoneyField";

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
    expect(toMoneyString("")).toBe("");
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
