import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { DateField, DateRangeField, TimeField } from "./DateField";

describe("DateField, DateRangeField, TimeField", () => {
  it("shows the ISO value day-first and sends ISO when a day-first date is typed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Start Date">
        <DateField value="2026-10-13" onChange={onChange} />
      </Field>,
    );
    const input = screen.getByLabelText("Start Date");
    expect(input).toHaveValue("13/10/2026");
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith("");
    await user.type(input, "20/10/2026");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-20");
  });

  it("never renders a native date input, and marks a date that is not real", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Start Date">
        <DateField value="" onChange={() => undefined} />
      </Field>,
    );
    // A typed day-first field, never the OS date picker.
    expect((screen.getByLabelText("Start Date") as HTMLInputElement).type).toBe("text");
    await user.type(screen.getByLabelText("Start Date"), "31/02/2026");
    expect(screen.getByLabelText("Start Date")).toHaveAttribute("aria-invalid", "true");
  });

  it("picks a day from the calendar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Start Date">
        <DateField value="2026-10-13" onChange={onChange} />
      </Field>,
    );
    await user.click(screen.getByRole("button", { name: "Pick a date" }));
    await user.click(await screen.findByRole("button", { name: "15/10/2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-15");
  });

  it("TimeField formats as typed and sends a real 24-hour time", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Shift Start">
        <TimeField value="" onChange={onChange} />
      </Field>,
    );
    await user.type(screen.getByLabelText("Shift Start"), "0930");
    expect(screen.getByLabelText("Shift Start")).toHaveValue("09:30");
    expect(onChange).toHaveBeenLastCalledWith("09:30");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <div>
        <Field label="Start Date">
          <DateField value="2026-10-13" onChange={() => undefined} />
        </Field>
        <Field label="Report Period">
          <DateRangeField value={{ from: "2026-10-01", to: "2026-10-31" }} onChange={() => undefined} />
        </Field>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
