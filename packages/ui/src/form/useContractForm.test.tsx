import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import organisation from "@mycity/contract/schemas/organisation.js";
import { rules, useContractForm, shortMessage } from "./useContractForm";
import { DateField } from "./DateField";
import { Field } from "./Field";
import { TextField } from "./TextField";
import { Form } from "./Form";

const blank = {
  first_name: "",
  last_name: "",
  work_email: "",
  phone: "",
  job_title: "",
  start_date: "",
  employment_type: "full_time",
  work_pattern: "on_site",
  department_id: "",
};

/** `pauseMs`: how long a pause in typing waits before checking; long where a test checks on leaving only. */
function EmployeeForm({ onSave, pauseMs = 50 }: { onSave: (data: unknown) => void; pauseMs?: number }) {
  const form = useContractForm(blank, organisation.EmployeeCreate!, { pauseMs });
  return (
    <Form onSubmit={form.submit(onSave)}>
      <Field label="First Name" {...form.status("first_name")}>
        <TextField {...form.field("first_name")} />
      </Field>
      <Field label="Work Email" {...form.status("work_email")}>
        <TextField type="email" {...form.field("work_email")} />
      </Field>
      <button type="submit">Create Employee</button>
    </Form>
  );
}

describe("useContractForm", () => {
  it("checks a field when the person leaves it, with a short message", async () => {
    const user = userEvent.setup();
    // No pause check in this test: a slow machine between two keys must not mark the field early.
    render(<EmployeeForm onSave={vi.fn()} pauseMs={60_000} />);
    const email = screen.getByLabelText("Work Email");
    await user.type(email, "ada");
    expect(email).not.toHaveAttribute("aria-invalid");
    await user.tab();
    expect(await screen.findByText("Check the email")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the mark on the key that fixes it", async () => {
    const user = userEvent.setup();
    render(<EmployeeForm onSave={vi.fn()} />);
    const email = screen.getByLabelText("Work Email");
    await user.type(email, "ada@mycity");
    await user.tab();
    await screen.findByText("Check the email");
    await user.type(email, ".app");
    await vi.waitFor(() => expect(screen.queryByText("Check the email")).not.toBeInTheDocument());
  });

  it("checks after a pause in typing, before the field is left", async () => {
    const user = userEvent.setup();
    render(<EmployeeForm onSave={vi.fn()} />);
    await user.type(screen.getByLabelText("Work Email"), "ada");
    expect(await screen.findByText("Check the email")).toBeInTheDocument();
  });

  it("never disables submit: it marks every problem, focuses the first and does not save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EmployeeForm onSave={onSave} />);
    const submit = screen.getByRole("button", { name: "Create Employee" });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(await screen.findAllByText("Required")).not.toHaveLength(0);
    expect(onSave).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.getByLabelText("First Name")).toHaveFocus());
  });

  it("puts a server 422's fields on the same marks", async () => {
    let api: { setServerErrors: (f: Record<string, string[]>) => void } | undefined;
    function Probe() {
      const form = useContractForm({ ...blank, work_email: "ada@mycityapp.io" }, organisation.EmployeeCreate!);
      api = form as never;
      return (
        <Field label="Work Email" {...form.status("work_email")}>
          <TextField {...form.field("work_email")} />
        </Field>
      );
    }
    render(<Probe />);
    act(() => api!.setServerErrors({ work_email: ["Already in use"] }));
    expect(await screen.findByText("Already in use")).toBeInTheDocument();
  });

  it("keeps messages to four words", () => {
    expect(shortMessage({ type: "custom", message: "must be a Nigerian phone number" })).toBe("Check this value");
    expect(shortMessage({ type: "custom", message: "must look like MCA-0001" })).toBe("Must look like MCA-0001");
    expect(shortMessage({ type: "too_small", message: "String must contain at least 1 character(s)" })).toBe("Required");
    expect(shortMessage({ type: "invalid_enum_value", message: "Invalid enum value" })).toBe("Choose one");
    expect(shortMessage({ type: "invalid_type", message: "Required" })).toBe("Required");
    expect(shortMessage({ type: "invalid_type", message: "Expected object, received string" })).toBe("Required");
    expect(shortMessage({ type: "invalid_type", message: "Pick an address" })).toBe("Pick an address");
    // A limit the schema words itself is shown in its words; Zod's own limits keep the short ones.
    expect(shortMessage({ type: "too_small", message: "At least 150 m" })).toBe("At least 150 m");
    expect(shortMessage({ type: "too_small", message: "Add a recipient" })).toBe("Add a recipient");
    expect(shortMessage({ type: "too_big", message: "At most 500 m" })).toBe("At most 500 m");
    // Zod's own limits say the limit, also when a server 422 carries them raw.
    expect(shortMessage({ type: "too_small", message: "String must contain at least 3 character(s)" })).toBe("At least 3 characters");
    expect(shortMessage({ type: "too_big", message: "String must contain at most 500 character(s)" })).toBe("At most 500 characters");
    expect(shortMessage({ type: "too_big", message: "Number must be less than or equal to 500" })).toBe("At most 500");
    expect(shortMessage({ type: "too_small", message: "Number must be greater than or equal to 50" })).toBe("At least 50");
    expect(shortMessage({ type: "custom", message: "Array must contain at most 25 element(s)" })).toBe("At most 25");
    expect(shortMessage({ type: "too_big", message: "String must contain at most 4000 character(s)" })).toBe("At most 4,000 characters");
    expect(shortMessage({ type: "too_big", message: "Number must be less than or equal to 2160" })).toBe("At most 2,160");
    expect(shortMessage({ type: "custom", message: "String must contain at least 1 character(s)" })).toBe("Required");
    expect(shortMessage({ type: "invalid_type", message: "Expected integer, received float" })).toBe("Whole numbers only");
    // A pattern's own words when they fit; Zod's own "Invalid" keeps the short one.
    expect(shortMessage({ type: "invalid_string", message: "Ten digits" })).toBe("Ten digits");
    expect(shortMessage({ type: "invalid_string", message: "Not a price" })).toBe("Not a price");
    expect(shortMessage({ type: "invalid_string", message: "Invalid" })).toBe("Check the format");
    expect(shortMessage({ type: "invalid_string", message: "Invalid email" })).toBe("Check the email");
  });

  it("shows an empty field the schema's own words for it, else Required", () => {
    const schema = {
      safeParse: () => ({
        success: false,
        error: {
          issues: [
            { path: ["model"], code: "too_small", message: "Pick a model" },
            { path: ["name"], code: "too_small", message: "String must contain at least 1 character(s)" },
            { path: ["price"], code: "invalid_string", message: "Not a price" },
          ],
        },
      }),
    };
    const { result } = renderHook(() => useContractForm({ model: "", name: "", price: "" }, schema));
    act(() => {
      result.current.check();
    });
    expect(result.current.errors).toEqual({ model: "Pick a model", name: "Required", price: "Required" });
  });
});

describe("useContractForm with INTERIM rules", () => {
  it("check() marks everything and reports cleanliness", () => {
    const { result } = renderHook(() => useContractForm({ name: "" }, { name: rules.required() }));
    let ok = true;
    act(() => {
      ok = result.current.check();
    });
    expect(ok).toBe(false);
    expect(result.current.status("name")).toEqual({ state: "bad", message: "Required" });
  });

  it("shows a server error until the field changes", () => {
    const { result } = renderHook(() => useContractForm({ email: "ada@mycity.app" }));
    act(() => result.current.setServerErrors({ email: ["Already in use"] }));
    expect(result.current.field("email").message).toBe("Already in use");
    act(() => result.current.field("email").onChange("ola@mycity.app"));
    expect(result.current.field("email").message).toBeUndefined();
  });

  it("keeps every rule message to four words", () => {
    for (const msg of [rules.required()(""), rules.email(""), rules.email("x"), rules.email("x@y"), rules.amount(""), rules.amount("1.234")]) {
      expect(String(msg).split(" ").length).toBeLessThanOrEqual(4);
    }
  });
});

describe("useContractForm and what only a control can see", () => {
  function DueForm({ onSave }: { onSave: (data: unknown) => void }) {
    const form = useContractForm({ due: "" }, { due: rules.required("Pick a day") }, { pauseMs: 50 });
    return (
      <Form onSubmit={form.submit(onSave)}>
        <Field label="Due Date" {...form.status("due")}>
          <DateField {...form.field("due")} min="2026-10-21" />
        </Field>
        <button type="submit">Save Task</button>
      </Form>
    );
  }

  it("marks a typed day outside the field's range at once, and never saves it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<DueForm onSave={onSave} />);
    const due = screen.getByLabelText("Due Date");
    await user.type(due, "01/10/2026");
    expect(screen.getByText("Pick 21/10/2026 or later")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save Task" }));
    expect(onSave).not.toHaveBeenCalled();
    await user.clear(due);
    await user.type(due, "28/10/2026");
    await vi.waitFor(() => expect(screen.queryByText("Pick 21/10/2026 or later")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Save Task" }));
    expect(onSave).toHaveBeenCalledWith({ due: "2026-10-28" });
  });

  it("refuses half a date on Save, though the value under it is empty", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<DueForm onSave={onSave} />);
    await user.type(screen.getByLabelText("Due Date"), "28/10/202");
    await user.click(screen.getByRole("button", { name: "Save Task" }));
    expect(await screen.findByText("Not a real date")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
