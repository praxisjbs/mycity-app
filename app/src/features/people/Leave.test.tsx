// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@mycity/ui";
import { chooseOption, installMatchMedia, optionLabels } from "@mycity/ui/testing";

/**
 * Request Leave (`LeaveForm`, docs/guides/ess.md §10): each type with what is left of the year the
 * First Day falls in, and a Last Day in another year flagged as it is typed, never after Send
 * (fault #1, 21/10/2026: LEAVE_SPANS_YEARS came back from the server). The clock is 21/10/2026.
 */

const m = vi.hoisted(() => ({ run: vi.fn(async (): Promise<unknown> => ({})), years: [] as Array<number | undefined>, pickerFilters: [] as unknown[] }));
vi.mock("@/api/hooks", () => {
  const annual = "11111111-1111-4111-8111-111111111111";
  const unpaid = "22222222-2222-4222-8222-222222222222";
  return {
    invalidate: vi.fn(),
    useApi: (_key: string, opts: { query?: { year?: number }; enabled?: boolean } = {}) => {
      if (opts.enabled === false) return { data: undefined, error: null, loading: false, reload: () => undefined };
      m.years.push(opts.query?.year);
      const balances = [
        { leave_type_id: annual, code: "annual", name: "Annual", entitled: 20, taken: 3, booked: 0, pending: 5, remaining: 12 },
        { leave_type_id: unpaid, code: "unpaid", name: "Unpaid", entitled: null, taken: 0, booked: 0, pending: 0, remaining: null },
      ];
      return { data: { year: opts.query?.year, balances }, error: null, loading: false, reload: () => undefined };
    },
    useMutation: () => ({ run: m.run, pending: false }),
    usePaged: () => ({
      rows: [
        { leave_type_id: annual, code: "annual", name: "Annual", days_per_year: 20, active: true },
        { leave_type_id: unpaid, code: "unpaid", name: "Unpaid", days_per_year: null, active: true },
      ],
      page: { number: 1, size: 25, total: 2, pages: 1, has_next: false },
      loading: false,
      error: null,
      q: "",
      setQ: () => undefined,
      setPage: () => undefined,
    }),
  };
});
vi.mock("@/api/download", () => ({ usePhotos: () => ({}) }));
vi.mock("@/auth/AuthProvider", () => ({ useMe: () => null }));
vi.mock("@/features/shared/pickers", () => ({
  EmployeePicker: ({ onChange, filters }: { onChange: (v: Array<{ employee_id: string; display_name: string }>) => void; filters?: unknown }) => {
    m.pickerFilters.push(filters);
    return (
      <button type="button" onClick={() => onChange([{ employee_id: "33333333-3333-4333-8333-333333333333", display_name: "Musa Danjuma" }])}>
        Pick Musa
      </button>
    );
  },
}));

import { RouterProvider } from "@/lib/router";
import { LeaveForm } from "./Leave";
import { codeOf } from "./LeaveSettings";

installMatchMedia();
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T09:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.years.length = 0;
  m.pickerFilters.length = 0;
});

describe("Request Leave", () => {
  it("lists each type with what is left of the First Day's year", async () => {
    const user = userEvent.setup();
    render(<LeaveForm close={() => undefined} />, { wrapper: RouterProvider });
    expect(await optionLabels(screen.getByRole("combobox", { name: "Leave Type" }))).toEqual(["Annual · 12 days left", "Unpaid"]);
    expect(m.years.at(-1)).toBe(2026);
    await user.type(screen.getByLabelText("First Day"), "05/01/2027");
    expect(m.years.at(-1)).toBe(2027);
  });

  it("flags a Last Day in another year as it is typed, and sends nothing", async () => {
    const user = userEvent.setup();
    render(<LeaveForm close={() => undefined} />, { wrapper: RouterProvider });
    await user.type(screen.getByLabelText("First Day"), "28/12/2026");
    await user.type(screen.getByLabelText("Last Day"), "04/01/2027");
    await user.tab();
    expect(await screen.findByText("Ends in another year")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Send Request" }));
    expect(m.run).not.toHaveBeenCalled();
  });

  it("refuses a First Day typed before today at once", async () => {
    const user = userEvent.setup();
    render(<LeaveForm close={() => undefined} />, { wrapper: RouterProvider });
    await user.type(screen.getByLabelText("First Day"), "28/10/2020");
    expect(screen.getByText("Pick 21/10/2026 or later")).toBeTruthy();
  });

  it("records leave for someone else without the caller's own year beside the types", async () => {
    render(<LeaveForm close={() => undefined} onBehalf />, { wrapper: RouterProvider });
    expect(await optionLabels(screen.getByRole("combobox", { name: "Leave Type" }))).toEqual(["Annual", "Unpaid"]);
    expect(m.years).toEqual([]);
    // Only people who work here now are offered.
    expect(m.pickerFilters.at(-1)).toEqual({ status: "active" });
  });

  it("shows the server's mark on Employee, a field outside the contract form", async () => {
    const user = userEvent.setup();
    m.run.mockRejectedValueOnce(new ApiError(422, { error: { code: "EMPLOYEE_NOT_ACTIVE", message: "Pick someone who works here now", fields: { employee_id: ["Not active"] } } }));
    render(<LeaveForm close={() => undefined} onBehalf />, { wrapper: RouterProvider });
    await user.click(screen.getByRole("button", { name: "Pick Musa" }));
    await chooseOption(screen.getByRole("combobox", { name: "Leave Type" }), "Annual");
    await user.type(screen.getByLabelText("First Day"), "02/11/2026");
    await user.type(screen.getByLabelText("Last Day"), "03/11/2026");
    await user.click(screen.getByRole("button", { name: "Record Leave" }));
    expect(await screen.findByText("Not active")).toBeTruthy();
  });
});

describe("Leave Types", () => {
  it("makes a code of at least two characters from any name", () => {
    expect(codeOf("Study Leave")).toBe("study_leave");
    expect(codeOf("A")).toBe("type_a");
    expect(codeOf("1st Aid")).toBe("type_1st_aid");
    expect(codeOf("!!")).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
  });
});
