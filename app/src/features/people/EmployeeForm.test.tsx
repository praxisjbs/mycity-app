// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import organisation from "@mycity/contract/schemas/organisation.js";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";
import type { Employee360 } from "@/api/types/organisation";

/**
 * Add Employee and Edit (docs/guides/foundation.md §6.16): nothing is refused only at the end.
 * Every step checks what it shows, a refusal from the server goes back to the step that holds
 * its field or says so above the footer, a field the role hides is left out, and someone who
 * may only view the register is told so on the first step.
 */

const DEPT = "7d1b0b9e-1d2b-4b8e-9b1e-1a2b3c4d5e6f";
const m = vi.hoisted(() => ({
  run: vi.fn(async (_opts?: unknown) => ({ employee_id: "e1", display_name: "Ada Obi", staff_number: "00042" }) as unknown),
  can: true,
  hidden: [] as string[],
  refreshMe: vi.fn(async () => undefined),
}));
vi.mock("@/api/hooks", () => ({
  invalidate: vi.fn(),
  useApi: () => ({ data: undefined, error: null, reload: () => undefined }),
  useMutation: () => ({ run: m.run, pending: false }),
}));
vi.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ can: () => m.can, refreshMe: m.refreshMe }),
  useMe: () => ({ hidden_fields: m.hidden }),
}));
vi.mock("@/lib/router", () => ({ hrefFor: () => "/people", useRouter: () => ({ navigate: vi.fn() }) }));
vi.mock("@/shell/screen-action", () => ({ useAddressPrefill: () => ({}) }));
/* The pickers search the server; here each is one button that picks its record. */
vi.mock("@/features/shared/pickers", () => ({
  DepartmentPicker: ({ onChange }: { onChange: (d: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange([{ department_id: DEPT, name: "Content" }])}>
      Pick Content
    </button>
  ),
  WorksitePicker: ({ onChange }: { onChange: (w: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange([{ worksite_id: "8d1b0b9e-1d2b-4b8e-9b1e-1a2b3c4d5e6f", name: "Lekki Office", code: "LEK" }])}>
      Pick Lekki
    </button>
  ),
  EmployeePicker: () => null,
}));

import { ApiError } from "@/api/client";
import { AddEmployee, EditEmployee } from "./EmployeeForm";

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
beforeEach(() => {
  m.can = true;
  m.hidden = [];
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const open = (node: React.ReactNode) => render(<ModalProvider>{node}</ModalProvider>);

/** Fills the Person step and moves on. */
async function person(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("First Name"), "Ada");
  await user.type(screen.getByLabelText("Last Name"), "Obi");
  await user.type(screen.getByLabelText("Work Email"), "ada@mycityapp.io");
  await user.type(screen.getByLabelText("Phone"), "803 123 4567");
  await user.click(screen.getByRole("button", { name: "Next" }));
}

/** Fills the Job step (Remote, so no worksite is needed) and moves on. */
async function job(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Job Title"), "Content Associate");
  await user.click(screen.getByRole("button", { name: "Pick Content" }));
  await user.type(screen.getByLabelText("Start Date"), "01/11/2026");
  await user.click(screen.getByRole("radio", { name: "Remote" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
}

describe("Add Employee", { timeout: 20000 }, () => {
  it("tells someone who may only view on the first step, before anything is typed", () => {
    m.can = false;
    open(<AddEmployee close={vi.fn()} />);
    expect(screen.getByText(/You can view employees but not add them/)).toBeTruthy();
    expect(screen.queryByLabelText("First Name")).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("does not leave a step with an empty required field, and names it Required", async () => {
    const user = userEvent.setup();
    open(<AddEmployee close={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Person" })).toBeTruthy();
    expect((await screen.findAllByText("Required")).length).toBeGreaterThan(0);
  });

  it("asks for a worksite when the person works On Site", async () => {
    const user = userEvent.setup();
    open(<AddEmployee close={vi.fn()} />);
    await person(user);
    await user.type(screen.getByLabelText("Job Title"), "Content Associate");
    await user.click(screen.getByRole("button", { name: "Pick Content" }));
    await user.type(screen.getByLabelText("Start Date"), "01/11/2026");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Job" })).toBeTruthy();
    expect(await screen.findByText("Pick a worksite")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pick Lekki" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Pay and Bank" })).toBeTruthy();
  });

  it("marks a contract that ends before the start date as it is filled", async () => {
    const user = userEvent.setup();
    open(<AddEmployee close={vi.fn()} />);
    await person(user);
    await user.type(screen.getByLabelText("Start Date"), "01/11/2026");
    await user.type(screen.getByLabelText("Contract Ends"), "01/10/2026");
    await user.tab();
    expect(await screen.findByText(/Not before the start|or later/)).toBeTruthy();
  });

  it("sends a body the API accepts: no hidden field, the salary as the wire's amount", async () => {
    const user = userEvent.setup();
    open(<AddEmployee close={vi.fn()} />);
    await person(user);
    await job(user);
    await user.type(screen.getByLabelText("Gross Monthly"), "350,000");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Add Employee" }));
    await waitFor(() => expect(m.run).toHaveBeenCalledOnce());
    const { body } = m.run.mock.calls[0]![0] as { body: Record<string, unknown> };
    expect(body).not.toHaveProperty("home_address");
    expect(body.gross_monthly).toBe("350000.00");
    const parsed = organisation.EmployeeAdd.safeParse(body);
    expect(parsed.error && parsed.error.issues).toBeUndefined();
  });

  it("takes the person back to the step with the field the server refused", async () => {
    const user = userEvent.setup();
    m.run.mockRejectedValueOnce(new ApiError(409, { error: { code: "EMPLOYEE_EXISTS", message: "An employee already has this work email.", fields: { work_email: ["Already in use"] } } } as never));
    open(<AddEmployee close={vi.fn()} />);
    await person(user);
    await job(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Add Employee" }));
    expect(await screen.findByRole("heading", { name: "Person" })).toBeTruthy();
    expect(await screen.findByText("Already in use")).toBeTruthy();
  });

  it("says a refusal with no field in one line above the footer", async () => {
    const user = userEvent.setup();
    m.run.mockRejectedValueOnce(new ApiError(0, null));
    open(<AddEmployee close={vi.fn()} />);
    await person(user);
    await job(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Add Employee" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Not saved. Check your connection and try again.");
  });

  it("turns to the view-only notice when the server says this person may not add", async () => {
    const user = userEvent.setup();
    m.run.mockRejectedValueOnce(new ApiError(403, { error: { code: "FORBIDDEN", message: "You do not have access to this" } } as never));
    open(<AddEmployee close={vi.fn()} />);
    await person(user);
    await job(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Add Employee" }));
    expect(await screen.findByText(/You can view employees but not add them/)).toBeTruthy();
    expect(m.refreshMe).toHaveBeenCalled();
  });

  it("leaves out the fields the person's role hides, and a step that has none left", () => {
    m.hidden = ["gross_monthly", "bank_name", "account_number", "date_of_birth"];
    open(<AddEmployee close={vi.fn()} />);
    expect(screen.queryByLabelText("Date of Birth")).toBeNull();
    expect(screen.queryByText("Pay and Bank")).toBeNull();
  });
});

describe("Edit Employee", { timeout: 20000 }, () => {
  const employee = {
    employee_id: "e1",
    display_name: "Ada Obi",
    first_name: "Ada",
    middle_name: null,
    last_name: "Obi",
    work_email: "ada@mycityapp.io",
    phone: "+2348031234567",
    gender: null,
    date_of_birth: null,
    job_title: "Content Associate",
    department_id: DEPT,
    department: "Content",
    start_date: "2026-01-05",
    employment_type: "full_time",
    work_pattern: "remote",
    worksite_id: null,
    contract_ends_on: "2026-12-31",
    confirmation_due_on: null,
    gross_monthly: "350000.00",
    bank_name: "Access Bank",
    account_number: "0123456789",
    next_of_kin_name: null,
    next_of_kin_phone: null,
    next_of_kin_relationship: null,
    // A record's address is a line; Edit never holds it, so it can never block a save.
    home_address: "12 Bourdillon Road, Ikoyi",
  } as unknown as Employee360;

  it("sends only what changed, and an emptied optional field to be cleared", async () => {
    const user = userEvent.setup();
    open(<EditEmployee employee={employee} close={vi.fn()} />);
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe("8031234567");
    const title = screen.getByLabelText("Job Title");
    await user.clear(title);
    await user.type(title, "Senior Content Associate");
    await user.clear(screen.getByLabelText("Contract Ends"));
    await user.click(screen.getByRole("button", { name: "Save Record" }));
    await waitFor(() => expect(m.run).toHaveBeenCalledOnce());
    const { body } = m.run.mock.calls[0]![0] as { body: Record<string, unknown> };
    expect(body).toEqual({ job_title: "Senior Content Associate", contract_ends_on: "" });
    expect(organisation.EmployeeUpdate.parse(body)).toEqual({ job_title: "Senior Content Associate", contract_ends_on: null });
  });

  it("shows a refused work email on its field", async () => {
    const user = userEvent.setup();
    m.run.mockRejectedValueOnce(new ApiError(409, { error: { code: "EMPLOYEE_EXISTS", message: "An employee already has this work email.", fields: { work_email: ["Already in use"] } } } as never));
    open(<EditEmployee employee={employee} close={vi.fn()} />);
    const email = screen.getByLabelText("Work Email");
    await user.clear(email);
    await user.type(email, "tobi@mycityapp.io");
    await user.click(screen.getByRole("button", { name: "Save Record" }));
    expect(await screen.findByText("Already in use")).toBeTruthy();
  });
});
