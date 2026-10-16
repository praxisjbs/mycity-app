import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import "@/api/types/public";
import type { AssessmentQuestion, AssessmentSession } from "@/api/types/public";
import { Banner, Button, cn, formatDate, Icon, PageMessage, Skeleton, Sub, TextAreaField } from "@mycity/ui";
import { Page } from "@/shell/Page";
import { LinkProblem } from "./LinkProblem";

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};

/**
 * Assessment (#83): timed, autosaved, resumable. The timer runs on the server:
 * closing the tab does not stop it, and reopening the link resumes at the same
 * question with the time that is left. The candidate sees that they finished,
 * never their score.
 */
export function Assessment({ token }: { token: string }) {
  const s = useApi("GET /api/public/v1/assess/:token", { params: { token } });
  if (s.error) return <LinkProblem error={s.error} title="Assessment" retry={s.reload} />;
  const d = s.data;
  if (!d)
    return (
      <Page title="Assessment">
        <Skeleton lines={6} />
      </Page>
    );
  if (d.state === "not_started") return <Intro d={d} token={token} onStarted={s.set} />;
  if (d.state === "in_progress") return <Running key={d.ends_at} d={d} token={token} onEnded={s.set} reload={s.reload} />;
  return (
    <Page title="Assessment">
      {d.state === "submitted" ? (
        <PageMessage icon="ok" tone="ok" title="Assessment submitted">
          <p>
            Thank you, {d.candidate_first_name}. Your answers to {d.assessment.title} were received{d.submitted_at ? ` on ${formatDate(d.submitted_at)}` : ""}.
          </p>
          <p className="mt-2">We will email you about the next step for {d.vacancy_title}. You will not see a score here. You can close this page.</p>
        </PageMessage>
      ) : (
        <PageMessage icon="clock" tone="warn" title="The time is up">
          <p>Your saved answers to {d.assessment.title} were submitted as they stood when the time ran out.</p>
          <p className="mt-2">We will email you about the next step for {d.vacancy_title}. You can close this page.</p>
        </PageMessage>
      )}
    </Page>
  );
}

function Intro({ d, token, onStarted }: { d: AssessmentSession; token: string; onStarted: (d: AssessmentSession) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    try {
      onStarted(await api.call("POST /api/public/v1/assess/:token/start", { params: { token }, body: {} }));
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not start. Try again.");
      setBusy(false);
    }
  };
  return (
    <Page title={d.assessment.title}>
      <Sub>{d.vacancy_title}</Sub>
      <h1 className="mt-1 text-[20px]">{d.assessment.title}</h1>
      <div className="mt-3.5 grid grid-cols-3 gap-2">
        {[["Type", d.assessment.kind], ["Time", `${d.assessment.duration_min} minutes`], ["Questions", String(d.assessment.question_count)]].map(([k, val]) => (
          <div key={k} className="rounded-[10px] border border-border px-3 py-2.5">
            <div className="text-[11px] font-semibold tracking-[.07em] text-subtle-foreground uppercase">{k}</div>
            <b className="text-[15px] max-md:text-[13.5px]">{val}</b>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13.5px] leading-[1.6] text-muted-foreground">
        Hello {d.candidate_first_name}. {d.assessment.instructions}
      </p>
      <div className="mt-4">
        <Banner tone="info" icon="clock">
          The timer starts when you press Start and runs on our side. Closing this tab does not stop it. If the connection or the power goes, open the same link again: every answer is saved as you go, and you continue exactly where you were.
        </Banner>
      </div>
      {problem && (
        <div className="mt-3">
          <Banner tone="err">{problem}</Banner>
        </div>
      )}
      <Button variant="primary" block className="mt-5" disabled={busy} onClick={start}>
        {busy ? "Starting" : "Start the Assessment"}
      </Button>
    </Page>
  );
}

type Save = { state: "idle" | "saving" | "saved" | "error"; at: number | null };

function Running({ d, token, onEnded, reload }: { d: AssessmentSession; token: string; onEnded: (d: AssessmentSession) => void; reload: () => void }) {
  const questions = d.questions!;
  const total = questions.length;
  /* The server's clock, not the device's: a wrong phone clock must not change the time left. */
  const offset = useRef(new Date(d.server_now).getTime() - Date.now());
  const endsAt = new Date(d.ends_at!).getTime();
  const [now, setNow] = useState(() => Date.now() + offset.current);
  const [i, setI] = useState(Math.min(d.current, total - 1));
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(questions.map((q) => [q.question_id, q.answer ?? ""])));
  const [save, setSave] = useState<Save>({ state: "idle", at: null });
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef<Record<string, string>>({});
  const timer = useRef<number | null>(null);
  const q = questions[i];
  const left = endsAt - now;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => window.clearInterval(t);
  }, []);
  /* At zero the server has already closed it; ask it what was recorded. */
  useEffect(() => {
    if (left <= 0) reload();
  }, [left <= 0, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(
    async (current: number) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      const items = Object.entries(pending.current);
      pending.current = {};
      if (!items.length) return true;
      setSave((s) => ({ ...s, state: "saving" }));
      try {
        for (const [qid, answer] of items) await api.call("PUT /api/public/v1/assess/:token/answers/:question_id", { params: { token, question_id: qid }, body: { answer, current } });
        setSave({ state: "saved", at: Date.now() });
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === "TIME_UP") {
          reload();
          return false;
        }
        /* Keep what did not save, and try again with the next change. */
        for (const [qid, answer] of items) pending.current[qid] ??= answer;
        setSave((s) => ({ ...s, state: "error" }));
        return false;
      }
    },
    [token, reload],
  );
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const answer = (qq: AssessmentQuestion, val: string, immediate = false) => {
    setAnswers((a) => ({ ...a, [qq.question_id]: val }));
    pending.current[qq.question_id] = val;
    if (timer.current) window.clearTimeout(timer.current);
    if (immediate) void flush(i);
    else timer.current = window.setTimeout(() => void flush(i), 1500);
  };
  const go = async (to: number) => {
    pending.current[q.question_id] = answers[q.question_id] ?? "";
    await flush(to);
    setI(to);
    setConfirm(false);
    window.scrollTo(0, 0);
  };
  const submit = async () => {
    setProblem(null);
    if (!(await flush(i))) return;
    try {
      onEnded(await api.call("POST /api/public/v1/assess/:token/submit", { params: { token }, body: {} }));
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Could not submit. Your answers are saved; try again.");
    }
  };
  const answered = questions.filter((x) => (answers[x.question_id] ?? "").trim()).length;
  const ago = save.at ? Math.max(1, Math.round((Date.now() - save.at) / 1000)) : null;

  return (
    <Page title={d.assessment.title}>
      <div className="mb-[18px] flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px]">{d.assessment.title}</h1>
          <Sub>
            {d.assessment.kind} · Question {i + 1} of {total}
          </Sub>
        </div>
        <div className="text-right" role="timer" aria-live="off" aria-label={`${clock(left)} remaining`}>
          <div className={cn("text-[20px] font-bold tracking-[-.02em]", left < 5 * 60000 ? "text-destructive" : "text-warning")}>{clock(left)}</div>
          <Sub>remaining</Sub>
        </div>
      </div>
      <div className="mb-5 h-[5px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <i className="block h-full rounded-full bg-chart-1 transition-[width]" style={{ width: `${((i + 1) / total) * 100}%` }} />
      </div>
      <p id={`p-${q.question_id}`} className="text-[14px] leading-normal font-semibold">
        {q.prompt}
      </p>
      {q.kind === "text" ? (
        <TextAreaField aria-labelledby={`p-${q.question_id}`} className="mt-3.5 min-h-[150px]" rows={6} value={answers[q.question_id] ?? ""} onChange={(val) => answer(q, val)} />
      ) : (
        <div role="radiogroup" aria-labelledby={`p-${q.question_id}`} className="mt-3.5 flex flex-col gap-2">
          {q.options!.map((o) => {
            const on = answers[q.question_id] === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => answer(q, o.id, true)}
                className={cn("flex items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left text-[13.5px] transition-colors", on ? "border-secondary bg-accent font-semibold" : "border-border hover:border-subtle-foreground")}
              >
                <span className={cn("flex size-[18px] flex-none items-center justify-center rounded-full border-2", on ? "border-secondary" : "border-input")}>{on && <i className="size-2 rounded-full bg-secondary" />}</span>
                {o.text}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
        <span className={cn("inline-flex flex-1 items-center gap-1.5 text-[12.5px]", save.state === "error" ? "text-destructive" : "text-subtle-foreground")} aria-live="polite">
          {save.state === "saving" ? (
            "Saving"
          ) : save.state === "error" ? (
            <>
              <Icon name="alert" /> Not saved yet. It will try again
            </>
          ) : ago ? (
            <>
              <Icon name="ok" /> Saved {ago < 60 ? `${ago} second${ago === 1 ? "" : "s"}` : `${Math.round(ago / 60)} minute${Math.round(ago / 60) === 1 ? "" : "s"}`} ago
            </>
          ) : (
            "Answers save as you go"
          )}
        </span>
        <Button disabled={i === 0} onClick={() => void go(i - 1)}>
          Back
        </Button>
        {i < total - 1 ? (
          <Button variant="primary" onClick={() => void go(i + 1)}>
            Next Question
          </Button>
        ) : (
          !confirm && (
            <Button variant="primary" onClick={() => setConfirm(true)}>
              Finish
            </Button>
          )
        )}
      </div>
      {confirm && (
        <div className="mt-4 rounded-[10px] border border-border bg-muted p-3.5">
          <b className="text-[13.5px]">Submit your answers?</b>
          <Sub className="mt-1">
            {answered} of {total} questions answered. After submitting you cannot change an answer.
          </Sub>
          {problem && (
            <div className="mt-2.5">
              <Banner tone="err">{problem}</Banner>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => setConfirm(false)}>Keep Going</Button>
            <Button variant="primary" onClick={() => void submit()}>
              Submit Assessment
            </Button>
          </div>
        </div>
      )}
      <Sub className="mt-3.5 border-t border-border pt-3">The timer runs on our side. Closing this tab does not stop it, and reopening the link resumes exactly here.</Sub>
    </Page>
  );
}
