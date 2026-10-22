// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { ModalProvider } from "@mycity/ui";
import { chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import Workspace from "./index";

/**
 * My Workspace on the in-browser mock (docs/guides/workspace.md §10): the card's pills for steps,
 * holds and waiting; the task panel's steps, waiting on and watchers; Today's four figures; and
 * Analytics' overdue by reason and blocked work.
 */

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => setViewport(1440));
afterEach(() => cleanup());

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function signedIn(screenUnderTest: ReactNode) {
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
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 5000 });
  await act(async () => {
    await auth!.signIn("cynthia@mycityapp.io", "demo1234");
  });
}

describe("my workspace", () => {
  it("Today shows the day's four figures, the diary and what the manager set", async () => {
    await signedIn(<Workspace tab="today" id={null} />);
    await screen.findByText("Your Day", undefined, { timeout: 8000 });
    for (const label of ["Due Today", "Overdue", "Meetings", "Clocked In"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("From Your Manager")).toBeTruthy();
    expect(screen.getByText("Recent Activity")).toBeTruthy();
  }, 20000);

  it("the board's cards carry steps, holds and waiting; the panel ticks a step and shows what it waits on", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    await screen.findByText("Confirm Ember to Remember venue list with MTN", undefined, { timeout: 8000 });
    expect(await screen.findByText("Completed, 30d")).toBeTruthy();
    expect((await screen.findAllByText("2/3")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Blocked")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Waiting")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Review Partnerships Associate shortlist/ }));
    const panel = await screen.findByRole("dialog");
    await within(panel).findByText("Waiting On");
    expect(within(panel).getByText(/Confirm Ember to Remember venue list with MTN/)).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Go Ahead" })).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: /Confirm Ember to Remember/ }));
    await within(screen.getByRole("dialog")).findByText("Holding Up");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Steps 2\/3/ }));
    const tick = await within(screen.getByRole("dialog")).findByRole("checkbox", { name: "Done: Send the final list" });
    fireEvent.click(tick);
    await within(screen.getByRole("dialog")).findByRole("radio", { name: /Steps 3\/3/ });
  }, 30000);

  it("the list view lists the same tasks as rows", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    await screen.findByText("Confirm Ember to Remember venue list with MTN", undefined, { timeout: 8000 });
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    await waitFor(() => expect(screen.getByRole("table", { name: "Tasks" })).toBeTruthy());
  }, 20000);

  it("Analytics counts the overdue by reason and lists the blocked work", async () => {
    await signedIn(<Workspace tab="analytics" id={null} />);
    await screen.findAllByText("Overdue Tasks by Reason", undefined, { timeout: 8000 });
    expect(screen.getByText("Open Tasks")).toBeTruthy();
    expect(screen.getAllByText("Blocked Work").length).toBeGreaterThan(0);
    expect(screen.getByText("Overdue Aging")).toBeTruthy();
    await screen.findAllByText("Waiting on Others");
  }, 20000);
  it("a card moves up within its column from its menu", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    await screen.findByText("Confirm Ember to Remember venue list with MTN", undefined, { timeout: 8000 });
    const todo = screen.getByRole("region", { name: "To Do" });
    const place = () =>
      within(screen.getByRole("region", { name: "To Do" }))
        .getAllByRole("listitem")
        .findIndex((li) => (li.textContent ?? "").includes("Review Partnerships Associate shortlist"));
    const before = place();
    expect(before).toBeGreaterThan(0);
    const card = within(todo).getByRole("button", { name: /Review Partnerships Associate shortlist/ }).closest("li")!;
    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: /^Move/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move Up" }));
    await waitFor(() => expect(place()).toBe(before - 1), { timeout: 5000 });
  }, 20000);

  it("the panel sets a repeat, and says how the task repeats", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    await screen.findByText("Confirm Ember to Remember venue list with MTN", undefined, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: /Approve 5 expense requests/ }));
    const panel = await screen.findByRole("dialog");
    await within(panel).findByText("Waiting On");
    await userEvent.click(within(panel).getByRole("button", { name: "More Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Set Repeat" }));
    const form = await screen.findByRole("dialog", { name: "Repeat" });
    await chooseOption(within(form).getByRole("combobox", { name: /Repeat/ }), "Every Working Day");
    fireEvent.click(within(form).getByRole("button", { name: "Save Repeat" }));
    await screen.findByText("Every working day", undefined, { timeout: 5000 });
  }, 30000);

  it("New Event offers a reminder, 15 minutes before unless changed", async () => {
    await signedIn(<Workspace tab="calendar" id={null} />);
    await screen.findByText("Coming Up", undefined, { timeout: 8000 });
    fireEvent.click(screen.getAllByRole("button", { name: /New Event/ })[0]!);
    const form = await screen.findByRole("dialog", { name: "New Event" });
    expect(within(form).getByText("Reminder")).toBeTruthy();
    expect(within(form).getByText("15 Minutes Before")).toBeTruthy();
  }, 20000);
});
