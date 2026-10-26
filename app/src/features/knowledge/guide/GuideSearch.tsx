import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, ApiError } from "@/api/client";
import { upload } from "@/api/upload";
import type { AiTranscript, GuideAnswer, GuideSearchPage } from "@mycity/contract/contract.gen.ts";
import {
  Button,
  EmptyState,
  ErrorState,
  GuideAnswerCard,
  GuideResults,
  LoadingRows,
  Pager,
  SearchInput,
  VoiceField,
  toast,
  type GuideHitView,
} from "@mycity/ui";

/**
 * The User Guide's search (docs/guides/user-guide.md §6.8 to §6.10, §10): the box, the results as
 * they are typed, the answer once asked, and the microphone. The words travel in a POST body, never
 * the address, and nothing is kept anywhere (§6.1 decision 12): not in the address bar, the browser's
 * history or storage. What each reader receives is the server's, cut to their grants.
 */

/** Under this many letters nothing is searched; a question needs one more to be answered. */
const MIN_SEARCH = 2;
const MIN_QUESTION = 3;
/** The pause after the last key before the search is sent. */
const WAIT_MS = 300;

const tidy = (q: string) => q.replace(/\s+/g, " ").trim();

/** A page of results for the words typed, sent once typing pauses; the last page stays while the next comes. */
function useGuideSearch(q: string, page: number) {
  const term = tidy(q);
  const key = `${page}:${term}`;
  const [state, setState] = useState<{ key: string; data: GuideSearchPage | null; error: ApiError | null }>({ key: "", data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (term.length < MIN_SEARCH) return;
    let live = true;
    const t = setTimeout(() => {
      api
        .call("POST /api/v1/user-guide/search", { body: { q: term, page } })
        .then((data) => live && setState({ key, data, error: null }))
        .catch((e: unknown) => live && setState((s) => ({ key, data: s.data, error: e instanceof ApiError ? e : new ApiError(0, null) })));
    }, WAIT_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, term, page, tick]);
  return {
    term,
    data: term.length >= MIN_SEARCH ? state.data : null,
    error: state.key === key ? state.error : null,
    settled: state.key === key,
    retry: () => setTick((n) => n + 1),
  };
}

/** A spoken search to words: one request through the upload engine; the recording is not kept (§6.10). */
async function transcribe(audio: Blob): Promise<string> {
  const type = audio.type || "audio/webm";
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  const reply = (await upload({ endpoint: "/api/v1/user-guide/transcribe", file: new File([audio], `search.${ext}`, { type }), fields: { purpose: "voice_note" } })) as unknown as AiTranscript;
  // A draft is a placeholder, not the person's words (no provider answered): nothing lands in the box.
  if (reply.draft || !reply.text.trim()) throw new Error("No words heard");
  return reply.text.trim();
}

export interface GuideSearchProps {
  /** Whether an answer can be written now (GuideContents.answers). */
  answers: boolean;
  /** Whether a search can be spoken now (GuideContents.voice). */
  voice: boolean;
  /** Opens a result: the guide at its section or task, at its step. */
  onOpen: (hit: GuideHitView) => void;
  /** The results close when this changes (the view switched): the guide shows again. */
  closeOn: string;
  /** The guide, shown while no search is: Quick Start or Full Guide. */
  children: ReactNode;
}

/**
 * The search box over the guide. While a search is typed its results take the guide's place; Enter
 * or Get Answer asks for the answer; opening a result shows the guide again at it, the words kept
 * in the box so a change of them brings the results back.
 */
export function GuideSearch({ answers, voice, onOpen, closeOn, children }: GuideSearchProps) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const found = useGuideSearch(q, page);
  const [answer, setAnswer] = useState<{ q: string; value: GuideAnswer | null } | null>(null);

  useEffect(() => setOpen(false), [closeOn]);

  const change = (v: string) => {
    setQ(v);
    setOpen(true);
    setPage(1);
  };

  const asked = answer !== null && answer.q === found.term;
  const ask = async () => {
    const question = found.term;
    if (!answers || question.length < MIN_QUESTION || asked) return;
    setAnswer({ q: question, value: null });
    try {
      const value = await api.call("POST /api/v1/user-guide/answer", { body: { q: question } });
      setAnswer((a) => (a && a.q === question ? { q: question, value } : a));
    } catch {
      setAnswer(null);
      toast.error("The answer could not be written");
    }
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    setOpen(true);
    ask();
  };

  const openHit = (hit: GuideHitView) => {
    setOpen(false);
    onOpen(hit);
  };

  const showing = open && found.term.length >= MIN_SEARCH;
  return (
    <>
      <div className="mb-4 flex min-w-0 items-center gap-2">
        <SearchInput className="min-w-0 flex-1" label="Search the Guide" placeholder="Search the Guide" value={q} onChange={change} onKeyDown={keys} />
        {voice && <VoiceField compact label="Guide Search" transcribe={transcribe} onTranscript={change} maxSeconds={30} />}
      </div>
      {showing ? <Results found={found} onPage={setPage} answers={answers} answer={asked ? answer : null} ask={ask} onOpen={openHit} /> : children}
    </>
  );
}

function Results({
  found,
  onPage,
  answers,
  answer,
  ask,
  onOpen,
}: {
  found: ReturnType<typeof useGuideSearch>;
  onPage: (n: number) => void;
  answers: boolean;
  answer: { q: string; value: GuideAnswer | null } | null;
  ask: () => Promise<void>;
  onOpen: (hit: GuideHitView) => void;
}) {
  if (found.error && !found.data) return <ErrorState error={found.error} onRetry={found.retry} />;
  if (!found.data) return <LoadingRows count={4} />;
  const { data } = found;
  const canAsk = answers && !answer && found.term.length >= MIN_QUESTION && data.data.length > 0;
  return (
    <div className="flex flex-col gap-3" aria-busy={!found.settled}>
      {canAsk && (
        <div>
          <Button icon="spark" onClick={ask}>
            Get Answer
          </Button>
        </div>
      )}
      {answer && <GuideAnswerCard answer={answer.value} onOpen={onOpen} />}
      {data.data.length === 0 ? (
        <EmptyState illustration="Search" title="No Matches" text="Try other words, or fewer of them" />
      ) : (
        <>
          <GuideResults hits={data.data} onOpen={onOpen} />
          <Pager page={data.page} onPage={onPage} noun="result" label="Guide Results" />
        </>
      )}
    </div>
  );
}
