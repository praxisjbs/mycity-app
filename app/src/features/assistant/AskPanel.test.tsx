// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ModalProvider } from "@mycity/ui";
import { RouterProvider } from "@/lib/router";

/* Praxis AI over the screen (docs/guides/praxis-ai.md §10.2), with the conversation stood in for: it is tested on Ask. */

vi.mock("@/api/hooks", () => ({
  refresh: vi.fn(async () => undefined),
  usePaged: () => ({
    rows: [{ ai_conversation_id: "c2", title: "Who came in late this week?", last_asked_at: "2026-10-21T08:00:00.000Z", questions: 1, rows_read: 7 }],
    page: { number: 1, size: 25, total: 1, pages: 1, has_next: false },
    loading: false,
    error: null,
    q: "",
    setQ: () => undefined,
    setPage: () => undefined,
    reload: async () => undefined,
  }),
}));
vi.mock("./Conversation", async () => {
  const { useRouter } = await import("@/lib/router");
  return {
    Conversation: ({ id, context, onOpened }: { id: string | null; context: { module: string; tab: string } | null; onOpened: (id: string) => void }) => {
      const { navigate } = useRouter();
      return (
        <div>
          <p>{id ? `Conversation ${id}` : "A new conversation"}</p>
          <p>{context ? `Asked from ${context.module}/${context.tab}` : "No context"}</p>
          <button type="button" onClick={() => onOpened("c1")}>
            Answer
          </button>
          <button type="button" onClick={() => navigate("/people?tab=leave")}>
            Open Leave
          </button>
        </div>
      );
    },
  };
});

import AskPanel from "./AskPanel";

beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => undefined;
  // jsdom answers "" for a computed transform and its webkit name; the drawer then reads the moz name.
  if (!("mozTransform" in CSSStyleDeclaration.prototype))
    Object.defineProperty(CSSStyleDeclaration.prototype, "mozTransform", {
      configurable: true,
      get(this: CSSStyleDeclaration) {
        return this.transform || "none";
      },
    });
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function Screen() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "Over the screen" : "Closed"}</p>
      <AskPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const show = () =>
  render(
    <RouterProvider>
      <ModalProvider>
        <Screen />
      </ModalProvider>
    </RouterProvider>,
  );

describe("Praxis AI from the floating button", () => {
  it("opens over the screen; the first answer keeps its conversation, and New Conversation starts another", async () => {
    window.history.replaceState(null, "", "/workspace?tab=tasks");
    show();
    const page = await screen.findByRole("dialog", { name: "Praxis AI" });
    expect(page.textContent).toContain("A new conversation");
    // The screen underneath is the question's context (decision 12).
    expect(page.textContent).toContain("Asked from workspace/tasks");
    expect(screen.queryByRole("button", { name: "New Conversation" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(page.textContent).toContain("Conversation c1");
    await userEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    expect(page.textContent).toContain("A new conversation");
    expect(window.location.search).toBe("?tab=tasks");
  });

  it("Conversations opens the person's other conversations as a sheet, and one switches to it", async () => {
    window.history.replaceState(null, "", "/workspace?tab=tasks");
    show();
    const page = await screen.findByRole("dialog", { name: "Praxis AI" });
    await userEvent.click(screen.getByRole("button", { name: "Conversations" }));
    const sheet = await screen.findByRole("dialog", { name: "Conversations" });
    expect(within(sheet).getByRole("button", { name: "New Conversation" })).toBeTruthy();
    await userEvent.click(within(sheet).getByRole("button", { name: /Who came in late this week/ }));
    expect(page.textContent).toContain("Conversation c2");
  });

  it("an answer's screen button goes there and closes it", async () => {
    window.history.replaceState(null, "", "/workspace?tab=tasks");
    show();
    await screen.findByRole("dialog", { name: "Praxis AI" });
    await userEvent.click(screen.getByRole("button", { name: "Open Leave" }));
    expect(window.location.pathname + window.location.search).toBe("/people?tab=leave");
    expect(screen.getByText("Closed")).toBeTruthy();
  });
});
