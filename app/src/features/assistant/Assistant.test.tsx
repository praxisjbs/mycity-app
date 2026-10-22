// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AiAnswer, AiConversation, AiHistorySummary } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";

/* Praxis AI's screens (docs/guides/praxis-ai.md §10) against stand-ins for the API: every person and record is invented. */

const m = vi.hoisted(() => ({
  call: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({})),
  invalidate: vi.fn(),
  refresh: vi.fn(async () => undefined),
  data: {} as Record<string, unknown>,
  rows: {} as Record<string, unknown[]>,
  turns: {} as Record<string, unknown[]>,
  navigate: vi.fn(),
  setParams: vi.fn(),
  action: null as null | { label: string; onSelect: () => void },
  turnsError: null as unknown,
}));
vi.mock("@/api/hooks", () => ({
  invalidate: m.invalidate,
  refresh: m.refresh,
  useApi: (key: string, opts: { enabled?: boolean } = {}) => ({ data: opts.enabled === false ? null : (m.data[key] ?? null), error: null, loading: false, reload: () => undefined }),
  usePaged: (key: string) => {
    const rows = m.rows[key] ?? [];
    return { rows, page: { number: 1, size: 25, total: rows.length, pages: 1, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined, sort: undefined, setSort: () => undefined, reload: async () => undefined };
  },
  useInfinite: (_key: string, opts: { params: { id: string }; enabled?: boolean }) => {
    const rows = opts.enabled === false ? [] : (m.turns[opts.params.id] ?? []);
    return { rows, page: { number: 1, size: 25, total: rows.length, pages: 1, has_next: false }, loading: false, error: opts.enabled === false ? null : m.turnsError, more: () => undefined, reload: async () => undefined };
  },
}));
vi.mock("@/api/client", async () => ({ api: { call: m.call }, ApiError: (await import("@mycity/ui")).ApiError }));
vi.mock("@/api/upload", () => ({ upload: vi.fn() }));
vi.mock("@/lib/router", () => ({ useRouter: () => ({ navigate: m.navigate }), useSearchParams: () => [new URLSearchParams(), m.setParams] }));
vi.mock("@/shell/layout-context", () => ({ useFitPage: () => undefined }));
vi.mock("@/shell/screen-action", () => ({
  useScreenAction: (a: { label: string; onSelect: () => void } | null) => {
    m.action = a;
  },
}));

import { ApiError } from "@mycity/ui";
import Assistant from "./index";

beforeAll(() => {
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  Element.prototype.scrollIntoView = () => undefined;
  // Desktop: no media query matches the phone's width.
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.data = {};
  m.rows = {};
  m.turns = {};
  m.turnsError = null;
  m.call.mockReset();
  m.call.mockImplementation(async () => ({}));
});

const CONV = "00000000-0000-4000-8000-0000000000c1";

const answer = (over: Partial<AiAnswer> = {}): AiAnswer => ({
  ai_message_id: "00000000-0000-4000-8000-0000000000a1",
  ai_conversation_id: CONV,
  question: "Whose leave waits on me?",
  content: "Two requests wait on you.",
  table: { columns: ["Employee", "Days"], rows: [["Ayo Bello", "3"], ["Kemi Ade", "2"]], numeric: [1] },
  link: { label: "Open Leave", path: "/people?tab=leave" },
  citations: Array.from({ length: 8 }, (_, i) => ({ entity_type: "employee", entity_id: `00000000-0000-4000-8000-00000000000${i}`, label: `Person ${i + 1}`, link: `/people?tab=employees&id=${i}`, read_key: "employees.list" })),
  citations_total: 8,
  reads: [{ key: "leave.requests", rows: 2, total: 2, first: 1 }],
  declined: null,
  more: false,
  feedback: null,
  created_at: "2026-10-22T09:30:00.000Z",
  provisional: true,
  ...over,
});

const ui = (tab: string, id: string | null = null) =>
  render(
    <ModalProvider>
      <Assistant tab={tab} id={id} />
    </ModalProvider>,
  );

const asked = () => m.call.mock.calls.filter(([key]) => key === "POST /api/v1/ai/ask").map(([, opts]) => opts as { body: { question: string; ai_conversation_id?: string }; idempotencyKey: string });

describe("Ask", () => {
  it("offers Try Asking when empty; a tapped question is asked once and its answer shown in full", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: ["Whose leave waits on me?", "Who came in late this week?"] };
    m.call.mockImplementation(async (key: unknown) => (key === "POST /api/v1/ai/ask" ? answer() : {}));
    ui("ask");
    expect(m.action?.label).toBe("New Conversation");
    expect(screen.getByRole("heading", { name: "Try Asking" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Whose leave waits on me/ }));
    expect(await screen.findByText("Two requests wait on you.")).toBeTruthy();
    expect(asked()).toEqual([{ body: { question: "Whose leave waits on me?" }, idempotencyKey: expect.any(String) }]);
    // The new conversation goes into the address without a new history entry.
    expect(m.setParams).toHaveBeenCalledWith({ id: CONV }, { replace: true });

    const card = screen.getByRole("article", { name: "Answer" });
    expect(within(card).getByRole("table").textContent).toContain("Ayo Bello");
    await userEvent.click(within(card).getByRole("button", { name: "Open Leave" }));
    expect(m.navigate).toHaveBeenCalledWith("/people?tab=leave");
    // The first six records read, then the rest behind +2 More.
    expect(within(card).getByRole("button", { name: "Person 6" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Person 7" })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "+2 More" }));
    expect(within(card).getByRole("button", { name: "Person 8" })).toBeTruthy();
  });

  it("a failed question keeps its words and tries again with the same key", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    m.call.mockRejectedValueOnce(new ApiError(503, { error: { code: "AI_UNAVAILABLE", message: "Praxis AI is not answering just now" } }));
    ui("ask");
    await userEvent.type(screen.getByRole("textbox", { name: "Ask a Question" }), "Who is late today?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Praxis AI is not answering just now");

    m.call.mockImplementation(async () => answer({ question: "Who is late today?", content: "Nobody is late today." }));
    await userEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(await screen.findByText("Nobody is late today.")).toBeTruthy();
    const [first, second] = asked();
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.body).toEqual({ question: "Who is late today?" });
  });

  it("an open conversation shows its turns; Show Next 25 asks for the next page in it", async () => {
    m.turns[CONV] = [answer({ more: true, citations: [], citations_total: 0, reads: [{ key: "employees.list", rows: 2, total: 312, first: 1 }] })];
    m.call.mockImplementation(async () => answer({ ai_message_id: "00000000-0000-4000-8000-0000000000a2", question: "Show the next 25.", content: "Here are the next people." }));
    ui("ask", CONV);
    expect(screen.getByText("Showing 2 of 312")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show Next 25" }));
    expect(await screen.findByText("Here are the next people.")).toBeTruthy();
    expect(asked()[0].body).toEqual({ question: "Show the next 25.", ai_conversation_id: CONV });
    expect(m.setParams).not.toHaveBeenCalled();
  });

  it("Helpful is sent, and pressed again takes it back", async () => {
    m.turns[CONV] = [answer()];
    ui("ask", CONV);
    const helpful = screen.getByRole("button", { name: "Helpful" });
    await userEvent.click(helpful);
    await waitFor(() => expect(helpful.getAttribute("aria-pressed")).toBe("true"));
    await userEvent.click(helpful);
    await waitFor(() => expect(helpful.getAttribute("aria-pressed")).toBe("false"));
    const sent = m.call.mock.calls.filter(([key]) => key === "POST /api/v1/ai/answers/:id/feedback").map(([, o]) => (o as { body: unknown }).body);
    expect(sent).toEqual([{ feedback: "up" }, { feedback: null }]);
  });

  it("a conversation deleted in another tab: a new one, with the question back in the box", async () => {
    m.turns[CONV] = [answer()];
    m.call.mockRejectedValueOnce(new ApiError(404, { error: { code: "NOT_FOUND", message: "Not found" } }));
    ui("ask", CONV);
    const box = screen.getByRole("textbox", { name: "Ask a Question" });
    await userEvent.type(box, "And next week?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith("/praxis-ai?tab=ask"));
    expect((box as HTMLInputElement).value).toBe("And next week?");
  });

  it("⌘K's New Conversation opens a clean address, never the one it arrived on", () => {
    ui("ask", CONV);
    m.action!.onSelect();
    expect(m.navigate).toHaveBeenCalledWith("/praxis-ai?tab=ask");
    expect(m.setParams).not.toHaveBeenCalled();
  });

  it("an answer that lands after the person moved to another conversation is not shown there", async () => {
    let land: (a: AiAnswer) => void = () => undefined;
    m.turns[CONV] = [answer()];
    m.call.mockImplementation(() => new Promise((r) => (land = r as (a: AiAnswer) => void)));
    const view = ui("ask", CONV);
    await userEvent.type(screen.getByRole("textbox", { name: "Ask a Question" }), "Late answer?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const OTHER = "00000000-0000-4000-8000-0000000000c2";
    view.rerender(
      <ModalProvider>
        <Assistant tab="ask" id={OTHER} />
      </ModalProvider>,
    );
    land(answer({ ai_message_id: "00000000-0000-4000-8000-0000000000a9", content: "This belongs to the first one." }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
    expect(screen.queryByText("This belongs to the first one.")).toBeNull();
    expect(m.setParams).not.toHaveBeenCalled();
  });

  it("a question refused as it stands goes back to the box to change, not to Try Again", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    m.call.mockRejectedValueOnce(new ApiError(422, { error: { code: "VALIDATION", message: "Check the question", fields: { question: ["Too long"] } } }));
    ui("ask");
    const box = screen.getByRole("textbox", { name: "Ask a Question" });
    await userEvent.type(box, "Who is late?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect((box as HTMLInputElement).value).toBe("Who is late?"));
    expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
  });

  it("a conversation that is gone when opened starts a new one", async () => {
    m.turnsError = new ApiError(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    ui("ask", CONV);
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith("/praxis-ai?tab=ask"));
  });

  it("the second page of a list says which rows it shows", () => {
    m.turns[CONV] = [answer({ table: { columns: ["Name"], rows: Array.from({ length: 25 }, (_, i) => [`P${i}`]), numeric: [] }, reads: [{ key: "employees.list", rows: 25, total: 312, first: 26 }], citations: [], citations_total: 0 })];
    ui("ask", CONV);
    expect(screen.getByText("Showing 26 to 50 of 312")).toBeTruthy();
  });
});

describe("History", () => {
  const conv: AiConversation = { ai_conversation_id: CONV, title: "Whose leave waits on me?", last_asked_at: "2026-10-22T09:30:00.000Z", questions: 3, rows_read: 14 };
  const summary: AiHistorySummary = { month: "2026-10", questions_this_month: 3, conversations: 1, rows_read_this_month: 14, by_module: [{ module_key: "people", label: "People", questions: 3 }] };

  it("this month's figures and the conversations; a row opens it on Ask", async () => {
    m.data["GET /api/v1/ai/history/summary"] = summary;
    m.rows["GET /api/v1/ai/conversations"] = [conv];
    ui("history");
    expect(screen.getByRole("heading", { name: "History", level: 1 })).toBeTruthy();
    expect(screen.getAllByText("October 2026")).toHaveLength(3);
    await userEvent.click(screen.getByRole("row", { name: /Whose leave waits on me/ }));
    expect(m.navigate).toHaveBeenCalledWith(`/praxis-ai?tab=ask&id=${CONV}`);
  });

  it("Clear History asks first, then removes every conversation", async () => {
    m.data["GET /api/v1/ai/history/summary"] = summary;
    m.rows["GET /api/v1/ai/conversations"] = [conv];
    ui("history");
    await userEvent.click(screen.getAllByRole("button", { name: "Clear History" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(m.call).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Clear History" }));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("DELETE /api/v1/ai/history"));
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/ai");
  });
});
