// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import dashboard from "@mycity/contract/schemas/dashboard.js";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, chooseOption, chooseValue, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession } from "@/api/mock/core";
import type { Me } from "@/api/types/identity";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import Home from "./index";
import { personLinks, rosterFilters } from "./Team";

/**
 * Home · Team on the in-browser mock (docs/guides/home.md §10): the reader's scope and its four
 * cards, the roster's filters, a person's sheet and where it leads, Attendance This Month paged
 * at 25, and the phone's layout. The mock answers in the contract's shapes, so every figure the
 * screen shows is checked against what the API sends.
 *
 * The clock is a Monday morning in Lagos, a working day, whatever day the suite runs.
 */

// Every request the screen makes passes through the mock's dispatch, watched here so a step waits for its reads, not a clock.
vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

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
  window.history.replaceState(null, "", "/home?tab=team");
});

/**
 * Waits until the screen has finished reading, however slowly the mock answers: past the search's
 * quarter-second debounce (usePaged), then for every request in flight, until answering them starts
 * no new one. What the step changed can then be read off the screen at once.
 */
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
/** Home while the address is Home's, on the tab it names; another module's screen is not this test's. */
function Screen() {
  const { location } = useRouter();
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
        </ScreenActionProvider>
      </ModalProvider>
    </AuthProvider>
  </RouterProvider>
);

/** Signs in on the mock without the tab on screen yet; `show()` puts Team there and waits for its roster. */
async function signedIn(email: string) {
  window.history.replaceState(null, "", "/home?tab=team");
  mockSession.set(null);
  // The reads' cache is kept by path, not by person: start each person from the server.
  invalidate("/api/v1");
  const { rerender } = render(app(false));
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 5000 });
  await act(async () => {
    const next = await auth!.signIn(email, "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
  return {
    show: async () => {
      // The Overview opens the clock-in panel once a day; Team never does, so nothing covers it.
      rerender(app(true));
      await settled();
      screen.getByRole("heading", { level: 1, name: "Team" });
      screen.getByRole("navigation", { name: "Team Roster pages" });
      screen.getByRole("navigation", { name: "Attendance This Month pages" });
      expect(cardTitles()).toHaveLength(4);
    },
  };
}

async function teamAs(email: string) {
  await (await signedIn(email)).show();
}

/** Today's roster as the API sends it to whoever is signed in, first page. */
const team = async () => dashboard.HomeTeamPage.parse(await api.call("GET /api/v1/home/team"));

/** The names among `candidates` that are on screen inside `root`. */
const namesIn = (root: HTMLElement, candidates: string[]) => candidates.filter((n) => within(root).queryByText(n) !== null);
const rosterTable = () => screen.getByRole("table", { name: "Team Roster" });
const monthTable = () => screen.getByRole("table", { name: "Attendance This Month" });
const headers = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim());

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
  read('[data-ui="kpi-caption"]', copy.LIMITS.kpiCaption, false);
  read('[data-ui="empty-text"]', copy.LIMITS.emptyText, false);
  read('[data-ui="button"]', copy.LIMITS.button, true);
  read("th", copy.LIMITS.title, true);
  return problems;
}

const chip = (name: string) => within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name });

describe("Home · Team, by scope", () => {
  it("Operations: the whole organisation, its four cards, and everyone on today's roster", async () => {
    await teamAs("cynthia@mycityapp.io");
    expect(document.querySelector('[data-ui="page-subtitle"]')?.textContent).toBe("The Whole Organisation");
    expect(cardTitles()).toEqual(["Present Today", "On Site", "Remote", "Flags"]);
    const page = await team();
    expect(page.page.total).toBe(24);
    expect(within(screen.getByRole("navigation", { name: "Team Roster pages" })).getByText("24 people")).toBeTruthy();
    expect(namesIn(rosterTable(), page.data.map((r) => r.employee.display_name))).toHaveLength(24);
    expect(headers(rosterTable())).toEqual(["Employee", "Department", "Status", "Clock-In", "KPI", "Open Tasks"]);
    expect(headers(monthTable())).toEqual(["Employee", "On Time", "Late", "Absent", "On Leave"]);
    expect(copyProblems()).toEqual([]);
  }, 30000);

  it("a line manager sees themselves and everyone below them, no one else, in the roster, the cards and the month", async () => {
    await teamAs("ngozi@mycityapp.io");
    expect(document.querySelector('[data-ui="page-subtitle"]')?.textContent).toBe("Your Team");
    const tree = ["Ngozi Eze", "Amara Okafor", "Emeka Obi", "Adedotun Oyinloye", "Tobi Ojo", "Funke Bello", "Blessing Udo", "Yusuf Musa", "Rotimi Alade"];
    const outside = ["Cynthia Osakunih", "Bashir Lawal", "Grace Okon", "Ifeoma Chukwu"];
    expect(namesIn(rosterTable(), tree).sort()).toEqual([...tree].sort());
    expect(namesIn(rosterTable(), outside)).toEqual([]);
    expect(namesIn(monthTable(), tree).sort()).toEqual([...tree].sort());
    expect(namesIn(monthTable(), outside)).toEqual([]);
    const summary = dashboard.HomeTeamSummary.parse(await api.call("GET /api/v1/home/team/summary"));
    expect(summary.scope).toBe("team");
    // Tobi is on leave, so eight of the nine are expected in.
    expect(summary.cards.find((c) => c.key === "team_present")).toMatchObject({ denominator: 8 });
    expect(copyProblems()).toEqual([]);
  }, 30000);

  it("each card's figure is the number of records it opens, and the roster says the same", async () => {
    await teamAs("cynthia@mycityapp.io");
    const summary = dashboard.HomeTeamSummary.parse(await api.call("GET /api/v1/home/team/summary"));
    const present = summary.cards.find((c) => c.key === "team_present")!;
    const page = await team();
    expect(present.value).toBe(page.data.filter((r) => ["on_site", "remote", "field", "late"].includes(r.status ?? "")).length);
    expect(screen.getByRole("button", { name: /^Present Today/ }).textContent).toContain(`${present.value} of ${present.denominator}`);

    fireEvent.click(screen.getByRole("button", { name: /^Present Today/ }));
    await settled();
    const sheet = screen.getByRole("dialog", { name: "Present Today" });
    expect(within(sheet).getByText(`${present.value} of ${present.denominator} in today`)).toBeTruthy();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Flags is the people flagged today, each once: two late, one with no clock-out yesterday.
    const flags = summary.cards.find((c) => c.key === "team_flags")!;
    expect(flags).toMatchObject({ value: 3, caption: "2 late, 1 no clock-out" });
    fireEvent.click(screen.getByRole("button", { name: /^Flags/ }));
    await settled();
    const flagged = screen.getByRole("dialog", { name: "Flags" });
    expect(namesIn(flagged, ["Bashir Lawal", "Rotimi Alade", "Emeka Obi", "Cynthia Osakunih"])).toEqual(["Bashir Lawal", "Rotimi Alade", "Emeka Obi"]);
  }, 30000);
});

describe("the roster's filters", () => {
  it("are sent as the contract names them", () => {
    expect(rosterFilters("everyone", "")).toEqual({});
    expect(rosterFilters("late", "")).toEqual({ status: "late" });
    expect(rosterFilters("no_clock_out_yesterday", "")).toEqual({ no_clock_out_yesterday: "true" });
    const studio = "8d2c0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
    expect(rosterFilters("on_leave", studio)).toEqual({ department_id: studio, status: "on_leave" });
    for (const chipValue of ["everyone", "on_site", "remote", "late", "not_in", "on_leave", "no_clock_out_yesterday"] as const) {
      expect(dashboard.HomeTeamQuery.safeParse({ ...rosterFilters(chipValue, studio), page: "1" }).success).toBe(true);
    }
  });

  it("narrow the roster by status, the flag, department and search, and Everyone brings everyone back", async () => {
    await teamAs("cynthia@mycityapp.io");
    const everyone = (await team()).data.map((r) => r.employee.display_name);
    const shows = async (names: string[]) => {
      await settled();
      expect(namesIn(rosterTable(), everyone).sort()).toEqual([...names].sort());
    };

    expect(within(screen.getByRole("group", { name: "Status" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Everyone",
      "On Site",
      "Remote",
      "Field",
      "Late",
      "Not In",
      "On Leave",
      "No Clock-Out Yesterday",
    ]);

    fireEvent.click(chip("Late"));
    await shows(["Bashir Lawal", "Rotimi Alade"]);
    expect(chip("Late").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip("No Clock-Out Yesterday"));
    await shows(["Emeka Obi"]);
    expect(within(rosterTable()).getByText("No Clock-Out Yesterday")).toBeTruthy();

    fireEvent.click(chip("On Leave"));
    await shows(["Hauwa Yusuf", "Tobi Ojo"]);

    const department = screen.getByRole("combobox", { name: "Department" });
    await chooseOption(department, "Studio");
    // Nobody in Studio is on leave today.
    await settled();
    expect(screen.getByText("Nobody Matches")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Team Roster" })).toBeNull();

    fireEvent.click(chip("Late"));
    await shows(["Rotimi Alade"]);
    // The department narrows the month too.
    expect(namesIn(monthTable(), everyone).sort()).toEqual(["Emeka Obi", "Rotimi Alade", "Yusuf Musa"]);

    await chooseValue(department, "");
    fireEvent.click(chip("Everyone"));
    fireEvent.change(screen.getByPlaceholderText("Search People"), { target: { value: "bashir" } });
    await shows(["Bashir Lawal"]);
    fireEvent.change(screen.getByPlaceholderText("Search People"), { target: { value: "" } });
    await shows(everyone);

    // Sorting is the server's: the earliest clock-in leads once Clock-In is pressed.
    const earliest = (await team()).data.filter((r) => r.clock_in_at).sort((a, b) => a.clock_in_at!.localeCompare(b.clock_in_at!))[0];
    fireEvent.click(within(rosterTable()).getByRole("button", { name: "Clock-In" }));
    await settled();
    expect(within(rosterTable()).getAllByRole("row")[1].textContent).toContain(earliest.employee.display_name);
  }, 40000);
});

describe("a person's sheet", () => {
  it("opens from the roster with their day, and leads to their profile and attendance for a reader who may open both", async () => {
    await teamAs("cynthia@mycityapp.io");
    fireEvent.click(within(rosterTable()).getByText("Bashir Lawal"));
    const sheet = await screen.findByRole("dialog", { name: "Bashir Lawal" });
    const value = (label: string) => within(sheet).getByText(label).nextElementSibling?.textContent;
    expect(value("Department")).toBe("Marketing & Sales");
    expect(value("Today")).toBe("Late");
    expect(value("Clock-In")).toBe("09:41");
    expect(within(sheet).getAllByRole("button").map((b) => b.textContent).filter((t) => t === "View Attendance" || t === "Open Profile")).toEqual(["View Attendance", "Open Profile"]);
    expect(await axe(document.body)).toHaveNoViolations();

    const bashir = (await team()).data.find((r) => r.employee.display_name === "Bashir Lawal")!;
    fireEvent.click(within(sheet).getByRole("button", { name: "Open Profile" }));
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe(`/people?tab=employees&id=${bashir.employee.employee_id}`));
  }, 30000);

  it("offers a line manager only the People screen they may open: View Attendance", async () => {
    await teamAs("ngozi@mycityapp.io");
    fireEvent.click(within(rosterTable()).getByText("Emeka Obi"));
    const sheet = await screen.findByRole("dialog", { name: "Emeka Obi" });
    expect(within(sheet).queryByRole("button", { name: "Open Profile" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "View Attendance" }));
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/people?tab=attendance"));
  }, 30000);

  it("leads nowhere for a reader without the people grant, or before People's screens open", () => {
    const reader = (grants: Me["grants"], settings = false): Me =>
      ({
        user_id: "00000000-0000-4000-a000-000000000001",
        employee_id: "00000000-0000-4000-a000-000000000002",
        email: "lead@mycityapp.io",
        display_name: "Team Lead",
        first_name: "Team",
        job_title: "Lead",
        department: "Content",
        photo_url: null,
        is_ceo: false,
        grants: settings ? { ...grants, settings: ["view"] } : grants,
        capabilities: ["home.team"],
        roles: [{ code: "manager", name: "Line Manager" }],
        home_view: "staff",
        manages_people: true,
        appearance: { dark: null, fonts: { heading: "geist", body: "geist" }, theme_default: "system", density_default: "compact" },
        hidden_fields: [],
      }) as Me;
    const open = () => true;
    const labels = (me: Me, opens: (tab: string) => boolean = open) => personLinks(me, "00000000-0000-4000-a000-000000000003", opens).map((l) => l.label);
    expect(labels(reader({ home: ["view"] }))).toEqual([]);
    expect(labels(reader({ home: ["view"], people: ["view"] }))).toEqual(["View Attendance"]);
    expect(labels(reader({ home: ["view"], people: ["view"] }, true))).toEqual(["View Attendance", "Open Profile"]);
    expect(labels(reader({ home: ["view"], people: ["view"] }, true), (tab) => tab !== "employees")).toEqual(["View Attendance"]);
    expect(labels(reader({ home: ["view"], people: ["view"] }, true), () => false)).toEqual([]);
    expect(personLinks(reader({ home: ["view"], people: ["view"] }, true), "00000000-0000-4000-a000-000000000003", open).map((l) => l.href)).toEqual([
      "/people?tab=attendance",
      "/people?tab=employees&id=00000000-0000-4000-a000-000000000003",
    ]);
  });
});

describe("on a phone", () => {
  it("lays the cards two to a row, draws people as cards with their department under the name, and opens a person as a sheet", async () => {
    setViewport(390);
    await teamAs("cynthia@mycityapp.io");
    expect(document.querySelector("ul.grid-cols-2")?.children).toHaveLength(4);
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Department" })).toBeNull();
    const card = screen.getByRole("button", { name: /Bashir Lawal/ }).closest("li")!;
    expect(within(card).getByText("Marketing & Sales")).toBeTruthy();
    for (const label of ["Status", "Clock-In", "KPI"]) expect(within(card).getByText(label)).toBeTruthy();
    for (const label of ["Department", "Open Tasks"]) expect(within(card).queryByText(label)).toBeNull();
    expect(copyProblems()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Bashir Lawal/ }));
    const sheet = await screen.findByRole("dialog", { name: "Bashir Lawal" });
    expect(within(sheet).getByText("Open Tasks")).toBeTruthy();
    expect(sheet.querySelector("table")).toBeNull();
  }, 30000);
});

describe("the mock answers what the API answers", () => {
  it.each(["cynthia", "ifeoma", "ngozi"])("Team's three reads for %s match the contract", async (who) => {
    await signedIn(`${who}@mycityapp.io`);
    dashboard.HomeTeamSummary.parse(await api.call("GET /api/v1/home/team/summary"));
    dashboard.HomeTeamPage.parse(await api.call("GET /api/v1/home/team", { query: { status: "late" } }));
    dashboard.HomeTeamAttendancePage.parse(await api.call("GET /api/v1/home/team/attendance"));
  }, 30000);

  it("refuses all three to a reader without home.team, as requireCapability does", async () => {
    await signedIn("chidera@mycityapp.io");
    for (const key of ["GET /api/v1/home/team/summary", "GET /api/v1/home/team", "GET /api/v1/home/team/attendance"] as const) {
      await expect(api.call(key)).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.status === 403);
    }
  }, 30000);
});

describe("Attendance This Month", () => {
  it("pages at 25, its pager carrying the server's total, and counts each person's month as the API does", async () => {
    const session = await signedIn("cynthia@mycityapp.io");
    // Two people join today, so the organisation's roster runs past one page.
    const departments = (await api.call("GET /api/v1/departments", { query: {} })).data;
    const content = departments.find((d) => d.name === "Content")!;
    // Someone On Site names their worksite (Add Employee, docs/guides/foundation.md §6.16).
    const site = (await api.call("GET /api/v1/worksites", { query: { active: "true" } })).data[0]!;
    for (const [first, last] of [["Ada", "Nwankwo"], ["Kunle", "Bakare"]]) {
      await api.call("POST /api/v1/employees", {
        body: {
          first_name: first,
          last_name: last,
          work_email: `${first.toLowerCase()}.${last.toLowerCase()}@mycityapp.io`,
          phone: "+2348031234567",
          job_title: "Content Writer",
          start_date: "2026-10-19",
          employment_type: "full_time",
          work_pattern: "on_site",
          worksite_id: site.worksite_id,
          department_id: content.department_id,
        },
      });
    }
    await session.show();
    const month = dashboard.HomeTeamAttendancePage.parse(await api.call("GET /api/v1/home/team/attendance"));
    expect(month.page).toMatchObject({ size: 25, total: 26, pages: 2 });
    expect(month.data).toHaveLength(25);

    const pages = screen.getByRole("navigation", { name: "Attendance This Month pages" });
    expect(within(pages).getByText("1 to 25 of 26 people")).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Team Roster pages" })).getByText("1 to 25 of 26 people")).toBeTruthy();
    // Someone who joined today has no day recorded yet: no figure, rather than 0 of 0.
    const joiner = within(monthTable()).getByText("Ada Nwankwo").closest("tr")!;
    expect(within(joiner).getAllByRole("cell")[1].textContent).not.toMatch(/\d/);
    const first = month.data[0];
    const row = within(monthTable()).getByText(first.employee.display_name).closest("tr")!;
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      expect.stringContaining(first.employee.display_name),
      `${first.on_time} of ${first.expected}`,
      String(first.late),
      String(first.absent),
      String(first.on_leave),
    ]);

    // The list's search settles a quarter of a second after it opens (usePaged), which show() waited out; a person reads the first page first.
    fireEvent.click(within(pages).getByRole("button", { name: /Next/ }));
    await settled();
    expect(screen.getByRole("navigation", { name: "Attendance This Month pages" }).textContent).toContain("26 to 26 of 26 people");
    expect(within(monthTable()).getAllByRole("row")).toHaveLength(2);
  }, 60000);
});
