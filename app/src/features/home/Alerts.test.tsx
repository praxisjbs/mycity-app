// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import alerts from "@mycity/contract/schemas/alerts.js";
import dashboard from "@mycity/contract/schemas/dashboard.js";
import type { HomeAlert } from "@mycity/contract/contract.gen.ts";
import { ModalProvider, Toaster } from "@mycity/ui";
import { axe, axeMatchers, chooseValue, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession, ok, route } from "@/api/mock/core";
import { overByWords } from "@/api/mock/modules/home";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider, useRegisteredAction } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import { newRuleValues, ruleBody, ruleValues, withMetric } from "./AlertRules";
import { alertFilters, categoryChips, categoryOf, columnSort, serverSort, sheetActions } from "./Alerts";
import Home from "./index";
import { ageOf, OVER_BY_HELP, overByText } from "./labels";

/**
 * Home · Alerts on the in-browser mock (docs/guides/home.md §10): the four counts, the category
 * chips, the open list and who sees what in it, an alert's sheet and what it offers, Clear and
 * Dismiss, View Dismissed, the rules with their switches, New Rule and Edit Rule checked by the
 * contract, the links into the tab, and the phone's layout. The mock answers in the contract's
 * shapes, so what the screen shows is checked against what the API sends.
 *
 * The mock keeps its alerts and rules for the whole file, so the tests that change them come
 * last, and every figure they check is read from the API rather than assumed.
 */

expect.extend(axeMatchers);
installMatchMedia();
beforeAll(() => {
  // What jsdom lacks for Radix overlays and the toaster.
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
});
afterEach(() => {
  cleanup();
  setViewport(1440);
  window.history.replaceState(null, "", "/home?tab=alerts");
});

let auth: ReturnType<typeof useAuth> | null = null;
let fab: ReturnType<typeof useRegisteredAction> = null;
function Screen() {
  const { location } = useRouter();
  fab = useRegisteredAction();
  return location.module === "home" ? <Home tab={location.tab ?? "overview"} id={location.id} /> : null;
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

/** Signs in on the mock at `/home?tab=alerts` (and `search`), without the tab on screen yet; `show()` puts it there. */
async function signedIn(email: string, search = "") {
  window.history.replaceState(null, "", `/home?tab=alerts${search}`);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 5000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  return {
    /** Puts the tab on screen; a link that opens a sheet leaves the page behind it hidden, so this waits for nothing. */
    open: () => rerender(app(true)),
    show: async () => {
      rerender(app(true));
      await screen.findByRole("heading", { level: 1, name: "Alerts" }, { timeout: 8000 });
      await waitFor(() => expect(cardTitles()).toHaveLength(4), { timeout: 8000 });
    },
  };
}

async function alertsAs(email: string, search = "") {
  await (await signedIn(email, search)).show();
  await screen.findByRole("navigation", { name: /^(Open|Dismissed) Alerts pages$/ }, { timeout: 8000 });
}

/** What the API sends whoever is signed in. */
const openAlerts = async (query: Record<string, string> = {}) => alerts.HomeAlertPage.parse(await api.call("GET /api/v1/home/alerts", { query }));
const summaryNow = async () => alerts.HomeAlertSummary.parse(await api.call("GET /api/v1/home/alerts/summary"));
const rulesNow = async () => alerts.HomeAlertRulePage.parse(await api.call("GET /api/v1/home/alert-rules")).data;

const list = () => screen.getByRole("table", { name: /Alerts$/ });
const headers = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim());
const titlesIn = (root: HTMLElement, rows: HomeAlert[]) => rows.map((a) => a.title).filter((t) => within(root).queryAllByText(t).length > 0);
const chip = (name: RegExp) => within(screen.getByRole("group", { name: "Category" })).getByRole("button", { name });
const footerButtons = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole("button")
    .map((b) => b.textContent?.trim())
    .filter((t) => ["Close", "Edit Rule", "Dismiss Alert", "Clear Alert"].includes(t ?? ""));
/** A button in a sheet's footer by its words (the sheet's own close is an icon also named Close). */
const footerButton = (dialog: HTMLElement, name: string) => within(dialog).getAllByRole("button", { name }).find((b) => b.textContent?.trim() === name)!;
const value = (root: HTMLElement, label: string) => within(root).getByText(label).nextElementSibling?.textContent;

/** The KPI cards' titles, in the order the row shows them. */
function cardTitles(): string[] {
  const row = document.querySelector("ul.grid-cols-2");
  return row ? [...row.querySelectorAll('[data-ui="title"]')].map((t) => t.textContent!.trim()) : [];
}

/** The copy rules the screen gates hold a screen to (scripts/check/lib/copy.js), read from what is rendered. */
function copyProblems(root: ParentNode = document.body): string[] {
  const problems: string[] = [];
  const read = (selector: string, limit: number, chrome: boolean) => {
    for (const el of root.querySelectorAll(selector)) {
      if (el.closest('[data-copy="content"]')) continue;
      const t = el.textContent?.trim() ?? "";
      if (copy.wordCount(t) > limit) problems.push(`${selector} over ${limit} words: "${t}"`);
      const word = chrome ? copy.titleCaseViolation(t) : null;
      if (word) problems.push(`${selector} not Title Case at "${word}": "${t}"`);
      const why = chrome ? copy.explainerTitle(t) : null;
      if (why) problems.push(`${selector} ${why}: "${t}"`);
      if (copy.hasDash(t)) problems.push(`${selector} has a dash: "${t}"`);
    }
  };
  read('[data-ui="page-title"]', copy.LIMITS.pageTitle, true);
  read('[data-ui="page-subtitle"]', copy.LIMITS.pageSubtitle, false);
  read('[data-ui="title"]', copy.LIMITS.title, true);
  read('[data-ui="empty-text"]', copy.LIMITS.emptyText, false);
  read('[data-ui="button"]', copy.LIMITS.button, true);
  read("th", copy.LIMITS.title, true);
  return problems;
}

/** Opens the alert with this title from the list, and gives back its sheet. */
async function openAlert(title: string) {
  fireEvent.click(within(list()).getByText(title));
  return screen.findByRole("dialog", { name: title });
}

/* ------------------------------------------------------------------ *
 * What the screen sends, and the form's own steps
 * ------------------------------------------------------------------ */

describe("what the screen sends", () => {
  it("asks for the open alerts of a category, or for the dismissed, as the contract names them", () => {
    expect(alertFilters("open", null)).toEqual({});
    expect(alertFilters("open", "people")).toEqual({ category: "people" });
    expect(alertFilters("dismissed", "people")).toEqual({ state: "dismissed" });
    for (const f of [alertFilters("open", "attendance"), alertFilters("dismissed", null)]) expect(alerts.HomeAlertQuery.safeParse({ ...f, page: "1" }).success).toBe(true);
    expect(categoryOf("partnership")).toBe("partnership");
    expect(categoryOf("payroll")).toBeNull();
    expect(categoryOf(null)).toBeNull();
  });

  it("shows All with every open alert, then the categories with open alerts, and keeps a linked category at 0", () => {
    const summary = { open: 5, categories: [{ category: "people", count: 2 }, { category: "attendance", count: 3 }] };
    expect(categoryChips(summary, null)).toEqual([
      { value: "all", label: "All", count: 5 },
      { value: "attendance", label: "Attendance", count: 3 },
      { value: "people", label: "People", count: 2 },
    ]);
    expect(categoryChips(summary, "budget").map((c) => [c.label, c.count])).toEqual([["All", 5], ["Attendance", 3], ["People", 2], ["Budgets", 0]]);
  });

  it("offers Clear and Dismiss only where clearing will work, and Edit Rule to a rule manager on a listed metric", () => {
    expect(sheetActions({ can_clear: true, metric: "late_arrivals" }, true)).toEqual({ editRule: true, clear: true });
    expect(sheetActions({ can_clear: true, metric: "late_arrivals" }, false)).toEqual({ editRule: false, clear: true });
    expect(sheetActions({ can_clear: false, metric: "late_arrivals" }, true)).toEqual({ editRule: true, clear: false });
    expect(sheetActions({ can_clear: false, metric: "attendance.rule_breached" }, true)).toEqual({ editRule: false, clear: false });
  });

  it("sorts Age the other way to when an alert was raised: Age going up is the youngest first", () => {
    expect(serverSort("age")).toBe("-raised_at");
    expect(serverSort("-age")).toBe("raised_at");
    expect(serverSort("severity")).toBe("severity");
    expect(serverSort("-severity")).toBe("-severity");
    expect(serverSort(undefined)).toBeUndefined();
    for (const s of ["age", "-age", "severity", "-severity", undefined]) expect(columnSort(serverSort(s))).toBe(s);
    for (const s of ["age", "-age", "-severity"]) expect(alerts.HomeAlertQuery.safeParse({ sort: serverSort(s), page: "1" }).success).toBe(true);
  });

  it("starts New Rule on the first metric with its window and who clears it, and follows a new metric", () => {
    const start = newRuleValues();
    expect(start).toEqual({ name: "", metric: "late_arrivals", threshold: "", window_days: "30", severity: "medium", permission_key: "people.view" });
    const deadline = withMetric(start, "document_expiry");
    expect(deadline).toMatchObject({ metric: "document_expiry", window_days: "", permission_key: "people.edit" });
    // Who Can Clear the person chose stays when the metric changes; a window typed is kept for a metric counted over days.
    expect(withMetric({ ...start, permission_key: "people.approve", window_days: "14" }, "missing_clock_out")).toMatchObject({ window_days: "14", permission_key: "people.approve" });
  });

  it("sends a rule as the contract takes it: the window only for a metric counted over days, no metric on a change", () => {
    const counted = { ...newRuleValues(), name: " Late Arrivals ", threshold: "3" };
    expect(ruleBody(counted)).toEqual({ name: "Late Arrivals", threshold: "3", window_days: 30, severity: "medium", permission_key: "people.view" });
    expect(alerts.HomeAlertRuleCreate.safeParse({ ...ruleBody(counted), metric: counted.metric }).success).toBe(true);
    const deadline = { ...withMetric(newRuleValues(), "contract_ending"), name: "Contracts Ending", threshold: "30" };
    expect(ruleBody(deadline)).toEqual({ name: "Contracts Ending", threshold: "30", severity: "medium", permission_key: "people.edit" });
    expect(alerts.HomeAlertRuleCreate.safeParse({ ...ruleBody(deadline), metric: deadline.metric }).success).toBe(true);
    expect(alerts.HomeAlertRuleUpdate.safeParse(ruleBody(deadline)).success).toBe(true);
    const kept = ruleValues({
      home_alert_rule_id: "8d2c0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
      key: "budget_threshold.budget_nearly_spent",
      name: "Budget Nearly Spent",
      metric: "budget_threshold",
      category: "budget",
      kind: "count",
      threshold: "90.50",
      window_days: null,
      severity: "high",
      permission_key: "expenses.approve",
      who_can_clear: "Expenses Approvers",
      enabled: true,
      open_alerts: 1,
      created_by: null,
      updated_by: null,
      created_at: "2026-10-01T09:00:00.000Z",
      updated_at: "2026-10-01T09:00:00.000Z",
    });
    expect(kept).toEqual({ name: "Budget Nearly Spent", metric: "budget_threshold", threshold: "90.5", window_days: "", severity: "high", permission_key: "expenses.approve" });
  });
});

/* ------------------------------------------------------------------ *
 * Reading: the mock answers what the API answers, and who sees what
 * ------------------------------------------------------------------ */

describe("the mock answers what the API answers", () => {
  it.each(["cynthia", "ifeoma", "ngozi"])("the reads for %s match the contract", async (who) => {
    await signedIn(`${who}@mycityapp.io`);
    const page = await openAlerts();
    alerts.HomeAlertSummary.parse(await api.call("GET /api/v1/home/alerts/summary"));
    alerts.HomeAlertPage.parse(await api.call("GET /api/v1/home/alerts", { query: { state: "dismissed" } }));
    alerts.HomeAlertPage.parse(await api.call("GET /api/v1/home/alerts", { query: { category: "attendance", mine: "true", overdue: "false" } }));
    alerts.HomeAlert.parse(await api.call("GET /api/v1/home/alerts/:id", { params: { id: page.data[0].home_alert_id } }));
  }, 30000);

  it("words the Open High Alerts card's Over By as the list does, for a count and a deadline", async () => {
    const cases: Array<[string | null, HomeAlert["over_by_kind"]]> = [
      ["1.00", "over"],
      ["0.00", "over"],
      ["2.50", "over"],
      ["1250.00", "over"],
      ["12.00", "days_left"],
      ["1.00", "days_left"],
      ["0.00", "days_left"],
      ["-2.00", "days_left"],
      ["4.00", null],
      [null, "days_left"],
    ];
    for (const [over_by, over_by_kind] of cases) expect([over_by, over_by_kind, overByWords(over_by, over_by_kind)]).toEqual([over_by, over_by_kind, overByText({ over_by, over_by_kind })]);
    expect(overByWords("-2.00", "days_left")).toBe("Expired");

    await signedIn("ifeoma@mycityapp.io");
    const high = (await openAlerts({ severity: "high" })).data;
    expect(high.length).toBeGreaterThan(0);
    const card = dashboard.HomeKpiDetailPage.parse(await api.call("GET /api/v1/home/kpi/:key", { params: { key: "alerts_high_open" } }));
    expect(card.data.map((r) => r.id).sort()).toEqual(high.map((a) => a.home_alert_id).sort());
    for (const a of high) expect([a.title, card.data.find((r) => r.id === a.home_alert_id)?.cells.over_by]).toEqual([a.title, { kind: "text", text: overByText(a) }]);
    const meta = dashboard.HomeKpiDetailMeta.parse(await api.call("GET /api/v1/home/kpi/:key/meta", { params: { key: "alerts_high_open" } }));
    expect(meta.columns.find((c) => c.key === "over_by")).toEqual({ key: "over_by", label: "Over By", numeric: false, phone: true });
  }, 30000);

  it("refuses the alerts to a reader with neither capability, and the rules to one without alerts.manage", async () => {
    await signedIn("chidera@mycityapp.io");
    for (const key of ["GET /api/v1/home/alerts", "GET /api/v1/home/alerts/summary", "GET /api/v1/home/alert-rules"] as const) {
      await expect(api.call(key)).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.status === 403);
    }
    cleanup();
    await signedIn("ngozi@mycityapp.io");
    await expect(api.call("GET /api/v1/home/alert-rules")).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.status === 403);
  }, 30000);
});

describe("Home · Alerts, by who is reading", () => {
  it("Operations: the four counts, the category chips, every open alert with Over By's help, and Alert Sources", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const summary = await summaryNow();
    const page = await openAlerts();
    expect(cardTitles()).toEqual(["Open Alerts", "Needs You", "Overdue 7 Days +", "Cleared This Week"]);
    const row = document.querySelector("ul.grid-cols-2")!;
    expect([...row.children].map((c) => c.textContent)).toEqual([
      `Open Alerts${summary.open}`,
      `Needs You${summary.needs_you}`,
      `Overdue 7 Days +${summary.overdue}`,
      `Cleared This Week${summary.cleared_this_week}`,
    ]);
    expect(within(screen.getByRole("group", { name: "Category" })).getAllByRole("button").map((b) => b.textContent)).toEqual(
      categoryChips(summary, null).map((c) => `${c.label} ${c.count}`),
    );
    expect(chip(/^All/).getAttribute("aria-pressed")).toBe("true");

    expect(page.page.total).toBe(summary.open);
    expect(within(screen.getByRole("navigation", { name: "Open Alerts pages" })).getByText(`${summary.open} alerts`)).toBeTruthy();
    expect(titlesIn(list(), page.data)).toHaveLength(page.data.length);
    expect(headers(list())).toEqual(["Alert", "Trigger", "Who Can Clear", "Age", "Over By", "Severity"]);
    // Over By is the one help term: on the column header, its text kept for screen readers.
    const term = within(list()).getByRole("button", { name: "Over By" });
    expect(document.getElementById(term.getAttribute("aria-describedby")!)?.textContent).toBe(OVER_BY_HELP);

    // How far past its rule, or the days left before a deadline, and Expired once it has passed.
    const cells = (title: string) => within(within(list()).getAllByText(title)[0].closest("tr")!).getAllByRole("cell").map((c) => c.textContent);
    expect(cells("Bashir Lawal: 4 late arrivals in 30 days").slice(2)).toEqual(["People Viewers", "2 days", "+1", "Medium"]);
    expect(cells("Grace Okon: Work Permit")[4]).toBe("12 days left");
    expect(cells("Hauwa Yusuf: First Aid Certificate")[4]).toBe("Expired");
    // A date falling today has not passed: Due Today, beside a trigger that says it expires today.
    expect(cells("Tobi Ojo: Passport")[1]).toMatch(/^Expires on \d{2}\/\d{2}\/\d{4}$/);
    expect(cells("Tobi Ojo: Passport")[4]).toBe("Due Today");
    // Operations sees the alert about Ngozi; Ngozi does not (below).
    expect(titlesIn(list(), page.data)).toContain("Ngozi Eze: 3 late arrivals in 30 days");

    expect(screen.getByRole("heading", { name: "Alert Sources, 30 Days" })).toBeTruthy();
    expect(screen.getByText("Late Arrivals")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("a category chip narrows the list, and its value goes into the address", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const people = (await openAlerts({ category: "people" })).data;
    const everyone = (await openAlerts()).data;
    fireEvent.click(chip(/^People/));
    await waitFor(() => expect(titlesIn(list(), everyone).sort()).toEqual(people.map((a) => a.title).sort()));
    expect(people.map((a) => a.title).sort()).toEqual(["Amara Okafor: contract ending", "Chidera Nwosu: confirmation due"]);
    expect(new URLSearchParams(window.location.search).get("category")).toBe("people");
    fireEvent.click(chip(/^All/));
    await waitFor(() => expect(titlesIn(list(), everyone)).toHaveLength(everyone.length));
    expect(new URLSearchParams(window.location.search).get("category")).toBeNull();

    // Severity sorts on the server: Low first, then High first.
    const firstSeverity = () => within(list()).getAllByRole("row")[1].lastElementChild?.textContent;
    fireEvent.click(within(list()).getByRole("button", { name: "Severity" }));
    await waitFor(() => expect(firstSeverity()).toBe("Low"));
    fireEvent.click(within(list()).getByRole("button", { name: "Severity" }));
    await waitFor(() => expect(firstSeverity()).toBe("High"));
  }, 30000);

  it("Age going up lists the youngest alert first, and going down the oldest, as its arrow says", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const raised = (await openAlerts()).data.map((a) => a.raised_at).sort();
    const firstAge = () => within(within(list()).getAllByRole("row")[1]).getAllByRole("cell")[3].textContent;
    const order = () => within(list()).getByRole("button", { name: "Age" }).closest("th")?.getAttribute("aria-sort");
    fireEvent.click(within(list()).getByRole("button", { name: "Age" }));
    await waitFor(() => expect(firstAge()).toBe(ageOf(raised.at(-1)!)));
    expect(order()).toBe("ascending");
    fireEvent.click(within(list()).getByRole("button", { name: "Age" }));
    await waitFor(() => expect(firstAge()).toBe(ageOf(raised[0])));
    expect(order()).toBe("descending");
  }, 30000);

  it("a Head of Department who clears alerts sees only those about their team on rules their grant reaches, and no rules", async () => {
    await alertsAs("ngozi@mycityapp.io");
    const page = await openAlerts();
    expect(page.data.map((a) => a.title).sort()).toEqual([
      "Emeka Obi: 3 missing clock-outs in 14 days",
      "Rotimi Alade: 6 late arrivals in 30 days",
      "Rotimi Alade: 6 late arrivals in 30 days",
    ]);
    expect(page.data.every((a) => a.can_clear)).toBe(true);
    // Bashir is outside her team; a partner or a budget is about no one, so only an organisation-wide scope sees it.
    expect(within(list()).queryByText("Bashir Lawal: 4 late arrivals in 30 days")).toBeNull();
    // Nobody but the CEO sees an alert about themselves: hers is for Operations and the CEO.
    expect(within(list()).queryByText("Ngozi Eze: 3 late arrivals in 30 days")).toBeNull();
    expect(within(list()).queryByText("Eko Hotels: no contact in 34 days")).toBeNull();
    const summary = await summaryNow();
    expect(summary).toMatchObject({ open: 3, needs_you: 3 });
    expect(screen.getByRole("button", { name: "View Dismissed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Alert Rules" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New Rule" })).toBeNull();
    expect(fab).toBeNull();
    expect(copyProblems()).toEqual([]);
  }, 30000);
});

describe("an alert's sheet", () => {
  it("shows the trigger, who can clear, age, Over By against the rule and severity; Close, Edit Rule, Dismiss Alert, Clear Alert", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const sheet = await openAlert("Bashir Lawal: 4 late arrivals in 30 days");
    expect(value(sheet, "Trigger")).toMatch(/^Late on 4 days, last on \d{2}\/\d{2}\/\d{4}$/);
    expect(value(sheet, "Who Can Clear")).toBe("People Viewers");
    expect(value(sheet, "Age")).toBe("2 days");
    expect(value(sheet, "Over By")).toBe("+1 over 3");
    expect(value(sheet, "Severity")).toBe("Medium");
    expect(footerButtons(sheet)).toEqual(["Close", "Edit Rule", "Dismiss Alert", "Clear Alert"]);
    expect(await axe(document.body)).toHaveNoViolations();
    fireEvent.click(footerButton(sheet, "Close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }, 30000);

  it("offers a reader without alerts.manage no Edit Rule", async () => {
    await alertsAs("ngozi@mycityapp.io");
    const sheet = await openAlert("Emeka Obi: 3 missing clock-outs in 14 days");
    expect(footerButtons(sheet)).toEqual(["Close", "Dismiss Alert", "Clear Alert"]);
  }, 30000);
});

describe("View Dismissed", () => {
  it("lists the dismissed alerts with when and by whom, opens one with nothing left to clear, and View Open goes back", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const dismissed = (await openAlerts({ state: "dismissed" })).data;
    fireEvent.click(screen.getByRole("button", { name: "View Dismissed" }));
    await screen.findByRole("navigation", { name: "Dismissed Alerts pages" });
    await waitFor(() => expect(titlesIn(list(), dismissed)).toHaveLength(dismissed.length));
    // Most recently closed first, as the server orders a closed list: Seyi's was dismissed after the rule went off.
    expect(dismissed.map((a) => a.title)).toEqual(["Seyi Balogun: 3 late arrivals in 30 days", "Senior Designer: 7 days at Interview"]);
    expect(within(list()).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(dismissed.map((a) => a.title));
    expect(headers(list())).toEqual(["Alert", "Trigger", "Dismissed", "Dismissed By", "Severity"]);
    // The chips count open alerts, so they are not drawn over the dismissed.
    expect(screen.queryByRole("group", { name: "Category" })).toBeNull();
    expect(copyProblems()).toEqual([]);

    const sheet = await openAlert("Seyi Balogun: 3 late arrivals in 30 days");
    expect(value(sheet, "Dismissed By")).toBe("Cynthia Osakunih");
    expect(value(sheet, "Note")).toBe("Client site visits, agreed in advance");
    expect(within(sheet).queryByText("Age")).toBeNull();
    expect(footerButtons(sheet)).toEqual(["Close", "Edit Rule"]);
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // A rule switched off dismissed this one as no one: Dismissed By is empty, and its note says why.
    const ruleOff = await openAlert("Senior Designer: 7 days at Interview");
    expect(within(ruleOff).getByText("Dismissed By").nextElementSibling?.querySelector("[data-empty]")).toBeTruthy();
    expect(value(ruleOff, "Note")).toBe("Rule switched off");
    fireEvent.keyDown(ruleOff, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "View Open" }));
    await screen.findByRole("navigation", { name: "Open Alerts pages" });
    expect(screen.getByRole("group", { name: "Category" })).toBeTruthy();
  }, 30000);
});

describe("links into the tab", () => {
  it("?id= opens that alert once it is read, and closing it takes the link out of the address", async () => {
    await signedIn("cynthia@mycityapp.io");
    const target = (await openAlerts()).data.find((a) => a.title === "Kano Trade Council: no contact in 52 days")!;
    cleanup();
    (await signedIn("cynthia@mycityapp.io", `&id=${target.home_alert_id}`)).open();
    const sheet = await screen.findByRole("dialog", { name: target.title }, { timeout: 8000 });
    expect(value(sheet, "Over By")).toBe("+22 over 30");
    fireEvent.click(footerButton(sheet, "Close"));
    await waitFor(() => expect(window.location.search).toBe("?tab=alerts"));
  }, 30000);

  it("?id= for an alert the reader may not see says so and leaves the address", async () => {
    await signedIn("cynthia@mycityapp.io");
    const unseen = (await openAlerts()).data.find((a) => a.title === "Bashir Lawal: 4 late arrivals in 30 days")!;
    cleanup();
    // Bashir is outside Ngozi's team.
    await alertsAs("ngozi@mycityapp.io", `&id=${unseen.home_alert_id}`);
    expect(await screen.findByText("Alert not found", {}, { timeout: 5000 })).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe("?tab=alerts"));
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 30000);

  it("?rule= opens Edit Rule for that rule to a rule manager, and closing it takes the link out of the address", async () => {
    await signedIn("cynthia@mycityapp.io");
    const rule = (await rulesNow()).find((r) => r.name === "Late Arrivals")!;
    cleanup();
    (await signedIn("cynthia@mycityapp.io", `&rule=${rule.home_alert_rule_id}`)).open();
    const dialog = await screen.findByRole("dialog", { name: "Edit Rule" }, { timeout: 8000 });
    expect(((await within(dialog).findByLabelText("Rule Name")) as HTMLInputElement).value).toBe("Late Arrivals");
    expect(new URLSearchParams(window.location.search).get("rule")).toBe(rule.home_alert_rule_id);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(window.location.search).toBe("?tab=alerts"));
  }, 30000);

  it("?rule= for a rule on a metric no longer listed opens Alert Rules, not its form, and leaves the address", async () => {
    const retired = alerts.HomeAlertRule.parse({
      home_alert_rule_id: "5b7e2c1a-9d3f-4e8b-a6c4-2f1d0e9b8a7c",
      key: "attendance.rule_breached.late_three",
      name: "Late Three Times",
      metric: "attendance.rule_breached",
      category: null,
      kind: null,
      threshold: "3.00",
      window_days: null,
      severity: "medium",
      permission_key: "people.view",
      who_can_clear: "People Viewers",
      enabled: true,
      open_alerts: 0,
      created_by: null,
      updated_by: null,
      created_at: "2026-09-01T09:00:00.000Z",
      updated_at: "2026-09-01T09:00:00.000Z",
    });
    // A rule kept from before the metric list, as the server still reads it (a literal path is matched before /:id).
    route(`GET /api/v1/home/alert-rules/${retired.home_alert_rule_id}`, () => ok(retired));
    (await signedIn("cynthia@mycityapp.io", `&rule=${retired.home_alert_rule_id}`)).open();
    expect(await screen.findByRole("dialog", { name: "Alert Rules" }, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Edit Rule" })).toBeNull();
    expect(screen.queryByLabelText("Rule Name")).toBeNull();
    await waitFor(() => expect(window.location.search).toBe("?tab=alerts"));
  }, 30000);

  it("?rule= opens nothing for a reader without alerts.manage, and leaves the address", async () => {
    await signedIn("cynthia@mycityapp.io");
    const rule = (await rulesNow()).find((r) => r.name === "Late Arrivals")!;
    cleanup();
    await alertsAs("ngozi@mycityapp.io", `&rule=${rule.home_alert_rule_id}`);
    await waitFor(() => expect(window.location.search).toBe("?tab=alerts"));
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 30000);

  it("?category= is the chip in force", async () => {
    await alertsAs("cynthia@mycityapp.io", "&category=attendance");
    const attendance = (await openAlerts({ category: "attendance" })).data;
    expect(chip(/^Attendance/).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Open Alerts pages" })).getByText(`${attendance.length} alerts`)).toBeTruthy());
    expect(titlesIn(list(), attendance)).toHaveLength(attendance.length);
    expect(within(list()).queryByText("Grace Okon: Work Permit")).toBeNull();
  }, 30000);

  it("?action=new opens New Rule for a rule manager, once, and the floating button offers it", async () => {
    (await signedIn("cynthia@mycityapp.io", "&action=new")).open();
    expect(await screen.findByRole("dialog", { name: "New Rule" }, { timeout: 8000 })).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe("?tab=alerts"));
    expect(fab?.label).toBe("New Rule");
  }, 30000);
});

describe("on a phone", () => {
  it("lays the counts two to a row, draws alerts as cards with Who Can Clear, Over By and severity, and leaves Alert Sources off", async () => {
    setViewport(390);
    await alertsAs("cynthia@mycityapp.io");
    expect(document.querySelector("ul.grid-cols-2")?.children).toHaveLength(4);
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByText("Alert Sources, 30 Days")).toBeNull();
    const title = "Bashir Lawal: 4 late arrivals in 30 days";
    const card = screen.getByRole("button", { name: title }).closest("li")!;
    for (const label of ["Who Can Clear", "Over By", "Severity"]) expect(within(card).getByText(label)).toBeTruthy();
    for (const label of ["Trigger", "Age"]) expect(within(card).queryByText(label)).toBeNull();
    expect(copyProblems()).toEqual([]);

    // Over By's help opens as a sheet on a tap, without opening the alert.
    fireEvent.click(within(card).getByRole("button", { name: "Over By" }));
    const help = await screen.findByRole("dialog", { name: "Over By" });
    expect(within(help).getByText(OVER_BY_HELP)).toBeTruthy();
    fireEvent.keyDown(help, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The alert's sheet carries the Trigger and the Age, and Clear Alert comes last, at its foot.
    fireEvent.click(screen.getByRole("button", { name: title }));
    const sheet = await screen.findByRole("dialog", { name: title });
    expect(value(sheet, "Age")).toBe("2 days");
    expect(within(sheet).getByText("Trigger")).toBeTruthy();
    expect(footerButtons(sheet).at(-1)).toBe("Clear Alert");
    expect(sheet.querySelector("table")).toBeNull();
  }, 30000);
});

/* ------------------------------------------------------------------ *
 * Changing things: these run last, since the mock keeps what they change
 * ------------------------------------------------------------------ */

describe("Clear Alert and Dismiss Alert", () => {
  it("Clear Alert closes it as cleared: off the open list, onto Cleared This Week", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const before = await summaryNow();
    const title = "Bashir Lawal: 4 late arrivals in 30 days";
    const sheet = await openAlert(title);
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear Alert" }));
    expect(await screen.findByText("Alert cleared")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(within(list()).queryByText(title)).toBeNull());
    const after = await summaryNow();
    expect(after.open).toBe(before.open - 1);
    expect(after.cleared_this_week).toBe(before.cleared_this_week + 1);
    await waitFor(() => expect(document.querySelector("ul.grid-cols-2")!.children[0].textContent).toBe(`Open Alerts${after.open}`));
  }, 30000);

  it("Dismiss Alert closes it as dismissed: it moves to View Dismissed and Cleared This Week does not count it", async () => {
    await alertsAs("ngozi@mycityapp.io");
    const before = await summaryNow();
    const title = "Emeka Obi: 3 missing clock-outs in 14 days";
    const sheet = await openAlert(title);
    fireEvent.click(within(sheet).getByRole("button", { name: "Dismiss Alert" }));
    expect(await screen.findByText("Alert dismissed")).toBeTruthy();
    await waitFor(() => expect(within(list()).queryByText(title)).toBeNull());
    expect(await summaryNow()).toMatchObject({ open: before.open - 1, cleared_this_week: before.cleared_this_week });
    fireEvent.click(screen.getByRole("button", { name: "View Dismissed" }));
    await screen.findByRole("navigation", { name: "Dismissed Alerts pages" });
    const row = (await within(list()).findByText(title)).closest("tr")!;
    expect(within(row).getAllByRole("cell")[3].textContent).toBe("Ngozi Eze");
  }, 30000);
});

describe("Alert Rules", () => {
  it("lists every rule with its switch; switching one off asks first, and Cancel leaves it on", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const rules = await rulesNow();
    fireEvent.click(screen.getByRole("button", { name: "Alert Rules" }));
    const dialog = await screen.findByRole("dialog", { name: "Alert Rules" });
    await within(dialog).findByText("Quiet Partners");
    expect(headers(within(dialog).getByRole("table"))).toEqual(["Rule", "Threshold", "Severity", "Who Can Clear", "Open Alerts", "On", "Actions"]);
    expect(within(dialog).getAllByRole("switch").map((s) => [s.getAttribute("aria-label"), s.getAttribute("aria-checked")])).toEqual(
      [...rules].sort((a, b) => a.name.localeCompare(b.name)).map((r) => [r.name, String(r.enabled)]),
    );
    const quiet = within(within(dialog).getByText("Quiet Partners").closest("tr")!);
    expect(quiet.getByText("30 days without contact")).toBeTruthy();
    expect(quiet.getByText("Partnerships Editors")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("switch", { name: "Quiet Partners" }));
    const ask = await screen.findByRole("alertdialog", { name: "Switch Off Rule" });
    expect(within(ask).getByText("Its open alerts are dismissed.")).toBeTruthy();
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect((await rulesNow()).find((r) => r.name === "Quiet Partners")?.enabled).toBe(true);
    expect(within(dialog).getByRole("switch", { name: "Quiet Partners" }).getAttribute("aria-checked")).toBe("true");
  }, 30000);

  it("Switch Off dismisses the rule's open alerts with it; switching one on asks nothing", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const partners = (await openAlerts({ category: "partnership" })).data;
    expect(partners.map((a) => a.title).sort()).toEqual(["Eko Hotels: no contact in 34 days", "Kano Trade Council: no contact in 52 days"]);
    fireEvent.click(screen.getByRole("button", { name: "Alert Rules" }));
    const dialog = await screen.findByRole("dialog", { name: "Alert Rules" });
    fireEvent.click(await within(dialog).findByRole("switch", { name: "Quiet Partners" }));
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Switch Off Rule" })).getByRole("button", { name: "Switch Off" }));
    expect(await screen.findByText("Rule switched off")).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByRole("switch", { name: "Quiet Partners" }).getAttribute("aria-checked")).toBe("false"));
    expect((await openAlerts({ category: "partnership" })).data).toEqual([]);
    const dismissed = (await openAlerts({ state: "dismissed", category: "partnership" })).data;
    expect(dismissed.map((a) => [a.title, a.note])).toEqual(expect.arrayContaining(partners.map((a) => [a.title, "Rule switched off"])));
    // The rule change closed them, not a person: nobody is recorded as dismissing them.
    const offed = dismissed.filter((a) => partners.some((p) => p.home_alert_id === a.home_alert_id));
    expect(offed.map((a) => [a.cleared_by, a.cleared_by_name])).toEqual(partners.map(() => [null, null]));

    fireEvent.click(within(dialog).getByRole("switch", { name: "Slow Hiring Stages" }));
    expect(await screen.findByText("Rule switched on")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await rulesNow()).find((r) => r.name === "Slow Hiring Stages")?.enabled).toBe(true);
  }, 30000);
});

describe("New Rule and Edit Rule", () => {
  const field = (dialog: HTMLElement, label: string) => within(dialog).getByLabelText(label) as HTMLInputElement | HTMLButtonElement;

  it("checks the fields with the contract's rule, follows the metric, and creates the rule", async () => {
    await alertsAs("cynthia@mycityapp.io");
    fireEvent.click(screen.getByRole("button", { name: "New Rule" }));
    const dialog = await screen.findByRole("dialog", { name: "New Rule" });
    expect(field(dialog, "Metric").value).toBe("late_arrivals");
    expect(field(dialog, "Window Days").value).toBe("30");
    expect(within(dialog).getByRole("radio", { name: "Medium" }).getAttribute("aria-checked")).toBe("true");
    expect(field(dialog, "Who Can Clear").textContent).toBe("People Viewers");

    // Nothing typed: the form marks what is missing and sends nothing.
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Rule" }));
    expect(await within(dialog).findByText("Required")).toBeTruthy();

    // A metric counted over days needs its window.
    fireEvent.change(field(dialog, "Rule Name"), { target: { value: "Visa Expiry" } });
    fireEvent.change(field(dialog, "Threshold"), { target: { value: "2.5" } });
    fireEvent.change(field(dialog, "Window Days"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Rule" }));
    expect(await within(dialog).findByText("Enter the days")).toBeTruthy();

    // A deadline metric has no window, counts whole days, and is cleared by its own grant.
    await chooseValue(field(dialog, "Metric"), "document_expiry");
    await waitFor(() => expect(within(dialog).queryByLabelText("Window Days")).toBeNull());
    expect(field(dialog, "Who Can Clear").textContent).toBe("People Editors");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Rule" }));
    expect(await within(dialog).findByText("Whole days only")).toBeTruthy();
    // From here the field itself takes whole days only.
    fireEvent.change(field(dialog, "Threshold"), { target: { value: "4.5" } });
    expect(field(dialog, "Threshold").value).toBe("45");

    fireEvent.click(within(dialog).getByRole("radio", { name: "High" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Rule" }));
    expect(await screen.findByText("Rule created")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await rulesNow()).find((r) => r.name === "Visa Expiry")).toMatchObject({
      key: "document_expiry.visa_expiry",
      metric: "document_expiry",
      threshold: "45",
      window_days: null,
      severity: "high",
      permission_key: "people.edit",
      enabled: true,
    });
    // The same name again is numbered on, as the server numbers a key already taken.
    const again = alerts.HomeAlertRule.parse(
      await api.call("POST /api/v1/home/alert-rules", { body: { name: "Visa Expiry", metric: "document_expiry", threshold: "30", severity: "low", permission_key: "people.edit" } }),
    );
    expect(again.key).toBe("document_expiry.visa_expiry_2");
  }, 40000);

  it("Edit Rule from an alert: the same fields but Metric, the rule's values, and Save Rule", async () => {
    await alertsAs("cynthia@mycityapp.io");
    const repeated = (await rulesNow()).find((r) => r.name === "Repeated Lateness")!;
    // Rotimi is past both late-arrival rules; this is Repeated Lateness's alert, one over its 5.
    const title = "Rotimi Alade: 6 late arrivals in 30 days";
    const row = within(list()).getAllByText(title).map((t) => t.closest("tr")!).find((tr) => within(tr).queryByText("+1"))!;
    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: title });
    expect(value(sheet, "Over By")).toBe("+1 over 5");
    fireEvent.click(within(sheet).getByRole("button", { name: "Edit Rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Rule" });
    expect(((await within(dialog).findByLabelText("Rule Name")) as HTMLInputElement).value).toBe("Repeated Lateness");
    expect(within(dialog).queryByLabelText("Metric")).toBeNull();
    expect(field(dialog, "Threshold").value).toBe("5");
    expect(field(dialog, "Window Days").value).toBe("30");
    expect(within(dialog).getByRole("radio", { name: "High" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.change(field(dialog, "Threshold"), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Rule" }));
    expect(await screen.findByText("Rule saved")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await rulesNow()).find((r) => r.home_alert_rule_id === repeated.home_alert_rule_id)).toMatchObject({ name: "Repeated Lateness", metric: "late_arrivals", threshold: "7", window_days: 30, severity: "high" });
  }, 30000);
});
