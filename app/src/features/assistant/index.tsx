import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { invalidate, refresh, useApi, useInfinite, usePaged, type PagedResult } from "@/api/hooks";
import { upload } from "@/api/upload";
import type { AiAnswer, AiConversation, AiFeedbackValue, AiTranscript } from "@mycity/contract/contract.gen.ts";
import { useRouter, useSearchParams } from "@/lib/router";
import { hrefFor } from "@/lib/routes";
import { moduleByKey } from "@/shell/catalogue";
import { useFitPage } from "@/shell/layout-context";
import { useScreenAction } from "@/shell/screen-action";
import type { ModuleScreenProps } from "@/shell/screens";
import { BarsCard } from "@/features/shared/sections";
import {
  ActionGroup,
  Button,
  CardHeader,
  cn,
  DataView,
  DesktopOnly,
  EmptyState,
  ErrorState,
  Form,
  formatDateTime,
  formatMonth,
  formatWhen,
  Grid,
  HelpTerm,
  Icon,
  IconButton,
  InlineInput,
  ItemChip,
  KpiCard,
  KpiGrid,
  LoadingRows,
  Menu,
  PageHeader,
  PhoneOnly,
  SplitPanes,
  TapList,
  toast,
  useConfirm,
  useIsMobile,
  useSplitPanes,
  VoiceField,
  type DataViewColumn,
} from "@mycity/ui";

/** Praxis AI, Ask and History (docs/guides/praxis-ai.md §10). It reads what the person may see and never writes. */
export default function Assistant({ tab, id }: ModuleScreenProps) {
  return tab === "history" ? <History /> : <Ask id={id} />;
}

/** The assistant's name, written once in the shell's catalogue (§1.1 decision 5). */
const NAME = moduleByKey("praxis_ai")?.label ?? "Assistant";
/** The most citations an answer shows before "+N More". */
const CHIPS = 6;
/** What Show Next 25 asks, as a follow-up in the same conversation (§11). */
const NEXT_PAGE = "Show the next 25.";
/** The longest question the contract takes (AiAsk), typed or spoken. */
const QUESTION_MAX = 500;

/* ───────────────────────── Ask ───────────────────────── */

function Ask({ id }: { id: string | null }) {
  const mobile = useIsMobile();
  useFitPage(true);
  const { navigate } = useRouter();
  const [, setParams] = useSearchParams();
  const split = useSplitPanes("praxis-ai", 280);
  const recent = usePaged("GET /api/v1/ai/conversations", { enabled: !mobile });
  const open = useCallback((next: string) => setParams({ id: next }), [setParams]);
  // A new address rather than a change to this one: ⌘K's New Conversation arrives as ?action=new,
  // which a change made from this render's address would put back.
  const fresh = useCallback(() => navigate(hrefFor("praxis_ai", "ask")), [navigate]);
  // A fit page has no floating button: ⌘K's New Conversation (?action=new) runs this.
  useScreenAction({ label: "New Conversation", onSelect: fresh });
  const reloadRecent = recent.reload;
  const answered = useCallback(() => {
    if (!mobile) void reloadRecent();
    void refresh("/api/v1/ai/history");
  }, [mobile, reloadRecent]);

  const conversation = <Conversation id={id} onOpened={(next) => setParams({ id: next }, { replace: true })} onGone={fresh} onAnswered={answered} />;
  return (
    <>
      <PageHeader title={NAME} actions={id ? <Button icon="plus" onClick={fresh}>New Conversation</Button> : undefined} />
      {mobile ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border bg-card">{conversation}</div>
      ) : (
        <SplitPanes split={split} open list={<Recent list={recent} current={id} onOpen={open} />} detail={conversation} />
      )}
    </>
  );
}

/** Beside the conversation on desktop: the person's conversations, newest first. On a phone this is History. */
function Recent({ list, current, onOpen }: { list: PagedResult<AiConversation>; current: string | null; onOpen: (id: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-3">
      <CardHeader title="Recent" className="px-3.5" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DataView<AiConversation>
          bare
          list={list}
          caption="Recent"
          noun="conversation"
          rowKey={(c) => c.ai_conversation_id}
          selectedKey={current}
          onRowClick={(c) => onOpen(c.ai_conversation_id)}
          empty={{ title: "No Questions Yet" }}
          columns={[
            { key: "title", label: "Conversation", render: (c) => c.title },
            { key: "last_asked_at", label: "Last Asked", render: (c) => (c.last_asked_at ? formatWhen(c.last_asked_at) : null) },
          ]}
        />
      </div>
    </div>
  );
}

/** The question waiting for its answer, or the one that failed. Try Again sends it with the same key (§11). */
type Pending = { question: string; key: string; error: string | null };

/** A spoken question to words: one request through the upload engine; the recording is not kept (§6.6). */
async function transcribe(audio: Blob): Promise<string> {
  const type = audio.type || "audio/webm";
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  const reply = (await upload({ endpoint: "/api/v1/ai/transcribe", file: new File([audio], `question.${ext}`, { type }), fields: { purpose: "voice_note" } })) as unknown as AiTranscript;
  // A draft is a placeholder, not the person's words (no provider answered): nothing lands in the box.
  if (reply.draft || !reply.text.trim()) throw new Error("No words heard");
  return reply.text.trim();
}

function Conversation({ id, onOpened, onGone, onAnswered }: { id: string | null; onOpened: (id: string) => void; onGone: () => void; onAnswered: () => void }) {
  const formId = useId();
  const turns = useInfinite("GET /api/v1/ai/conversations/:id/turns", { params: { id: id ?? "" }, enabled: Boolean(id) });
  const suggestions = useApi("GET /api/v1/ai/suggestions", { enabled: !id });
  /* Answers given on this screen, shown at once; the saved page catches up behind them. */
  const [given, setGiven] = useState<AiAnswer[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Record<string, AiFeedbackValue | null>>({});
  const asking = useRef(false);
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

  const ask = async (words: string, key: string = crypto.randomUUID()) => {
    const question = words.trim();
    if (!question || asking.current) return;
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
      } else if (err.status >= 400 && err.status < 500 && err.status !== 409) {
        // Asking again would be refused the same way: the words go back to the box to change.
        setPending(null);
        setText(question);
        toast.error(err.fields?.question?.[0] ?? err.message);
      } else {
        setPending({ question, key, error: err.message || "Could not reach the server" });
      }
    } finally {
      if (here()) asking.current = false;
    }
  };

  /** Send what is in the box: it empties only when the question goes. */
  const send = () => {
    if (asking.current || !text.trim()) return;
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
      toast.error(e instanceof ApiError ? e.message : "Could not reach the server");
    }
  };

  const empty = !id && answers.length === 0 && !pending;
  const offered = suggestions.data?.questions ?? [];

  return (
    <>
      <div role="log" aria-label="Conversation" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4 max-md:p-3">
        {empty ? (
          <div className="m-auto flex w-full max-w-120 flex-col gap-3">
            <EmptyState bare illustration="FirstRun" title={offered.length ? "Try Asking" : "Ask a Question"} />
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

function Answer({ a, feedback, onFeedback, onNext }: { a: AiAnswer; feedback: AiFeedbackValue | null; onFeedback: (value: AiFeedbackValue | null) => Promise<void>; onNext?: () => Promise<void> }) {
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

/* ───────────────────────── History ───────────────────────── */

function History() {
  const { navigate } = useRouter();
  const confirm = useConfirm();
  const s = useApi("GET /api/v1/ai/history/summary");
  const list = usePaged("GET /api/v1/ai/conversations");

  /** After a confirmation, one removal; a refusal is said in the toast. */
  const removing = async (ask: Parameters<typeof confirm>[0], work: () => Promise<unknown>, done: string) => {
    if (!(await confirm(ask))) return;
    try {
      await work();
      invalidate("/api/v1/ai");
      toast(done);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not reach the server");
    }
  };
  const clear = () => removing({ title: "Clear History", body: "Every conversation is removed.", destructive: true }, () => api.call("DELETE /api/v1/ai/history"), "History cleared");
  const remove = (c: AiConversation) =>
    removing({ title: "Delete Conversation", destructive: true }, () => api.call("DELETE /api/v1/ai/conversations/:id", { params: { id: c.ai_conversation_id } }), "Conversation deleted");

  return (
    <>
      <PageHeader
        title="History"
        actions={
          <>
            <DesktopOnly>
              <Button icon="trash" onClick={clear}>
                Clear History
              </Button>
            </DesktopOnly>
            <PhoneOnly>
              <Menu trigger={(p) => <IconButton {...p} icon="dots" label="History Actions" />} items={[{ label: "Clear History", icon: "trash", danger: true, onSelect: () => void clear() }]} />
            </PhoneOnly>
          </>
        }
      />
      {s.data && (
        <KpiGrid cols={3} className="mb-3">
          <KpiCard title="Questions" value={String(s.data.questions_this_month)} caption={formatMonth(s.data.month)} />
          <KpiCard title="Conversations" value={String(s.data.conversations)} caption={formatMonth(s.data.month)} />
          <KpiCard title="Records Read" value={String(s.data.rows_read_this_month)} caption={formatMonth(s.data.month)} help="How many records this month's answers were read from." />
        </KpiGrid>
      )}
      <DataView<AiConversation>
        title="Conversations"
        list={list}
        search="Search Conversations"
        rowKey={(c) => c.ai_conversation_id}
        noun="conversation"
        onRowClick={(c) => navigate(hrefFor("praxis_ai", "ask", { id: c.ai_conversation_id }))}
        empty={{ title: "No Questions Yet", text: "Ask one on the Ask tab." }}
        columns={[
          { key: "title", label: "Title", sortable: true, render: (c) => c.title },
          { key: "last_asked_at", label: "Last Asked", sortable: true, render: (c) => (c.last_asked_at ? formatDateTime(c.last_asked_at) : null) },
          { key: "questions", label: "Questions", align: "n", render: (c) => String(c.questions) },
          { key: "rows_read", label: "Records Read", align: "n", desktop: true, render: (c) => String(c.rows_read) },
          {
            key: "act",
            label: "",
            render: (c) => (
              <Menu
                trigger={(p) => <IconButton {...p} size="sm" icon="dots" label="Conversation Actions" />}
                items={[{ label: "Delete Conversation", icon: "trash", danger: true, onSelect: () => void remove(c) }]}
              />
            ),
          },
        ]}
      />
      {s.data && s.data.by_module.length > 0 && (
        <DesktopOnly unmount>
          <Grid cols={2} className="mt-3">
            <BarsCard
              title="Questions by Module"
              rows={s.data.by_module.map((m) => ({ label: m.label, value: String(m.questions), pct: Math.round((m.questions / Math.max(1, s.data!.questions_this_month)) * 100) }))}
            />
          </Grid>
        </DesktopOnly>
      )}
    </>
  );
}
