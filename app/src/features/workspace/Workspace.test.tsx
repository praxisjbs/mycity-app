// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { formatDate, ModalProvider, Toaster } from "@mycity/ui";
import { chooseOption, installMatchMedia, optionLabels, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { clear, invalidate } from "@/api/hooks";
import { dispatch, fail, isoDaysAgo, isoDaysAhead, mockSession, sid } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import Workspace from "./index";

/**
 * My Workspace on the in-browser mock (docs/guides/workspace.md §10, §11): the card's pills for
 * steps, holds, waiting and sharing; New Task for one person, for People and for a Department, and
 * the Lead it offers; Edit Task, an approved commitment's date and Assign To cleared; moving cards,
 * Why Late on Mark Done, Mark Blocked and Clear Blocker; comments newest first with Load More; My
 * Week with Support Needed and Tidy With AI, and Team This Week; the calendar's Week and Day, an
 * invitation answered and an event called off; Today on a phone; a reader who sets nobody work;
 * and a link to a task the reader cannot see.
 */

// Every request the screen sends passes through as it is; a test counts them, or refuses one.
vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

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

/** The screen, signed in on the mock: as Cynthia (Operations & People, with a team) unless another account is named. */
async function signedIn(screenUnderTest: ReactNode, email = "cynthia@mycityapp.io") {
  mockSession.set(null);
  // Nothing one test's reader read is kept for the next (the data client's own sign-out clearing).
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

const idOf = (key: string) => byKey(key)!.employee_id;
/** dd/mm/yyyy, as a person types a date. */
const typed = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** A task set through the API as the signed-in reader, then the board asked again. */
async function arrange(body: Record<string, unknown>) {
  let id = "";
  await act(async () => {
    const t = await api.call("POST /api/v1/tasks", { body: body as never });
    id = t.task_id;
    invalidate("/api/v1/tasks");
  });
  return id;
}
/** The board, once Cynthia's first cards (or, for another reader, the figures above it) are on screen. */
async function board(email?: string, id: string | null = null) {
  await signedIn(<Workspace tab="tasks" id={id} />, email);
  await screen.findByText(email ? "Completed, 30d" : "Confirm Ember to Remember venue list with MTN", undefined, { timeout: 8000 });
}
/** What a panel's Details says beside a label. */
const valueOf = (panel: HTMLElement, label: string) =>
  within(panel)
    .getAllByText(label)
    .map((el) => el.closest("dt"))
    .find(Boolean)!.nextElementSibling!.textContent;
/** A card's own menu on the board, and the stage it sits in. */
async function moveCard(title: string, stage: string, to: string) {
  const card = within(screen.getByRole("region", { name: stage })).getByRole("button", { name: new RegExp(title) }).closest("li")!;
  await userEvent.click(within(card as HTMLElement).getByRole("button", { name: /^Move/ }));
  await userEvent.click(await screen.findByRole("menuitem", { name: to }));
}
const inStage = (stage: string, title: string) => within(screen.getByRole("region", { name: stage })).queryByText(title);
/** The task's panel, opened from its card. */
async function openCard(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }, { timeout: 5000 }));
  const panel = await screen.findByRole("dialog");
  await within(panel).findByText("Waiting On", undefined, { timeout: 5000 });
  return panel;
}
/** New Task, open, with the people reads it waits on settled. */
async function newTask() {
  fireEvent.click(screen.getAllByRole("button", { name: /New Task/ })[0]!);
  const form = await screen.findByRole("dialog", { name: "New Task" });
  await within(form).findByRole("radio", { name: "Shared" }, { timeout: 5000 });
  return form;
}
const named = (form: HTMLElement, title: string) => fireEvent.change(within(form).getByRole("textbox", { name: /Task/ }), { target: { value: title } });
const closed = (name: string) => waitFor(() => expect(screen.queryByRole("dialog", { name })).toBeNull(), { timeout: 5000 });
/** How many writes to a path like this one the screen has sent. */
const posts = (path: RegExp) => vi.mocked(dispatch).mock.calls.filter(([r]) => r.method === "POST" && path.test(r.path)).length;

describe("my workspace", () => {
  it("Today shows the day's four figures, the diary and what the manager set", async () => {
    await signedIn(<Workspace tab="today" id={null} />);
    await screen.findByText("Your Day", undefined, { timeout: 8000 });
    for (const label of ["Due Today", "Overdue", "Meetings", "Clocked In"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("From Your Manager")).toBeTruthy();
    expect(screen.getByText("Recent Activity")).toBeTruthy();
    expect(screen.queryByText("Africa/Lagos")).toBeNull();
  }, 20000);

  it("the board's cards carry steps, holds and waiting; the panel ticks a step and shows what it waits on", async () => {
    await board();
    expect(await screen.findByText("Completed, 30d")).toBeTruthy();
    expect((await screen.findAllByText("2/3")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Blocked")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Waiting")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Overdue \d+ days?$/).length).toBeGreaterThan(0);

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

  it("the list view lists the same tasks as rows, with Show Cancelled beside it", async () => {
    await board();
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    await waitFor(() => expect(screen.getByRole("table", { name: "Tasks" })).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Cancelled" }));
    await screen.findByText("Cancelled", undefined, { timeout: 5000 });
  }, 20000);

  it("Analytics counts the overdue by reason and lists the blocked work", async () => {
    await signedIn(<Workspace tab="analytics" id={null} />);
    await screen.findAllByText("Overdue Tasks by Reason", undefined, { timeout: 8000 });
    expect(screen.getByText("Open Tasks")).toBeTruthy();
    expect(screen.getAllByText("Blocked Work").length).toBeGreaterThan(0);
    expect(screen.getByText("Overdue Aging")).toBeTruthy();
    await screen.findAllByText("Waiting on Others");
    // A reader who sets others work opens on My Team.
    expect(screen.getByRole("radio", { name: "My Team" }).getAttribute("aria-checked")).toBe("true");
  }, 20000);

  it("Analytics' period: This Week runs from Monday; Custom asks for its days, and Cancel keeps the period", async () => {
    await signedIn(<Workspace tab="analytics" id={null} />);
    await screen.findByText("Open Tasks", undefined, { timeout: 8000 });
    const periods = within(screen.getByRole("radiogroup", { name: "Period" })).getAllByRole("radio").map((r) => r.textContent);
    expect(periods).toEqual(["This Week", "30 Days", "90 Days", "This Year", "Custom"]);

    fireEvent.click(screen.getByRole("radio", { name: "This Week" }));
    const today = isoDaysAgo(0);
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const monday = isoDaysAgo(weekday === 0 ? 6 : weekday - 1);
    await screen.findByText(`${formatDate(monday)} to ${formatDate(today)}`);

    // Custom opens its days; Cancel leaves This Week as it was.
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    let sheet = await screen.findByRole("dialog", { name: "Custom Period" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    await closed("Custom Period");
    expect(screen.getByRole("radio", { name: "This Week" }).getAttribute("aria-checked")).toBe("true");

    // To before From is marked on its field, and Show Period shows nothing new.
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    sheet = await screen.findByRole("dialog", { name: "Custom Period" });
    const from = within(sheet).getByRole("textbox", { name: "Period From" });
    const to = within(sheet).getByRole("textbox", { name: "Period To" });
    await userEvent.clear(from);
    await userEvent.type(from, typed(isoDaysAgo(3)));
    await userEvent.clear(to);
    await userEvent.type(to, typed(isoDaysAgo(9)));
    fireEvent.click(within(sheet).getByRole("button", { name: "Show Period" }));
    // The field itself holds To to From or later, in its own words.
    await within(sheet).findByText(`Pick ${formatDate(isoDaysAgo(3))} or later`);
    await userEvent.clear(to);
    await userEvent.type(to, typed(isoDaysAgo(1)));
    fireEvent.click(within(sheet).getByRole("button", { name: "Show Period" }));
    await closed("Custom Period");
    await screen.findByText(`${formatDate(isoDaysAgo(3))} to ${formatDate(isoDaysAgo(1))}`);
    expect(screen.getByRole("radio", { name: "Custom" }).getAttribute("aria-checked")).toBe("true");
    // Change Dates opens them again, as they were picked.
    fireEvent.click(screen.getByRole("button", { name: "Change Dates" }));
    sheet = await screen.findByRole("dialog", { name: "Custom Period" });
    expect((within(sheet).getByRole("textbox", { name: "Period From" }) as HTMLInputElement).value).toBe(typed(isoDaysAgo(3)));
  }, 30000);

  it("Export makes a file of the figures with the period shown, waits for it and downloads it here", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      render(<Toaster />);
      await signedIn(<Workspace tab="analytics" id={null} />);
      await screen.findByText("Open Tasks", undefined, { timeout: 8000 });
      fireEvent.click(screen.getByRole("radio", { name: "90 Days" }));
      fireEvent.keyDown(screen.getByRole("button", { name: "Export" }), { key: "Enter" });
      const menu = await screen.findByRole("menu");
      expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["Export PDF", "Export XLSX"]);
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Export XLSX" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).getAttribute("aria-busy")).toBe("true"));
      // The mock makes the file a few seconds later and holds no bytes, and says so once it is saved.
      await waitFor(
        () => {
          vi.setSystemTime(new Date(Date.now() + 1_000));
          expect(screen.getByText("Files download once the API is connected")).toBeTruthy();
        },
        { timeout: 12000, interval: 250 },
      );
      const runs = await api.call("GET /api/v1/home/report-runs");
      const run = runs.data.reduce((a, b) => (b.number > a.number ? b : a));
      expect(run).toMatchObject({ report_key: "workspace_analytics", report_name: "Workspace Analytics", format: "xlsx", status: "done", emailed_at: null });
      const listed = await api.call("GET /api/v1/home/reports");
      expect(listed.data.some((r) => r.report_key === "workspace_analytics")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  }, 30000);

  it("Export is for holders of workspace export, on a computer", async () => {
    // Chidera is Staff: no export on My Workspace (seed 0290).
    await signedIn(<Workspace tab="analytics" id={null} />, "chidera@mycityapp.io");
    await screen.findByText("Open Tasks", undefined, { timeout: 8000 });
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    cleanup();
    setViewport(390);
    await signedIn(<Workspace tab="analytics" id={null} />);
    await screen.findByText("Open Tasks", undefined, { timeout: 8000 });
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  }, 30000);

  it("a card moves up within its column from its menu", async () => {
    await board();
    const place = () =>
      within(screen.getByRole("region", { name: "To Do" }))
        .getAllByRole("listitem")
        .findIndex((li) => (li.textContent ?? "").includes("Review Partnerships Associate shortlist"));
    const before = place();
    expect(before).toBeGreaterThan(0);
    await moveCard("Review Partnerships Associate shortlist", "To Do", "Move Up");
    await waitFor(() => expect(place()).toBe(before - 1), { timeout: 5000 });
  }, 20000);

  it("a card moves to another column from its menu", async () => {
    await board();
    await moveCard("Onboarding pack for the Enugu hires", "To Do", "Move to In Progress");
    await waitFor(
      () => {
        expect(inStage("In Progress", "Onboarding pack for the Enugu hires")).toBeTruthy();
        expect(inStage("To Do", "Onboarding pack for the Enugu hires")).toBeNull();
      },
      { timeout: 5000 },
    );
  }, 20000);

  it("moving an overdue card to Done asks Why Late first, and Mark Done moves it", async () => {
    await board();
    await arrange({ title: "Send the late minutes", due_on: isoDaysAgo(3) });
    await screen.findByText("Send the late minutes", undefined, { timeout: 5000 });
    await moveCard("Send the late minutes", "To Do", "Move to Done");
    const form = await screen.findByRole("dialog", { name: "Mark Done" });
    fireEvent.click(within(form).getByRole("button", { name: "Mark Done" }));
    await within(form).findByText("Pick a reason");
    await chooseOption(await within(form).findByRole("combobox", { name: /Why Late/ }), "Underestimated");
    fireEvent.click(within(form).getByRole("button", { name: "Mark Done" }));
    await closed("Mark Done");
    await waitFor(() => expect(inStage("Done", "Send the late minutes")).toBeTruthy(), { timeout: 5000 });
  }, 30000);

  it("moving a waiting card asks first: the sheet names what it waits on and sends nothing; Go Ahead then moves it (QA OBS-06)", async () => {
    await board();
    const first = await arrange({ title: "Book the venue", due_on: isoDaysAhead(3) });
    const waits = await arrange({ title: "Send the invitations", due_on: isoDaysAhead(6) });
    await act(async () => {
      await api.call("POST /api/v1/tasks/:id/waiting-on", { params: { id: waits }, body: { depends_on_task_id: first } });
      invalidate("/api/v1/tasks");
    });
    await waitFor(() => expect(within(screen.getByRole("region", { name: "To Do" })).getByRole("button", { name: /Send the invitations/ }).closest("li")!.textContent).toContain("Waiting"), { timeout: 5000 });
    const moves = () => posts(/\/tasks\/[^/]+\/move$/);
    const sent = moves();

    // Open Task opens the task it waits on.
    await moveCard("Send the invitations", "To Do", "Move to In Progress");
    let sheet = await screen.findByRole("dialog", { name: "Waiting On" }, { timeout: 5000 });
    expect(within(sheet).getByText(/Book the venue/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Open Task" }));
    await screen.findByRole("dialog", { name: "Book the venue" }, { timeout: 5000 });
    await userEvent.keyboard("{Escape}");
    await closed("Book the venue");

    // Close leaves it in To Do; nothing was sent.
    await moveCard("Send the invitations", "To Do", "Move to In Progress");
    sheet = await screen.findByRole("dialog", { name: "Waiting On" }, { timeout: 5000 });
    // Its footer's Close; the sheet's corner button is named Close too.
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Close" }).at(-1)!);
    await closed("Waiting On");
    expect(moves()).toBe(sent);
    expect(inStage("To Do", "Send the invitations")).toBeTruthy();

    // Go Ahead: the card goes where it was moved, in one request.
    await moveCard("Send the invitations", "To Do", "Move to In Progress");
    sheet = await screen.findByRole("dialog", { name: "Waiting On" }, { timeout: 5000 });
    fireEvent.click(within(sheet).getByRole("button", { name: "Go Ahead" }));
    const form = await screen.findByRole("dialog", { name: "Go Ahead" });
    fireEvent.click(within(form).getByRole("button", { name: "Go Ahead" }));
    await waitFor(() => expect(inStage("In Progress", "Send the invitations")).toBeTruthy(), { timeout: 5000 });
    expect(moves()).toBe(sent + 1);
  }, 40000);

  it("Add Link never offers a task already waiting on this one, which would make a loop (fault #4 on staging, 27/10/2026)", async () => {
    await board();
    const order = await arrange({ title: "Order the welcome banners", due_on: isoDaysAhead(3) });
    const hang = await arrange({ title: "Hang the welcome banners", due_on: isoDaysAhead(6) });
    await arrange({ title: "Print the welcome cards", due_on: isoDaysAhead(4) });
    await act(async () => {
      await api.call("POST /api/v1/tasks/:id/waiting-on", { params: { id: hang }, body: { depends_on_task_id: order } });
      invalidate("/api/v1/tasks");
    });
    const panel = await openCard("Order the welcome banners");
    fireEvent.click(await within(panel).findByRole("button", { name: "Add Link" }, { timeout: 5000 }));
    const form = await screen.findByRole("dialog", { name: "Wait On Task" });
    fireEvent.change(within(form).getByRole("searchbox"), { target: { value: "welcome" } });
    // The searched page, once it has landed: every row it offers names the word.
    await waitFor(
      () => {
        const offered = within(form).getAllByRole("option").map((o) => o.textContent ?? "");
        expect(offered.length).toBeGreaterThan(0);
        expect(offered.every((t) => t.includes("welcome"))).toBe(true);
      },
      { timeout: 5000 },
    );
    expect(within(form).getByRole("option", { name: /Print the welcome cards/ })).toBeTruthy();
    expect(within(form).queryByRole("option", { name: /Hang the welcome banners/ })).toBeNull();
    expect(within(form).queryByRole("option", { name: /Order the welcome banners/ })).toBeNull();
  }, 30000);

  it("Mark Blocked asks what is blocking it, and Clear Blocker clears it", async () => {
    await board();
    await arrange({ title: "Book the Lekki venue", due_on: isoDaysAhead(5) });
    const panel = await openCard("Book the Lekki venue");
    fireEvent.click(within(panel).getByRole("button", { name: "Mark Blocked" }));
    const form = await screen.findByRole("dialog", { name: "Mark Blocked" });
    fireEvent.change(within(form).getByRole("textbox", { name: /What Is Blocking It/ }), { target: { value: "The venue has not answered" } });
    fireEvent.click(within(form).getByRole("button", { name: "Mark Blocked" }));
    await closed("Mark Blocked");
    await within(panel).findByText("The venue has not answered", undefined, { timeout: 5000 });
    fireEvent.click(within(panel).getByRole("button", { name: "Clear Blocker" }));
    const clear = await screen.findByRole("dialog", { name: "Clear Blocker" });
    expect(within(clear).getByRole("checkbox", { name: "Move it on" })).toBeTruthy();
    fireEvent.click(within(clear).getByRole("button", { name: "Clear Blocker" }));
    await closed("Clear Blocker");
    await within(panel).findByRole("button", { name: "Mark Blocked" }, { timeout: 5000 });
    expect(within(panel).queryByText("The venue has not answered")).toBeNull();
  }, 30000);

  it("the panel offers Set Reminders only on a task with a due date", async () => {
    await board();
    await arrange({ title: "Tidy the shared drive" });
    const panel = await openCard("Tidy the shared drive");
    await userEvent.click(within(panel).getByRole("button", { name: "More Actions" }));
    expect(await screen.findByRole("menuitem", { name: "Send Nudge" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Set Reminders" })).toBeNull();
  }, 20000);

  it("the panel sets a repeat, and says how the task repeats", async () => {
    await board();
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

  it("a repeat on a task with no due date is marked on Repeat, in four words", async () => {
    await board();
    await arrange({ title: "Water the office plants" });
    const panel = await openCard("Water the office plants");
    await userEvent.click(within(panel).getByRole("button", { name: "More Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Set Repeat" }));
    const form = await screen.findByRole("dialog", { name: "Repeat" });
    await chooseOption(within(form).getByRole("combobox", { name: /Repeat/ }), "Monthly");
    fireEvent.click(within(form).getByRole("button", { name: "Save Repeat" }));
    await within(form).findByText("Needs a due date", undefined, { timeout: 5000 });
    expect(within(form).getByRole("combobox", { name: /Repeat/ }).getAttribute("aria-invalid")).toBe("true");
  }, 30000);

  it("New Task sets a task for someone in the reader's team, and it joins the board", async () => {
    await board();
    const form = await newTask();
    // The field follows the reader's team, which the form loads as it opens.
    expect(await within(form).findByText("Assign To")).toBeTruthy();
    named(form, "File the October minutes");
    fireEvent.click(await within(form).findByRole("option", { name: /Bashir Lawal/ }));
    fireEvent.click(within(form).getByRole("button", { name: "Create Task" }));
    await closed("New Task");
    await waitFor(() => expect(inStage("To Do", "File the October minutes")).toBeTruthy(), { timeout: 5000 });
  }, 30000);

  it("Shared with People: Lead offers You and each person picked, and goes back to You when its person is removed", async () => {
    await board();
    expect(screen.getAllByText("Shared +2").length).toBeGreaterThan(0);
    const form = await newTask();
    fireEvent.click(within(form).getByRole("radio", { name: "Shared" }));
    expect(within(form).queryByText("Assign To")).toBeNull();
    // Share With waits on whether the reader sets tasks for others (its own read).
    expect(await within(form).findByText("Share With", undefined, { timeout: 5000 })).toBeTruthy();
    const lead = () => within(form).getByRole("combobox", { name: /Lead/ });
    expect(lead().textContent).toContain("You");
    named(form, "Plan the Ops offsite");
    fireEvent.click(within(form).getByRole("button", { name: "Create Task" }));
    await within(form).findByText("Pick people");
    const people = within(form).getByRole("listbox", { name: "People" });
    fireEvent.click(await within(people).findByRole("option", { name: /Damilola Eke/ }, { timeout: 5000 }));
    fireEvent.click(within(people).getByRole("option", { name: /Musa Olawale/ }));
    await waitFor(async () => expect(await optionLabels(lead())).toEqual(["You", "Damilola Eke", "Musa Olawale"]));
    await chooseOption(lead(), "Damilola Eke");
    expect(lead().textContent).toContain("Damilola Eke");
    fireEvent.click(within(form).getByRole("button", { name: "Remove Damilola Eke" }));
    await waitFor(() => expect(lead().textContent).toContain("You"));
    fireEvent.click(within(form).getByRole("button", { name: "Create Task" }));
    await closed("New Task");
    const card = (await screen.findByText("Plan the Ops offsite", undefined, { timeout: 5000 })).closest("li")!;
    expect(within(card as HTMLElement).getByText("Shared +1")).toBeTruthy();
  }, 30000);

  it("Lead never offers a colleague the reader may not set work for", async () => {
    // Ngozi leads Marketing & Sales; Bashir works there but reports to Cynthia, so he may share it, not lead it.
    await board("ngozi@mycityapp.io");
    const form = await newTask();
    fireEvent.click(within(form).getByRole("radio", { name: "Shared" }));
    const people = within(form).getByRole("listbox", { name: "People" });
    fireEvent.click(await within(people).findByRole("option", { name: /Bashir Lawal/ }, { timeout: 5000 }));
    fireEvent.click(within(people).getByRole("option", { name: /Tobi Ojo/ }));
    await waitFor(async () => expect(await optionLabels(within(form).getByRole("combobox", { name: /Lead/ }))).toEqual(["You", "Tobi Ojo"]));
  }, 30000);

  it("Shared with a Department: the department is searched on the server, then its lead picked from it", async () => {
    await board();
    const form = await newTask();
    fireEvent.click(within(form).getByRole("radio", { name: "Shared" }));
    // Share With waits on whether the reader sets tasks for others (its own read).
    fireEvent.click(await within(form).findByRole("radio", { name: "Department" }, { timeout: 5000 }));
    expect(within(form).queryByText("Lead")).toBeNull();
    const departments = await within(form).findByRole("listbox", { name: "Department" });
    fireEvent.click(await within(departments).findByRole("option", { name: /Operations & People/ }, { timeout: 5000 }));
    await within(form).findByText("Lead");
    named(form, "Count the Yaba stock");
    fireEvent.click(within(form).getByRole("button", { name: "Create Task" }));
    await within(form).findByText("Pick a lead");
    const leads = within(form).getAllByRole("listbox", { name: /Lead/ }).at(-1)!;
    fireEvent.click(await within(leads).findByRole("option", { name: /Musa Olawale/ }, { timeout: 5000 }));
    fireEvent.click(within(form).getByRole("button", { name: "Create Task" }));
    await closed("New Task");
    const card = (await screen.findByText("Count the Yaba stock", undefined, { timeout: 5000 })).closest("li")!;
    expect(within(card as HTMLElement).getByText("Shared +1")).toBeTruthy();
  }, 30000);

  it("Edit Task moves an approved commitment's date into the next month; its original date stays", async () => {
    await board();
    const panel = await openCard("Collect NDPA certificates from 4 staff");
    await within(panel).findByText("Original Date");
    const original = valueOf(panel, "Original Date");
    fireEvent.click(within(panel).getByRole("button", { name: "Edit Task" }));
    const form = await screen.findByRole("dialog", { name: "Edit Task" });
    const next = new Date();
    next.setUTCDate(10);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const day = next.toISOString().slice(0, 10);
    const due = within(form).getByLabelText("Due");
    await userEvent.clear(due);
    await userEvent.type(due, typed(day));
    fireEvent.click(within(form).getByRole("button", { name: "Save Task" }));
    await closed("Edit Task");
    await waitFor(() => expect(valueOf(panel, "Due")).toContain(formatDate(`${day}T12:00:00Z`)), { timeout: 5000 });
    expect(valueOf(panel, "Original Date")).toBe(original);
  }, 30000);

  it("Edit Task with Assign To cleared hands the task back to the reader", async () => {
    await board();
    await arrange({ title: "Hand the keys back", primary_assignee_id: idOf("bashir"), due_on: isoDaysAhead(4) });
    const panel = await openCard("Hand the keys back");
    expect(within(panel).getByText("Bashir Lawal")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Edit Task" }));
    const form = await screen.findByRole("dialog", { name: "Edit Task" });
    fireEvent.click(await within(form).findByRole("button", { name: "Remove Bashir Lawal" }, { timeout: 5000 }));
    fireEvent.click(within(form).getByRole("button", { name: "Save Task" }));
    await closed("Edit Task");
    await within(panel).findByText("Cynthia Osakunih", undefined, { timeout: 5000 });
  }, 30000);

  it("Edit Task with a new title retitles the open panel at once, and again on a second edit", async () => {
    await board();
    await arrange({ title: "Task B", due_on: isoDaysAhead(5) });
    const panel = await openCard("Task B");
    for (const title of ["Task B Edited", "Task B Final"]) {
      fireEvent.click(within(panel).getByRole("button", { name: "Edit Task" }));
      const form = await screen.findByRole("dialog", { name: "Edit Task" });
      fireEvent.change(within(form).getByRole("textbox", { name: /Task/ }), { target: { value: title } });
      fireEvent.click(within(form).getByRole("button", { name: "Save Task" }));
      await closed("Edit Task");
      await screen.findByRole("dialog", { name: title }, { timeout: 5000 });
    }
  }, 30000);

  it("comments show the newest first, with older ones under Load More", async () => {
    await board();
    const id = await arrange({ title: "Gather the venue quotes", due_on: isoDaysAhead(6) });
    await act(async () => {
      for (let n = 1; n <= 26; n += 1) await api.call("POST /api/v1/tasks/:id/comments", { params: { id }, body: { body: `Quote ${n} is in` } });
    });
    const panel = await openCard("Gather the venue quotes");
    fireEvent.click(within(panel).getByRole("radio", { name: /Comments/ }));
    await within(panel).findByText("Quote 26 is in", undefined, { timeout: 5000 });
    expect(within(panel).queryByText("Quote 1 is in")).toBeNull();
    // A paged list settles its first search pause (250 ms) by going to page 1; a person pressing Load More is never that quick.
    await act(() => new Promise((r) => setTimeout(r, 300)));
    fireEvent.click(within(panel).getByRole("button", { name: /Load More/ }));
    await within(panel).findByText("Quote 1 is in", undefined, { timeout: 5000 });
    fireEvent.change(within(panel).getByRole("textbox", { name: /Comment/ }), { target: { value: "All quotes are in" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add Comment" }));
    const newest = await within(panel).findByText("All quotes are in", undefined, { timeout: 5000 });
    expect(newest.compareDocumentPosition(within(panel).getByText("Quote 26 is in")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 40000);

  it("Add Comment: an empty box is marked and sends nothing; a refused comment keeps its words; one press adds exactly one (QA DEF-06)", async () => {
    await board();
    const id = await arrange({ title: "Draft the venue brief", due_on: isoDaysAhead(5) });
    const panel = await openCard("Draft the venue brief");
    fireEvent.click(within(panel).getByRole("radio", { name: /Comments/ }));
    await within(panel).findByText("No comments yet.", undefined, { timeout: 5000 });
    const box = () => within(panel).getByRole("textbox", { name: /Comment/ }) as HTMLTextAreaElement;
    const comments = () => posts(new RegExp(`/tasks/${id}/comments$`));
    const said = (text: string) => within(panel).queryAllByText(text, { selector: "p" });

    // Empty: Required on the box, nothing sent.
    fireEvent.click(within(panel).getByRole("button", { name: "Add Comment" }));
    await within(panel).findByText("Required");
    expect(box().getAttribute("aria-invalid")).toBe("true");
    expect(comments()).toBe(0);

    // Refused: the words stay in the box, to send again.
    const real = vi.mocked(dispatch).getMockImplementation()!;
    let refuse = true;
    vi.mocked(dispatch).mockImplementation((req) => {
      if (refuse && req.method === "POST" && req.path.endsWith(`/tasks/${id}/comments`)) {
        refuse = false;
        return Promise.resolve(fail(503, "UNAVAILABLE", "The hub is busy. Try again."));
      }
      return real(req);
    });
    try {
      fireEvent.change(box(), { target: { value: "Venue confirmed for Friday" } });
      fireEvent.click(within(panel).getByRole("button", { name: "Add Comment" }));
      await waitFor(() => expect(comments()).toBe(1));
      await act(() => new Promise((r) => setTimeout(r, 400)));
      expect(box().value).toBe("Venue confirmed for Friday");
      expect(said("Venue confirmed for Friday")).toHaveLength(0);
    } finally {
      vi.mocked(dispatch).mockImplementation(real);
    }

    // One press, even pressed twice: exactly one comment, and the emptied box is not marked.
    const add = within(panel).getByRole("button", { name: "Add Comment" });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(said("Venue confirmed for Friday")).toHaveLength(1), { timeout: 5000 });
    // Past the form's pause check: still one comment, an empty box and no mark.
    await act(() => new Promise((r) => setTimeout(r, 900)));
    expect(comments()).toBe(2);
    expect(said("Venue confirmed for Friday")).toHaveLength(1);
    expect(box().value).toBe("");
    expect(within(panel).queryByText("Required")).toBeNull();
    const stored = await api.call("GET /api/v1/tasks/:id/comments", { params: { id } });
    expect(stored.data.map((c) => c.body)).toEqual(["Venue confirmed for Friday"]);
  }, 40000);

  it("a link to a task the reader cannot see opens the board with no panel", async () => {
    // TSK-0397 is Ngozi's own, outside Cynthia's team.
    await board(undefined, sid("task:3"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
  }, 20000);

  it("My Week: Write Support Needed, Tidy With AI, Discard Summary and Use Summary; Team This Week opens a person's week", async () => {
    await signedIn(<Workspace tab="today" id={null} />);
    await screen.findByText("My Week", undefined, { timeout: 8000 });
    fireEvent.click(await screen.findByRole("button", { name: "Write Support Needed" }, { timeout: 5000 }));
    let form = await screen.findByRole("dialog", { name: "Support Needed" });
    fireEvent.change(within(form).getByRole("textbox", { name: /Support Needed/ }), { target: { value: "Two more hands on the venue list" } });
    fireEvent.click(within(form).getByRole("button", { name: "Tidy With AI" }));
    await within(form).findByRole("button", { name: "Use Summary" }, { timeout: 5000 });
    fireEvent.click(within(form).getByRole("button", { name: "Discard Summary" }));
    expect((within(form).getByRole("textbox", { name: /Support Needed/ }) as HTMLTextAreaElement).value).toBe("Two more hands on the venue list");
    fireEvent.click(within(form).getByRole("button", { name: "Tidy With AI" }));
    fireEvent.click(await within(form).findByRole("button", { name: "Use Summary" }, { timeout: 5000 }));
    await closed("Support Needed");
    await screen.findByText("Summary", undefined, { timeout: 5000 });
    expect(screen.getAllByText(/Two more hands on the venue list/).length).toBeGreaterThan(0);
    // Team This Week: one row per person in the team; a row opens that person's week.
    const team = await screen.findByRole("table", { name: "Team This Week" }, { timeout: 5000 });
    fireEvent.click(await within(team).findByText("Bashir Lawal"));
    form = await screen.findByRole("dialog", { name: "Bashir Lawal" });
    await within(form).findByText(/^Week of /, undefined, { timeout: 5000 });
  }, 40000);

  it("an empty day on the month asks New Task or New Event, and New Task starts on that day", async () => {
    // Add To Day is offered only from today on, so on a month's last day the month has none: late
    // in a month the clock stands back at its 15th, so days are always left. Never forward: the
    // session an earlier test signed in with would be past its token's time and the page would lock.
    const now = new Date();
    if (now.getDate() > 20) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), 15, 9));
    }
    try {
      await signedIn(<Workspace tab="calendar" id={null} />);
      await screen.findByText("Coming Up", undefined, { timeout: 8000 });
      const days = await screen.findAllByRole("button", { name: /^Add To Day, / });
      fireEvent.click(days[days.length - 1]!);
      const choose = await screen.findByRole("dialog");
      fireEvent.click(within(choose).getByRole("button", { name: /New Task/ }));
      const form = await screen.findByRole("dialog", { name: "New Task" });
      expect(within(form).getByRole("button", { name: "Create Task" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  }, 20000);

  it("New Event offers a reminder, 15 minutes before unless changed", async () => {
    await signedIn(<Workspace tab="calendar" id={null} />);
    await screen.findByText("Coming Up", undefined, { timeout: 8000 });
    fireEvent.click(screen.getAllByRole("button", { name: /New Event/ })[0]!);
    const form = await screen.findByRole("dialog", { name: "New Event" });
    expect(within(form).getByText("Reminder")).toBeTruthy();
    expect(within(form).getByText("15 Minutes Before")).toBeTruthy();
  }, 20000);

  it("the calendar's Week shows seven days, and a day opens Day", async () => {
    await signedIn(<Workspace tab="calendar" id={null} />);
    await screen.findByText("Coming Up", undefined, { timeout: 8000 });
    fireEvent.click(screen.getByRole("radio", { name: "Week" }));
    const days = await screen.findAllByRole("button", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}\/\d{2}$/ }, { timeout: 5000 });
    expect(days).toHaveLength(7);
    const name = days[2]!.textContent!;
    fireEvent.click(days[2]!);
    expect(screen.getByRole("radio", { name: "Day" }).getAttribute("aria-checked")).toBe("true");
    // The day may sit in the month before (the week that straddles a month's first days): its items load first.
    expect((await screen.findAllByText(name, undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(screen.queryByText("Africa/Lagos")).toBeNull();
  }, 20000);

  it("an invitation is accepted and declined; the organiser calls an event off after confirming it by name", async () => {
    await signedIn(<Workspace tab="calendar" id={null} />);
    await screen.findByText("Coming Up", undefined, { timeout: 8000 });
    fireEvent.click((await screen.findAllByRole("button", { name: /Partner pipeline review/ }, { timeout: 5000 }))[0]!);
    let panel = await screen.findByRole("dialog", { name: "Partner pipeline review" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Accept" }, { timeout: 5000 }));
    await waitFor(() => expect(within(panel).queryByRole("button", { name: "Accept" })).toBeNull(), { timeout: 5000 });
    fireEvent.click(within(panel).getByRole("button", { name: "Decline" }));
    await within(panel).findByRole("button", { name: "Accept" }, { timeout: 5000 });
    expect(within(panel).queryByRole("button", { name: "Decline" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Call Off" })).toBeNull();
    fireEvent.click(within(panel).getAllByRole("button", { name: "Close" }).at(-1)!);
    await closed("Partner pipeline review");

    fireEvent.click((await screen.findAllByRole("button", { name: /Panel: Adaeze Nnamdi/ }))[0]!);
    panel = await screen.findByRole("dialog", { name: "Panel: Adaeze Nnamdi" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Call Off" }, { timeout: 5000 }));
    const ask = await screen.findByRole("alertdialog", { name: "Call Off Event" });
    expect(within(ask).getByText("Panel: Adaeze Nnamdi")).toBeTruthy();
    fireEvent.click(within(ask).getByRole("button", { name: "Call Off" }));
    await closed("Panel: Adaeze Nnamdi");
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /Panel: Adaeze Nnamdi/ })).toHaveLength(0), { timeout: 5000 });
  }, 40000);

  it("Today on a phone: Your Day, then My Week, then From Your Manager, the diary and recent activity", async () => {
    setViewport(390);
    await signedIn(<Workspace tab="today" id={null} />);
    await screen.findByText("Your Day", undefined, { timeout: 8000 });
    await screen.findByText("My Week");
    const order = ["Your Day", "My Week", "From Your Manager", "Diary", "Recent Activity"].map((t) => screen.getByText(t));
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 20000);

  it("a reader who sets nobody work sees no Assign To and no My Team", async () => {
    // Chidera reports to Cynthia and has nobody reporting to her.
    await signedIn(<Workspace tab="tasks" id={null} />, "chidera@mycityapp.io");
    await screen.findByText("No Tasks Yet", undefined, { timeout: 8000 });
    expect(screen.queryByRole("radio", { name: "My Team" })).toBeNull();
    const form = await newTask();
    expect(within(form).queryByText("Assign To")).toBeNull();
    fireEvent.click(within(form).getByRole("radio", { name: "Shared" }));
    expect(within(form).queryByText("Lead")).toBeNull();
    expect(within(form).queryByText("Share With")).toBeNull();
  }, 20000);
});
