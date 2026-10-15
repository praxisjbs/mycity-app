import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import { invalidate, useApi, usePaged } from "@/api/hooks";
import "@/api/types/mailbox";
import type { MailAddress, MailFolder, MailMessage, ThreadRow } from "@/api/types/mailbox";
import { Button, IconButton } from "@/components/ui/Button";
import { Avatar, Banner, Pill, StatStrip } from "@/components/ui/data";
import { Icon } from "@/components/ui/Icon";
import { InfoButton, InfoText, useInfo } from "@/components/ui/Info";
import { PageHead } from "@/components/ui/layout";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { useModal } from "@/components/ui/Modal";
import { ErrorBlock, LoadingRows } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { formatBytes, formatDateTime, formatWhen } from "@/lib/format";
import { useIsMobile } from "@/lib/media";
import { useFitPage } from "@/shell/layout-context";
import type { ModuleScreenProps } from "@/shell/screens";
import { Splitter, useSplit } from "@/features/community/Chat";
import { Composer, type ComposeInit } from "./Composer";
import { SearchBox } from "@/components/form";

const NAMES: Record<MailFolder, string> = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive", spam: "Spam", trash: "Trash" };
const who = (a: MailAddress | null) => (a ? a.name || a.address : "(no recipient)");

export default function Mailbox({ tab }: ModuleScreenProps) {
  const folder = (tab in NAMES ? tab : "inbox") as MailFolder;
  const mobile = useIsMobile();
  useFitPage(!mobile);
  const modal = useModal();
  const info = useInfo();
  const conn = useApi("GET /api/v1/mailbox/connection");
  const list = usePaged("GET /api/v1/mailbox/threads", { filters: { folder } });
  const unread = useApi("GET /api/v1/mailbox/threads", { query: { folder, unread: true } });
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const split = useSplit("mail", 330);
  const rows = list.rows;
  const current = rows.find((r) => r.thread_id === sel) ?? (mobile ? undefined : rows[0]);
  const from = conn.data?.email_address ?? "";

  const compose = (init: ComposeInit = {}, title = "New Message") => modal.open({ title, wide: true, full: true, body: (close) => <Composer from={from} init={init} close={close} /> });
  const refresh = async () => {
    await api.call("POST /api/v1/mailbox/connection/sync", { body: {} });
    invalidate("/api/v1/mailbox");
    toast("Mailbox up to date");
  };
  const total = list.page?.total ?? 0;
  const nUnread = unread.data?.page.total ?? 0;
  const withFiles = rows.filter((r) => r.has_attachment).length;
  const emptiable = folder === "spam" || folder === "trash";

  return (
    <>
      <PageHead
        title={<span className="inline-flex items-center gap-1.5">{NAMES[folder]} <InfoButton {...info} label="About the mailbox" /></span>}
        sub={`${total} message${total === 1 ? "" : "s"}${nUnread ? ` · ${nUnread} unread` : ""}`}
        actions={
          <>
            {emptiable && total > 0 && <Button onClick={() => modal.open({ title: `Empty ${NAMES[folder]}`, body: (close) => <EmptyFolder kind={folder as "spam" | "trash"} count={total} close={close} /> })}>Empty {NAMES[folder]}</Button>}
            <Button onClick={() => void refresh()}>Refresh</Button>
            <Button variant="primary" icon="plus" onClick={() => compose()}>Compose</Button>
          </>
        }
      />
      <InfoText {...info}>Custom domain only. No Google, no Microsoft. Signed in with an address and a password, the same as any other mailbox. Mail here sends and receives only; it is not linked to any other module.</InfoText>
      {conn.data?.status === "needs_reconnect" && <Banner tone="warn">The mail server refused the saved password. Reconnect under Settings, Integrations to keep receiving mail.</Banner>}
      <StatStrip items={[{ label: "Folder", value: NAMES[folder] }, { label: "Messages", value: total }, { label: "Unread", value: nUnread, tone: nUnread ? "warn" : "ok" }, { label: "Attachments", value: withFiles }, { label: "Mailbox", value: from, desktop: true }]} />
      <MailFrame
        mobile={mobile}
        open={open}
        split={split}
        list={
          <>
            <div className="flex-none border-b border-border p-2.5"><SearchBox value={list.q} onChange={list.setQ} placeholder={`Search ${NAMES[folder]}`} /></div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:overflow-visible">
              {list.error ? <ErrorBlock error={list.error} onRetry={list.reload} /> : list.loading && !rows.length ? <LoadingRows count={6} /> : rows.map((r) => (
                <MailRow key={r.thread_id} r={r} on={r.thread_id === current?.thread_id && (!mobile || open)} onClick={() => (setSel(r.thread_id), setOpen(true))} />
              ))}
              {!list.loading && !list.error && !rows.length && <p className="p-4 text-[12.5px] text-subtle-foreground">{list.q ? "Nothing matches." : `Nothing in ${NAMES[folder]}.`}</p>}
              {list.page && list.page.pages > 1 && (
                <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11.5px] text-subtle-foreground">
                  <span>Page {list.page.number} of {list.page.pages}</span>
                  <span className="flex gap-1.5">
                    <Button size="sm" disabled={list.page.number <= 1} onClick={() => list.setPage(list.pageNumber - 1)}>Newer</Button>
                    <Button size="sm" disabled={!list.page.has_next} onClick={() => list.setPage(list.pageNumber + 1)}>Older</Button>
                  </span>
                </div>
              )}
            </div>
          </>
        }
        reader={current ? <Reader key={current.thread_id} row={current} onBack={() => setOpen(false)} compose={compose} onMoved={() => (setSel(null), setOpen(false))} /> : <p className="m-auto p-6 text-[12.5px] text-subtle-foreground">{list.loading ? "" : "Pick a message to read it."}</p>}
      />
    </>
  );
}

function MailFrame({ mobile, open, split, list, reader }: { mobile: boolean; open: boolean; split: ReturnType<typeof useSplit>; list: ReactNode; reader: ReactNode }) {
  const pane = "flex min-h-0 flex-col overflow-hidden rounded-card border border-border bg-card shadow-1";
  if (mobile)
    return (
      <>
        <div className={pane}>{list}</div>
        {open && <div className="pt-safe fixed inset-x-0 top-(--env-bar) bottom-0 z-[62] flex flex-col overflow-y-auto bg-card">{reader}</div>}
      </>
    );
  return (
    <div className="grid min-h-[360px] flex-1 gap-1" style={{ gridTemplateColumns: `${split.w}px 8px minmax(0,1fr)`, gridTemplateRows: "minmax(0,1fr)" }}>
      <div className={pane}>{list}</div>
      <Splitter onPointerDown={split.start} nudge={split.nudge} />
      <div className={cn(pane, "overflow-y-auto overscroll-contain")}>{reader}</div>
    </div>
  );
}

function MailRow({ r, on, onClick }: { r: ThreadRow; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={on || undefined} className={cn("flex w-full items-start gap-[9px] border-b border-border px-[13px] py-[11px] text-left last:border-b-0", on ? "bg-accent" : "hover:bg-muted")}>
      <i className={cn("mt-[5px] size-[7px] flex-none rounded-full", r.unread ? "bg-primary" : "bg-transparent")} aria-label={r.unread ? "Unread" : undefined} />
      <span className="min-w-0 flex-1">
        <b className={cn("block truncate text-[12.5px]", r.unread ? "font-bold" : "font-[650]")}>{who(r.party)}</b>
        <span className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
          {r.scheduled && <Pill tone="info">Scheduled</Pill>}
          <span className="truncate">{r.subject}</span>
        </span>
        <span className="block truncate text-[11.5px] text-subtle-foreground">{r.snippet}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-1 text-[11px] text-subtle-foreground">
        {formatWhen(r.last_message_at)}
        {r.has_attachment && <Icon name="clip" className="size-3.5" />}
      </span>
    </button>
  );
}

/**
 * HTML mail arrives sanitised from the server. This is a second line: no
 * scripts, no handlers, links open outside, and remote images wait until asked.
 */
function clean(html: string, images: boolean) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,link,meta").forEach((n) => n.remove());
  let blocked = 0;
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) if (a.name.startsWith("on") || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
    if (el.tagName === "IMG" && !images && /^https?:/i.test(el.getAttribute("src") ?? "")) {
      el.removeAttribute("src");
      blocked++;
    }
  });
  return { html: doc.body.firstElementChild?.innerHTML ?? "", blocked };
}

function quote(m: MailMessage) {
  return `<p></p><p></p><p>On ${formatDateTime(m.sent_at)}, ${who(m.from)} wrote:</p><blockquote>${m.body_html ?? ""}</blockquote>`;
}

function Reader({ row, onBack, compose, onMoved }: { row: ThreadRow; onBack: () => void; compose: (init: ComposeInit, title?: string) => void; onMoved: () => void }) {
  const t = useApi("GET /api/v1/mailbox/threads/:id", { params: { id: row.thread_id } });
  const [images, setImages] = useState(false);
  /* Opening a thread marks it read on the server too (mailbox.md §3). */
  useEffect(() => {
    if (row.unread) void api.call("POST /api/v1/mailbox/threads/:id/read", { params: { id: row.thread_id }, body: {} }).then(() => invalidate("/api/v1/mailbox/threads"));
  }, [row.thread_id, row.unread]);

  const move = async (to: "inbox" | "archive" | "spam" | "trash") => {
    await api.call("POST /api/v1/mailbox/threads/:id/move", { params: { id: row.thread_id }, body: { to } });
    invalidate("/api/v1/mailbox");
    onMoved();
    toast(to === "inbox" ? "Moved back to Inbox" : `Moved to ${NAMES[to]}`);
  };
  const continueDraft = async () => {
    if (!row.draft_id) return;
    const d = await api.call("GET /api/v1/mailbox/drafts/:id", { params: { id: row.draft_id } });
    compose({ draft_id: d.draft_id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body_html: d.body_html, attachments: d.attachments }, "Continue Draft");
  };
  const cancelSchedule = async () => {
    if (!row.scheduled) return;
    await api.call("POST /api/v1/mailbox/queue/:id/cancel", { params: { id: row.scheduled.queue_id }, body: {} });
    invalidate("/api/v1/mailbox");
    toast("Schedule cancelled. The message is back in Drafts");
  };

  const back = (
    <Button className="mb-2.5 md:hidden" icon="left" onClick={onBack}>
      Back
    </Button>
  );
  if (t.error) return <div className="p-[18px]">{back}<ErrorBlock error={t.error} onRetry={t.reload} /></div>;
  if (!t.data) return <div className="p-[18px]">{back}<LoadingRows count={5} /></div>;
  const thread = t.data;
  const lastMsg = thread.messages[thread.messages.length - 1];
  const draft = row.folder === "drafts";
  const spam = row.folder === "spam";
  const reply = (all: boolean) => {
    const others = all ? [...lastMsg.to, ...lastMsg.cc].map((a) => a.address).filter((a) => a !== lastMsg.from.address) : [];
    compose({ to: [lastMsg.from.address], cc: others, subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`, body_html: quote(lastMsg) }, all ? "Reply All" : "Reply");
  };
  const forward = () => compose({ subject: /^fwd:/i.test(thread.subject) ? thread.subject : `Fwd: ${thread.subject}`, body_html: quote(lastMsg), attachments: lastMsg.attachments }, "Forward");
  const moves: MenuItem[] = [
    ...(row.folder !== "archive" ? [{ label: "Archive", icon: "book" as const, onSelect: () => void move("archive") }] : []),
    ...(row.folder !== "inbox" && row.folder !== "sent" ? [{ label: "Move to Inbox", icon: "mail" as const, onSelect: () => void move("inbox") }] : []),
    ...(row.folder !== "spam" ? [{ label: "Move to Spam", icon: "alert" as const, onSelect: () => void move("spam") }] : []),
    ...(row.folder !== "trash" ? [{ label: "Move to Trash", icon: "x" as const, danger: true, onSelect: () => void move("trash") }] : []),
  ];

  return (
    <div className="p-[18px] max-md:px-[14px] max-md:pt-3 max-md:pb-[calc(20px+env(safe-area-inset-bottom,0px))]">
      {back}
      <div className="flex items-start gap-3 border-b border-border pb-3.5 max-md:flex-wrap">
        <Avatar name={who(draft ? lastMsg.from : row.party)} size={38} />
        <span className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-[1.35] font-semibold">{thread.subject}</h3>
          <p className="mt-1 text-[11.5px] text-subtle-foreground">
            {draft ? `To ${lastMsg.to.map((a) => a.address).join(", ") || "(no recipient)"}` : `${who(lastMsg.from)} <${lastMsg.from.address}>`} · {formatWhen(lastMsg.sent_at)}
          </p>
        </span>
        <span className="flex flex-wrap gap-1.5 max-md:w-full">
          {draft ? (
            <>
              {row.scheduled && <Button onClick={() => void cancelSchedule()}>Cancel Schedule</Button>}
              <Button variant="primary" icon="send" onClick={() => void continueDraft()}>Continue Editing</Button>
            </>
          ) : (
            <>
              {!spam && <Button icon="send" onClick={() => reply(false)}>Reply</Button>}
              {!spam && lastMsg.to.length + lastMsg.cc.length > 1 && <Button onClick={() => reply(true)}>Reply All</Button>}
              {!spam && <Button onClick={forward}>Forward</Button>}
              <Menu trigger={(p) => <IconButton {...p} icon="dots" label="Move this message" />} items={moves} />
            </>
          )}
        </span>
      </div>
      {row.scheduled && <div className="mt-3"><Banner tone="info" icon="clock">Scheduled to send {formatDateTime(row.scheduled.release_at)}. It can be cancelled until then.</Banner></div>}
      {thread.messages.map((m, i) => (
        <Message key={m.message_id} m={m} head={thread.messages.length > 1 && i < thread.messages.length - 1} images={images} onImages={() => setImages(true)} />
      ))}
    </div>
  );
}

function Message({ m, head, images, onImages }: { m: MailMessage; head: boolean; images: boolean; onImages: () => void }) {
  const body = useMemo(() => (m.body_html == null ? null : clean(m.body_html, images)), [m.body_html, images]);
  const download = (name: string) => (import.meta.env.VITE_API_MODE === "mock" ? toast(`${name} downloads once the mailbox is connected`) : undefined);
  return (
    <div className={cn(head && "border-b border-dashed border-border")}>
      {head && <p className="pt-3 text-[11.5px] font-semibold text-subtle-foreground">{who(m.from)} · {formatWhen(m.sent_at)}</p>}
      {body == null ? (
        <p className="py-3.5 text-[13px] text-subtle-foreground">Marked as spam by the filter. The body is not rendered.</p>
      ) : (
        <>
          {body.blocked > 0 && (
            <p className="mt-3 flex items-center gap-2 rounded-ctl bg-muted px-3 py-2 text-[12px] text-muted-foreground">
              <Icon name="image" />Remote images are hidden.
              <button type="button" className="font-semibold text-accent-foreground underline" onClick={onImages}>Load Images</button>
            </p>
          )}
          <div className="rte mail-body py-3.5 text-[13px] leading-[1.65] text-muted-foreground [&_p+p]:mt-2.5" dangerouslySetInnerHTML={{ __html: body.html || "<p></p>" }} />
        </>
      )}
      {m.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-dashed border-border pt-3 pb-1">
          {m.attachments.map((a) => (
            <a key={a.attachment_id} href={import.meta.env.VITE_API_MODE === "mock" ? undefined : `/api/v1/mailbox/attachments/${a.attachment_id}/content`} onClick={() => download(a.file_name)} role="button" tabIndex={0} className="flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-border bg-muted px-[11px] py-[7px] text-[12px] font-[550] hover:bg-accent">
              <Icon name="doc" />{a.file_name}<span className="text-[11.5px] text-subtle-foreground">{formatBytes(a.size_bytes)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyFolder({ kind, count, close }: { kind: "spam" | "trash"; count: number; close: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="text-[13px] text-muted-foreground">
        {count} message{count === 1 ? "" : "s"} in {NAMES[kind]} will be deleted for good. This cannot be undone.
      </p>
      <div className="-mx-[18px] mt-4 -mb-4 flex justify-end gap-2 border-t border-border px-[18px] py-3">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await api.call("POST /api/v1/mailbox/folders/:kind/empty", { params: { kind }, body: {} });
            invalidate("/api/v1/mailbox");
            close();
            toast(`${r.removed} message${r.removed === 1 ? "" : "s"} deleted`);
          }}
        >
          Empty {NAMES[kind]}
        </Button>
      </div>
    </>
  );
}
