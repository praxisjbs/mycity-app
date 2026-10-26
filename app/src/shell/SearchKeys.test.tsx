// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";
import { clear, invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { Search } from "./Search";

/**
 * ⌘K by keyboard on the in-browser mock (docs/guides/foundation.md §6.7, QA DEF-02): a person's
 * attendance days are moved through with the arrow keys and Enter opens the day chosen; the days
 * end with All Days of the person, which opens all of theirs on People · Attendance.
 */

installMatchMedia();
afterEach(() => cleanup());

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

/** ⌘K open, signed in as Cynthia (Operations & People, everyone in scope). */
async function signedIn() {
  mockSession.set(null);
  clear();
  invalidate("/api/v1");
  window.history.replaceState(null, "", "/home?tab=overview");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <Search open onClose={() => undefined} />
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn("cynthia@mycityapp.io", "demo1234");
  });
}

/** The search line, a name typed into it and its days come. */
async function typed(name: string) {
  const line = await screen.findByRole("combobox", { name: "Search" }, { timeout: 5000 });
  fireEvent.change(line, { target: { value: name } });
  await screen.findByRole("group", { name: "Attendance Days" }, { timeout: 5000 });
  return line;
}

/** Arrow down from the line until the active option is `option`, then press Enter. */
function choose(line: HTMLElement, option: HTMLElement) {
  for (let i = 0; i < 60; i += 1) {
    if (line.getAttribute("aria-activedescendant") === option.id) {
      fireEvent.keyDown(line, { key: "Enter" });
      return;
    }
    fireEvent.keyDown(line, { key: "ArrowDown" });
  }
  throw new Error(`the arrow keys never reached "${option.textContent}"`);
}

const here = () => window.location.pathname + window.location.search;

describe("⌘K's attendance days by keyboard (QA DEF-02)", () => {
  it("arrows to a day and Enter opens that day", async () => {
    await signedIn();
    const line = await typed("Bashir");
    const days = within(screen.getByRole("group", { name: "Attendance Days" })).getAllByRole("option");
    // The second day listed, so the keys have to move past the first.
    const day = days[1]!;
    expect(day.textContent).toMatch(/Bashir Lawal/);
    expect(day.textContent).toMatch(/(Present|Late|Absent|On Leave|Not Counted) · \d\d\/\d\d\/\d{4}/);
    choose(line, day);
    await waitFor(() => expect(here()).toMatch(/^\/people\?tab=attendance&id=[0-9a-f-]+$/));
  }, 30000);

  it("the days end with All Days of the person, and Enter on it opens all of their days", async () => {
    await signedIn();
    const line = await typed("Bashir");
    const options = within(screen.getByRole("group", { name: "Attendance Days" })).getAllByRole("option");
    expect(options).toHaveLength(4);
    const all = options.at(-1)!;
    expect(all.textContent).toMatch(/All Days of Bashir Lawal/);
    choose(line, all);
    await waitFor(() => expect(here()).toBe(`/people?tab=attendance&person=${byKey("bashir")!.employee_id}`));
  }, 30000);
});
