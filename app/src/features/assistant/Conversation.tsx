import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { useApi, useInfinite } from "@/api/hooks";
import { useRealtime } from "@/api/realtime";
import { upload } from "@/api/upload";
import type { AiAnswer, AiFeedbackValue, AiScreenContext, AiShows, AiTranscript } from "@mycity/contract/contract.gen.ts";
import { useRouter } from "@/lib/router";
import { AnswerBubble, Button, DataView, EmptyState, ErrorState, Form, Icon, IconButton, InlineInput, LoadingRows, ProgressLine, QuestionBubble, SourceChip, TapList, toast, VoiceField, type DataViewColumn } from "@mycity/ui";
import { pickForSource, type PanePick } from "./Pane";

/** Praxis AI's conversation (docs/guides/praxis-ai.md §10): what is asked, what came back, and the box. */

/** What Show Next 25 asks, as a follow-up in the same conversation (§11). */
const NEXT_PAGE = "Show the next 25.";
/** The longest question the contract takes (AiAsk), typed or spoken. */
const QUESTION_MAX = 500;

/** The question waiting for its answer, or the one that failed. Try Again sends it with the same key (§11). */
type Pending = { question: string; key: string; error: string | null; reference?: string };

/** What the server says it is reading while a question runs (`ai:progress`, decision 23). */
type Progress = { words: string; step: { n: number; of: number } };

/** Refusals asking again cannot help (AI off, the module's AI off, an answer that could not be used): the words go back to the box. */
const FINAL = new Set(["AI_DISABLED", "AI_MODULE_DISABLED", "AI_BAD_OUTPUT"]);

/** A spoken question to words: one request through the upload engine; the recording is not kept (§6.6). */
async function transcribe(audio: Blob): Promise<string> {
  const type = audio.type || "audio/webm";
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  const reply = (await upload({ endpoint: "/api/v1/ai/transcribe", file: new File([audio], `question.${ext}`, { type }), fields: { purpose: "voice_note" } })) as unknown as AiTranscript;
  // A draft is a placeholder, not the person's words (no voice model is set up): nothing lands in the box.
  if (reply.draft) throw new ApiError(422, { error: { code: "NOT_SET_UP", message: "Transcription is not set up" } } as never);
  if (!reply.text.trim()) throw new ApiError(422, { error: { code: "NO_WORDS", message: "No words heard" } } as never);
  return reply.text.trim();
}

export interface ConversationProps {
  /** The conversation shown; null is a new one. */
  id: string | null;
  /** The screen the question is asked from (decision 12), sent with every question. */
  context?: AiScreenContext | null;
  /** What this screen can draw: the pane, and (PR4 of the Praxis AI Engine) cards. */
  shows?: AiShows[];
  /** A first answer opened its conversation: the parent moves the address there. */
  onOpened: (id: string) => void;
  /** The conversation is gone (deleted elsewhere): the parent starts a new one. */
  onGone: () => void;
  /** An answer landed: the parent refreshes Recent and History, and shows the answer's pane. */
  onAnswered: (answer: AiAnswer) => void;
  /** Shows an answer's pane (Open Figures, a source chip): the right pane on desktop, the sheet on a phone. */
  onPane?: (answer: AiAnswer, pick?: PanePick) => void;
  /** The answer whose pane is shown now, drawn in the accent. */
  paneFor?: string | null;
}

/**
 * One conversation: its turns, the question waiting with what is being read, and the box with the
 * microphone and Send. The full-screen Praxis AI shows it beside the pane; the phone's floating
 * button shows it over any screen (AskPanel). The parent holds which conversation it is and lays it
 * out as a column it fills.
 */
export function Conversation({ id, context = null, shows = [], onOpened, onGone, onAnswered, onPane, paneFor = null }: ConversationProps) {
  const formId = useId();
  const turns = useInfinite("GET /api/v1/ai/conversations/:id/turns", { params: { id: id ?? "" }, enabled: Boolean(id) });
  const suggestions = useApi("GET /api/v1/ai/suggestions", { enabled: !id });
  /* Answers given on this screen, shown at once; the saved page catches up behind them. */
  const [given, setGiven] = useState<AiAnswer[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Record<string, AiFeedbackValue | null>>({});
  const asking = useRef(false);
  /* The key of the question being answered: a progress event for any other question is not this screen's. */
  const askKey = useRef<string | null>(null);
  /* The question being answered: Send pressed meanwhile waits on it, spinning, with the words kept in the box. */
  const inflight = useRef<Promise<void> | null>(null);
  /* The conversation this screen is showing: an answer that opens one moves the address here, without starting over. */
  const showing = useRef(id);
  /* Counts the times the person moved to another conversation: an answer asked before the last move is not shown. */
  const moves = useRef(0);
  /* Whether the screen is still open: an answer that lands after the person left changes nothing here. */
  const live = useRef(true);
  /* The latest callbacks and context, for an answer that lands after a render or two. */
  const calls = useRef({ onOpened, onGone, onAnswered, context, shows });
  calls.current = { onOpened, onGone, onAnswered, context, shows };
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (id === showing.current) return;
    showing.current = id;
    moves.current += 1;
    asking.current = false;
    askKey.current = null;
    setGiven([]);
    setPending(null);
    setProgress(null);
  }, [id]);

  // Progress over realtime (decision 23): what is being read for this question, dropped when the answer lands.
  useRealtime("ai:progress", (payload) => {
    const p = payload as { ask_key?: unknown; n?: unknown; of?: unknown; words?: unknown } | null;
    if (!p || !askKey.current || p.ask_key !== askKey.current) return;
    setProgress({ words: typeof p.words === "string" ? p.words : "", step: { n: Number(p.n) || 1, of: Number(p.of) || 5 } });
  });

  // Deleted in another tab, or not the person's: a new conversation instead of an empty pane (§11).
  const gone = Boolean(id) && turns.error?.status === 404;
  useEffect(() => {
    if (!gone) return;
    toast("That conversation was deleted");
    calls.current.onGone();
  }, [gone]);

  const answers = useMemo(() => {
    const saved = [...turns.rows].reverse();
    const seen = new Set(saved.map((a) => a.ai_message_id));
    return [...saved, ...given.filter((a) => !seen.has(a.ai_message_id))];
  }, [turns.rows, given]);
  const newest = answers.at(-1)?.ai_message_id;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [newest, pending, progress]);

  const ask = (words: string, key: string = crypto.randomUUID()): Promise<void> | undefined => {
    if (asking.current) return inflight.current ?? undefined;
    const work = asked(words, key);
    inflight.current = work;
    return work;
  };

  const asked = async (words: string, key: string) => {
    const question = words.trim();
    if (!question) return;
    const from = showing.current;
    const move = moves.current;
    /** Still where this question was asked: the screen open and no other conversation picked since (an answer opening its own conversation is not a move). */
    const here = () => live.current && moves.current === move;
    asking.current = true;
    askKey.current = key;
    setPending({ question, key, error: null });
    setProgress(null);
    const { context: ctx, shows: draws } = calls.current;
    try {
      const a = await api.call("POST /api/v1/ai/ask", {
        body: { question, ...(from ? { ai_conversation_id: from } : {}), ...(ctx ? { context: ctx } : {}), shows: draws },
        idempotencyKey: key,
      });
      calls.current.onAnswered(a);
      if (!here()) return;
      setGiven((g) => [...g, a]);
      setPending(null);
      if (a.ai_conversation_id !== from) {
        showing.current = a.ai_conversation_id;
        calls.current.onOpened(a.ai_conversation_id);
      }
    } catch (e) {
      if (!here()) return;
      const err = e instanceof ApiError ? e : new ApiError(0, null);
      if (err.status === 404 && from) {
        // Deleted in another tab: a new conversation, with the question back in the box.
        showing.current = null;
        setGiven([]);
        setPending(null);
        setText(question);
        calls.current.onGone();
        toast("That conversation was deleted");
      } else if ((err.status >= 400 && err.status < 500 && err.status !== 409) || FINAL.has(err.code)) {
        // Asking again would be refused the same way: the words go back to the box to change.
        setPending(null);
        setText(question);
        toast.error(err.fields?.question?.[0] ?? err.message);
      } else {
        setPending({ question, key, error: err.message || "Could not reach the server", reference: err.reference });
      }
    } finally {
      if (here()) {
        asking.current = false;
        askKey.current = null;
        setProgress(null);
      }
    }
  };

  /** Send what is in the box: it empties only when the question goes. While an answer is coming it waits on it. */
  const send = () => {
    if (asking.current) return inflight.current ?? undefined;
    if (!text.trim()) return;
    const words = text;
    setText("");
    return ask(words);
  };

  const give = async (a: AiAnswer, value: AiFeedbackValue | null) => {
    try {
      await api.call("POST /api/v1/ai/answers/:id/feedback", { params: { id: a.ai_message_id }, body: { feedback: value } });
      setFeedback((f) => ({ ...f, [a.ai_message_id]: value }));
      if (value) toast("Thanks for the feedback");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // Its conversation was deleted in another tab: a new one, as on any other refusal of a deleted conversation.
        toast("That conversation was deleted");
        calls.current.onGone();
      } else toast.error(e instanceof ApiError ? e.message : "Could not reach the server");
    }
  };

  const empty = !id && answers.length === 0 && !pending;
  const offered = suggestions.data?.questions ?? [];

  return (
    <>
      <div role="log" aria-label="Conversation" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 max-md:p-3">
        {empty ? (
          <div className="m-auto flex w-full max-w-120 flex-col gap-3">
            {/* A section of the page beside the pane, and on a phone straight under its title: a second-level heading. */}
            <EmptyState bare level={2} illustration="FirstRun" title={offered.length ? "Try Asking" : "Ask a Question"} />
            {suggestions.loading && <LoadingRows count={3} />}
            {offered.length > 0 && (
              <div data-copy="content">
                <TapList label="Try Asking" items={offered.map((q) => ({ key: q, title: q, onSelect: () => ask(q) }))} />
              </div>
            )}
          </div>
        ) : (
          <>
            {id && turns.rows.length > 0 && turns.page?.has_next && (
              <Button size="sm" variant="ghost" className="self-center" busy={turns.loading} onClick={turns.more}>
                Show Earlier
              </Button>
            )}
            {id && turns.loading && answers.length === 0 && <LoadingRows count={3} />}
            {id && turns.error && !gone && answers.length === 0 && <ErrorState error={turns.error} onRetry={turns.reload} />}
            {answers.map((a) => (
              <div key={a.ai_message_id} className="flex flex-col gap-3.5">
                <QuestionBubble words={a.question} />
                <Answer
                  a={a}
                  feedback={a.ai_message_id in feedback ? feedback[a.ai_message_id] : a.feedback}
                  onFeedback={(value) => give(a, value)}
                  onNext={a.more && a.ai_message_id === newest && !pending ? () => ask(NEXT_PAGE) : undefined}
                  onPane={onPane}
                  paneOpen={paneFor === a.ai_message_id}
                />
              </div>
            ))}
            {pending && (
              <div className="flex flex-col gap-3.5">
                <QuestionBubble words={pending.question} />
                {pending.error ? (
                  <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                    <Icon name="alert" size="s" />
                    {pending.error}
                    {pending.reference && <span data-copy="content">Reference {pending.reference}</span>}
                    <Button size="sm" onClick={() => ask(pending.question, pending.key)}>
                      Try Again
                    </Button>
                  </div>
                ) : (
                  <ProgressLine words={progress?.words || null} step={progress?.step ?? null} />
                )}
              </div>
            )}
          </>
        )}
        <div ref={end} />
      </div>
      {/* The microphone sits outside the form, so a question being sent never holds its Stop. */}
      <div className="flex flex-none items-center gap-1.5 border-t border-border p-3 max-md:p-2">
        <Form id={formId} onSubmit={send} className="min-w-0 flex-1">
          <InlineInput
            className="h-control w-full min-w-0 rounded-full border border-input bg-background px-4 text-sm outline-none focus:border-ring phone:text-base"
            placeholder="Ask a question"
            aria-label="Ask a Question"
            maxLength={QUESTION_MAX}
            value={text}
            onChange={setText}
          />
        </Form>
        <VoiceField compact label="Question" transcribe={transcribe} onTranscript={(words) => setText((t) => (t.trim() ? `${t.trim()} ${words}` : words).slice(0, QUESTION_MAX))} />
        <IconButton type="submit" form={formId} icon="send" label="Send" className="on-primary rounded-full bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" />
      </div>
    </>
  );
}

/** Where the answer's table rows sit in the whole list: "Showing 25 of 312", "Showing 26 to 50 of 312". */
function pagingOf(a: AiAnswer): string | null {
  if (!a.table?.rows.length) return null;
  const read = (a.table.read ? a.reads.find((r) => r.n === a.table!.read) : undefined) ?? a.reads.find((r) => r.rows === a.table!.rows.length && r.total != null && r.total > r.rows);
  if (!read || read.total == null || read.total <= read.rows) return null;
  const from = read.first ?? null;
  return from && from > 1 ? `Showing ${from} to ${from + read.rows - 1} of ${read.total}` : `Showing ${read.rows} of ${read.total}`;
}

function Answer({ a, feedback, onFeedback, onNext, onPane, paneOpen }: { a: AiAnswer; feedback: AiFeedbackValue | null; onFeedback: (value: AiFeedbackValue | null) => Promise<void>; onNext?: () => Promise<void> | undefined; onPane?: (answer: AiAnswer, pick?: PanePick) => void; paneOpen: boolean }) {
  const { navigate } = useRouter();
  // Kinds of record with how many (decision 9); the one record, named, when the answer rests on one. A chip opens the pane on them.
  const from = a.sources.map((s) =>
    s.kind === "record" ? (
      <SourceChip
        key={`record:${s.entity_type}`}
        kind="record"
        label={s.label}
        onSelect={onPane ? () => onPane(a, { tab: "record", record: { title: s.label, items: [], link: s.link } }) : s.link ? () => navigate(s.link!) : undefined}
      />
    ) : (
      <SourceChip key={`type:${s.entity_type}`} label={s.label} count={s.count} onSelect={onPane ? () => onPane(a, pickForSource(a, s.entity_type)) : undefined} />
    ),
  );
  return (
    <AnswerBubble
      text={a.content}
      table={a.table ? <AnswerTable a={a} /> : undefined}
      paging={pagingOf(a)}
      onNext={onNext}
      link={a.link ? { label: a.link.label, onOpen: () => navigate(a.link!.path) } : null}
      from={from.length ? from : undefined}
      onPane={onPane && (a.reads.length || a.overview) ? () => onPane(a) : undefined}
      paneOpen={paneOpen}
      feedback={feedback}
      onFeedback={onFeedback}
    />
  );
}

type Row = { key: string; cells: string[]; link: string | null };

/**
 * The answer's table, drawn from the rows its read returned (§6.4): a table on desktop, cards on a
 * phone. Each row opens its record when every row has one (a table of one kind of record).
 */
function AnswerTable({ a }: { a: AiAnswer }) {
  const { navigate } = useRouter();
  const t = a.table!;
  const rows: Row[] = t.rows.map((cells, i) => ({ key: String(i), cells, link: t.links[i] ?? null }));
  const columns: DataViewColumn<Row>[] = t.columns.map((label, i) => ({ key: `c${i}`, label, ...(t.numeric.includes(i) ? { align: "n" as const } : {}), render: (r) => r.cells[i] ?? "" }));
  const opens = rows.length > 0 && rows.every((r) => r.link);
  return (
    <div data-copy="content" className="-mx-3">
      <DataView<Row> bare rows={rows} columns={columns} rowKey={(r) => r.key} caption={a.question} onRowClick={opens ? (r) => navigate(r.link!) : undefined} />
    </div>
  );
}
