// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider, Toaster } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import Ess from "@/features/ess";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Performance from "./index";

/**
 * Performance · Reviews on the in-browser mock, after October's check-in deadline (docs/guides/
 * performance.md §10, §11): the reviewer of a late check-in opens the review without it and chooses
 * Score Without Check-In, with a reason; Operations & People withdraw an open review, with a reason,
 * on a phone; a withdrawn review shows its reason and offers nothing more.
 */

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

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  // October's check-ins were due on 3 November.
  vi.setSystemTime(new Date("2026-11-05T08:30:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  setViewport(1440);
});

/** Waits for every request the screen started, and those their answers start. */
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
  if (location.module === "performance") return <Performance tab={location.tab ?? "reviews"} id={location.id} />;
  if (location.module === "ess") return <Ess tab={location.tab ?? "my-performance"} id={location.id} />;
  return null;
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
          <Toaster />
        </ScreenActionProvider>
      </ModalProvider>
    </AuthProvider>
  </RouterProvider>
);

/** Signs in on the mock and opens the address. */
async function openAs(email: string, address: string) {
  window.history.replaceState(null, "", address);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 5000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  rerender(app(true));
  await settled();
}

/** The copy rules the screen gates hold a screen to, read from what is rendered. */
function copyProblems(root: ParentNode = document.body): string[] {
  const problems: string[] = [];
  const read = (selector: string, limit: number, chrome: boolean) => {
    for (const el of root.querySelectorAll(selector)) {
      if (el.closest('[data-copy="content"]')) continue;
      const t = el.textContent?.trim() ?? "";
      if (copy.wordCount(t) > limit) problems.push(`${selector} over ${limit} words: "${t}"`);
      const word = chrome ? copy.titleCaseViolation(t) : null;
      if (word) problems.push(`${selector} not Title Case at "${word}": "${t}"`);
      if (copy.hasDash(t)) problems.push(`${selector} has a dash: "${t}"`);
    }
  };
  read('[data-ui="page-title"]', copy.LIMITS.pageTitle, true);
  read('[data-ui="page-subtitle"]', copy.LIMITS.pageSubtitle, false);
  read('[data-ui="title"]', copy.LIMITS.title, true);
  read('[data-ui="button"]', copy.LIMITS.button, true);
  read("th", copy.LIMITS.title, true);
  return problems;
}

const dialog = () => screen.getByRole("dialog");
const press = async (root: HTMLElement, name: string | RegExp) => {
  fireEvent.click(within(root).getByRole("button", { name }));
  await settled();
};
type Row = { data: Array<{ performance_review_id: string; status: string }> };
type Detail = { status: string; no_check_in_reason: string | null; withdrawn_reason: string | null; can: Record<string, boolean> };
const reviewOf = async (q: string) => ((await api.call("GET /api/v1/performance/reviews", { query: { q } })) as Row).data[0];

describe("Performance · Reviews, a late check-in and a withdrawn review (§11)", () => {
  it("the reviewer: a late check-in opens without it; Score Without Check-In needs a reason and sends it to the reviewer", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=reviews");
    fireEvent.click(screen.getByText("Tobi Ojo"));
    await settled();
    const sheet = dialog();
    expect(within(sheet).getByText("Waiting for the check-in.")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Submit Review" })).toBeNull();
    expect(copyProblems()).toEqual([]);
    await press(sheet, "Score Without Check-In");
    await press(dialog(), "Score Review");
    // No reason, nothing sent.
    const row = await reviewOf("Tobi");
    expect(row.status).toBe("check_in");
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Nothing in by 3 November" } });
    await press(dialog(), "Score Review");
    expect(screen.getByText("Scoring without the check-in")).toBeTruthy();
    const scored = (await api.call("GET /api/v1/performance/reviews/:id", { params: { id: row.performance_review_id } })) as Detail;
    expect(scored).toMatchObject({ status: "with_reviewer", no_check_in_reason: "Nothing in by 3 November", can: expect.objectContaining({ score: true, score_without_check_in: false }) });
  }, 30000);

  it("Operations & People on a phone: Withdraw Review needs a reason; the review then shows it and offers nothing more", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/performance?tab=reviews");
    expect(screen.queryByRole("table")).toBeNull();
    const row = await reviewOf("Adedotun");
    fireEvent.click(screen.getByText("Adedotun Oyinloye"));
    await settled();
    await press(dialog(), "Withdraw Review");
    await press(dialog(), "Withdraw Review");
    expect(((await api.call("GET /api/v1/performance/reviews/:id", { params: { id: row.performance_review_id } })) as Detail).status).not.toBe("withdrawn");
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Left for the Abuja launch" } });
    await press(dialog(), "Withdraw Review");
    expect(screen.getByText("Review withdrawn")).toBeTruthy();
    const out = (await api.call("GET /api/v1/performance/reviews/:id", { params: { id: row.performance_review_id } })) as Detail;
    expect(out).toMatchObject({ status: "withdrawn", withdrawn_reason: "Left for the Abuja launch" });
    expect(Object.values(out.can).some(Boolean)).toBe(false);
    fireEvent.click(screen.getByText("Adedotun Oyinloye"));
    await settled();
    expect(within(dialog()).getByText("Left for the Abuja launch")).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Withdraw Review" })).toBeNull();
    expect(copyProblems()).toEqual([]);
  }, 30000);
});
