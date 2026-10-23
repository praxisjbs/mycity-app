// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Task } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { clear, invalidate } from "@/api/hooks";
import { emitRealtimeForTest } from "@/api/realtime";
import { mockSession, sid } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { CardPills } from "./shared";
import Workspace from "./index";

/**
 * Part 3 of the 23/10 audit on the in-browser mock (docs/guides/workspace.md §6, §10): Projects,
 * a project's page and its board, New Task already in the project, Complete and Reopen; Late
 * Reasons behind the settings icon for its holders only, a reason switched off and one added; the
 * Left pill; a board that follows another person's change; New Event filled with its attendees.
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
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

/** The screen, signed in on the mock: as Cynthia (Operations & People) unless another account is named. */
async function signedIn(screenUnderTest: ReactNode, email = "cynthia@mycityapp.io") {
  mockSession.set(null);
  clear();
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
}

const closed = (name: string) => waitFor(() => expect(screen.queryByRole("dialog", { name })).toBeNull(), { timeout: 5000 });
const inStage = (stage: string, title: string) => within(screen.getByRole("region", { name: stage })).queryByText(title);

describe("projects, late reasons and the live board", () => {
  it("lists the projects, starts one, and its page is a board its New Task adds to", async () => {
    await signedIn(<Workspace tab="projects" id={null} />);
    await screen.findByText("Enugu Launch", undefined, { timeout: 8000 });
    expect(screen.queryByText("Abuja Hub Opening")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /New Project/ })[0]!);
    const form = await screen.findByRole("dialog", { name: "New Project" });
    fireEvent.click(within(form).getByRole("button", { name: "Create Project" }));
    await within(form).findByText(/Name the project|Required/);
    fireEvent.change(within(form).getByRole("textbox", { name: /Name/ }), { target: { value: "Ikeja Pop-Up" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create Project" }));
    await closed("New Project");
  }, 30000);

  it("a project's page: its board, New Task in it, Complete Project and Reopen Project", async () => {
    // The mock's first project, Enugu Launch, by its fixed id.
    await signedIn(<Workspace tab="projects" id={sid("project:0")} />);
    await screen.findByRole("heading", { name: "Enugu Launch" }, { timeout: 8000 });
    await waitFor(() => expect(screen.getAllByRole("region").length).toBeGreaterThanOrEqual(4), { timeout: 8000 });

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    const form = await screen.findByRole("dialog", { name: "New Task" });
    await within(form).findByText("Enugu Launch", undefined, { timeout: 5000 });
    fireEvent.change(within(form).getByRole("textbox", { name: /Task/ }), { target: { value: "Print the Enugu banners" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create Task" }));
    await closed("New Task");
    await waitFor(() => expect(inStage("To Do", "Print the Enugu banners")).toBeTruthy(), { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "Complete Project" }));
    await screen.findByText("Completed", undefined, { timeout: 5000 });
    expect(screen.queryByRole("button", { name: "New Task" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reopen Project" }));
    await screen.findByRole("button", { name: "New Task" }, { timeout: 5000 });
  }, 40000);

  it("Late Reasons sits behind the settings icon for its holders: a reason switched off, one added", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    fireEvent.click(await screen.findByRole("button", { name: "Late Reasons" }, { timeout: 8000 }));
    const sheet = await screen.findByRole("dialog", { name: "Late Reasons" });
    await within(sheet).findByText("Blocked by Another Team", undefined, { timeout: 5000 });
    fireEvent.click(within(sheet).getByRole("switch", { name: /Waiting on Client/ }));
    await waitFor(() => expect(within(sheet).getByRole("switch", { name: /Waiting on Client/ }).getAttribute("aria-checked")).toBe("false"), { timeout: 5000 });
    const on = await api.call("GET /api/v1/tasks/late-reasons");
    expect(on.data.map((r) => r.code)).not.toContain("waiting_on_client");

    fireEvent.change(within(sheet).getByRole("textbox", { name: /Reason/ }), { target: { value: "Power Cut" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add Reason" }));
    await within(sheet).findByText("Power Cut", undefined, { timeout: 5000 });
  }, 30000);

  it("a reader who keeps no reasons sees no settings icon", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />, "chidera@mycityapp.io");
    await screen.findByText("Completed, 30d", undefined, { timeout: 8000 });
    expect(screen.queryByRole("button", { name: "Late Reasons" })).toBeNull();
  }, 30000);

  it("the board follows another person's change as it happens", async () => {
    await signedIn(<Workspace tab="tasks" id={null} />);
    await screen.findByText("Completed, 30d", undefined, { timeout: 8000 });
    await act(async () => {
      await api.call("POST /api/v1/tasks", { body: { title: "Set by someone else just now" } as never });
    });
    expect(screen.queryByText("Set by someone else just now")).toBeNull();
    act(() => emitRealtimeForTest("task.changed", { task_id: "any" }));
    await screen.findByText("Set by someone else just now", undefined, { timeout: 5000 });
  }, 30000);

  it("a card whose lead has left says Left", () => {
    const t = { title: "Return the keys", status: "todo", due_at: null, overdue: false, is_commitment: false, members: [], assignee_left: true, priority: "normal", blocked_reason: null, waiting: false, steps_total: 0, steps_done: 0 } as unknown as Task;
    render(<CardPills t={t} />);
    expect(screen.getByText("Left")).toBeTruthy();
  });

  it("New Event opens filled with the attendees Praxis AI named", async () => {
    const kemi = byKey("kemi")!;
    window.history.replaceState(null, "", `/workspace?tab=calendar&new=1&title=Stand%20walk&attendee_ids=${kemi.employee_id}`);
    await signedIn(<Workspace tab="calendar" id={null} />);
    const form = await screen.findByRole("dialog", { name: "New Event" }, { timeout: 8000 });
    await within(form).findByText(kemi.display_name, undefined, { timeout: 5000 });
  }, 30000);
});

