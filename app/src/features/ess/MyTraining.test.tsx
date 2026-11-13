// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession, sid } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { MyTraining } from "./MyTraining";

/**
 * ESS · My Training on the in-browser mock (docs/guides/knowledge.md §6.8, §10): the four lists,
 * a course with its items, an item opened in place (a lesson as text, YouTube through
 * youtube-nocookie.com only on Play), Mark Done and Mark Not Done, Start on a Library course, and
 * Add Proof completing a course that asks for it. Cynthia's own courses are the mock's.
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
  window.history.replaceState(null, "", "/ess?tab=my-training");
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
            <MyTraining id={id} />
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

const list = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const course = async (title: string) => {
  fireEvent.click(await screen.findByText(title, {}, { timeout: 5000 }));
  return screen.findByRole("heading", { name: title, level: 2 }, { timeout: 5000 });
};
const item = async (title: string) => fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }, { timeout: 5000 }));

describe("ESS · My Training", () => {
  it("opens on To Do, due first, and moves between the four lists", async () => {
    await signedIn();
    expect(await screen.findByText("Fire Safety at the Office", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("Not Started")).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
    list("In Progress");
    expect(await screen.findByText("Data Protection Essentials", {}, { timeout: 5000 })).toBeTruthy();
    list("Completed");
    expect(await screen.findByText("Platform Walkthrough", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/^CERT-2026-/)).toBeTruthy();
    list("Library");
    expect(await screen.findByText("Customer Service Basics", {}, { timeout: 5000 })).toBeTruthy();
  }, 30000);

  it("opens an item in place: a lesson as text, then Mark Done and Mark Not Done", async () => {
    await signedIn();
    list("In Progress");
    await course("Data Protection Essentials");
    await item("Key Rules");
    expect(await screen.findByRole("heading", { name: "Why it matters" }, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark Done" }));
    expect(await screen.findByRole("button", { name: "Mark Not Done" }, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark Not Done" }));
    expect(await screen.findByRole("button", { name: "Mark Done" }, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "All Items" })[0]!);
    expect(await screen.findByRole("list", { name: "Course Items" })).toBeTruthy();
  }, 30000);

  it("plays a YouTube video from youtube-nocookie.com, and only once Play Video is pressed", async () => {
    await signedIn();
    list("In Progress");
    await course("Data Protection Essentials");
    await item("Why Data Matters");
    const play = await screen.findByRole("button", { name: "Play Video, Why Data Matters" }, { timeout: 5000 });
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(play);
    await waitFor(() => expect(document.querySelector("iframe")?.getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/M7lc1UVf-VE/));
  }, 30000);

  it("starts a Library course, and completes it with proof once every item is done", async () => {
    await signedIn();
    list("Library");
    await course("Customer Service Basics");
    expect(screen.queryByRole("button", { name: "Mark Done" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start Course" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Start Course" })).toBeNull(), { timeout: 5000 });
    for (const title of ["Customer Service Fundamentals", "Handling a Complaint", "Our Promise"]) {
      await item(title);
      fireEvent.click(await screen.findByRole("button", { name: "Mark Done" }, { timeout: 5000 }));
      await screen.findByRole("button", { name: "Mark Not Done" }, { timeout: 5000 });
      fireEvent.click(screen.getAllByRole("button", { name: "All Items" })[0]!);
    }
    fireEvent.click(await screen.findByRole("button", { name: "Add Proof" }, { timeout: 5000 }));
    const sheet = await screen.findByRole("dialog", { name: "Add Proof" }, { timeout: 5000 });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Certificate Link" }), { target: { value: "http://learn.example.com/c/1" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add Proof" }));
    expect(await within(sheet).findByText("Use an https link", {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Certificate Link" }), { target: { value: "https://learn.example.com/c/1" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add Proof" }));
    expect(await screen.findByRole("heading", { name: "Completed" }, { timeout: 5000 })).toBeTruthy();
  }, 40000);

  it("downloads a completed course's certificate from the list and from the course", async () => {
    const call = vi.spyOn(api, "call");
    await signedIn();
    list("Completed");
    await screen.findByText("Platform Walkthrough", {}, { timeout: 5000 });
    fireEvent.click(screen.getAllByRole("button", { name: "Download Certificate" })[0]!);
    await waitFor(() => expect(call).toHaveBeenCalledWith("POST /api/v1/training/me/courses/:id/certificate", expect.objectContaining({ body: {} })), { timeout: 5000 });
    await course("Platform Walkthrough");
    const done = await screen.findByRole("heading", { name: "Completed", level: 2 }, { timeout: 5000 });
    expect(within(done.closest<HTMLElement>("[data-card]") ?? document.body).getByRole("button", { name: "Download Certificate" })).toBeTruthy();
  }, 30000);

  it("opens the course a task or a notice names, by the course or the person's enrolment (?id=)", async () => {
    await signedIn(sid("training-enrolment:TRN-0006:cynthia"));
    expect(await screen.findByRole("heading", { name: "Fire Safety at the Office", level: 2 }, { timeout: 5000 })).toBeTruthy();
  }, 30000);

  it("Take Notes opens My Notes over the course: saved as typed, kept when closed, and still there when opened again", async () => {
    await signedIn();
    list("In Progress");
    await course("Data Protection Essentials");
    fireEvent.click(screen.getByRole("button", { name: "Take Notes" }));
    const notes = await screen.findByRole("region", { name: "My Notes" }, { timeout: 5000 });
    const box = await within(notes).findByRole("textbox", { name: "My Notes on Data Protection Essentials" });
    await waitFor(() => expect(box.hasAttribute("readonly")).toBe(false), { timeout: 5000 });
    fireEvent.change(box, { target: { value: "Report a lost laptop the same day." } });
    // The course behind it is still open to work in.
    await item("Key Rules");
    expect(await screen.findByRole("heading", { name: "Why it matters" }, { timeout: 5000 })).toBeTruthy();
    await waitFor(() => expect(within(notes).getByRole("status").textContent).toBe("Saved"), { timeout: 5000 });
    // Download Word saves what is typed first, then asks for the note as a Word file.
    const call = vi.spyOn(api, "call");
    fireEvent.change(within(notes).getByRole("textbox"), { target: { value: "Report a lost laptop the same day. Lock it." } });
    fireEvent.click(within(notes).getByRole("button", { name: "Download Word" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("POST /api/v1/training/me/courses/:id/note/export", expect.objectContaining({ body: {} })), { timeout: 5000 });
    const order = call.mock.calls.map(([route]) => route).filter((r) => String(r).includes("/note"));
    expect(order.indexOf("PUT /api/v1/training/me/courses/:id/note")).toBeLessThan(order.indexOf("POST /api/v1/training/me/courses/:id/note/export"));
    call.mockRestore();
    fireEvent.change(within(notes).getByRole("textbox"), { target: { value: "Report a lost laptop the same day." } });
    await waitFor(() => expect(within(notes).getByRole("status").textContent).toBe("Saved"), { timeout: 5000 });
    fireEvent.click(within(notes).getByRole("button", { name: "Minimise Notes" }));
    expect(within(notes).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(notes).getByRole("button", { name: "Close Notes" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "My Notes" })).toBeNull(), { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Take Notes" }));
    expect(await screen.findByDisplayValue("Report a lost laptop the same day.", {}, { timeout: 5000 })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("on a phone, a course opens in a sheet, with Mark Done full width at the foot of its item", async () => {
    setViewport(390);
    await signedIn();
    fireEvent.click(await screen.findByText("Fire Safety at the Office", {}, { timeout: 5000 }));
    const sheet = await screen.findByRole("dialog", { name: "Course" }, { timeout: 5000 });
    fireEvent.click(await within(sheet).findByRole("button", { name: /When the Alarm Sounds/ }, { timeout: 5000 }));
    const done = await within(sheet).findByRole("button", { name: "Mark Done" }, { timeout: 5000 });
    expect(done.className).toContain("w-full");
  }, 30000);

  it("on a phone, My Notes opens inside the course's sheet, docked, and moves to the top with a tap", async () => {
    setViewport(390);
    await signedIn();
    fireEvent.click(await screen.findByText("Fire Safety at the Office", {}, { timeout: 5000 }));
    const sheet = await screen.findByRole("dialog", { name: "Course" }, { timeout: 5000 });
    fireEvent.click(await within(sheet).findByRole("button", { name: "Take Notes" }, { timeout: 5000 }));
    const notes = await within(sheet).findByRole("region", { name: "My Notes" }, { timeout: 5000 });
    expect(notes.className).toContain("bottom-3");
    expect(within(notes).queryByRole("button", { name: "Move Notes" })).toBeNull();
    fireEvent.click(within(notes).getByRole("button", { name: "Move to Top" }));
    expect(notes.className).toContain("top-3");
  }, 30000);
});
