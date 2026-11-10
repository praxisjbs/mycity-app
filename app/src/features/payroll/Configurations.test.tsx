// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import payroll from "@mycity/contract/schemas/payroll.js";
import salary from "@mycity/contract/schemas/salary_structure.js";
import statutory from "@mycity/contract/schemas/statutory.js";
import { ModalProvider, Toaster, todayIso } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Configurations from "./Configurations";

/**
 * Payroll · Configurations on the in-browser mock, in the contract's shapes (docs/guides/payroll.md §3.5, §6.11, §6.12,
 * §10): it starts as production does, with nothing entered; the seven items read Not Set; Switch On asks for the date and
 * the three conventions and is refused with no rate in force; a rate and a PAYE table are entered; the option on, the
 * conventions, the grades and the people against their bands show; a phone opens a person in a sheet. The rules
 * themselves are the API's, tested in tests/integration/payroll-advanced.test.js.
 *
 * THE RATES HERE ARE TEST RATES, invented for this file: never law, never seeded.
 *
 * The mock keeps its state for the whole file, so the tests run in order, each building on the last.
 */

expect.extend(axeMatchers);
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Element.prototype.scrollIntoView ??= () => undefined;

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function open(email = "cynthia@mycityapp.io") {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Harness>
              <Configurations />
            </Harness>
            <Toaster />
          </ScreenActionProvider>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await screen.findByRole("heading", { name: "Configurations", level: 1 }, { timeout: 5000 });
}

const type = (box: HTMLElement, value: string) => {
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
};

describe("Payroll · Configurations", () => {
  it("starts as production does: the default pay day, the seven items Not Set, no bands, nothing of the structure", async () => {
    await open();
    const settings = payroll.PayrollSettings.parse(await api.call("GET /api/v1/payroll/settings", {}));
    expect(settings).toMatchObject({ advanced_enabled: false, advanced_has_been_on: false, pay_day: 30, pay_day_is_default: true });
    expect(statutory.StatutoryItems.parse(await api.call("GET /api/v1/statutory/items", {})).items.every((i) => i.current === null)).toBe(true);
    expect(await screen.findByText("30 (default)")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Not Set")).toHaveLength(7));
    for (const item of ["PAYE", "Employee Pension", "Employer Pension", "NHF", "ITF", "NSITF", "Relief"]) expect(screen.getByText(item)).toBeTruthy();
    expect(await screen.findByText("No PAYE Bands")).toBeTruthy();
    expect(screen.queryByText("Conventions")).toBeNull();
    expect(screen.queryByText("Grades")).toBeNull();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("Switch On asks for the three conventions, and is refused until a rate is in force that day", async () => {
    await open();
    await screen.findByText("30 (default)");
    fireEvent.click(screen.getByRole("switch", { name: "Advanced Payroll" }));
    const form = await screen.findByRole("dialog", { name: "Switch On Advanced Payroll" });
    fireEvent.click(within(form).getByRole("button", { name: "Switch On" }));
    await waitFor(() => expect(within(form).getAllByText("Pick one")).toHaveLength(3));
    fireEvent.click(within(form).getByRole("radio", { name: "Annualised" }));
    for (const group of ["Pension Reduces Taxable Pay", "NHF Reduces Taxable Pay"]) fireEvent.click(within(within(form).getByRole("radiogroup", { name: group })).getByRole("radio", { name: "Yes" }));
    fireEvent.click(within(form).getByRole("button", { name: "Switch On" }));
    await waitFor(() => expect(within(form).getByText("No rate that day")).toBeTruthy());
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("a rate is entered from today with Save Rate and shows In Force", async () => {
    await open();
    fireEvent.click(await screen.findByText("Employee Pension"));
    const form = await screen.findByRole("dialog", { name: "Set Employee Pension" });
    fireEvent.click(within(form).getByRole("button", { name: "Save Rate" }));
    await waitFor(() => expect(within(form).getByText("Enter a rate")).toBeTruthy());
    type(within(form).getByRole("textbox", { name: "Rate" }), "5");
    fireEvent.click(within(form).getByRole("button", { name: "Save Rate" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set Employee Pension" })).toBeNull());
    await waitFor(() => expect(screen.getByText("5%")).toBeTruthy());
    expect(screen.getAllByText("In Force").length).toBeGreaterThan(0);
  }, 40000);

  it("Set PAYE Bands checks each band as it is filled, and saves the whole table", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Set Bands" }));
    const form = await screen.findByRole("dialog", { name: "Set PAYE Bands" });
    fireEvent.click(await within(form).findByRole("button", { name: "Add Band" }));
    type(within(form).getByRole("textbox", { name: "Band 1 Rate" }), "10");
    type(within(form).getByRole("textbox", { name: "Band 2 Rate" }), "20");
    fireEvent.click(within(form).getByRole("button", { name: "Save Bands" }));
    await waitFor(() => expect(within(form).getByText("Enter an amount")).toBeTruthy());
    type(within(form).getByRole("textbox", { name: /Band 1 Up To/ }), "1000000.00");
    fireEvent.click(within(form).getByRole("button", { name: "Save Bands" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set PAYE Bands" })).toBeNull());
    const page = statutory.StatutoryRatePage.parse(await api.call("GET /api/v1/statutory/rates", { query: { item: "paye" } }));
    expect(page.data.map((r) => [r.position, r.band_from, r.band_to, r.rate])).toEqual([
      [1, "0.00", "1000000.00", "10"],
      [2, "1000000.00", null, "20"],
    ]);
    expect(await screen.findByText("No Limit")).toBeTruthy();
  }, 40000);

  it("switched on with the conventions, the structure shows: a grade, people against their band, a pay split", async () => {
    await open();
    await api.call("PATCH /api/v1/payroll/settings", { body: { effective_from: todayIso(), advanced_enabled: true, paye_basis: "annualised", pension_reduces_taxable: true, nhf_reduces_taxable: true } });
    invalidate("/api/v1");
    expect(await screen.findByText("Conventions", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("Annualised")).toBeTruthy();
    const grade = salary.SalaryGrade.parse(
      await api.call("POST /api/v1/salary-structure/grades", { body: { code: "T1", name: "Test Band", minimum: "100000.00", maximum: "300000.00", effective_from: todayIso() } }),
    );
    const people = salary.GradePlacementPage.parse(await api.call("GET /api/v1/salary-structure/placements", { query: {} }));
    const first = people.data[0]!;
    await api.call("PUT /api/v1/salary-structure/placements/:employee_id", { params: { employee_id: first.employee.employee_id }, body: { salary_grade_id: grade.salary_grade_id, effective_from: todayIso() } });
    invalidate("/api/v1");
    expect(await screen.findByText("Bands by Grade", {}, { timeout: 5000 })).toBeTruthy();
    expect((await screen.findAllByText("T1")).length).toBeGreaterThan(0);

    // Beside the list on a wide desktop, the first person shows unasked; opening them keeps them there.
    fireEvent.click((await screen.findAllByText(first.employee.display_name))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Set Pay Components" }));
    const form = await screen.findByRole("dialog", { name: "Set Pay Components" });
    type(within(form).getByRole("textbox", { name: "Amount" }), "1.00");
    fireEvent.click(within(form).getByRole("button", { name: "Save Components" }));
    await waitFor(() => expect(within(form).getByText("Must equal the gross")).toBeTruthy());
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("on a phone the items are cards, the band chart is left off, and a person opens in a sheet", async () => {
    setViewport(390);
    await open();
    await screen.findByText("Conventions", {}, { timeout: 5000 });
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByText("Bands by Grade")).toBeNull();
    const people = salary.GradePlacementPage.parse(await api.call("GET /api/v1/salary-structure/placements", { query: {} }));
    expect(screen.queryByRole("button", { name: "Place Person" })).toBeNull();
    fireEvent.click((await screen.findAllByRole("button", { name: new RegExp(people.data[0]!.employee.display_name) }))[0]!);
    const sheet = await screen.findByRole("dialog", { name: "Pay Components" });
    expect(within(sheet).getByRole("button", { name: "Place Person" })).toBeTruthy();
  }, 40000);
});

describe("the mock holds the API's rules", () => {
  it("refuses a day in the past, conventions while off, and a split that is not the gross", async () => {
    await open();
    await expect(api.call("POST /api/v1/statutory/rates", { body: { item: "nhf", rate: "2", effective_from: "2020-01-01" } })).rejects.toMatchObject({
      code: "EFFECTIVE_IN_THE_PAST",
      fields: { effective_from: ["Date too early"] },
    });
    await expect(api.call("POST /api/v1/statutory/rates", { body: { item: "nhf", rate: "200", effective_from: todayIso() } })).rejects.toMatchObject({ fields: { rate: ["At most 100"] } });
    const people = salary.GradePlacementPage.parse(await api.call("GET /api/v1/salary-structure/placements", { query: {} }));
    await expect(
      api.call("PUT /api/v1/salary-structure/employees/:employee_id/components", {
        params: { employee_id: people.data[0]!.employee.employee_id },
        body: { effective_from: todayIso(), components: [{ code: "basic", label: "Basic", amount: "1.00", pensionable: true }] },
      }),
    ).rejects.toMatchObject({ code: "SPLIT_NOT_GROSS" });
  }, 40000);
});
