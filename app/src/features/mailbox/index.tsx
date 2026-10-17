import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import { invalidate, useApi, usePaged } from "@/api/hooks";
import "@/api/types/mailbox";
import type { MailAddress, MailFolder, MailMessage, ThreadRow } from "@/api/types/mailbox";
import { saveFile } from "@/api/download";
import { useRealtime } from "@/api/realtime";
import { useAuth } from "@/auth/AuthProvider";
import { useFitPage } from "@/shell/layout-context";
import type { ModuleScreenProps } from "@/shell/screens";
import { Composer, type ComposeInit } from "./Composer";
import { ApiError } from "@/api/client";
import { Avatar, Banner, Button, cn, EmptyState, ErrorState, Field, formatBytes, formatDateTime, formatWhen, FormFooter, Icon, IconButton, LoadingRows, Menu, PageHeader, PasswordField, Pill, SearchInput, SplitPanes, StatStrip, TextField, toast, useContractForm, useIsMobile, useModal, useSplitPanes, type MenuItem, type SplitState } from "@mycity/ui";

const NAMES: Record<MailFolder, string> = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", archive: "Archive", spam: "Spam", trash: "Trash" };
const who = (a: MailAddress | null) => (a ? a.name || a.address : "(no recipient)");

export default function Mailbox({ tab }: ModuleScreenProps) {
  const folder = (tab in NAMES ? tab : "inbox") as MailFolder;
  const mobile = useIsMobile();
  useFitPage(!mobile);
  const modal = useModal();
  const conn = useApi("GET /api/v1/mailbox/connection");
  const list = usePaged("GET /api/v1/mailbox/threads", { filters: { folder } });
  const unread = useApi("GET /api/v1/mailbox/threads", { query: { folder, unread: true } });
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const split = useSplitPanes("mail", 330);
  const rows = list.rows;
  const current = rows.find((r) => r.mail_thread_id === sel) ?? (mobile ? undefined : rows[0]);
  const from = conn.data?.email ?? "";
  const status = conn.data?.status;
  const connectSheet = () =>
    modal.open({ title: "Connect Mailbox", body: (close) => <ConnectMailbox email={conn.data?.email ?? null} close={close} done={() => (conn.reload(), invalidate("/api/v1/mailbox"))} /> });
  /* No mailbox yet: the Connect sheet opens over the page, once. */
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (status === "disconnected" && !asked) {
      setAsked(true);
      connectSheet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once when the connection first reads as missing
  }, [status, asked]);
  useRealtime("mailbox.updated", () => invalidate("/api/v1/mailbox"));

  const compose = (init: ComposeInit = {}, title = "New Message") => modal.open({ title, wide: true, full: true, body: (close) => <Composer from={from} init={init} close={close} /> });
  const refresh = async () => {
    await api.call("POST /api/v1/mailbox/connection/sync", { body: {} });
    invalidate("/api/v1/mailbox");
    toast("Mailbox up to date");
  };
  if (status === "disconnected")
    return (
      <>
        <PageHeader title={NAMES[folder]} />
        <EmptyState illustration="FirstRun" title="Connect Your Mailbox" text="Sign in with your work address." action={<Button variant="primary" icon="mail" onClick={connectSheet}>Connect Mailbox</Button>} />
      </>
    );
  const total = list.page?.total ?? 0;
  const nUnread = unread.data?.page.total ?? 0;
  const withFiles = rows.filter((r) => r.has_attachment).length;
  const emptiable = folder === "spam" || folder === "trash";

  return (
    <>
      <PageHeader
        title={NAMES[folder]}
        sub={`${total} message${total === 1 ? "" : "s"}${nUnread ? ` · ${nUnread} unread` : ""}`}
        actions={
          <>
            {emptiable && total > 0 && <Button onClick={() => modal.open({ title: `Empty ${NAMES[folder]}`, body: (close) => <EmptyFolder kind={folder as "spam" | "trash"} count={total} close={close} /> })}>Empty {NAMES[folder]}</Button>}
            <Button onClick={() => void refresh()}>Refresh</Button>
            <Button variant="primary" icon="plus" onClick={() => compose()}>Compose</Button>
          </>
        }
      />
      {status === "needs_reconnect" && <Banner tone="warn" action={<Button size="sm" onClick={connectSheet}>Reconnect</Button>}>Mail server refused the password</Banner>}
      <StatStrip items={[{ label: "Folder", value: NAMES[folder] }, { label: "Messages", value: total }, { label: "Unread", value: nUnread, tone: nUnread ? "warn" : "ok" }, { label: "Attachments", value: withFiles }, { label: "Mailbox", value: from, desktop: true }]} />
      <MailFrame
        open={open}
        split={split}
        list={
          <>
            <div className="flex-none border-b border-border p-2.5"><SearchInput value={list.q} onChange={list.setQ} placeholder={`Search ${NAMES[folder]}`} /></div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:overflow-visible">
              {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !rows.length ? <LoadingRows count={6} /> : rows.map((r) => (
                <MailRow key={r.mail_thread_id} r={r} on={r.mail_thread_id === current?.mail_thread_id && (!mobile || open)} onClick={() => (setSel(r.mail_thread_id), setOpen(true))} />
              ))}
              {!list.loading && !list.error && !rows.length && <p className="p-4 text-xs text-subtle-foreground">{list.q ? "Nothing matches." : `Nothing in ${NAMES[folder]}.`}</p>}
              {list.page && list.page.pages > 1 && (
                <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-2xs text-subtle-foreground">
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
        reader={current ? (current.mail_draft_id ? <DraftReader key={current.mail_thread_id} row={current} onBack={() => setOpen(false)} compose={compose} /> : <ThreadReader key={current.mail_thread_id} row={current} onBack={() => setOpen(false)} compose={compose} onMoved={() => (setSel(null), setOpen(false))} />) : <p className="m-auto p-6 text-xs text-subtle-foreground">{list.loading ? "" : "Pick a message to read it."}</p>}
      />
    </>
  );
}

function MailFrame({ open, split, list, reader }: { open: boolean; split: SplitState; list: ReactNode; reader: ReactNode }) {
  return (
    <SplitPanes split={split} list={list} detail={reader} open={open} minHeight="sm" scrolls />
  );
}

function MailRow({ r, on, onClick }: { r: ThreadRow; on: boolean; onClick: () => void }) {
  return (
    <button type="button" data-copy="content" onClick={onClick} aria-current={on || undefined} className={cn("flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left last:border-b-0", on ? "bg-muted bar-selected" : "hover:bg-muted")}>
      <i className={cn("mt-1 size-1.5 flex-none rounded-full", r.unread ? "bg-primary" : "bg-transparent")} aria-label={r.unread ? "Unread" : undefined} />
      <span className="min-w-0 flex-1">
        <b className={cn("block truncate text-xs", r.unread ? "font-bold" : "font-strong")}>{who(r.party)}</b>
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {r.scheduled && <Pill tone="info">Scheduled</Pill>}
          <span className="truncate">{r.subject}</span>
        </span>
        <span className="block truncate text-2xs text-subtle-foreground">{r.snippet}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-1 text-2xs text-subtle-foreground">
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

function ThreadReader({ row, onBack, compose, onMoved }: { row: ThreadRow; onBack: () => void; compose: (init: ComposeInit, title?: string) => void; onMoved: () => void }) {
  const t = useApi("GET /api/v1/mailbox/threads/:id", { params: { id: row.mail_thread_id } });
  const [images, setImages] = useState(false);
  /* Opening a thread marks it read on the server too (mailbox.md §3). */
  useEffect(() => {
    if (row.unread) void api.call("POST /api/v1/mailbox/threads/:id/read", { params: { id: row.mail_thread_id }, body: {} }).then(() => invalidate("/api/v1/mailbox/threads"));
  }, [row.mail_thread_id, row.unread]);

  const move = async (to: "inbox" | "archive" | "spam" | "trash") => {
    await api.call("POST /api/v1/mailbox/threads/:id/move", { params: { id: row.mail_thread_id }, body: { to } });
    invalidate("/api/v1/mailbox");
    onMoved();
    toast(to === "inbox" ? "Moved back to Inbox" : `Moved to ${NAMES[to]}`);
  };
  const back = (
    <Button className="mb-2.5 md:hidden" icon="left" onClick={onBack}>
      Back
    </Button>
  );
  if (t.error) return <div className="p-4.5">{back}<ErrorState error={t.error} onRetry={t.reload} /></div>;
  if (!t.data) return <div className="p-4.5">{back}<LoadingRows count={5} /></div>;
  const thread = t.data;
  const lastMsg = thread.messages[thread.messages.length - 1];
  const spam = row.folder === "spam";
  const reply = (all: boolean) => {
    const me = lastMsg.from.address;
    const others = all ? [...lastMsg.to, ...lastMsg.cc].filter((a) => a.toLowerCase() !== me.toLowerCase()) : [];
    compose({ to: [lastMsg.from.address], cc: others, subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`, body_html: quote(lastMsg), in_reply_to: lastMsg.mail_message_id }, all ? "Reply All" : "Reply");
  };
  const forward = () =>
    compose({ subject: /^fwd:/i.test(thread.subject) ? thread.subject : `Fwd: ${thread.subject}`, body_html: quote(lastMsg), attachments: lastMsg.attachments.map(({ document_id, file_name, size_bytes, mime_type }) => ({ document_id, file_name, size_bytes, mime_type })) }, "Forward");
  const moves: MenuItem[] = [
    ...(row.folder !== "archive" ? [{ label: "Archive", icon: "book" as const, onSelect: () => void move("archive") }] : []),
    ...(row.folder !== "inbox" && row.folder !== "sent" ? [{ label: "Move to Inbox", icon: "mail" as const, onSelect: () => void move("inbox") }] : []),
    ...(row.folder !== "spam" ? [{ label: "Move to Spam", icon: "alert" as const, onSelect: () => void move("spam") }] : []),
    ...(row.folder !== "trash" ? [{ label: "Move to Trash", icon: "x" as const, danger: true, onSelect: () => void move("trash") }] : []),
  ];

  return (
    <div className="p-4.5 max-md:px-3.5 max-md:pt-3 max-md:pb-safe-5">
      {back}
      <div className="flex items-start gap-3 border-b border-border pb-3.5 max-md:flex-wrap">
        <Avatar name={who(row.party ?? lastMsg.from)} size={38} />
        <span className="min-w-0 flex-1">
          <h2 data-copy="content" className="text-md leading-snug font-semibold">{thread.subject}</h2>
          <p className="mt-1 text-2xs text-subtle-foreground">
            {who(lastMsg.from)} &lt;{lastMsg.from.address}&gt; · {formatWhen(lastMsg.sent_at)}
          </p>
        </span>
        <span className="flex flex-wrap gap-1.5 max-md:w-full">
          {!spam && <Button icon="send" onClick={() => reply(false)}>Reply</Button>}
          {!spam && lastMsg.to.length + lastMsg.cc.length > 1 && <Button onClick={() => reply(true)}>Reply All</Button>}
          {!spam && <Button onClick={forward}>Forward</Button>}
          <Menu trigger={(p) => <IconButton {...p} icon="dots" label="Move this message" />} items={moves} />
        </span>
      </div>
      {thread.messages.map((m, i) => (
        <Message key={m.mail_message_id} m={m} head={thread.messages.length > 1 && i < thread.messages.length - 1} images={images} onImages={() => setImages(true)} />
      ))}
    </div>
  );
}

function Message({ m, head, images, onImages }: { m: MailMessage; head: boolean; images: boolean; onImages: () => void }) {
  const body = useMemo(() => (m.body_html == null ? null : clean(m.body_html, images)), [m.body_html, images]);
  return (
    <div className={cn(head && "border-b border-dashed border-border")}>
      {head && <p className="pt-3 text-2xs font-semibold text-subtle-foreground">{who(m.from)} · {formatWhen(m.sent_at)}</p>}
      {body == null ? (
        <p className="py-3.5 text-sm text-subtle-foreground">Spam is not shown.</p>
      ) : (
        <>
          {body.blocked > 0 && (
            <p className="mt-3 flex items-center gap-2 rounded-ctl bg-muted px-3 py-2 text-xs text-muted-foreground">
              <Icon name="image" />Remote images are hidden.
              <button type="button" className="font-semibold text-accent-foreground underline" onClick={onImages}>Load Images</button>
            </p>
          )}
          <div className="rte mail-body py-3.5 text-sm leading-relaxed text-muted-foreground [&_p+p]:mt-2.5" dangerouslySetInnerHTML={{ __html: body.html || "<p></p>" }} />
        </>
      )}
      {m.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-dashed border-border pt-3 pb-1">
          {m.attachments.map((a) => (
            <button key={a.mail_attachment_id} type="button" onClick={() => void saveFile(`/api/v1/documents/${a.document_id}/content`, a.file_name)} className="flex cursor-pointer items-center gap-1.5 rounded-ctl border border-border bg-muted px-2.5 py-1.5 text-xs font-semibold hover:bg-accent">
              <Icon name="doc" />{a.file_name}<span className="text-2xs text-subtle-foreground">{formatBytes(a.size_bytes)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A draft in Drafts: who it is to, what it says, and its schedule when it waits on the queue. */
function DraftReader({ row, onBack, compose }: { row: ThreadRow; onBack: () => void; compose: (init: ComposeInit, title?: string) => void }) {
  const d = useApi("GET /api/v1/mailbox/drafts/:id", { params: { id: row.mail_draft_id! } });
  const back = (
    <Button className="mb-2.5 md:hidden" icon="left" onClick={onBack}>
      Back
    </Button>
  );
  if (d.error) return <div className="p-4.5">{back}<ErrorState error={d.error} onRetry={d.reload} /></div>;
  if (!d.data) return <div className="p-4.5">{back}<LoadingRows count={4} /></div>;
  const draft = d.data;
  const cancelSchedule = async () => {
    if (!row.scheduled) return;
    await api.call("POST /api/v1/mailbox/queue/:id/cancel", { params: { id: row.scheduled.mail_send_queue_id }, body: {} });
    invalidate("/api/v1/mailbox");
    toast("Schedule cancelled");
  };
  const body = clean(draft.body_html, false);
  return (
    <div className="p-4.5 max-md:px-3.5 max-md:pt-3 max-md:pb-safe-5">
      {back}
      <div className="flex items-start gap-3 border-b border-border pb-3.5 max-md:flex-wrap">
        <span className="min-w-0 flex-1">
          <h2 data-copy="content" className="text-md leading-snug font-semibold">{draft.subject || "(no subject)"}</h2>
          <p className="mt-1 text-2xs text-subtle-foreground">To {draft.to_addresses.join(", ") || "(no recipient)"} · {formatWhen(draft.updated_at)}</p>
        </span>
        <span className="flex flex-wrap gap-1.5 max-md:w-full">
          {row.scheduled && <Button onClick={() => void cancelSchedule()}>Cancel Schedule</Button>}
          <Button variant="primary" icon="send" onClick={() => compose({ draft_id: draft.mail_draft_id, to: draft.to_addresses, cc: draft.cc_addresses, bcc: draft.bcc_addresses, subject: draft.subject, body_html: draft.body_html, attachments: draft.attachments, in_reply_to: draft.in_reply_to }, "Continue Draft")}>Continue Editing</Button>
        </span>
      </div>
      {row.scheduled && <div className="mt-3"><Pill tone="info">Scheduled {formatDateTime(row.scheduled.release_at)}</Pill></div>}
      <div data-copy="content" className="rte mail-body py-3.5 text-sm leading-relaxed text-muted-foreground [&_p+p]:mt-2.5" dangerouslySetInnerHTML={{ __html: body.html || "<p></p>" }} />
    </div>
  );
}

/** Connect (or reconnect) the mailbox with its address and password (mailbox.md §3 step 1). */
function ConnectMailbox({ email, close, done }: { email: string | null; close: () => void; done: () => void }) {
  const { me } = useAuth();
  const f = useContractForm({ email: email ?? me?.email ?? "", password: "" }, { email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : "Not an email address"), password: (v) => (v ? null : "Enter the password") });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!f.check()) return;
    setBusy(true);
    try {
      await api.call("POST /api/v1/mailbox/connection", { body: { email: f.values.email.trim(), password: f.values.password } });
      close();
      done();
      toast("Mailbox connected");
    } catch (e) {
      if (e instanceof ApiError && e.fields) f.setServerErrors(e.fields);
      else toast(e instanceof ApiError ? e.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Field label="Email Address" {...f.field("email")}><TextField {...f.field("email")} type="email" autoComplete="username" placeholder="name@mycityapp.io" /></Field>
      <Field label="Password" {...f.field("password")}><PasswordField {...f.field("password")} autoComplete="current-password" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={submit}>Connect</Button>
      </FormFooter>
    </>
  );
}

function EmptyFolder({ kind, count, close }: { kind: "spam" | "trash"; count: number; close: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {count} message{count === 1 ? "" : "s"} in {NAMES[kind]} will be deleted for good. This cannot be undone.
      </p>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          busy={busy}
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
      </FormFooter>
    </>
  );
}
