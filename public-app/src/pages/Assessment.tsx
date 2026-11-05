import { useCallback, useEffect, useRef, useState } from "react";
import type { AssessmentSession, PublicQuestion } from "@mycity/contract/contract.gen.ts";
import {
  ActionGroup,
  Banner,
  Button,
  ChoiceField,
  ConfirmDialog,
  Countdown,
  Field,
  FileCard,
  formatDate,
  HelpTerm,
  Icon,
  PageMessage,
  ProgressBar,
  RadioCards,
  SelectField,
  Skeleton,
  StatStrip,
  Sub,
  TextAreaField,
  TextField,
  UploadField,
} from "@mycity/ui";
import { api, ApiError } from "@/api/client";
import { useApi } from "@/api/hooks";
import { upload } from "@/api/upload";
import { Page } from "@/shell/Page";
import { LinkProblem } from "./LinkProblem";

const TYPE: Record<AssessmentSession["assessment"]["assessment_type"], string> = {
  psychometric: "Psychometric",
  technical: "Technical",
  case_study: "Case Study",
  practical: "Practical Brief",
};

/** How long after the last key a written answer saves itself. */
const TYPING_PAUSE_MS = 1200;
/** What a file answer may be, as the vault takes it for an assessment answer (mime-policy). */
const ANSWER_FILES = ".pdf,.docx,.xlsx,.pptx,.csv,.jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.webm";
const HTTPS = /^https:\/\/[^\s/$.?#]\S*$/i;

/**
 * Assessment (#83): a timed test or a take-home brief, reached by its link. The clock is the
 * server's (Countdown counts from the answer's own `server_now`), every answer saves as it is
 * given, and opening the same link again resumes at the same question with the time really left.
 * The candidate sees that they finished, never a score.
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
  if (d.state === "in_progress" && d.questions) return <Sitting key={d.ends_at ?? "open"} d={d} token={token} onEnded={s.set} reload={s.reload} />;
  return <Ended d={d} />;
}

function Intro({ d, token, onStarted }: { d: AssessmentSession; token: string; onStarted: (d: AssessmentSession) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const a = d.assessment;
  const start = async () => {
    setProblem(null);
    try {
      onStarted(await api.call("POST /api/public/v1/assess/:token/start", { params: { token } }));
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "The assessment did not start. Try again.");
    }
  };
  return (
    <Page title="Assessment">
      <p className="text-2xs font-strong tracking-wide text-eyebrow uppercase" data-copy="content">
        {d.vacancy_title}
      </p>
      <h1 className="mt-1 font-heading text-2xl" data-copy="content">
        {a.name}
      </h1>
      <Sub as="p" className="mt-1">
        Hello {d.candidate_first_name}. Start by {formatDate(d.start_by)}.
      </Sub>
      <StatStrip
        label="About the Assessment"
        className="mt-5"
        items={[
          { label: "Type", value: TYPE[a.assessment_type] },
          { label: d.timed ? "Time" : "Take Home", value: d.timed && a.duration_minutes ? `${a.duration_minutes} minutes` : "Your own pace" },
          { label: "Questions", value: a.question_count },
        ]}
      />
      {a.instructions && (
        <p className="mt-5 text-md leading-relaxed whitespace-pre-line text-muted-foreground" data-copy="content">
          {a.instructions}
        </p>
      )}
      {problem && <Banner tone="err" className="mt-4">{problem}</Banner>}
      <Button variant="primary" block className="mt-6" onClick={start}>
        Start the Assessment
      </Button>
    </Page>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** The answer a question starts with: a choice's id, the words, or a file question's link. */
const givenOf = (q: PublicQuestion) => q.answer ?? "";

function Sitting({ d, token, onEnded, reload }: { d: AssessmentSession; token: string; onEnded: (d: AssessmentSession) => void; reload: () => Promise<void> }) {
  const questions = d.questions!;
  const total = questions.length;
  const [i, setI] = useState(Math.min(Math.max(d.current_question, 0), total - 1));
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(questions.map((q) => [q.assessment_question_id, givenOf(q)])));
  const [files, setFiles] = useState<Record<string, string | null>>(() => Object.fromEntries(questions.map((q) => [q.assessment_question_id, q.file_name])));
  const [linkMode, setLinkMode] = useState<Record<string, boolean>>(() => Object.fromEntries(questions.map((q) => [q.assessment_question_id, !!q.answer && !q.file_name])));
  const [bad, setBad] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>("idle");
  const [confirm, setConfirm] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const dirty = useRef(new Set<string>());
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const timer = useRef<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const q = questions[i]!;
  const qid = q.assessment_question_id;
  const [fileQuestion] = useState(() => new Set(questions.filter((x) => x.question_type === "file").map((x) => x.assessment_question_id)));

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
    window.scrollTo(0, 0);
  }, [i]);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  /** Saves one answer, after any save still on its way, so the server holds them in the order given. */
  const put = useCallback(
    (id: string, answer: string, current: number) => {
      chain.current = chain.current.then(async () => {
        setSave("saving");
        try {
          await api.call("PUT /api/public/v1/assess/:token/answers/:question_id", { params: { token, question_id: id }, body: { answer, current_question: current } });
          /* The server keeps one answer a question: a link saved over a file replaces it. */
          if (answer && fileQuestion.has(id)) setFiles((f) => (f[id] ? { ...f, [id]: null } : f));
          setSave("saved");
          return true;
        } catch (e) {
          /* The time ran out, or the sitting ended elsewhere: the page reads it again and says so. */
          if (e instanceof ApiError && (e.code === "TIME_UP" || e.code === "NOT_RUNNING" || e.status === 404)) {
            await reload();
            return false;
          }
          if (e instanceof ApiError && e.fields.answer?.length) setBad((b) => ({ ...b, [id]: "Check the link" }));
          dirty.current.add(id);
          setSave("error");
          return false;
        }
      });
      return chain.current;
    },
    [token, reload, fileQuestion],
  );

  /** Saves every answer changed since the last save. */
  const flush = useCallback(
    async (current: number) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      const ids = [...dirty.current];
      dirty.current.clear();
      let ok = true;
      for (const id of ids) ok = (await put(id, answersRef.current[id] ?? "", current)) && ok;
      return ok;
    },
    [put],
  );

  const change = (value: string, now = false) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
    answersRef.current = { ...answersRef.current, [qid]: value };
    setBad((b) => (b[qid] ? { ...b, [qid]: "" } : b));
    /* A link is saved once it reads as one: half a link is not an answer. */
    if (q.question_type === "file" && value.trim() && !HTTPS.test(value.trim())) {
      dirty.current.delete(qid);
      return;
    }
    dirty.current.add(qid);
    if (timer.current) window.clearTimeout(timer.current);
    if (now) void flush(i);
    else timer.current = window.setTimeout(() => void flush(i), TYPING_PAUSE_MS);
  };

  /** A half-typed link stops the page moving on, so it is never left behind unsaved. */
  const linkProblem = () => {
    const v = (answersRef.current[qid] ?? "").trim();
    if (q.question_type !== "file" || !v || HTTPS.test(v)) return false;
    setBad((b) => ({ ...b, [qid]: "A link starting https" }));
    return true;
  };

  const go = async (to: number) => {
    if (linkProblem()) return;
    /* Moving saves where the candidate is, so the same link opens on this question again. */
    dirty.current.add(qid);
    if (q.question_type === "file" && !linkMode[qid]) answersRef.current = { ...answersRef.current, [qid]: "" };
    await flush(to);
    setI(to);
  };

  const submit = async () => {
    setProblem(null);
    if (!(await flush(i))) {
      setConfirm(false);
      return;
    }
    try {
      onEnded(await api.call("POST /api/public/v1/assess/:token/submit", { params: { token } }));
    } catch (e) {
      if (e instanceof ApiError && (e.code === "TIME_UP" || e.code === "NOT_RUNNING" || e.status === 404)) return reload();
      setConfirm(false);
      setProblem(e instanceof ApiError ? e.message : "The assessment did not submit. Your answers are saved; try again.");
    }
  };

  const answered = questions.filter((x) => (answers[x.assessment_question_id] ?? "").trim() || files[x.assessment_question_id]).length;
  const last = i === total - 1;

  return (
    <Page title="Assessment">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-strong tracking-wide text-eyebrow uppercase" data-copy="content">
            {d.assessment.name}
          </p>
          <h1 ref={heading} tabIndex={-1} className="mt-1 font-heading text-2xl outline-none phone:text-xl">
            Question {i + 1} of {total}
          </h1>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          {d.timed ? (
            <Countdown endsAt={d.ends_at} serverNow={d.server_now} onEnd={reload} />
          ) : (
            <div className="text-right">
              <p className="text-2xs font-strong tracking-wide text-eyebrow uppercase">Due</p>
              <p className="text-md font-strong tabular-nums">{d.ends_at ? `${formatDate(d.ends_at)}, 23:59` : null}</p>
            </div>
          )}
          <HelpTerm
            className="text-xs"
            align="end"
            help={
              d.timed
                ? "Your answers save as you go. Open the same link again to carry on where you were; the clock keeps running."
                : "Your answers save as you go. Open the same link again to carry on where you were."
            }
          >
            Resume Later
          </HelpTerm>
        </div>
      </div>
      <ProgressBar className="mt-4" label={`${answered} of ${total} Answered`} value={answered} max={total} showValue={false} tone="ok" />

      <section key={qid} aria-labelledby={`prompt-${qid}`} className="mt-6 animate-rise border-t border-border pt-5">
        <p id={`prompt-${qid}`} className="text-lg leading-normal font-strong whitespace-pre-line text-foreground" data-copy="content">
          {q.prompt}
        </p>
        <div className="mt-4">
          {q.question_type === "choice" ? (
            <ChoiceAnswer q={q} value={answers[qid] ?? ""} onChange={(v) => change(v, true)} />
          ) : q.question_type === "file" ? (
            <FileAnswer
              q={q}
              token={token}
              link={linkMode[qid] ?? false}
              onLink={(on) => setLinkMode((m) => ({ ...m, [qid]: on }))}
              value={answers[qid] ?? ""}
              onChange={(v) => change(v)}
              onBlur={() => void (linkProblem() || flush(i))}
              fileName={files[qid] ?? null}
              onFile={(name) => {
                setFiles((f) => ({ ...f, [qid]: name }));
                setAnswers((a) => ({ ...a, [qid]: "" }));
                answersRef.current = { ...answersRef.current, [qid]: "" };
                dirty.current.delete(qid);
                setSave("saved");
              }}
              error={bad[qid] || undefined}
            />
          ) : (
            <Field label="Your Answer">
              <TextAreaField rows={8} maxLength={20000} value={answers[qid] ?? ""} onChange={(v) => change(v)} onBlur={() => void flush(i)} />
            </Field>
          )}
        </div>
      </section>

      {problem && <Banner tone="err" className="mt-4">{problem}</Banner>}
      <div className="mt-6 flex items-center gap-3 border-t border-border pt-4 phone:flex-col phone:items-stretch">
        <SaveLine state={save} onRetry={() => flush(i)} />
        <ActionGroup>
          <div className="flex gap-2 phone:w-full">
            {i > 0 && (
              <Button className="phone:flex-1" onClick={() => go(i - 1)}>
                Back
              </Button>
            )}
            {last ? (
              <Button variant="primary" className="phone:flex-1" onClick={() => !linkProblem() && setConfirm(true)}>
                Finish
              </Button>
            ) : (
              <Button variant="primary" className="phone:flex-1" onClick={() => go(i + 1)}>
                Next Question
              </Button>
            )}
          </div>
        </ActionGroup>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Submit Assessment"
        body={`You answered ${answered} of ${total} questions. Answers cannot change after this.`}
        cancelLabel="Keep Going"
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
      />
    </Page>
  );
}

/** Saving, Saved, or Not Saved with a way to try again. Said politely as it changes. */
function SaveLine({ state, onRetry }: { state: SaveState; onRetry: () => unknown }) {
  return (
    <div aria-live="polite" className="flex min-h-tap flex-1 items-center gap-2 text-xs text-subtle-foreground">
      {state === "saving" && (
        <>
          <Icon name="refresh" className="animate-spin motion-reduce:animate-none" />
          Saving
        </>
      )}
      {state === "saved" && (
        <>
          <Icon name="ok" className="text-success" />
          Saved
        </>
      )}
      {state === "error" && (
        <>
          <Icon name="alert" className="text-destructive" />
          <span className="text-destructive">Not Saved</span>
          <Button size="sm" onClick={onRetry}>
            Try Again
          </Button>
        </>
      )}
    </div>
  );
}

/** One of a choice question's options: rows to read for a few, a menu for many. */
function ChoiceAnswer({ q, value, onChange }: { q: PublicQuestion; value: string; onChange: (v: string) => void }) {
  const options = (q.options ?? []).map((o) => ({ value: o.id, label: o.text }));
  return (
    <Field label="Your Answer">
      {options.length <= 5 ? <RadioCards value={value || null} onChange={onChange} options={options} /> : <SelectField value={value} onChange={onChange} options={options} />}
    </Field>
  );
}

/** A file question: a file of up to 25 MB, or a link for anything larger. A new one replaces the last. */
function FileAnswer({
  q,
  token,
  link,
  onLink,
  value,
  onChange,
  onBlur,
  fileName,
  onFile,
  error,
}: {
  q: PublicQuestion;
  token: string;
  link: boolean;
  onLink: (on: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  fileName: string | null;
  onFile: (name: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Your Answer">
        <ChoiceField
          value={link ? "link" : "file"}
          onChange={(v) => onLink(v === "link")}
          options={[
            { value: "file", label: "Upload a File" },
            { value: "link", label: "Paste a Link" },
          ]}
        />
      </Field>
      {link ? (
        <Field label={<HelpTerm help="For anything over 25 MB: a Google Drive, video or portfolio link anyone can open.">Paste a Link</HelpTerm>} state={error ? "bad" : value && HTTPS.test(value.trim()) ? "good" : undefined} message={error}>
          <TextField type="url" inputMode="url" placeholder="https://" value={value} onChange={onChange} onBlur={onBlur} />
        </Field>
      ) : (
        <>
          {fileName && <FileCard name={fileName} mime="application/octet-stream" tone="plain" />}
          <UploadField
            endpoint={`/api/public/v1/assess/${encodeURIComponent(token)}/answers/${q.assessment_question_id}/file`}
            purpose="assessment_answer"
            upload={upload}
            multiple={false}
            accept={ANSWER_FILES}
            kinds="PDF, Office, image or video, up to 25 MB"
            label={fileName ? "Replace the File" : "Upload a File"}
            handOff
            onUploaded={(docs) => docs[0] && onFile(docs[0].file_name)}
          />
        </>
      )}
    </div>
  );
}

/** Submitted, or the time ran out: what was saved stands, and the page says nothing of a score. */
function Ended({ d }: { d: AssessmentSession }) {
  const done = d.state === "submitted";
  return (
    <Page title="Assessment">
      <PageMessage icon={done ? "ok" : "clock"} tone={done ? "ok" : "warn"} title={done ? "Assessment Submitted" : "The Time Is Up"}>
        <p>
          {done
            ? `Thank you, ${d.candidate_first_name}. We have your answers to ${d.assessment.name}.`
            : `Your saved answers to ${d.assessment.name} were sent as they stood when the time ran out.`}
        </p>
        <p className="mt-2">We will email you about the next step for {d.vacancy_title}. You can close this page.</p>
      </PageMessage>
    </Page>
  );
}
