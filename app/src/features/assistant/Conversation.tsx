import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { useApi, useInfinite } from "@/api/hooks";
import { upload } from "@/api/upload";
import type { AiAnswer, AiFeedbackValue, AiTranscript } from "@mycity/contract/contract.gen.ts";
import { useRouter } from "@/lib/router";
import {
  ActionGroup,
  Button,
  cn,
  DataView,
  EmptyState,
  ErrorState,
  Form,
  HelpTerm,
  Icon,
  IconButton,
  InlineInput,
  ItemChip,
  LoadingRows,
  TapList,
  toast,
  VoiceField,
  type DataViewColumn,
} from "@mycity/ui";

/** Praxis AI's conversation (docs/guides/praxis-ai.md §10): what is asked, what came back, and the box. */

/** The most citations an answer shows before "+N More". */
const CHIPS = 6;
/** What Show Next 25 asks, as a follow-up in the same conversation (§11). */
const NEXT_PAGE = "Show the next 25.";
/** The longest question the contract takes (AiAsk), typed or spoken. */
const QUESTION_MAX = 500;

/** The question waiting for its answer, or the one that failed. Try Again sends it with the same key (§11). */
type Pending = { question: string; key: string; error: string | null; reference?: string };

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

/**
 * One conversation: its turns, the question waiting, and the box with the microphone and Send. Ask
 * shows it as the page; the phone's floating button shows it over any screen (AskPanel). The parent
 * holds which conversation it is and lays it out as a column it fills.
 */
export function Conversation({ id, onOpened, onGone, onAnswered }: { id: string | null; onOpened: (id: string) => void; onGone: () => void; onAnswered: () => void }) {
  const formId = useId();
  const turns = useInfinite("GET /api/v1/ai/conversations/:id/turns", { params: { id: id ?? "" }, enabled: Boolean(id) });
  const suggestions = useApi("GET /api/v1/ai/suggestions", { enabled: !id });
  /* Answers given on this screen, shown at once; the saved page catches up behind them. */
  const [given, setGiven] = useState<AiAnswer[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Record<string, AiFeedbackValue | null>>({});
  const asking = useRef(false);
  /* The question being answered: Send pressed meanwhile waits on it, spinning, with the words kept in the box. */
  const inflight = useRef<Promise<void> | null>(null);
  /* The conversation this screen is showing: an answer that opens one moves the address here, without starting over. */
  const showing = useRef(id);
  /* Counts the times the person moved to another conversation: an answer asked before the last move is not shown. */
  const moves = useRef(0);
  /* Whether the screen is still open: an answer that lands after the person left changes nothing here. */
  const live = useRef(true);
  /* The latest callbacks, for an answer that lands after a render or two. */
  const calls = useRef({ onOpened, onGone, onAnswered });
  calls.current = { onOpened, onGone, onAnswered };
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
    setGiven([]);
    setPending(null);
  }, [id]);

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
  }, [newest, pending]);

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
    setPending({ question, key, error: null });
    try {
      const a = await api.call("POST /api/v1/ai/ask", { body: from ? { question, ai_conversation_id: from } : { question }, idempotencyKey: key });
      calls.current.onAnswered();
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
      if (here()) asking.current = false;
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
            {/* A section of the page beside Recent, and on a phone straight under its title: a second-level heading. */}
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
                <Question words={a.question} />
                <Answer
                  a={a}
                  feedback={a.ai_message_id in feedback ? feedback[a.ai_message_id] : a.feedback}
                  onFeedback={(value) => give(a, value)}
                  onNext={a.more && a.ai_message_id === newest && !pending ? () => ask(NEXT_PAGE) : undefined}
                />
              </div>
            ))}
            {pending && (
              <div className="flex flex-col gap-3.5">
                <Question words={pending.question} />
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
                  <div role="status" className="flex w-fit items-center gap-2 bubble-them border border-border px-3 py-2.5 text-xs text-subtle-foreground">
                    <Icon name="spark" className="animate-pulse" />
                    Reading Your Records
                  </div>
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

function Question({ words }: { words: string }) {
  return (
    <p data-copy="content" className="ml-auto w-fit max-w-4/5 bubble-me border border-border bg-accent px-3 py-2.5 text-sm wrap-any">
      {words}
    </p>
  );
}

function Answer({ a, feedback, onFeedback, onNext }: { a: AiAnswer; feedback: AiFeedbackValue | null; onFeedback: (value: AiFeedbackValue | null) => Promise<void>; onNext?: () => Promise<void> | undefined }) {
  const { navigate } = useRouter();
  const [all, setAll] = useState(false);
  const cites = all ? a.citations : a.citations.slice(0, CHIPS);
  const more = a.citations_total - cites.length;
  /* The read the table was drawn from, when it had more rows than the page it returned. */
  const paged = a.table?.rows.length ? a.reads.find((r) => r.rows === a.table!.rows.length && r.total != null && r.total > r.rows) : undefined;
  const from = paged?.first ?? null;
  return (
    <article aria-label="Answer" className="flex max-w-11/12 flex-col gap-2.5 bubble-them border border-border bg-card p-3 max-md:max-w-full">
      <p data-copy="content" className="text-sm whitespace-pre-line wrap-any">
        {a.content}
      </p>
      {a.table && <AnswerTable a={a} />}
      {(paged || onNext) && (
        <div className="flex flex-wrap items-center gap-2">
          {paged && (
            <span className="text-xs text-subtle-foreground">
              {from && from > 1 ? `Showing ${from} to ${from + paged.rows - 1} of ${paged.total}` : `Showing ${paged.rows} of ${paged.total}`}
            </span>
          )}
          {onNext && (
            <Button size="sm" onClick={onNext}>
              Show Next 25
            </Button>
          )}
        </div>
      )}
      {a.link && (
        <div>
          <Button iconRight="right" onClick={() => navigate(a.link!.path)}>
            {a.link.label}
          </Button>
        </div>
      )}
      {cites.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed border-border pt-2.5">
          <span className="text-2xs font-strong tracking-caps text-subtle-foreground uppercase">
            <HelpTerm help="The records this answer was read from, as you would see them.">From</HelpTerm>
          </span>
          {cites.map((c) => (
            <ItemChip key={`${c.entity_type}:${c.entity_id}`} onSelect={c.link ? () => navigate(c.link!) : undefined}>
              {c.label}
            </ItemChip>
          ))}
          {more > 0 &&
            (!all && a.citations.length > cites.length ? (
              <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                +{more} More
              </Button>
            ) : (
              <span className="text-2xs text-subtle-foreground">+{more} More</span>
            ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <ActionGroup>
          <IconButton size="sm" icon="thumb" label="Helpful" aria-pressed={feedback === "up"} className={cn(feedback === "up" && "bg-muted text-foreground")} onClick={() => onFeedback(feedback === "up" ? null : "up")} />
          <IconButton size="sm" icon="thumbdown" label="Not Helpful" aria-pressed={feedback === "down"} className={cn(feedback === "down" && "bg-muted text-foreground")} onClick={() => onFeedback(feedback === "down" ? null : "down")} />
        </ActionGroup>
      </div>
    </article>
  );
}

type Row = { key: string; cells: string[] };

/** The answer's table, drawn from the rows its read returned (§6.4): a table on desktop, cards on a phone. */
function AnswerTable({ a }: { a: AiAnswer }) {
  const t = a.table!;
  const rows: Row[] = t.rows.map((cells, i) => ({ key: String(i), cells }));
  const columns: DataViewColumn<Row>[] = t.columns.map((label, i) => ({ key: `c${i}`, label, ...(t.numeric.includes(i) ? { align: "n" as const } : {}), render: (r) => r.cells[i] ?? "" }));
  return (
    <div data-copy="content" className="-mx-3">
      <DataView<Row> bare rows={rows} columns={columns} rowKey={(r) => r.key} caption={a.question} />
    </div>
  );
}
