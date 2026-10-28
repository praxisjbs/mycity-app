// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { chooseOption, installMatchMedia, optionLabels, setViewport } from "@mycity/ui/testing";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession, sid } from "@/api/mock/core";
import { ROLE_CAPABILITIES } from "@/api/mock/data/access";
import { deptId, OBJECTIVES, ORG_GOALS, PLANS } from "@/api/mock/data/performance";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Performance from "./index";

/**
 * Performance · Goals, set and changed on screen, on the in-browser mock (docs/guides/performance.md
 * §3.1, §3.2, §3.5, §6.7, §10): Operations & People set up Q1 2027 from ⌘K in October, its rules copied
 * and changed, each checked on its field; the CEO edits and deletes a draft objective and key result
 * with every field of the form, each delete confirmed by name; a key result nobody has reported reads
 * Awaiting Report and a binding one with no target is given it by Change Target; the CEO edits a goal's
 * quarterly target and deletes a goal; on a phone figures read as people write them.
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

  it("New Key Result offers only what its measure needs: Dated and Yes or No take away Target, Unit and Direction, and what was typed there is not saved (JBS Praxis, 27/10/2026)", async () => {
    const made: { objective?: string } = {};
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals", async () => {
      const o = (await api.call("POST /api/v1/performance/objectives", { body: { performance_period_id: quarter, title: "A trusted view" } })) as { okr_objective_id: string };
      made.objective = o.okr_objective_id;
    });
    fireEvent.click(screen.getAllByRole("button", { name: /New Goal/ })[0]!);
    await settled();
    const form = dialog();
    await chooseOption(within(form).getByLabelText("What"), "Key Result");
    await settled();
    const target = /^Target(?! in Words)/;
    const measure = (name: string) => fireEvent.click(within(form).getByRole("radio", { name }));

    // Numeric asks for the figure, its unit and, behind More, which way is better.
    expect(within(form).getByLabelText(target)).toBeTruthy();
    expect(within(form).getByLabelText(/^Unit/)).toBeTruthy();
    expect(within(form).getByText("Direction")).toBeTruthy();

    // The form reads in order: Unit under Target, Start above Finish, Type above Owner, all open (JBS Praxis, 28/10/2026).
    const order = [target, /^Unit/, /^Target in Words/, /^Start/, /^Finish/, /^Type/, /^Owner(?! Note)/].map((name) => within(form).getAllByLabelText(name)[0]!);
    order.slice(1).forEach((field, i) => expect(order[i]!.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());

    type(form, target, "7000");
    type(form, /^Unit/, "users");

    // Yes or No and Dated have no figure to reach: the words, finish and owner remain.
    for (const name of ["Yes or No", "Dated"]) {
      measure(name);
      await settled();
      expect(within(form).queryByLabelText(target)).toBeNull();
      expect(within(form).queryByLabelText(/^Unit/)).toBeNull();
      expect(within(form).queryByText("Direction")).toBeNull();
      expect(within(form).getByLabelText(/^Target in Words/)).toBeTruthy();
      expect(within(form).queryByRole("checkbox")).toBeNull();
      expect(within(form).getByLabelText(/^Finish/)).toBeTruthy();
      expect(within(form).getByLabelText(/^Baseline/)).toBeTruthy();
    }
    expect(copyProblems()).toEqual([]);

    // Back on Numeric, what was typed is still there.
    measure("Numeric");
    await settled();
    expect(valueOf(form, target)).toBe("7000");
    expect(valueOf(form, /^Unit/)).toBe("users");

    // Saved as Yes or No, the figure and unit typed before the change are left out.
    measure("Yes or No");
    await settled();
    type(form, "Key Result", "Sign the Lagos partnership");
    type(form, /^Target in Words/, "Contract signed");
    await press(form, "Set Key Result");
    const saved = OBJECTIVES.find((o) => o.okr_objective_id === made.objective)!.key_results.at(-1)!;
    expect(saved).toMatchObject({ statement: "Sign the Lagos partnership", measure: "yes_no", target_text: "Contract signed", target_value: null, unit: null, direction: "higher" });
    // The objective goes with its key result: later tests start from the demo's plan.
    await api.call("DELETE /api/v1/performance/objectives/:id", { params: { id: made.objective! } });
  }, 60000);

  it("New Key Result's Unit suggests the units in use, offers what is typed, and offers a new unit the next time (JBS Praxis, 27/10/2026)", async () => {
    const made: { objective?: string } = {};
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals", async () => {
      const o = (await api.call("POST /api/v1/performance/objectives", { body: { performance_period_id: quarter, title: "A full house" } })) as { okr_objective_id: string };
      made.objective = o.okr_objective_id;
    });
    const openForm = async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /New Goal/ })[0]!);
      await settled();
      const form = dialog();
      await chooseOption(within(form).getByLabelText("What"), "Key Result");
      await settled();
      return form;
    };
    const options = (root: HTMLElement) => within(root).queryAllByRole("option").map((o) => o.textContent ?? "");

    // A unit nobody has used is offered as typed, beside the units in use.
    let form = await openForm();
    type(form, /^Unit/, "tickets");
    await settled();
    expect(options(form).some((o) => /^Add\s*“tickets”/.test(o))).toBe(true);
    type(form, "Key Result", "Sell out the launch night");
    type(form, /^Target(?! in Words| to be)/, "500");
    await press(form, "Set Key Result");
    expect(OBJECTIVES.find((o) => o.okr_objective_id === made.objective)!.key_results.at(-1)).toMatchObject({ unit: "tickets", target_value: "500" });

    // Next time it is a suggestion, with how often it is used.
    form = await openForm();
    type(form, /^Unit/, "tick");
    await settled();
    expect(options(form).some((o) => /^tickets/.test(o) && /1 use/.test(o))).toBe(true);
    await api.call("DELETE /api/v1/performance/objectives/:id", { params: { id: made.objective! } });
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

  it("New Objective offers Operations & People the company and every function: what the server says they may set (QA DEF-10, P27)", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
    fireEvent.click(screen.getAllByRole("button", { name: /New Goal/ })[0]!);
    await settled();
    const form = dialog();
    await chooseOption(within(form).getByLabelText("What"), "Objective");
    await settled();
    const offered = await optionLabels(within(form).getByLabelText("Function"));
    expect(offered).toEqual(expect.arrayContaining(["Company", "Engineering", "Finance", "Marketing & Sales · Binding"]));
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

  it("a binding plan the reader reads but does not set hides New Goal and offers no Request To Unbind: the company's, for a reader of the whole plan who does not set it; Operations & People set it and are offered Request To Unbind (JBS Praxis, 27/10/2026, 28/10/2026)", async () => {
    // The company's plan, binding: Management, Operations & People and the CEO set it (§6.3, P27). A reader of the whole
    // plan who does not (here the head, given goals.view_all) reads it and is offered nothing; Operations & People set it,
    // so are offered Request To Unbind. A company objective made by an earlier test leaves its draft plan behind, so that
    // one is bound when it is there, and put back after.
    const made = { ...PLANS[0]!, performance_plan_id: sid("perf:plan:company"), department_id: null, department: null, status: "binding" as const };
    const left = PLANS.find((p) => p.department_id === null && p.performance_period_id === made.performance_period_id);
    const was = left?.status;
    if (left) left.status = "binding";
    else PLANS.push(made);
    try {
      await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
      // With All Functions picked there are functions to add to; on the binding company she may ask to unbind it.
      expect(screen.getAllByRole("button", { name: "New Goal" }).length).toBeGreaterThan(0);
      await chooseOption(screen.getByLabelText("Function"), "Company");
      await settled();
      expect(screen.queryByRole("button", { name: "New Goal" })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Request To Unbind" }).length).toBeGreaterThan(0);
      cleanup();

      // The Head of Department role, given the one capability that reads the whole plan.
      const heads = ROLE_CAPABILITIES.head_of_department!;
      heads.push("goals.view_all");
      try {
        await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
        await chooseOption(screen.getByLabelText("Function"), "Company");
        await settled();
        expect(screen.queryByRole("button", { name: "New Goal" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Request To Unbind" })).toBeNull();
      } finally {
        heads.splice(heads.indexOf("goals.view_all"), 1);
      }
    } finally {
      if (left) left.status = was!;
      else PLANS.splice(PLANS.indexOf(made), 1);
    }
  }, 90000);

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

  it("the score figures' help names the quarter's own Good and Watch bands, and follows Edit Quarter (JBS Praxis, 28/10/2026)", async () => {
    await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
    const before = (await api.call("GET /api/v1/performance/periods/:id", { params: { id: quarter } })) as { rules: Record<string, unknown> };
    const helpOf = (name: string) => {
      const term = screen.getAllByRole("button", { name }).find((b) => b.hasAttribute("aria-describedby"))!;
      return document.getElementById(term.getAttribute("aria-describedby")!)?.textContent;
    };
    // Operations & People read the whole plan (P27): their first figure is the company's score.
    expect(helpOf("Company Score")).toBe("Scores run from 0 to 1. Good is 0.7 or above; Watch 0.4 to 0.7; Recovery below 0.4 needs a recovery plan.");
    try {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Manage Quarters" }), { button: 0, pointerType: "mouse" });
      await settled();
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit Quarter" }));
      await settled();
      await press(dialog(), "Next");
      type(dialog(), "Good From", "0.8");
      type(dialog(), "Watch From", "0.5");
      await press(dialog(), "Next");
      await press(dialog(), "Next");
      await press(dialog(), "Next");
      await press(dialog(), "Save Quarter");
      const help = "Scores run from 0 to 1. Good is 0.8 or above; Watch 0.5 to 0.8; Recovery below 0.5 needs a recovery plan.";
      expect(helpOf("Company Score")).toBe(help);
      expect(helpOf("Scoring Good")).toBe(help);
      expect(copy.wordCount(help)).toBeLessThanOrEqual(copy.LIMITS.help);
    } finally {
      await api.call("PATCH /api/v1/performance/periods/:id", { params: { id: quarter }, body: { rules: before.rules } as never });
    }
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
    expect(within(form).queryByText("TBC")).toBeNull();
    await press(form, "More");
    expect(within(form).getByText("Scored From")).toBeTruthy();
    type(form, /^Baseline/, "38,000 in Q3");
    type(form, /^Owner Note/, "CEO with interim finance owner");
    expect(copyProblems()).toEqual([]);
    await press(form, "Save Key Result");
    const saved = (await api.call("GET /api/v1/performance/key-results/:id", { params: { id: made.kr! } })) as { target_text: string; baseline_text: string; accountable_note: string };
    expect(saved).toMatchObject({ target_text: "64,000 monthly users", baseline_text: "38,000 in Q3", accountable_note: "CEO with interim finance owner" });

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

  it("a key result nobody has reported reads Awaiting Report, never TBC; a binding one with no target is given it by Change Target", async () => {
    const k = OBJECTIVES.flatMap((o) => o.key_results).find((x) => x.code === "BM-KR2.1")!;
    const was = { latest: k.latest, value: k.target_value, text: k.target_text };
    Object.assign(k, { latest: null, target_value: null, target_text: null });
    try {
      await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
      const row = screen.getByText("BM-KR2.1").closest("tr")!;
      expect(within(row).getByText("Awaiting Report")).toBeTruthy();
      expect(screen.queryByText("TBC")).toBeNull();
      fireEvent.click(screen.getByText("BM-KR2.1"));
      await settled();
      const panel = dialog();
      expect(within(panel).queryByText("TBC")).toBeNull();
      expect(within(panel).queryByRole("button", { name: "Set Target" })).toBeNull();
      expect(within(panel).getByRole("button", { name: "Change Target" })).toBeTruthy();
      // The target is not set in place: the plan is binding.
      expect(await status(api.call("PATCH /api/v1/performance/key-results/:id", { params: { id: k.okr_key_result_id }, body: { target_value: "15" } }))).toBe(409);
      expect(k.target_value).toBeNull();
    } finally {
      Object.assign(k, { latest: was.latest, target_value: was.value, target_text: was.text });
    }
  }, 60000);

  it("each person reads their own department's goals: staff of another department read no tree and no organisational goals, a head reads theirs (JBS Praxis, 28/10/2026)", async () => {
    // Content's people read Content's own tree (an earlier test may have given it objectives), not Marketing & Sales' and not the company's.
    await openAs("chidera@mycityapp.io", "/performance?tab=goals");
    expect(screen.queryByRole("table", { name: "Organisational Goals" })).toBeNull();
    expect(screen.queryByLabelText("Function")).toBeNull();
    expect(screen.queryByText("BM-O1")).toBeNull();
    expect(screen.getByText("Function Score")).toBeTruthy();
    expect(screen.queryByText("Company Score")).toBeNull();
    expect(copyProblems()).toEqual([]);
    cleanup();

    // The head of Marketing & Sales reads their function's two objectives, and no company.
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    expect(screen.getByText(/^BM-O1 · /)).toBeTruthy();
    expect(screen.queryByLabelText("Function")).toBeNull();
    expect(screen.queryByText("Company Score")).toBeNull();
    cleanup();

    // The CEO reads the whole tree, with the company's score and every function to choose from.
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    expect(screen.getByText("Company Score")).toBeTruthy();
    expect(screen.getByLabelText("Function")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Organisational Goals" })).toBeTruthy();
  }, 60000);

  it("the CEO shares a goal with a department: its people read it, the others do not; Stop Sharing takes it back (JBS Praxis, 28/10/2026)", async () => {
    const goal = sid("perf:goal:ORG-2026-01");
    const readsAs = async (user: string) => {
      mockSession.set(user);
      return status(api.call("GET /api/v1/performance/goals/:id", { params: { id: goal } }));
    };
    await openAs("ifeoma@mycityapp.io", `/performance?tab=goals&goal=${goal}`);
    let sheet = dialog();
    expect(within(sheet).getByText("Not Shared")).toBeTruthy();
    await press(sheet, "Share Goal");
    let form = dialog();
    // Chosen Departments asks which; nothing is shared until one is picked.
    fireEvent.click(within(form).getByRole("radio", { name: "Chosen Departments" }));
    await settled();
    await press(form, "Share Goal");
    expect(within(form).getByText("Pick a department")).toBeTruthy();
    fireEvent.click(await within(form).findByRole("option", { name: /Marketing & Sales/ }));
    expect(copyProblems()).toEqual([]);
    await press(form, "Share Goal");
    // Back on the goal's sheet, which says with whom.
    sheet = dialog();
    expect(await within(sheet).findByText("Marketing & Sales")).toBeTruthy();
    expect([await readsAs("ngozi"), await readsAs("chidera")]).toEqual([200, 404]);
    mockSession.set("ifeoma");

    // All Staff reaches Content too.
    await press(sheet, "Share Goal");
    form = dialog();
    fireEvent.click(within(form).getByRole("radio", { name: "All Staff" }));
    await press(form, "Share Goal");
    sheet = dialog();
    expect(await within(sheet).findByText("All Staff")).toBeTruthy();
    expect(await readsAs("chidera")).toBe(200);
    // Read only for the reader: no Share Goal for them, and the API refuses it.
    expect(await status(api.call("PUT /api/v1/performance/goals/:id/share", { params: { id: goal }, body: { audience: "all", department_ids: [] } }))).toBe(403);
    mockSession.set("ifeoma");

    await press(sheet, "Share Goal");
    await press(dialog(), "Stop Sharing");
    sheet = dialog();
    expect(await within(sheet).findByText("Not Shared")).toBeTruthy();
    expect([await readsAs("ngozi"), await readsAs("chidera")]).toEqual([404, 404]);
    mockSession.set("ifeoma");
  }, 90000);

  it("Management share a company objective: a function's is refused, and the department it is shared with reads it with its key results (JBS Praxis, 28/10/2026)", async () => {
    let made = "";
    let code = "";
    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals", async () => {
      const o = (await api.call("POST /api/v1/performance/objectives", { body: { performance_period_id: quarter, title: "One shared view" } })) as { okr_objective_id: string; code: string };
      made = o.okr_objective_id;
      code = o.code;
      await api.call("POST /api/v1/performance/key-results", { body: { okr_objective_id: made, statement: "Sign off the baseline", measure: "dated" } });
    });
    // The company's objective opens its menu to Share Objective; a function's does not.
    fireEvent.pointerDown(screen.getByRole("button", { name: `${code} Actions` }), { button: 0, pointerType: "mouse" });
    await settled();
    expect(screen.getByRole("menuitem", { name: "Share Objective" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(await status(api.call("PUT /api/v1/performance/objectives/:id/share", { params: { id: sid("perf:obj:BM-O1") }, body: { audience: "all", department_ids: [] } }))).toBe(409);
    await act(async () => {
      await api.call("PUT /api/v1/performance/objectives/:id/share", { params: { id: made }, body: { audience: "departments", department_ids: [sid("dept:Content")] } });
    });
    const readsAs = async (user: string) => {
      mockSession.set(user);
      const res = (await api.call("GET /api/v1/performance/okrs", { query: { period_id: quarter } })) as { data: Array<{ okr_objective_id: string; code: string; key_results: unknown[]; can_edit: boolean; can_share: boolean }> };
      return res.data.filter((o) => o.okr_objective_id === made);
    };
    // Content reads it, whole and read only; Marketing & Sales do not.
    expect(await readsAs("chidera")).toEqual([expect.objectContaining({ code, can_edit: false, can_share: false, key_results: [expect.anything()] })]);
    expect(await readsAs("ngozi")).toEqual([]);
    mockSession.set("ifeoma");
    await act(async () => {
      await api.call("DELETE /api/v1/performance/objectives/:id/share", { params: { id: made } });
    });
    expect(await readsAs("chidera")).toEqual([]);
    mockSession.set("ifeoma");
    await act(async () => {
      await api.call("DELETE /api/v1/performance/objectives/:id", { params: { id: made } });
    });
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

  it("Report Month lists only what the reader may act for: a head their own function, Operations & People the company and every function, the CEO the same (P27)", async () => {
    await openAs("ngozi@mycityapp.io", "/performance?tab=goals");
    await press(document.body, "Report Month");
    expect(await choices(dialog(), "Function")).toEqual(["Marketing & Sales"]);
    cleanup();

    await openAs("cynthia@mycityapp.io", "/performance?tab=goals");
    await press(document.body, "Report Month");
    const operations = await choices(dialog(), "Function");
    expect(operations).toEqual(expect.arrayContaining(["Company", "Marketing & Sales", "Content", "Engineering"]));
    cleanup();

    await openAs("ifeoma@mycityapp.io", "/performance?tab=goals");
    await press(document.body, "Report Month");
    const ceo = await choices(dialog(), "Function");
    expect(ceo[0]).toBe("Company");
    expect(ceo).toContain("Marketing & Sales");
  }, 60000);
});
