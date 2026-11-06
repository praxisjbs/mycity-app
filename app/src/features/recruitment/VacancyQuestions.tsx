/**
 * A vacancy's Questions and Scorecard (docs/guides/recruitment.md §6.1, §6.5, §6.6). Questions holds
 * what Apply asks (up to 10: yes or no, a line of text, or a choice) and the interview traits each
 * panelist rates from 1 to 10 (up to 20, MyCity's ten from Careers Settings to start). Suggest With
 * AI proposes some of each; nothing is kept until Save Questions. The Scorecard switches off the
 * parts a role skips and weighs the rest to 100.
 */
import { useState } from "react";
import vacancySchemas from "@mycity/contract/schemas/vacancies.js";
import type { ScorecardWeight, VacancyDetail, VacancyQuestion } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useApi, useMutation } from "@/api/hooks";
import { Button, Card, CardHeader, CheckboxField, ChoiceField, Field, FormError, FormFooter, HelpTerm, NumberField, TextField, toast } from "@mycity/ui";
import { say } from "./shared";

type Ask = { id?: string; question_type: "yes_no" | "text" | "choice"; prompt: string; options: string; required: boolean };
type Trait = { id?: string; prompt: string };

const ASK_TYPES: Array<[Ask["question_type"], string]> = [
  ["yes_no", "Yes or No"],
  ["text", "Text"],
  ["choice", "Choice"],
];
const MAX_ASKS = 10;
const MAX_TRAITS = 20;

const askOf = (q: VacancyQuestion): Ask => ({
  id: q.vacancy_question_id,
  question_type: q.question_type === "rating" ? "text" : q.question_type,
  prompt: q.prompt,
  options: (q.options ?? []).join(", "),
  required: q.required,
});

export function QuestionsForm({ vacancy, close, onSaved }: { vacancy: VacancyDetail; close: () => void; onSaved: () => void }) {
  const live = vacancy.questions.filter((q) => q.active);
  const [asks, setAsks] = useState<Ask[]>(live.filter((q) => q.purpose === "application").map(askOf));
  const [traits, setTraits] = useState<Trait[]>(live.filter((q) => q.purpose === "interview").map((q) => ({ id: q.vacancy_question_id, prompt: q.prompt })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const settings = useApi("GET /api/v1/recruitment/vacancies/settings");
  const ai = useApi("GET /api/v1/recruitment/vacancies/assist");
  const suggest = useMutation("POST /api/v1/recruitment/vacancies/:id/assist/questions");
  const save = useMutation("PUT /api/v1/recruitment/vacancies/:id/questions");

  const body = () => ({
    questions: [
      ...asks.map((a) => ({
        ...(a.id ? { vacancy_question_id: a.id } : {}),
        purpose: "application" as const,
        question_type: a.question_type,
        prompt: a.prompt,
        ...(a.question_type === "choice" ? { options: a.options.split(",").map((o) => o.trim()).filter(Boolean) } : {}),
        required: a.required,
      })),
      ...traits.map((t) => ({ ...(t.id ? { vacancy_question_id: t.id } : {}), purpose: "interview" as const, question_type: "rating" as const, prompt: t.prompt, required: true })),
    ],
  });
  /** Each issue on its row: `questions.<n>.<field>`, n counted over the asks then the traits. */
  const place = (issues: Array<{ path: PropertyKey[]; message: string }>) => {
    const out: Record<string, string> = {};
    for (const i of issues) {
      const n = Number(i.path[1]);
      const key = Number.isInteger(n) ? (n < asks.length ? `ask.${n}.${String(i.path[2] ?? "prompt")}` : `trait.${n - asks.length}`) : "all";
      out[key] ??= i.message;
    }
    return out;
  };
  const submit = async () => {
    setProblem(null);
    const checked = (vacancySchemas.VacancyQuestionsSave as { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }).safeParse(body());
    if (!checked.success) {
      const placed = place(checked.error?.issues ?? []);
      setErrors(placed);
      if (placed.all) setProblem(placed.all);
      return;
    }
    setErrors({});
    try {
      await save.run({ params: { id: vacancy.vacancy_id }, body: body() });
      close();
      onSaved();
      toast("Questions saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors(place(Object.entries(e.fields).map(([k, m]) => ({ path: k.split("."), message: m[0] ?? "Check this" }))));
        setProblem(e.status === 422 ? null : e.message);
      } else say(e);
    }
  };
  const suggestAi = async () => {
    try {
      const d = await suggest.run({ params: { id: vacancy.vacancy_id }, body: {} });
      if (!d.available) return toast.error("Suggest With AI is not available now");
      const newAsks = d.questions.filter((q) => q.purpose === "application").map((q) => ({ question_type: (q.question_type === "rating" ? "text" : q.question_type) as Ask["question_type"], prompt: q.prompt, options: (q.options ?? []).join(", "), required: false }));
      const newTraits = d.questions.filter((q) => q.purpose === "interview").map((q) => ({ prompt: q.prompt }));
      setAsks((a) => [...a, ...newAsks].slice(0, MAX_ASKS));
      setTraits((t) => [...t, ...newTraits.filter((n) => !t.some((x) => x.prompt.toLowerCase() === n.prompt.toLowerCase()))].slice(0, MAX_TRAITS));
      toast("Suggestions added. Read them before saving");
    } catch (e) {
      say(e);
    }
  };
  const editAsk = (i: number, patch: Partial<Ask>) => setAsks((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const editTrait = (i: number, prompt: string) => setTraits((t) => t.map((x, k) => (k === i ? { ...x, prompt } : x)));
  const mark = (key: string) => (errors[key] ? { state: "bad" as const, message: errors[key] } : {});

  return (
    <>
      <Card>
        <CardHeader title="Apply Questions" right={ai.data?.available ? <Button size="sm" icon="spark" onClick={suggestAi}>Suggest With AI</Button> : undefined} />
        {asks.map((a, i) => (
          <div key={a.id ?? `new-${i}`} className="mb-3 border-b border-border pb-3">
            <Field label={`Question ${i + 1}`} {...mark(`ask.${i}.prompt`)}>
              <TextField value={a.prompt} onChange={(prompt) => editAsk(i, { prompt })} maxLength={500} />
            </Field>
            <Field label="Answer" {...mark(`ask.${i}.question_type`)}>
              <ChoiceField options={ASK_TYPES} value={a.question_type} onChange={(t) => editAsk(i, { question_type: t as Ask["question_type"] })} />
            </Field>
            {a.question_type === "choice" && (
              <Field label="Options" {...mark(`ask.${i}.options`)}>
                <TextField value={a.options} onChange={(options) => editAsk(i, { options })} placeholder="Lagos, Abuja, Remote" />
              </Field>
            )}
            <div className="flex items-center justify-between gap-2">
              <CheckboxField label="Required" value={a.required} onChange={(required) => editAsk(i, { required })} />
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setAsks((x) => x.filter((_, k) => k !== i))}>Remove</Button>
            </div>
          </div>
        ))}
        {asks.length < MAX_ASKS && (
          <Button size="sm" icon="plus" onClick={() => setAsks((a) => [...a, { question_type: "yes_no", prompt: "", options: "", required: true }])}>Add Question</Button>
        )}
      </Card>
      <Card className="mt-3">
        <CardHeader
          title={<HelpTerm help="Each panelist rates every trait from 1 to 10. With none, they give one overall rating.">Interview Traits</HelpTerm>}
          right={
            settings.data?.default_traits.length ? (
              <Button size="sm" onClick={() => setTraits(settings.data!.default_traits.map((prompt) => ({ prompt })))}>Use Defaults</Button>
            ) : undefined
          }
        />
        {traits.map((t, i) => (
          <div key={t.id ?? `new-${i}`} className="mb-2 flex items-end gap-2">
            <Field label={`Trait ${i + 1}`} className="min-w-0 flex-1" {...mark(`trait.${i}`)}>
              <TextField value={t.prompt} onChange={(p) => editTrait(i, p)} maxLength={500} />
            </Field>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setTraits((x) => x.filter((_, k) => k !== i))}>Remove</Button>
          </div>
        ))}
        {traits.length < MAX_TRAITS && (
          <Button size="sm" icon="plus" onClick={() => setTraits((t) => [...t, { prompt: "" }])}>Add Trait</Button>
        )}
      </Card>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Questions</Button>
      </FormFooter>
    </>
  );
}

/** The five parts, each on or off with its weight; the parts on add up to 100. */
export function ScorecardForm({ vacancy, close, onSaved }: { vacancy: VacancyDetail; close: () => void; onSaved: () => void }) {
  const [parts, setParts] = useState<ScorecardWeight[]>(vacancy.scorecard.map((p) => ({ ...p })));
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation("PUT /api/v1/recruitment/vacancies/:id/scorecard");
  const total = parts.reduce((n, p) => n + (p.active ? p.weight : 0), 0);
  const set = (code: string, patch: Partial<ScorecardWeight>) =>
    setParts((ps) => ps.map((p) => (p.code === code ? { ...p, ...patch, ...(patch.active === false ? { weight: 0 } : {}) } : p)));
  const body = () => ({ parts: Object.fromEntries(parts.map((p) => [p.code, { active: p.active, weight: p.weight }])) as never });
  const submit = async () => {
    const checked = (vacancySchemas.ScorecardSave as { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ message: string }> } } }).safeParse(body());
    if (!checked.success) return setProblem(checked.error?.issues[0]?.message ?? "Check the weights");
    setProblem(null);
    try {
      await save.run({ params: { id: vacancy.vacancy_id }, body: body() });
      close();
      onSaved();
      toast("Scorecard saved");
    } catch (e) {
      if (e instanceof ApiError) setProblem(e.message);
      else say(e);
    }
  };
  return (
    <>
      {parts.map((p) => (
        <div key={p.code} className="mb-2 flex items-end justify-between gap-2">
          <CheckboxField label={p.name} value={p.active} onChange={(active) => set(p.code, { active })} />
          {p.active ? (
            <Field label="Weight" className="w-28">
              <NumberField value={String(p.weight)} onChange={(w: string) => set(p.code, { weight: Math.max(0, Math.min(100, Number.parseInt(w || "0", 10) || 0)) })} />
            </Field>
          ) : (
            <span className="pb-2 text-right text-sm text-subtle-foreground">Off</span>
          )}
        </div>
      ))}
      <p className={total === 100 ? "text-sm" : "text-destructive text-sm font-semibold"}>Total {total} of 100</p>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Scorecard</Button>
      </FormFooter>
    </>
  );
}
