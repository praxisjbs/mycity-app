// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { dispatch, mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider, useRouter } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import copy from "../../../../scripts/check/lib/copy.js";
import People from "@/features/people/index";
import Ess from "@/features/ess/index";

/**
 * People · Organogram and ESS · Org Chart on the in-browser mock (docs/guides/organogram.md §8,
 * §10.2). On a phone, People opens on Everyone, the whole company as a folding list, and Org
 * Chart on Focus at the person looking; Focus has the path from the top, the team, Dotted Line,
 * Same Manager and Also At The Top. A person's card opens their sheet on both shells, its
 * buttons by grant, and Download PDF asks the server for the file.
 */

// Every request the screen makes passes through the mock's dispatch, watched here so a step waits for its reads, not a clock.
vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

installMatchMedia();

afterEach(() => {
  cleanup();
  setViewport(1440);
  window.history.replaceState(null, "", "/people?tab=organogram");
});

/** Waits past the search debounce, then for every request in flight, until answering them starts no new one. */
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
  if (location.module === "people") return <People tab={location.tab ?? "organogram"} id={location.id} />;
  if (location.module === "ess") return <Ess tab={location.tab ?? "org-chart"} id={location.id} />;
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

/** Signs in on the mock and opens a screen. */
async function open(path: string, email: string, heading: string) {
  window.history.replaceState(null, "", path);
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
  screen.getByRole("heading", { level: 1, name: heading });
}
const organogramAsOperations = () => open("/people?tab=organogram", "cynthia@mycityapp.io", "Organogram");
const orgChartAsStaff = () => open("/ess?tab=org-chart", "chidera@mycityapp.io", "Org Chart");

/** The focused card: the one drawn larger and outlined. */
const focusedCard = () => document.querySelector(".border-2") as HTMLElement | null;
const sectionTitles = () => [...document.querySelectorAll('h2[data-ui="title"]')].map((h) => h.textContent?.trim());
const showFocus = async () => {
  fireEvent.click(screen.getByRole("radio", { name: "Focus" }));
  await settled();
};
/** The sheet a person's card opens. */
const sheet = () => screen.getByRole("dialog");
/** How many share a person's manager on the mock's tree as it is now. */
async function colleaguesOf(name: string) {
  const tree = await api.call("GET /api/v1/org-chart", { query: { view: "viewer" } });
  const n = tree.nodes.find((x) => x.display_name === name)!;
  return tree.nodes.filter((x) => x.manager_node_id === n.manager_node_id && x.node_id !== n.node_id).length;
}

/** The copy rules the screen gates hold a screen to (scripts/check/lib/copy.js), read from what is rendered. */
function copyProblems(): string[] {
  const problems: string[] = [];
  for (const [selector, limit] of [
    ['[data-ui="title"]', copy.LIMITS.title],
    ['[data-ui="button"]', copy.LIMITS.button],
    ['[data-ui="empty-text"]', copy.LIMITS.emptyText],
  ] as const) {
    for (const el of document.querySelectorAll(selector)) {
      if (el.closest('[data-copy="content"]')) continue;
      const t = el.textContent?.trim() ?? "";
      if (copy.wordCount(t) > limit) problems.push(`${selector} over ${limit} words: "${t}"`);
      if (copy.hasDash(t)) problems.push(`${selector} has a dash: "${t}"`);
    }
  }
  return problems;
}

describe("People · Organogram on desktop", () => {
  it("folds an open seat's branch below the second level, and its own toggle unfolds it", async () => {
    setViewport(1440);
    await organogramAsOperations();
    /* The mock's open seat carries a report; put the seat under one of the CEO's people, a level down. */
    const tree = await api.call("GET /api/v1/org-chart", { query: { view: "builder" } });
    const ceo = tree.nodes.find((n) => n.is_ceo)!;
    const seat = tree.nodes.find((n) => n.node_kind === "seat" && tree.nodes.some((m) => m.manager_node_id === n.node_id))!;
    const report = tree.nodes.find((m) => m.manager_node_id === seat.node_id)!;
    const head = tree.nodes.find((n) => n.manager_node_id === ceo.node_id && n.node_kind === "employee")!;
    await act(async () => {
      await api.call("PATCH /api/v1/org-seats/:id", { params: { id: seat.node_id }, body: { line_manager_id: head.employee_id! } });
      invalidate("/api/v1/org-chart");
    });
    await settled();

    const seatCard = screen.getByText(seat.display_name).closest(".og-card") as HTMLElement;
    const unfold = within(seatCard).getByRole("button", { name: "Expand" });
    expect(unfold.textContent).toBe("+1");
    expect(screen.queryByText(report.display_name)).toBeNull();
    fireEvent.click(unfold);
    await settled();
    expect(within(seatCard).getByRole("button", { name: "Collapse" })).toBeTruthy();
    expect(screen.getByText(report.display_name)).toBeTruthy();
  }, 30000);

  it("a card opens the person's sheet with Open Record and Change Manager for Operations, and Download PDF asks the server", async () => {
    setViewport(1440);
    await organogramAsOperations();
    fireEvent.click(screen.getByText("Tolu Adeyemi").closest(".og-card")!);
    await settled();
    expect(within(sheet()).getByText("Content")).toBeTruthy();
    expect(within(sheet()).getByText("Ifeoma Chukwu")).toBeTruthy();
    expect(within(sheet()).getByText("2 direct")).toBeTruthy();
    for (const name of ["Send Message", "Open Record", "Change Manager"]) expect(within(sheet()).getByRole("button", { name })).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Change Manager" }));
    await settled();
    expect(within(sheet()).getByRole("button", { name: "Save Line" })).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole("button", { name: "Cancel" }));
    await settled();

    vi.mocked(dispatch).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await settled();
    const asked = vi.mocked(dispatch).mock.calls.map(([req]) => req).filter((req) => req.method === "POST" && req.path === "/api/v1/org-chart/exports");
    expect(asked).toHaveLength(1);
    expect(asked[0].body).toEqual({ view: "builder" });
  }, 30000);
});

describe("People · Organogram on a phone", () => {
  it("opens on Everyone; Focus starts on the CEO, lists a card left at the top, and a search lists the cards to tap", async () => {
    setViewport(390);
    await organogramAsOperations();
    expect(screen.getByRole("radio", { name: "Everyone" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Collapse Ifeoma Chukwu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Role" })).toBeNull();
    await showFocus();

    expect(within(focusedCard()!).getByText("Ifeoma Chukwu")).toBeTruthy();
    expect(sectionTitles().some((t) => t?.startsWith("Also At The Top"))).toBe(false);

    /* An open role added with no line sits at the top beside the CEO. */
    const departments = await api.call("GET /api/v1/departments");
    await act(async () => {
      await api.call("POST /api/v1/org-seats", { body: { title: "Head of Audit", department_id: departments.data[0].department_id } });
      invalidate("/api/v1/org-chart");
    });
    await settled();
    expect(sectionTitles()).toContain("Also At The Top · 1");
    expect(screen.getByRole("button", { name: /^Head of Audit/ })).toBeTruthy();
    expect(copyProblems()).toEqual([]);

    /* A search lists the matching cards, and a tap focuses one and clears the search. */
    const search = screen.getByPlaceholderText("Name or role") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "audit" } });
    await settled();
    expect(sectionTitles()).toContain("Matches · 1");
    fireEvent.click(screen.getByRole("button", { name: /^Head of Audit/ }));
    await settled();
    expect(search.value).toBe("");
    expect(within(focusedCard()!).getByText("Head of Audit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Role" })).toBeTruthy();

    /* Show Top goes back to the CEO. */
    fireEvent.click(screen.getByRole("button", { name: "Show Top" }));
    await settled();
    expect(within(focusedCard()!).getByText("Ifeoma Chukwu")).toBeTruthy();

    fireEvent.change(search, { target: { value: "nobody by this name" } });
    await settled();
    expect(screen.getByRole("heading", { name: "No Match" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 30000);

  it("Everyone folds below the third level; a row opens Focus with its path, team, dotted line and colleagues", async () => {
    setViewport(390);
    await organogramAsOperations();
    /* Hauwa is on the third level, and her two reports are folded under her. */
    expect(screen.queryByText("Zainab Abubakar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Hauwa Yusuf" }));
    await settled();
    expect(screen.getByText("Zainab Abubakar")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Tolu Adeyemi/ }));
    await settled();
    expect(screen.getByRole("radio", { name: "Focus" }).getAttribute("aria-checked")).toBe("true");
    const path = screen.getByRole("navigation", { name: "Reporting line" });
    expect(within(path).getByRole("button", { name: "Ifeoma Chukwu" })).toBeTruthy();
    expect(within(path).getByText("Tolu Adeyemi").getAttribute("aria-current")).toBe("true");
    expect(within(focusedCard()!).getByText("2 direct")).toBeTruthy();
    /* Earlier tests move the mock's seats, so the colleagues are counted from the tree as it is now. */
    const colleagues = await colleaguesOf("Tolu Adeyemi");
    expect(sectionTitles()).toEqual(expect.arrayContaining(["Reports To", "Direct Reports · 2", "Dotted Line · 1", `Same Manager · ${colleagues}`]));
    expect(screen.getByRole("button", { name: /^Adedotun Oyinloye/ })).toBeTruthy();
    expect(copyProblems()).toEqual([]);

    /* A step on the path moves the focus there. */
    fireEvent.click(within(path).getByRole("button", { name: "Ifeoma Chukwu" }));
    await settled();
    expect(within(focusedCard()!).getByText("Ifeoma Chukwu")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Reporting line" })).toBeNull();
  }, 30000);
});

describe("ESS · Org Chart on a phone, as staff", () => {
  it("starts on them; their own sheet offers My Profile, a colleague's Send Message alone", async () => {
    setViewport(390);
    await orgChartAsStaff();
    expect(screen.getByRole("radio", { name: "Focus" }).getAttribute("aria-checked")).toBe("true");
    expect(within(focusedCard()!).getByText("Chidera Nwosu")).toBeTruthy();
    const path = screen.getByRole("navigation", { name: "Reporting line" });
    expect(within(path).getByRole("button", { name: "Cynthia Osakunih" })).toBeTruthy();
    expect(sectionTitles()).toContain(`Same Manager · ${await colleaguesOf("Chidera Nwosu")}`);
    expect(sectionTitles().some((t) => t?.startsWith("Direct Reports"))).toBe(false);

    fireEvent.click(focusedCard()!);
    await settled();
    expect(within(sheet()).getByRole("button", { name: "My Profile" })).toBeTruthy();
    expect(within(sheet()).queryByRole("button", { name: "Send Message" })).toBeNull();
    fireEvent.keyDown(sheet(), { key: "Escape" });
    await settled();

    fireEvent.click(screen.getByRole("button", { name: /^Bashir Lawal/ }));
    await settled();
    fireEvent.click(focusedCard()!);
    await settled();
    expect(within(sheet()).getByRole("button", { name: "Send Message" })).toBeTruthy();
    expect(within(sheet()).queryByRole("button", { name: "Open Record" })).toBeNull();
    expect(within(sheet()).queryByRole("button", { name: "Change Manager" })).toBeNull();
    fireEvent.keyDown(sheet(), { key: "Escape" });
    await settled();

    /* Everyone opens the way down to them and marks their row. */
    fireEvent.click(screen.getByRole("radio", { name: "Everyone" }));
    await settled();
    const mine = screen.getByRole("button", { name: /^Chidera Nwosu/ });
    expect(within(mine).getByText("You")).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 30000);
});
