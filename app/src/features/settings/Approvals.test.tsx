// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { Approvals } from "./Approvals";

/**
 * Settings · Approvals on the in-browser mock (docs/guides/foundation.md §6.5, §10): New Flow in
 * three steps, Flow, Values and Stages, each checked as it is filled, saved as version 1 and
 * listed as Not Used Yet until a module opens it; a name that is already a flow is refused on the
 * name, back on the first step.
 */

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Each test signs in and walks a wizard; the default five seconds is too few for the first.
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => setViewport(1440));
afterEach(() => cleanup());

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function open() {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <Approvals />
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn("cynthia@mycityapp.io", "demo1234");
  });
  await screen.findByText("Leave Request", {}, { timeout: 5000 });
}

const press = (scope: HTMLElement | Screen, name: string) => fireEvent.click(within(scope as HTMLElement).getByRole("button", { name }));
const dialog = () => screen.findByRole("dialog", { name: "New Flow" });
const fill = (scope: HTMLElement, label: string, value: string) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
/** Picks an option by its words; a list still loading (the modules) closes and is tried again. */
async function choose(scope: HTMLElement, field: string, option: string) {
  const trigger = within(scope).getByRole("combobox", { name: field });
  await waitFor(
    async () => {
      try {
        await chooseOption(trigger, option);
      } catch (e) {
        fireEvent.keyDown(screen.queryByRole("listbox") ?? trigger, { key: "Escape" });
        throw e;
      }
    },
    { timeout: 5000 },
  );
}

/** Step 1 filled and passed: a name and a module. */
async function flowStep(box: HTMLElement, name: string) {
  fill(box, "Flow Name", name);
  await choose(box, "Module", "People");
  press(box, "Next");
  await within(box).findByRole("button", { name: "Add Value" });
}

describe("New Flow", () => {
  it("makes a flow in three steps and lists it as Not Used Yet", async () => {
    await open();
    press(document.body, "New Flow");
    const box = await dialog();

    // Each step is checked before the next: a name and a module first.
    press(box, "Next");
    await waitFor(() => expect(within(box).getByLabelText("Flow Name").getAttribute("aria-invalid")).toBe("true"));
    expect(within(box).getByRole("combobox", { name: "Module" }).getAttribute("aria-invalid")).toBe("true");
    await flowStep(box, "Petty Cash");

    // Values: a name and a type, then it is a card.
    press(box, "Add Value");
    press(box, "Add Value");
    await waitFor(() => expect(within(box).getByLabelText("Value Name").getAttribute("aria-invalid")).toBe("true"));
    fill(box, "Value Name", "Amount");
    await choose(box, "Type", "Money");
    press(box, "Add Value");
    expect(await within(box).findByText("Amount")).toBeTruthy();
    expect(within(box).getByText("Money")).toBeTruthy();
    press(box, "Next");

    // Stages: Create Flow with none says so; one is built the way Edit Stages builds it.
    await within(box).findByRole("button", { name: "Add Stage" });
    press(box, "Create Flow");
    expect(await within(box).findByText("Add a stage")).toBeTruthy();
    press(box, "Add Stage");
    fill(box, "Stage Name", "Finance");
    fireEvent.click(within(box).getByRole("radio", { name: "CEO" }));
    await choose(box, "Applies When", "Amount");
    await choose(box, "Comparison", "At Least");
    fill(box, "Amount", "500000");
    press(box, "Add Stage");
    expect(await within(box).findByText("1. Finance")).toBeTruthy();
    expect(within(box).getByText("Amount at least ₦500,000.00")).toBeTruthy();
    expect(within(box).queryByText("Add a stage")).toBeNull();

    press(box, "Create Flow");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Flow" })).toBeNull());
    const row = (await screen.findByText("Petty Cash")).closest("tr")!;
    expect(within(row).getByText("Finance")).toBeTruthy();
    expect(within(row).getByText("Not Used Yet")).toBeTruthy();
  });

  it("refuses a name that is already a flow, on the name", async () => {
    await open();
    for (const [again, error] of [[false, null], [true, "Name already used"]] as const) {
      press(document.body, "New Flow");
      const box = await dialog();
      await flowStep(box, "Site Hire");
      press(box, "Next");
      fireEvent.click(await within(box).findByRole("button", { name: "Add Stage" }));
      fill(box, "Stage Name", "Head");
      press(box, "Add Stage");
      await within(box).findByText("1. Head");
      press(box, "Create Flow");
      if (!again) {
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Flow" })).toBeNull());
        continue;
      }
      // Back on the first step, the name marked.
      expect(await within(box).findByText(error)).toBeTruthy();
      expect(within(box).getByLabelText("Flow Name").getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByRole("dialog", { name: "New Flow" })).toBeTruthy();
    }
  });

  it("will not take a value a stage reads away", async () => {
    await open();
    press(document.body, "New Flow");
    const box = await dialog();
    await flowStep(box, "Hire Days");
    press(box, "Add Value");
    fill(box, "Value Name", "Days");
    await choose(box, "Type", "Number");
    press(box, "Add Value");
    await within(box).findByText("Days");
    press(box, "Next");
    fireEvent.click(await within(box).findByRole("button", { name: "Add Stage" }));
    fill(box, "Stage Name", "Head");
    await choose(box, "Applies When", "Days");
    fill(box, "Days", "3");
    press(box, "Add Stage");
    await within(box).findByText("1. Head");
    press(box, "Back");
    const remove = await within(box).findByRole("button", { name: "Remove Days, a stage reads it" });
    expect(remove.hasAttribute("disabled")).toBe(true);
  });
});
