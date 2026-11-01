// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AiAnswer, AiHistorySummary, AiQuestion } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";

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
  params: new URLSearchParams(),
  action: null as null | { label: string; onSelect: () => void },
  turnsError: null as unknown,
  saveExport: vi.fn(async (asked: Promise<unknown>) => (await asked, true)),
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
vi.mock("@/api/exports", () => ({ saveExport: m.saveExport }));
vi.mock("@/lib/router", () => ({ useRouter: () => ({ navigate: m.navigate, location: { path: "/praxis-ai", module: "praxis-ai", tab: "ask", id: null, params: new URLSearchParams("tab=ask") } }), useSearchParams: () => [m.params, m.setParams] }));
vi.mock("@/shell/layout-context", () => ({ useFitPage: () => undefined }));
vi.mock("@/shell/screen-action", () => ({
  useScreenAction: (a: { label: string; onSelect: () => void } | null) => {
    m.action = a;
  },
}));

import { ApiError } from "@mycity/ui";
import { emitRealtimeForTest } from "@/api/realtime";
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
  // The phone's full-screen chat and its sheet are drawers: jsdom needs these for them.
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  if (!("mozTransform" in CSSStyleDeclaration.prototype))
    Object.defineProperty(CSSStyleDeclaration.prototype, "mozTransform", {
      configurable: true,
      get(this: CSSStyleDeclaration) {
        return this.transform || "none";
      },
    });
  installMatchMedia();
});

// Desktop unless a test says it is a phone.
beforeEach(() => setViewport(1440));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.data = {};
  m.rows = {};
  m.turns = {};
  m.params = new URLSearchParams();
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
  table: { columns: ["Employee", "Days"], rows: [["Ayo Bello", "3"], ["Kemi Ade", "2"]], numeric: [1], links: ["/people?tab=leave&id=l1", "/people?tab=leave&id=l2"], read: 1 },
  link: { label: "Open Leave", path: "/people?tab=leave" },
  citations: Array.from({ length: 8 }, (_, i) => ({ entity_type: "employee", entity_id: `00000000-0000-4000-8000-00000000000${i}`, label: `Person ${i + 1}`, link: `/people?tab=employees&id=${i}`, read_key: "employees.list" })),
  citations_total: 8,
  sources: [
    { kind: "type", entity_type: "leave_request", label: "leave request", count: 2, link: null },
    { kind: "type", entity_type: "employee", label: "employee", count: 8, link: null },
  ],
  reads: [{ n: 1, key: "leave.requests", kind: "read", module_key: null, params: {}, outcome: "read", rows: 2, total: 2, first: 1, masked: [] }],
  declined: null,
  more: false,
  card: null,
  overview: null,
  context: null,
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
    expect(asked()).toEqual([{ body: { question: "Whose leave waits on me?", shows: ["pane"] }, idempotencyKey: expect.any(String) }]);
    // The new conversation goes into the address without a new history entry.
    expect(m.setParams).toHaveBeenCalledWith({ id: CONV }, { replace: true });

    const card = screen.getByRole("article", { name: "Answer" });
    expect(within(card).getByRole("table").textContent).toContain("Ayo Bello");
    await userEvent.click(within(card).getByRole("button", { name: "Open Leave" }));
    expect(m.navigate).toHaveBeenCalledWith("/people?tab=leave");
    // From names the kinds of record and how many, never each record (decision 9).
    expect(within(card).getByText("leave request ×2")).toBeTruthy();
    expect(within(card).getByText("employee ×8")).toBeTruthy();
    expect(within(card).queryByText("Person 1")).toBeNull();
    // Each row of the table opens its own record.
    await userEvent.click(within(card).getByRole("row", { name: /Ayo Bello/ }));
    expect(m.navigate).toHaveBeenCalledWith("/people?tab=leave&id=l1");
  });

  it("an answer that rests on one record names it in From; the chip shows it in the pane, and Open Record opens it", async () => {
    m.turns[CONV] = [
      answer({
        table: null,
        citations: [],
        citations_total: 1,
        sources: [{ kind: "record", entity_type: "employee", label: "Ayo Bello", count: 1, link: "/people?tab=employees&id=e1" }],
      }),
    ];
    ui("ask", CONV);
    const card = screen.getByRole("article", { name: "Answer" });
    await userEvent.click(within(card).getByRole("button", { name: "Ayo Bello" }));
    const pane = screen.getByRole("region", { name: "Pane" });
    expect(within(pane).getByRole("tab", { name: "Record" }).getAttribute("aria-selected")).toBe("true");
    expect(within(pane).getByRole("heading", { name: "Ayo Bello" })).toBeTruthy();
    await userEvent.click(within(pane).getByRole("button", { name: "Open Record" }));
    expect(m.navigate).toHaveBeenCalledWith("/people?tab=employees&id=e1");
  });

  it("the first answer opens the conversation, and the next question is asked in it", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    m.call.mockImplementationOnce(async () => answer()).mockImplementationOnce(async () => answer({ ai_message_id: "00000000-0000-4000-8000-0000000000a2", question: "And this week?", content: "One more this week." }));
    const view = ui("ask");
    const box = screen.getByRole("textbox", { name: "Ask a Question" });
    await userEvent.type(box, "Whose leave waits on me?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Two requests wait on you.")).toBeTruthy();
    // The router moves the address to the new conversation, as onOpened asked.
    view.rerender(
      <ModalProvider>
        <Assistant tab="ask" id={CONV} />
      </ModalProvider>,
    );
    await userEvent.type(box, "And this week?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("One more this week.")).toBeTruthy();
    expect(asked().map((a) => a.body)).toEqual([{ question: "Whose leave waits on me?", shows: ["pane"] }, { question: "And this week?", ai_conversation_id: CONV, shows: ["pane"] }]);
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
    expect(second.body).toEqual({ question: "Who is late today?", shows: ["pane"] });
  });

  it("an open conversation shows its turns; Show Next 25 asks for the next page in it", async () => {
    m.turns[CONV] = [answer({ more: true, citations: [], citations_total: 0, reads: [{ n: 1, key: "employees.list", kind: "read", module_key: null, params: {}, outcome: "read", rows: 2, total: 312, first: 1, masked: [] }] })];
    m.call.mockImplementation(async () => answer({ ai_message_id: "00000000-0000-4000-8000-0000000000a2", question: "Show the next 25.", content: "Here are the next people." }));
    ui("ask", CONV);
    expect(screen.getByText("Showing 2 of 312")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show Next 25" }));
    expect(await screen.findByText("Here are the next people.")).toBeTruthy();
    expect(asked()[0].body).toEqual({ question: "Show the next 25.", ai_conversation_id: CONV, shows: ["pane"] });
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

  it("AI switched off goes back to the box too: asking again cannot help", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    m.call.mockRejectedValueOnce(new ApiError(503, { error: { code: "AI_DISABLED", message: "AI features are switched off." } }));
    ui("ask");
    const box = screen.getByRole("textbox", { name: "Ask a Question" });
    await userEvent.type(box, "Who is late?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect((box as HTMLInputElement).value).toBe("Who is late?"));
    expect(screen.queryByRole("button", { name: "Try Again" })).toBeNull();
  });

  it("an unexpected fault shows the reference to quote", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    m.call.mockRejectedValueOnce(new ApiError(500, { error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side.", reference: "REQ-7F3A" } } as never));
    ui("ask");
    await userEvent.type(screen.getByRole("textbox", { name: "Ask a Question" }), "Who is late?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Reference REQ-7F3A");
  });

  it("Send pressed while an answer is coming waits on it, the words kept in the box", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    let land: (a: AiAnswer) => void = () => undefined;
    m.call.mockImplementationOnce(() => new Promise((r) => (land = r as (a: AiAnswer) => void)));
    ui("ask");
    const box = screen.getByRole("textbox", { name: "Ask a Question" });
    await userEvent.type(box, "Who is late?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await userEvent.type(box, "And who is away?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(asked()).toHaveLength(1);
    expect((box as HTMLInputElement).value).toBe("And who is away?");
    land(answer({ question: "Who is late?" }));
    expect(await screen.findByText("Two requests wait on you.")).toBeTruthy();
  });

  it("a conversation that is gone when opened starts a new one", async () => {
    m.turnsError = new ApiError(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    ui("ask", CONV);
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith("/praxis-ai?tab=ask"));
  });

  it("the second page of a list says which rows it shows", () => {
    m.turns[CONV] = [answer({ table: { columns: ["Name"], rows: Array.from({ length: 25 }, (_, i) => [`P${i}`]), numeric: [], links: Array.from({ length: 25 }, () => null), read: 1 }, reads: [{ n: 1, key: "employees.list", kind: "read", module_key: null, params: {}, outcome: "read", rows: 25, total: 312, first: 26, masked: [] }], citations: [], citations_total: 0 })];
    ui("ask", CONV);
    expect(screen.getByText("Showing 26 to 50 of 312")).toBeTruthy();
  });
});

describe("The full screen: Back, the context and the pane", () => {
  const FROM = "/people?tab=leave&status=waiting";
  const rows = {
    n: 1,
    key: "leave.requests",
    label: "Leave requests waiting on someone",
    columns: ["Employee", "Days"],
    rows: [
      ["Ayo Bello", "3"],
      ["Kemi Ade", "2"],
    ],
    numeric: [1],
    links: ["/people?tab=leave&id=l1", "/people?tab=leave&id=l2"],
    page: { number: 1, size: 25, total: 2, pages: 1, has_next: false },
  };

  it("Back and Escape return to the screen it was opened from, named under the title", async () => {
    m.params = new URLSearchParams({ from: FROM });
    ui("ask");
    expect(screen.getByText("From People · Leave")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(m.navigate).toHaveBeenCalledWith(FROM);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(m.navigate).toHaveBeenCalledTimes(2);
    expect(m.navigate).toHaveBeenLastCalledWith(FROM);
  });

  it("with no screen to return to, Back goes to History", async () => {
    ui("ask");
    expect(screen.queryByText(/^From /)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(m.navigate).toHaveBeenCalledWith("/praxis-ai?tab=history");
  });

  it("the screen's context goes with every question, with the pane asked for; New Conversation keeps the screen", async () => {
    m.params = new URLSearchParams({ from: "/people?tab=leave&status=waiting&id=00000000-0000-4000-8000-0000000000e1&q=ayo&page=2" });
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    m.call.mockImplementation(async () => answer());
    ui("ask");
    await userEvent.type(screen.getByRole("textbox", { name: "Ask a Question" }), "Approve these");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Two requests wait on you.");
    expect(asked()[0].body).toEqual({
      question: "Approve these",
      shows: ["pane"],
      context: { module: "people", tab: "leave", id: "00000000-0000-4000-8000-0000000000e1", q: "ayo", filters: { status: "waiting" } },
    });
    m.action!.onSelect();
    expect(m.navigate).toHaveBeenCalledWith("/praxis-ai?tab=ask&from=%2Fpeople%3Ftab%3Dleave%26status%3Dwaiting%26id%3D00000000-0000-4000-8000-0000000000e1%26q%3Dayo%26page%3D2");
  });

  it("Export on the Table asks for every row of the read as a file and saves it on this device (§6.16)", async () => {
    m.data["GET /api/v1/ai/answers/:id/reads/:n"] = rows;
    m.call.mockImplementation(async (key: unknown) => (key === "POST /api/v1/ai/ask" ? answer() : { document_id: "00000000-0000-4000-8000-0000000000e1", file_name: "praxis-ai-leave-requests-2026-11-01.xlsx", status: "pending" }));
    ui("ask");
    await userEvent.type(screen.getByRole("textbox", { name: "Ask a Question" }), "Whose leave waits on me?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Two requests wait on you.");
    const pane = screen.getByRole("region", { name: "Pane" });
    expect(within(pane).getByRole("tab", { name: "Table" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.click(within(pane).getByRole("button", { name: "Export" }));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("POST /api/v1/ai/answers/:id/reads/:n/export", { params: { id: "00000000-0000-4000-8000-0000000000a1", n: 1 }, body: {} }));
    expect(m.saveExport).toHaveBeenCalled();
  });

  it("the latest answer fills the pane: its Table pages the read again, a row opens the Record, Sources lists the reads", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    m.data["GET /api/v1/ai/answers/:id/reads/:n"] = rows;
    m.call.mockImplementation(async () => answer());
    ui("ask");
    expect(screen.getByRole("heading", { name: "No Answer Yet" })).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Ask a Question" }), "Whose leave waits on me?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Two requests wait on you.");
    const pane = screen.getByRole("region", { name: "Pane" });
    expect(within(pane).getByRole("tab", { name: "Table" }).getAttribute("aria-selected")).toBe("true");
    expect(within(pane).getByRole("tab", { name: "Overview" }).hasAttribute("disabled")).toBe(true);
    expect(within(pane).getByRole("table", { name: "Leave Requests" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Answer" }).getAttribute("aria-current")).toBe("true");
    await userEvent.click(within(pane).getByRole("row", { name: /Kemi Ade/ }));
    expect(within(pane).getByRole("tab", { name: "Record" }).getAttribute("aria-selected")).toBe("true");
    expect(within(pane).getByRole("heading", { name: "Kemi Ade" })).toBeTruthy();
    await userEvent.click(within(pane).getByRole("button", { name: "Open Record" }));
    expect(m.navigate).toHaveBeenCalledWith("/people?tab=leave&id=l2");
    await userEvent.click(within(pane).getByRole("tab", { name: "Sources" }));
    const read = within(pane).getByRole("listitem", { name: "Read 1, Leave Requests" });
    expect(read.textContent).toContain("2 rows");
    await userEvent.click(within(read).getByRole("button", { name: "Open Table" }));
    expect(within(pane).getByRole("tab", { name: "Table" }).getAttribute("aria-selected")).toBe("true");
  });

  it("an earlier answer's chip brings its pane back, and Open Figures on another moves it there", async () => {
    const A1 = "00000000-0000-4000-8000-0000000000a1";
    const A2 = "00000000-0000-4000-8000-0000000000a2";
    const first = answer({
      ai_message_id: A1,
      content: "First.",
      citations: [{ entity_type: "leave_request", entity_id: "l1", label: "Ayo Bello", link: "/people?tab=leave&id=l1", read_key: "leave.requests" }],
      citations_total: 1,
      sources: [{ kind: "type", entity_type: "leave_request", label: "leave request", count: 2, link: null }],
    });
    const second = answer({ ai_message_id: A2, content: "Second.", sources: [], citations: [], citations_total: 0 });
    m.turns[CONV] = [second, first];
    m.data["GET /api/v1/ai/answers/:id/reads/:n"] = rows;
    ui("ask", CONV);
    expect(screen.getByRole("heading", { name: "No Answer Yet" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "leave request, 2 records" }));
    const pane = screen.getByRole("region", { name: "Pane" });
    expect(within(pane).getByRole("tab", { name: "Table" }).getAttribute("aria-selected")).toBe("true");
    const articles = screen.getAllByRole("article", { name: "Answer" });
    expect(articles[0].getAttribute("aria-current")).toBe("true");
    expect(articles[1].getAttribute("aria-current")).toBeNull();
    await userEvent.click(within(articles[1]).getByRole("button", { name: "Open Figures" }));
    expect(articles[1].getAttribute("aria-current")).toBe("true");
    expect(articles[0].getAttribute("aria-current")).toBeNull();
  });

  it("while the question runs, the line says what is being read for this question, and goes when the answer lands", async () => {
    m.data["GET /api/v1/ai/suggestions"] = { questions: [] };
    let land: (a: AiAnswer) => void = () => undefined;
    m.call.mockImplementationOnce(() => new Promise((r) => (land = r as (a: AiAnswer) => void)));
    ui("ask");
    await userEvent.type(screen.getByRole("textbox", { name: "Ask a Question" }), "Whose leave waits on me?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByText("Reading Your Records")).toBeTruthy();
    const key = asked()[0].idempotencyKey;
    act(() => emitRealtimeForTest("ai:progress", { ask_key: "another-question", n: 1, of: 5, read_key: "payroll.runs", kind: "read", words: "payroll runs" }));
    expect(screen.getByText("Reading Your Records")).toBeTruthy();
    act(() => emitRealtimeForTest("ai:progress", { ask_key: key, n: 2, of: 5, read_key: "leave.requests", kind: "read", words: "leave requests" }));
    expect(screen.getByRole("status").textContent).toBe("Reading leave requests · 2 of 5");
    land(answer());
    await screen.findByText("Two requests wait on you.");
    expect(screen.queryByText(/^Reading /)).toBeNull();
  });

  it("on a phone, opened from a screen: the conversation full width with Back, and Open Figures opens the pane as a sheet", async () => {
    setViewport(390);
    m.params = new URLSearchParams({ from: FROM });
    m.turns[CONV] = [answer()];
    m.data["GET /api/v1/ai/answers/:id/reads/:n"] = rows;
    ui("ask", CONV);
    expect(screen.getByRole("textbox", { name: "Ask a Question" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Pane" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(m.navigate).toHaveBeenCalledWith(FROM);
    await userEvent.click(screen.getByRole("button", { name: "Open Figures" }));
    const sheet = await screen.findByRole("dialog", { name: "Figures" });
    expect(within(sheet).getByRole("tab", { name: "Table" }).getAttribute("aria-selected")).toBe("true");
    expect(await within(sheet).findByRole("button", { name: /Kemi Ade/ })).toBeTruthy();
  });
});

describe("Ask on a phone", () => {
  const OTHER = "00000000-0000-4000-8000-0000000000c2";
  const conversations = [
    { ai_conversation_id: CONV, title: "Whose leave waits on me?", last_asked_at: "2026-10-22T09:30:00.000Z", questions: 2, rows_read: 4 },
    { ai_conversation_id: OTHER, title: "Who came in late this week?", last_asked_at: "2026-10-21T08:00:00.000Z", questions: 1, rows_read: 7 },
  ];

  it("opens on the conversations with New Conversation; one opens full screen, and Conversations switches to another", async () => {
    setViewport(390);
    m.rows["GET /api/v1/ai/conversations"] = conversations;
    m.turns[CONV] = [answer()];
    m.turns[OTHER] = [answer({ ai_message_id: "00000000-0000-4000-8000-0000000000a2", ai_conversation_id: OTHER, question: "Who came in late this week?", content: "Seven late arrivals." })];
    m.data["GET /api/v1/ai/suggestions"] = { questions: ["What happened today?"] };
    ui("ask");
    // The landing page is the list and New Conversation, nothing else.
    expect(screen.queryByRole("textbox", { name: "Ask a Question" })).toBeNull();
    expect(m.action?.label).toBe("New Conversation");
    await userEvent.click(screen.getByRole("button", { name: /Whose leave waits on me/ }));
    const chat = await screen.findByRole("dialog", { name: "Praxis AI" });
    expect(await within(chat).findByText("Two requests wait on you.")).toBeTruthy();

    // Inside the chat, the other conversations are a sheet, as a channel's switcher is.
    await userEvent.click(within(chat).getByRole("button", { name: "Conversations" }));
    const sheet = await screen.findByRole("dialog", { name: "Conversations" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Who came in late this week/ }));
    expect(await screen.findByText("Seven late arrivals.")).toBeTruthy();

    // New Conversation starts one: Try Asking again.
    await userEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    expect(await screen.findByRole("heading", { name: "Try Asking" })).toBeTruthy();
  });

  it("a conversation asked for by address opens at once, and the address is the list's again", async () => {
    setViewport(390);
    m.rows["GET /api/v1/ai/conversations"] = conversations;
    m.turns[CONV] = [answer()];
    ui("ask", CONV);
    expect(await screen.findByText("Two requests wait on you.")).toBeTruthy();
    expect(m.setParams).toHaveBeenCalledWith({ id: null }, { replace: true });
  });
});

describe("History", () => {
  const question: AiQuestion = {
    ai_message_id: "00000000-0000-4000-8000-0000000000a1",
    ai_conversation_id: CONV,
    question: "Whose leave waits on me?",
    asked_at: "2026-10-22T09:30:00.000Z",
    sources: ["leave request", "employee"],
    tokens: 2140,
    cost_ngn: "18.00",
  };
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month, i) => ({ month, spend_ngn: `${(i + 1) * 300}.00` }));
  const company: AiHistorySummary = { month: "2026-10", view: "company", questions_this_month: 84, your_questions: 31, spend_ngn: "1840.00", cap_ngn: "25000.00", spend_by_month: months, by_module: [{ module_key: "people", label: "People", questions: 3 }] };
  const own: AiHistorySummary = { ...company, view: "own", questions_this_month: 3, your_questions: 120, spend_ngn: "410.00", cap_ngn: null };

  it("for AI Control: the company's questions, spend and cap; Your Questions with sources, tokens and cost; a row opens it on Ask", async () => {
    m.data["GET /api/v1/ai/history/summary"] = company;
    m.rows["GET /api/v1/ai/history/questions"] = [question];
    ui("history");
    expect(screen.getByRole("heading", { name: "History", level: 1 })).toBeTruthy();
    expect(screen.getByText("Questions This Month")).toBeTruthy();
    expect(screen.getByText("Everyone, October 2026")).toBeTruthy();
    expect(screen.getByText("₦25,000.00")).toBeTruthy();
    const row = screen.getByRole("row", { name: /Whose leave waits on me/ });
    expect(row.textContent).toContain("leave request, employee");
    expect(row.textContent).toContain("2,140");
    expect(row.textContent).toContain("₦18.00");
    await userEvent.click(row);
    expect(m.navigate).toHaveBeenCalledWith(`/praxis-ai?tab=ask&id=${CONV}`);
  });

  it("for everyone else: their own figures, all their questions, no cap", () => {
    m.data["GET /api/v1/ai/history/summary"] = own;
    m.rows["GET /api/v1/ai/history/questions"] = [question];
    ui("history");
    expect(screen.getByText("Your Spend")).toBeTruthy();
    expect(screen.getByText("All Time")).toBeTruthy();
    expect(screen.queryByText("Monthly Cap")).toBeNull();
    expect(screen.queryByText(/^Everyone/)).toBeNull();
  });

  it("Export asks for the workbook of one's questions", async () => {
    m.data["GET /api/v1/ai/history/summary"] = own;
    m.rows["GET /api/v1/ai/history/questions"] = [question];
    ui("history");
    await userEvent.click(screen.getAllByRole("button", { name: "Export" })[0]);
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("POST /api/v1/ai/history/export", { body: {} }));
    expect(m.saveExport).toHaveBeenCalledTimes(1);
  });

  it("Clear History asks first, then removes every conversation", async () => {
    m.data["GET /api/v1/ai/history/summary"] = own;
    m.rows["GET /api/v1/ai/history/questions"] = [question];
    ui("history");
    await userEvent.click(screen.getAllByRole("button", { name: "Clear History" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(m.call).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Clear History" }));
    await waitFor(() => expect(m.call).toHaveBeenCalledWith("DELETE /api/v1/ai/history"));
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/ai");
  });
});

