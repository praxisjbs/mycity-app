// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession, sid } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import Queries from "./index";

/**
 * Queries & Sanctions on the in-browser mock (docs/guides/queries.md §6.3, §6.4, §10): a proposed
 * sanction is approved or rejected on the query's card by whoever it waits on, Operations & People
 * signing it; Rules offers only what Rules counts, and a rule opens for Edit Rule. Yusuf's QRY-0009
 * has a Caution Emeka proposed, waiting on Operations & People.
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

async function signedInAs(email: string, tab: string, id: string | null = null) {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <Queries tab={tab} id={id} />
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
}

const YUSUF = sid("qry:9");

describe("Queries & Sanctions · approving a sanction", () => {
  it("shows Approve Sanction and Reject to Operations & People, who sign it", async () => {
    await signedInAs("cynthia@mycityapp.io", "queries", YUSUF);
    expect(await screen.findByText("QRY-0009 · Yusuf Musa")).toBeTruthy();
    expect(screen.getByText("Waiting On")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve Sanction" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Your Signature")).toBeTruthy();
    // Nothing drawn: refused on the pad, before anything is sent.
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve Sanction" }));
    await waitFor(() => expect(within(dialog).getByText("Sign in the box")).toBeTruthy());
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("asks for the reason before a sanction is rejected", async () => {
    await signedInAs("cynthia@mycityapp.io", "queries", YUSUF);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(within(dialog).getByText("Give the reason")).toBeTruthy());
  }, 30000);

  it("shows nothing to approve to someone the sanction does not wait on", async () => {
    await signedInAs("emeka@mycityapp.io", "queries", YUSUF);
    expect(await screen.findByText("QRY-0009 · Yusuf Musa")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve Sanction" })).toBeNull();
  }, 30000);
});

describe("Queries & Sanctions · Rules", () => {
  it("opens a rule for Edit Rule; the form counts no lateness and has no Measure", async () => {
    await signedInAs("cynthia@mycityapp.io", "rules");
    const edit = await screen.findAllByRole("button", { name: "Edit Rule" });
    fireEvent.click(edit[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("What Sets It Off")).toBeTruthy();
    expect(within(dialog).queryByText("Measure")).toBeNull();
    expect((within(dialog).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Low Monthly Score");
    // No policy, so no Clause to quote.
    expect(within(dialog).queryByText("Clause")).toBeNull();
  }, 30000);

  it("shows a rule's Clause once it names a policy, and refuses one over 300 characters", async () => {
    await signedInAs("cynthia@mycityapp.io", "rules");
    // Rules sort by name, so Unregistered Device is the last card.
    const edit = await screen.findAllByRole("button", { name: "Edit Rule" });
    fireEvent.click(edit[edit.length - 1]);
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Unregistered Device");
    const clause = within(dialog).getByRole("textbox", { name: /Clause/ }) as HTMLInputElement;
    expect(clause.value).toBe("Clock in only from a device registered in My Devices.");
    fireEvent.change(clause, { target: { value: "x".repeat(301) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Rule" }));
    await waitFor(() => expect(within(dialog).getByText("At most 300 characters")).toBeTruthy());
  }, 30000);
});
