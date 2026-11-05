/**
 * My Card: a panelist's own blind card for one interview (docs/guides/recruitment.md §3 step 9, §6.6,
 * §10), MyCity's Interview Assessment Format on screen. The role's traits, numbered and the same for
 * every candidate, each rated 1 to 10 with ten stars; each star is saved the moment it is tapped and
 * put back, with the error, when the save fails; a tap on the star already chosen takes it back to
 * not rated. The panelist's own score, the mean of what they have rated, shows as they go. Then a
 * decision, comments and private notes, and Submit Card, which locks it. Nobody else reads it until
 * the round closes; private notes stay the author's always.
 */
import { useRef, useState } from "react";
import type { InterviewDecision, InterviewDetail } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { saveFile } from "@/api/download";
import { Button, ChoiceField, Field, FormError, FormFooter, HelpTerm, RatingField, TextAreaField, toast, useConfirm } from "@mycity/ui";
import { DECISIONS, say } from "./shared";

const PRIVATE_HELP = "Only you ever see these.";

export function MyCard({ interview, close, onChanged }: { interview: InterviewDetail; close: () => void; onChanged: (x: InterviewDetail) => void }) {
  const mine = interview.my_feedback;
  const submitted = Boolean(mine?.submitted_at);
  // What the server last kept, by trait (and the overall rating and decision): where a failed save puts a star back.
  const kept = useRef({
    ratings: Object.fromEntries((mine?.ratings ?? []).map((r) => [r.vacancy_question_id, r.rating as number | null])) as Record<string, number | null>,
    overall: mine?.overall_rating ?? null,
    decision: (mine?.decision ?? "") as InterviewDecision | "",
  });
  // Optimistic, by trait: a star that waits for the round trip before it fills reads as a missed tap.
  const [local, setLocal] = useState<Record<string, number | null>>(kept.current.ratings);
  const [overall, setOverall] = useState<number | null>(kept.current.overall);
  const [decision, setDecision] = useState<InterviewDecision | "">(kept.current.decision);
  const [comments, setComments] = useState(mine?.comments ?? "");
  const [notes, setNotes] = useState(mine?.private_notes ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const ai = useApi("GET /api/v1/recruitment/vacancies/assist");
  const save = useMutation("PUT /api/v1/recruitment/interviews/:id/feedback");
  const send = useMutation("POST /api/v1/recruitment/interviews/:id/feedback/submit");
  const tidy = useMutation("POST /api/v1/recruitment/interviews/assist");
  const confirm = useConfirm();
  const id = interview.interview_id;
  const traits = interview.questions;
  const ratingOf = (q: string) => local[q] ?? null;
  const rated = traits.map((t) => ratingOf(t.vacancy_question_id)).filter((n): n is number => n !== null);
  const myScore = traits.length ? (rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null) : overall;
  const unmark = (...keys: string[]) => setMarks((m) => (keys.some((k) => m[k]) ? Object.fromEntries(Object.entries(m).filter(([k]) => !keys.includes(k))) : m));

  // One save at a time, in the order tapped: a later star never lands before an earlier one.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const inOrder = <T,>(work: () => Promise<T>) => {
    const next = chain.current.then(work, work);
    chain.current = next.catch(() => undefined);
    return next;
  };
  /** Saves `body` in turn and keeps what the server answered as the card's last kept state. */
  const put = (body: NonNullable<NonNullable<Parameters<typeof save.run>[0]>["body"]>) =>
    inOrder(async () => {
      const after = await save.run({ params: { id }, body });
      const f = after.my_feedback;
      if (f) kept.current = { ratings: Object.fromEntries(f.ratings.map((r) => [r.vacancy_question_id, r.rating])), overall: f.overall_rating, decision: f.decision ?? "" };
      onChanged(after);
      return after;
    });

  /** One trait, saved as it is tapped; put back to what was last kept when the save fails. */
  const rate = async (q: string, rating: number | null) => {
    setLocal((s) => ({ ...s, [q]: rating }));
    setProblem(null);
    unmark("ratings");
    try {
      await put({ ratings: [{ vacancy_question_id: q, rating }] });
    } catch (e) {
      setLocal((s) => ({ ...s, [q]: kept.current.ratings[q] ?? null }));
      setProblem(e instanceof ApiError ? e.message : "That rating was not saved");
    }
  };
  const rateOverall = async (rating: number | null) => {
    setOverall(rating);
    setProblem(null);
    unmark("overall_rating");
    try {
      await put({ overall_rating: rating });
    } catch (e) {
      setOverall(kept.current.overall);
      setProblem(e instanceof ApiError ? e.message : "That rating was not saved");
    }
  };
  const decide = async (d: InterviewDecision) => {
    setDecision(d);
    unmark("decision");
    try {
      await put({ decision: d });
    } catch (e) {
      setDecision(kept.current.decision);
      say(e);
    }
  };
  const saveText = async () => {
    setProblem(null);
    unmark("comments", "private_notes");
    try {
      await put({ comments, private_notes: notes });
      return true;
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setMarks(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k, m[0] ?? ""])));
      else say(e);
      return false;
    }
  };
  const saveDraft = async () => {
    if (await saveText()) toast("Card saved");
  };
  /** What Submit would be refused for, said before asking to confirm (the server checks it again). */
  const unfinished = () => {
    const out: Record<string, string> = {};
    if (!decision) out.decision = "Give your decision";
    const missing = traits.filter((t) => ratingOf(t.vacancy_question_id) === null).length;
    if (traits.length && missing) out.ratings = `Rate ${missing === 1 ? "the last trait" : `${missing} more traits`}`;
    if (!traits.length && !overall) out.overall_rating = "Give a rating";
    return out;
  };
  const submit = async () => {
    if (!(await saveText())) return;
    const left = unfinished();
    if (Object.keys(left).length) {
      setMarks(left);
      return setProblem("Finish your card first");
    }
    const yes = await confirm({ title: "Submit Card", body: "Your card locks once it is submitted.", confirmLabel: "Submit Card" });
    if (!yes) return;
    try {
      const after = await send.run({ params: { id }, body: {} });
      invalidate("/api/v1/recruitment/interviews");
      onChanged(after);
      close();
      toast(after.round_status === "closed" ? "Card submitted. The round is closed" : "Card submitted");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setMarks(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [k, m[0] ?? ""])));
        setProblem(e.message);
      } else say(e);
    }
  };
  const tidyNotes = async () => {
    if (comments.trim().length < 20) return toast.error("Write a little more first");
    try {
      const d = await tidy.run({ body: { text: comments } });
      if (!d.available || !d.text) return toast.error("Tidy With AI is not available now");
      setComments(d.text);
      toast("Tidied. Read it before saving");
    } catch (e) {
      say(e);
    }
  };
  const mark = (k: string) => (marks[k] ? { state: "bad" as const, message: marks[k] } : {});

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <b>{interview.candidate_name}</b> · {interview.vacancy.title}
        </p>
        {interview.cv_document_id && (
          <Button size="sm" icon="doc" onClick={() => saveFile(`/api/v1/recruitment/interviews/${id}/cv`, `${interview.candidate_name} CV.pdf`)}>View CV</Button>
        )}
      </div>
      {traits.length ? (
        <ol className="m-0 list-none space-y-3 p-0" aria-label="Traits" data-copy="content">
          {traits.map((t, i) => (
            <li key={t.vacancy_question_id} className="border-t border-border pt-3 first:border-0 first:pt-0">
              <Field label={`${i + 1}. ${t.prompt}`}>
                <RatingField
                  value={ratingOf(t.vacancy_question_id)}
                  onChange={(n) => rate(t.vacancy_question_id, n)}
                  onClear={() => rate(t.vacancy_question_id, null)}
                  disabled={submitted}
                />
              </Field>
            </li>
          ))}
        </ol>
      ) : (
        <Field label="Overall Rating" {...mark("overall_rating")}>
          <RatingField value={overall} onChange={rateOverall} onClear={() => rateOverall(null)} disabled={submitted} />
        </Field>
      )}
      <p className="my-3 text-sm" aria-live="polite">
        Your score <b className="tabular-nums">{myScore === null ? "–" : myScore.toFixed(1)}</b>
        {traits.length > 0 && <span className="text-subtle-foreground">{` · ${rated.length} of ${traits.length} rated`}</span>}
      </p>
      {marks.ratings && <p className="text-destructive mb-2 text-sm font-semibold">{marks.ratings}</p>}
      <Field label="Decision" {...mark("decision")}>
        <ChoiceField options={DECISIONS} value={decision as InterviewDecision} onChange={decide} disabled={submitted ? DECISIONS.map(([d]) => d) : undefined} />
      </Field>
      <Field label="Comments" optional {...mark("comments")}>
        <TextAreaField value={comments} onChange={setComments} rows={4} disabled={submitted} />
      </Field>
      {!submitted && ai.data?.available && (
        <Button size="sm" icon="spark" className="mb-3" onClick={tidyNotes}>Tidy With AI</Button>
      )}
      <Field label={<HelpTerm help={PRIVATE_HELP}>Private Notes</HelpTerm>} optional {...mark("private_notes")}>
        <TextAreaField value={notes} onChange={setNotes} rows={3} disabled={submitted} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {!submitted && <Button onClick={saveDraft}>Save Draft</Button>}
        {!submitted && <Button variant="primary" onClick={submit}>Submit Card</Button>}
      </FormFooter>
    </>
  );
}
