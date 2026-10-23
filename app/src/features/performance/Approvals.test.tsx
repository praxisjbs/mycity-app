// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession, sid } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Performance from "./index";

/**
 * Performance · Goals, Waiting On You on the in-browser mock (docs/guides/performance.md §6.4, §6.7,
 * §10): Operations & People approve the plan stage waiting on them from the card; the CEO opens a
 * plan from its link and sends it back with a reason; the head sees a target change waiting on a key
 * result, with no second Change Target; on a phone the CEO refuses a target change from its card.
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T08:30:00Z"));
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
  return location.module === "performance" ? <Performance tab={location.tab ?? "goals"} id={location.id} /> : null;
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
const contentPlan = sid("perf:plan:content");
const seededChange = sid("perf:change:seed");
type Waiting = { data: Array<{ kind: string; record_id: string; stage_name: string }> };

describe("Performance · Goals, Waiting On You", () => {
  it("Operations & People: the plan stage waiting on them opens its sheet; Approve Plan sends it on to the CEO", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
    const waiting = screen.getByRole("table", { name: "Waiting On You" });
    fireEvent.click(within(waiting).getByText("Content Plan"));
    await settled();
    const sheet = dialog();
    expect(within(sheet).getByText("Tolu Adeyemi")).toBeTruthy();
    expect(within(sheet).getByRole("list", { name: "Plan approval" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    await press(sheet, "Approve Plan");
    // What still waits on them: the mid-quarter scorecard (Scorecards.test.tsx decides it).
    expect(((await api.call("GET /api/v1/performance/approvals")) as Waiting).data.map((r) => r.kind)).toEqual(["scorecard"]);
  }, 30000);

  it("the CEO: a link opens the plan's sheet; Request Changes needs a reason and returns the plan with it", async () => {
    await openAs("ifeoma@mycityapp.io", `/performance?tab=goals&plan=${contentPlan}`);
    const waiting = (await api.call("GET /api/v1/performance/approvals")) as Waiting;
    expect(waiting.data.map((r) => [r.kind, r.stage_name])).toEqual([["target_change", "CEO"], ["plan", "CEO"]]);
    await press(dialog(), "Request Changes");
    const form = dialog();
    await press(form, "Request Changes");
    // The reason is required: nothing is sent without one.
    expect(((await api.call("GET /api/v1/performance/plans/:id", { params: { id: contentPlan } })) as { status: string }).status).toBe("submitted");
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Add the second objective" } });
    await press(dialog(), "Request Changes");
    const plan = (await api.call("GET /api/v1/performance/plans/:id", { params: { id: contentPlan } })) as { status: string; returned_reason: string | null };
    expect(plan).toMatchObject({ status: "returned", returned_reason: "Add the second objective" });
    expect(copyProblems()).toEqual([]);
  }, 30000);

  it("the head: a key result with a change waiting shows it, and offers no second Change Target", async () => {
    const change = (await (async () => {
      await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
      return api.call("GET /api/v1/performance/target-changes/:id", { params: { id: seededChange } });
    })()) as { key_result: { code: string } | null; status: string };
    expect(change.status).toBe("pending");
    fireEvent.click(screen.getAllByText(change.key_result!.code)[0]);
    await settled();
    const sheet = dialog();
    expect(within(sheet).getByText("Change Waiting")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: "Change Target" })).toBeNull();
  }, 30000);

  it("on a phone the CEO's requests are cards; Refuse Change, with a reason, keeps the target", async () => {
    setViewport(390);
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    expect(screen.queryByRole("table", { name: "Waiting On You" })).toBeNull();
    fireEvent.click(screen.getByText(/^Target Change · /));
    await settled();
    const sheet = dialog();
    expect(within(sheet).getByText("Two partner events moved to January")).toBeTruthy();
    await press(sheet, "Refuse Change");
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Keep the quarter's figure" } });
    await press(dialog(), "Refuse Change");
    const after = (await api.call("GET /api/v1/performance/target-changes/:id", { params: { id: seededChange } })) as { status: string };
    expect(after.status).toBe("rejected");
    expect(((await api.call("GET /api/v1/performance/approvals")) as Waiting).data).toEqual([]);
    expect(copyProblems()).toEqual([]);
  }, 30000);
});
