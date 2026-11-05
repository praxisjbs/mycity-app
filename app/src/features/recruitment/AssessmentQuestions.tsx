/**
 * An assessment's questions (docs/guides/recruitment.md §6.7): a choice with its options and the
 * points each scores, a written answer, or a file (up to 25 MB, or a link) marked by hand up to its
 * points. Suggest With AI proposes questions for the type; nothing is kept until Save Questions.
 * Once an assessment has been sent its questions are fixed (switch it off and make another).
 */
import { useState } from "react";
import assessmentSchemas from "@mycity/contract/schemas/assessments.js";
import type { AssessmentDetail } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useApi, useMutation } from "@/api/hooks";
import { Button, Card, CardHeader, Field, FormError, FormFooter, Grid, HelpTerm, NumberField, SelectField, TextAreaField, TextField, toast } from "@mycity/ui";
import { say } from "./shared";

type Option = { text: string; points: string };
type Question = { question_type: "choice" | "text" | "file"; prompt: string; options: Option[]; max_score: string };
type Issue = { path: PropertyKey[]; message: string };

const KINDS: Array<[Question["question_type"], string]> = [
  ["choice", "Choice"],
  ["text", "Written"],
  ["file", "File or Link"],
];

const fromDetail = (a: AssessmentDetail): Question[] =>
  a.questions.map((q) => ({
    question_type: q.question_type,
    prompt: q.prompt,
    options: (q.options ?? []).map((o) => ({ text: o.text, points: String(o.points) })),
    max_score: q.question_type === "choice" ? "" : String(q.max_score),
  }));

const bodyOf = (qs: Question[]) => ({
  questions: qs.map((q) =>
    q.question_type === "choice"
      ? { question_type: q.question_type, prompt: q.prompt, options: q.options.map((o) => ({ text: o.text, points: o.points.trim() === "" ? undefined : Number(o.points) })) }
      : { question_type: q.question_type, prompt: q.prompt, ...(q.max_score ? { max_score: Number(q.max_score) } : {}) },
  ),
});

export function AssessmentQuestions({ assessment, close, onSaved }: { assessment: AssessmentDetail; close: () => void; onSaved: () => void }) {
  const [qs, setQs] = useState<Question[]>(fromDetail(assessment));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const ai = useApi("GET /api/v1/recruitment/vacancies/assist");
  const suggest = useMutation("POST /api/v1/recruitment/assessments/assist");
  const save = useMutation("PUT /api/v1/recruitment/assessments/:id/questions");
  const place = (issues: Issue[]) => {
    const out: Record<string, string> = {};
    for (const i of issues) {
      // `questions.<i>.<field>`, or `questions.<i>.options.<j>.<text|points>` for one option.
      const key = i.path[0] === "questions" && i.path.length > 1 ? i.path.slice(1).map(String).join(".") || "all" : "all";
      out[key] ??= i.message;
    }
    return out;
  };
  const submit = async () => {
    setProblem(null);
    const checked = (assessmentSchemas.AssessmentQuestionsSave as { safeParse: (v: unknown) => { success: boolean; error?: { issues: Issue[] } } }).safeParse(bodyOf(qs));
    if (!checked.success) {
      const placed = place(checked.error?.issues ?? []);
      setErrors(placed);
      return setProblem(placed.all ?? null);
    }
    setErrors({});
    try {
      await save.run({ params: { id: assessment.assessment_definition_id }, body: bodyOf(qs) as never });
      close();
      onSaved();
      toast("Questions saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        const placed = place(Object.entries(e.fields).map(([k, m]) => ({ path: k.split("."), message: m[0] ?? "" })));
        setErrors(placed);
        setProblem(placed.all ?? (e.status === 422 ? null : e.message));
      } else say(e);
    }
  };
  const suggestAi = async () => {
    try {
      const d = await suggest.run({ body: { assessment_type: assessment.assessment_type, instruction: assessment.instructions ?? assessment.name, count: 5 } as never });
      if (!d.available) return toast.error("Suggest With AI is not available now");
      setQs((x) => [
        ...x,
        ...d.questions.map((q) => ({
          question_type: q.question_type,
          prompt: q.prompt,
          options: (q.options ?? []).map((o) => ({ text: o.text, points: String(o.points) })),
          max_score: q.max_score === null ? "" : String(q.max_score),
        })),
      ].slice(0, 60));
      toast("Suggestions added. Read them before saving");
    } catch (e) {
      say(e);
    }
  };
  const edit = (i: number, patch: Partial<Question>) => setQs((x) => x.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const editOption = (i: number, j: number, patch: Partial<Option>) => edit(i, { options: qs[i]!.options.map((o, k) => (k === j ? { ...o, ...patch } : o)) });
  const mark = (key: string) => (errors[key] ? { state: "bad" as const, message: errors[key] } : {});
  return (
    <>
      {ai.data?.available && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" icon="spark" onClick={suggestAi}>Suggest With AI</Button>
        </div>
      )}
      {qs.map((q, i) => (
        <Card key={i} className="mb-3">
          <CardHeader title={`Question ${i + 1}`} right={<Button size="sm" variant="ghost" icon="trash" onClick={() => setQs((x) => x.filter((_, k) => k !== i))}>Remove</Button>} />
          <Field label="Question" {...mark(`${i}.prompt`)}>
            <TextAreaField value={q.prompt} onChange={(prompt) => edit(i, { prompt })} rows={3} />
          </Field>
          <Grid cols={2}>
            <Field label="Answer" {...mark(`${i}.question_type`)}>
              <SelectField options={KINDS} value={q.question_type} onChange={(t) => edit(i, { question_type: t as Question["question_type"], options: t === "choice" && !q.options.length ? [{ text: "", points: "1" }, { text: "", points: "0" }] : q.options })} />
            </Field>
            {q.question_type !== "choice" && (
              <Field label="Most Points" {...mark(`${i}.max_score`)}>
                <NumberField decimal value={q.max_score} onChange={(max_score: string) => edit(i, { max_score })} />
              </Field>
            )}
          </Grid>
          {q.question_type === "choice" && (
            <>
              {q.options.map((o, j) => (
                <div key={j} className="mb-2 flex items-end gap-2">
                  <Field label={`Option ${j + 1}`} className="min-w-0 flex-1" {...mark(`${i}.options.${j}.text`)}>
                    <TextField value={o.text} onChange={(text) => editOption(i, j, { text })} maxLength={300} />
                  </Field>
                  <Field label={<HelpTerm help="What each option scores.">Points</HelpTerm>} className="w-24" {...mark(`${i}.options.${j}.points`)}>
                    <NumberField decimal value={o.points} onChange={(points: string) => editOption(i, j, { points })} />
                  </Field>
                  <Button size="sm" variant="ghost" icon="x" onClick={() => edit(i, { options: q.options.filter((_, k) => k !== j) })}>Remove</Button>
                </div>
              ))}
              {errors[`${i}.options`] && <p className="text-destructive mb-2 text-sm font-semibold">{errors[`${i}.options`]}</p>}
              {q.options.length < 8 && <Button size="sm" icon="plus" onClick={() => edit(i, { options: [...q.options, { text: "", points: "0" }] })}>Add Option</Button>}
            </>
          )}
        </Card>
      ))}
      {qs.length < 60 && <Button size="sm" icon="plus" onClick={() => setQs((x) => [...x, { question_type: "text", prompt: "", options: [], max_score: "10" }])}>Add Question</Button>}
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Questions</Button>
      </FormFooter>
    </>
  );
}
