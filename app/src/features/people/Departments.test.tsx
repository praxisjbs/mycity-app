// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installMatchMedia } from "@mycity/ui/testing";

/**
 * People · Departments (#103, docs/guides/organogram.md §6.1, §10): Add Department offers a code from
 * the name, Set Head sends a person, an open role or nobody, and a move names the department picked.
 */

const ids = {
  dept: "11111111-1111-4111-8111-111111111111",
  other: "22222222-2222-4222-8222-222222222222",
  person: "33333333-3333-4333-8333-333333333333",
  seat: "44444444-4444-4444-8444-444444444444",
};
const m = vi.hoisted(() => ({ run: vi.fn(async (): Promise<unknown> => ({})) }));
vi.mock("@/api/hooks", () => ({
  invalidate: vi.fn(),
  useApi: () => ({ data: undefined, error: null, loading: false, reload: () => undefined }),
  useMutation: () => ({ run: m.run, pending: false }),
  usePaged: () => ({
    rows: [{ org_seat_id: "44444444-4444-4444-8444-444444444444", title: "Head, Growth" }],
    page: { number: 1, size: 25, total: 1, pages: 1, has_next: false },
    loading: false,
    error: null,
    q: "",
    setQ: () => undefined,
    setPage: () => undefined,
  }),
}));
vi.mock("@/api/download", () => ({ usePhotos: () => () => null }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("@/features/shared/pickers", () => ({
  EmployeePicker: ({ onChange }: { onChange: (v: Array<{ employee_id: string; display_name: string }>) => void }) => (
    <button type="button" onClick={() => onChange([{ employee_id: "33333333-3333-4333-8333-333333333333", display_name: "Aaron Agama" }])}>
      Pick Aaron
    </button>
  ),
  DepartmentPicker: ({ onChange }: { onChange: (v: Array<{ department_id: string; name: string }>) => void }) => (
    <button type="button" onClick={() => onChange([{ department_id: "22222222-2222-4222-8222-222222222222", name: "Partnership & Growth" }])}>
      Pick Growth
    </button>
  ),
}));

import { RouterProvider } from "@/lib/router";
import type { Department, EmployeeRow } from "@mycity/contract/contract.gen.ts";
import { AddDepartment, MoveForm, SetHeadForm, suggestCode } from "./Departments";

installMatchMedia();
// ChoiceField's radio group measures itself; jsdom has no ResizeObserver.
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const branding: Department = {
  department_id: ids.dept,
  code: "BM",
  name: "Branding & Marketing",
  parent_department_id: null,
  active: true,
  headcount: 4,
  open_roles: 1,
  head_employee_id: null,
  head_seat_id: null,
  head: null,
  acting_head: null,
  merged_into: null,
  can_delete: false,
};

describe("a department's code", () => {
  it("is offered from the name: initials of two words or more, else the first three letters", () => {
    expect(suggestCode("Branding & Marketing")).toBe("BM");
    expect(suggestCode("Technology & Back-office Ops")).toBe("TBOO");
    expect(suggestCode("Finance")).toBe("FIN");
    expect(suggestCode("")).toBe("");
  });
});

describe("Add Department", () => {
  it("fills the code from the name until the code is typed, and sends the head picked", async () => {
    const user = userEvent.setup();
    m.run.mockResolvedValueOnce({ ...branding, name: "People & Culture", code: "PC" });
    render(<AddDepartment close={() => undefined} onAdded={() => undefined} />, { wrapper: RouterProvider });
    await user.type(screen.getByRole("textbox", { name: /Name/ }), "People & Culture");
    expect(screen.getByRole("textbox", { name: /Code/ })).toHaveProperty("value", "PC");
    await user.click(screen.getByRole("button", { name: "Pick Aaron" }));
    await user.click(screen.getByRole("button", { name: "Add Department" }));
    expect(m.run).toHaveBeenCalledWith({ body: { name: "People & Culture", code: "PC", head_employee_id: ids.person } });
  });
});

describe("Set Head", () => {
  it("sends the person picked", async () => {
    const user = userEvent.setup();
    m.run.mockResolvedValueOnce({ ...branding, head: { employee_id: ids.person, org_seat_id: null, display_name: "Aaron Agama", job_title: null, vacant: false } });
    render(<SetHeadForm department={branding} close={() => undefined} onDone={() => undefined} />, { wrapper: RouterProvider });
    await user.click(screen.getByRole("button", { name: "Set Head" }));
    expect(m.run).not.toHaveBeenCalled();
    expect(screen.getByText("Pick someone")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pick Aaron" }));
    await user.click(screen.getByRole("button", { name: "Set Head" }));
    expect(m.run).toHaveBeenCalledWith({ params: { id: ids.dept }, body: { head_employee_id: ids.person } });
  });

  it("clears the head with Nobody", async () => {
    const user = userEvent.setup();
    m.run.mockResolvedValueOnce(branding);
    render(<SetHeadForm department={branding} close={() => undefined} onDone={() => undefined} />, { wrapper: RouterProvider });
    await user.click(screen.getByRole("radio", { name: "Nobody" }));
    await user.click(screen.getByRole("button", { name: "Set Head" }));
    expect(m.run).toHaveBeenCalledWith({ params: { id: ids.dept }, body: { head_employee_id: null, head_seat_id: null } });
  });
});

describe("Move To", () => {
  it("moves the people picked into the department chosen", async () => {
    const user = userEvent.setup();
    const people = [
      { employee_id: ids.person, display_name: "Aaron Agama" },
      { employee_id: ids.seat, display_name: "Precious Iye" },
    ] as unknown as EmployeeRow[];
    render(<MoveForm people={people} close={() => undefined} onDone={() => undefined} />, { wrapper: RouterProvider });
    await user.click(screen.getByRole("button", { name: "Move People" }));
    expect(screen.getByText("Pick a department")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pick Growth" }));
    await user.click(screen.getByRole("button", { name: "Move People" }));
    expect(m.run).toHaveBeenCalledWith({ params: { id: ids.other }, body: { employee_ids: [ids.person, ids.seat] } });
  });
});
