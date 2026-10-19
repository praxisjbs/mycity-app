// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import People from "@/features/people/index";

/**
 * People · Organogram on a phone, on the in-browser mock (docs/guides/organogram.md §10.2): the
 * focus view starts at the top, the CEO; a card left at the top with nobody above it is listed
 * under Also At The Top so it can be reached; and a search lists the matching cards, a tap
 * focusing one.
 */

// Every request the screen makes passes through the mock's dispatch, watched here so a step waits for its reads, not a clock.
vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

installMatchMedia();

afterEach(() => {
  cleanup();
  setViewport(1440);
  window.history.replaceState(null, "", "/people?tab=organogram");
});

/** Waits past the search debounce, then for every request in flight, until answering them starts no new one. */
async function settled() {
  const sent = () => vi.mocked(dispatch).mock.results;
  await act(() => new Promise((r) => setTimeout(r, 300)));
  for (let answered = -1; answered < sent().length; ) {
    answered = sent().length;
    await act(async () => {
      await Promise.allSettled(sent().map((r) => r.value));
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

let auth: ReturnType<typeof useAuth> | null = null;
function Screen() {
  const { location } = useRouter();
  return location.module === "people" ? <People tab={location.tab ?? "organogram"} id={location.id} /> : null;
}
function Harness({ show }: { show: boolean }) {
  auth = useAuth();
  return show && auth.status === "signed-in" ? <Screen /> : null;
}
const app = (show: boolean) => (
  <RouterProvider>
    <AuthProvider>
      <ModalProvider>
        <ScreenActionProvider>
          <Harness show={show} />
        </ScreenActionProvider>
      </ModalProvider>
    </AuthProvider>
  </RouterProvider>
);

/** Signs in on the mock as Operations and opens the Organogram. */
async function organogramAsOperations() {
  window.history.replaceState(null, "", "/people?tab=organogram");
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 5000 });
  await act(async () => {
    const next = await auth!.signIn("cynthia@mycityapp.io", "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  rerender(app(true));
  await settled();
  screen.getByRole("heading", { level: 1, name: "Organogram" });
}

/** The focused card: the one drawn larger and outlined. */
const focusedCard = () => document.querySelector("button.border-2") as HTMLElement | null;
const sectionTitles = () => [...document.querySelectorAll('h2[data-ui="title"]')].map((h) => h.textContent?.trim());

/** The copy rules the screen gates hold a screen to (scripts/check/lib/copy.js), read from what is rendered. */
function copyProblems(): string[] {
  const problems: string[] = [];
  for (const [selector, limit] of [
    ['[data-ui="title"]', copy.LIMITS.title],
    ['[data-ui="button"]', copy.LIMITS.button],
    ['[data-ui="empty-text"]', copy.LIMITS.emptyText],
  ] as const) {
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest('[data-copy="content"]')) continue;
      const t = el.textContent?.trim() ?? "";
      if (copy.wordCount(t) > limit) problems.push(`${selector} over ${limit} words: "${t}"`);
      if (copy.hasDash(t)) problems.push(`${selector} has a dash: "${t}"`);
    }
  }
  return problems;
}

describe("People · Organogram on desktop", () => {
  it("folds an open seat's branch below the second level, and its own toggle unfolds it", async () => {
    setViewport(1440);
    await organogramAsOperations();
    /* The mock's open seat carries a report; put the seat under one of the CEO's people, a level down. */
    const tree = await api.call("GET /api/v1/org-chart", { query: { view: "builder" } });
    const ceo = tree.nodes.find((n) => n.is_ceo)!;
    const seat = tree.nodes.find((n) => n.node_kind === "seat" && tree.nodes.some((m) => m.manager_node_id === n.node_id))!;
    const report = tree.nodes.find((m) => m.manager_node_id === seat.node_id)!;
    const head = tree.nodes.find((n) => n.manager_node_id === ceo.node_id && n.node_kind === "employee")!;
    await act(async () => {
      await api.call("PATCH /api/v1/org-seats/:id", { params: { id: seat.node_id }, body: { line_manager_id: head.employee_id! } });
      invalidate("/api/v1/org-chart");
    });
    await settled();

    const seatCard = screen.getByText(seat.display_name).closest(".og-card") as HTMLElement;
    const unfold = within(seatCard).getByRole("button", { name: "Expand" });
    expect(unfold.textContent).toBe("+1");
    expect(screen.queryByText(report.display_name)).toBeNull();
    fireEvent.click(unfold);
    await settled();
    expect(within(seatCard).getByRole("button", { name: "Collapse" })).toBeTruthy();
    expect(screen.getByText(report.display_name)).toBeTruthy();
  }, 30000);
});

describe("People · Organogram on a phone", () => {
  it("starts on the CEO, lists a card left at the top, and a search lists the cards to tap", async () => {
    setViewport(390);
    await organogramAsOperations();

    expect(within(focusedCard()!).getByText("Ifeoma Chukwu")).toBeTruthy();
    expect(sectionTitles().some((t) => t?.startsWith("Also At The Top"))).toBe(false);

    /* An open role added with no line sits at the top beside the CEO. */
    const departments = await api.call("GET /api/v1/departments");
    await act(async () => {
      await api.call("POST /api/v1/org-seats", { body: { title: "Head of Audit", department_id: departments.data[0].department_id } });
      invalidate("/api/v1/org-chart");
    });
    await settled();
    expect(sectionTitles()).toContain("Also At The Top · 1");
    expect(screen.getByRole("button", { name: /Head of Audit/ })).toBeTruthy();
    expect(copyProblems()).toEqual([]);

    /* A search lists the matching cards, and a tap focuses one and clears the search. */
    const search = screen.getByPlaceholderText("Name or role") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "audit" } });
    await settled();
    expect(sectionTitles()).toContain("Matches · 1");
    fireEvent.click(screen.getByRole("button", { name: /Head of Audit/ }));
    await settled();
    expect(search.value).toBe("");
    expect(within(focusedCard()!).getByText("Head of Audit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Role" })).toBeTruthy();

    /* Show Top goes back to the CEO. */
    fireEvent.click(screen.getByRole("button", { name: "Show Top" }));
    await settled();
    expect(within(focusedCard()!).getByText("Ifeoma Chukwu")).toBeTruthy();

    fireEvent.change(search, { target: { value: "nobody by this name" } });
    await settled();
    expect(screen.getByRole("heading", { name: "No Match" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 30000);
});
