// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { Procedures } from "./Procedures";
import { SopsTab } from "./Sops";

/**
 * Knowledge Hub · SOPs on the in-browser mock (docs/guides/knowledge.md §10): the published SOPs by
 * department, one opened beside the list with its numbered steps, a writer's chips, the draft's
 * editor with Draft With AI, Publish SOP's note, a phone's sheet, and Procedures under a screen.
 * Cynthia (Operations) holds Manage SOPs on the mock; Chidera (Staff) writes for no department. The
 * procedures are invented.
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

beforeEach(() => {
  setViewport(1440);
  window.history.replaceState(null, "", "/knowledge?tab=sops");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function signedInAs(email: string, body: ReactNode = <SopsTab id={null} />) {
  mockSession.set(null);
  invalidate("/api/v1");
  const view = render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>{body}</Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  return view;
}

describe("Knowledge Hub · SOPs", () => {
  it("lists the published SOPs by department and opens the first beside them, steps numbered", async () => {
    const { container } = await signedInAs("chidera@mycityapp.io");
    await screen.findByText("Campaign Launch", {}, { timeout: 5000 });
    // Staff read; they write for no department, so no New SOP and no State chips.
    expect(screen.queryByRole("button", { name: "New SOP" })).toBeNull();
    expect(screen.queryByRole("group", { name: "State" })).toBeNull();
    expect(within(screen.getByRole("group", { name: "Department" })).getByRole("button", { name: "Marketing & Sales" })).toBeTruthy();
    expect(screen.queryByText("Month End Close")).toBeNull();
    expect(screen.queryByText("Ticket Escalation")).toBeNull();

    // The first SOP shows beside the list, as a reader: no Edit SOP.
    await screen.findByText("How Marketing takes a campaign from brief to launch day.", {}, { timeout: 5000 });
    expect(screen.getByText("SOP-0001")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit SOP" })).toBeNull();
    const steps = screen.getByRole("heading", { name: "Steps" }).closest<HTMLElement>("[data-card]")!;
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(within(steps).getAllByRole("button", { name: "Open Screen" })).toHaveLength(2);
    expect(within(steps).getByRole("button", { name: "brand-kit.pdf" })).toBeTruthy();
    await screen.findByText("Added the budget step", {}, { timeout: 5000 });
    expect(await axe(container)).toHaveNoViolations();
  }, 15000);

  it("a writer sees Draft and Archived, starts an SOP, and edits a draft with Draft With AI", async () => {
    await signedInAs("cynthia@mycityapp.io");
    await screen.findByText("Campaign Launch", {}, { timeout: 5000 });
    expect(screen.getByRole("button", { name: "New SOP" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "State" })).getByRole("button", { name: "Archived" }));
    await screen.findByText("Ticket Escalation", {}, { timeout: 5000 });
    fireEvent.click(within(screen.getByRole("group", { name: "State" })).getByRole("button", { name: "Draft" }));
    fireEvent.click(await screen.findByText("New Joiner Setup", {}, { timeout: 5000 }));
    await screen.findByText("Draft saved, not published.", {}, { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "Edit SOP" }));
    const editor = await screen.findByRole("dialog", { name: "Edit SOP" });
    await waitFor(() => expect(within(editor).getByRole("heading", { name: "Step 4" })).toBeTruthy());

    // Draft With AI: the answer beside the form; Use This Draft replaces it, nothing saved yet.
    fireEvent.click(within(editor).getByRole("button", { name: "Draft With AI" }));
    fireEvent.change(within(editor).getByLabelText("Procedure"), { target: { value: "Add the joiner to payroll. Send the welcome email. Book the induction." } });
    fireEvent.click(within(editor).getByRole("button", { name: "Draft With AI" }));
    await within(editor).findByRole("heading", { name: "Drafted" }, { timeout: 5000 });
    expect(within(editor).getByRole("heading", { name: "Yours" })).toBeTruthy();
    fireEvent.click(within(editor).getByRole("button", { name: "Use This Draft" }));
    await waitFor(() => expect(within(editor).getByRole("heading", { name: "Step 3" })).toBeTruthy());
    expect(within(editor).queryByRole("heading", { name: "Step 4" })).toBeNull();

    // A step too short is marked on its own field, and Save Draft keeps the rest.
    fireEvent.change(within(editor).getAllByLabelText("Step")[0]!, { target: { value: "No" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(within(editor).getAllByLabelText("Step")[0]!.getAttribute("aria-invalid")).toBe("true"));
    fireEvent.change(within(editor).getAllByLabelText("Step")[0]!, { target: { value: "Add the joiner to payroll before their first day." } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit SOP" })).toBeNull(), { timeout: 5000 });
  }, 15000);

  it("a department's head starts an SOP for their own department, chosen for them", async () => {
    await signedInAs("ngozi@mycityapp.io");
    fireEvent.click(await screen.findByRole("button", { name: "New SOP" }, { timeout: 5000 }));
    const sheet = await screen.findByRole("dialog", { name: "New SOP" });
    await within(sheet).findByText("Marketing & Sales", {}, { timeout: 5000 });
    fireEvent.change(within(sheet).getByLabelText("Title"), { target: { value: "Influencer Brief" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Start SOP" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New SOP" })).toBeNull(), { timeout: 5000 });
    // It opens under Draft, a writer's alone until published.
    await screen.findAllByText("Influencer Brief", {}, { timeout: 5000 });
  }, 15000);

  it("Publish SOP asks what changed from Version 2", async () => {
    await signedInAs("cynthia@mycityapp.io");
    fireEvent.click(within(await screen.findByRole("group", { name: "State" }, { timeout: 5000 })).getByRole("button", { name: "Draft" }));
    fireEvent.click(await screen.findByText("New Joiner Setup", {}, { timeout: 5000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Publish SOP" }, { timeout: 5000 }));
    const sheet = await screen.findByRole("dialog", { name: "Publish SOP" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish SOP" }));
    await waitFor(() => expect(within(sheet).getByLabelText("Note").getAttribute("aria-invalid")).toBe("true"));
    fireEvent.change(within(sheet).getByLabelText("Note"), { target: { value: "Added payroll to day one" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish SOP" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Publish SOP" })).toBeNull(), { timeout: 5000 });
  }, 15000);

  it("on a phone nothing opens until a row is tapped, then the SOP opens in a sheet", async () => {
    setViewport(390);
    await signedInAs("chidera@mycityapp.io");
    await screen.findAllByText("Campaign Launch", {}, { timeout: 5000 });
    expect(screen.queryByText("How Marketing takes a campaign from brief to launch day.")).toBeNull();
    const row = document.querySelector<HTMLElement>("[data-row-open]")!;
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "SOP" }, { timeout: 5000 });
    await within(sheet).findByText("How Marketing takes a campaign from brief to launch day.", {}, { timeout: 5000 });
    // Versions sit behind a row in the sheet.
    expect(within(sheet).getByRole("button", { name: "Versions" })).toBeTruthy();
  }, 15000);

  it("Procedures lists the SOPs whose steps happen on a screen, and nothing for a screen with none", async () => {
    await signedInAs(
      "chidera@mycityapp.io",
      <>
        <Procedures screen="partnerships/partners" />
        <Procedures screen="workspace/tasks" />
      </>,
    );
    await screen.findByText("Partner Onboarding", {}, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getAllByRole("heading", { name: "Procedures" })).toHaveLength(1);
    expect(screen.getByText("Operations & People")).toBeTruthy();
  }, 15000);
});
