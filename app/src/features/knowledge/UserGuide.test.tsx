// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GuideAnswer, GuideChapter, GuideContents, GuideHit, GuideSearchPage } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";

/**
 * Knowledge Hub · User Guide (docs/guides/user-guide.md §3, §10): a step's screen link opens the
 * screen and leaves the way back; coming back opens the guide at that step, marked; the Quick
 * Start groups its cards by role. The search (§6.8 to §6.10): results as the words are typed, in
 * the body of a POST; an answer once asked; a result opens the guide at its step. What each reader
 * receives is the server's (user_guide tests).
 */

const span = (text: string, extra: Partial<{ bold: boolean; href: string | null }> = {}) => ({ text, bold: false, italic: false, code: false, href: null, ...extra });

const CONTENTS: GuideContents = {
  chapters: [
    {
      slug: "people",
      title: "People",
      module: "people",
      icon: "users",
      summary: "The staff register.",
      sections: [{ slug: "people-employees", title: "Employees", screen: "people/employees", tasks: [{ slug: "people-add-employee", title: "Add an Employee" }] }],
    },
  ],
  quick_start: [{ slug: "qs-add-employee", title: "Add an Employee", role: "People & HR" }],
  answers: true,
  voice: false,
};

const CHAPTER: GuideChapter = {
  slug: "people",
  kind: "chapter",
  title: "People",
  module: "people",
  icon: "users",
  summary: "The staff register.",
  intro: [],
  sections: [
    {
      slug: "people-employees",
      title: "Employees",
      screen: "people/employees",
      role: null,
      icon: null,
      blocks: [{ kind: "paragraph", spans: [span("Everyone who works for MyCity.")] }],
      tasks: [
        {
          slug: "people-add-employee",
          title: "Add an Employee",
          blocks: [
            {
              kind: "steps",
              items: [
                { n: 1, spans: [span("Open "), span("People · Employees", { bold: true, href: "/people?tab=employees" }), span(".")], figure: null },
                { n: 2, spans: [span("Press "), span("Add Employee", { bold: true }), span(".")], figure: null },
              ],
            },
          ],
        },
      ],
    },
  ],
  pictures: [],
};

const QUICK: GuideChapter = {
  ...CHAPTER,
  slug: "quick-start",
  kind: "quick-start",
  title: "Quick Start",
  module: null,
  sections: [{ slug: "qs-add-employee", title: "Add an Employee", screen: null, role: "People & HR", icon: "users", blocks: [{ kind: "paragraph", spans: [span("Four steps.")] }], tasks: [] }],
};

const HIT: GuideHit = {
  anchor: "people-add-employee",
  kind: "task",
  chapter: "people",
  chapter_title: "People",
  section: "people-employees",
  section_title: "Employees",
  title: "Add an Employee",
  screen: "people/employees",
  step: 2,
  snippet: [
    { text: "Press ", hit: false },
    { text: "Add Employee", hit: true },
    { text: ".", hit: false },
  ],
  by: "both",
};
const PAGE: GuideSearchPage = { data: [HIT], page: { number: 1, size: 25, total: 1, pages: 1, has_next: false } };
const ANSWER: GuideAnswer = { found: true, sentences: [{ text: "Open People · Employees and press Add Employee.", sources: [1] }], sources: [HIT] };

const m = vi.hoisted(() => ({ navigate: vi.fn(), params: new URLSearchParams(), set: vi.fn(), call: vi.fn() }));
vi.mock("@/api/client", () => ({
  api: { call: m.call },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/api/hooks", () => ({
  useApi: (key: string) => ({
    data: key === "GET /api/v1/user-guide" ? CONTENTS : key === "GET /api/v1/user-guide/quick-start" ? QUICK : CHAPTER,
    error: null,
    reload: () => undefined,
  }),
}));
vi.mock("@/lib/router", () => ({
  useRouter: () => ({ navigate: m.navigate, location: { path: "/knowledge", module: "knowledge", tab: "user-guide", id: null, params: m.params } }),
  useSearchParams: () => [m.params, m.set],
}));

import { UserGuide } from "./UserGuide";
import { GUIDE_RETURN } from "./guide/return";

installMatchMedia();
beforeEach(() => {
  sessionStorage.clear();
  m.call.mockImplementation(async (key: string) => (key === "POST /api/v1/user-guide/search" ? PAGE : ANSWER));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.params = new URLSearchParams();
});

const draw = (id: string | null) =>
  render(
    <ModalProvider>
      <UserGuide id={id} />
    </ModalProvider>,
  );

describe("User Guide", () => {
  it("opens a step's screen and keeps the way back to that step", async () => {
    draw("people-add-employee");
    expect(screen.getByRole("heading", { name: "Add an Employee" })).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "People · Employees" }));
    expect(m.navigate).toHaveBeenCalledWith("/people?tab=employees");
    expect(JSON.parse(sessionStorage.getItem(GUIDE_RETURN) as string)).toEqual({ id: "people-add-employee", step: 1, title: "Add an Employee" });
  });

  it("comes back at the step, marked, and the way back is spent", () => {
    sessionStorage.setItem(GUIDE_RETURN, JSON.stringify({ id: "people-add-employee", step: 2, title: "Add an Employee" }));
    m.params = new URLSearchParams("tab=user-guide&id=people-add-employee&step=2");
    const { container } = draw("people-add-employee");
    expect(container.querySelector("#people-add-employee-step-2")?.getAttribute("data-current")).toBe("true");
    expect(sessionStorage.getItem(GUIDE_RETURN)).toBeNull();
  });

  it("opens the screen a section is about with Open Screen, and keeps the way back", async () => {
    draw("people-employees");
    await userEvent.click(screen.getByRole("button", { name: "Open Screen" }));
    expect(m.navigate).toHaveBeenCalledWith("/people?tab=employees");
    expect(JSON.parse(sessionStorage.getItem(GUIDE_RETURN) as string)).toMatchObject({ id: "people-employees", step: null });
  });

  it("groups the Quick Start's cards by role", () => {
    draw(null);
    expect(screen.getByRole("heading", { name: "People & HR" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Add an Employee" })).toBeTruthy();
  });

  it("searches as the words are typed, in a POST body, and opens a result at its step", async () => {
    draw(null);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search the Guide" }), "add someone");
    expect(await screen.findByRole("list", { name: "Guide Results" })).toBeTruthy();
    expect(m.call).toHaveBeenLastCalledWith("POST /api/v1/user-guide/search", { body: { q: "add someone", page: 1 } });
    expect(screen.getByText("Step 2")).toBeTruthy();
    expect(screen.getByText("Add Employee", { selector: "mark" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Add an Employee/ }));
    expect(m.set).toHaveBeenCalledWith({ view: "full", id: "people-add-employee", step: "2", screen: null });
    // The guide shows again, the words still in the box.
    expect(screen.queryByRole("list", { name: "Guide Results" })).toBeNull();
    expect((screen.getByRole("searchbox", { name: "Search the Guide" }) as HTMLInputElement).value).toBe("add someone");
  });

  it("asks for an answer with Enter or Get Answer, once, and opens its source", async () => {
    draw(null);
    const box = screen.getByRole("searchbox", { name: "Search the Guide" });
    await userEvent.type(box, "how do I add an employee");
    await userEvent.click(await screen.findByRole("button", { name: "Get Answer" }));
    expect(await screen.findByText("Open People · Employees and press Add Employee.")).toBeTruthy();
    expect(m.call).toHaveBeenCalledWith("POST /api/v1/user-guide/answer", { body: { q: "how do I add an employee" } });
    expect(screen.queryByRole("button", { name: "Get Answer" })).toBeNull();
    await userEvent.type(box, "{Enter}");
    expect(m.call.mock.calls.filter(([k]) => k === "POST /api/v1/user-guide/answer")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: /Source 1: Add an Employee/ }));
    expect(m.set).toHaveBeenCalledWith({ view: "full", id: "people-add-employee", step: "2", screen: null });
  });

  it("offers no answer and no microphone when neither can be had", async () => {
    CONTENTS.answers = false;
    try {
      draw(null);
      await userEvent.type(screen.getByRole("searchbox", { name: "Search the Guide" }), "how do I add an employee{Enter}");
      expect(await screen.findByRole("list", { name: "Guide Results" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Get Answer" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Record/ })).toBeNull();
      expect(m.call.mock.calls.some(([k]) => k === "POST /api/v1/user-guide/answer")).toBe(false);
    } finally {
      CONTENTS.answers = true;
    }
  });
});
