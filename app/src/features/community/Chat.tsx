import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { useRealtime } from "@/api/realtime";
import { upload } from "@/api/upload";
import type { LinkPreview, Message, MessageCreate } from "@/api/types/community";
import type { PageMeta } from "@/api/types/common";
import { Button, cn, Field, firstLink, formatDate, FormFooter, Icon, IconButton, InlineInput, InlineTextArea, Menu, TextAreaField, toast, todayIso, useConfirm, useContractForm, useIsMobile, useModal, type MenuItem } from "@mycity/ui";
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

/**
 * A conversation's messages: newest page first, "Load Older" reaches back a page at a
 * time (community.md §5). Search goes to the server as `q`. A new message, a reaction or
 * a receipt pushed over the socket reloads the open conversation; the list beside it
 * reloads through `onActivity`.
 */
export function useThread(id: string | null, { direct = false, onActivity }: { direct?: boolean; onActivity?: () => void } = {}) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [page, setPage] = useState<PageMeta | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const pageNo = useRef(1);

  const fetchPage = useCallback(
    async (n: number, search: string) => {
      if (!id) return null;
      return api.call("GET /api/v1/community/channels/:id/messages", { params: { id }, query: { page: n, ...(search ? { q: search } : {}) } });
    },
    [id],
  );

  /* Receiving a direct message is what makes its sender's second tick. */
  const acknowledge = useCallback(() => {
    if (id && direct) void api.call("POST /api/v1/community/channels/:id/delivered", { params: { id }, body: { up_to: new Date().toISOString() } }).catch(() => undefined);
  }, [id, direct]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchPage(1, q);
      pageNo.current = 1;
      if (res) {
        setMsgs(res.data);
        setPage(res.page);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchPage, q]);

  useEffect(() => {
    setMsgs([]);
    void reload();
  }, [reload]);

  const live = useCallback(
    (p: unknown) => {
      const at = (p as Pushed | null)?.community_channel_id;
      if (at && at === id) {
        void reload();
        acknowledge();
      }
      onActivity?.();
    },
    [id, reload, acknowledge, onActivity],
  );
  useRealtime("community.message", live);
  useRealtime("community.message_updated", live);
  useRealtime("community.receipt", live);

  const older = async () => {
    const res = await fetchPage(pageNo.current + 1, q);
    if (res) {
      pageNo.current += 1;
      setMsgs((m) => [...res.data, ...m]);
      setPage(res.page);
    }
  };

  const send = async (body: MessageCreate) => {
    if (!id) return;
    await api.call("POST /api/v1/community/channels/:id/messages", { params: { id }, body, idempotencyKey: crypto.randomUUID() });
    await reload();
  };

  /** Files sent together (Send Files): posted one at a time, in order, then read back once. */
  const sendMany = async (bodies: MessageCreate[]) => {
    if (!id) return;
    for (const body of bodies) await api.call("POST /api/v1/community/channels/:id/messages", { params: { id }, body, idempotencyKey: crypto.randomUUID() });
    await reload();
  };

  /** A file or a voice note: uploaded to the conversation first, then posted. */
  const sendFile = async (file: File, durationS?: number) => {
    if (!id) return;
    const doc = await upload({ endpoint: `/api/v1/community/channels/${id}/media`, file, fields: { purpose: durationS ? "voice_note" : "attachment" } });
    await send(durationS ? { message_type: "audio", document_id: doc.document_id, duration_s: durationS } : { message_type: "file", document_id: doc.document_id });
  };

  const replace = (m: Message) => setMsgs((list) => list.map((x) => (x.community_message_id === m.community_message_id ? m : x)));

  /** Messages picked to forward together (§3 step 19); null when not picking. A new conversation starts afresh. */
  const [picking, setPicking] = useState<string[] | null>(null);
  useEffect(() => setPicking(null), [id]);
  return { id, msgs, page, q, setQ, loading, older, send, sendMany, sendFile, reload, replace, picking, setPicking };
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
    await navigator.clipboard.writeText(picked.map((m) => m.body).join("\n\n"));
    toast("Copied");
    t.setPicking(null);
  };
  return (
    <div className="flex flex-none items-center gap-2 border-t border-border bg-card px-3 py-2.5 max-md:px-2 max-md:pb-safe-2">
      <IconButton icon="x" label="Cancel" onClick={() => t.setPicking(null)} />
      <span aria-live="polite" className="flex-1 text-sm font-semibold">
        {ids.length} Selected
      </span>
      {texts && <IconButton icon="copy" label="Copy" onClick={copy} />}
      <Button variant="primary" icon="forward" onClick={() => forward(ids)}>
        Forward
      </Button>
    </div>
  );
}

/** How long a press lasts before it picks a message on a phone, and how far it may wander. */
const HOLD_MS = 450;
const HOLD_SLOP_PX = 10;

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

/** Messages, with a day marker wherever the date changes. */
export function ThreadBody({ t, dm, editPoll }: { t: ReturnType<typeof useThread>; dm?: boolean; editPoll?: (m: Message) => void }) {
  const modal = useModal();
  const confirm = useConfirm();
  const box = useRef<HTMLDivElement>(null);
  const last = t.msgs[t.msgs.length - 1]?.community_message_id;
  useEffect(() => {
    const el = box.current;
    if (el && !t.q) el.scrollTop = el.scrollHeight;
  }, [last, t.q]);
  const today = todayIso();
  const yesterday = todayIso(new Date(Date.now() - 86400000));
  let lastDay = "";
  const rows = useMemo(() => rowsOf(t.msgs), [t.msgs]);
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
  /* A long press on a phone starts picking; the tap that ends it opens nothing. */
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const swallow = useRef(false);
  const letGo = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const pressFor = (ids: string[], canPick: boolean) =>
    phone && !picking && canPick
      ? {
          onPointerDown: (e: ReactPointerEvent) => {
            letGo();
            const timer = setTimeout(() => {
              hold.current = null;
              swallow.current = true;
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
          onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
        }
      : {};
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
    if (m.can_delete) items.push({ label: "Delete", icon: "trash", danger: true, onSelect: () => void remove(m) });
    if (!items.length) return undefined;
    return (
      <span className="opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <Menu label="Message actions" trigger={(p) => <IconButton {...p} icon="dots" label="Message actions" size="sm" />} items={items} />
      </span>
    );
  };
  return (
    <div ref={box} data-thread data-copy="content" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 [&>*]:flex-shrink-0">
      {t.page?.has_next && (
        <Button className="self-center" size="sm" onClick={() => t.older()}>
          Load Older
        </Button>
      )}
      {rows.map(({ key, ms }) => {
        const m = ms[0]!;
        const day = todayIso(new Date(m.sent_at));
        const marker = day !== lastDay ? (day === today ? "Today" : day === yesterday ? "Yesterday" : formatDate(day)) : null;
        lastDay = day;
        const ids = ms.map((x) => x.community_message_id);
        const canPick = ms.every(forwardable);
        const on = Boolean(picking && ids.every((id) => picking.includes(id)));
        return (
          <div key={key} className="flex flex-col gap-3">
            {marker && <span className="self-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-2xs text-subtle-foreground">{marker}</span>}
            <div
              className={cn("group flex items-start gap-2", picking && canPick && "cursor-pointer", phone && "no-callout select-none")}
              onClickCapture={(e) => {
                if (swallow.current) {
                  swallow.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                } else if (picking && canPick) {
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
      })}
      {!t.msgs.length && !t.loading && <p className="m-auto text-xs text-subtle-foreground">{t.q ? "Nothing matches here." : "No messages yet. Say hello."}</p>}
      {viewer}
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
export function Composer({ placeholder, onSend, onVoice, plus, readOnly }: { placeholder: string; onSend: (b: MessageCreate) => Promise<void>; onVoice: (file: File, seconds: number) => Promise<void>; plus?: (cls: string) => ReactNode; readOnly?: string }) {
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
  const keep = useRef(false);

  useEffect(() => {
    if (rec == null) return;
    const i = setInterval(() => setRec((s) => (s == null ? s : s + 1)), 1000);
    return () => clearInterval(i);
  }, [rec]);
  useEffect(() => () => stream.current?.getTracks().forEach((tr) => tr.stop()), []);

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
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    if (!keep.current) return;
    setBusy(true);
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      await onVoice(new File([blob], `voice-note.${ext}`, { type: blob.type || "audio/webm" }), seconds);
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
