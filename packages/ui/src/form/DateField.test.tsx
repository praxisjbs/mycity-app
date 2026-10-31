import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Field } from "./Field";
import { DateField, DateRangeField, TimeField } from "./DateField";
import { Form } from "./Form";
import { useContractForm } from "./useContractForm";

/** A DateField held the way a form holds it: every value it hands over comes back as its value. */
function Held({ min, max, sent, told }: { min?: string; max?: string; sent: string[]; told?: (message: string | undefined, now?: boolean) => void }) {
  const [value, setValue] = useState("");
  return (
    <Field label="First Day">
      <DateField
        value={value}
        min={min}
        max={max}
        onProblem={told}
        onChange={(v) => {
          sent.push(v);
          setValue(v);
        }}
      />
    </Field>
  );
}

describe("DateField shown and not changed", () => {
  it("takes no typing and opens no calendar while disabled (a check-in already sent)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Delivered On">
        <DateField value="2026-10-28" onChange={onChange} disabled />
      </Field>,
    );
    const input = screen.getByLabelText("Delivered On");
    expect(input).toBeDisabled();
    expect(input).toHaveValue("28/10/2026");
    expect(screen.getByRole("button", { name: "Pick a date" })).toBeDisabled();
    await user.type(input, "1");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("DateField typed into a form", () => {
  it("keeps a four-digit year as it is typed, and the form ends with that date", async () => {
    // Rewritten from its own value, "28/10/20" became 28/10/2020: 28/10/2026 left as 2020-10-28 (fault #2, 21/10/2026).
    const user = userEvent.setup();
    const sent: string[] = [];
    render(<Held sent={sent} />);
    const input = screen.getByLabelText("First Day");
    await user.type(input, "28/10/2026");
    expect(input).toHaveValue("28/10/2026");
    expect(sent.at(-1)).toBe("2026-10-28");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("refuses a typed day the calendar greys out, at once, and the form never holds it", async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    const told = vi.fn();
    render(<Held sent={sent} told={told} min="2026-10-21" />);
    const input = screen.getByLabelText("First Day");
    await user.type(input, "01/10/2026");
    expect(told).toHaveBeenLastCalledWith("Pick 21/10/2026 or later", true);
    expect(sent.filter(Boolean)).toEqual([]);
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.clear(input);
    await user.type(input, "28/10/2026");
    expect(told).toHaveBeenLastCalledWith(undefined, undefined);
    expect(sent.filter(Boolean)).toEqual(["2026-10-28"]);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("refuses a typed day after max the same way", async () => {
    const user = userEvent.setup();
    const told = vi.fn();
    render(<Held sent={[]} told={told} max="2026-10-21" />);
    await user.type(screen.getByLabelText("First Day"), "22/10/2026");
    expect(told).toHaveBeenLastCalledWith("Pick 21/10/2026 or earlier", true);
  });

  it("says half a date is not a real one, without hurrying the person", async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    const told = vi.fn();
    render(<Held sent={sent} told={told} />);
    await user.type(screen.getByLabelText("First Day"), "28/10/202");
    expect(told).toHaveBeenLastCalledWith("Not a real date", undefined);
    expect(sent.at(-1)).toBe("");
  });

  it("shows a two-digit year as it is kept once the person leaves the field", async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    render(<Held sent={sent} />);
    const input = screen.getByLabelText("First Day");
    await user.type(input, "1.2.26");
    expect(input).toHaveValue("1.2.26");
    await user.tab();
    expect(input).toHaveValue("01/02/2026");
    expect(sent.at(-1)).toBe("2026-02-01");
  });
});

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

  it("DateRangeField gives each end its own id and names it From and To, as are its calendar buttons", async () => {
    render(
      <div>
        <Field label="Dates" optional>
          <DateRangeField value={{ from: "2026-10-01", to: "2026-10-31" }} onChange={() => undefined} />
        </Field>
        <Field label="Report Period">
          <DateRangeField value={{ from: "", to: "" }} onChange={() => undefined} />
        </Field>
      </div>,
    );
    const from = screen.getByRole("textbox", { name: "Dates From" });
    const to = screen.getByRole("textbox", { name: "Dates To" });
    expect(from).toHaveValue("01/10/2026");
    expect(to).toHaveValue("31/10/2026");
    const ids = screen.getAllByRole("textbox").map((e) => e.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // The Field's label still points at the From end, so pressing it starts the period.
    expect(document.querySelector(`label[for="${from.id}"]`)?.textContent).toBe("Dates");
    expect(screen.getByRole("textbox", { name: "Report Period From" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Report Period To" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Pick From Date" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Pick To Date" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Pick a date" })).not.toBeInTheDocument();
    // Each end shows its own label above it, and pressing it lands in that end.
    expect(document.querySelector(`label[for="${to.id}"]`)?.textContent).toBe("To");
    expect([...document.querySelectorAll(`label[for="${from.id}"]`)].map((l) => l.textContent)).toEqual(["Dates", "From"]);
  });

  /** A period held the way a form holds it, inside its Field (a filter: no form, no message of its own). */
  function HeldRange({ start }: { start: { from: string; to: string } }) {
    const [value, setValue] = useState(start);
    return (
      <Field label="Dates" optional>
        <DateRangeField value={value} onChange={setValue} />
      </Field>
    );
  }
  const describedText = (el: HTMLElement) =>
    (el.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");

  it("DateRangeField says half a From under From alone, once the person leaves it", async () => {
    const user = userEvent.setup();
    render(<HeldRange start={{ from: "", to: "" }} />);
    const from = screen.getByRole("textbox", { name: "Dates From" });
    const to = screen.getByRole("textbox", { name: "Dates To" });
    await user.type(from, "28/10/202");
    // Still on the way to a date: nothing said yet.
    expect(screen.queryByText("Not a real date")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByText("Not a real date")).toBeInTheDocument();
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(describedText(from)).toContain("Not a real date");
    expect(to).not.toHaveAttribute("aria-invalid");
    expect(describedText(to)).not.toContain("Not a real date");
    // Put right, the mark and the words go.
    await user.clear(from);
    await user.type(from, "01/10/2026");
    expect(screen.queryByText("Not a real date")).not.toBeInTheDocument();
    expect(from).not.toHaveAttribute("aria-invalid");
  });

  it("DateRangeField marks a To before From on To alone, at once", async () => {
    const user = userEvent.setup();
    render(<HeldRange start={{ from: "2026-10-10", to: "" }} />);
    const from = screen.getByRole("textbox", { name: "Dates From" });
    const to = screen.getByRole("textbox", { name: "Dates To" });
    await user.type(to, "05/10/2026");
    expect(screen.getByText("Pick 10/10/2026 or later")).toBeInTheDocument();
    expect(to).toHaveAttribute("aria-invalid", "true");
    expect(describedText(to)).toContain("Pick 10/10/2026 or later");
    expect(from).not.toHaveAttribute("aria-invalid");
    expect(describedText(from)).toBe("");
  });

  it("DateRangeField shows its Field's message once: under the end still empty, else under both, tied to both", () => {
    const { unmount } = render(
      <Field label="Period" state="bad" message="Required">
        <DateRangeField value={{ from: "2026-10-01", to: "" }} onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getAllByText("Required")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Period To" })).toHaveAttribute("aria-invalid", "true");
    expect(describedText(screen.getByRole("textbox", { name: "Period To" }))).toContain("Required");
    expect(screen.getByRole("textbox", { name: "Period From" })).not.toHaveAttribute("aria-invalid");
    unmount();
    render(
      <Field label="Period" state="bad" message="At most 31 days">
        <DateRangeField value={{ from: "2026-01-01", to: "2026-03-01" }} onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getAllByText("At most 31 days")).toHaveLength(1);
    for (const end of ["Period From", "Period To"]) {
      const input = screen.getByRole("textbox", { name: end });
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(describedText(input)).toContain("At most 31 days");
    }
  });

  it("DateRangeField says an end's problem the form marked on Save, though the person never left it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    function Export() {
      const f = useContractForm({ period: { from: "", to: "" } }, { period: (v: { from: string; to: string }) => (v.from && v.to ? null : "Required") }, { pauseMs: 60_000 });
      return (
        <Form onSubmit={f.submit(onSave)}>
          <Field label="Period" {...f.status("period")}>
            <DateRangeField value={f.values.period} onChange={(p) => f.set("period", p)} onProblem={f.field("period").onProblem} />
          </Field>
          <button type="submit">Export Register</button>
        </Form>
      );
    }
    render(<Export />);
    const from = screen.getByRole("textbox", { name: "Period From" });
    await user.type(from, "28/10/202{Enter}");
    expect(onSave).not.toHaveBeenCalled();
    expect(from).toHaveFocus();
    expect(screen.getAllByText("Not a real date")).toHaveLength(1);
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(describedText(from)).toContain("Not a real date");
    expect(screen.getByRole("textbox", { name: "Period To" })).not.toHaveAttribute("aria-invalid");
  });

  it("DateRangeField is reached in order from the keyboard: From, its calendar, To, its calendar", async () => {
    const user = userEvent.setup();
    render(<HeldRange start={{ from: "2026-10-01", to: "2026-10-31" }} />);
    await user.click(screen.getByRole("textbox", { name: "Dates From" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Pick From Date" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Dates To" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Pick To Date" })).toHaveFocus();
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
        <Field label="Export Period" state="bad" message="Required">
          <DateRangeField value={{ from: "2026-10-01", to: "" }} onChange={() => undefined} />
        </Field>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
