// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { atLeast4, NewAnnouncement, pollChoice, pollMarks, refused } from "./index";

/**
 * Staff Community's form rules (docs/guides/community.md §10): a headline, a message or a question
 * says when it is too short, a refused poll's marks land on its own fields, and a channel save's
 * refusal is marked on Purpose (the API's description) or said when no field holds it.
 */

vi.mock("@mycity/ui", async (original) => {
  const ui = await original<typeof import("@mycity/ui")>();
  return { ...ui, toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) };
});

describe("Staff Community's forms", () => {
  it("asks for the text when empty and says it is too short at one to three characters", () => {
    const rule = atLeast4("Add a headline");
    expect(rule("")).toBe("Add a headline");
    expect(rule("Hi")).toBe("At least 4 characters");
    expect(rule("Town hall")).toBeNull();
  });

  it("puts a refused poll's marks on its question and options", () => {
    expect(pollMarks({ body: ["Required"], "options.2": ["At most 80 characters"] })).toEqual({ q: ["Required"], o3: ["At most 80 characters"] });
    // Option 3 left empty is not sent: the API's third option is the form's Option 4.
    expect(pollMarks({ "options.2": ["Already an option"] }, ["o1", "o2", "o4"])).toEqual({ o4: ["Already an option"] });
  });

  it("marks an option that repeats an earlier one as it is filled, the case and spaces ignored", () => {
    const all = { o1: "QA Option A", o2: " qa  option a ", o3: "", o4: "QA Option B" };
    expect(pollChoice(0, "Add an option")(all.o1, all)).toBeNull();
    expect(pollChoice(1, "Add an option")(all.o2, all)).toBe("Already an option");
    expect(pollChoice(2)(all.o3, all)).toBeNull();
    expect(pollChoice(3)(all.o4, all)).toBeNull();
    expect(pollChoice(1, "Add an option")("", { ...all, o2: "" })).toBe("Add an option");
    expect(pollChoice(3)("qa option b", { ...all, o2: "QA Option B", o4: "qa option b" })).toBe("Already an option");
  });

  it("marks Purpose for the API's description, and says a refusal no field holds", async () => {
    const { toast } = await import("@mycity/ui");
    const mark = vi.fn();
    refused(new ApiError(422, { error: { code: "VALIDATION_FAILED", message: "Check the highlighted fields", fields: { description: ["At most 300 characters"] } } }), mark);
    expect(mark).toHaveBeenCalledWith({ purpose: ["At most 300 characters"] });
    refused(new ApiError(429, { error: { code: "RATE_LIMITED", message: "Too many requests. Wait a moment and try again." } }), mark);
    expect(toast.error).toHaveBeenCalledWith("Too many requests. Wait a moment and try again.");
  });
});

describe("New Announcement's Departments (QA audit BG-016, BG-017)", () => {
  let auth: ReturnType<typeof useAuth> | null = null;
  function Harness({ children }: { children?: ReactNode }) {
    auth = useAuth();
    return auth.status === "signed-in" ? <>{children}</> : null;
  }

  it("offers the current departments only, and marks Departments when nobody is in the audience", async () => {
    installMatchMedia();
    setViewport(1440);
    mockSession.set(null);
    invalidate("/api/v1");
    const done = vi.fn();
    render(
      <RouterProvider>
        <AuthProvider>
          <ModalProvider>
            <Harness><NewAnnouncement close={() => {}} done={done} /></Harness>
          </ModalProvider>
        </AuthProvider>
      </RouterProvider>,
    );
    await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
    await act(async () => {
      await auth!.signIn("cynthia@mycityapp.io", "demo1234");
    });
    // A new department nobody is in yet, and one retired: only the first is offered.
    await api.call("POST /api/v1/departments", { body: { name: "Lagos Pop-Up" } as never });
    const old = await api.call("POST /api/v1/departments", { body: { name: "Old Desk" } as never });
    await api.call("PATCH /api/v1/departments/:id", { params: { id: old.department_id }, body: { active: false } as never });
    invalidate("/api/v1/departments");
    fireEvent.change(await screen.findByRole("textbox", { name: "Headline" }, { timeout: 5000 }), { target: { value: "Pop-up briefing" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Friday at noon." } });
    fireEvent.click(screen.getByRole("radio", { name: "Departments" }));
    const chips = await screen.findByRole("group", { name: "Departments" }, { timeout: 5000 });
    fireEvent.click(await within(chips).findByRole("button", { name: "Lagos Pop-Up" }, { timeout: 5000 }));
    expect(within(chips).queryByRole("button", { name: "Old Desk" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Publish Announcement" }));
    expect(await screen.findByText("No one in this audience", {}, { timeout: 5000 })).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
    cleanup();
  }, 40000);
});
