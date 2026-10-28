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
 * Request To Unbind (§6.22): the head asks with a reason in place of New Goal; the CEO refuses on a
 * phone, with a reason the head reads on the plan; asked again and approved, the plan is unbound and
 * New Goal is back; the head's changes go to the CEO alone, and the plan is binding again on approval.
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
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
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
  it("the plan card says which stage a plan awaiting approval is with, so one at Operations & People is not missing from the CEO's list", async () => {
    // Content's plan was sent by its head and waits on Operations & People; the CEO's stage comes after.
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    await chooseOption(screen.getByLabelText("Function"), "Content");
    await settled();
    expect(screen.getByText("With Operations & People")).toBeTruthy();
    expect(screen.queryByText("With CEO")).toBeNull();
    expect(((await api.call("GET /api/v1/performance/approvals")) as Waiting).data.map((r) => r.record_id)).not.toContain(contentPlan);
    expect(copyProblems()).toEqual([]);
  }, 30000);

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

  /** The demonstration function's plan as the API gives it now (not read from the mock's data: that would date its seed before the clock is held). */
  const planNow = async () => {
    const list = (await api.call("GET /api/v1/performance/plans")) as { data: Array<{ performance_plan_id: string; department: string | null }> };
    const id = list.data.find((p) => p.department === "Marketing & Sales")!.performance_plan_id;
    return (await api.call("GET /api/v1/performance/plans/:id", { params: { id } })) as {
      status: string;
      binding_at: string | null;
      returned_reason: string | null;
      unbind: { status: string; reason: string; decision_reason: string | null } | null;
    };
  };
  const header = (name: string | RegExp) => screen.queryAllByRole("button", { name })[0];

  it("Request To Unbind takes New Goal's place on a binding plan: a reason is asked, and the CEO refuses it on a phone with a reason the head reads", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    expect(header("New Goal")).toBeUndefined();
    fireEvent.click(header("Request To Unbind")!);
    await settled();
    const form = dialog();
    expect(within(form).getByText("Marketing & Sales · Q4 2026")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    // Nothing goes without a reason.
    await press(form, "Send Request");
    expect((await planNow()).unbind).toBeNull();
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "A partner programme needs its own objective" } });
    await press(form, "Send Request");
    expect(await planNow()).toMatchObject({ status: "binding", unbind: { status: "pending", reason: "A partner programme needs its own objective" } });
    // The request waits: no second button, and not New Goal either.
    expect(header("Request To Unbind")).toBeUndefined();
    expect(header("New Goal")).toBeUndefined();
    cleanup();

    setViewport(390);
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    fireEvent.click(screen.getByText("Unbind Request · Marketing & Sales"));
    await settled();
    const sheet = dialog();
    expect(within(sheet).getByText("A partner programme needs its own objective")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    await press(sheet, "Refuse Request");
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Not this quarter" } });
    await press(dialog(), "Refuse Request");
    expect(await planNow()).toMatchObject({ status: "binding", unbind: { status: "rejected", decision_reason: "Not this quarter" } });
    cleanup();

    // The head reads why on the plan, and may ask again.
    setViewport(1440);
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    // A head reads their own function alone: no Function to choose, and its plan is the one in view (§6.23).
    expect(screen.queryByLabelText("Function")).toBeNull();
    await settled();
    expect(screen.getByText("Not this quarter")).toBeTruthy();
    expect(header("Request To Unbind")).toBeTruthy();
  }, 60000);

  it("approved, the plan is unbound and New Goal is back; its changes go to the CEO alone and bind the plan again", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    fireEvent.click(header("Request To Unbind")!);
    await settled();
    fireEvent.change(within(dialog()).getByLabelText("Reason"), { target: { value: "Add the partner programme" } });
    await press(dialog(), "Send Request");
    const firstBinding = (await planNow()).binding_at;
    cleanup();

    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    fireEvent.click(screen.getByText("Unbind Request · Marketing & Sales"));
    await settled();
    await press(dialog(), "Approve Request");
    expect(await planNow()).toMatchObject({ status: "unbound", unbind: { status: "approved" } });
    cleanup();

    // Unbound: the head adds again, and the plan card offers Send Plan.
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    expect(header("Request To Unbind")).toBeUndefined();
    expect(header("New Goal")).toBeTruthy();
    await settled();
    expect(screen.getAllByText("Unbound").length).toBeGreaterThan(0);
    await press(document.body, "Send Plan");
    expect(await planNow()).toMatchObject({ status: "revising", approval: { stage_key: "ceo", stage_name: "CEO" } });
    // The card names who it went to.
    expect(screen.getByText("With CEO")).toBeTruthy();
    // It is with the CEO alone, and the head can neither add nor send it again.
    expect(((await api.call("GET /api/v1/performance/approvals")) as Waiting).data).toEqual([]);
    cleanup();

    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    const waiting = screen.getByRole("table", { name: "Waiting On You" });
    fireEvent.click(within(waiting).getByText("Marketing & Sales Plan"));
    await settled();
    expect(within(dialog()).queryByRole("list", { name: "Plan approval" })).toBeTruthy();
    await press(dialog(), "Approve Plan");
    // Binding again, its first approval date kept.
    expect(await planNow()).toMatchObject({ status: "binding", binding_at: firstBinding, returned_reason: null });
    cleanup();

    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    expect(header("Request To Unbind")).toBeTruthy();
    expect(header("New Goal")).toBeUndefined();
  }, 90000);
});
