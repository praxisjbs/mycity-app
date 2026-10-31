// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
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
 * Performance · Reviews and ESS · My Performance on the in-browser mock (docs/guides/performance.md
 * §3.3, §6.12, §10): the round's figures and Waiting On You, a review closed by Operations & People,
 * the reviewer held back until the check-in is in (A17), and the employee's check-in from Save Draft
 * to Submit Check-In, after which the reviewer can score it.
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
  vi.setSystemTime(new Date("2026-11-03T08:30:00Z"));
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

describe("Performance · Reviews", () => {
  it("Operations & People: the round's figures, Waiting On You, and Close Review on a review with HR", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=reviews");
    screen.getByRole("heading", { level: 1, name: "Reviews" });
    for (const t of ["Check-Ins In", "With Reviewers", "With HR", "Closed"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    const waiting = screen.getByRole("table", { name: "Waiting On You" });
    fireEvent.click(within(waiting).getByText("Obinna Ike"));
    await settled();
    expect(within(dialog()).getByText("With HR")).toBeTruthy();
    await press(dialog(), "Close Review");
    const all = (await api.call("GET /api/v1/performance/reviews", { query: { status: "closed" } })) as { data: Array<{ employee: { display_name: string }; rating: string | null }> };
    expect(all.data.map((r) => r.employee.display_name)).toContain("Obinna Ike");
    expect(copyProblems()).toEqual([]);
  }, 30000);

  it("the reviewer sees nothing of a check-in that is not in (A17)", async () => {
    await openAs("ifeoma@mycityapp.io", "/performance?tab=reviews");
    const rows = (await api.call("GET /api/v1/performance/reviews", { query: { q: "Cynthia" } })) as { data: Array<{ performance_review_id: string }> };
    await expect(api.call("GET /api/v1/performance/reviews/:id", { params: { id: rows.data[0].performance_review_id } })).rejects.toMatchObject({ code: "CHECK_IN_FIRST" });
  }, 30000);

  it("Open Round lists a month still running with the day it ends, and sends nothing until one has ended (fault #8 on staging, 27/10/2026)", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=reviews");
    // 3 November: October has its round; November and December are still to end.
    await press(document.body, "Open Round");
    const form = dialog();
    fireEvent.click(within(form).getByRole("combobox", { name: "Month" }));
    const listed = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(listed.map((o) => [o.textContent, o.getAttribute("aria-disabled")])).toEqual([
      ["November 2026 · Ends 30/11/2026", "true"],
      ["December 2026 · Ends 31/12/2026", "true"],
    ]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    const opens = () => vi.mocked(dispatch).mock.calls.filter(([r]) => r.method === "POST" && r.path.endsWith("/performance/rounds")).length;
    const sent = opens();
    await press(form, "Open Round");
    expect(opens()).toBe(sent);
    expect(within(form).getByText("Not ended yet")).toBeTruthy();
  }, 30000);

  it("Close Round gives way to Reopen Round on a closed round, and Reopen Round opens it again", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=reviews");
    const october = async () => ((await api.call("GET /api/v1/performance/rounds", { query: {} })) as { data: Array<{ name: string; status: string }> }).data.find((r) => r.name === "October 2026");
    expect(screen.queryByRole("button", { name: "Reopen Round" })).toBeNull();
    expect((await october())?.status).toBe("open");

    await press(document.body, "Close Round");
    expect((await october())?.status).toBe("closed");
    expect(screen.queryByRole("button", { name: "Close Round" })).toBeNull();
    expect(copyProblems()).toEqual([]);

    await press(document.body, "Reopen Round");
    expect((await october())?.status).toBe("open");
    expect(screen.queryByRole("button", { name: "Reopen Round" })).toBeNull();
    screen.getByRole("button", { name: "Close Round" });
  }, 30000);

  /** What the Department filter offers, in order; null when the screen shows no such filter. */
  const departmentChoices = () => {
    const filter = screen.queryByRole("combobox", { name: "Department" });
    if (!filter) return null;
    fireEvent.click(filter);
    const names = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    return names;
  };

  it("the Department filter offers Operations & People every department", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=reviews");
    expect(departmentChoices()).toEqual(["All Departments", "Content", "Engineering", "Executive", "Finance", "Marketing & Sales", "Operations & People", "Studio", "Support"]);
  }, 30000);

  it("the Department filter offers a manager only the departments of the people they reach", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=reviews");
    expect(departmentChoices()).toEqual(["All Departments", "Finance", "Marketing & Sales", "Studio"]);
  }, 30000);

  it("a member of staff with one department to reach is not offered a Department filter", async () => {
    await openAs("kemi@mycityapp.io", "/performance?tab=reviews");
    expect(screen.getByRole("heading", { level: 1, name: "Reviews" })).toBeTruthy();
    expect(departmentChoices()).toBeNull();
  }, 30000);

  it("opens on the newest round, which the API lists first", async () => {
    const real = vi.mocked(dispatch).getMockImplementation()!;
    vi.mocked(dispatch).mockImplementation(async (req) => {
      const res = await real(req);
      if (req.method !== "GET" || !req.path.endsWith("/performance/rounds")) return res;
      const body = res.body as { data: Array<Record<string, unknown>> };
      const november = { ...body.data[0], performance_cycle_id: "00000000-0000-4000-8000-0000000000b1", name: "November 2026", month: "2026-11-01", close_due_on: "2026-12-11" };
      return { ...res, body: { ...body, data: [november, ...body.data] } };
    });
    try {
      await openAs("cynthia@mycityapp.io", "/performance?tab=reviews");
      expect(screen.getByText(/^November 2026 · closes/)).toBeTruthy();
    } finally {
      vi.mocked(dispatch).mockImplementation(real);
    }
  }, 30000);
});

describe("ESS · My Performance", () => {
  it("the check-in: an actual and its source, Save Draft proposes the score, Submit Check-In sends it to the reviewer", async () => {
    await openAs("cynthia@mycityapp.io", "/ess?tab=my-performance");
    screen.getByRole("heading", { level: 1, name: "My Performance" });
    expect(screen.getByText(/^Your check-in is due /)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Start Check-In" })[0]);
    await settled();
    const sheet = dialog();
    // Each line's Action is dictated with Dictate, named for the field it fills.
    expect(within(sheet).getAllByRole("button", { name: "Record Action" })[0]!.textContent).toContain("Dictate");
    // The first line is the person's own Results line: its actual, and where the figure came from.
    fireEvent.change(within(sheet).getAllByLabelText("Actual")[0], { target: { value: "6" } });
    await chooseOption(within(sheet).getAllByLabelText(/^Evidence/)[0], "Source");
    fireEvent.change(within(sheet).getByLabelText("Source"), { target: { value: "October report" } });
    await press(sheet, "Save Draft");
    const draft = (await api.call("GET /api/v1/ess/performance/check-in")) as { items: Array<{ line: { title: string } | null; proposed_score: string | null; actual_value: string | null }> };
    const stories = draft.items.find((i) => i.line?.title === "Stories published")!;
    expect(stories.actual_value).toBe("6");
    expect(stories.proposed_score).toBe("0.5");
    await press(dialog(), "Submit Check-In");
    const sent = (await api.call("GET /api/v1/ess/performance")) as { check_in: { status: string } | null };
    expect(sent.check_in?.status).toBe("with_reviewer");
    expect(copyProblems()).toEqual([]);
  }, 30000);
});
