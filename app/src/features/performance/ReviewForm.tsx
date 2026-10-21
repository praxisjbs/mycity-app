import { useState } from "react";
import type { Dictation, ReviewDetail, ReviewForm as Half, ReviewSave } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { saveFile } from "@/api/download";
import { upload } from "@/api/upload";
import {
  Button,
  Card,
  CardHeader,
  ChoiceField,
  EmptyState,
  Field,
  FormFooter,
  HelpTerm,
  KeyValue,
  SegmentedControl,
  StatusPill,
  TextAreaField,
  TextField,
  toast,
  VoiceField,
} from "@mycity/ui";
import { ApprovalCard } from "./approval";
import { percent, progressStatus, rating, reviewStatus } from "./status";

/**
 * One review, as its reader may see it (A17, A18; docs/guides/performance.md §10.1): the self
 * review beside the manager's once it is in, each KPI's rating and comment, each question's
 * answer typed or dictated, and the approval. Shared by Performance · Reviews and My Review in
 * ESS, which differ only in the routes they call.
 */
const DICTATE_HELP = "Speak your answer. We tidy the wording and you choose which to keep.";
const SCORES: Array<[string, string]> = [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]];

export interface ReviewRoutes {
  save: (body: ReviewSave) => Promise<ReviewDetail>;
  submit: () => Promise<ReviewDetail>;
  /** The multipart path dictation posts to. */
  dictation: string;
  decide?: (body: { decision: "approve" | "return"; reason?: string }) => Promise<ReviewDetail>;
}

type Draft = {
  overall: string;
  summary: string;
  items: Record<string, { score: string; comment: string }>;
  answers: Record<string, { text: string; dictation?: Dictation }>;
};

const draftOf = (form: Half): Draft => ({
  overall: form.overall_score ? String(form.overall_score) : "",
  summary: form.summary ?? "",
  items: Object.fromEntries(form.items.map((i) => [i.employee_target_id, { score: i.score ? String(i.score) : "", comment: i.comment ?? "" }])),
  answers: Object.fromEntries(form.answers.map((a) => [a.performance_cycle_question_id, { text: a.answer_text ?? "" }])),
});

export function ReviewPanel({ detail, routes, onChange }: { detail: ReviewDetail; routes: ReviewRoutes; onChange: (next: ReviewDetail) => void }) {
  const manager = detail.review_type !== "self";
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader title={detail.employee.display_name} record right={<StatusPill s={reviewStatus(detail.status)} />} />
        <KeyValue items={[["Cycle", detail.cycle.name], ["Review", manager ? "Manager" : "Self"]]} />
        {detail.document && (
          <Button size="sm" icon="download" className="mt-2" onClick={() => saveFile(`/api/v1/documents/${detail.document!.document_id}/content`, detail.document!.file_name)}>
            Download Review
          </Button>
        )}
      </Card>
      {detail.waiting_for_self && <EmptyState illustration="Empty" title="Waiting for Self Review" />}
      {detail.other && <ReadHalf title={detail.other.review_type === "self" ? "Self Review" : "Manager Review"} half={detail.other} />}
      {detail.form && (detail.can_edit ? <EditHalf detail={detail} form={detail.form} routes={routes} onChange={onChange} /> : <ReadHalf title={manager ? "Manager Review" : "Self Review"} half={detail.form} />)}
      {routes.decide && (
        <ApprovalCard
          route={detail.route}
          decisions={detail.decisions}
          canDecide={detail.can_decide}
          noun="Review"
          decide={async (body) => {
            const next = await routes.decide!(body);
            onChange(next);
            toast(body.decision === "approve" ? "Review approved" : "Review returned");
          }}
        />
      )}
    </div>
  );
}

function ReadHalf({ title, half }: { title: string; half: Half }) {
  return (
    <Card>
      <CardHeader title={title} right={<StatusPill s={{ tone: "info", text: rating(half.overall_score) ?? "Not rated" }} />} />
      <KeyValue
        layout="stacked"
        items={[
          ...half.items.map((i) => [i.title, [i.score ? `${i.score} of 5` : null, i.comment].filter(Boolean).join(". ") || null] as [string, string | null]),
          ...half.answers.map((a) => [a.prompt, a.answer_text] as [string, string | null]),
          ...(half.summary ? [["Summary", half.summary] as [string, string]] : []),
        ]}
      />
    </Card>
  );
}

function EditHalf({ detail, form, routes, onChange }: { detail: ReviewDetail; form: Half; routes: ReviewRoutes; onChange: (next: ReviewDetail) => void }) {
  const manager = form.review_type !== "self";
  const [d, setD] = useState<Draft>(() => draftOf(form));
  const [missing, setMissing] = useState(false);
  const setItem = (id: string, patch: Partial<Draft["items"][string]>) => setD({ ...d, items: { ...d.items, [id]: { ...d.items[id], ...patch } } });
  const setAnswer = (id: string, patch: Partial<Draft["answers"][string]>) => setD({ ...d, answers: { ...d.answers, [id]: { ...d.answers[id], ...patch } } });

  const body = (): ReviewSave => ({
    overall_score: d.overall ? Number(d.overall) : null,
    summary: d.summary.trim() || null,
    items: form.items.map((i) => ({
      employee_target_id: i.employee_target_id,
      score: d.items[i.employee_target_id].score ? Number(d.items[i.employee_target_id].score) : null,
      comment: d.items[i.employee_target_id].comment.trim() || null,
    })),
    answers: form.answers.map((a) => {
      const x = d.answers[a.performance_cycle_question_id];
      const said = x.dictation && (x.text === x.dictation.transcript || x.text === x.dictation.tidied);
      return { performance_cycle_question_id: a.performance_cycle_question_id, answer_text: x.text.trim() || null, ...(said ? { dictation_id: x.dictation!.dictation_id } : {}) };
    }),
  });

  const save = async () => {
    try {
      onChange(await routes.save(body()));
      toast("Draft saved");
    } catch (e) {
      if (e instanceof ApiError) toast(e.message);
    }
  };
  const submit = async () => {
    if (!d.overall) return setMissing(true);
    try {
      await routes.save(body());
      onChange(await routes.submit());
      toast("Review handed in");
    } catch (e) {
      if (e instanceof ApiError) toast(e.message);
    }
  };

  const dictate = (questionId: string) => async (audio: Blob) => {
    const file = new File([audio], "answer.webm", { type: audio.type || "audio/webm" });
    const out = (await upload({
      endpoint: routes.dictation,
      file,
      fields: { performance_cycle_question_id: questionId, duration_s: "60" },
    })) as unknown as Partial<Dictation>;
    if (!out.transcript) throw new Error("Could not hear that, try again");
    const dictation = out as Dictation;
    setAnswer(questionId, { dictation, text: dictation.tidied ?? dictation.transcript });
    return dictation.tidied ?? dictation.transcript;
  };

  return (
    <Card>
      <CardHeader title={manager ? "Your Review" : "My Review"} />
      {form.items.map((i) => (
        <div key={i.employee_target_id} className="mb-3 border-b border-border pb-3 last:border-0">
          <div className="mb-1 flex items-center justify-between gap-2">
            <b className="text-xs">{i.title}</b>
            <span className="inline-flex items-center gap-2 text-2xs">
              {percent(i.attainment)}
              <StatusPill s={progressStatus(i.progress_status)} />
            </span>
          </div>
          <Field label="Rating">
            <ChoiceField value={d.items[i.employee_target_id].score} onChange={(v) => setItem(i.employee_target_id, { score: v })} options={SCORES} />
          </Field>
          <Field label="Comment" optional>
            <TextField value={d.items[i.employee_target_id].comment} onChange={(v) => setItem(i.employee_target_id, { comment: v })} />
          </Field>
        </div>
      ))}
      {form.answers.map((a) => {
        const x = d.answers[a.performance_cycle_question_id];
        return (
          <div key={a.performance_cycle_question_id} className="mb-3">
            <Field label={a.prompt} optional>
              <TextAreaField value={x.text} onChange={(v) => setAnswer(a.performance_cycle_question_id, { text: v })} rows={4} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <HelpTerm help={DICTATE_HELP}>Dictate</HelpTerm>
              <VoiceField label="Your Answer" maxSeconds={180} transcribe={dictate(a.performance_cycle_question_id)} onTranscript={() => undefined} />
            </div>
            {x.dictation && x.dictation.tidied && x.dictation.tidied !== x.dictation.transcript && (
              <SegmentedControl
                className="mt-2"
                label="Which words to keep"
                value={x.text === x.dictation.transcript ? "spoken" : "tidied"}
                onChange={(v) => setAnswer(a.performance_cycle_question_id, { text: v === "spoken" ? x.dictation!.transcript : x.dictation!.tidied! })}
                options={[["tidied", "Use Tidied"], ["spoken", "Use As Spoken"]]}
              />
            )}
          </div>
        );
      })}
      <Field label="Overall Rating" state={missing && !d.overall ? "bad" : undefined} message={missing && !d.overall ? "Give a rating" : undefined}>
        <ChoiceField value={d.overall} onChange={(v) => setD({ ...d, overall: v })} options={SCORES} />
      </Field>
      {manager && (
        <Field label="Summary" optional>
          <TextAreaField value={d.summary} onChange={(v) => setD({ ...d, summary: v })} rows={3} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={save}>Save Draft</Button>
        <Button variant="primary" onClick={submit}>Submit Review</Button>
      </FormFooter>
      {detail.status === "returned" && detail.decisions.length > 0 && (
        <p className="mt-2 text-xs text-destructive">{detail.decisions[detail.decisions.length - 1].reason}</p>
      )}
    </Card>
  );
}
