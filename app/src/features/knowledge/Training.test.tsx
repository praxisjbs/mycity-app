// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider, toast } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession, sid } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { TrainingTab } from "./Training";

/**
 * Knowledge Hub · Training on the in-browser mock (docs/guides/knowledge.md §10): the courses with
 * their state, a course with its Items, People, Assignments and Settings; Add Item with Draft
 * Lesson, Publish Course with a signature, Assign Training, Remind Overdue; on a phone a course
 * opens in a sheet (F31). The mock's courses are invented.
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
  window.history.replaceState(null, "", "/knowledge?tab=training");
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

async function signedIn(id: string | null = null) {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <TrainingTab id={id} />
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

/** A Radix menu opens on the pointer going down, as on a real screen. */
const menu = (button: HTMLElement) => fireEvent.pointerDown(button, { button: 0, pointerType: "mouse" });

const open = async (title: string) => {
  fireEvent.click(await screen.findByText(title, {}, { timeout: 5000 }));
  return screen.findByRole("heading", { name: title, level: 2 }, { timeout: 5000 });
};

describe("Knowledge Hub · Training", () => {
  it("lists every course with its state, counts and overdue", async () => {
    await signedIn();
    await screen.findByText("Data Protection Essentials", {}, { timeout: 5000 });
    expect(screen.getByText("Partnership Pipeline")).toBeTruthy();
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(screen.getByText("6 Overdue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New Course" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("opens a course beside the list with its items in order, each with its menu", async () => {
    await signedIn();
    await open("Data Protection Essentials");
    const items = await screen.findByRole("list", { name: "Course Items" }, { timeout: 5000 });
    expect(within(items).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Staff Data Handbook"),
      expect.stringContaining("Why Data Matters"),
      expect.stringContaining("Key Rules"),
      expect.stringContaining("NDPA in Practice"),
    ]);
    expect(within(items).getAllByText(/Video Link|File|Lesson|Course Link/).length).toBe(4);
    expect(screen.getByRole("button", { name: "Actions for Key Rules" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assign Training" })).toBeTruthy();
  }, 30000);

  it("adds a lesson drafted with Draft Lesson, kept beside the editor until Use Lesson", async () => {
    await signedIn();
    await open("Partnership Pipeline");
    menu(await screen.findByRole("button", { name: "Add Item" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Lesson" }));
    const sheet = await screen.findByRole("dialog", { name: "Lesson" }, { timeout: 5000 });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Title" }), { target: { value: "Who Owns a Stage" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Draft Lesson" }));
    fireEvent.change(await within(sheet).findByRole("textbox", { name: "Source Text" }), {
      target: { value: "Every stage has one owner. The owner updates the stage after each meeting. Nobody else moves a partner." },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Draft Lesson" }));
    expect(await within(sheet).findByText("Drafted", {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Use Lesson" }));
    fireEvent.click(await within(sheet).findByRole("button", { name: "Add Item" }));
    const items = await screen.findByRole("list", { name: "Course Items" });
    await waitFor(() => expect(within(items).getByText("Who Owns a Stage")).toBeTruthy(), { timeout: 5000 });
  }, 30000);

  it("refuses a link that is not https on its field, as the contract says", async () => {
    await signedIn();
    await open("Partnership Pipeline");
    menu(await screen.findByRole("button", { name: "Add Item" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Video Link" }));
    const sheet = await screen.findByRole("dialog", { name: "Video Link" }, { timeout: 5000 });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Title" }), { target: { value: "Pipeline Tour" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: /Link/ }), { target: { value: "http://example.com/tour" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add Item" }));
    expect(await within(sheet).findByText("Use an https link", {}, { timeout: 5000 })).toBeTruthy();
  }, 30000);

  it("publishes only with the publisher's signature", async () => {
    await signedIn();
    await open("Partnership Pipeline");
    fireEvent.click(await screen.findByRole("button", { name: "Publish Course" }));
    const sheet = await screen.findByRole("dialog", { name: "Publish Course" }, { timeout: 5000 });
    fireEvent.click(within(sheet).getByRole("button", { name: "Publish Course" }));
    expect(await within(sheet).findByText("Sign in the box", {}, { timeout: 5000 })).toBeTruthy();
  }, 30000);

  it("assigns a published course to everyone with a due date", async () => {
    const said = vi.spyOn(toast, "success");
    await signedIn();
    await open("Platform Walkthrough");
    fireEvent.click(await screen.findByRole("button", { name: "Assign Training" }));
    const sheet = await screen.findByRole("dialog", { name: "Assign Training" }, { timeout: 5000 });
    expect((within(sheet).getByRole("textbox", { name: /Due Within/ }) as HTMLInputElement).value).toBe("30");
    fireEvent.click(within(sheet).getByRole("button", { name: "Assign Training" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign Training" })).toBeNull(), { timeout: 5000 });
    fireEvent.click(screen.getByRole("radio", { name: "Assignments" }));
    expect(await screen.findByText("Everyone", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Withdraw" }).length).toBeGreaterThan(0);
    said.mockRestore();
  }, 30000);

  it("asks who takes it when Pick Who names nobody", async () => {
    await signedIn();
    await open("Customer Service Basics");
    fireEvent.click(await screen.findByRole("button", { name: "Assign Training" }));
    const sheet = await screen.findByRole("dialog", { name: "Assign Training" }, { timeout: 5000 });
    fireEvent.click(within(sheet).getByRole("radio", { name: "Pick Who" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Assign Training" }));
    expect(await within(sheet).findByText("Pick who takes it", {}, { timeout: 5000 })).toBeTruthy();
  }, 30000);

  it("shows where each person stands, and reminds everyone overdue", async () => {
    await signedIn();
    await open("Customer Service Basics");
    fireEvent.click(screen.getByRole("radio", { name: /People/ }));
    expect((await screen.findAllByText("Overdue", {}, { timeout: 5000 })).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Remind Overdue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remind Overdue" }).getAttribute("aria-busy")).toBeNull(), { timeout: 5000 });
  }, 30000);

  it("opens the course a link names (?id=)", async () => {
    await signedIn(sid("training-course:6"));
    expect(await screen.findByRole("heading", { name: "Fire Safety at the Office", level: 2 }, { timeout: 5000 })).toBeTruthy();
  }, 30000);

  it("on a phone, a course opens in a sheet, never below its list (F31)", async () => {
    setViewport(390);
    await signedIn();
    fireEvent.click(await screen.findByText("Fire Safety at the Office", {}, { timeout: 5000 }));
    const sheet = await screen.findByRole("dialog", { name: "Course" }, { timeout: 5000 });
    expect(await within(sheet).findByRole("list", { name: "Course Items" }, { timeout: 5000 })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Assign Training" })).toBeTruthy();
  }, 30000);
});
