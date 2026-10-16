import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import type { Message, MessageCreate } from "@/api/types/community";
import type { PageMeta } from "@/api/types/common";
import { Button, cn, formatDate, Icon, IconButton, InlineInput, todayIso } from "@mycity/ui";
import { Post } from "./Posts";

/** A list row: a channel or a person. */
export function Row({ on, unread, lead, title, sub, when, count, onClick }: { on: boolean; unread: boolean; lead: ReactNode; title: ReactNode; sub: string; when: string; count: number; onClick: () => void }) {
  return (
    <button type="button" data-copy="content" onClick={onClick} aria-current={on || undefined} className={cn("flex w-full items-center gap-2.5 rounded-box px-2 py-2 text-left max-md:min-h-11", on ? "bg-muted bar-selected" : "hover:bg-muted")}>
      {lead}
      <span className="min-w-0 flex-1">
        <b className={cn("flex items-center gap-1 truncate text-sm", unread ? "font-bold" : "font-semibold")}>{title}</b>
        <span className="block truncate text-2xs text-subtle-foreground">{sub}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-0.5">
        <em className={cn("text-2xs not-italic", unread ? "font-strong text-accent-foreground" : "text-subtle-foreground")}>{when}</em>
        {count > 0 && <i className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-2xs font-bold text-primary-foreground not-italic">{count}</i>}
      </span>
    </button>
  );
}

/**
 * A conversation's messages: newest page first, "Load Older" reaches back a page
 * at a time (community.md §5). Search goes to the server as `q`.
 */
export function useThread(kind: "channel" | "direct", id: string | null) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [page, setPage] = useState<PageMeta | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const pageNo = useRef(1);

  const fetchPage = useCallback(
    async (n: number, search: string) => {
      if (!id) return null;
      const query = { page: n, ...(search ? { q: search } : {}) };
      return kind === "channel"
        ? api.call("GET /api/v1/community/channels/:id/messages", { params: { id }, query })
        : api.call("GET /api/v1/community/direct/:id/messages", { params: { id }, query });
    },
    [id, kind],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetchPage(1, q);
    pageNo.current = 1;
    if (res) {
      setMsgs(res.data);
      setPage(res.page);
    }
    setLoading(false);
  }, [fetchPage, q]);

  useEffect(() => {
    setMsgs([]);
    void reload();
  }, [reload]);

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
    if (kind === "channel") await api.call("POST /api/v1/community/channels/:id/messages", { params: { id }, body });
    else await api.call("POST /api/v1/community/direct/:id/messages", { params: { id }, body });
    await reload();
    if (kind === "direct") {
      setTimeout(() => void reload(), 900);
      setTimeout(() => void reload(), 2800);
    }
  };

  const replace = (m: Message) => setMsgs((list) => list.map((x) => (x.message_id === m.message_id ? m : x)));
  return { msgs, page, q, setQ, loading, older, send, reload, replace };
}

/** Messages, with a day marker wherever the date changes. */
export function ThreadBody({ t, dm }: { t: ReturnType<typeof useThread>; dm?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const last = t.msgs[t.msgs.length - 1]?.message_id;
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);
  const today = todayIso();
  const yesterday = todayIso(new Date(Date.now() - 86400000));
  let lastDay = "";
  const react = async (m: Message) => t.replace(await api.call("POST /api/v1/community/messages/:id/reactions", { params: { id: m.message_id }, body: {} }));
  const vote = async (m: Message, i: number) => t.replace(await api.call("POST /api/v1/community/messages/:id/vote", { params: { id: m.message_id }, body: { option: i } }));
  return (
    <div ref={box} data-copy="content" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4 [&>*]:flex-shrink-0">
      {t.page?.has_next && (
        <Button className="self-center" size="sm" onClick={() => void t.older()}>
          Load Older
        </Button>
      )}
      {t.msgs.map((m) => {
        const day = todayIso(new Date(m.created_at));
        const marker = day !== lastDay ? (day === today ? "Today" : day === yesterday ? "Yesterday" : formatDate(day)) : null;
        lastDay = day;
        return (
          <div key={m.message_id} className={cn("flex flex-col gap-3", m.mine && m.kind !== "poll" && "items-end")}>
            {marker && <span className="self-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-2xs text-subtle-foreground">{marker}</span>}
            <Post m={m} q={t.q} dm={dm} onCelebrate={() => void react(m)} onVote={(i) => void vote(m, i)} />
          </div>
        );
      })}
      {!t.msgs.length && !t.loading && <p className="m-auto text-xs text-subtle-foreground">{t.q ? "Nothing matches in this conversation." : "No messages yet. Say hello."}</p>}
    </div>
  );
}

/** Search inside a conversation. */
export function ThreadSearch({ t, onClose }: { t: ReturnType<typeof useThread>; onClose: () => void }) {
  const [v, setV] = useState(t.q);
  useEffect(() => {
    const x = setTimeout(() => t.setQ(v.trim()), 250);
    return () => clearTimeout(x);
  }, [v, t]);
  return (
    <div role="search" className="flex flex-none items-center gap-1.5 border-b border-border bg-muted px-3 py-2">
      <InlineInput autoFocus className="h-8 min-w-0 flex-1 rounded-full border border-input bg-background px-3 outline-none focus:border-ring" placeholder="Search messages" aria-label="Search in this conversation" value={v} onChange={setV} />
      <span className="min-w-13 text-center text-2xs text-subtle-foreground">{t.q ? `${t.page?.total ?? 0} found` : ""}</span>
      <IconButton icon="x" label="Close search" size="sm" onClick={() => (t.setQ(""), onClose())} />
    </div>
  );
}

/** The composer for a channel or a conversation. Voice notes in conversations only. */
export function Composer({ placeholder, onSend, plus, voice, readOnly }: { placeholder: string; onSend: (b: MessageCreate) => Promise<void>; plus?: (cls: string) => ReactNode; voice?: boolean; readOnly?: string }) {
  const [text, setText] = useState("");
  const [rec, setRec] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (rec == null) return;
    const i = setInterval(() => setRec((s) => (s == null ? s : s + 1)), 1000);
    return () => clearInterval(i);
  }, [rec]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    await onSend({ kind: "text", text: text.trim() });
    setText("");
    setBusy(false);
  };
  const base = "flex flex-none items-center gap-2 border-t border-border bg-card px-3 py-2.5 max-md:px-2 max-md:pb-safe-2";
  const cbtn = "flex size-10 flex-none items-center justify-center rounded-full border border-input bg-background text-muted-foreground hover:bg-muted";
  if (readOnly) return <div className={base}><span className="flex flex-1 items-center gap-2 text-xs text-subtle-foreground"><Icon name="lock" />{readOnly}</span></div>;
  if (rec != null)
    return (
      <div className={base}>
        <button type="button" className={cbtn} aria-label="Cancel recording" onClick={() => setRec(null)}><Icon name="x" /></button>
        <span className="flex h-10 flex-1 items-center gap-2 rounded-full bg-destructive-soft px-3.5 text-sm font-semibold text-destructive">
          <i className="size-2 animate-pulse-dot rounded-full bg-destructive" />Recording {Math.floor(rec / 60)}:{String(rec % 60).padStart(2, "0")}
        </span>
        <button type="button" className={cn(cbtn, "on-primary border-primary bg-primary text-primary-foreground")} aria-label="Send voice note" onClick={async () => { const d = Math.max(1, rec); setRec(null); await onSend({ kind: "voice", duration_s: d }); }}>
          <Icon name="send" />
        </button>
      </div>
    );
  return (
    <div className={base}>
      {plus?.(cbtn)}
      <InlineInput
        className="h-10 min-w-0 flex-1 rounded-full border border-input bg-muted px-3.5 outline-none focus:border-ring"
        placeholder={placeholder}
        aria-label="Message"
        autoComplete="off"
        value={text}
        onChange={setText}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
      />
      {voice && !text && <button type="button" className={cbtn} aria-label="Record a voice note" onClick={() => setRec(0)}><Icon name="mic" /></button>}
      <button type="button" disabled={busy} className={cn(cbtn, "on-primary border-primary bg-primary text-primary-foreground hover:bg-primary")} aria-label="Send" onClick={() => void send()}>
        <Icon name="send" />
      </button>
    </div>
  );
}
