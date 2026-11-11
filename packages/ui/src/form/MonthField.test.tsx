import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { MonthField } from "./MonthField";

/** A MonthField held the way a form holds it: the month it hands over comes back as its value. */
function Held({ initial = "", min, max, sent, left }: { initial?: string; min?: string; max?: string; sent: string[]; left?: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Field label="Month">
      <MonthField
        value={value}
        min={min}
        max={max}
        onBlur={left}
        onChange={(v) => {
          sent.push(v);
          setValue(v);
        }}
      />
    </Field>
  );
}

describe("MonthField", () => {
  it("reads the month it holds, named by its label", () => {
    render(<Held initial="2026-10-01" sent={[]} />);
    expect(screen.getByRole("button", { name: "Month October 2026" })).toBeInTheDocument();
  });

  it("reads its placeholder with no month", () => {
    render(<Held sent={[]} />);
    expect(screen.getByRole("button", { name: "Month Month Year" })).toBeInTheDocument();
  });

  it("hands over the first day of the month picked, then closes and tells the form it was left", async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    const left = vi.fn();
    render(<Held initial="2026-10-01" sent={sent} left={left} />);
    await user.click(screen.getByRole("button", { name: /Month October 2026/ }));
    expect(screen.getByRole("button", { name: "October 2026" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "August 2026" }));
    expect(sent).toEqual(["2026-08-01"]);
    expect(screen.getByRole("button", { name: /Month August 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "September 2026" })).not.toBeInTheDocument();
    expect(left).toHaveBeenCalled();
  });

  it("moves between years and keeps to min and max", async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    render(<Held initial="2026-02-01" min="2025-11-15" max="2026-03-31" sent={sent} />);
    await user.click(screen.getByRole("button", { name: /Month February 2026/ }));
    expect(screen.getByRole("button", { name: "April 2026" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "March 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next Year" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous Year" }));
    expect(screen.getByRole("button", { name: "October 2025" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous Year" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "November 2025" }));
    expect(sent).toEqual(["2025-11-01"]);
  });

  it("opens nothing while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Month">
        <MonthField value="2026-10-01" onChange={onChange} disabled />
      </Field>,
    );
    const button = screen.getByRole("button", { name: /Month October 2026/ });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(screen.queryByRole("button", { name: "October 2026" })).not.toBeInTheDocument();
  });

  it("is marked by its Field", () => {
    render(
      <Field label="Month" state="bad" message="Pick a month">
        <MonthField value="" onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getByRole("button", { name: /Month/ })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Pick a month")).toBeInTheDocument();
  });

  it("has no accessibility violations, closed and open", async () => {
    const user = userEvent.setup();
    const { container } = render(<Held initial="2026-10-01" sent={[]} />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: /Month October 2026/ }));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
