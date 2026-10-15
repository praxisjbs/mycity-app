import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import type { MailAttachment, MailDraftSave } from "@/api/types/mailbox";
import { Button, cn, formatBytes, formatDate, Icon, todayIso } from "@mycity/ui";
import { Pill } from "@/components/ui/data";
import { Menu } from "@/components/ui/Menu";
import { toast } from "@/components/ui/Toast";
import { DateField, Field, InlineInput, InlineLabel, InlineSelect, Input, Upload } from "@/components/form";

export interface ComposeInit {
  draft_id?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_html?: string;
  attachments?: MailAttachment[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The formatting tools (mailbox.md §6). Links take https:// or mailto: only, entered inline. */
const TOOLS: Array<[label: string, cmd: string, title: string, cls?: string] | "|"> = [
  ["B", "bold", "Bold", "font-extrabold"],
  ["I", "italic", "Italic", "italic"],
  ["U", "underline", "Underline", "underline"],
  ["S", "strikeThrough", "Strikethrough", "line-through"],
  "|",
  ["H", "h2", "Heading"],
  ["•", "insertUnorderedList", "Bulleted list"],
  ["1.", "insertOrderedList", "Numbered list"],
  ["❝", "blockquote", "Quote"],
  "|",
  ["link", "link", "Link"],
  ["Tx", "removeFormat", "Clear formatting"],
];

/** Recipients as chips: Enter, comma or semicolon adds one; a bad address is marked as it is typed. */
function Recipients({ id, label, list, onChange, bad, right }: { id: string; label: string; list: string[]; onChange: (v: string[]) => void; bad?: boolean; right?: React.ReactNode }) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.replace(/[,;\s]+$/, "").trim();
    if (v) onChange([...list, v]);
    setText("");
  };
  return (
    <div className={cn("flex min-h-[42px] flex-wrap items-center gap-2 border-b py-1.5", bad ? "border-destructive" : "border-border")}>
      <InlineLabel htmlFor={id} className="w-[58px] flex-none text-[12px] font-semibold text-subtle-foreground">{label}</InlineLabel>
      {list.map((a, i) => (
        <span key={a + i} className={cn("inline-flex h-[26px] items-center gap-[5px] rounded-full pr-1 pl-2.5 text-[12.5px]", EMAIL.test(a) ? "bg-accent" : "bg-destructive-soft text-destructive")} title={EMAIL.test(a) ? undefined : "Not an email address"}>
          {a}
          <button type="button" aria-label={`Remove ${a}`} className="flex size-5 items-center justify-center rounded-full hover:bg-card" onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon name="x" className="size-3" /></button>
        </span>
      ))}
      <InlineInput
        id={id}
        className="h-[30px] min-w-[120px] flex-1 border-0 bg-transparent text-[13.5px] outline-none"
        placeholder={list.length ? "" : "name@example.com"}
        autoComplete="off"
        value={text}
        onChange={setText}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === ";") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !text && list.length) onChange(list.slice(0, -1));
        }}
      />
      {right}
    </div>
  );
}

/** Next 08:00 tomorrow and next Monday, Lagos time. */
function quickTimes() {
  const day = (offset: number) => todayIso(new Date(Date.now() + offset * 86400000));
  const today = new Date(`${todayIso()}T12:00:00+01:00`);
  const toMonday = (8 - today.getUTCDay()) % 7 || 7;
  return { tomorrow: day(1), monday: day(toMonday) };
}

/**
 * The composer: From, To, Cc, Bcc, Subject, rich text body, attachments with
 * progress, send now or schedule, discard inline. Saves the draft as it is typed.
 */
export function Composer({ from, init, close }: { from: string; init: ComposeInit; close: () => void }) {
  const draftId = useMemo(() => init.draft_id ?? crypto.randomUUID(), [init.draft_id]);
  const sendKey = useMemo(() => crypto.randomUUID(), []);
  const [to, setTo] = useState(init.to ?? []);
  const [cc, setCc] = useState(init.cc ?? []);
  const [bcc, setBcc] = useState(init.bcc ?? []);
  const [showCc, setShowCc] = useState(!!(init.cc?.length || init.bcc?.length));
  const [subject, setSubject] = useState(init.subject ?? "");
  const [files, setFiles] = useState<MailAttachment[]>(init.attachments ?? []);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [stored, setStored] = useState(!!init.draft_id);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [linkBad, setLinkBad] = useState(false);
  const [sched, setSched] = useState<{ open: boolean; date: string; time: string; tried: boolean; past: boolean }>({ open: false, date: "", time: "", tried: false, past: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [toBad, setToBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const rte = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const dirty = useRef(0);

  useEffect(() => {
    if (rte.current && init.body_html) rte.current.innerHTML = init.body_html;
  }, [init.body_html]);

  const payload = (): MailDraftSave => ({ to, cc, bcc, subject, body_html: rte.current?.innerHTML ?? "", attachment_ids: files.map((f) => f.attachment_id) });

  /* Autosave 700 ms after the last change. */
  const [tick, setTick] = useState(0);
  const touch = () => setTick((t) => t + 1);
  useEffect(() => {
    if (!tick) return;
    const n = ++dirty.current;
    const x = setTimeout(async () => {
      setSaved("saving");
      try {
        await api.call("PUT /api/v1/mailbox/drafts/:id", { params: { id: draftId }, body: payload() });
        setStored(true);
        if (n === dirty.current) setSaved("saved");
      } catch {
        setSaved("idle");
      }
    }, 700);
    return () => clearTimeout(x);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the payload is read at save time
  }, [tick, to, cc, bcc, subject, files]);

  const keep = () => {
    const s = window.getSelection();
    if (s?.rangeCount && rte.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0);
  };
  const restore = () => {
    rte.current?.focus();
    const s = window.getSelection();
    if (range.current && s) {
      s.removeAllRanges();
      s.addRange(range.current);
    }
  };
  const run = (cmd: string) => {
    if (cmd === "link") return (setLinkOpen((o) => !o), setLinkBad(false));
    restore();
    /* execCommand is deprecated but still the one cross-browser way to format a contentEditable. */
    if (cmd === "h2" || cmd === "blockquote") document.execCommand("formatBlock", false, cmd);
    else document.execCommand(cmd, false);
    touch();
  };
  const addLink = () => {
    const u = link.trim();
    if (!/^(https:\/\/|mailto:)/.test(u)) return setLinkBad(true);
    restore();
    document.execCommand("createLink", false, u);
    setLinkOpen(false);
    setLink("");
    touch();
  };

  const send = async (release_at?: string) => {
    if (!to.length) {
      setToBad(true);
      toast("Add at least one recipient");
      return document.getElementById("mto")?.focus();
    }
    const bad = [...to, ...cc, ...bcc].find((a) => !EMAIL.test(a));
    if (bad) return toast(`${bad} is not an email address`);
    setBusy(true);
    try {
      await api.call("POST /api/v1/mailbox/messages", { body: { ...payload(), subject: subject.trim(), ...(stored && { draft_id: draftId }), ...(release_at && { release_at }) }, idempotencyKey: sendKey });
      invalidate("/api/v1/mailbox");
      close();
      toast(release_at ? `Scheduled for ${formatDate(release_at.slice(0, 10))} ${release_at.slice(11, 16)}` : `Sent to ${to.join(", ")}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.fields?.release_at) setSched((s) => ({ ...s, past: true }));
      else toast(e instanceof ApiError ? e.message : "Could not send");
    }
  };
  const at = (date: string, hm: string) => `${date}T${hm}:00+01:00`;
  const schedule = () => {
    const okT = /^([01]\d|2[0-3]):[0-5]\d$/.test(sched.time);
    setSched((s) => ({ ...s, tried: true, past: false }));
    if (!sched.date || !okT) return;
    if (new Date(at(sched.date, sched.time)).getTime() <= Date.now()) return setSched((s) => ({ ...s, past: true }));
    void send(at(sched.date, sched.time));
  };
  const discard = async () => {
    if (stored) await api.call("DELETE /api/v1/mailbox/drafts/:id", { params: { id: draftId } }).catch(() => null);
    invalidate("/api/v1/mailbox");
    close();
    toast("Draft discarded");
  };
  const q = quickTimes();
  const timeBad = sched.tried && !/^([01]\d|2[0-3]):[0-5]\d$/.test(sched.time);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex min-h-[42px] items-center gap-2 border-b border-border py-1.5">
        <InlineLabel htmlFor="mfrom" className="w-[58px] flex-none text-[12px] font-semibold text-subtle-foreground">From</InlineLabel>
        <InlineSelect id="mfrom" className="h-[30px] rounded-ctl border border-border bg-background px-2 text-[13px]" value={from} onChange={() => undefined} options={[from]} />
      </div>
      <Recipients id="mto" label="To" list={to} onChange={(v) => (setTo(v), setToBad(false), touch())} bad={toBad} right={!showCc && <button type="button" className="text-[12px] font-semibold text-accent-foreground" onClick={() => setShowCc(true)}>Cc Bcc</button>} />
      {showCc && <Recipients id="mcc" label="Cc" list={cc} onChange={(v) => (setCc(v), touch())} />}
      {showCc && <Recipients id="mbcc" label="Bcc" list={bcc} onChange={(v) => (setBcc(v), touch())} />}
      <div className="flex min-h-[42px] items-center gap-2 border-b border-border py-1.5">
        <InlineLabel htmlFor="msub" className="w-[58px] flex-none text-[12px] font-semibold text-subtle-foreground">Subject</InlineLabel>
        <InlineInput id="msub" className="h-[30px] min-w-0 flex-1 border-0 bg-transparent text-[13.5px] outline-none" value={subject} onChange={(v) => (setSubject(v), touch())} />
      </div>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border py-[7px]" role="toolbar" aria-label="Formatting">
        {TOOLS.map((t, i) =>
          t === "|" ? <span key={i} className="mx-1 h-[18px] w-px bg-border" /> : (
            <button key={t[1]} type="button" title={t[2]} aria-label={t[2]} onMouseDown={(e) => e.preventDefault()} onClick={() => run(t[1])} className={cn("flex h-[30px] min-w-[30px] items-center justify-center rounded-[7px] px-1.5 text-[13px] font-[650] text-muted-foreground hover:bg-accent hover:text-foreground", t[3], t[1] === "link" && linkOpen && "bg-accent text-foreground")}>
              {t[0] === "link" ? <Icon name="link" /> : t[0]}
            </button>
          ),
        )}
        <Upload
          purpose="mail"
          endpoint="/api/v1/mailbox/attachments"
          onUploaded={(docs) => (setFiles((f) => [...f, ...docs.map((d) => ({ ...d, attachment_id: (d as MailAttachment).attachment_id ?? d.document_id }))]), touch())}
          trigger={(open) => (
            <button type="button" title="Attach a file" aria-label="Attach a file" onMouseDown={(e) => e.preventDefault()} onClick={open} className="flex h-[30px] min-w-[30px] items-center justify-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"><Icon name="clip" /></button>
          )}
        />
        {linkOpen && (
          <span className="flex basis-full items-center gap-1.5 pt-1.5">
            <InlineInput autoFocus className={cn("h-[30px] min-w-0 flex-1 rounded-ctl border bg-background px-2.5 text-[13px] outline-none", linkBad ? "border-destructive" : "border-input focus:border-ring")} placeholder="https://" aria-label="Link address" value={link} onChange={(v) => (setLink(v), setLinkBad(false))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLink())} />
            <Button size="sm" onClick={addLink}>Add Link</Button>
            {linkBad && <span className="text-[11.5px] text-destructive">Starts with https:// or mailto:</span>}
          </span>
        )}
      </div>
      <div
        ref={rte}
        className="rte min-h-[220px] flex-1 px-0.5 py-3 text-[13.5px] leading-[1.6] outline-none"
        contentEditable
        suppressContentEditableWarning
        data-ph="Write your message"
        role="textbox"
        aria-multiline="true"
        aria-label="Message body"
        onInput={touch}
        onKeyUp={keep}
        onMouseUp={keep}
        onBlur={keep}
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {files.map((f) => (
            <span key={f.attachment_id} className="flex items-center gap-[7px] rounded-[9px] border border-border bg-muted px-[11px] py-[7px] text-[12px] font-[550]">
              <Icon name="doc" />{f.file_name}<span className="text-[11.5px] text-subtle-foreground">{formatBytes(f.size_bytes)}</span>
              <button type="button" aria-label={`Remove ${f.file_name}`} className="flex size-5 items-center justify-center rounded-full hover:bg-card" onClick={() => (setFiles((x) => x.filter((y) => y.attachment_id !== f.attachment_id)), touch())}><Icon name="x" className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      {sched.open && (
        <div className="mt-3 rounded-xl border border-border bg-muted p-3">
          <h3 className="mb-2 flex items-center gap-[7px] text-[13.5px] font-semibold"><Icon name="clock" />Schedule Send</h3>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2.5 max-md:grid-cols-2">
            <Field label="Date" state={sched.tried && !sched.date ? "bad" : undefined} message={sched.tried && !sched.date ? "A real date, today or later" : undefined} className="mb-0">
              <DateField value={sched.date} onChange={(v) => setSched((s) => ({ ...s, date: v, past: false }))} min={todayIso()} />
            </Field>
            <Field label="Time (24 Hour)" htmlFor="stime" state={timeBad ? "bad" : undefined} message={timeBad ? "HH:MM, in Lagos time" : undefined} className="mb-0">
              <Input id="stime" inputMode="numeric" autoComplete="off" placeholder="08:30" state={timeBad ? "bad" : undefined} value={sched.time} onChange={(v) => setSched((s) => ({ ...s, time: v.trim(), past: false }))} />
            </Field>
            <div className="flex justify-end gap-2 max-md:col-span-2">
              <Button onClick={() => setSched((s) => ({ ...s, open: false }))}>Cancel</Button>
              <Button variant="primary" icon="clock" disabled={busy} onClick={schedule}>Schedule</Button>
            </div>
          </div>
          {sched.past && <p className="mt-2 text-[11.5px] text-destructive">That time has already passed.</p>}
        </div>
      )}
      <div className="sticky -bottom-4 z-[1] -mx-[18px] mt-3 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-[18px] py-3 max-md:pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
        {confirmDiscard ? (
          <>
            <span className="mr-auto text-[12.5px]">Discard this draft and its attachments?</span>
            <Button onClick={() => setConfirmDiscard(false)}>Keep Editing</Button>
            <Button variant="primary" onClick={discard}>Discard</Button>
          </>
        ) : (
          <>
            <span className="mr-auto">{saved === "saved" ? <Pill>Draft saved</Pill> : saved === "saving" ? <span className="text-[11.5px] text-subtle-foreground">Saving…</span> : null}</span>
            <Button onClick={() => setConfirmDiscard(true)}>Discard</Button>
            <Menu
              trigger={(p) => <Button {...p} icon="clock">Schedule</Button>}
              items={[
                { label: `Tomorrow, ${formatDate(q.tomorrow).slice(0, 5)} at 08:00`, icon: "clock", onSelect: () => void send(at(q.tomorrow, "08:00")) },
                { label: `Monday, ${formatDate(q.monday).slice(0, 5)} at 08:00`, icon: "clock", onSelect: () => void send(at(q.monday, "08:00")) },
                "sep",
                { label: "Pick Date and Time", icon: "check", onSelect: () => setSched((s) => ({ ...s, open: true })) },
              ]}
            />
            <Button variant="primary" icon="send" disabled={busy} onClick={() => void send()}>Send</Button>
          </>
        )}
      </div>
    </div>
  );
}
