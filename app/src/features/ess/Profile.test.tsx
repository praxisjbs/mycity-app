// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";

/**
 * ESS · My Profile (docs/guides/ess.md §10). Its status pill is drawn by the rule People · Employees
 * uses, from the record's status and its two probation dates (QA BG-058: it said On Probation whenever
 * no confirmation date was set, where the register said Active), and Record History dates each change
 * in Lagos time (QA BG-046: a change at 00:45 Lagos on 17/11 read 16/11, the UTC day).
 */

const m = vi.hoisted(() => ({ profile: {} as Record<string, unknown> }));
vi.mock("@/api/hooks", () => ({
  invalidate: vi.fn(),
  useApi: () => ({ data: m.profile, error: null, loading: false, reload: () => undefined }),
  useMutation: () => ({ run: vi.fn(), pending: false }),
  usePaged: () => ({
    rows: [{ event_id: "e1", occurred_at: "2026-11-16T23:45:00.000Z", action: "employee.updated", actor_name: "Musa Danjuma", changed_fields: ["phone"], summary: "Record changed: Phone" }],
    page: { number: 1, size: 25, total: 1, pages: 1, has_next: false },
    loading: false,
    error: null,
    setPage: () => undefined,
  }),
}));
vi.mock("@/api/download", () => ({ useFileUrl: () => null }));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ refreshMe: async () => undefined }) }));

import { RouterProvider } from "@/lib/router";
import { MyProfilePage } from "./Profile";

installMatchMedia();
afterEach(cleanup);

const profile = (over: Record<string, unknown>) => ({
  employee_id: "11111111-1111-4111-8111-111111111111",
  staff_number: "00012",
  display_name: "Musa Danjuma",
  first_name: "Musa",
  last_name: "Danjuma",
  job_title: "Field Officer",
  department: "Programmes",
  status: "active",
  confirmation_due_on: null,
  confirmed_on: null,
  employment_type: "full_time",
  work_pattern: "hybrid",
  start_date: "2026-01-05",
  line_manager: null,
  work_email: "musa@mycity.test",
  phone: null,
  date_of_birth: null,
  home_address: null,
  home_address_place: null,
  next_of_kin_name: null,
  next_of_kin_relationship: null,
  next_of_kin_phone: null,
  bank_name: null,
  account_last4: null,
  photo_url: null,
  working_week: [],
  ...over,
});

const show = (over: Record<string, unknown>) => {
  m.profile = profile(over);
  setViewport(1440);
  render(
    <RouterProvider>
      <ModalProvider>
        <MyProfilePage />
      </ModalProvider>
    </RouterProvider>,
  );
};

describe("My Profile's status", () => {
  it.each([
    [{}, "Active"],
    [{ confirmation_due_on: "2027-01-05" }, "On Probation"],
    [{ confirmation_due_on: "2026-04-05", confirmed_on: "2026-04-02" }, "Active"],
    [{ status: "suspended" }, "Suspended"],
  ])("reads as People's register does (%o)", (over, pill) => {
    show(over);
    expect(screen.getAllByText(pill).length).toBeGreaterThan(0);
    for (const other of ["On Probation", "Confirmed", "Active", "Suspended"].filter((t) => t !== pill)) expect(screen.queryByText(other)).toBeNull();
  });
});

describe("My Profile's Record History", () => {
  it("dates a change in Lagos time, not the UTC day", () => {
    show({});
    expect(screen.getAllByText("17/11/2026 00:45").length).toBeGreaterThan(0);
    expect(screen.queryByText("16/11/2026")).toBeNull();
  });
});
