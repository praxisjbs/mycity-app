// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import dashboard from "@mycity/contract/schemas/dashboard.js";
import reports from "@mycity/contract/schemas/reports.js";
import workflow from "@mycity/contract/schemas/workflow.js";
import { formatTime, ModalProvider, Toaster } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Home from "./index";

/**
 * Home · Overview on the in-browser mock (docs/guides/home.md §10): each Home view draws its
 * own sections and nothing a guide keeps off a screen; Choose Cards; the records behind a card;
 * the Overview read again after a clock-in; Export; the phone's layout. The screen gates crawl Operations only (FRONTEND_GUIDE
 * §9.4), so the CEO, Partnerships and Staff Overviews are held to the copy rules here.
 *
 * The clock is a Monday morning in Lagos, a working day, whatever day the suite runs.
 */

expect.extend(axeMatchers);
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
  vi.setSystemTime(new Date("2026-10-19T07:30:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  setViewport(1440);
  window.history.replaceState(null, "", "/home?tab=overview");
});

let auth: ReturnType<typeof useAuth> | null = null;
/** Home while the address is Home's, on the tab it names; another module's screen is not this test's. */
function Screen() {
  const { location } = useRouter();
  return location.module === "home" ? <Home tab={location.tab ?? "overview"} id={location.id} /> : null;
}
/** The app as the shell holds it; the screen mounts once `show` is set, after signing in. */
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

/** Signs in on the mock without the Overview on screen yet; `show()` puts it there. */
async function signedIn(email: string, at = "/home?tab=overview") {
  window.history.replaceState(null, "", at);
  mockSession.set(null);
  // The reads' cache is kept by path, not by person: start each person from the server.
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 15000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  return {
    /** Puts the Overview on screen. */
    show: async () => {
      rerender(app(true));
      // A dialog the screen opens by itself hides the page from the accessibility tree: look past it.
      await screen.findByRole("heading", { level: 1, name: /^Good Morning, /, hidden: true }, { timeout: 8000 });
      // Every section has painted once the week has.
      await screen.findByRole("heading", { name: "Your Week", hidden: true }, { timeout: 8000 });
    },
  };
}

/** Signs in on the mock and waits for the Overview. */
async function overviewAs(email: string, at?: string) {
  await (await signedIn(email, at)).show();
}

/** Opens a link on the screen in view, as the address bar or a ⌘K result would. */
const go = (to: string) =>
  act(() => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

/** The section and card titles on the page, in order. */
const headings = () => screen.getAllByRole("heading").map((h) => h.textContent?.trim());

/** The KPI cards' titles, in the order the row shows them. */
function cardTitles(): string[] {
  const row = document.querySelector("ul.grid-cols-2");
  return row ? [...row.querySelectorAll('[data-ui="title"]')].map((t) => t.textContent!.trim()) : [];
}

/* The copy rules the screen gates hold the crawled screens to (scripts/check/lib/copy.js). */
const MINOR = new Set("a an and as at but by for from in into nor of on onto or per the to vs via with".split(" "));
const wordsOf = (t: string) => t.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
function titleCased(t: string): boolean {
  return wordsOf(t).every((word, i) => {
    if (/[\d.@/]/.test(word)) return true;
    return word.split("-").every((part, j) => {
      const bare = part.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (!bare || bare === bare.toUpperCase()) return true;
      if ((i > 0 || j > 0) && MINOR.has(bare.toLowerCase())) return true;
      return bare[0] === bare[0].toUpperCase();
    });
  });
}
function copyProblems(root: ParentNode = document.body): string[] {
  const problems: string[] = [];
  const read = (selector: string, limit: number, chrome: boolean) => {
    for (const el of root.querySelectorAll(selector)) {
      if (el.closest('[data-copy="content"]')) continue;
      const t = el.textContent?.trim() ?? "";
      if (wordsOf(t).length > limit) problems.push(`${selector} over ${limit} words: "${t}"`);
      if (chrome && !titleCased(t)) problems.push(`${selector} not Title Case: "${t}"`);
      if (chrome && (/^(how|why|what|when|where|about)\b/i.test(t) || /\b(is|are|isn't|aren't)\b/i.test(t))) problems.push(`${selector} explains: "${t}"`);
      if (/[—–]/.test(t)) problems.push(`${selector} has a dash: "${t}"`);
    }
  };
  read('[data-ui="page-title"]', 3, true);
  read('[data-ui="page-subtitle"]', 8, false);
  read('[data-ui="title"]', 4, true);
  read('[data-ui="kpi-caption"]', 5, false);
  read('[data-ui="chart-caption"]', 8, false);
  read('[data-ui="empty-text"]', 8, false);
  return problems;
}

/** Lines the earlier, server-written Overview carried that are tier 3 (home.md §10.1): never on a screen. */
const TIER_3 = /Your own attendance is in|live in My Workspace|threshold the rule watches|Grouped the way|Raised by the rule|Posted automatically|Weighted across departments/;

describe("a clock-in", () => {
  it("reads the Overview again: the day strip shows the punch", async () => {
    // Precious has not clocked in today, and no other case here signs her in.
    await overviewAs("precious@mycityapp.io");
    const strip = () => within(screen.getByRole("list", { name: "Your Day", hidden: true }));
    expect(strip().getByText("Not In")).toBeTruthy();
    // As the clock panel does after a punch: record it, then reload attendance's reads.
    await act(async () => {
      await api.call("POST /api/v1/attendance/punches", {
        body: { event_type: "clock_in", device_at: new Date().toISOString(), latitude: null, longitude: null, accuracy_m: null, location_error: "denied" },
        idempotencyKey: crypto.randomUUID(),
      });
      invalidate("/api/v1/attendance");
    });
    const today = dashboard.HomeOverview.parse(await api.call("GET /api/v1/home/overview")).day_strip!;
    expect(today.clock_in_at).not.toBeNull();
    await waitFor(() => expect(strip().getByText(formatTime(today.clock_in_at!))).toBeTruthy());
    expect(strip().queryByText("Not In")).toBeNull();
  }, 30000);
});

describe("Home · Overview, by Home view", () => {
  it("Operations: the greeting and date, its cards, the attendance chart and On Time, Need You, the pipeline, goals, activity and the week", async () => {
    await overviewAs("cynthia@mycityapp.io");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Good Morning, Cynthia");
    expect(document.querySelector('[data-ui="page-subtitle"]')?.textContent).toMatch(/^Monday 19\/10\/2026 · \d+ of \d+ clocked in$/);
    // Operations & People's own cards, Clocked In Today locked first.
    expect(cardTitles()).toEqual(["Clocked In Today", "Overdue Tasks", "Expenses Awaiting Approval", "Active Partnerships"]);
    const h = headings();
    for (const title of ["Attendance, 14 Working Days", "On Time", "Partnership Pipeline", "Need You", "Goals This Quarter", "Activity Today", "Your Week"]) expect(h).toContain(title);
    for (const title of ["My Goals This Quarter", "Upcoming Leave", "Organisational Goals", "Org KPI", "Monthly Signed Value"]) expect(h).not.toContain(title);
    expect(screen.queryByRole("list", { name: "Your Day" })).toBeNull();
    expect(screen.getByText("Dips are Saturdays, a half day")).toBeTruthy();
    // Need You: the leave requests waiting on Cynthia as line manager, a table on desktop.
    expect(await screen.findByRole("cell", { name: "Bashir Lawal" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(document.body.textContent).not.toMatch(TIER_3);
  }, 30000);

  it("CEO: Organisational Goals and the Org KPI with their scores, Goals On Track first, and no attendance chart", async () => {
    await overviewAs("ifeoma@mycityapp.io");
    const h = headings();
    for (const title of ["Organisational Goals", "Org KPI", "Partnership Pipeline", "Need You", "Activity Today", "Your Week"]) expect(h).toContain(title);
    // The goals are the CEO's chart, so Goals This Quarter is not drawn twice.
    for (const title of ["Attendance, 14 Working Days", "On Time", "Goals This Quarter", "My Goals This Quarter", "Upcoming Leave"]) expect(h).not.toContain(title);
    expect(cardTitles()).toEqual(["Goals On Track", "Awaiting Your Approval", "Signed Value", "Open High Alerts"]);
    // The CEO clears alerts: Need You says how many wait, beside the requests: here a target change to decide.
    expect(await screen.findByText("Target Change")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Clear \d+ Alerts?$/ })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(document.body.textContent).not.toMatch(TIER_3);
  }, 30000);

  it("Partnerships: Monthly Signed Value, the pipeline with its quiet partners, goals, and their own Need You", async () => {
    await overviewAs("ngozi@mycityapp.io");
    const h = headings();
    for (const title of ["Monthly Signed Value", "Partnership Pipeline", "Need You", "Goals This Quarter", "Activity Today", "Your Week"]) expect(h).toContain(title);
    for (const title of ["Attendance, 14 Working Days", "On Time", "Org KPI", "My Goals This Quarter", "Upcoming Leave"]) expect(h).not.toContain(title);
    expect(cardTitles()).toEqual(["Active Partnerships", "Signed Value", "No Contact 30 Days", "Proposals Out"]);
    expect(screen.getByText(/^\d+ with no contact in 30 days$/)).toBeTruthy();
    expect(await screen.findByText("Amara Okafor")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(document.body.textContent).not.toMatch(TIER_3);
  }, 30000);

  it("Staff: the day strip before the cards, My Goals and Upcoming Leave with the year's balance, and an empty Need You", async () => {
    await overviewAs("chidera@mycityapp.io");
    const strip = screen.getByRole("list", { name: "Your Day" });
    for (const label of ["Shift Today", "Clock-In", "Worksite", "Status", "Hours Today"]) expect(within(strip).getByText(label)).toBeTruthy();
    const cards = document.querySelector("ul.grid-cols-2")!;
    expect(strip.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cardTitles()).toEqual(["My Scorecard", "My Overdue Tasks", "My Reviews Due", "My Attendance"]);
    const h = headings();
    for (const title of ["My Goals This Quarter", "Upcoming Leave", "Need You", "Activity Today", "Your Week"]) expect(h).toContain(title);
    for (const title of ["Attendance, 14 Working Days", "On Time", "Partnership Pipeline", "Goals This Quarter", "Org KPI"]) expect(h).not.toContain(title);
    expect(screen.getByText(/^\d+ days? left this year$/)).toBeTruthy();
    expect(await screen.findByText("Nothing Needs You")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
    expect(document.body.textContent).not.toMatch(TIER_3);
    // Upcoming Leave is a first page: View All opens My Leave, its paged home.
    fireEvent.click(screen.getByRole("button", { name: "View All" }));
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/ess?tab=my-leave"));
  }, 30000);

  it("offers New with the create actions the reader holds, opening each on its own screen", async () => {
    await overviewAs("chidera@mycityapp.io");
    fireEvent.keyDown(screen.getByRole("button", { name: "New" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["New Task", "Request Leave", "Add Work Site"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Request Leave" }));
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/ess?tab=my-leave&action=new"));
  }, 30000);

  it("Add Work Site, beside New and in it, opens Attendance's temporary site sheet over the Overview", async () => {
    await overviewAs("chidera@mycityapp.io");
    fireEvent.click(screen.getByRole("button", { name: "Add Work Site" }));
    const sheet = await screen.findByRole("dialog", { name: "Add Work Site" }, { timeout: 5000 });
    expect(within(sheet).getByRole("button", { name: "Submit for Approval" })).toBeTruthy();
    expect(window.location.pathname).toBe("/home");
  }, 30000);

  it("offers New Rule and New Report to their capabilities' holders; New Rule opens the rule form on Alerts", async () => {
    await overviewAs("cynthia@mycityapp.io");
    fireEvent.keyDown(screen.getByRole("button", { name: "New" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["New Task", "Request Leave", "Add Work Site", "New Rule", "New Report"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New Rule" }));
    expect(await screen.findByRole("dialog", { name: "New Rule" }, { timeout: 5000 })).toBeTruthy();
    // The address asked once; it no longer does, so Back or a reload does not open the form again.
    expect(window.location.search).toBe("?tab=alerts");
  }, 30000);
});

describe("Choose Cards", () => {
  it("chooses, refuses a fifth, keeps the locked card first, reorders, saves, and goes back to the role's cards", async () => {
    await overviewAs("cynthia@mycityapp.io");
    fireEvent.click(screen.getByRole("button", { name: "Choose Cards" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose Cards" });
    const tick = (name: string) => within(dialog).getByRole("checkbox", { name });
    await within(dialog).findByRole("checkbox", { name: "Clocked In Today" });

    // Locked: chosen, first, and neither taken off nor moved.
    expect(tick("Clocked In Today").getAttribute("aria-checked")).toBe("true");
    expect((tick("Clocked In Today") as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText("Locked")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Move Up, Clocked In Today" })).toBeNull();

    // Four is the most: a fifth is refused on the card pressed.
    fireEvent.click(tick("Headcount"));
    await waitFor(() => expect(tick("Headcount").getAttribute("aria-invalid")).toBe("true"));
    expect(within(dialog).getAllByText("Pick up to 4 cards").length).toBeGreaterThan(0);
    expect(tick("Headcount").getAttribute("aria-checked")).toBe("false");

    // Take one off, put another on, and move it up one place.
    fireEvent.click(tick("Overdue Tasks"));
    fireEvent.click(tick("Headcount"));
    expect(tick("Headcount").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move Up, Headcount" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Cards" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(cardTitles()).toEqual(["Clocked In Today", "Expenses Awaiting Approval", "Headcount", "Active Partnerships"]));
    const saved = dashboard.HomeKpiPicker.parse(await api.call("GET /api/v1/home/kpi-picker"));
    expect(saved).toMatchObject({ kpi_ids: ["attendance_today", "expenses_pending", "headcount", "partnerships_active"], source: "user" });

    // Opened again, the dialog starts from what was saved; Use Role Default goes back to the role's cards.
    fireEvent.click(screen.getByRole("button", { name: "Choose Cards" }));
    const again = await screen.findByRole("dialog", { name: "Choose Cards" });
    await waitFor(() => expect(within(again).getByRole("checkbox", { name: "Headcount" }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(within(again).getByRole("button", { name: "Use Role Default" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(cardTitles()).toEqual(["Clocked In Today", "Overdue Tasks", "Expenses Awaiting Approval", "Active Partnerships"]));
    expect(dashboard.HomeKpiPicker.parse(await api.call("GET /api/v1/home/kpi-picker"))).toMatchObject({ kpi_ids: null, source: "role" });
  }, 40000);

  it("starts from the cards showing, so a card a role locked after the pick is in the draft and Save Cards keeps it", async () => {
    await overviewAs("cynthia@mycityapp.io");
    const role = (await api.call("GET /api/v1/access/roles")).data.find((r) => r.code === "operations_people")!;
    const params = { role_id: role.role_id };
    const before = dashboard.HomeRoleKpis.parse(await api.call("GET /api/v1/home/roles/:role_id/kpis", { params }));
    try {
      // Her own pick, saved before her role locked Active Partnerships, which the pick leaves out.
      await api.call("PUT /api/v1/home/kpi-picks", { body: { kpi_ids: ["attendance_today", "headcount", "tasks_overdue", "expenses_pending"] } });
      await api.call("PUT /api/v1/home/roles/:role_id/kpis", { params, body: { default_ids: before.default_ids, locked_ids: ["attendance_today", "partnerships_active"] } });
      invalidate("/api/v1/home");
      await waitFor(() => expect(cardTitles()).toEqual(["Clocked In Today", "Active Partnerships", "Headcount", "Overdue Tasks"]));

      fireEvent.click(screen.getByRole("button", { name: "Choose Cards" }));
      const dialog = await screen.findByRole("dialog", { name: "Choose Cards" });
      await within(dialog).findByRole("checkbox", { name: "Active Partnerships" });
      // The row the Overview paints, four of four, never the stored pick with the lock put in front of it.
      expect(within(dialog).getByText("4 of 4")).toBeTruthy();
      expect(within(dialog).getByRole("checkbox", { name: "Active Partnerships" }).getAttribute("aria-checked")).toBe("true");
      expect(within(dialog).getByRole("checkbox", { name: "Expenses Awaiting Approval" }).getAttribute("aria-checked")).toBe("false");
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Cards" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(dashboard.HomeKpiPicker.parse(await api.call("GET /api/v1/home/kpi-picker")).kpi_ids).toEqual(["attendance_today", "partnerships_active", "headcount", "tasks_overdue"]);
    } finally {
      await api.call("PUT /api/v1/home/roles/:role_id/kpis", { params, body: { default_ids: before.default_ids, locked_ids: before.locked_ids } });
      await api.call("DELETE /api/v1/home/kpi-picks");
      invalidate("/api/v1/home");
    }
  }, 40000);

  it("has no accessibility violations", async () => {
    await overviewAs("cynthia@mycityapp.io");
    fireEvent.click(screen.getByRole("button", { name: "Choose Cards" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose Cards" });
    await within(dialog).findByRole("checkbox", { name: "Headcount" });
    expect(await axe(document.body)).toHaveNoViolations();
  }, 30000);
});

describe("the records behind a card", () => {
  it("opens with the summary line and the groups, All counting the whole list, and a group keeps its own records", async () => {
    await overviewAs("cynthia@mycityapp.io");
    fireEvent.click(screen.getByRole("button", { name: /^Clocked In Today/ }));
    const sheet = await screen.findByRole("dialog", { name: "Clocked In Today" });
    expect(await within(sheet).findByText(/^\d+ of \d+ clocked in$/)).toBeTruthy();
    const page = dashboard.HomeKpiDetailPage.parse(await api.call("GET /api/v1/home/kpi/:key", { params: { key: "attendance_today" } }));
    const meta = dashboard.HomeKpiDetailMeta.parse(await api.call("GET /api/v1/home/kpi/:key/meta", { params: { key: "attendance_today" } }));
    // Someone with no clock-out yesterday is also on site today: the groups overlap, so All is the list's total.
    expect(meta.groups.reduce((n, g) => n + g.count, 0)).toBeGreaterThan(page.page.total);
    expect(await within(sheet).findByRole("button", { name: new RegExp(`^All ${page.page.total}`) })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole("button", { name: /^Late/ }));
    await within(sheet).findByText("Bashir Lawal");
    await waitFor(() => expect(within(sheet).queryByText("Emeka Obi")).toBeNull());
    expect(within(sheet).getByRole("button", { name: new RegExp(`^All ${page.page.total}`) })).toBeTruthy();
  }, 30000);

  it("opens straight away from a link to it (?kpi=), and closing it takes the link away", async () => {
    await overviewAs("cynthia@mycityapp.io", "/home?tab=overview&kpi=headcount");
    const sheet = await screen.findByRole("dialog", { name: "Headcount" }, { timeout: 5000 });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(window.location.search).toBe("?tab=overview"));
  }, 30000);

  it("says a card the reader may not see is not there", async () => {
    await overviewAs("chidera@mycityapp.io", "/home?tab=overview&id=headcount");
    const sheet = await screen.findByRole("dialog", { name: "Records" }, { timeout: 5000 });
    expect(await within(sheet).findByText("This was not found")).toBeTruthy();
  }, 30000);

  it("pages at 25, the pager carrying the server's total", async () => {
    await overviewAs("cynthia@mycityapp.io");
    // Enough leave waiting for approval to need a second page: unpaid, which no allowance caps.
    const types = (await api.call("GET /api/v1/leave/types")).data;
    const unpaid = types.find((t) => t.code === "unpaid")!;
    for (let i = 0; i < 26; i += 1) {
      const day = new Date(Date.UTC(2027, 1, 1 + i)).toISOString().slice(0, 10);
      await api.call("POST /api/v1/ess/leave", { body: { leave_type_id: unpaid.leave_type_id, starts_on: day, ends_on: day } });
    }
    const page = dashboard.HomeKpiDetailPage.parse(await api.call("GET /api/v1/home/kpi/:key", { params: { key: "leave_pending" } }));
    expect(page.page).toMatchObject({ size: 25, pages: 2 });
    expect(page.data).toHaveLength(25);

    // A card not on the reader's row, opened from a link: its records' own title names the sheet.
    go("/home?tab=overview&kpi=leave_pending");
    const sheet = await screen.findByRole("dialog", { name: "Leave Awaiting Approval" }, { timeout: 5000 });
    expect(await within(sheet).findByText(`1 to 25 of ${page.page.total} records`)).toBeTruthy();
    // The list's search settles a quarter of a second after it opens (usePaged); a person reads the first page first.
    await act(() => new Promise((r) => setTimeout(r, 300)));
    fireEvent.click(within(sheet).getByRole("button", { name: /Next/ }));
    expect(await within(sheet).findByText(`26 to ${page.page.total} of ${page.page.total} records`)).toBeTruthy();
    expect(within(sheet).getAllByRole("row")).toHaveLength(1 + page.page.total - 25);
  }, 60000);
});

describe("Export", () => {
  // The toasts, on their own: the Overview's other cases read the page without them.
  const toasts = () => render(<Toaster />);
  // The clock is held still here, and the mock makes a run's file a few seconds after it is asked
  // for: each look moves it on a second until the file is saved (the mock holds no bytes, and says so).
  const savedMeanwhile = () =>
    waitFor(
      () => {
        vi.setSystemTime(new Date(Date.now() + 1_000));
        expect(screen.getByText("Files download once the API is connected")).toBeTruthy();
      },
      { timeout: 12000, interval: 250 },
    );

  it("makes a file of the reader's own Overview in the format they choose, waits for it and downloads it here", async () => {
    toasts();
    await overviewAs("cynthia@mycityapp.io");
    const before = reports.HomeReportRunPage.parse(await api.call("GET /api/v1/home/report-runs")).page.total;
    fireEvent.keyDown(screen.getByRole("button", { name: "Export" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["Export PDF", "Export XLSX"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Export XLSX" }));
    // Busy while the file is made, then saved on this device (the in-browser mock holds no bytes, and says so).
    await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).getAttribute("aria-busy")).toBe("true"));
    await savedMeanwhile();
    // A run of the reader's own Overview, for them alone, done and never emailed.
    const runs = reports.HomeReportRunPage.parse(await api.call("GET /api/v1/home/report-runs"));
    expect(runs.page.total).toBe(before + 1);
    const run = runs.data.reduce((a, b) => (b.number > a.number ? b : a));
    expect(run).toMatchObject({ report_key: "overview", format: "xlsx", recipient_name: "Cynthia Osakunih", report_schedule_id: null, status: "done", emailed_at: null });
    // The Overview's own report is not one of the reports Reports lists.
    const listed = reports.HomeReportPage.parse(await api.call("GET /api/v1/home/reports")).data;
    expect(listed.some((r) => r.report_key === "overview")).toBe(false);
  }, 30000);

  it("is any Home reader's, Staff included, and is left off a phone", async () => {
    toasts();
    await overviewAs("chidera@mycityapp.io");
    fireEvent.keyDown(screen.getByRole("button", { name: "Export" }), { key: "Enter" });
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Export PDF" }));
    // Staff hold no `home.reports`: the screen waits on its own run through the Overview's own read.
    await savedMeanwhile();
    expect(screen.queryByText("Export failed. Try again.")).toBeNull();
    cleanup();
    setViewport(390);
    await overviewAs("chidera@mycityapp.io");
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  }, 30000);
});

describe("on a phone", () => {
  it("lays the cards two to a row, keeps Choose Cards in the page menu, draws no table, and opens records as a sheet", async () => {
    setViewport(390);
    await overviewAs("cynthia@mycityapp.io");
    expect(document.querySelector("ul.grid-cols-2")?.children).toHaveLength(4);
    // Need You is cards on a phone: the requests are there, in no table.
    expect(await screen.findByText("Bashir Lawal")).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
    expect(screen.getByRole("button", { name: "More Actions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Clocked In Today/ }));
    const sheet = await screen.findByRole("dialog", { name: "Clocked In Today" });
    await within(sheet).findByText(/^\d+ of \d+ clocked in$/);
    expect(sheet.querySelector("table")).toBeNull();
  }, 30000);

  it("keeps the Staff day strip ahead of the cards", async () => {
    setViewport(390);
    await overviewAs("chidera@mycityapp.io");
    const strip = screen.getByRole("list", { name: "Your Day" });
    expect(strip.compareDocumentPosition(document.querySelector("ul.grid-cols-2")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 30000);
});

describe("the mock answers what the API answers", () => {
  it.each(["cynthia", "ifeoma", "ngozi", "chidera"])("the Overview, the picker and every card's records for %s match the contract", async (who) => {
    await overviewAs(`${who}@mycityapp.io`);
    const overview = dashboard.HomeOverview.parse(await api.call("GET /api/v1/home/overview"));
    const picker = dashboard.HomeKpiPicker.parse(await api.call("GET /api/v1/home/kpi-picker"));
    workflow.ApprovalWaitingPage.parse(await api.call("GET /api/v1/workflow/mine"));
    expect(overview.cards.map((c) => c.key)).toEqual(picker.showing_ids);
    for (const { key } of [...picker.cards, ...overview.cards]) {
      dashboard.HomeKpiDetailMeta.parse(await api.call("GET /api/v1/home/kpi/:key/meta", { params: { key } }));
      dashboard.HomeKpiDetailPage.parse(await api.call("GET /api/v1/home/kpi/:key", { params: { key } }));
    }
  }, 60000);
});
