// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { installEditorTestEnv } from "../../../../packages/ui/src/form/test-env";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { Categories } from "./Categories";

/**
 * Partnerships · Categories (#104) on the in-browser mock, which answers as the API does: the list beside the
 * record on desktop, the sheet on a phone, and what a holder of `partnerships.configure` can do that a member
 * of staff cannot (docs/guides/partnerships.md §6.3, §10).
 */
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
beforeAll(() => {
  installEditorTestEnv();
  // jsdom has no layout: the listbox scrolls its chosen option into view.
  Element.prototype.scrollIntoView ??= () => undefined;
});
beforeEach(() => setViewport(1440));
afterEach(cleanup);

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function openAs(email: string) {
  mockSession.set(null);
  invalidate("/api/v1");
  window.history.replaceState(null, "", "/partnerships?tab=categories");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <Categories />
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await screen.findByText("Categories", { selector: "h1" }, { timeout: 5000 });
}

const asOperations = () => openAs("cynthia@mycityapp.io");

/** Radix opens a menu on pointer down; its items and our listboxes are chosen with a click. */
const openMenu = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, pointerType: "mouse" });
const click = (el: HTMLElement) => fireEvent.click(el);

describe("Partnerships · Categories, on desktop", () => {
  it("lists the categories with their counts, and opens the first beside them with its four sections", async () => {
    await asOperations();
    const table = await screen.findByRole("table", { name: "All Categories" }, { timeout: 5000 });
    expect(within(table).getByText("Event")).toBeTruthy();
    expect(within(table).getByText("Hospitality")).toBeTruthy();
    await screen.findByRole("heading", { name: "Event", level: 2 }, { timeout: 5000 });
    for (const title of ["Defaults", "Templates", "Delivery Checklist", "Custom Fields"]) expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText("Deal Merchant Agreement")).toBeTruthy();
    expect(screen.getByText(/Deal Merchant · Version 1/)).toBeTruthy();
    expect(screen.getByText("Default", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Ticket Model")).toBeTruthy();
    expect(screen.getByText("7 days after signing")).toBeTruthy();
    expect(screen.getByText("14 days before the event")).toBeTruthy();
  }, 30000);

  it("a holder of partnerships.configure sees every way to change it; a member of staff sees none", async () => {
    await asOperations();
    await screen.findByRole("heading", { name: "Event", level: 2 }, { timeout: 5000 });
    for (const name of ["New Category", "Start From Tracker", "Add Template", "Tidy With AI", "Add Item", "Add Field"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    cleanup();
    await openAs("kemi@mycityapp.io");
    await screen.findByRole("heading", { name: "Event", level: 2 }, { timeout: 5000 });
    for (const name of ["New Category", "Start From Tracker", "Add Template", "Add Item", "Add Field"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getByText("Deal Merchant Agreement")).toBeTruthy();
  }, 30000);

  it("New Category adds one and refuses a name already used, on the field", async () => {
    const user = userEvent.setup();
    await asOperations();
    await user.click(await screen.findByRole("button", { name: "New Category" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add Category" }));
    expect(await within(dialog).findByText(/Add a name|At least|Required/i)).toBeTruthy();
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "hospitality");
    await user.click(within(dialog).getByRole("button", { name: "Add Category" }));
    expect(await within(dialog).findByText("Name in use")).toBeTruthy();
    await user.clear(within(dialog).getByRole("textbox", { name: "Name" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Tourism");
    await user.click(within(dialog).getByRole("button", { name: "Add Category" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
    expect(await screen.findByText("Tourism")).toBeTruthy();
  }, 30000);

  it("retires a category after asking, and restores it", async () => {
    const user = userEvent.setup();
    await asOperations();
    click(await screen.findByText("Media", { selector: "td *, td" }));
    await screen.findByRole("heading", { name: "Media", level: 2 });
    openMenu(screen.getByRole("button", { name: "More Actions" }));
    click(await screen.findByRole("menuitem", { name: "Retire" }));
    await user.click(await screen.findByRole("button", { name: "Retire Category" }));
    expect(await screen.findByText("Retired", { selector: "span" }, { timeout: 5000 })).toBeTruthy();
    openMenu(screen.getByRole("button", { name: "More Actions" }));
    click(await screen.findByRole("menuitem", { name: "Restore" }));
    await waitFor(() => expect(screen.queryByText("Retired", { selector: "span" })).toBeNull(), { timeout: 5000 });
  }, 30000);

  it("moves a checklist item down and adds one", async () => {
    const user = userEvent.setup();
    await asOperations();
    await screen.findByRole("heading", { name: "Delivery Checklist" }, { timeout: 5000 });
    const titles = () => screen.getAllByRole("button", { name: /^Move .* Up$/ }).map((b) => (b.getAttribute("aria-label") ?? "").replace(/^Move | Up$/g, ""));
    expect(titles().slice(0, 2)).toEqual(["Platform and technical partnership", "Amplification"]);
    await user.click(screen.getByRole("button", { name: "Move Platform and technical partnership Down" }));
    await waitFor(() => expect(titles().slice(0, 2)).toEqual(["Amplification", "Platform and technical partnership"]));
    await user.click(screen.getByRole("button", { name: "Add Item" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Item" }), "Press release");
    await user.click(within(dialog).getByRole("button", { name: "Add Item" }));
    expect(await screen.findByText("Press release", {}, { timeout: 5000 })).toBeTruthy();
  }, 30000);

  it("Add Field asks for the choices of a pick and keeps the key out of sight", async () => {
    const user = userEvent.setup();
    await asOperations();
    await user.click(await screen.findByRole("button", { name: "Add Field" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Label" }), "Venue Type");
    click(within(dialog).getByRole("combobox", { name: "Type" }));
    click(await screen.findByRole("option", { name: "Pick One" }));
    await user.click(within(dialog).getByRole("button", { name: "Add Field" }));
    expect(await within(dialog).findByText(/choices/i)).toBeTruthy();
    await user.type(within(dialog).getByRole("textbox", { name: "Choices" }), "Indoor{enter}Outdoor");
    await user.click(within(dialog).getByRole("button", { name: "Add Field" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
    expect(await screen.findByText(/Venue Type/)).toBeTruthy();
    expect(screen.queryByText("venue_type")).toBeNull();
  }, 30000);

  it("the template editor opens with the wording's fields as chips and the asks; Tidy With AI keeps nothing until Use Draft", async () => {
    const user = userEvent.setup();
    await asOperations();
    await screen.findByRole("heading", { name: "Templates" }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: "Edit Deal Merchant Agreement" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("textbox", { name: "Wording" }, { timeout: 5000 })).toBeTruthy();
    expect(await within(dialog).findAllByText("Business Name", { selector: ".rte-chip" })).toHaveLength(1);
    expect(within(dialog).getByDisplayValue("Opening Hours")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Tidy With AI" }));
    await user.type(await within(dialog).findByRole("textbox", { name: "Pasted Wording" }), "Business Name: Eko Arts Fair\n\nThe fee is due in thirty days.");
    await user.click(within(dialog).getByRole("button", { name: "Tidy Wording" }));
    expect(await within(dialog).findByText("Eko Arts Fair", {}, { timeout: 5000 })).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Field for Eko Arts Fair" })).toBeTruthy();
    // Back keeps the wording as it was: the draft was never kept.
    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(await within(dialog).findAllByText("Business Name", { selector: ".rte-chip" })).toHaveLength(1);
    expect(within(dialog).queryByText(/The fee is due in thirty days/)).toBeNull();
  }, 40000);

  it("Pipeline Settings lists MyCity's stages with what each counts as; a stage needs its meaning", async () => {
    const user = userEvent.setup();
    await asOperations();
    await user.click(await screen.findByRole("radio", { name: "Pipeline Settings" }));
    await screen.findByRole("heading", { name: "Stages" });
    expect(await screen.findByText("Prospect Identified")).toBeTruthy();
    expect(screen.getAllByText("Closed Lost").length).toBeGreaterThan(0);
    for (const title of ["Potential Impact", "Lead Sources", "Document Kinds"]) expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add Stage" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Pilot Run");
    await user.click(within(dialog).getByRole("button", { name: "Add Stage" }));
    expect(await within(dialog).findByText(/^pick one$/i)).toBeTruthy();
  }, 30000);

  it("Proof Points lists MyCity's facts and adds one", async () => {
    const user = userEvent.setup();
    await asOperations();
    await user.click(await screen.findByRole("radio", { name: "Proof Points" }));
    expect(await screen.findByText("Network and community")).toBeTruthy();
    expect(screen.getByText("10,000+")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add Proof Point" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Label" }), "Active partners");
    await user.type(within(dialog).getByRole("textbox", { name: "Figure" }), "40+");
    await user.click(within(dialog).getByRole("button", { name: "Add Proof Point" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
    expect(await screen.findByText("Active partners")).toBeTruthy();
  }, 30000);

  it("Start From Tracker reads the dropdowns and applies them after the person corrects them", async () => {
    const user = userEvent.setup();
    await asOperations();
    await user.click(await screen.findByRole("button", { name: "Start From Tracker" }));
    const dialog = await screen.findByRole("dialog");
    const file = new File(["x"], "tracker.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const input = dialog.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(await within(dialog).findByText("Introductory Meeting Scheduled", {}, { timeout: 15000 })).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Counts as for Introductory Meeting Scheduled" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Leave out On Hold" }));
    expect(within(dialog).queryByText("On Hold")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Apply Lists" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
  }, 40000);
});

describe("Partnerships · Categories, on a phone", () => {
  beforeEach(() => setViewport(390));

  it("lists categories as cards with Pipeline Settings and Proof Points behind their own rows, and opens a category in a sheet", async () => {
    await asOperations();
    expect(await screen.findByRole("button", { name: "Pipeline Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Proof Points" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Pipeline Settings" })).toBeNull();
    // Nothing opens until a row is tapped (F31).
    expect(screen.queryByRole("heading", { name: "Event", level: 2 })).toBeNull();
    click(await screen.findByText("Event", { selector: "[data-row-open] *, [data-row-open]" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByRole("heading", { name: "Event", level: 2 })).toBeTruthy();
    // The sections are one at a time, not a long page.
    expect(within(sheet).getByRole("radio", { name: "Defaults" })).toBeTruthy();
    expect(within(sheet).queryByRole("heading", { name: "Templates" })).toBeNull();
    click(within(sheet).getByRole("radio", { name: "Templates" }));
    expect(await within(sheet).findByText("Deal Merchant Agreement")).toBeTruthy();
  }, 30000);

  it("a row opens Pipeline Settings in a sheet", async () => {
    await asOperations();
    click(await screen.findByRole("button", { name: "Pipeline Settings" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText("Prospect Identified")).toBeTruthy();
  }, 30000);
});
