import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { useRealtime } from "@/api/realtime";
import { upload } from "@/api/upload";
import type { LinkPreview, Message, MessageCreate } from "@/api/types/community";
import { ActionGroup, Button, ChoiceField, cn, CountBadge, ErrorState, Field, firstLink, formatDate, FormFooter, Icon, IconButton, InlineInput, InlineTextArea, Menu, Spinner, startCaptions, TextAreaField, toast, todayIso, useConfirm, useContractForm, useIsMobile, useModal, type Captions, type MenuItem } from "@mycity/ui";
import { AlbumPost, Post } from "./Posts";
import { MessageLink, useViewer, viewerFilesOf } from "./Media";
import { ForwardTo, forwardable } from "./Forward";

/** A list row: a channel or a person. */
export function Row({ on, unread, lead, title, sub, when, count, onClick, pinned, muted }: { on: boolean; unread: boolean; lead: ReactNode; title: ReactNode; sub: string; when: string; count: number; onClick: () => void; pinned?: boolean; muted?: boolean }) {
  return (
    <button type="button" data-copy="content" onClick={onClick} aria-current={on || undefined} className={cn("flex w-full items-center gap-2.5 rounded-box px-2 py-2 text-left max-md:min-h-11", on ? "bg-muted bar-selected" : "hover:bg-muted")}>
      {lead}
      <span className="min-w-0 flex-1">
        <b className={cn("flex items-center gap-1 truncate text-sm", unread ? "font-bold" : "font-semibold")}>{title}</b>
        <span className="block truncate text-2xs text-subtle-foreground">{sub}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-0.5">
        <em className={cn("text-2xs not-italic", unread ? "font-strong text-accent-foreground" : "text-subtle-foreground")}>{when}</em>
        <span className="flex items-center gap-1 text-subtle-foreground">
          {muted && <Icon name="muted" className="size-3.5" label="Muted" />}
          {pinned && <Icon name="pinned" className="size-3.5" label="Pinned" />}
          {count > 0 && <i className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-2xs font-bold text-primary-foreground not-italic">{count}</i>}
        </span>
      </span>
    </button>
  );
}

interface Pushed {
  community_channel_id?: string;
}

/** Pages read at once when a conversation opens at its first unread (community.md §3 step 20). */
const UNREAD_PAGES = 4;

const timeOf = (m: Message) => new Date(m.sent_at).getTime();

/** Oldest first, as the screen shows them: by time, then by id, as the server breaks ties. */
function byTime(a: Message, b: Message) {
  const d = timeOf(a) - timeOf(b);
  if (d) return d;
  return a.community_message_id < b.community_message_id ? -1 : a.community_message_id > b.community_message_id ? 1 : 0;
}

/**
 * A page laid over the messages on screen: its copy of a message wins, each message shows once
 * (a page read after new messages arrived repeats some), and older pages already read stay.
 */
function merge(list: Message[], page: Message[]): Message[] {
  const ids = new Set(page.map((m) => m.community_message_id));
  return [...list.filter((m) => !ids.has(m.community_message_id)), ...page].sort(byTime);
}

/** What the server counts as unread: live messages from anyone else. */
const unreadKind = (m: Message) => !m.mine && !m.deleted;

/** Where the "N Unread Messages" line goes: walking back from the newest, the `unread`-th one from someone else. */
function firstUnreadOf(msgs: Message[], unread: number): { id: string; count: number } | null {
  if (unread <= 0 || !msgs.length) return null;
  let seen = 0;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]!;
    if (!unreadKind(m)) continue;
    seen += 1;
    if (seen === unread) return { id: m.community_message_id, count: unread };
  }
  // Further back than the pages read: above the oldest one read.
  return { id: msgs[0]!.community_message_id, count: unread };
}

/**
 * A conversation's messages (community.md §3 step 20): opened at its newest page, or with as
 * many pages as reach its first unread (`unread`, the list's count when it opened); older ones
 * 25 at a time through `older`. Search goes to the server as `q`.
 *
 * A message, an edit or a receipt pushed over the socket reads the newest page again QUIETLY
 * (`refresh`): what is on screen stays, the newest page is laid over it, and several pushes at
 * once make one more read, not one each. Only a new message in a direct conversation says
 * delivered, and only when it is from the other person and newer than the last one said: a
 * receipt is never answered, so two screens can never acknowledge each other in a loop.
 */
export function useThread(id: string | null, { direct = false, unread = 0, onActivity }: { direct?: boolean; unread?: number; onActivity?: () => void } = {}) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [q, setQ] = useState("");
  /** The first page has answered: only then may the conversation say it is empty. */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [olderState, setOlderState] = useState<"idle" | "loading" | "failed">("idle");
  const [pins, setPins] = useState<Message[]>([]);
  const [firstUnread, setFirstUnread] = useState<{ id: string; count: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Which opening the answers belong to: one for an earlier conversation or search is dropped. */
  const gen = useRef(0);
  const pages = useRef(1);
  const unreadAtOpen = useRef(unread);
  unreadAtOpen.current = unread;
  /** The newest message from the other person this screen has said delivered for. */
  const ackedAt = useRef(0);

  const fetchPage = useCallback(
    async (n: number, search: string) => {
      if (!id) return null;
      return api.call("GET /api/v1/community/channels/:id/messages", { params: { id }, query: { page: n, ...(search ? { q: search } : {}) } });
    },
    [id],
  );

  const loadPins = useCallback(async () => {
    const at = gen.current;
    if (!id) return;
    try {
      const res = await api.call("GET /api/v1/community/channels/:id/pins", { params: { id }, query: {} });
      if (gen.current === at) setPins(res.data);
    } catch {
      // The pinned bar is a convenience: it stays as it was.
    }
  }, [id]);

  const newestFromOther = (list: Message[]) => {
    for (let i = list.length - 1; i >= 0; i -= 1) if (!list[i]!.mine) return timeOf(list[i]!);
    return 0;
  };

  /* Opening a conversation, or a search: as many pages as reach the first unread, at most 4. */
  useEffect(() => {
    const at = ++gen.current;
    pages.current = 1;
    ackedAt.current = 0;
    setMsgs([]);
    setPins([]);
    setLoaded(false);
    setError(null);
    setHasOlder(false);
    setOlderState("idle");
    setFirstUnread(null);
    if (!id) return;
    const want = q ? 0 : unreadAtOpen.current;
    void loadPins();
    void (async () => {
      let list: Message[] = [];
      let n = 0;
      let more: boolean;
      try {
        do {
          n += 1;
          const res = await fetchPage(n, q);
          if (gen.current !== at || !res) return;
          list = merge(list, res.data);
          more = res.page.has_next;
        } while (more && n < UNREAD_PAGES && list.filter(unreadKind).length < want);
      } catch (e) {
        if (gen.current === at) setError(e instanceof ApiError ? e : new ApiError(0, null));
        return;
      }
      pages.current = n;
      // Opening reads the conversation, which marks it delivered too: only newer ones are said.
      ackedAt.current = Math.max(ackedAt.current, newestFromOther(list));
      // A quiet read may have landed meanwhile: lay this over it.
      setMsgs((cur) => merge(cur, list));
      setHasOlder(more);
      setFirstUnread(firstUnreadOf(list, want));
      setLoaded(true);
    })();
  }, [id, q, fetchPage, loadPins, attempt]);

  /** Reads the newest page and lays it over what is on screen; null when it failed or the conversation changed. */
  const readNewest = useCallback(async (): Promise<Message[] | null> => {
    const at = gen.current;
    try {
      const res = await fetchPage(1, q);
      if (!res || gen.current !== at) return null;
      setMsgs((list) => merge(list, res.data));
      if (pages.current === 1) setHasOlder(res.page.has_next);
      return res.data;
    } catch {
      // A quiet read that failed changes nothing on screen; the next push reads again.
      return null;
    }
  }, [fetchPage, q]);

  const running = useRef<Promise<Message[] | null> | null>(null);
  const again = useRef(false);
  /** The newest page again, quietly; asked while one is out, it reads once more after it, not once per ask. */
  const refresh = useCallback((): Promise<Message[] | null> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    let run: Promise<Message[] | null> | null = null;
    run = (async () => {
      let fresh: Message[] | null;
      try {
        do {
          again.current = false;
          fresh = await readNewest();
        } while (again.current);
      } finally {
        if (running.current === run) running.current = null;
      }
      return fresh;
    })();
    running.current = run;
    return run;
  }, [readNewest]);
  useEffect(() => {
    running.current = null;
    again.current = false;
  }, [id, q]);

  /* A new message from the other person reached this device: the sender's second tick. */
  const acknowledge = useCallback(
    (fresh: Message[] | null) => {
      if (!id || !direct || !fresh) return;
      const newest = newestFromOther(fresh);
      if (newest <= ackedAt.current) return;
      ackedAt.current = newest;
      void api.call("POST /api/v1/community/channels/:id/delivered", { params: { id }, body: { up_to: new Date().toISOString() } }).catch(() => undefined);
    },
    [id, direct],
  );

  const here = useCallback((p: unknown) => Boolean(id) && (p as Pushed | null)?.community_channel_id === id, [id]);
  const onMessage = useCallback(
    (p: unknown) => {
      if (here(p)) {
        void refresh().then(acknowledge);
        void loadPins();
      }
      onActivity?.();
    },
    [here, refresh, acknowledge, loadPins, onActivity],
  );
  const onUpdated = useCallback(
    (p: unknown) => {
      if (here(p)) {
        void refresh();
        void loadPins();
      }
      onActivity?.();
    },
    [here, refresh, loadPins, onActivity],
  );
  /* A receipt changes ticks and counts only: read again, never answered. */
  const onReceipt = useCallback(
    (p: unknown) => {
      if (here(p)) void refresh();
      onActivity?.();
    },
    [here, refresh, onActivity],
  );
  useRealtime("community.message", onMessage);
  useRealtime("community.message_updated", onUpdated);
  useRealtime("community.receipt", onReceipt);

  const olderBusy = useRef(false);
  /** The next 25 back, laid in above what is on screen; a page that fails offers Load Older. */
  const older = useCallback(async () => {
    if (!id || olderBusy.current || !hasOlder) return;
    const at = gen.current;
    olderBusy.current = true;
    setOlderState("loading");
    try {
      const res = await fetchPage(pages.current + 1, q);
      if (!res || gen.current !== at) return;
      pages.current += 1;
      setMsgs((list) => merge(list, res.data));
      setHasOlder(res.page.has_next);
      setOlderState("idle");
    } catch {
      if (gen.current === at) setOlderState("failed");
    } finally {
      olderBusy.current = false;
    }
  }, [id, hasOlder, fetchPage, q]);

  /** After a pin, an unpin or a delete: the newest page and the pinned bar again. */
  const reload = useCallback(async () => {
    await Promise.all([refresh(), loadPins()]);
  }, [refresh, loadPins]);

  /** A sent message shows from the server's answer at once; the newest page is read again behind it. */
  const arrived = (m: Message) => setMsgs((list) => merge(list, [m]));

  const send = async (body: MessageCreate) => {
    if (!id) return;
    arrived(await api.call("POST /api/v1/community/channels/:id/messages", { params: { id }, body, idempotencyKey: crypto.randomUUID() }));
    // Answering is reading: the unread line has done its work.
    setFirstUnread(null);
    void refresh();
  };

  /** Files sent together (Send Files): posted one at a time, in order, then read back once. */
  const sendMany = async (bodies: MessageCreate[]) => {
    if (!id) return;
    for (const body of bodies) arrived(await api.call("POST /api/v1/community/channels/:id/messages", { params: { id }, body, idempotencyKey: crypto.randomUUID() }));
    setFirstUnread(null);
    void refresh();
  };

  /**
   * A file or a voice note: uploaded to the conversation first, then posted. A voice note carries
   * the captions the browser wrote while it was recorded, the transcript's last resort.
   */
  const sendFile = async (file: File, durationS?: number, captions?: string) => {
    if (!id) return;
    const doc = await upload({ endpoint: `/api/v1/community/channels/${id}/media`, file, fields: { purpose: durationS ? "voice_note" : "attachment" } });
    await send(
      durationS
        ? { message_type: "audio", document_id: doc.document_id, duration_s: durationS, ...(captions ? { captions } : {}) }
        : { message_type: "file", document_id: doc.document_id },
    );
  };

  const replace = (m: Message) => setMsgs((list) => list.map((x) => (x.community_message_id === m.community_message_id ? m : x)));
  const retry = () => setAttempt((n) => n + 1);

  /** Messages picked to forward together (§3 step 19); null when not picking. A new conversation starts afresh. */
  const [picking, setPicking] = useState<string[] | null>(null);
  useEffect(() => setPicking(null), [id]);
  return { id, msgs, q, setQ, loaded, error, retry, hasOlder, olderState, older, firstUnread, send, sendMany, sendFile, reload, replace, pins, picking, setPicking };
}

/** Edit Message: the author's text, within 15 minutes of sending it. */
function EditMessage({ m, close, done }: { m: Message; close: () => void; done: (m: Message) => void }) {
  const f = useContractForm({ body: m.body ?? "" }, { body: (v) => (v.trim() ? null : "Write something") });
  const save = async () => {
    if (!f.check()) return;
    try {
      done(await api.call("PUT /api/v1/community/messages/:id", { params: { id: m.community_message_id }, body: { body: f.values.body.trim() } }));
      close();
    } catch (e) {
      if (e instanceof ApiError) f.setServerErrors(e.fields.body ? { body: e.fields.body } : { body: [e.message] });
    }
  };
  return (
    <>
      <Field label="Message" {...f.field("body")}><TextAreaField {...f.field("body")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={() => save()}>Save Changes</Button>
      </FormFooter>
    </>
  );
}

/** Pin Message: how long it stays at the top of the conversation. */
function PinMessage({ m, close, done }: { m: Message; close: () => void; done: () => Promise<void> }) {
  const [period, setPeriod] = useState<"24h" | "7d" | "30d">("7d");
  const pin = async () => {
    try {
      await api.call("PUT /api/v1/community/messages/:id/pin", { params: { id: m.community_message_id }, body: { period } });
      close();
      await done();
      toast("Message pinned");
    } catch (e) {
      if (e instanceof ApiError) toast(e.message);
      else throw e;
    }
  };
  return (
    <>
      <Field label="Pin For">
        <ChoiceField value={period} onChange={setPeriod} options={[["24h", "24 Hours"], ["7d", "7 Days"], ["30d", "30 Days"]]} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="pinned" onClick={pin}>Pin Message</Button>
      </FormFooter>
    </>
  );
}

/** One line for a pinned message: its text, or what kind of thing it is. */
function pinLine(m: Message): string {
  const kind: Partial<Record<Message["message_type"], string>> = { image: "Photo", video: "Video", file: "File", audio: "Voice note", poll: "Poll", recognition: "Recognition", birthday: "Birthday", anniversary: "Work anniversary" };
  if (m.message_type === "announcement") return m.announcement?.title ?? "Announcement";
  const k = kind[m.message_type];
  if (k) return m.body ? `${k}: ${m.body}` : k;
  return m.body ?? "";
}

/**
 * What is pinned in a conversation, above its messages: the newest first, a tap steps to the
 * next and brings the message into view when it is on the page; Unpin for those who may.
 */
export function PinnedBar({ t }: { t: ReturnType<typeof useThread> }) {
  const [at, setAt] = useState(0);
  const pins = t.pins;
  if (!pins.length) return null;
  const n = at % pins.length;
  const m = pins[n]!;
  const show = () => {
    document.querySelector(`[data-message="${m.community_message_id}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setAt(n + 1);
  };
  const unpin = async () => {
    await api.call("DELETE /api/v1/community/messages/:id/pin", { params: { id: m.community_message_id } });
    await t.reload();
    toast("Message unpinned");
  };
  return (
    <div className="flex flex-none items-center gap-2 border-b border-border bg-muted py-1.5 pr-2 pl-4 max-md:pl-3">
      <Icon name="pinned" className="size-3.5 flex-none text-subtle-foreground" />
      <button type="button" onClick={show} aria-label={`Pinned message ${n + 1} of ${pins.length}`} className="min-w-0 flex-1 text-left phone:min-h-tap">
        <span className="block truncate text-xs">{pinLine(m)}</span>
      </button>
      {pins.length > 1 && <span className="flex-none text-2xs text-subtle-foreground tabular-nums">{n + 1} of {pins.length}</span>}
      {m.can_pin && <IconButton icon="x" label="Unpin message" size="sm" onClick={unpin} />}
    </div>
  );
}

/** Forward To over messages of this conversation (§3 step 19); picking ends once they are sent. */
export function useForward(t: ReturnType<typeof useThread>) {
  const modal = useModal();
  return (ids: string[]) =>
    modal.open({ title: "Forward To", body: (close) => <ForwardTo source={{ message_ids: ids }} close={close} done={() => t.setPicking(null)} /> });
}

/** In place of the composer while picking (§3 step 19): how many, Copy for texts, Forward. */
export function PickBar({ t }: { t: ReturnType<typeof useThread> }) {
  const forward = useForward(t);
  const ids = t.picking ?? [];
  const picked = t.msgs.filter((m) => ids.includes(m.community_message_id));
  const texts = picked.length > 0 && picked.every((m) => m.message_type === "text" && m.body);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(picked.map((m) => m.body).join("\n\n"));
    } catch {
      // The browser refused the clipboard: say so, and keep the messages picked to try again.
      toast("Copy did not work. Try again.");
      return;
    }
    toast("Copied");
    t.setPicking(null);
  };
  return (
    <div className="flex flex-none items-center gap-2 border-t border-border bg-card px-3 py-2.5 max-md:px-2 max-md:pb-safe-2">
      <ActionGroup>
        <IconButton icon="x" label="Cancel" onClick={() => t.setPicking(null)} />
        <span aria-live="polite" className="flex-1 text-sm font-semibold">
          {ids.length} Selected
        </span>
        {texts && <IconButton icon="copy" label="Copy" onClick={copy} />}
        <Button variant="primary" icon="forward" onClick={() => forward(ids)}>
          Forward
        </Button>
      </ActionGroup>
    </div>
  );
}

/** How long a press lasts before it picks a message on a phone, and how far it may wander. */
const HOLD_MS = 450;
const HOLD_SLOP_PX = 10;

/**
 * The click some phones send when the finger lifts after a long press opens nothing and ticks
 * nothing. Phones that send none leave nothing waiting: the next tap is the person's own.
 */
function ignoreLiftClick() {
  const off = new AbortController();
  const opts = { capture: true, signal: off.signal };
  window.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      off.abort();
    },
    opts,
  );
  const lifted = () => setTimeout(() => off.abort(), 400);
  window.addEventListener("pointerup", lifted, opts);
  window.addEventListener("pointercancel", lifted, opts);
}

/** A thread's rows: one message, or four or more photos and videos sent together (an album, §6). */
type ThreadRow = { key: string; ms: Message[] };
const inAlbum = (m: Message) => Boolean(m.album_key) && !m.deleted && (m.message_type === "image" || m.message_type === "video");

function rowsOf(msgs: Message[]): ThreadRow[] {
  const out: ThreadRow[] = [];
  for (let i = 0; i < msgs.length; ) {
    const m = msgs[i]!;
    let j = i + 1;
    if (inAlbum(m)) while (j < msgs.length && inAlbum(msgs[j]!) && msgs[j]!.album_key === m.album_key) j += 1;
    if (j - i >= 4) {
      out.push({ key: m.community_message_id, ms: msgs.slice(i, j) });
      i = j;
    } else {
      out.push({ key: m.community_message_id, ms: [m] });
      i += 1;
    }
  }
  return out;
}

/** How close to the bottom still counts as at the bottom, and how far up the arrow shows. */
const NEAR_BOTTOM_PX = 80;
const ARROW_AFTER_PX = 240;
/** How far ahead of the top older messages start loading, so scrolling rarely waits. */
const OLDER_AHEAD_PX = 400;
/** Room above the unread line on opening, so the day's label held at the top does not cover it. */
const UNDER_LABEL_PX = 44;

/**
 * The open conversation (community.md §3 step 20): each day's messages under its label, which
 * stays at the top while they scroll; older pages load as the top comes near and what is on
 * screen keeps its place; a new message follows the person down only when they are at the
 * bottom or sent it, otherwise the Newest Messages arrow counts it.
 */
export function ThreadBody({ t, dm, editPoll }: { t: ReturnType<typeof useThread>; dm?: boolean; editPoll?: (m: Message) => void }) {
  const modal = useModal();
  const confirm = useConfirm();
  const box = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [away, setAway] = useState(false);
  /** New messages that arrived while the person read older ones. */
  const [fresh, setFresh] = useState(0);
  const toBottom = () => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setAway(false);
    setFresh(0);
  };
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = gap < NEAR_BOTTOM_PX;
    setAway(gap > ARROW_AFTER_PX);
    if (atBottom.current) setFresh(0);
  };

  /* Opened: at the first unread, under its line, else at the newest. */
  const { loaded, firstUnread, id: openId, q } = t;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !loaded) return;
    setFresh(0);
    const line = firstUnread ? el.querySelector<HTMLElement>("[data-unread-line]") : null;
    if (line) el.scrollTop += line.getBoundingClientRect().top - el.getBoundingClientRect().top - UNDER_LABEL_PX;
    else if (!q) el.scrollTop = el.scrollHeight;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = gap < NEAR_BOTTOM_PX;
    setAway(gap > ARROW_AFTER_PX);
  }, [openId, q, loaded, firstUnread]);

  /* A newer message: follow it at the bottom or when it is one's own, else count it on the arrow. */
  const lastMsg = t.msgs[t.msgs.length - 1];
  const last = lastMsg?.community_message_id;
  const seenLast = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const before = seenLast.current;
    seenLast.current = last;
    const el = box.current;
    if (!el || !last || !loaded || q || before === undefined || before === last) return;
    if (atBottom.current || lastMsg?.mine) {
      el.scrollTop = el.scrollHeight;
      setFresh(0);
      return;
    }
    const i = t.msgs.findIndex((m) => m.community_message_id === before);
    setFresh((n) => n + (i < 0 ? 1 : t.msgs.length - 1 - i));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the newest message changes, reading the list as it is then
  }, [last]);

  /* Older messages laid in above: the first one on screen stays where it was. */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const keepPlace = () => {
    const el = box.current;
    const node = el?.querySelector<HTMLElement>("[data-message]");
    anchor.current = node ? { id: node.dataset.message ?? "", top: node.getBoundingClientRect().top } : null;
  };
  const oldest = t.msgs[0]?.community_message_id;
  useLayoutEffect(() => {
    const el = box.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    const node = el.querySelector<HTMLElement>(`[data-message="${a.id}"]`);
    if (node) el.scrollTop += node.getBoundingClientRect().top - a.top;
  }, [oldest]);

  /* The top coming near loads the next page back; without an observer, Load Older does. */
  const watching = typeof IntersectionObserver !== "undefined";
  const canOlder = loaded && t.hasOlder && t.olderState === "idle";
  const { older } = t;
  useEffect(() => {
    const el = box.current;
    const mark = top.current;
    if (!el || !mark || !canOlder || !watching) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        keepPlace();
        void older();
      },
      { root: el, rootMargin: `${OLDER_AHEAD_PX}px 0px 0px 0px` },
    );
    io.observe(mark);
    return () => io.disconnect();
  }, [canOlder, watching, older, oldest]);
  const olderByHand = async () => {
    keepPlace();
    await t.older();
  };

  const today = todayIso();
  const yesterday = todayIso(new Date(Date.now() - 86400000));
  const rows = useMemo(() => rowsOf(t.msgs), [t.msgs]);
  const days = useMemo(() => {
    const out: { day: string; rows: ThreadRow[] }[] = [];
    for (const r of rows) {
      const day = todayIso(new Date(r.ms[0]!.sent_at));
      const cur = out[out.length - 1];
      if (cur && cur.day === day) cur.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [rows]);
  const files = useMemo(() => viewerFilesOf(t.msgs), [t.msgs]);
  const forward = useForward(t);
  const { open: view, viewer } = useViewer(files, (key) => forward([key]));
  const phone = useIsMobile();
  const { picking, setPicking } = t;
  const toggle = (ids: string[]) =>
    setPicking((p) => {
      if (!p) return p;
      const on = ids.every((id) => p.includes(id));
      const next = on ? p.filter((id) => !ids.includes(id)) : [...p, ...ids.filter((id) => !p.includes(id))];
      // Unticking the last one ends picking, as on WhatsApp.
      return next.length ? next : null;
    });
  /* A long press on a phone starts picking. */
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const letGo = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const pressFor = (ids: string[], canPick: boolean) =>
    !phone || !canPick
      ? {}
      : {
          // The phone's own long-press menu never opens on a message, picking or not.
          onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
          ...(picking
            ? {}
            : {
                onPointerDown: (e: ReactPointerEvent) => {
                  letGo();
                  const timer = setTimeout(() => {
                    hold.current = null;
                    ignoreLiftClick();
                    setPicking(ids);
                  }, HOLD_MS);
                  hold.current = { timer, x: e.clientX, y: e.clientY };
                },
                onPointerMove: (e: ReactPointerEvent) => {
                  const h = hold.current;
                  if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP_PX) letGo();
                },
                onPointerUp: letGo,
                onPointerCancel: letGo,
              }),
        };
  const react = async (m: Message) => t.replace(await api.call("POST /api/v1/community/messages/:id/reactions", { params: { id: m.community_message_id }, body: {} }));
  const vote = async (m: Message, i: number) => t.replace(await api.call("POST /api/v1/community/messages/:id/vote", { params: { id: m.community_message_id }, body: { option_index: i } }));
  const failed = (e: unknown) => {
    if (e instanceof ApiError) toast(e.message);
    else throw e;
  };
  const remove = async (m: Message) => {
    if (!(await confirm({ title: "Delete Message", body: "It is removed for everyone in this conversation.", confirmLabel: "Delete Message", cancelLabel: "Keep It", destructive: true }))) return;
    try {
      await api.call("DELETE /api/v1/community/messages/:id", { params: { id: m.community_message_id } });
      await t.reload();
      toast("Message deleted");
    } catch (e) {
      failed(e);
    }
  };
  const closePoll = async (m: Message) => {
    if (!(await confirm({ title: "Close Poll", body: "No more votes are taken. The result stays.", confirmLabel: "Close Poll", cancelLabel: "Keep Open" }))) return;
    try {
      t.replace(await api.call("POST /api/v1/community/messages/:id/close", { params: { id: m.community_message_id }, body: {} }));
    } catch (e) {
      failed(e);
    }
  };
  const unpin = async (m: Message) => {
    try {
      t.replace(await api.call("DELETE /api/v1/community/messages/:id/pin", { params: { id: m.community_message_id } }));
      await t.reload();
      toast("Message unpinned");
    } catch (e) {
      failed(e);
    }
  };
  /** An album is deleted whole, asked once, when the caller may delete every photo in it. */
  const removeAll = async (ms: Message[]) => {
    if (!(await confirm({ title: "Delete Photos", body: `All ${ms.length} are removed for everyone in this conversation.`, confirmLabel: "Delete Photos", cancelLabel: "Keep Them", destructive: true }))) return;
    try {
      for (const m of ms) await api.call("DELETE /api/v1/community/messages/:id", { params: { id: m.community_message_id } });
      await t.reload();
      toast("Photos deleted");
    } catch (e) {
      failed(e);
    }
  };
  const albumMenu = (ms: Message[]) => {
    const ids = ms.map((m) => m.community_message_id);
    const items: MenuItem[] = [];
    if (ms.every(forwardable)) {
      items.push({ label: "Forward", icon: "forward", onSelect: () => forward(ids) });
      items.push({ label: "Select", icon: "tick", onSelect: () => setPicking(ids) });
    }
    if (ms.every((m) => m.can_delete)) items.push({ label: "Delete", icon: "trash", danger: true, onSelect: () => void removeAll(ms) });
    if (!items.length) return undefined;
    return (
      <span className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <Menu label="Album actions" trigger={(p) => <IconButton {...p} icon="dots" label="Album actions" size="sm" />} items={items} />
      </span>
    );
  };

  /** Only what the caller may do with this message; nothing when there is nothing. */
  const menuOf = (m: Message) => {
    const items: MenuItem[] = [];
    if (forwardable(m)) {
      items.push({ label: "Forward", icon: "forward", onSelect: () => forward([m.community_message_id]) });
      items.push({ label: "Select", icon: "tick", onSelect: () => setPicking([m.community_message_id]) });
    }
    if (m.can_edit && m.message_type === "text") items.push({ label: "Edit", icon: "edit", onSelect: () => modal.open({ title: "Edit Message", body: (close) => <EditMessage m={m} close={close} done={t.replace} /> }) });
    if (m.can_edit && m.message_type === "poll" && editPoll) items.push({ label: "Edit", icon: "edit", onSelect: () => editPoll(m) });
    if (m.can_close) items.push({ label: "Close Poll", icon: "lock", onSelect: () => void closePoll(m) });
    if (m.can_pin && !m.pinned_until) items.push({ label: "Pin Message", icon: "pinned", onSelect: () => modal.open({ title: "Pin Message", body: (close) => <PinMessage m={m} close={close} done={t.reload} /> }) });
    if (m.can_pin && m.pinned_until) items.push({ label: "Unpin", icon: "pinned", onSelect: () => void unpin(m) });
    if (m.can_delete) items.push({ label: "Delete", icon: "trash", danger: true, onSelect: () => void remove(m) });
    if (!items.length) return undefined;
    return (
      <span className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <Menu label="Message actions" trigger={(p) => <IconButton {...p} icon="dots" label="Message actions" size="sm" />} items={items} />
      </span>
    );
  };
  const row = ({ key, ms }: ThreadRow) => {
    const m = ms[0]!;
    const ids = ms.map((x) => x.community_message_id);
    const canPick = ms.every(forwardable);
    const on = Boolean(picking && ids.every((id) => picking.includes(id)));
    const unreadHere = firstUnread && ms.some((x) => x.community_message_id === firstUnread.id);
    return (
      <div key={key} data-message={m.community_message_id} className="flex flex-col gap-3">
        {unreadHere && (
          <p data-unread-line className="self-stretch rounded-full bg-muted py-1 text-center text-2xs font-semibold text-subtle-foreground">
            {firstUnread.count === 1 ? "1 Unread Message" : `${firstUnread.count} Unread Messages`}
          </p>
        )}
        <div
          className={cn("group flex items-start gap-2", picking && canPick && "cursor-pointer", phone && "no-callout select-none")}
          onClickCapture={(e) => {
            if (picking && canPick) {
              e.preventDefault();
              e.stopPropagation();
              toggle(ids);
            }
          }}
          {...pressFor(ids, canPick)}
        >
          {picking && (
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={ms.length > 1 ? "Select photos" : "Select message"}
              className={cn("mt-1 flex size-5.5 flex-none items-center justify-center max-md:mt-0 max-md:size-tap", !canPick && "invisible")}
            >
              <span className={cn("flex size-5.5 items-center justify-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                {on && <Icon name="tick" className="size-3.5" />}
              </span>
            </button>
          )}
          <div className={cn("flex min-w-0 flex-1 flex-col", m.mine && m.message_type !== "announcement" && "items-end")}>
            {ms.length > 1 ? (
              <AlbumPost ms={ms} q={t.q} dm={dm} onView={view} menu={picking ? undefined : albumMenu(ms)} />
            ) : (
              <Post m={m} q={t.q} dm={dm} onCelebrate={() => void react(m)} onVote={(i) => void vote(m, i)} onView={view} menu={picking ? undefined : menuOf(m)} />
            )}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={box} onScroll={onScroll} data-thread data-copy="content" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 [&>*]:flex-shrink-0">
        <div ref={top} aria-hidden="true" />
        {t.olderState === "loading" && <Spinner className="self-center" label="Loading older messages" />}
        {loaded && t.hasOlder && (t.olderState === "failed" || (!watching && t.olderState === "idle")) && (
          <Button className="self-center" size="sm" onClick={olderByHand}>
            Load Older
          </Button>
        )}
        {days.map(({ day, rows: dayRows }) => (
          <div key={day} className="flex flex-col gap-3">
            <span className="sticky top-2 z-10 self-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-2xs text-subtle-foreground">
              {day === today ? "Today" : day === yesterday ? "Yesterday" : formatDate(day)}
            </span>
            {dayRows.map(row)}
          </div>
        ))}
        {t.error && !t.msgs.length && <ErrorState error={t.error} onRetry={t.retry} />}
        {loaded && !t.msgs.length && <p className="m-auto text-xs text-subtle-foreground">{t.q ? "Nothing matches here." : "No messages yet. Say hello."}</p>}
        {viewer}
      </div>
      {(away || fresh > 0) && (
        <div className="absolute right-3 bottom-3">
          <IconButton icon="down" label="Newest Messages" onClick={toBottom} className="rounded-full border border-border bg-card shadow-2" />
          {fresh > 0 && <CountBadge count={fresh} max={99} label="new messages" className="pointer-events-none absolute -top-1.5 -right-1.5" />}
        </div>
      )}
    </div>
  );
}

/**
 * Search in a conversation (§3 step 9): the server returns the matches, they are
 * highlighted in place, and Enter or the arrows step between them with a count.
 */
export function ThreadSearch({ t, onClose }: { t: ReturnType<typeof useThread>; onClose: () => void }) {
  const [v, setV] = useState(t.q);
  const [at, setAt] = useState(0);
  const [hits, setHits] = useState(0);
  const { setQ, msgs } = t;
  useEffect(() => {
    const x = setTimeout(() => setQ(v.trim()), 250);
    return () => clearTimeout(x);
  }, [v, setQ]);
  const marks = () => [...document.querySelectorAll<HTMLElement>("[data-thread] mark.hit")];
  const go = useCallback((i: number) => {
    const list = marks();
    setHits(list.length);
    if (!list.length) return;
    const n = ((i % list.length) + list.length) % list.length;
    list.forEach((el, j) => el.classList.toggle("cur", j === n));
    list[n].scrollIntoView?.({ block: "center" });
    setAt(n);
  }, []);
  /* New matches: start from the newest one. */
  useEffect(() => {
    const list = marks();
    if (list.length) go(list.length - 1);
    else setHits(0);
  }, [msgs, go]);
  const close = () => {
    setQ("");
    onClose();
  };
  return (
    <div role="search" className="flex flex-none items-center gap-1.5 border-b border-border bg-muted px-3 py-2">
      <InlineInput
        autoFocus
        className="h-8 min-w-0 flex-1 rounded-full border border-input bg-background px-3 outline-none focus:border-ring"
        placeholder="Search messages"
        aria-label="Search in this conversation"
        value={v}
        onChange={setV}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(e.shiftKey ? at - 1 : at + 1);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      />
      <span className="min-w-13 text-center text-2xs text-subtle-foreground" aria-live="polite">{t.q ? (hits ? `${at + 1} of ${hits}` : "No match") : ""}</span>
      <IconButton icon="up" label="Previous match" size="sm" disabled={!hits} onClick={() => go(at - 1)} />
      <IconButton icon="down" label="Next match" size="sm" disabled={!hits} onClick={() => go(at + 1)} />
      <IconButton icon="x" label="Close search" size="sm" onClick={close} />
    </div>
  );
}

/** Pick a recording type the browser can make. */
function recordingType(): string | undefined {
  const MR = typeof window !== "undefined" ? window.MediaRecorder : undefined;
  if (!MR) return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"].find((m) => MR.isTypeSupported?.(m));
}

/** Longest voice note (community.md §13, proposed 5 minutes). */
const MAX_VOICE_S = 300;

/**
 * The composer's link card (§3 step 18): the card of the first link in what is being
 * written, asked of the server once the typing settles and kept for the session, so
 * the message gets the same card. Remove Preview keeps it off this message only.
 */
function useComposerLink(text: string) {
  const url = useMemo(() => firstLink(text), [text]);
  const [known, setKnown] = useState<Record<string, LinkPreview | null>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const out = useRef(new Set<string>());
  useEffect(() => {
    if (!url || url === removed || url in known || out.current.has(url)) return;
    const x = setTimeout(() => {
      out.current.add(url);
      setAsking(url);
      const keep = (preview: LinkPreview | null) => setKnown((k) => ({ ...k, [url]: preview }));
      api
        .call("POST /api/v1/community/link-previews", { body: { url } })
        .then((res) => keep(res.preview), () => keep(null))
        .finally(() => {
          out.current.delete(url);
          setAsking((a) => (a === url ? null : a));
        });
    }, 600);
    return () => clearTimeout(x);
  }, [url, removed, known]);
  const on = url !== null && url !== removed;
  return {
    loading: on && asking === url ? url : null,
    preview: on ? (known[url] ?? null) : null,
    remove: () => setRemoved(url),
    /** Whether the message about to be sent leaves its card off. */
    removedFrom: (body: string) => removed !== null && firstLink(body) === removed,
    reset: () => setRemoved(null),
  };
}

/** The composer for a channel or a conversation, with voice notes in both. */
export function Composer({ placeholder, onSend, onVoice, plus, readOnly }: { placeholder: string; onSend: (b: MessageCreate) => Promise<void>; onVoice: (file: File, seconds: number, captions: string) => Promise<void>; plus?: (cls: string) => ReactNode; readOnly?: string }) {
  const [text, setText] = useState("");
  const phone = useIsMobile();
  const box = useRef<HTMLTextAreaElement>(null);
  const link = useComposerLink(text);
  /* Ctrl+Enter (Cmd+Enter on a Mac) starts a new line too; a textarea only does that for Shift+Enter by itself. */
  const newLine = () => {
    const el = box.current;
    if (!el) return;
    const at = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? at;
    setText(text.slice(0, at) + "\n" + text.slice(end));
    requestAnimationFrame(() => el.setSelectionRange(at + 1, at + 1));
  };
  const [rec, setRec] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  /** What the browser hears while recording, where it can (decision 8 of the integrations guide). */
  const captions = useRef<Captions | null>(null);
  const keep = useRef(false);

  useEffect(() => {
    if (rec == null) return;
    const i = setInterval(() => setRec((s) => (s == null ? s : s + 1)), 1000);
    return () => clearInterval(i);
  }, [rec]);
  useEffect(
    () => () => {
      captions.current?.stop();
      stream.current?.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const body = text.trim();
      await onSend({ message_type: "text", body, ...(link.removedFrom(body) ? { no_link_preview: true } : {}) });
      setText("");
      link.reset();
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const type = recordingType();
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      /* No recorder (an old browser, or the laptop mock in a test): a stand-in note. */
      if (import.meta.env.VITE_API_MODE === "mock") return setRec(0);
      return toast("This browser cannot record audio");
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return toast("Allow the microphone to record");
    }
    chunks.current = [];
    const r = new MediaRecorder(stream.current, { mimeType: type });
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    recorder.current = r;
    r.start();
    captions.current = startCaptions();
    setRec(0);
  };

  const stop = async (sendIt: boolean) => {
    const seconds = Math.max(1, Math.min(MAX_VOICE_S, rec ?? 1));
    setRec(null);
    keep.current = sendIt;
    const r = recorder.current;
    recorder.current = null;
    const done = r
      ? new Promise<Blob>((resolve) => {
          r.onstop = () => resolve(new Blob(chunks.current, { type: r.mimeType }));
          r.stop();
        })
      : Promise.resolve(new Blob([new Uint8Array(64)], { type: "audio/webm" }));
    const blob = await done;
    const heard = captions.current?.stop() ?? "";
    captions.current = null;
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    if (!keep.current) return;
    setBusy(true);
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      await onVoice(new File([blob], `voice-note.${ext}`, { type: blob.type || "audio/webm" }), seconds, heard);
    } catch {
      toast("Could not send the voice note");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (rec != null && rec >= MAX_VOICE_S) void stop(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop reads the latest recording when the cap is reached
  }, [rec]);

  const base = "flex flex-none items-end gap-2 border-t border-border bg-card px-3 py-2.5 max-md:px-2 max-md:pb-safe-2";
  const cbtn = "flex size-10 flex-none items-center justify-center rounded-full border border-input bg-background text-muted-foreground hover:bg-muted";
  if (readOnly) return <div className={base}><span className="flex flex-1 items-center gap-2 text-xs text-subtle-foreground"><Icon name="lock" />{readOnly}</span></div>;
  if (rec != null)
    return (
      <div className={base}>
        <button type="button" className={cbtn} aria-label="Cancel recording" onClick={() => void stop(false)}><Icon name="x" /></button>
        <span className="flex h-10 flex-1 items-center gap-2 rounded-full bg-destructive-soft px-3.5 text-sm font-semibold text-destructive">
          <i className="size-2 animate-pulse-dot rounded-full bg-destructive" />Recording {Math.floor(rec / 60)}:{String(rec % 60).padStart(2, "0")}
        </span>
        <button type="button" className={cn(cbtn, "on-primary border-primary bg-primary text-primary-foreground")} aria-label="Send voice note" onClick={() => void stop(true)}>
          <Icon name="send" />
        </button>
      </div>
    );
  return (
    <div className={cn(base, "flex-col items-stretch")}>
      {link.loading ? <MessageLink link={null} loading={{ url: link.loading }} onRemove={link.remove} /> : link.preview && <MessageLink link={link.preview} onRemove={link.remove} />}
      <div className="flex items-end gap-2">
      {plus?.(cbtn)}
      {/* Desktop: Enter sends; Shift+Enter or Ctrl+Enter starts a new line. A phone keeps Enter for a new line and sends with Send, as WhatsApp does. */}
      <InlineTextArea
        ref={box}
        className="min-h-10 min-w-0 flex-1 resize-none rounded-card border border-input bg-muted px-3.5 py-2 leading-normal outline-none focus:border-ring"
        placeholder={placeholder}
        aria-label="Message"
        autoComplete="off"
        value={text}
        onChange={setText}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || phone) return;
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) newLine();
          else void send();
        }}
      />
      {!text && <button type="button" className={cbtn} aria-label="Record a voice note" disabled={busy} onClick={() => void start()}><Icon name="mic" /></button>}
      <button type="button" disabled={busy} className={cn(cbtn, "on-primary border-primary bg-primary text-primary-foreground hover:bg-primary")} aria-label="Send" onClick={() => void send()}>
        <Icon name="send" />
      </button>
      </div>
    </div>
  );
}
