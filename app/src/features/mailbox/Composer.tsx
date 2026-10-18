import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate } from "@/api/hooks";
import type { MailDraftSave } from "@/api/types/mailbox";
import type { DocumentRef } from "@/api/types/common";
import { Button, cn, DateField, Field, formatBytes, formatDate, Icon, InlineInput, InlineLabel, InlineSelect, Menu, Pill, RichTextField, TextField, toast, todayIso, Tooltip, UploadField } from "@mycity/ui";
import { upload } from "@/api/upload";

export interface ComposeInit {
  draft_id?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_html?: string;
  attachments?: DocumentRef[];
  in_reply_to?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;


/** Recipients as chips: Enter, comma or semicolon adds one; a bad address is marked as it is typed. */
function Recipients({ id, label, list, onChange, bad, error, right }: { id: string; label: string; list: string[]; onChange: (v: string[]) => void; bad?: boolean; error?: string | null; right?: React.ReactNode }) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.replace(/[,;\s]+$/, "").trim();
    if (v) onChange([...list, v]);
    setText("");
  };
  return (
    <div className={cn("flex min-h-10.5 flex-wrap items-center gap-2 border-b py-1.5", bad ? "border-destructive" : "border-border")}>
      <InlineLabel htmlFor={id} className="w-14 flex-none text-xs font-semibold text-subtle-foreground">{label}</InlineLabel>
      {list.map((a, i) => (
        <span key={a + i} className={cn("inline-flex h-6.5 items-center gap-1 rounded-full pr-1 pl-2.5 text-xs", EMAIL.test(a) ? "bg-accent" : "bg-destructive-soft text-destructive")}>
          {EMAIL.test(a) ? a : <Tooltip label="Not an Email"><span>{a}</span></Tooltip>}
          <button type="button" aria-label={`Remove ${a}`} className="flex size-5 items-center justify-center rounded-full hover:bg-card" onClick={() => onChange(list.filter((_, j) => j !== i))}><Icon name="x" className="size-3" /></button>
        </span>
      ))}
      <InlineInput
        id={id}
        className="h-7.5 min-w-30 flex-1 border-0 bg-transparent text-sm outline-none"
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
      {error && <span role="alert" className="text-2xs font-semibold text-destructive">{error}</span>}
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
  const [files, setFiles] = useState<DocumentRef[]>(init.attachments ?? []);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [stored, setStored] = useState(!!init.draft_id);
  const [sched, setSched] = useState<{ open: boolean; date: string; time: string; tried: boolean; past: boolean }>({ open: false, date: "", time: "", tried: false, past: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [toBad, setToBad] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState(init.body_html ?? "");
  const dirty = useRef(0);

  const payload = (): MailDraftSave => ({ to_addresses: to, cc_addresses: cc, bcc_addresses: bcc, subject, body_html: body, document_ids: files.map((f) => f.document_id), in_reply_to: init.in_reply_to ?? null });

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
  }, [tick, to, cc, bcc, subject, body, files]);

  const send = async (release_at?: string) => {
    if (!to.length || [...to, ...cc, ...bcc].some((a) => !EMAIL.test(a))) {
      setToBad(to.length ? "Not an email address" : "Add a recipient");
      return document.getElementById("mto")?.focus();
    }
    setBusy(true);
    try {
      await api.call("POST /api/v1/mailbox/messages", { body: { ...payload(), subject: subject.trim(), mail_draft_id: draftId, ...(release_at && { release_at }) }, idempotencyKey: sendKey });
      invalidate("/api/v1/mailbox");
      close();
      toast(release_at ? `Scheduled for ${formatDate(release_at.slice(0, 10))} ${release_at.slice(11, 16)}` : `Sent to ${to.join(", ")}`);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.fields?.release_at) setSched((s) => ({ ...s, open: true, past: true }));
      else if (e instanceof ApiError && e.fields?.to_addresses) setToBad("Not an email address");
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
      <div className="flex min-h-10.5 items-center gap-2 border-b border-border py-1.5">
        <InlineLabel htmlFor="mfrom" className="w-14 flex-none text-xs font-semibold text-subtle-foreground">From</InlineLabel>
        <InlineSelect id="mfrom" className="h-7.5 rounded-ctl border border-border bg-background px-2 text-sm" value={from} onChange={() => undefined} options={[from]} />
      </div>
      <Recipients id="mto" label="To" list={to} onChange={(v) => (setTo(v), setToBad(null), touch())} bad={!!toBad} error={toBad} right={!showCc && <button type="button" className="text-xs font-semibold text-accent-foreground" onClick={() => setShowCc(true)}>Cc Bcc</button>} />
      {showCc && <Recipients id="mcc" label="Cc" list={cc} onChange={(v) => (setCc(v), touch())} />}
      {showCc && <Recipients id="mbcc" label="Bcc" list={bcc} onChange={(v) => (setBcc(v), touch())} />}
      <div className="flex min-h-10.5 items-center gap-2 border-b border-border py-1.5">
        <InlineLabel htmlFor="msub" className="w-14 flex-none text-xs font-semibold text-subtle-foreground">Subject</InlineLabel>
        <InlineInput id="msub" className="h-7.5 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" value={subject} onChange={(v) => (setSubject(v), touch())} />
      </div>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border py-1.5">
        <UploadField
          upload={upload}
          purpose="mail"
          endpoint="/api/v1/mailbox/attachments"
          onUploaded={(docs) => (setFiles((f) => [...f, ...docs]), touch())}
          trigger={(open) => (
            <Tooltip label="Attach File"><button type="button" aria-label="Attach a file" onMouseDown={(e) => e.preventDefault()} onClick={open} className="flex h-7.5 min-w-7.5 items-center justify-center rounded-ctl text-muted-foreground hover:bg-accent hover:text-foreground"><Icon name="clip" /></button></Tooltip>
          )}
        />
      </div>
      <RichTextField
        label="Message Body"
        placeholder="Your message"
        value={body}
        onChange={(html) => {
          setBody(html);
          touch();
        }}
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {files.map((f) => (
            <span key={f.document_id} className="flex items-center gap-1.5 rounded-ctl border border-border bg-muted px-2.5 py-1.5 text-xs font-semibold">
              <Icon name="doc" />{f.file_name}<span className="text-2xs text-subtle-foreground">{formatBytes(f.size_bytes)}</span>
              <button type="button" aria-label={`Remove ${f.file_name}`} className="flex size-5 items-center justify-center rounded-full hover:bg-card" onClick={() => (setFiles((x) => x.filter((y) => y.document_id !== f.document_id)), touch())}><Icon name="x" className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      {sched.open && (
        <div className="mt-3 rounded-xl border border-border bg-muted p-3">
          <h3 data-ui="title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Icon name="clock" />Schedule Send</h3>
          <div className="grid cols-two-and-action items-end gap-2.5 max-md:grid-cols-2">
            <Field label="Send Date" state={sched.tried && !sched.date ? "bad" : undefined} message={sched.tried && !sched.date ? "Not a real date" : undefined} className="mb-0">
              <DateField value={sched.date} onChange={(v) => setSched((s) => ({ ...s, date: v, past: false }))} min={todayIso()} />
            </Field>
            <Field label="Send Time" help="Lagos time, on the 24 hour clock: 08:30, 17:45." htmlFor="stime" state={timeBad || sched.past ? "bad" : undefined} message={timeBad ? "Not a valid time" : sched.past ? "Time already passed" : undefined} className="mb-0">
              <TextField id="stime" inputMode="numeric" autoComplete="off" placeholder="HH:MM" state={timeBad || sched.past ? "bad" : undefined} value={sched.time} onChange={(v) => setSched((s) => ({ ...s, time: v.trim(), past: false }))} />
            </Field>
            <div className="flex justify-end gap-2 max-md:col-span-2">
              <Button onClick={() => setSched((s) => ({ ...s, open: false }))}>Cancel</Button>
              <Button variant="primary" icon="clock" busy={busy} onClick={schedule}>Schedule Send</Button>
            </div>
          </div>
        </div>
      )}
      <div className="sticky -bottom-4 z-1 -mx-4.5 mt-3 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-4.5 py-3 max-md:pb-safe-3">
        {confirmDiscard ? (
          <>
            <Button onClick={() => setConfirmDiscard(false)}>Keep Editing</Button>
            <Button variant="danger" icon="x" onClick={discard}>Discard Draft</Button>
          </>
        ) : (
          <>
            <span className="mr-auto">{saved === "saved" ? <Pill>Draft saved</Pill> : saved === "saving" ? <span className="text-2xs text-subtle-foreground">Saving…</span> : null}</span>
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
            <Button variant="primary" icon="send" busy={busy} onClick={() => void send()}>Send</Button>
          </>
        )}
      </div>
    </div>
  );
}
