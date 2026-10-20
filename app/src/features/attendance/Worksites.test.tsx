// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { Worksites } from "./Worksites";

/**
 * People · Worksites on the in-browser mock (docs/guides/attendance.md §10): the address
 * searches as it is typed, through the mock's own answer for /maps/search, and the place
 * picked fills the centre, which stays open to correct before the worksite is added; the
 * centre is drawn on a map with its fence; coordinates typed with no address are looked up
 * for one (/maps/reverse). The mock has no tiles, so the maps draw their points only.
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

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function signedInAs(email: string, screenUnderTest: ReactNode) {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>{screenUnderTest}</Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
  await waitFor(() => expect(auth?.status).toBe("signed-in"), { timeout: 5000 });
}

const valueOf = (el: HTMLElement) => (el as HTMLInputElement).value;
const fill = (dialog: HTMLElement, label: string, value: string) => fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });

describe("adding a worksite", () => {
  it("the address searches as it is typed and the place picked fills the centre", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Worksite" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add Worksite" });

    fill(dialog, "Name", "Admiralty Annex");
    const address = within(dialog).getByRole("combobox", { name: /Address/ });
    fireEvent.focus(address);
    fireEvent.change(address, { target: { value: "admiralty way" } });
    const option = await within(dialog).findByRole("option", { name: /12 Admiralty Way, Lekki Phase 1/ }, { timeout: 5000 });
    expect(await axe(dialog)).toHaveNoViolations();
    fireEvent.click(option);

    expect(valueOf(address)).toBe("12 Admiralty Way, Lekki Phase 1, Lagos");
    expect(valueOf(within(dialog).getByLabelText("Latitude"))).toBe("6.432100");
    expect(valueOf(within(dialog).getByLabelText("Longitude"))).toBe("3.421900");
    expect(within(dialog).queryByRole("listbox")).toBeNull();
    // The centre on a map, with the fence around it.
    await waitFor(() => expect(dialog.querySelector("[data-points]")?.getAttribute("data-points")).toBe("6.43210, 3.42190"));

    // The centre stays open to correct.
    fill(dialog, "Longitude", "3.4221");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Worksite" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Worksite" })).toBeNull(), { timeout: 5000 });
    const page = await api.call("GET /api/v1/worksites", { query: { q: "Admiralty Annex" } });
    expect(page.data[0]).toMatchObject({ name: "Admiralty Annex", address: "12 Admiralty Way, Lekki Phase 1, Lagos", latitude: 6.4321, longitude: 3.4221, radius_m: 100 });
  }, 30000);

  it("an address the search cannot find is kept as typed, with the centre typed in", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Worksite" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add Worksite" });
    const address = within(dialog).getByRole("combobox", { name: /Address/ });
    fireEvent.focus(address);
    fireEvent.change(address, { target: { value: "Plot 9 Unlisted Close" } });
    await within(dialog).findByText("No address matches", undefined, { timeout: 5000 });
    expect(valueOf(address)).toBe("Plot 9 Unlisted Close");
    expect(valueOf(within(dialog).getByLabelText("Latitude"))).toBe("");
  }, 30000);

  it("coordinates typed with no address are looked up for one; an address already written is kept", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add Worksite" }))[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Add Worksite" });
    fill(dialog, "Latitude", "6.4321");
    fill(dialog, "Longitude", "3.4219");
    const address = within(dialog).getByRole("combobox", { name: /Address/ });
    await waitFor(() => expect(valueOf(address)).toBe("12 Admiralty Way, Lekki Phase 1, Lagos"), { timeout: 5000 });

    // Cleared on purpose, it stays cleared for the same point.
    fireEvent.change(address, { target: { value: "" } });
    fireEvent.blur(address);
    await new Promise((r) => setTimeout(r, 900));
    expect(valueOf(address)).toBe("");

    fireEvent.change(address, { target: { value: "Gate 2, Admiralty Way" } });
    fireEvent.blur(address);
    fill(dialog, "Latitude", "6.4338");
    fill(dialog, "Longitude", "3.4255");
    await new Promise((r) => setTimeout(r, 900));
    expect(valueOf(address)).toBe("Gate 2, Admiralty Way");
  }, 30000);

  it("a worksite opens with its centre and fence on a map", async () => {
    await signedInAs("cynthia@mycityapp.io", <Worksites />);
    fireEvent.click(await screen.findByText("MyCity Office, Lekki", undefined, { timeout: 5000 }));
    const dialog = await screen.findByRole("dialog", { name: "MyCity Office, Lekki" });
    await waitFor(() => expect(dialog.querySelector("[data-points]")?.getAttribute("data-points")).toBe("6.44700, 3.47200"), { timeout: 5000 });
    expect(within(dialog).getByText("MyCity Office, Lekki: 6.44700, 3.47200")).toBeTruthy();
  }, 30000);
});
