// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { ModalProvider, Toaster } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api, ApiError } from "@/api/client";
import { emitRealtimeForTest } from "@/api/realtime";
import type { Message } from "@/api/types/community";
import { Composer, ThreadBody, useThread } from "./Chat";

/**
 * A conversation's thread against a stand-in server (docs/guides/community.md §3 steps 10 and
 * 20): a receipt is read but never answered, a new message from the other person is said
 * delivered once, a quiet read never empties the screen, the first unread is reached, older
 * pages lay in above, and pushes at once make one more read, not one each. The composer says why a
 * message was refused and keeps its words.
 */

installMatchMedia();
beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ID = "11111111-1111-4111-8111-111111111111";
const DAY = Date.parse("2026-10-21T08:00:00Z");

function message(n: number, mine: boolean): Message {
  return {
    community_message_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    community_channel_id: ID,
    message_type: "text",
    author: null,
    mine,
    sent_at: new Date(DAY + n * 60_000).toISOString(),
    body: `Message ${n}`,
    deleted: false,
    status: null,
  } as unknown as Message;
}

/** The server: newest page first, each page oldest to newest, 25 a page. */
function server(initial: Message[]) {
  const store = { msgs: [...initial], gate: null as Promise<void> | null };
  const calls: string[] = [];
  const call = vi.spyOn(api, "call").mockImplementation((async (key: string, opts: { query?: { page?: number } }) => {
    calls.push(key);
    if (key === "GET /api/v1/community/channels/:id/messages") {
      if (store.gate) await store.gate;
      const n = opts.query?.page ?? 1;
      const end = store.msgs.length - (n - 1) * 25;
      const data = store.msgs.slice(Math.max(0, end - 25), Math.max(0, end));
      const pages = Math.ceil(store.msgs.length / 25);
      return { data, page: { number: n, size: 25, total: store.msgs.length, pages, has_next: n < pages } };
    }
    if (key === "GET /api/v1/community/channels/:id/pins") return { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };
    if (key === "POST /api/v1/community/channels/:id/delivered") return null;
    throw new Error(`unexpected ${key}`);
  }) as unknown as typeof api.call);
  const count = (key: string) => calls.filter((c) => c === key).length;
  return { store, call, count };
}

const READ = "GET /api/v1/community/channels/:id/messages";
const DELIVERED = "POST /api/v1/community/channels/:id/delivered";
const push = (event: string) => act(() => emitRealtimeForTest(event, { community_channel_id: ID, community_message_id: null }));

describe("a conversation's thread", () => {
  it("reads again on a receipt but never answers it, so two screens cannot loop", async () => {
    const s = server([message(1, true)]);
    const { result } = renderHook(() => useThread(ID, { direct: true }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const reads = s.count(READ);

    await push("community.receipt");
    await waitFor(() => expect(s.count(READ)).toBe(reads + 1));
    await push("community.receipt");
    await waitFor(() => expect(s.count(READ)).toBe(reads + 2));
    expect(s.count(DELIVERED)).toBe(0);
  });

  it("says delivered once for a new message from the other person, and not for one's own", async () => {
    const s = server([message(1, false)]);
    const { result } = renderHook(() => useThread(ID, { direct: true }));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    s.store.msgs.push(message(2, true));
    await push("community.message");
    await waitFor(() => expect(result.current.msgs).toHaveLength(2));
    expect(s.count(DELIVERED)).toBe(0);

    s.store.msgs.push(message(3, false));
    await push("community.message");
    await waitFor(() => expect(s.count(DELIVERED)).toBe(1));
    await push("community.message");
    await waitFor(() => expect(result.current.msgs).toHaveLength(3));
    expect(s.count(DELIVERED)).toBe(1);
  });

  it("never says delivered in a channel", async () => {
    const s = server([message(1, false)]);
    const { result } = renderHook(() => useThread(ID));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    s.store.msgs.push(message(2, false));
    await push("community.message");
    await waitFor(() => expect(result.current.msgs).toHaveLength(2));
    expect(s.count(DELIVERED)).toBe(0);
  });

  it("keeps 'No messages yet' on screen while a quiet read is out", async () => {
    const s = server([]);
    function Harness() {
      const t = useThread(ID, { direct: true });
      return <ThreadBody t={t} dm />;
    }
    render(
      <ModalProvider>
        <Harness />
      </ModalProvider>,
    );
    await screen.findByText("No messages yet. Say hello.");
    let open = () => {};
    s.store.gate = new Promise<void>((r) => (open = r));
    await push("community.receipt");
    expect(screen.getByText("No messages yet. Say hello.")).toBeTruthy();
    await act(async () => open());
    expect(screen.getByText("No messages yet. Say hello.")).toBeTruthy();
  });

  it("makes one more read for pushes that come while a read is out, not one each", async () => {
    const s = server([message(1, true)]);
    const { result } = renderHook(() => useThread(ID, { direct: true }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const reads = s.count(READ);
    let open = () => {};
    s.store.gate = new Promise<void>((r) => (open = r));
    for (let i = 0; i < 5; i += 1) await push("community.receipt");
    s.store.gate = null;
    await act(async () => open());
    await waitFor(() => expect(s.count(READ)).toBe(reads + 2));
  });

  it("opens with the pages that reach the first unread, and marks it", async () => {
    // 70 messages, alternating: the 30 newest from the other person are unread.
    const all = Array.from({ length: 70 }, (_, i) => message(i + 1, i % 2 === 0));
    const s = server(all);
    const { result } = renderHook(() => useThread(ID, { direct: true, unread: 30 }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(s.count(READ)).toBe(3);
    expect(result.current.msgs).toHaveLength(70);
    const theirs = all.filter((m) => !m.mine);
    expect(result.current.firstUnread).toEqual({ id: theirs[theirs.length - 30]!.community_message_id, count: 30 });
    expect(result.current.hasOlder).toBe(false);
  });

  it("reads one page when nothing is unread, and older pages lay in above, each message once", async () => {
    const s = server(Array.from({ length: 60 }, (_, i) => message(i + 1, false)));
    const { result } = renderHook(() => useThread(ID, { direct: true }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.msgs).toHaveLength(25);
    expect(result.current.hasOlder).toBe(true);

    // Two new messages arrive first: the next page back now repeats two already on screen.
    s.store.msgs.push(message(61, false), message(62, false));
    await act(() => result.current.older());
    const ids = result.current.msgs.map((m) => m.community_message_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.current.msgs[0]!.body).toBe("Message 13");
    expect(result.current.msgs[result.current.msgs.length - 1]!.body).toBe("Message 60");
    expect(result.current.hasOlder).toBe(true);
  });

  it("shows the unread line and each day's label in the thread", async () => {
    server([message(1, true), message(2, false), message(3, false)]);
    function Harness() {
      const t = useThread(ID, { direct: true, unread: 2 });
      return <ThreadBody t={t} dm />;
    }
    render(
      <ModalProvider>
        <Harness />
      </ModalProvider>,
    );
    await screen.findByText("2 Unread Messages");
    expect(screen.getAllByText(/^(Today|Yesterday|\d{2}\/\d{2}\/\d{4}|.+ \d{4})$/).length).toBeGreaterThan(0);
  });
});

describe("the composer", () => {
  it("says why a message was refused, and keeps the words to send again", async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new ApiError(422, { error: { code: "CHANNEL_CLOSED", message: "Only admins post here" } }));
    render(
      <ModalProvider>
        <Composer placeholder="Message #general" onSend={onSend} onVoice={async () => undefined} />
        <Toaster />
      </ModalProvider>,
    );
    const box = screen.getByPlaceholderText("Message #general");
    fireEvent.change(box, { target: { value: "Morning all" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Only admins post here")).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe("Morning all");
  });
});
