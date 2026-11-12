// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
 * §10): it starts as production does, with nothing entered; the eight items read Not Set; Switch On asks for the date
 * alone (the law settles the conventions, §6.12 rule 14) and is refused with no figure in force; a rate is entered with
 * its source and a PAYE table with No Legal Source, each shown in the Source column; rent relief takes its rate and its
 * cap, the minimum wage a month's amount; a change still waiting is taken back with Remove Change; the pay day offers
 * Last Day of Month; the option on, the grades and the people against their bands show, and a person's Prior Pay is set
 * in their sheet; a phone opens a person in a sheet. The rules themselves are the API's, tested in
 * tests/integration/payroll-advanced.test.js.
 *
 * THE FIGURES HERE ARE TEST FIGURES, invented for this file: never law, never seeded. Their source is a TEST SOURCE.
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
/** A day as the date field takes it typed: day first. */
const typed = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** A day this many days from today, in Lagos as the screen reads it. */
const daysOn = (n: number) => {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** A TEST SOURCE, labelled: no instrument says any of the test rates. */
const TEST_SOURCE = { source_title: "TEST SOURCE", source_section: "Test section 1", source_checked_on: todayIso() };

describe("Payroll · Configurations", () => {
  it("starts as production does: the default pay day, the eight items Not Set, no bands, nothing of the structure", async () => {
    await open();
    const settings = payroll.PayrollSettings.parse(await api.call("GET /api/v1/payroll/settings", {}));
    expect(settings).toMatchObject({ advanced_enabled: false, advanced_has_been_on: false, pay_day: 30, pay_day_is_default: true });
    expect(statutory.StatutoryItems.parse(await api.call("GET /api/v1/statutory/items", {})).items.every((i) => i.current === null)).toBe(true);
    expect(await screen.findByText("30 (default)")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Not Set")).toHaveLength(8));
    for (const item of ["PAYE", "Employee Pension", "Employer Pension", "NHF", "ITF", "NSITF", "Rent Relief", "Minimum Wage"]) expect(screen.getByText(item)).toBeTruthy();
    // The old relief (the Consolidated Relief Allowance's shape) is retired (§13.1 item 41).
    expect(screen.queryByText("Relief")).toBeNull();
    expect(await screen.findByText("No PAYE Bands")).toBeTruthy();
    expect(screen.queryByText("Conventions")).toBeNull();
    expect(screen.queryByText("Grades")).toBeNull();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("Switch On asks for the date alone, and is refused until a figure is in force that day", async () => {
    await open();
    await screen.findByText("30 (default)");
    fireEvent.click(screen.getByRole("switch", { name: "Advanced Payroll" }));
    const form = await screen.findByRole("dialog", { name: "Switch On Advanced Payroll" });
    // The law settles the conventions (§6.12 rule 14): no PAYE Basis, no Reduces Taxable Pay.
    expect(within(form).queryByText("PAYE Basis")).toBeNull();
    expect(within(form).queryByText("Pension Reduces Taxable Pay")).toBeNull();
    expect(within(form).queryByRole("radiogroup")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Switch On" }));
    await waitFor(() => expect(within(form).getByText("No rate that day")).toBeTruthy());
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("a rate is entered from today with its source in Save Rate, and shows In Force with its Source", async () => {
    await open();
    fireEvent.click(await screen.findByText("Employee Pension"));
    const form = await screen.findByRole("dialog", { name: "Set Employee Pension" });
    fireEvent.click(within(form).getByRole("button", { name: "Save Rate" }));
    // The source is asked for as the rate is: each missing part on its own field.
    await waitFor(() => expect(within(form).getByText("Enter a rate")).toBeTruthy());
    for (const error of ["Name the source", "Name the section", "Pick the day checked"]) expect(within(form).getByText(error)).toBeTruthy();
    expect(within(form).queryByRole("button", { name: "Remove Change" })).toBeNull();
    type(within(form).getByRole("textbox", { name: "Rate" }), "5");
    type(within(form).getByRole("textbox", { name: "Source" }), "TEST SOURCE");
    type(within(form).getByRole("textbox", { name: "Section" }), "Test section 1");
    type(within(form).getByRole("textbox", { name: /Link/ }), "not a link");
    fireEvent.click(within(form).getByRole("button", { name: "Save Rate" }));
    await waitFor(() => expect(within(form).getByText("Not a link")).toBeTruthy());
    type(within(form).getByRole("textbox", { name: /Link/ }), "https://example.test/test-source.pdf");
    await userEvent.type(within(form).getByRole("textbox", { name: "Checked On" }), typed(todayIso()));
    fireEvent.click(within(form).getByRole("button", { name: "Save Rate" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set Employee Pension" })).toBeNull());
    await waitFor(() => expect(screen.getByText("5%")).toBeTruthy());
    expect(screen.getAllByText("In Force").length).toBeGreaterThan(0);
    expect(screen.getByText("TEST SOURCE, Test section 1")).toBeTruthy();
    const pension = statutory.StatutoryItems.parse(await api.call("GET /api/v1/statutory/items", {})).items.find((i) => i.item === "pension_employee")!;
    expect(pension.current).toMatchObject({ source_title: "TEST SOURCE", source_url: "https://example.test/test-source.pdf", source_checked_on: todayIso(), no_legal_source: false });
    expect(await axe(document.body)).toHaveNoViolations();
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
    // No Legal Source swaps the source fields for its Reason.
    fireEvent.click(within(form).getByRole("checkbox", { name: "No Legal Source" }));
    expect(within(form).queryByRole("textbox", { name: "Source" })).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Save Bands" }));
    await waitFor(() => expect(within(form).getByText("Give a reason")).toBeTruthy());
    type(within(form).getByRole("textbox", { name: "Reason" }), "Test bands for this file, not a law");
    fireEvent.click(within(form).getByRole("button", { name: "Save Bands" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set PAYE Bands" })).toBeNull());
    const page = statutory.StatutoryRatePage.parse(await api.call("GET /api/v1/statutory/rates", { query: { item: "paye" } }));
    expect(page.data.map((r) => [r.position, r.band_from, r.band_to, r.rate, r.no_legal_source])).toEqual([
      [1, "0.00", "1000000.00", "10", true],
      [2, "1000000.00", null, "20", true],
    ]);
    expect(await screen.findByText("No Limit")).toBeTruthy();
    // The card's title reads as it is, never with a basis.
    expect(screen.queryByText(/PAYE Bands, /)).toBeNull();
    await waitFor(() => expect(screen.getAllByText("No Legal Source").length).toBeGreaterThanOrEqual(3));
  }, 40000);

  it("Remove Change takes back a rate still waiting for its day, and the one in force stays", async () => {
    const tomorrow = daysOn(1);
    await api.call("POST /api/v1/statutory/rates", { body: { item: "pension_employee", rate: "6", effective_from: tomorrow, ...TEST_SOURCE } });
    await open();
    await screen.findByText(`Changes ${typed(tomorrow)}`);
    fireEvent.click(await screen.findByText("Employee Pension"));
    const form = await screen.findByRole("dialog", { name: "Set Employee Pension" });
    fireEvent.click(within(form).getByRole("button", { name: "Remove Change" }));
    const ask = await screen.findByRole("alertdialog", { name: "Remove Change" });
    fireEvent.click(within(ask).getByRole("button", { name: "Remove Change" }));
    expect(await screen.findByText("Change removed")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(`Changes ${typed(tomorrow)}`)).toBeNull());
    const pension = statutory.StatutoryItems.parse(await api.call("GET /api/v1/statutory/items", {})).items.find((i) => i.item === "pension_employee")!;
    expect(pension).toMatchObject({ current: { rate: "5", effective_from: todayIso() }, next: null });
    // A version in force is never taken back.
    await expect(api.call("DELETE /api/v1/statutory/rates/:item/versions/:effective_from", { params: { item: "pension_employee", effective_from: todayIso() } })).rejects.toMatchObject({
      code: "VERSION_IN_FORCE",
    });
  }, 40000);

  it("Set Pay Day offers Last Day of Month, and a pay day still waiting is taken back from the card", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Set Pay Day" }));
    const form = await screen.findByRole("dialog", { name: "Set Pay Day" });
    fireEvent.click(within(form).getByRole("combobox", { name: "Pay Day" }));
    expect(await screen.findByRole("option", { name: "Last Day of Month" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "31" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Last Day of Month" }));
    fireEvent.click(within(form).getByRole("button", { name: "Set Pay Day" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set Pay Day" })).toBeNull());
    expect(await screen.findByText("Last Day of Month")).toBeTruthy();
    expect(payroll.PayrollSettings.parse(await api.call("GET /api/v1/payroll/settings", {})).pay_day).toBe(31);

    await api.call("PATCH /api/v1/payroll/settings", { body: { effective_from: daysOn(3), pay_day: 25 } });
    invalidate("/api/v1");
    expect(await screen.findByText(`25 from ${typed(daysOn(3))}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Change" }));
    const ask = await screen.findByRole("alertdialog", { name: "Remove Change" });
    fireEvent.click(within(ask).getByRole("button", { name: "Remove Change" }));
    await waitFor(() => expect(screen.queryByText(`25 from ${typed(daysOn(3))}`)).toBeNull());
    const settings = payroll.PayrollSettings.parse(await api.call("GET /api/v1/payroll/settings", {}));
    expect(settings).toMatchObject({ pay_day: 31, next: null });
    expect(screen.queryByRole("button", { name: "Remove Change" })).toBeNull();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("rent relief takes its rate and its cap, the minimum wage a month's amount and no rate", async () => {
    await open();
    fireEvent.click(await screen.findByText("Rent Relief"));
    const rent = await screen.findByRole("dialog", { name: "Set Rent Relief" });
    type(within(rent).getByRole("textbox", { name: "Rate" }), "10");
    fireEvent.click(within(rent).getByRole("button", { name: "Save Rate" }));
    await waitFor(() => expect(within(rent).getByText("Enter the cap")).toBeTruthy());
    type(within(rent).getByRole("textbox", { name: "Cap a Year" }), "300000");
    fireEvent.click(within(rent).getByRole("checkbox", { name: "No Legal Source" }));
    type(within(rent).getByRole("textbox", { name: "Reason" }), "Test figures for this file, not a law");
    fireEvent.click(within(rent).getByRole("button", { name: "Save Rate" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set Rent Relief" })).toBeNull());
    expect(await screen.findByText("10%, cap ₦300,000.00")).toBeTruthy();

    fireEvent.click(await screen.findByText("Minimum Wage"));
    const wage = await screen.findByRole("dialog", { name: "Set Minimum Wage" });
    expect(within(wage).queryByRole("textbox", { name: "Rate" })).toBeNull();
    type(within(wage).getByRole("textbox", { name: "Monthly Amount" }), "50000");
    fireEvent.click(within(wage).getByRole("checkbox", { name: "No Legal Source" }));
    type(within(wage).getByRole("textbox", { name: "Reason" }), "Test figures for this file, not a law");
    fireEvent.click(within(wage).getByRole("button", { name: "Save Rate" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set Minimum Wage" })).toBeNull());
    expect(await screen.findByText("₦50,000.00")).toBeTruthy();
    const items = statutory.StatutoryItems.parse(await api.call("GET /api/v1/statutory/items", {})).items;
    expect(items.find((i) => i.item === "rent_relief")!.current).toMatchObject({ rate: "10", flat_amount: "300000.00" });
    expect(items.find((i) => i.item === "minimum_wage")!.current).toMatchObject({ rate: null, flat_amount: "50000.00" });
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("switched on, the structure shows: a grade, people against their band, a pay split, Prior Pay", async () => {
    await open();
    await api.call("PATCH /api/v1/payroll/settings", { body: { effective_from: todayIso(), advanced_enabled: true } });
    invalidate("/api/v1");
    expect(await screen.findByText("Grades", {}, { timeout: 5000 })).toBeTruthy();
    // The conventions are the law's (§6.12 rule 14): no card asks for them.
    expect(screen.queryByText("Conventions")).toBeNull();
    expect(screen.queryByText("Pension Reduces Taxable Pay")).toBeNull();
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
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set Pay Components" })).toBeNull());

    // Prior Pay: this year's taxable pay and tax before MyCity's first statutory month (§13.1 item 42).
    expect(await screen.findByText("None")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Set Prior Pay" }));
    const prior = await screen.findByRole("dialog", { name: "Set Prior Pay" });
    fireEvent.click(within(prior).getByRole("button", { name: "Save Prior Pay" }));
    await waitFor(() => expect(within(prior).getAllByText("Required").length).toBe(2));
    type(within(prior).getByRole("textbox", { name: "Taxable Pay" }), "2000000");
    type(within(prior).getByRole("textbox", { name: "Tax Paid" }), "100000");
    fireEvent.click(within(prior).getByRole("button", { name: "Save Prior Pay" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Set Prior Pay" })).toBeNull());
    expect(await screen.findByText(`Prior Tax ${todayIso().slice(0, 4)}`)).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 40000);

  it("on a phone the items are cards, the band chart is left off, and a person opens in a sheet", async () => {
    setViewport(390);
    await open();
    await screen.findByText("Grades", {}, { timeout: 5000 });
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
  it("refuses a day in the past, a version without its source, a split that is not the gross", async () => {
    await open();
    await expect(api.call("POST /api/v1/statutory/rates", { body: { item: "nhf", rate: "2", effective_from: "2020-01-01", ...TEST_SOURCE } })).rejects.toMatchObject({
      code: "EFFECTIVE_IN_THE_PAST",
      fields: { effective_from: ["Date too early"] },
    });
    await expect(api.call("POST /api/v1/statutory/rates", { body: { item: "nhf", rate: "200", effective_from: todayIso(), ...TEST_SOURCE } })).rejects.toMatchObject({ fields: { rate: ["At most 100"] } });
    await expect(api.call("POST /api/v1/statutory/rates", { body: { item: "nhf", rate: "2", effective_from: todayIso() } })).rejects.toMatchObject({
      code: "SOURCE_REQUIRED",
      fields: { source_title: ["Name the source"] },
    });
    await expect(api.call("POST /api/v1/statutory/rates", { body: { item: "nhf", rate: "2", effective_from: todayIso(), ...TEST_SOURCE, source_checked_on: daysOn(5) } })).rejects.toMatchObject({
      code: "CHECKED_IN_THE_FUTURE",
    });
    const people = salary.GradePlacementPage.parse(await api.call("GET /api/v1/salary-structure/placements", { query: {} }));
    await expect(
      api.call("PUT /api/v1/salary-structure/employees/:employee_id/components", {
        params: { employee_id: people.data[0]!.employee.employee_id },
        body: { effective_from: todayIso(), components: [{ code: "basic", label: "Basic", amount: "1.00", pensionable: true }] },
      }),
    ).rejects.toMatchObject({ code: "SPLIT_NOT_GROSS" });
  }, 40000);
});
