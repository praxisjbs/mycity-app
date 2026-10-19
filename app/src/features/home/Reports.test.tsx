// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import reports from "@mycity/contract/schemas/reports.js";
import type { HomeReport, HomeReportPage, HomeReportRunPage, HomeReportSummary, Me } from "@mycity/contract/contract.gen.ts";
import { formatDate, formatDateTime, ModalProvider, toast, Toaster, todayIso } from "@mycity/ui";
import { axe, axeMatchers, chooseValue, installMatchMedia, optionLabels, optionValues, setViewport } from "@mycity/ui/testing";
import { api, ApiError } from "@/api/client";
import { saveFile } from "@/api/download";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider, useRegisteredAction } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Home from "./index";
import { audienceLine, isoWeekday, scheduleLine } from "./labels";
import { changeBody, fieldOf, newReportValues, offeredSources, reportBody, reportValues, type ReportValues } from "./ReportForm";
import { awaited, runFormats } from "./Reports";

/**
 * Home · Reports on the in-browser mock (docs/guides/home.md §6 Reports, §10): the four counts,
 * a card for each report the reader may see with what its owner may do, Run Now with and without
 * a choice of format, Recent Runs in every status with Download, New Report's three steps checked
 * by the contract and the server, Edit Report, the links into the tab, and the phone's layout.
 * The mock answers in the contract's shapes, so what the screen shows is checked against what
 * the API sends.
 *
 * The mock keeps its reports and runs for the whole file, so the tests that change them come
 * last, and every figure they check is read from the API rather than assumed. A change is
 * checked on the server before its toast, so a toast is never taken for the change itself.
 */

vi.mock("@/api/download", () => ({ saveFile: vi.fn(), useFileUrl: () => null, usePhotos: () => () => null, usePhoto: () => null, clearPhotos: vi.fn() }));

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
beforeEach(() => vi.mocked(saveFile).mockClear());
afterEach(() => {
  toast.dismiss();
  cleanup();
  setViewport(1440);
  window.history.replaceState(null, "", "/home?tab=reports");
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

/** Signs in on the mock at `/home?tab=reports` (and `search`), without the tab on screen yet; `open()` puts it there. */
async function signedIn(email: string, search = "") {
  window.history.replaceState(null, "", `/home?tab=reports${search}`);
  mockSession.set(null);
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 5000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  return { open: () => rerender(app(true)) };
}

/** Signs in and waits for the tab: its counts, its cards and Recent Runs. */
async function reportsAs(email: string, search = "") {
  (await signedIn(email, search)).open();
  await screen.findByRole("heading", { level: 1, name: "Reports", hidden: true }, { timeout: 8000 });
  await waitFor(() => expect(cardTitles()).toHaveLength(4), { timeout: 8000 });
  await screen.findByRole("navigation", { name: "Recent Runs pages", hidden: true }, { timeout: 8000 });
  await waitFor(() => expect(document.querySelectorAll("article").length).toBeGreaterThan(0), { timeout: 8000 });
}

/** What the API sends whoever is signed in. */
const summaryNow = async (): Promise<HomeReportSummary> => reports.HomeReportSummary.parse(await api.call("GET /api/v1/home/reports/summary"));
const reportsNow = async (query: Record<string, string> = {}): Promise<HomeReport[]> =>
  (reports.HomeReportPage.parse(await api.call("GET /api/v1/home/reports", { query })) as HomeReportPage).data;
const runsNow = async (query: Record<string, string> = {}): Promise<HomeReportRunPage> => reports.HomeReportRunPage.parse(await api.call("GET /api/v1/home/report-runs", { query }));
const named = async (name: string) => (await reportsNow()).find((r) => r.name === name);
/** A report the reader may see, by name, which a test needs to be there. */
const mustBe = async (name: string): Promise<HomeReport> => {
  const found = await named(name);
  if (!found) throw new Error(`no report named ${name}`);
  return found;
};
/** The newest run on Recent Runs, by its number. */
const newestRun = async () => (await runsNow()).data.reduce((a, b) => (b.number > a.number ? b : a));

/** The KPI cards' titles, in the order the row shows them. */
function cardTitles(): string[] {
  const row = document.querySelector("ul.grid-cols-2");
  return row ? [...row.querySelectorAll('[data-ui="title"]')].map((t) => t.textContent!.trim()) : [];
}
/** The report cards' names, in the order the page shows them. */
const reportNames = () => [...document.querySelectorAll("article h2")].map((h) => h.textContent!.trim());
/** One report's card. */
const card = (name: string) => [...document.querySelectorAll("article")].find((a) => a.querySelector("h2")?.textContent?.trim() === name)! as HTMLElement;
const value = (root: HTMLElement, label: string) => within(root).getByText(label).nextElementSibling?.textContent;
const runsTable = () => screen.getByRole("table", { name: "Recent Runs" });
const headers = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim());
/** A toast, given the time a change takes to come back. */
const toastSaying = (text: string | RegExp) => screen.findByText(text, {}, { timeout: 5000 });

/** Opens a menu by its button, as a keyboard does, and gives back its items' words. */
async function openMenu(button: HTMLElement) {
  fireEvent.keyDown(button, { key: "Enter" });
  const menu = await screen.findByRole("menu");
  return { menu, items: within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim()) };
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
  read('[data-ui="title"]', copy.LIMITS.title, true);
  read('[data-ui="empty-text"]', copy.LIMITS.emptyText, false);
  read('[data-ui="button"]', copy.LIMITS.button, true);
  read("th", copy.LIMITS.title, true);
  read("dt", copy.LIMITS.fieldLabel, true);
  return problems;
}

const READER = { user_id: "8d2c0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f", display_name: "Ada Obi", employee_id: "1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b" };
const ALL_SOURCES = ["daily_attendance", "leave", "open_alerts", "headcount", "tasks", "partnerships", "expenses", "recruitment"];
/** A reader as offeredSources reads them: the CEO, or someone holding these capabilities. */
const reader = (capabilities: string[], is_ceo = false) => ({ is_ceo, capabilities }) as unknown as Me;

/** A saved report as the API sends it, for the form's own steps. */
function saved(over: Partial<HomeReport> = {}): HomeReport {
  return {
    saved_report_id: "0c6f7a1e-2b3c-4d5e-8f60-7a8b9c0d1e2f",
    name: "Leave This Month",
    report_key: "leave",
    filters: { leave_status: "approved" },
    shared: true,
    owner_user_id: READER.user_id,
    owner_name: READER.display_name,
    status: "scheduled",
    schedule: {
      report_schedule_id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
      recurrence: { freq: "monthly", interval: 2, by_month_day: -1, working_days_only: true },
      starts_on: "2026-09-30",
      run_time: "08:00",
      formats: ["pdf", "xlsx"],
      audience: [{ user_id: READER.user_id, display_name: "Ada Obi", email: "ada@mycityapp.io" }],
      active: true,
      last_run_at: null,
      next_run_at: "2026-11-30T07:00:00.000Z",
    },
    can_edit: true,
    archived_at: null,
    created_at: "2026-09-30T09:00:00.000Z",
    updated_at: "2026-09-30T09:00:00.000Z",
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * What the screen sends, and the form's own steps
 * ------------------------------------------------------------------ */

describe("what the screen sends", () => {
  it("runs a report in its schedule's formats, and offers both for one run on demand", () => {
    expect(runFormats(saved())).toEqual(["pdf", "xlsx"]);
    expect(runFormats(saved({ schedule: { ...saved().schedule!, formats: ["xlsx"] } }))).toEqual(["xlsx"]);
    expect(runFormats(saved({ schedule: null, status: "on_demand" }))).toEqual(["pdf", "xlsx"]);
  });

  it("waits on screen for a Pending run asked for in the last ten minutes, never one long stuck", () => {
    const now = Date.parse("2026-10-18T10:00:00Z");
    expect(awaited([{ status: "pending", run_at: "2026-10-18T09:55:00Z" }], now)).toBe(true);
    expect(awaited([{ status: "pending", run_at: "2026-10-18T09:45:00Z" }], now)).toBe(false);
    expect(awaited([{ status: "done", run_at: "2026-10-18T09:59:00Z" }, { status: "failed", run_at: "2026-10-18T09:59:00Z" }], now)).toBe(false);
  });

  it("offers the sources the reader may open, in the contract's order, and never the Overview", () => {
    expect(offeredSources(reader([], true), () => false).map(([k]) => k)).toEqual(ALL_SOURCES);
    const people = (m: string) => ["home", "people"].includes(m);
    expect(offeredSources(reader(["home.reports", "alerts.clear"]), people).map(([k, label]) => `${k} ${label}`)).toEqual([
      "daily_attendance Daily Attendance",
      "leave Leave",
      "open_alerts Open Alerts",
      "headcount Headcount",
    ]);
  });

  it("offers Open Alerts only to a reader the Alerts tab opens to, as the server does", () => {
    const everything = () => true;
    const keys = (capabilities: string[]) => offeredSources(reader(capabilities), everything).map(([k]) => k);
    expect(keys(["home.reports"])).not.toContain("open_alerts");
    expect(keys(["home.reports", "alerts.clear"])).toContain("open_alerts");
    expect(keys(["home.reports", "alerts.manage"])).toContain("open_alerts");
    expect(keys(["home.reports"])).toEqual(ALL_SOURCES.filter((k) => k !== "open_alerts"));
  });

  it("starts New Report every working day at 18:00 from today, to the reader, as a PDF, and the contract accepts it once named", () => {
    const start = newReportValues(READER, "daily_attendance", "2026-10-21");
    expect(start).toMatchObject({ repeats: "daily", working_days_only: true, run_time: "18:00", starts_on: "2026-10-21", by_weekday: [3], formats: "pdf", shared: false });
    expect(start.recipients).toEqual([READER]);
    expect(reports.HomeReportCreate.safeParse(reportBody(start)).success).toBe(false);
    const body = reportBody({ ...start, name: "  Daily Attendance  " });
    expect(body).toEqual({
      name: "Daily Attendance",
      report_key: "daily_attendance",
      filters: {},
      shared: false,
      schedule: { recurrence: { freq: "daily", working_days_only: true }, starts_on: "2026-10-21", run_time: "18:00", formats: ["pdf"], recipient_user_ids: [READER.user_id] },
    });
    expect(reports.HomeReportCreate.safeParse(body).success).toBe(true);
  });

  it("sends only the filters the source takes and the person chose, the weekly days in order, and no schedule on demand", () => {
    const v: ReportValues = { ...newReportValues(READER, "leave", "2026-10-21"), name: "Leave", leave_status: "approved", roster_status: "late", department_id: "", repeats: "weekly", by_weekday: [5, 1], working_days_only: false, formats: "both" };
    const body = reportBody(v);
    expect(body.filters).toEqual({ leave_status: "approved" });
    expect(body.schedule).toMatchObject({ recurrence: { freq: "weekly", by_weekday: [1, 5] }, formats: ["pdf", "xlsx"] });
    expect(reports.HomeReportCreate.safeParse(body).success).toBe(true);
    expect(reportBody({ ...v, repeats: "on_demand" }).schedule).toBeNull();
    // A change keeps the source, which cannot change; the rest is held to HomeReportUpdate.
    const opened = newReportValues(READER, "leave", "2026-10-21");
    expect(changeBody(v, opened)).not.toHaveProperty("report_key");
    expect(reports.HomeReportUpdate.safeParse(changeBody(v, opened)).success).toBe(true);
  });

  it("sends Edit Report's schedule only when the person changed it, so a name or sharing alone leaves it as saved", () => {
    const opened = reportValues(saved(), READER);
    expect(changeBody({ ...opened, name: "Leave Approved", shared: false }, opened)).toEqual({ name: "Leave Approved", filters: { leave_status: "approved" }, shared: false });
    expect(changeBody({ ...opened, run_time: "07:30" }, opened).schedule).toMatchObject({ run_time: "07:30", recipient_user_ids: [READER.user_id] });
    // A recipient taken off and put back is no change.
    expect(changeBody({ ...opened, recipients: opened.recipients.map((r) => ({ ...r })) }, opened)).not.toHaveProperty("schedule");
    // On Demand takes the schedule away.
    expect(changeBody({ ...opened, repeats: "on_demand" }, opened).schedule).toBeNull();
    // A report run on demand sends none while it stays so, and its new schedule when given one.
    const onDemand = reportValues(saved({ schedule: null, status: "on_demand" }), READER, "2026-10-21");
    expect(changeBody(onDemand, onDemand)).not.toHaveProperty("schedule");
    expect(changeBody({ ...onDemand, repeats: "daily" }, onDemand).schedule).toMatchObject({ recurrence: { freq: "daily", working_days_only: true }, starts_on: "2026-10-21" });
  });

  it("keeps what the form does not show of a saved rule while Repeats stays, so saving changes no schedule silently", () => {
    const v = reportValues(saved(), READER);
    expect(v).toMatchObject({ name: "Leave This Month", leave_status: "approved", repeats: "monthly", starts_on: "2026-09-30", run_time: "08:00", working_days_only: true, formats: "both" });
    expect(v.recipients).toEqual([{ user_id: READER.user_id, display_name: "Ada Obi", employee_id: null }]);
    expect(reportBody(v).schedule?.recurrence).toEqual({ freq: "monthly", interval: 2, by_month_day: -1, working_days_only: true });
    // Another rhythm is a new rule: the old interval and day of the month go with the old one.
    expect(reportBody({ ...v, repeats: "weekly", by_weekday: [2] }).schedule?.recurrence).toEqual({ freq: "weekly", by_weekday: [2], working_days_only: true });
    // A report run on demand starts a schedule as New Report would, to the reader.
    const onDemand = reportValues(saved({ schedule: null, status: "on_demand" }), READER, "2026-10-21");
    expect(onDemand).toMatchObject({ repeats: "on_demand", run_time: "18:00", starts_on: "2026-10-21", recipients: [READER] });
  });

  it("puts each problem on the field that shows it, from the contract's path or the server's", () => {
    expect(fieldOf(["name"])).toBe("name");
    expect(fieldOf(["filters", "leave_status"])).toBe("leave_status");
    expect(fieldOf(["filters", "weird"])).toBe("report_key");
    expect(fieldOf(["schedule", "recurrence", "by_weekday", 0])).toBe("by_weekday");
    expect(fieldOf(["schedule", "recurrence", "freq"])).toBe("repeats");
    expect(fieldOf(["schedule", "recurrence"])).toBe("repeats");
    expect(fieldOf("schedule.recipient_user_ids".split("."))).toBe("recipients");
    expect(fieldOf(["schedule", "formats"])).toBe("formats");
    expect(fieldOf(["schedule", "starts_on"])).toBe("starts_on");
    expect(fieldOf(["_"])).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Reading: the mock answers what the API answers, and who sees what
 * ------------------------------------------------------------------ */

describe("the mock answers what the API answers", () => {
  it.each(["cynthia", "ifeoma", "ngozi"])("the reads for %s match the contract", async (who) => {
    await signedIn(`${who}@mycityapp.io`);
    await summaryNow();
    const list = await reportsNow();
    await reportsNow({ archived: "true", mine: "true", sort: "-created_at" });
    reports.HomeReport.parse(await api.call("GET /api/v1/home/reports/:id", { params: { id: list[0].saved_report_id } }));
    const run = (await runsNow({ status: "done", format: "pdf" })).data[0];
    expect(reports.HomeReportRun.parse(await api.call("GET /api/v1/home/report-runs/:id", { params: { id: run.home_report_run_id } }))).toEqual(run);
  }, 30000);

  it("refuses Reports to a reader without home.reports, who may still export their Overview", async () => {
    await signedIn("chidera@mycityapp.io");
    for (const key of ["GET /api/v1/home/reports", "GET /api/v1/home/reports/summary", "GET /api/v1/home/report-runs"] as const) {
      await expect(api.call(key)).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.status === 403);
    }
    const run = reports.HomeReportRun.parse(await api.call("POST /api/v1/home/overview/export", { body: { format: "pdf" } }));
    expect(run).toMatchObject({ report_key: "overview", recipient_name: "Chidera Nwosu", status: "pending", document_id: null, report_schedule_id: null });
  }, 30000);

  it("answers the same Idempotency-Key with the same run, never a second file", async () => {
    await signedIn("cynthia@mycityapp.io");
    const report = await mustBe("Open Tasks");
    const press = () => api.call("POST /api/v1/home/reports/:id/run", { params: { id: report.saved_report_id }, body: { format: "pdf" }, idempotencyKey: "same-press" });
    const first = await press();
    const again = await press();
    expect(again.home_report_run_id).toBe(first.home_report_run_id);
    expect(again.number).toBe(first.number);
  }, 30000);

  it("answers Run Now pressed again while its file waits with the same run, and refuses a format the schedule does not offer", async () => {
    await signedIn("cynthia@mycityapp.io");
    const headcount = await mustBe("Headcount by Department");
    const press = () => api.call("POST /api/v1/home/reports/:id/run", { params: { id: headcount.saved_report_id }, body: { format: "pdf" } });
    const first = await press();
    expect(first).toMatchObject({ status: "pending", document_id: null });
    expect((await press()).home_report_run_id).toBe(first.home_report_run_id);

    // Daily Attendance is scheduled as a PDF only.
    const daily = await mustBe("Daily Attendance");
    await expect(api.call("POST /api/v1/home/reports/:id/run", { params: { id: daily.saved_report_id }, body: { format: "xlsx" } })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 422 && e.fields.format?.[0] === "Not offered",
    );
  }, 30000);
});

describe("Home · Reports, by who is reading", () => {
  it("Operations: the four counts, every report it may see with its schedule and audience, and Recent Runs", async () => {
    await reportsAs("cynthia@mycityapp.io");
    const summary = await summaryNow();
    const list = await reportsNow();
    expect(cardTitles()).toEqual(["Scheduled", "Paused", "Runs This Month", "Recipients"]);
    expect([...document.querySelector("ul.grid-cols-2")!.children].map((c) => c.textContent)).toEqual([
      `Scheduled${summary.scheduled}`,
      `Paused${summary.paused}`,
      `Runs This Month${summary.runs_this_month}`,
      `Recipients${summary.recipients}`,
    ]);
    // By name, the archived one left out; another's shared report is there too.
    expect(reportNames()).toEqual(list.map((r) => r.name));
    expect(reportNames()).toEqual([...reportNames()].sort((a, b) => a.localeCompare(b)));
    expect(reportNames()).not.toContain("Studio Hours");
    expect(reportNames()).toContain("Partnership Pipeline");

    const daily = card("Daily Attendance");
    expect(within(daily).getByText("Scheduled")).toBeTruthy();
    expect(value(daily, "Source")).toBe("Daily Attendance");
    expect(value(daily, "Schedule")).toBe("Every working day at 18:00");
    expect(value(daily, "Audience")).toBe("Cynthia Osakunih, Ifeoma Chukwu and Damilola Eke");
    expect(within(card("Open High Alerts")).getByText("Paused")).toBeTruthy();
    const onDemand = card("Headcount by Department");
    expect(within(onDemand).getByText("On Demand")).toBeTruthy();
    expect(within(within(onDemand).getByText("Schedule").nextElementSibling as HTMLElement).getByRole("img", { name: "Not set" })).toBeTruthy();

    // Its own reports carry its actions; another's carry only Run Now.
    expect(within(daily).getByRole("button", { name: "Actions for Daily Attendance" })).toBeTruthy();
    expect(within(card("Partnership Pipeline")).queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect(within(card("Partnership Pipeline")).getByRole("button", { name: "Run Now" })).toBeTruthy();

    expect(headers(runsTable())).toEqual(["Number", "Report", "Run", "Recipient", "Format", "Status"]);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);

  it("the CEO may change every report; a Head of Department sees their own and the shared ones they may open", async () => {
    await reportsAs("ifeoma@mycityapp.io");
    expect(value(card("Monthly Expenses"), "Schedule")).toBe("Monthly on the last day at 17:00");
    expect(reportNames()).toContain("Recruitment Pipeline");
    for (const name of reportNames()) expect(within(card(name)).getByRole("button", { name: `Actions for ${name}` })).toBeTruthy();
    cleanup();

    await reportsAs("ngozi@mycityapp.io");
    // Recruitment is shared, but she may not open its source; Monthly Expenses and Open Tasks are private.
    expect(reportNames()).toEqual(["Daily Attendance", "Headcount by Department", "Leave This Month", "Open High Alerts", "Partnership Pipeline"]);
    expect(reportNames().filter((name) => within(card(name)).queryByRole("button", { name: `Actions for ${name}` }))).toEqual(["Partnership Pipeline"]);
    // The server refuses a change to another's report however it is asked.
    const daily = await mustBe("Daily Attendance");
    await expect(api.call("PATCH /api/v1/home/reports/:id/schedule", { params: { id: daily.saved_report_id }, body: { active: false } })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && e.status === 403,
    );
    expect(copyProblems()).toEqual([]);
  }, 30000);
});

describe("Recent Runs", () => {
  it("lists the files newest first, in every state, paged at 25, and downloads a finished one", async () => {
    await reportsAs("cynthia@mycityapp.io");
    const page = await runsNow();
    expect(page.page.total).toBeGreaterThan(25);
    expect(within(screen.getByRole("navigation", { name: "Recent Runs pages" })).getByText(`1 to 25 of ${page.page.total} runs`)).toBeTruthy();
    const rows = () => within(runsTable()).getAllByRole("row").slice(1);
    await waitFor(() => expect(rows()).toHaveLength(25));
    const cells = (i: number) => within(rows()[i]).getAllByRole("cell").map((c) => c.textContent);
    page.data.forEach((run, i) => expect(cells(i).slice(0, 5)).toEqual([run.number, run.report_name, formatDateTime(run.run_at), run.recipient_name, run.format.toUpperCase()]));
    // Day first, then the time in Lagos.
    expect(cells(0)[2]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

    // Pending, Failed and a Download on the first page; Skipped further back.
    const statuses = rows().map((r) => within(r).getAllByRole("cell")[5].textContent);
    expect(statuses).toContain("Pending");
    expect(statuses).toContain("Failed");
    expect(statuses).toContain("Download");
    const download = within(runsTable()).getAllByRole("button", { name: /^Download RPT-\d{4}$/ })[0];
    const done = page.data.find((r) => `Download ${r.number}` === download.getAttribute("aria-label"))!;
    expect(done.status).toBe("done");
    fireEvent.click(download);
    expect(saveFile).toHaveBeenCalledWith(`/api/v1/documents/${done.document_id}/content`, `${done.number}.${done.format}`);

    fireEvent.click(within(screen.getByRole("navigation", { name: "Recent Runs pages" })).getByRole("button", { name: /Next/ }));
    await waitFor(() => expect(rows().map((r) => within(r).getAllByRole("cell")[5].textContent)).toContain("Skipped"));
    // Nothing that is not there to download offers it.
    for (const row of rows()) if (within(row).queryByText(/Pending|Failed|Skipped/)) expect(within(row).queryByRole("button")).toBeNull();
  }, 30000);
});

describe("links into the tab", () => {
  it("?id= opens that report once it is read, with its owner and next run, and closing it takes the link out", async () => {
    await signedIn("cynthia@mycityapp.io");
    const daily = await mustBe("Daily Attendance");
    cleanup();
    (await signedIn("cynthia@mycityapp.io", `&id=${daily.saved_report_id}`)).open();
    const sheet = await screen.findByRole("dialog", { name: "Daily Attendance" }, { timeout: 8000 });
    expect(value(sheet, "Schedule")).toBe("Every working day at 18:00");
    expect(value(sheet, "Owner")).toBe("Cynthia Osakunih");
    expect(value(sheet, "Next Run")).toMatch(/^\d{2}\/\d{2}\/\d{4} 18:00$/);
    expect(within(sheet).getByRole("button", { name: "Run Now" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Actions for Daily Attendance" })).toBeTruthy();
    expect(await axe(document.body)).toHaveNoViolations();
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Close" }).find((b) => b.textContent?.trim() === "Close")!);
    await waitFor(() => expect(window.location.search).toBe("?tab=reports"));
  }, 30000);

  it("?id= for an archived report opens it as Archived, with nothing to run or change", async () => {
    await signedIn("cynthia@mycityapp.io");
    const studio = (await reportsNow({ archived: "true" })).find((r) => r.name === "Studio Hours")!;
    cleanup();
    (await signedIn("cynthia@mycityapp.io", `&id=${studio.saved_report_id}`)).open();
    const sheet = await screen.findByRole("dialog", { name: "Studio Hours" }, { timeout: 8000 });
    expect(value(sheet, "Status")).toBe("Archived");
    expect(within(sheet).queryByRole("button", { name: "Run Now" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect(within(sheet).getAllByRole("button", { name: "Close" }).some((b) => b.textContent?.trim() === "Close")).toBe(true);
  }, 30000);

  it("?id= for a report the reader may not see says so and leaves the address", async () => {
    await signedIn("cynthia@mycityapp.io");
    const privateOne = await mustBe("Open Tasks");
    cleanup();
    await reportsAs("ngozi@mycityapp.io", `&id=${privateOne.saved_report_id}`);
    expect(await toastSaying("Report not found")).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe("?tab=reports"));
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 30000);

  it("?run= opens that run however far back it is, with Download once done, and closing it takes the link out", async () => {
    await signedIn("cynthia@mycityapp.io");
    // A run past Recent Runs' first page, as ⌘K finds them by number.
    const run = (await runsNow({ page: "2" })).data.find((r) => r.status === "done")!;
    expect((await runsNow()).data.map((r) => r.home_report_run_id)).not.toContain(run.home_report_run_id);
    cleanup();
    await reportsAs("cynthia@mycityapp.io", `&run=${run.home_report_run_id}`);
    const sheet = await screen.findByRole("dialog", { name: run.number }, { timeout: 8000 });
    expect(value(sheet, "Report")).toBe(run.report_name);
    expect(value(sheet, "Run")).toBe(formatDateTime(run.run_at));
    expect(value(sheet, "Recipient")).toBe(run.recipient_name);
    expect(value(sheet, "Format")).toBe(run.format.toUpperCase());
    expect(value(sheet, "Status")).toBe("Done");
    fireEvent.click(within(sheet).getByRole("button", { name: `Download ${run.number}` }));
    expect(saveFile).toHaveBeenCalledWith(`/api/v1/documents/${run.document_id}/content`, `${run.number}.${run.format}`);
    expect(copyProblems(sheet)).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Close" }).find((b) => b.textContent?.trim() === "Close")!);
    await waitFor(() => expect(window.location.search).toBe("?tab=reports"));
  }, 30000);

  it("?run= for a run with no file shows its status, with nothing to download", async () => {
    await signedIn("cynthia@mycityapp.io");
    const run = (await runsNow({ status: "failed" })).data[0];
    cleanup();
    await reportsAs("cynthia@mycityapp.io", `&run=${run.home_report_run_id}`);
    const sheet = await screen.findByRole("dialog", { name: run.number }, { timeout: 8000 });
    expect(value(sheet, "Status")).toBe("Failed");
    expect(within(sheet).queryByRole("button", { name: /^Download/ })).toBeNull();
  }, 30000);

  it("?run= for a run the reader may not see says so and leaves the address", async () => {
    await signedIn("cynthia@mycityapp.io");
    // Late Arrivals is Cynthia's private report, sent to her alone.
    const theirs = (await runsNow({ saved_report_id: (await mustBe("Late Arrivals")).saved_report_id })).data[0];
    cleanup();
    await reportsAs("ngozi@mycityapp.io", `&run=${theirs.home_report_run_id}`);
    expect(await toastSaying("Run not found")).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe("?tab=reports"));
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 30000);

  it("?action=new opens New Report, once, and the floating button offers it", async () => {
    (await signedIn("cynthia@mycityapp.io", "&action=new")).open();
    expect(await screen.findByRole("dialog", { name: "New Report" }, { timeout: 8000 })).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe("?tab=reports"));
    expect(fab?.label).toBe("New Report");
  }, 30000);
});

describe("on a phone", () => {
  it("lays the counts two to a row, the reports one to a row, and each run as a card without its format", async () => {
    setViewport(390);
    await reportsAs("cynthia@mycityapp.io");
    expect(document.querySelector("ul.grid-cols-2")?.children).toHaveLength(4);
    expect(document.querySelector("table")).toBeNull();
    const first = (await runsNow()).data[0];
    const runCard = (await screen.findByText(first.number)).closest("li")!;
    expect(within(runCard).getByText(first.report_name)).toBeTruthy();
    for (const label of ["Run", "Recipient", "Status"]) expect(within(runCard).getByText(label)).toBeTruthy();
    expect(within(runCard).queryByText("Format")).toBeNull();
    // Run Now sits on each report card, and New Report waits in the floating button's fan.
    expect(within(card("Daily Attendance")).getByRole("button", { name: "Run Now" })).toBeTruthy();
    expect(fab?.label).toBe("New Report");
    expect(copyProblems()).toEqual([]);
  }, 30000);
});

/* ------------------------------------------------------------------ *
 * Changing things: these run last, since the mock keeps what they change
 * ------------------------------------------------------------------ */

describe("Run Now", () => {
  it("runs a report with one format at once, toasted with the run's number, which waits in Recent Runs as Pending", async () => {
    await reportsAs("cynthia@mycityapp.io");
    const before = (await runsNow()).page.total;
    const runNow = () => within(card("Daily Attendance")).getByRole("button", { name: "Run Now" });
    fireEvent.click(runNow());
    await waitFor(async () => expect((await runsNow()).page.total).toBe(before + 1));
    const run = await newestRun();
    expect(run).toMatchObject({ report_name: "Daily Attendance", format: "pdf", status: "pending", document_id: null, recipient_name: "Cynthia Osakunih" });

    // Pressed again while the file waits: the same run, no second file.
    await waitFor(() => expect(runNow().getAttribute("aria-busy")).not.toBe("true"));
    fireEvent.click(runNow());
    await waitFor(() => expect(screen.getAllByText(`${run.number} queued`)).toHaveLength(2), { timeout: 5000 });
    expect((await runsNow()).page.total).toBe(before + 1);
    const row = (await within(runsTable()).findByText(run.number)).closest("tr")!;
    expect(within(row).getByText("Pending")).toBeTruthy();
  }, 30000);

  it("asks the format when the report has both, or runs on demand, and runs the one chosen", async () => {
    await reportsAs("cynthia@mycityapp.io");
    const { menu, items } = await openMenu(within(card("Leave This Month")).getByRole("button", { name: "Run Now" }));
    expect(items).toEqual(["Run as PDF", "Run as XLSX"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Run as XLSX" }));
    await waitFor(async () => expect(await newestRun()).toMatchObject({ report_name: "Leave This Month", format: "xlsx", status: "pending" }));
    const run = await newestRun();
    expect(await toastSaying(`${run.number} queued`)).toBeTruthy();

    expect((await openMenu(within(card("Headcount by Department")).getByRole("button", { name: "Run Now" }))).items).toEqual(["Run as PDF", "Run as XLSX"]);
  }, 30000);
});

describe("Pause Report, Resume Report and Archive Report", () => {
  it("pauses a running report and resumes it, the counts moving with it", async () => {
    await reportsAs("cynthia@mycityapp.io");
    const before = await summaryNow();
    const { menu, items } = await openMenu(within(card("Late Arrivals")).getByRole("button", { name: "Actions for Late Arrivals" }));
    expect(items).toEqual(["Edit Report", "Pause Report", "Archive Report"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Pause Report" }));
    await waitFor(async () => expect((await mustBe("Late Arrivals")).schedule).toMatchObject({ active: false, next_run_at: null }));
    expect(await toastSaying("Report paused")).toBeTruthy();
    await waitFor(() => expect(within(card("Late Arrivals")).getByText("Paused")).toBeTruthy());
    expect(await summaryNow()).toMatchObject({ scheduled: before.scheduled - 1, paused: before.paused + 1 });

    const again = await openMenu(within(card("Late Arrivals")).getByRole("button", { name: "Actions for Late Arrivals" }));
    expect(again.items).toEqual(["Edit Report", "Resume Report", "Archive Report"]);
    fireEvent.click(within(again.menu).getByRole("menuitem", { name: "Resume Report" }));
    await waitFor(async () => expect((await mustBe("Late Arrivals")).schedule?.active).toBe(true));
    expect(await toastSaying("Report resumed")).toBeTruthy();
    await waitFor(() => expect(within(card("Late Arrivals")).getByText("Scheduled")).toBeTruthy());
    expect(await summaryNow()).toMatchObject({ scheduled: before.scheduled, paused: before.paused });
  }, 30000);

  it("asks before archiving, naming what happens; Cancel keeps it, Archive Report takes it off the list and keeps its runs", async () => {
    await reportsAs("cynthia@mycityapp.io");
    const target = await mustBe("Recruitment Pipeline");
    const ask = async () => {
      const { menu } = await openMenu(within(card("Recruitment Pipeline")).getByRole("button", { name: "Actions for Recruitment Pipeline" }));
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Archive Report" }));
      return screen.findByRole("alertdialog", { name: "Archive Report" });
    };
    let dialog = await ask();
    expect(within(dialog).getByText("It stops running and leaves this list. Its runs stay.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(reportNames()).toContain("Recruitment Pipeline");
    expect(await named("Recruitment Pipeline")).toMatchObject({ archived_at: null });

    dialog = await ask();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive Report" }));
    await waitFor(() => expect(reportNames()).not.toContain("Recruitment Pipeline"));
    expect(await toastSaying("Report archived")).toBeTruthy();
    const archived = (await reportsNow({ archived: "true" })).find((r) => r.saved_report_id === target.saved_report_id);
    expect(archived).toMatchObject({ status: "paused" });
    expect(archived?.archived_at).not.toBeNull();
  }, 30000);
});

describe("New Report and Edit Report", () => {
  const dialogNamed = (name: string) => screen.findByRole("dialog", { name });
  const step = (dialog: HTMLElement) => within(dialog).getByRole("heading", { level: 3 }).textContent;
  const press = (dialog: HTMLElement, name: string) => fireEvent.click(within(dialog).getByRole("button", { name }));
  /** A field by its label: the label, its control and its error. Found again each time, since the wizard starts over on a step the server marks. */
  const fieldNamed = (dialog: HTMLElement, label: string) => within(dialog).getByText(label, { selector: "label" }).parentElement!.parentElement!;
  /** Finds a colleague on the server and adds them as a recipient. */
  async function addRecipient(dialog: HTMLElement, name: string) {
    fireEvent.change(within(dialog).getByPlaceholderText("Search people"), { target: { value: name.split(" ")[0] } });
    // The server narrows the list as she types; she picks from what it answers.
    await waitFor(() => expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining(name)]), { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole("option", { name: new RegExp(name) }));
    expect(await within(dialog).findByRole("button", { name: `Remove ${name}` }, { timeout: 5000 })).toBeTruthy();
  }

  it("walks the three steps, checked by the contract and the server, and creates the report", async () => {
    await reportsAs("cynthia@mycityapp.io");
    fireEvent.click(screen.getByRole("button", { name: "New Report" }));
    const dialog = await dialogNamed("New Report");
    expect(step(dialog)).toBe("Report");
    const source = within(dialog).getByLabelText("Source") as HTMLButtonElement;
    expect(await optionValues(source)).toEqual(ALL_SOURCES);

    // Nothing named: the step marks it and does not move on.
    press(dialog, "Next");
    expect(await within(dialog).findByText("Required")).toBeTruthy();
    expect(step(dialog)).toBe("Report");

    // A source's own filters: Leave takes a status and a type.
    await chooseValue(source, "leave");
    await within(dialog).findByLabelText("Leave Type");
    expect(await optionLabels(within(dialog).getByLabelText("Status"))).toEqual(["Every Status", "Submitted", "Approved", "Rejected", "Cancelled"]);
    await chooseValue(within(dialog).getByLabelText("Status"), "approved");
    fireEvent.change(within(dialog).getByLabelText("Report Name"), { target: { value: "Approved Leave" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Share With Managers" }));
    expect(copyProblems(dialog)).toEqual([]);
    press(dialog, "Next");

    // Schedule: Weekly asks for its days, today's ticked; none ticked is refused.
    await waitFor(() => expect(step(dialog)).toBe("Schedule"));
    expect(within(dialog).getByRole("radio", { name: "Daily" }).getAttribute("aria-checked")).toBe("true");
    expect((within(dialog).getByLabelText("Time") as HTMLInputElement).value).toBe("18:00");
    expect((within(dialog).getByLabelText("Start Date") as HTMLInputElement).value).toBe(formatDate(todayIso()));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Weekly" }));
    const today = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][isoWeekday(todayIso()) - 1];
    const day = await within(dialog).findByRole("checkbox", { name: today });
    expect(day.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(day);
    press(dialog, "Next");
    expect(await within(dialog).findByText("Pick a day")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Mon" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Fri" }));
    press(dialog, "Next");

    // Delivery: the reader first; nobody is refused by the contract.
    await waitFor(() => expect(step(dialog)).toBe("Delivery"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Cynthia Osakunih" }));
    press(dialog, "Create Report");
    expect(await within(dialog).findByText("Add a recipient")).toBeTruthy();

    // Someone without Reports is refused by the server, by name on Recipients, and nothing is made.
    await addRecipient(dialog, "Chidera Nwosu");
    press(dialog, "Create Report");
    await waitFor(() => expect(within(fieldNamed(dialog, "Recipients")).getByText("Chidera Nwosu: no access")).toBeTruthy(), { timeout: 5000 });
    expect(step(dialog)).toBe("Delivery");
    expect(await named("Approved Leave")).toBeUndefined();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Chidera Nwosu" }));
    await addRecipient(dialog, "Ngozi Eze");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Both" }));
    expect(await axe(document.body)).toHaveNoViolations();
    press(dialog, "Create Report");

    await waitFor(async () => expect(await named("Approved Leave")).toBeDefined(), { timeout: 5000 });
    expect(await toastSaying("Report created")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const made = await mustBe("Approved Leave");
    expect(made).toMatchObject({ report_key: "leave", filters: { leave_status: "approved" }, shared: true, status: "scheduled", can_edit: true });
    expect(made.schedule).toMatchObject({ recurrence: { freq: "weekly", by_weekday: [1, 5] }, run_time: "18:00", formats: ["pdf", "xlsx"] });
    expect(made.schedule?.audience.map((a) => a.display_name)).toEqual(["Ngozi Eze"]);
    await waitFor(() => expect(reportNames()).toContain("Approved Leave"));
    expect(value(card("Approved Leave"), "Schedule")).toBe("Mondays and Fridays at 18:00");
  }, 60000);

  it("On Demand has no Delivery step and creates from the Schedule step; a name already used goes back to it", async () => {
    await reportsAs("cynthia@mycityapp.io");
    fireEvent.click(screen.getByRole("button", { name: "New Report" }));
    const dialog = await dialogNamed("New Report");
    fireEvent.change(within(dialog).getByLabelText("Report Name"), { target: { value: "Daily Attendance" } });
    press(dialog, "Next");
    await waitFor(() => expect(step(dialog)).toBe("Schedule"));
    fireEvent.click(within(dialog).getByRole("radio", { name: "On Demand" }));
    await waitFor(() => expect(within(dialog).queryByLabelText("Time")).toBeNull());
    expect(within(dialog).getByText("Step 2 of 2")).toBeTruthy();
    press(dialog, "Create Report");
    // The server knows the name; the form goes back to the step that holds it, and marks it there.
    expect(await within(dialog).findByText("Name already used", {}, { timeout: 5000 })).toBeTruthy();
    expect(step(dialog)).toBe("Report");
    fireEvent.change(within(dialog).getByLabelText("Report Name"), { target: { value: "Attendance Now" } });
    press(dialog, "Next");
    await waitFor(() => expect(step(dialog)).toBe("Schedule"));
    press(dialog, "Create Report");
    await waitFor(async () => expect(await named("Attendance Now")).toMatchObject({ status: "on_demand", schedule: null }), { timeout: 5000 });
    expect(await toastSaying("Report created")).toBeTruthy();
    await waitFor(() => expect(reportNames()).toContain("Attendance Now"));
    expect(within(card("Attendance Now")).getByText("On Demand")).toBeTruthy();
  }, 60000);

  it("Edit Report fills the form, offers no Source, and saves the change keeping the rest of the rule", async () => {
    await reportsAs("cynthia@mycityapp.io");
    const { menu } = await openMenu(within(card("Leave This Month")).getByRole("button", { name: "Actions for Leave This Month" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit Report" }));
    const dialog = await dialogNamed("Edit Report");
    expect((within(dialog).getByLabelText("Report Name") as HTMLInputElement).value).toBe("Leave This Month");
    expect(within(dialog).queryByLabelText("Source")).toBeNull();
    expect((within(dialog).getByLabelText("Status") as HTMLButtonElement).value).toBe("approved");
    press(dialog, "Next");
    await waitFor(() => expect(step(dialog)).toBe("Schedule"));
    expect(within(dialog).getByRole("radio", { name: "Monthly" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(within(dialog).getByLabelText("Time"), { target: { value: "07:30" } });
    press(dialog, "Next");
    await waitFor(() => expect(step(dialog)).toBe("Delivery"));
    expect(within(dialog).getByRole("button", { name: "Remove Musa Olawale" })).toBeTruthy();
    expect(within(dialog).getByRole("radio", { name: "Both" }).getAttribute("aria-checked")).toBe("true");
    press(dialog, "Save Report");
    await waitFor(async () => expect((await mustBe("Leave This Month")).schedule?.run_time).toBe("07:30"), { timeout: 5000 });
    expect(await toastSaying("Report saved")).toBeTruthy();
    const after = await mustBe("Leave This Month");
    expect(after.schedule).toMatchObject({ run_time: "07:30", recurrence: { freq: "monthly", by_month_day: 1 }, active: true });
    expect(after.schedule?.audience.map((a) => a.display_name)).toEqual(["Cynthia Osakunih", "Ngozi Eze", "Musa Olawale"]);
    await waitFor(() => expect(value(card("Leave This Month"), "Schedule")).toBe("Monthly on the 1st at 07:30"));
  }, 60000);

  it("Edit Report sends the schedule only when it changed, and names on Recipients someone it adds who may not have it", async () => {
    await reportsAs("cynthia@mycityapp.io");
    // What the server is sent: the mock holds every PATCH body to the contract's own rule.
    const sent = vi.spyOn(reports.HomeReportUpdate, "safeParse");
    const lastSent = () => sent.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const edit = async () => {
      const { menu } = await openMenu(within(card("Leave This Month")).getByRole("button", { name: "Actions for Leave This Month" }));
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit Report" }));
      return dialogNamed("Edit Report");
    };
    const toDelivery = async (dialog: HTMLElement) => {
      press(dialog, "Next");
      await waitFor(() => expect(step(dialog)).toBe("Schedule"));
      press(dialog, "Next");
      await waitFor(() => expect(step(dialog)).toBe("Delivery"));
    };
    try {
      // Musa Olawale has been suspended since it was scheduled: his runs are skipped, and it still saves.
      const before = await mustBe("Leave This Month");
      expect(before.schedule?.audience.map((a) => a.display_name)).toContain("Musa Olawale");
      let dialog = await edit();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Share With Managers" }));
      await toDelivery(dialog);
      press(dialog, "Save Report");
      await waitFor(async () => expect((await mustBe("Leave This Month")).shared).toBe(false), { timeout: 5000 });
      expect(await toastSaying("Report saved")).toBeTruthy();
      expect(lastSent()).toEqual({ name: "Leave This Month", filters: { leave_status: "approved" }, shared: false });
      expect((await mustBe("Leave This Month")).schedule).toEqual(before.schedule);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      // Someone added is checked, and refused by name on Recipients; Musa, already on it, is not.
      dialog = await edit();
      await toDelivery(dialog);
      await addRecipient(dialog, "Chidera Nwosu");
      press(dialog, "Save Report");
      await waitFor(() => expect(within(fieldNamed(dialog, "Recipients")).getByText("Chidera Nwosu: no access")).toBeTruthy(), { timeout: 5000 });
      expect(within(dialog).queryByText(/Musa Olawale cannot/)).toBeNull();
      expect(step(dialog)).toBe("Delivery");
      expect(lastSent()).toHaveProperty("schedule");
      expect((await mustBe("Leave This Month")).schedule).toEqual(before.schedule);
    } finally {
      sent.mockRestore();
    }
  }, 60000);
});

describe("who receives a report", () => {
  it("a private report reaches the people it goes to, who may run it but not change it", async () => {
    await signedIn("cynthia@mycityapp.io");
    const ngozi = (await mustBe("Leave This Month")).schedule!.audience.find((a) => a.display_name === "Ngozi Eze")!;
    await api.call("POST /api/v1/home/reports", {
      body: {
        name: "Leave For Ngozi",
        report_key: "leave",
        filters: {},
        shared: false,
        schedule: { recurrence: { freq: "daily", working_days_only: true }, starts_on: todayIso(), run_time: "08:00", formats: ["pdf"], recipient_user_ids: [ngozi.user_id] },
      },
    });
    cleanup();

    await reportsAs("ngozi@mycityapp.io");
    await waitFor(() => expect(reportNames()).toContain("Leave For Ngozi"));
    const received = card("Leave For Ngozi");
    expect(value(received, "Audience")).toBe("Ngozi Eze");
    expect(within(received).getByRole("button", { name: "Run Now" })).toBeTruthy();
    expect(within(received).queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect((await reportsNow({ mine: "true" })).map((r) => r.name)).toContain("Leave For Ngozi");
  }, 30000);
});

describe("the words on a card", () => {
  it("reads a schedule and its audience as the card shows them", () => {
    expect(scheduleLine(saved().schedule!)).toBe("Every 2 months on the last day at 08:00");
    expect(audienceLine(saved().schedule!.audience)).toBe("Ada Obi");
  });
});
