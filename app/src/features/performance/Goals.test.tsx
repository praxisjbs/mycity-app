// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { chooseOption, installMatchMedia, optionLabels, setViewport } from "@mycity/ui/testing";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession, sid } from "@/api/mock/core";
import { deptId, OBJECTIVES, ORG_GOALS } from "@/api/mock/data/performance";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Performance from "./index";

/**
 * Performance · Goals, set and changed on screen, on the in-browser mock (docs/guides/performance.md
 * §3.1, §3.2, §3.5, §6.7, §10): Operations & People set up Q1 2027 from ⌘K in October, its rules copied
 * and changed, each checked on its field; the CEO edits and deletes a draft objective and key result
 * with every field of the form, each delete confirmed by name; the owner sets a TBC target in place
 * before its lock date and is offered Change Target after it; the CEO edits a goal's quarterly target
 * and deletes a goal; on a phone figures read as people write them.
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

/** Signs in on the mock and opens the address; `before` runs signed in, before the screen opens. */
async function openAs(email: string, address: string, before?: () => Promise<void>) {
  window.history.replaceState(null, "", address);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  if (before) await act(before);
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
  read("label", copy.LIMITS.fieldLabel, false);
  read("th", copy.LIMITS.title, true);
  return problems;
}

/** The dialog on top. */
const dialog = () => screen.getAllByRole("dialog").at(-1)!;
/** The confirmation above it. */
const asked = () => screen.getByRole("alertdialog");
const press = async (root: HTMLElement, name: string | RegExp) => {
  fireEvent.click(within(root).getByRole("button", { name }));
  await settled();
};
const type = (root: HTMLElement, label: string | RegExp, value: string) => fireEvent.change(within(root).getByLabelText(label), { target: { value } });
const valueOf = (root: HTMLElement, label: string | RegExp) => (within(root).getByLabelText(label) as HTMLInputElement).value;
const status = async (call: Promise<unknown>) => {
  try {
    await call;
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : 0;
  }
};
const quarter = sid("perf:period:q4-2026");

type Period = { performance_period_id: string; name: string; starts_on: string; status: string; rules: { bands: { meets: number }; sections: Record<string, number> } };

describe("Performance · Goals, set and changed on screen", () => {
  it("New Goal asks for no Goal ID: the CEO's goal is given the next of its year (JBS Praxis, 27/10/2026)", async () => {
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    fireEvent.click(screen.getAllByRole("button", { name: /New Goal/ })[0]!);
    await settled();
    const form = dialog();
    expect(valueOf(form, "What")).toBe("goal");
    expect(within(form).queryByLabelText(/Goal ID/)).toBeNull();
    type(form, "Goal", "Open in four more cities");
    const before = ORG_GOALS.length;
    await press(form, "Record Goal");
    expect(ORG_GOALS.length).toBe(before + 1);
    // The demo's year holds ORG-2026-01 to ORG-2026-03.
    expect(ORG_GOALS.at(-1)).toMatchObject({ code: "ORG-2026-04", title: "Open in four more cities" });
  }, 60000);

  it("New Objective marks a function whose plan is binding as it is picked, and sends nothing (QA DEF-10)", async () => {
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    fireEvent.click(screen.getAllByRole("button", { name: /New Goal/ })[0]!);
    await settled();
    const form = dialog();
    await chooseOption(within(form).getByLabelText("What"), "Objective");
    await settled();
    await chooseOption(within(form).getByLabelText("Function"), "Marketing & Sales · Binding");
    expect(within(form).getByText("Plan is binding")).toBeTruthy();
    type(form, "Objective", "QA objective on a binding plan");
    const before = OBJECTIVES.length;
    await press(form, "Set Objective");
    expect(OBJECTIVES.length).toBe(before);
    expect(within(dialog()).getByText("Plan is binding")).toBeTruthy();
    expect(valueOf(dialog(), "Objective")).toBe("QA objective on a binding plan");
  }, 60000);

  it("New Objective offers Operations & People every function and never the company: what the server says they may set (QA DEF-10)", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
    fireEvent.click(screen.getAllByRole("button", { name: /New Goal/ })[0]!);
    await settled();
    const form = dialog();
    await chooseOption(within(form).getByLabelText("What"), "Objective");
    await settled();
    const offered = await optionLabels(within(form).getByLabelText("Function"));
    expect(offered).not.toContain("Company");
    expect(offered).toEqual(expect.arrayContaining(["Engineering", "Finance", "Marketing & Sales · Binding"]));
  }, 60000);

  it("a head whose plan is binding is offered Request To Unbind in place of New Goal; New KPI offers their own function alone (QA DEF-11, JBS Praxis 27/10/2026)", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    expect(screen.queryByRole("button", { name: "New Goal" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Request To Unbind" })[0]!);
    await settled();
    const request = dialog();
    expect(within(request).getByText("Marketing & Sales · Q4 2026")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    fireEvent.click(within(request).getByRole("button", { name: "Cancel" }));
    await settled();
    window.history.replaceState(null, "", "/performance?tab=kpis");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settled();
    fireEvent.click((await screen.findAllByRole("button", { name: /New KPI/ }, { timeout: 5000 }))[0]!);
    await settled();
    const form = dialog();
    expect(await optionLabels(within(form).getByLabelText("Function"))).toEqual(["Marketing & Sales"]);
    expect(valueOf(form, "Function")).toBe(deptId);
  }, 60000);

  it("a plan awaiting approval takes a new objective into the plan sent, which stays with its approvers (JBS Praxis, 27/10/2026)", async () => {
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    fireEvent.click(screen.getAllByRole("button", { name: /New Goal/ })[0]!);
    await settled();
    const form = dialog();
    await chooseOption(within(form).getByLabelText("What"), "Objective");
    await settled();
    // Content's plan is sent: its option says nothing of it, and picking it is not refused.
    expect(await optionLabels(within(form).getByLabelText("Function"))).toContain("Content");
    await chooseOption(within(form).getByLabelText("Function"), "Content");
    type(form, "Objective", "Publish a weekly city guide");
    await press(form, "Set Objective");
    const sent = sid("perf:plan:content");
    const plan = (await api.call("GET /api/v1/performance/plans/:id", { params: { id: sent } })) as { status: string; objective_count: number; workflow_instance_id: string | null; can_submit: boolean };
    expect(plan).toMatchObject({ status: "submitted", objective_count: 1, workflow_instance_id: sid("perf:wf:plan:content"), can_submit: false });
    expect(OBJECTIVES.at(-1)).toMatchObject({ title: "Publish a weekly city guide", plan_status: "submitted" });
    // The head's own edit and delete are open on it too; the last objective of a sent plan is kept.
    const mine = OBJECTIVES.at(-1)!.okr_objective_id;
    const read = (await api.call("GET /api/v1/performance/objectives/:id", { params: { id: mine } })) as { can_edit: boolean };
    expect(read.can_edit).toBe(true);
    expect(await status(api.call("PATCH /api/v1/performance/objectives/:id", { params: { id: mine }, body: { title: "Publish a city guide each week" } }))).toBe(200);
    expect(await status(api.call("DELETE /api/v1/performance/objectives/:id", { params: { id: mine } }))).toBe(409);
  }, 60000);

  it("Operations & People keep New Goal while a plan can take one and are offered Request To Unbind for a binding function they pick; the CEO is never offered it", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
    expect(screen.getAllByRole("button", { name: "New Goal" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Request To Unbind" })).toBeNull();
    // A binding function in view takes no goal: Request To Unbind is its button.
    await chooseOption(screen.getByLabelText("Function"), "Marketing & Sales");
    await settled();
    expect(screen.queryByRole("button", { name: "New Goal" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Request To Unbind" })[0]!);
    await settled();
    expect(within(dialog()).getByText("Marketing & Sales · Q4 2026")).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await settled();
    // A function whose plan is not binding is back to New Goal.
    await chooseOption(screen.getByLabelText("Function"), "Content");
    await settled();
    expect(screen.getAllByRole("button", { name: "New Goal" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Request To Unbind" })).toBeNull();
    cleanup();

    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    expect(screen.getAllByRole("button", { name: "New Goal" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Request To Unbind" })).toBeNull();
  }, 60000);

  it("only the CEO is left out of Request To Unbind: the build account, which holds goals.organisation too, is offered it on a binding plan (JBS Praxis, 27/10/2026)", async () => {
    // The Operations demo account, given the one capability the Implementation Team holds that it does not: not the CEO.
    const real = vi.mocked(dispatch).getMockImplementation()!;
    vi.mocked(dispatch).mockImplementation(async (req) => {
      const res = await real(req);
      if (req.method !== "GET" || !req.path.endsWith("/auth/me")) return res;
      const me = res.body as { capabilities: string[] };
      return { ...res, body: { ...me, capabilities: [...me.capabilities, "goals.organisation"] } };
    });
    try {
      await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
      await chooseOption(screen.getByLabelText("Function"), "Marketing & Sales");
      await settled();
      expect(screen.queryByRole("button", { name: "New Goal" })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Request To Unbind" }).length).toBeGreaterThan(0);
    } finally {
      vi.mocked(dispatch).mockImplementation(real);
    }
  }, 60000);

  it("Operations & People set up Q1 2027 from ⌘K in October: the rules start as Q4's, and each is checked on its field", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=goals&action=quarter");
    let wizard = dialog();
    expect(valueOf(wizard, /^Starts/)).toBe("01/01/2027");
    expect(valueOf(wizard, "Ends")).toBe("31/03/2027");
    expect(copyProblems()).toEqual([]);
    await press(wizard, "Next");

    // Bands: Meets under Partly Meets is refused on its field, and the step waits.
    wizard = dialog();
    expect(valueOf(wizard, "Meets From")).toBe("0.75");
    type(wizard, "Meets From", "0.4");
    await press(wizard, "Next");
    expect(within(dialog()).getByText("Must exceed Partly Meets")).toBeTruthy();
    type(dialog(), "Meets From", "0.8");
    await press(dialog(), "Next");
    await press(dialog(), "Next");
    await press(dialog(), "Next");

    // Section Weights must total 100.
    wizard = dialog();
    type(wizard, "Results", "50");
    await press(wizard, "Set Up Quarter");
    expect(within(dialog()).getByText("Sections must total 100")).toBeTruthy();
    type(dialog(), "KPIs", "35");
    await press(dialog(), "Set Up Quarter");

    const periods = (await api.call("GET /api/v1/performance/periods")) as { data: Period[] };
    const q1 = periods.data.find((p) => p.starts_on === "2027-01-01");
    expect(q1).toMatchObject({ name: "Q1 2027", status: "planning", rules: { bands: { meets: 0.8 }, sections: { results: 50, kpis: 35, accountability: 15 } } });
    // The screen moves to the new quarter.
    expect(screen.getByText(/Q1 2027 · 01\/01\/2027 to 31\/03\/2027/)).toBeTruthy();
  }, 60000);

  it("the CEO edits a draft objective and key result with every field, and deletes each after a confirmation naming it", async () => {
    const made: { objective?: string; kr?: string } = {};
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals", async () => {
      const o = (await api.call("POST /api/v1/performance/objectives", { body: { performance_period_id: quarter, title: "One trusted view" } })) as { okr_objective_id: string };
      const k = (await api.call("POST /api/v1/performance/key-results", { body: { okr_objective_id: o.okr_objective_id, statement: "Monthly active users", target_value: "64000", unit: "users" } })) as { okr_key_result_id: string };
      made.objective = o.okr_objective_id;
      made.kr = k.okr_key_result_id;
    });
    // The card offers its menu; the binding function objectives do not.
    expect(screen.getByRole("button", { name: "CO-O1 Actions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "BM-O1 Actions" })).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "CO-O1 Actions" }), { button: 0, pointerType: "mouse" });
    await settled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit Objective" }));
    await settled();
    type(dialog(), "Objective", "One trusted view of the city");
    await press(dialog(), "Save Objective");
    expect(((await api.call("GET /api/v1/performance/objectives/:id", { params: { id: made.objective! } })) as { title: string }).title).toBe("One trusted view of the city");

    // The key result's panel: Edit Key Result opens the whole form, More closed until pressed.
    fireEvent.click(screen.getByText("CO-KR1.1"));
    await settled();
    let panel = dialog();
    expect(within(panel).getByText("64,000 users")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Change Target" })).toBeNull();
    await press(panel, "Edit Key Result");
    const form = dialog();
    expect(within(form).queryByLabelText(/^Feeds/)).toBeNull();
    expect(within(form).getByLabelText(/^Baseline/).closest("[hidden]")).not.toBeNull();
    type(form, /^Target in Words/, "64,000 monthly users");
    fireEvent.click(within(form).getByRole("checkbox", { name: "Target to be confirmed" }));
    await press(form, "More");
    expect(within(form).getByText("Scored From")).toBeTruthy();
    type(form, /^Baseline/, "38,000 in Q3");
    type(form, /^Owner Note/, "CEO with interim finance owner");
    expect(copyProblems()).toEqual([]);
    await press(form, "Save Key Result");
    const saved = (await api.call("GET /api/v1/performance/key-results/:id", { params: { id: made.kr! } })) as { target_text: string; target_provisional: boolean; baseline_text: string; accountable_note: string };
    expect(saved).toMatchObject({ target_text: "64,000 monthly users", target_provisional: true, baseline_text: "38,000 in Q3", accountable_note: "CEO with interim finance owner" });

    // Delete Key Result asks once, naming it; Cancel keeps it.
    panel = dialog();
    await press(panel, "Delete Key Result");
    expect(within(asked()).getByText(/CO-KR1\.1 · Monthly active users/)).toBeTruthy();
    await press(asked(), "Cancel");
    expect(await status(api.call("GET /api/v1/performance/key-results/:id", { params: { id: made.kr! } }))).toBe(200);
    await press(dialog(), "Delete Key Result");
    await press(asked(), "Delete Key Result");
    expect(await status(api.call("GET /api/v1/performance/key-results/:id", { params: { id: made.kr! } }))).toBe(404);
    cleanup();

    // ⌘K opens the objective's sheet; Delete Objective asks, naming it.
    await openAs("ifeoma@mycityapp.io", `/performance?tab=goals&objective=${made.objective}`);
    const sheet = dialog();
    expect(within(sheet).getByText("CO-O1 · One trusted view of the city")).toBeTruthy();
    await press(sheet, "Delete Objective");
    expect(within(asked()).getByText("CO-O1 · One trusted view of the city")).toBeTruthy();
    await press(asked(), "Delete Objective");
    expect(await status(api.call("GET /api/v1/performance/objectives/:id", { params: { id: made.objective! } }))).toBe(404);
  }, 60000);

  it("⌘K opens a function's key result; its form offers Feeds, the company's key results picked from the server", async () => {
    const made: { kr?: string } = {};
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals", async () => {
      const company = (await api.call("POST /api/v1/performance/objectives", { body: { performance_period_id: quarter, title: "Grow the city's reach" } })) as { okr_objective_id: string };
      await api.call("POST /api/v1/performance/key-results", { body: { okr_objective_id: company.okr_objective_id, statement: "Reach 64,000 users", target_value: "64000" } });
      // The function's Q4 plan is binding: its next quarter's is a draft.
      const next = (await api.call("POST /api/v1/performance/periods", { body: { starts_on: "2027-04-01" } })) as { performance_period_id: string };
      const fn = (await api.call("POST /api/v1/performance/objectives", { body: { performance_period_id: next.performance_period_id, department_id: deptId, title: "Own the city's stories" } })) as { okr_objective_id: string };
      const k = (await api.call("POST /api/v1/performance/key-results", { body: { okr_objective_id: fn.okr_objective_id, statement: "Publish 40 stories" } })) as { okr_key_result_id: string };
      made.kr = k.okr_key_result_id;
    });
    cleanup();
    await openAs("ifeoma@mycityapp.io", `/performance?tab=goals&id=${made.kr}`);
    await press(dialog(), "Edit Key Result");
    const form = dialog();
    expect(within(form).getByText("Feeds")).toBeTruthy();
    await press(form, "More");
    expect(within(form).queryByText("Scored From")).toBeNull();
    const refs = (await api.call("GET /api/v1/performance/key-results", { query: { period_id: quarter, level: "company" } })) as { data: Array<{ code: string }> };
    expect(refs.data.map((r) => r.code)).toContain("CO-KR1.1");
  }, 60000);

  it("the owner sets a TBC target in place before its lock date; after it, Change Target is the way", async () => {
    const k = OBJECTIVES.flatMap((o) => o.key_results).find((x) => x.code === "BM-KR2.1")!;
    const was = { provisional: k.target_provisional, locked: k.target_locked_at, value: k.target_value };
    k.target_provisional = true;
    k.target_locked_at = null;
    try {
      await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
      fireEvent.click(screen.getByText("BM-KR2.1"));
      await settled();
      let panel = dialog();
      expect(within(panel).queryByRole("button", { name: "Change Target" })).toBeNull();
      await press(panel, "Set Target");
      type(dialog(), /^Target$/, "15");
      await press(dialog(), "Set Target");
      const after = (await api.call("GET /api/v1/performance/key-results/:id", { params: { id: k.okr_key_result_id } })) as { target_value: string; target_provisional: boolean; can_set_target: boolean };
      expect(after).toMatchObject({ target_value: "15", target_provisional: true, can_set_target: true });
      expect(await status(api.call("POST /api/v1/performance/target-changes", { body: { okr_key_result_id: k.okr_key_result_id, to_value: "20", from_month: "2026-11-01", reason: "More" } }))).toBe(409);
      cleanup();

      // The lock date has passed.
      vi.setSystemTime(new Date("2026-11-02T08:30:00Z"));
      await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
      fireEvent.click(screen.getByText("BM-KR2.1"));
      await settled();
      panel = dialog();
      expect(within(panel).queryByRole("button", { name: "Set Target" })).toBeNull();
      expect(within(panel).getByRole("button", { name: "Change Target" })).toBeTruthy();
    } finally {
      vi.setSystemTime(new Date("2026-10-23T08:30:00Z"));
      Object.assign(k, { target_provisional: was.provisional, target_locked_at: was.locked, target_value: was.value });
    }
  }, 60000);

  it("the CEO opens a goal from ⌘K, edits its quarter's target, and deletes it; one a company objective serves stays", async () => {
    const goal = sid("perf:goal:ORG-2026-03");
    await openAs("ifeoma@mycityapp.io", `/performance?tab=goals&goal=${goal}`);
    let sheet = dialog();
    expect(within(sheet).getByText(/Operate in 12 Nigerian cities/)).toBeTruthy();
    await press(sheet, "Edit Goal");
    const form = dialog();
    type(form, /^Q4 2026 Target/, "10 cities");
    type(form, /^Description/, "Lagos, Abuja and the South West first");
    await press(form, "Save Goal");
    sheet = dialog();
    expect(within(sheet).getByText("10 cities")).toBeTruthy();
    expect(within(sheet).getByText("Lagos, Abuja and the South West first")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    await press(sheet, "Delete Goal");
    expect(within(asked()).getByText(/ORG-2026-03 · Operate in 12 Nigerian cities/)).toBeTruthy();
    await press(asked(), "Delete Goal");
    expect(await status(api.call("GET /api/v1/performance/goals/:id", { params: { id: goal } }))).toBe(404);

    // A goal a company objective serves is refused.
    const served = sid("perf:goal:ORG-2026-02");
    await act(async () => {
      await api.call("POST /api/v1/performance/objectives", { body: { performance_period_id: quarter, title: "Sign the partners", organisational_goal_id: served } });
    });
    expect(await status(api.call("DELETE /api/v1/performance/goals/:id", { params: { id: served } }))).toBe(409);
  }, 60000);

  it("the head reports the month: a figure goes in as typed, and one the contract refuses is marked on its field, never sent (fault #1, 23/10/2026)", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals&action=report");
    const reports = () => vi.mocked(dispatch).mock.calls.filter(([r]) => r.method === "POST" && r.path.endsWith("/performance/reports"));
    const [users, stories] = within(dialog()).getAllByLabelText(/^Actual/) as HTMLInputElement[];

    // Written as the screen shows it: the comma never gets in, a minus does. The figures sent at the
    // end are the month's own, so the tests after this one read October as it was.
    fireEvent.change(users!, { target: { value: "−5" } });
    expect(users!.value).toBe("-5");
    fireEvent.change(users!, { target: { value: "38,400" } });
    expect(users!.value).toBe("38400");

    // A fifth decimal: marked as the field is left, and Report Month sends nothing.
    fireEvent.change(stories!, { target: { value: "27.12345" } });
    fireEvent.blur(stories!);
    await settled();
    expect(within(dialog()).getByText("Like 64000 or 0.95")).toBeTruthy();
    const before = reports().length;
    await press(dialog(), "Report Month");
    expect(reports().length).toBe(before);

    // Put right, the mark clears as it is typed and the month goes.
    fireEvent.change(stories!, { target: { value: "27" } });
    expect(within(dialog()).queryByText("Like 64000 or 0.95")).toBeNull();
    await press(dialog(), "Report Month");
    expect(reports().length).toBe(before + 1);
    const sent = reports().at(-1)![0].body as { key_results: Array<{ actual_value?: string }> };
    expect(sent.key_results.map((k) => k.actual_value)).toEqual(["38400", "27"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 60000);

  it("on a phone: the head reads figures as people write them, and the key result's actions sit in its sheet", async () => {
    setViewport(390);
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    expect(screen.queryByRole("button", { name: "Manage Quarters" })).toBeNull();
    expect(screen.queryByRole("table", { name: "BM-O1" })).toBeNull();
    fireEvent.click(screen.getAllByText("BM-KR1.2")[0]);
    await settled();
    const sheet = dialog();
    expect(within(sheet).getByText("36 stories")).toBeTruthy();
    expect(within(sheet).getByText("27 stories")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 60000);

  /** A select's choices, read by opening it. */
  const choices = (root: HTMLElement, label: string) => optionLabels(within(root).getByRole("combobox", { name: label }));

  it("Staff read only: New Goal, Report Month and New KPI are not offered", async () => {
    await openAs("chidera@mycityapp.io", "/performance?tab=goals");
    expect(screen.getByText(/Q4 2026 · /)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New Goal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Report Month" })).toBeNull();
    cleanup();

    await openAs("chidera@mycityapp.io", "/performance?tab=kpis");
    expect(screen.getByText(/Q4 2026 · /)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New KPI" })).toBeNull();
  }, 60000);

  it("Report Month lists only what the reader may act for: a head their own function, Operations & People every function, the CEO the company too", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    await press(document.body, "Report Month");
    expect(await choices(dialog(), "Function")).toEqual(["Marketing & Sales"]);
    cleanup();

    await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
    await press(document.body, "Report Month");
    const operations = await choices(dialog(), "Function");
    expect(operations).toEqual(expect.arrayContaining(["Marketing & Sales", "Content", "Engineering"]));
    expect(operations).not.toContain("Company");
    cleanup();

    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    await press(document.body, "Report Month");
    const ceo = await choices(dialog(), "Function");
    expect(ceo[0]).toBe("Company");
    expect(ceo).toContain("Marketing & Sales");
  }, 60000);
});
