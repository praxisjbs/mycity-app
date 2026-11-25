// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { session } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import * as prompts from "@/features/attendance/prompts";
import { AcknowledgePrompts, sessionOf } from "./AcknowledgeSheet";

/**
 * The acknowledge sheet on the in-browser mock (docs/guides/policies.md §6.7): once the clock has
 * been answered it shows each version the person owes, one at a time, and Later or Acknowledge
 * moves to the next. Chidera owes the Attendance policy's Version 2 and Data Protection's Version 2.
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

beforeEach(() => setViewport(390));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function signedInAs(email: string) {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <AcknowledgePrompts />
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

/** An access token as the server signs it, carrying the session's id: only its claims matter here. */
const tokenOf = (sid: string) => `head.${btoa(JSON.stringify({ sub: "user", sid, typ: "access" })).replace(/=+$/, "")}.signature`;

/** Reads each version in the order the sheet shows them, Read Full Policy on each (it closes without putting the version off). */
async function readEach(titles: string[]) {
  for (const title of titles) {
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Policy Update" })).getByRole("heading", { level: 3 }).textContent).toBe(title), { timeout: 5000 });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Policy Update" })).getByRole("button", { name: "Read Full Policy" }));
  }
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Policy Update" })).toBeNull(), { timeout: 5000 });
}

/** Long enough for the clock and what is owed to be read, and for the sheet to open if it were going to. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 1500)));

// Read Full Policy changes nothing on the server, so these run before the cases that acknowledge and defer.
describe("once per sign-in (policies.md §6.7)", () => {
  beforeEach(() => sessionStorage.clear());

  it("reads the session from the access token's sid, and nothing from a token without one", () => {
    expect(sessionOf(tokenOf("6f1c2b7e-session"))).toBe("6f1c2b7e-session");
    expect(sessionOf("mock.chidera.lq2x")).toBeNull();
    expect(sessionOf(null)).toBeNull();
  });

  it("a reload in the same sign-in shows nothing again; a new sign-in shows every version still owed", async () => {
    vi.spyOn(prompts, "signInAsked").mockReturnValue(true);
    const token = vi.spyOn(session, "token", "get").mockReturnValue(tokenOf("first-sign-in"));
    await signedInAs("chidera@mycityapp.io");
    await readEach(["Attendance Policy", "Data Protection"]);

    // The page loads again (a refresh, a typed address): the same session, so nothing opens.
    cleanup();
    await signedInAs("chidera@mycityapp.io");
    await settle();
    expect(screen.queryByRole("dialog", { name: "Policy Update" })).toBeNull();

    // Signed in afresh: a new session, and the overdue version is back.
    cleanup();
    token.mockReturnValue(tokenOf("second-sign-in"));
    await signedInAs("chidera@mycityapp.io");
    const sheet = await screen.findByRole("dialog", { name: "Policy Update" }, { timeout: 5000 });
    expect(within(sheet).getByRole("heading", { level: 3 }).textContent).toBe("Attendance Policy");
  }, 30000);

  it("a browser that refuses storage still shows each version once while the page is open", async () => {
    vi.spyOn(prompts, "signInAsked").mockReturnValue(true);
    vi.spyOn(session, "token", "get").mockReturnValue(tokenOf("private-window"));
    // Storage refuses the sheet's reads and writes; the rest of the app's (the mock's session) works as ever.
    const { getItem, setItem } = Storage.prototype;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      if (this === window.sessionStorage && key === "mc-policy-shown") throw new Error("refused");
      return getItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (this === window.sessionStorage && key === "mc-policy-shown") throw new Error("refused");
      setItem.call(this, key, value);
    });
    await signedInAs("chidera@mycityapp.io");
    await readEach(["Attendance Policy", "Data Protection"]);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Policy Update" })).toBeNull();
  }, 30000);
});

describe("the acknowledge sheet", () => {
  it("shows what is owed one at a time, oldest due first, once the clock is answered", async () => {
    // The day's first clock prompt has been asked for, so nothing is left to wait for.
    vi.spyOn(prompts, "signInAsked").mockReturnValue(true);
    await signedInAs("chidera@mycityapp.io");
    const first = await screen.findByRole("dialog", { name: "Policy Update" }, { timeout: 5000 });
    expect(within(first).getByRole("button", { name: "Acknowledge" })).toBeTruthy();
    expect(within(first).getByRole("button", { name: "Read Full Policy" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();

    // The oldest due first: the Attendance policy's version is past its due date, so Later is gone.
    expect(within(first).getByRole("heading", { level: 3 }).textContent).toBe("Attendance Policy");
    expect(within(first).getByText(/^Overdue since \d{2}\/\d{2}\/\d{4}$/)).toBeTruthy();
    expect(within(first).queryByRole("button", { name: "Later" })).toBeNull();
    fireEvent.click(within(first).getByRole("button", { name: "Acknowledge" }));

    // Then Data Protection, still before its due date: Later puts it off until tomorrow.
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Policy Update" })).getByRole("heading", { level: 3 }).textContent).toBe("Data Protection"), { timeout: 5000 });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Policy Update" })).getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
  }, 30000);
});
