import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import organisation from "@mycity/contract/schemas/organisation.js";
import { rules, useContractForm, shortMessage } from "./useContractForm";
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

function EmployeeForm({ onSave }: { onSave: (data: unknown) => void }) {
  const form = useContractForm(blank, organisation.EmployeeCreate!, { pauseMs: 50 });
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
    render(<EmployeeForm onSave={vi.fn()} />);
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
