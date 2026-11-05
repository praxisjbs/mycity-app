/**
 * My Card: a panelist's own blind card for one interview (docs/guides/recruitment.md §3 step 9, §6.6,
 * §10), MyCity's Interview Assessment Format on screen. The role's traits, numbered and the same for
 * every candidate, each rated 1 to 10 with ten stars; each star is saved the moment it is tapped and
 * put back, with the error, when the save fails; a tap on the star already chosen takes it back to
 * not rated. The panelist's own score, the mean of what they have rated, shows as they go. Then a
 * decision, comments and private notes, and Submit Card, which locks it. Nobody else reads it until
 * the round closes; private notes stay the author's always.
 */
import { useState } from "react";
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
  const saved = Object.fromEntries((mine?.ratings ?? []).map((r) => [r.vacancy_question_id, r.rating as number | null]));
  // Optimistic, by trait: a star that waits for the round trip before it fills reads as a missed tap.
  const [local, setLocal] = useState<Record<string, number | null>>({});
  const [overall, setOverall] = useState<number | null>(mine?.overall_rating ?? null);
  const [decision, setDecision] = useState<InterviewDecision | "">(mine?.decision ?? "");
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
  const ratingOf = (q: string) => (q in local ? local[q] : (saved[q] ?? null));
  const rated = traits.map((t) => ratingOf(t.vacancy_question_id)).filter((n): n is number => n !== null);
  const myScore = traits.length ? (rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null) : overall;

  const put = (body: NonNullable<NonNullable<Parameters<typeof save.run>[0]>["body"]>) => save.run({ params: { id }, body });

  /** One trait, saved as it is tapped; put back where it was when the save fails. */
  const rate = async (q: string, rating: number | null) => {
    setLocal((s) => ({ ...s, [q]: rating }));
    setProblem(null);
    try {
      onChanged(await put({ ratings: [{ vacancy_question_id: q, rating }] }));
    } catch (e) {
      setLocal((s) => ({ ...s, [q]: saved[q] ?? null }));
      setProblem(e instanceof ApiError ? e.message : "That rating was not saved");
    }
  };
  const rateOverall = async (rating: number | null) => {
    const before = overall;
    setOverall(rating);
    setProblem(null);
    try {
      onChanged(await put({ overall_rating: rating }));
    } catch (e) {
      setOverall(before);
      setProblem(e instanceof ApiError ? e.message : "That rating was not saved");
    }
  };
  const decide = async (d: InterviewDecision) => {
    const before = decision;
    setDecision(d);
    try {
      onChanged(await put({ decision: d }));
    } catch (e) {
      setDecision(before);
      say(e);
    }
  };
  const saveText = async () => {
    setProblem(null);
    try {
      onChanged(await put({ comments, private_notes: notes }));
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
  const submit = async () => {
    if (!(await saveText())) return;
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
        {traits.length > 0 && <span className="text-text-3">{` · ${rated.length} of ${traits.length} rated`}</span>}
      </p>
      {marks.ratings && <p className="text-err-ink mb-2 text-sm font-semibold">{marks.ratings}</p>}
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
