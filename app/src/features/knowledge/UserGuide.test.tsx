// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GuideChapter, GuideContents } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";

/**
 * Knowledge Hub · User Guide (docs/guides/user-guide.md §3, §10): a step's screen link opens the
 * screen and leaves the way back; coming back opens the guide at that step, marked; the Quick
 * Start groups its cards by role. What each reader receives is the server's (user_guide tests).
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

const m = vi.hoisted(() => ({ navigate: vi.fn(), params: new URLSearchParams(), set: vi.fn() }));
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
beforeEach(() => sessionStorage.clear());
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
});
