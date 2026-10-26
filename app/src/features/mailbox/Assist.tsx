/**
 * Write With AI and Summarise Thread (docs/guides/mailbox.md §1.1, §3 steps 12 to 14, §10): the AI
 * step inside the composer's own window, since modals never stack, and the Summary card above a
 * conversation. Nothing here keeps anything: Use Draft hands the draft to the composer, which saves
 * and sends it as if it had been typed.
 */
import { useEffect, useRef, useState } from "react";
import type { MailAssistRequest, ThreadSummary } from "@mycity/contract/contract.gen.ts";
import { api, ApiError } from "@/api/client";
import { upload } from "@/api/upload";
import { Button, Card, CardHeader, CheckboxField, ChoiceField, cn, EmailFrame, Field, Icon, IconButton, Skeleton, splitQuoted, TextAreaField, toast, useContractForm, VoiceField } from "@mycity/ui";

/** The person's own words, and the quoted mail under them that Reply and Forward put there. */
export function partsOf(html: string): { own: string; quoted: string } {
  /* A mark above the body, so the quotation folds even when nothing has been written over it yet. */
  const MARK = "<p>OWNWORDS</p>";
  const s = splitQuoted(MARK + html);
  if (s.quoted == null) return { own: html, quoted: "" };
  return { own: s.visible.startsWith(MARK) ? s.visible.slice(MARK.length) : s.visible, quoted: s.quoted };
}

/** Whether a piece of the composer's HTML holds any words. */
const hasWords = (html: string) => /\S/.test(html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " "));

/** Dictate: the recording goes up, is written down and removed on the server, and its words come back. */
export async function dictate(audio: Blob): Promise<string> {
  const type = audio.type || "audio/webm";
  const ext = /ogg/.test(type) ? "ogg" : /mp4|m4a|aac/.test(type) ? "m4a" : "webm";
  const doc = await upload({ endpoint: "/api/v1/mailbox/dictation", file: new File([audio], `dictation.${ext}`, { type }), fields: { purpose: "voice_note" } });
  const r = await api.call("POST /api/v1/mailbox/dictation/:id/transcript", { params: { id: doc.document_id }, body: {} });
  return r.text;
}

/** Words added to what a field already holds, as a dictation adds to a note. */
const added = (before: string, words: string) => (before.trim() ? `${before.trimEnd()} ${words}` : words);

export interface ComposeNow {
  in_reply_to: string | null;
  to: string[];
  cc: string[];
  subject: string;
  attachments: string[];
  /** The person's words and the quoted mail under them (partsOf). */
  own_html: string;
  quoted_html: string;
}

type Shown = { kind: "questions"; questions: string[] } | { kind: "draft"; body_html: string; subject: string | null } | null;

/**
 * The AI step (§3 step 12): Write from the conversation and What To Say, or Tidy Up the person's
 * words; the questions first when a fact only they know is missing; the draft in its own frame
 * with Try Again and Use Draft. It stays mounted while the composer is open, so Back keeps it.
 */
export function WriteWithAi({ compose, hidden, back, use }: { compose: ComposeNow; hidden: boolean; back: () => void; use: (draft: { body_html: string; subject: string | null }) => void }) {
  const ownWords = hasWords(compose.own_html);
  const isNew = !compose.in_reply_to && !hasWords(compose.quoted_html);
  const f = useContractForm(
    { mode: ownWords ? "tidy" : "write", instruction: "", with_note: false, note: "", a0: "", a1: "", a2: "" },
    {
      instruction: (v, all) =>
        String(v).length > 2000 ? "Too long" : all.mode === "write" && isNew && !String(v).trim() && !(all.with_note && String(all.note).trim()) ? "Say what to write" : null,
      note: (v) => (String(v).length > 4000 ? "Too long" : null),
    },
  );
  const v = f.values;
  const mode = ownWords ? (v.mode as "write" | "tidy") : "write";
  const [shown, setShown] = useState<Shown>(null);
  const [asked, setAsked] = useState<string[]>([]);
  const result = useRef<HTMLDivElement>(null);
  /* Opening the step moves focus to its title, so a keyboard or a screen reader starts there. */
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!hidden) title.current?.focus();
  }, [hidden]);
  useEffect(() => {
    if (shown) result.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [shown]);

  const answers = asked
    .map((question, i) => ({ question, answer: String(v[`a${i}` as "a0"] ?? "").trim() }))
    .filter((a) => a.answer);

  const ask = async (writeAnyway: boolean) => {
    if (!f.check()) return;
    const body: MailAssistRequest = {
      mode,
      in_reply_to: compose.in_reply_to,
      to_addresses: compose.to,
      cc_addresses: compose.cc,
      subject: compose.subject,
      attachment_names: compose.attachments,
      body_html: compose.own_html,
      quoted_html: compose.quoted_html,
      instruction: v.instruction.trim(),
      note: v.with_note ? v.note.trim() : "",
      answers,
      write_anyway: writeAnyway,
    };
    try {
      const r = await api.call("POST /api/v1/mailbox/assist", { body });
      if (!r.available) {
        toast("Write With AI is off");
        return;
      }
      if (r.kind === "questions") {
        setAsked(r.questions);
        setShown({ kind: "questions", questions: r.questions });
      } else setShown({ kind: "draft", body_html: r.body_html ?? "", subject: r.subject });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0) return void toast.error("Could not reach the server. Try again.");
      const drawn = ["instruction", "note"];
      if (Object.keys(e.fields).some((k) => drawn.includes(k))) f.setServerErrors(e.fields);
      // A refusal on what the step does not draw (nothing to write about, an answer) says why here.
      else toast.error(Object.values(e.fields)[0]?.[0] ?? e.message);
    }
  };

  const draft = shown?.kind === "draft" ? shown : null;
  const questions = shown?.kind === "questions" ? shown.questions : [];

  return (
    <div className={cn("min-h-full flex-col", hidden ? "hidden" : "flex")}>
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Button size="sm" variant="ghost" icon="left" onClick={back}>
          Back
        </Button>
        <h3 ref={title} tabIndex={-1} data-ui="title" className="flex items-center gap-1.5 text-sm font-semibold">
          <Icon name="spark" />
          Write With AI
        </h3>
      </div>
      <div className="flex flex-col gap-3 pt-3">
        {ownWords && (
          <ChoiceField
            label="Write or Tidy"
            value={mode}
            onChange={(m) => (f.set("mode", m), setShown(null))}
            options={[
              ["write", "Write"],
              ["tidy", "Tidy Up"],
            ]}
          />
        )}
        <Field label="What To Say" optional={!isNew || mode === "tidy"} help="A line on what the mail should say: agree, decline or ask, and the facts it needs." {...f.status("instruction")} className="mb-0">
          <TextAreaField {...f.field("instruction")} rows={3} />
          <VoiceField label="What To Say" action="Dictate" transcribe={dictate} onTranscript={(words) => f.set("instruction", added(v.instruction, words))} className="mt-2" />
        </Field>
        <CheckboxField label="Add a Note" value={Boolean(v.with_note)} onChange={(x) => f.set("with_note", x)} />
        {v.with_note && (
          <Field label="Note" optional {...f.status("note")} className="mb-0">
            <TextAreaField {...f.field("note")} rows={3} />
            <VoiceField label="Note" action="Dictate" transcribe={dictate} onTranscript={(words) => f.set("note", added(v.note, words))} className="mt-2" />
          </Field>
        )}
        <div ref={result} className="flex flex-col gap-3">
          {questions.map((q, i) => {
            const key = `a${i}` as "a0" | "a1" | "a2";
            return (
              <Field key={q} label={<span data-copy="content">{q}</span>} optional className="mb-0">
                <TextAreaField {...f.field(key)} rows={2} />
                <VoiceField label={`Answer ${i + 1}`} action="Dictate" transcribe={dictate} onTranscript={(words) => f.set(key, added(String(v[key]), words))} className="mt-2" />
              </Field>
            );
          })}
          {draft && (
            <div className="rounded-box border border-border p-3">
              {draft.subject && (
                <p className="mb-2 text-xs">
                  <span className="font-semibold text-subtle-foreground">Subject </span>
                  <span data-copy="content">{draft.subject}</span>
                </p>
              )}
              <EmailFrame title="Draft" html={draft.body_html} />
            </div>
          )}
        </div>
      </div>
      {/* One row on a phone: the primary takes the rest of the width (mailbox.md §10.2). */}
      <div className="sticky -bottom-4 z-1 -mx-4.5 mt-3 -mb-4 flex items-center justify-end gap-2 border-t border-border bg-card px-4.5 py-3 max-md:pb-safe-3">
        {draft ? (
          <>
            <Button icon="refresh" onClick={() => ask(true)}>
              Try Again
            </Button>
            <Button variant="primary" icon="ok" className="max-md:flex-1" onClick={() => use({ body_html: draft.body_html, subject: draft.subject })}>
              Use Draft
            </Button>
          </>
        ) : questions.length ? (
          <>
            <Button onClick={() => ask(true)}>Write Anyway</Button>
            <Button variant="primary" icon="spark" className="max-md:flex-1" onClick={() => ask(false)}>
              Write Draft
            </Button>
          </>
        ) : (
          <Button variant="primary" icon="spark" className="max-md:flex-1" onClick={() => ask(false)}>
            {mode === "tidy" ? "Tidy Email" : "Write Draft"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The summary as plain text, for Copy Summary. */
function textOf(s: ThreadSummary): string {
  const list = (title: string, items: string[]) => (items.length ? ["", title, ...items.map((x) => `- ${x}`)] : []);
  return [s.gist ?? "", ...list("Key Points", s.key_points), ...list("Asked of You", s.asked_of_you)].join("\n");
}

/** The Summary card above a conversation (§3 step 14): loading lines until it arrives. */
export function SummaryCard({ summary, close }: { summary: ThreadSummary | null; close: () => void }) {
  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(textOf(summary));
      toast("Summary copied");
    } catch {
      toast("Not copied. Try again.");
    }
  };
  return (
    <Card className="mt-3">
      <CardHeader
        title="Summary"
        level={3}
        help="Written by AI from this conversation. Check dates and amounts against the mail before acting."
        actions={
          <span className="flex items-center gap-1">
            <IconButton icon="copy" label="Copy Summary" onClick={copy} />
            <IconButton icon="x" label="Close Summary" onClick={close} />
          </span>
        }
      />
      <div aria-live="polite">
        {!summary ? (
          <Skeleton lines={4} />
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p data-copy="content">{summary.gist}</p>
            {summary.key_points.length > 0 && (
              <>
                <h4 data-ui="title" className="text-xs font-semibold text-subtle-foreground">
                  Key Points
                </h4>
                <ul data-copy="content" className="m-0 list-disc pl-5">
                  {summary.key_points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
            {summary.asked_of_you.length > 0 && (
              <>
                <h4 data-ui="title" className="text-xs font-semibold text-subtle-foreground">
                  Asked of You
                </h4>
                <ul data-copy="content" className="m-0 list-disc pl-5">
                  {summary.asked_of_you.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
