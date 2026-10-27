// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession } from "@/api/mock/core";
import { KPIS } from "@/api/mock/data/performance";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Performance from "./index";

/**
 * Performance · KPIs, set and recorded on screen, on the in-browser mock (docs/guides/performance.md
 * §6.5, §10): New KPI asks for the target's wording and leaves the figure, the unit, the formula and
 * the data source optional; the Unit is picked from the units in use or typed; Record Actual needs the
 * figure for Met and Not Met and shows none for N/A; Report Month's KPI rows hold the same rule.
 */

vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T08:30:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  setViewport(1440);
});

/** Waits for every request the screen started, and those their answers start. */
async function settled() {
  const sent = () => vi.mocked(dispatch).mock.results;
  await act(() => new Promise((r) => setTimeout(r, 300)));
  for (let answered = -1; answered < sent().length; ) {
    answered = sent().length;
    await act(async () => {
      await Promise.allSettled(sent().map((r) => r.value));
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

let auth: ReturnType<typeof useAuth> | null = null;
function Screen() {
  const { location } = useRouter();
  return location.module === "performance" ? <Performance tab={location.tab ?? "goals"} id={location.id} /> : null;
}
function Harness({ show }: { show: boolean }) {
  auth = useAuth();
  return show && auth.status === "signed-in" ? <Screen /> : null;
}
const app = (show: boolean) => (
  <RouterProvider>
    <AuthProvider>
      <ModalProvider>
        <ScreenActionProvider>
          <Harness show={show} />
        </ScreenActionProvider>
      </ModalProvider>
    </AuthProvider>
  </RouterProvider>
);

/** Signs in on the mock and opens the address. */
async function openAs(email: string, address: string) {
  window.history.replaceState(null, "", address);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  rerender(app(true));
  await settled();
}

/** The copy rules the screen gates hold a screen to, read from what is rendered. */
function copyProblems(root: ParentNode = document.body): string[] {
  const problems: string[] = [];
  const read = (selector: string, limit: number, chrome: boolean) => {
    for (const el of root.querySelectorAll(selector)) {
      if (el.closest('[data-copy="content"]')) continue;
      const t = el.textContent?.trim() ?? "";
      if (copy.wordCount(t) > limit) problems.push(`${selector} over ${limit} words: "${t}"`);
      const word = chrome ? copy.titleCaseViolation(t) : null;
      if (word) problems.push(`${selector} not Title Case at "${word}": "${t}"`);
      if (copy.hasDash(t)) problems.push(`${selector} has a dash: "${t}"`);
    }
  };
  read('[data-ui="title"]', copy.LIMITS.title, true);
  read('[data-ui="button"]', copy.LIMITS.button, true);
  read("label", copy.LIMITS.fieldLabel, false);
  return problems;
}

const dialog = () => screen.getAllByRole("dialog").at(-1)!;
const press = async (root: HTMLElement, name: string | RegExp) => {
  fireEvent.click(within(root).getByRole("button", { name }));
  await settled();
};
const type = (root: HTMLElement, label: string | RegExp, value: string) => fireEvent.change(within(root).getByLabelText(label), { target: { value } });
const valueOf = (root: HTMLElement, label: string | RegExp) => (within(root).getByLabelText(label) as HTMLInputElement).value;
/** Does the field's label carry the Optional tag? A field with none is required. */
const optional = (root: HTMLElement, label: string) => within(root).getByText(label, { selector: "label" }).parentElement!.textContent!.includes("Optional");
const lookup = (code: string) => KPIS.find((k) => k.code === code)!;

async function openNewKpi() {
  await openAs("ngozi@mycityapp.io", "/performance?tab=kpis");
  fireEvent.click((await screen.findAllByRole("button", { name: /New KPI/ }, { timeout: 5000 }))[0]!);
  await settled();
  return dialog();
}

async function openKpi(code: string) {
  await openAs("ngozi@mycityapp.io", "/performance?tab=kpis");
  fireEvent.click((await screen.findAllByText(code, undefined, { timeout: 5000 }))[0]!);
  await settled();
  return dialog();
}

describe("Performance · KPIs, set and recorded on screen", () => {
  it("New KPI: the target's wording is required, and the figure, unit, formula and data source are optional", async () => {
    const form = await openNewKpi();
    for (const label of ["Formula", "Unit", "Target", "Data Source"]) expect(optional(form, label)).toBe(true);
    for (const label of ["Function", "KPI", "Direction", "Target Wording", "Frequency"]) expect(optional(form, label)).toBe(false);
    expect(copyProblems()).toEqual([]);

    // Pressing Set KPI with no wording marks it and sends nothing.
    const before = KPIS.length;
    type(form, "KPI", "Management feature");
    await press(form, "Set KPI");
    expect(KPIS.length).toBe(before);
    expect(within(dialog()).getByText("Required")).toBeTruthy();
    expect(valueOf(dialog(), "KPI")).toBe("Management feature");

    // With the wording alone it is set: no figure, no unit, no formula.
    type(dialog(), "Target Wording", ">= 10");
    await press(dialog(), "Set KPI");
    expect(KPIS.length).toBe(before + 1);
    expect(KPIS.at(-1)).toMatchObject({ name: "Management feature", target_text: ">= 10", target_value: null, unit: null, formula: null });
  }, 60000);

  it("Unit suggests the units in use, narrowed as it is typed, and keeps one it does not know", async () => {
    const form = await openNewKpi();
    const unit = within(form).getByLabelText("Unit");
    fireEvent.focus(unit);
    await settled();
    const offered = within(screen.getByRole("listbox", { name: "Unit" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    // Each unit with how often it is used, the most used first.
    expect(offered[0]).toMatch(/^%\d+ uses?$/);
    expect(offered.some((o) => o?.startsWith("features"))).toBe(true);
    expect(copyProblems()).toEqual([]);

    // A unit the system does not know is offered as Add and kept as typed.
    fireEvent.change(unit, { target: { value: "tickets" } });
    await settled();
    expect(screen.getAllByRole("option")[0]!.textContent).toBe("Add “tickets”");
    fireEvent.click(screen.getAllByRole("option")[0]!);
    expect(valueOf(dialog(), "Unit")).toBe("tickets");
    type(dialog(), "KPI", "Tickets closed");
    type(dialog(), "Target Wording", "≥50 a week");
    await press(dialog(), "Set KPI");
    expect(KPIS.at(-1)).toMatchObject({ name: "Tickets closed", unit: "tickets" });

    // Once saved it is a unit in use.
    cleanup();
    const next = await openNewKpi();
    fireEvent.focus(within(next).getByLabelText("Unit"));
    await settled();
    expect(within(screen.getByRole("listbox", { name: "Unit" })).getByRole("option", { name: /^tickets/ })).toBeTruthy();

    // A suggestion is picked as it is.
    fireEvent.click(within(screen.getByRole("listbox", { name: "Unit" })).getAllByRole("option")[0]!);
    expect(valueOf(dialog(), "Unit")).toBe("%");
  }, 60000);

  it("Record Actual: the actual is required for Met and Not Met, and N/A shows none", async () => {
    await openKpi("BM-K02");
    await press(dialog(), "Record Actual");
    let form = dialog();
    expect(optional(form, "Actual")).toBe(false);
    expect(optional(form, "Comment")).toBe(true);
    expect(copyProblems()).toEqual([]);

    // Met with no figure is marked on the Actual and records nothing.
    type(form, "Actual", "");
    await press(form, "Record Actual");
    form = dialog();
    expect(within(form).getByText("Enter the actual")).toBeTruthy();
    expect(lookup("BM-K02").latest).toMatchObject({ result: "not_met", actual_value: "84" });

    // N/A has no figure to give: the field goes, and the month is recorded without one.
    await chooseOption(within(form).getByLabelText("Result"), "N/A");
    expect(within(form).queryByLabelText("Actual")).toBeNull();
    await press(form, "Record Actual");
    expect(lookup("BM-K02").latest).toMatchObject({ result: "na", actual_value: null });
  }, 60000);

  it("Record Actual records a figure for Met", async () => {
    await openKpi("BM-K01");
    await press(dialog(), "Record Actual");
    const form = dialog();
    type(form, "Actual", "97");
    await press(form, "Record Actual");
    expect(lookup("BM-K01").latest).toMatchObject({ result: "met", actual_value: "97" });
  }, 60000);

  it("Edit KPI keeps the wording required and offers the same Unit field", async () => {
    await openKpi("BM-K01");
    await press(dialog(), "Edit KPI");
    let form = dialog();
    expect(optional(form, "Target Wording")).toBe(false);
    expect(optional(form, "Unit")).toBe(true);
    expect(valueOf(form, "Unit")).toBe("%");
    fireEvent.focus(within(form).getByLabelText("Unit"));
    await settled();
    expect(screen.getByRole("listbox", { name: "Unit" })).toBeTruthy();

    // The wording cannot be emptied.
    type(form, "Target Wording", "");
    await press(form, "Save KPI");
    form = dialog();
    expect(within(form).getByText("Required")).toBeTruthy();
    expect(lookup("BM-K01").target_text).toBe("95%");

    type(form, "Target Wording", "At least 95%");
    await press(form, "Save KPI");
    expect(lookup("BM-K01").target_text).toBe("At least 95%");
  }, 60000);

  it("Report Month holds a KPI's row to the same rule: a figure for Met and Not Met, none for N/A", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    await press(document.body, "Report Month");
    let form = dialog();
    // A KPI's row is the card that holds its Result: the first card up from its title that does.
    const card = () => {
      let el = within(form).getByText(/^BM-K01 ·/).parentElement;
      while (el && !within(el).queryByLabelText("Result")) el = el.parentElement;
      return within(el!);
    };
    const tag = (label: HTMLElement) => label.parentElement!.textContent!.includes("Optional");
    // A key result's Actual may be left empty; a KPI's may not.
    expect(tag(card().getByText("Actual", { selector: "label" }))).toBe(false);
    expect(tag(within(form).getAllByText("Actual", { selector: "label" })[0]!)).toBe(true);

    // Not Met with no figure is marked on the row and sends nothing.
    await chooseOption(card().getByLabelText("Result"), "Not Met");
    fireEvent.change(card().getByLabelText("Actual"), { target: { value: "" } });
    const before = lookup("BM-K01").latest;
    await press(form, "Report Month");
    form = dialog();
    expect(card().getByText("Enter the actual")).toBeTruthy();
    expect(lookup("BM-K01").latest).toBe(before);

    // N/A has no figure: the field goes, and the month is recorded without one.
    await chooseOption(card().getByLabelText("Result"), "N/A");
    expect(card().queryByLabelText("Actual")).toBeNull();
    await press(form, "Report Month");
    expect(lookup("BM-K01").latest).toMatchObject({ result: "na", actual_value: null });
  }, 60000);
});
