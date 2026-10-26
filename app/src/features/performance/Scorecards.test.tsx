// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider, Toaster } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession, sid } from "@/api/mock/core";
import { PEOPLE } from "@/api/mock/data/people";
import { PERIOD, SCORECARDS } from "@/api/mock/data/performance";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import Ess from "@/features/ess";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Performance from "./index";

/**
 * Performance · Scorecards and Goals › Waiting On You on the in-browser mock (docs/guides/
 * performance.md §3.5, §6.7, §10, §11): a scorecard drafted after its plan bound is decided on its
 * own sheet, Operations & People then the CEO; a scorecard's link opens its sheet once and leaves the
 * address, and the person's own opens My Scorecard; the head changes a line's target, which then
 * waits; the employee is offered no Change Target; on a phone a line opens its own sheet.
 */

vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

installMatchMedia();
beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => undefined;
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
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
  if (location.module === "performance") return <Performance tab={location.tab ?? "goals"} id={location.id} />;
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
  const read = (selector: string, limit: number) => {
    for (const el of root.querySelectorAll(selector)) {
      if (el.closest('[data-copy="content"]')) continue;
      const t = el.textContent?.trim() ?? "";
      if (copy.wordCount(t) > limit) problems.push(`${selector} over ${limit} words: "${t}"`);
      const word = copy.titleCaseViolation(t);
      if (word) problems.push(`${selector} not Title Case at "${word}": "${t}"`);
      if (copy.hasDash(t)) problems.push(`${selector} has a dash: "${t}"`);
    }
  };
  read('[data-ui="page-title"]', copy.LIMITS.pageTitle);
  read('[data-ui="title"]', copy.LIMITS.title);
  read('[data-ui="button"]', copy.LIMITS.button);
  read("th", copy.LIMITS.title);
  return problems;
}

/** The one sheet open: a sheet takes the place of the one before it. */
const top = () => screen.getByRole("dialog");
const press = async (root: HTMLElement, name: string | RegExp) => {
  fireEvent.click(within(root).getByRole("button", { name }));
  await settled();
};
const graceCard = sid("perf:card:grace");
const adedotunCard = sid("perf:card:adedotun");
type Waiting = { data: Array<{ kind: string; record_id: string; stage_name: string }> };
type Card = { status: string; lines: Array<{ title: string; can_change_target: boolean; pending_change: { to_value: string | null } | null }> };

describe("Performance · a mid-quarter scorecard, a scorecard's link and a line's Change Target", () => {
  it("Operations & People: the scorecard waits on Goals › Waiting On You, named by its person; Approve Scorecard sends it on to the CEO", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
    const waiting = screen.getByRole("table", { name: "Waiting On You" });
    fireEvent.click(within(waiting).getByText("Scorecard · Grace Okon"));
    await settled();
    const sheet = top();
    expect(within(sheet).getByText("Partner venues signed in Lekki")).toBeTruthy();
    expect(within(sheet).getByRole("list", { name: "Scorecard approval" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Request Changes" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    await press(sheet, "Approve Scorecard");
    expect(screen.getByText("Sent on to CEO")).toBeTruthy();
    expect(((await api.call("GET /api/v1/performance/approvals")) as Waiting).data.map((r) => r.kind)).not.toContain("scorecard");
  }, 30000);

  it("the CEO: its link opens the sheet once and leaves the address; Request Changes needs a reason; Approve Scorecard binds it", async () => {
    await openAs("ifeoma@mycityapp.io", `/performance?tab=targets&id=${graceCard}`);
    expect(window.location.search).not.toContain("id=");
    const sheet = top();
    expect(within(sheet).getByText("Grace Okon")).toBeTruthy();
    await press(sheet, "Request Changes");
    await press(top(), "Request Changes");
    // No reason, nothing sent: it still waits on the CEO.
    expect(((await api.call("GET /api/v1/performance/approvals")) as Waiting).data.find((r) => r.record_id === graceCard)?.stage_name).toBe("CEO");
    await press(top(), "Cancel");
    // The list opens it again.
    fireEvent.click(screen.getByText("Grace Okon"));
    await settled();
    await press(top(), "Approve Scorecard");
    expect(screen.getByText("Scorecard approved")).toBeTruthy();
    expect(((await api.call("GET /api/v1/performance/scorecards/:id", { params: { id: graceCard } })) as Card).status).toBe("binding");
  }, 30000);

  it("the head: Change Target on a line sends it to the CEO; the line then shows Change Waiting and offers no second", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=targets");
    fireEvent.click(screen.getByText("Tobi Ojo"));
    await settled();
    fireEvent.click(within(top()).getByText("Partner launch events held"));
    await settled();
    await press(top(), "Change Target");
    const form = top();
    fireEvent.change(within(form).getByLabelText("New Target"), { target: { value: "4" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Two venues closed for repairs" } });
    expect(copyProblems()).toEqual([]);
    await press(form, "Send Change");
    expect(screen.getByText("Sent to the CEO")).toBeTruthy();
    const sheet = top();
    expect(within(sheet).getByText("Change Waiting")).toBeTruthy();
    fireEvent.click(within(sheet).getByText("Partner launch events held"));
    await settled();
    expect(within(top()).getByText("Change Waiting")).toBeTruthy();
    expect(within(top()).queryByRole("button", { name: "Change Target" })).toBeNull();
    const card = (await api.call("GET /api/v1/performance/scorecards/:id", { params: { id: sid("perf:card:tobi") } })) as Card;
    expect(card.lines.find((l) => l.title === "Partner launch events held")).toMatchObject({ can_change_target: false, pending_change: { to_value: "4" } });
  }, 30000);

  it("the employee: their own link opens My Scorecard and leaves the address; their lines offer no Change Target", async () => {
    await openAs("adedotun@mycityapp.io", `/ess?tab=my-performance&id=${adedotunCard}`);
    expect(window.location.search).not.toContain("id=");
    expect(within(top()).getByText("Brand refresh delivered for the city launches")).toBeTruthy();
    const mine = (await api.call("GET /api/v1/performance/scorecards/:id", { params: { id: adedotunCard } })) as Card;
    expect(mine.lines.every((l) => !l.can_change_target)).toBe(true);
  }, 30000);

  it("the Commitments view offers Export Report only to a reader who may export", async () => {
    await openAs("kemi@mycityapp.io", "/performance?tab=targets&view=commitments");
    expect((await screen.findAllByRole("heading", { name: "Commitments" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Export Report" })).toBeNull();
    cleanup();
    await openAs("cynthia@mycityapp.io", "/performance?tab=targets&view=commitments");
    expect(await screen.findByRole("button", { name: "Export Report" })).toBeTruthy();
  }, 30000);

  it("on a phone: scorecards and lines are cards; a line opens its own sheet with Change Target at its foot", async () => {
    setViewport(390);
    await openAs("ngozi@mycityapp.io", "/performance?tab=targets");
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByText("Adedotun Oyinloye"));
    await settled();
    expect(within(top()).queryByRole("table")).toBeNull();
    fireEvent.click(within(top()).getByText("Brand assets delivered on time"));
    await settled();
    expect(within(top()).getByRole("button", { name: "Change Target" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 30000);

  it("Edit Lines totals each section against its share as weights are typed, by the rule the save is held to (QA OBS-04)", async () => {
    await openAs("ifeoma@mycityapp.io", "/performance?tab=targets");
    // A draft the CEO starts for someone with no scorecard this quarter, outside a function whose plan is with its approvers.
    const someone = PEOPLE.find(
      (p) => p.user_key !== "ifeoma" && p.department !== "Content" && !SCORECARDS.some((c) => c.employee.employee_id === p.employee_id && c.performance_period_id === PERIOD.performance_period_id),
    )!;
    let id = "";
    await act(async () => {
      const made = await api.call("POST /api/v1/performance/scorecards", { body: { employee_id: someone.employee_id, performance_period_id: PERIOD.performance_period_id } as never });
      id = (made as { scorecard_id: string }).scorecard_id;
    });
    window.history.pushState(null, "", `/performance?tab=targets&id=${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settled();
    await press(top(), "Edit Lines");
    const form = top();
    const totals = within(form).getByRole("group", { name: "Section Weights" });
    const tone = (text: string) => within(totals).getByText(text).closest("[data-tone]")?.getAttribute("data-tone");
    // It starts with Accountability's two lines, 10 and 5, which fill its 15.
    expect(tone("Accountability 15 of 15")).toBe("ok");
    expect(tone("Results 0 of 60")).toBe("err");
    expect(tone("KPIs 0 of 25")).toBe("err");
    // A weight typed: the total follows at once, before any save.
    fireEvent.change(within(form).getAllByLabelText("Weight")[0]!, { target: { value: "12.5" } });
    expect(tone("Accountability 17.5 of 15")).toBe("err");
  }, 30000);
});
