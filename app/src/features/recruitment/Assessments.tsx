/**
 * Recruitment · Assessments (docs/guides/recruitment.md §6.7, §10): the library (psychometric,
 * technical, case study and practical take-home briefs such as MyCity's Graphics and Motion Design
 * assessment) and the sittings sent from it. An assessment opens with its questions and points, Edit,
 * Questions, Activate or Deactivate, and Send to Candidates; a sitting opens with each answer (a file
 * to open, or the link given) and Mark Answers. `?marking=true` opens the sittings waiting to be marked.
 */
import { useEffect, useRef, useState } from "react";
import assessmentSchemas from "@mycity/contract/schemas/assessments.js";
import type { Assessment, AssessmentDetail, Sitting, SittingDetail } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { saveBlob, saveFile } from "@/api/download";
import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  formatDate,
  formatDateTime,
  FormError,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  NumberField,
  PageHeader,
  Pill,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField,
  toast,
  Toolbar,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { AssessmentQuestions } from "./AssessmentQuestions";
import { ASSESSMENT_TYPE, bodySchema, pill, say, sayRefusal, SITTING_STATUS, STAGE_LABEL, useVacancyOptions } from "./shared";

const TYPES = Object.entries(ASSESSMENT_TYPE) as Array<[Assessment["assessment_type"], string]>;
const POINTS_HELP = "What each option scores.";

export function Assessments() {
  const modal = useModal();
  const { can } = useAuth();
  const mayCreate = can("recruitment", "create");
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"library" | "sittings">(params.get("marking") === "true" ? "sittings" : "library");
  const [marking, setMarking] = useState(params.get("marking") === "true");
  const summary = useApi("GET /api/v1/recruitment/assessments/summary");
  const library = usePaged("GET /api/v1/recruitment/assessments");
  const sittings = usePaged("GET /api/v1/recruitment/assessments/sittings", { filters: marking ? { marking: "true" } : {} });
  const openAssessment = (id: string, title = "Assessment") => modal.open({ title, wide: true, body: (close) => <AssessmentSheet id={id} close={close} /> });
  const openSittingId = (id: string, title = "Sitting") => modal.open({ title, wide: true, body: (close) => <SittingSheet id={id} close={close} /> });
  const openSitting = (s: Sitting) => openSittingId(s.application_assessment_id, s.candidate_name);
  const create = () => modal.open({ title: "New Assessment", body: (close) => <AssessmentForm close={close} onSaved={(a) => openAssessment(a.assessment_definition_id, a.name)} /> });
  // useScreenAction also answers `?action=new`.
  useScreenAction(mayCreate ? { label: "New Assessment", onSelect: create } : null);
  useNewLink(mayCreate ? create : null);

  // `?marking=true` (⌘K, the assistant) shows the sittings waiting to be marked, also when already here.
  const askedMarking = params.get("marking") === "true";
  useEffect(() => {
    if (!askedMarking) return;
    setView("sittings");
    setMarking(true);
    setParams({ marking: null }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedMarking]);

  // An assessment (`?id=`) or a sitting (`?sitting=`, the route map's link for one) opens once and leaves the address.
  const linked = params.get("id");
  const sittingLinked = params.get("sitting");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const ask = linked ? `id:${linked}` : sittingLinked ? `sitting:${sittingLinked}` : null;
    if (!ask) return void (opened.current = null);
    if (opened.current === ask) return;
    opened.current = ask;
    setParams({ id: null, sitting: null }, { replace: true });
    if (linked) openAssessment(linked);
    else openSittingId(sittingLinked!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, sittingLinked]);

  const s = summary.data;
  const counted = (n: number | null | undefined) => (n === undefined || n === null ? "–" : String(Math.round(n)));
  return (
    <>
      <PageHeader title="Assessments" actions={mayCreate ? <Button variant="primary" icon="plus" onClick={create}>New Assessment</Button> : undefined} />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "Active", value: counted(s?.active) },
          { label: "Sent", value: counted(s?.sent) },
          { label: "Awaiting Marking", value: counted(s?.awaiting_marking), tone: s?.awaiting_marking ? "warn" : undefined },
          { label: "Average Score", value: counted(s?.average_score) },
        ]}
      />
      <Toolbar>
        <SegmentedControl label="Which List" value={view} onChange={setView} options={[["library", "Assessments"], ["sittings", "Sittings"]]} />
        {view === "sittings" && <SegmentedControl label="Which Sittings" value={marking ? "mark" : "all"} onChange={(v) => setMarking(v === "mark")} options={[["all", "All"], ["mark", "To Mark"]]} small />}
      </Toolbar>
      {view === "library" ? (
        <PagedTable<Assessment>
          title="Assessments"
          list={library}
          search="Search assessments"
          rowKey={(a) => a.assessment_definition_id}
          noun="assessment"
          onRowClick={(a) => openAssessment(a.assessment_definition_id, a.name)}
          empty={{ title: "No Assessments Yet" }}
          columns={[
            { key: "name", label: "Assessment", render: (a) => <span className="font-semibold">{a.name}</span> },
            { key: "type", label: "Type", render: (a) => ASSESSMENT_TYPE[a.assessment_type] },
            { key: "minutes", label: "Minutes", align: "n", render: (a) => a.duration_minutes ?? "Untimed", desktop: true },
            { key: "questions", label: "Questions", align: "n", render: (a) => a.question_count, desktop: true },
            { key: "sent", label: "Sent", align: "n", render: (a) => a.sent, desktop: true },
            { key: "avg", label: "Average", align: "n", render: (a) => (a.average_score === null ? "–" : Math.round(a.average_score)) },
            { key: "status", label: "Status", render: (a) => (a.active ? pill(["ok", "Active"]) : pill(["neutral", "Off"])) },
          ]}
        />
      ) : (
        <PagedTable<Sitting>
          title="Sittings"
          list={sittings}
          search="Search candidates"
          rowKey={(x) => x.application_assessment_id}
          noun="sitting"
          onRowClick={openSitting}
          empty={{ title: marking ? "Nothing to Mark" : "None Sent Yet" }}
          columns={[
            { key: "who", label: "Candidate", render: (x) => <span className="font-semibold">{x.candidate_name}</span> },
            { key: "what", label: "Assessment", render: (x) => x.assessment_name },
            { key: "role", label: "Role", render: (x) => x.vacancy_title, desktop: true },
            { key: "state", label: "State", render: (x) => pill(SITTING_STATUS[x.status]) },
            { key: "score", label: "Score", align: "n", render: (x) => (x.score === null ? (x.to_mark ? `${x.to_mark} to mark` : "–") : Math.round(x.score)) },
          ]}
        />
      )}
    </>
  );
}

/** An assessment: its settings, its questions with their points, and what the library does with it. */
function AssessmentSheet({ id, close }: { id: string; close: () => void }) {
  const modal = useModal();
  const { can } = useAuth();
  const mayEdit = can("recruitment", "edit");
  const mayExport = can("recruitment", "export");
  const read = useApi("GET /api/v1/recruitment/assessments/:id", { params: { id } });
  const on = useMutation("POST /api/v1/recruitment/assessments/:id/activate");
  const off = useMutation("POST /api/v1/recruitment/assessments/:id/deactivate");
  const a = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!a) return <LoadingRows count={6} />;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/recruitment/assessments");
  };
  // A form opened from here goes back to the sheet when it closes (the app holds one dialog at a time).
  const back = () => modal.open({ title: a.name, wide: true, body: (done) => <AssessmentSheet id={id} close={done} /> });
  /** The assessment as a file another MyCity hub can take (`mycity-assessment-1`). */
  const exportIt = async () => {
    try {
      const file = await api.call("GET /api/v1/recruitment/assessments/:id/export", { params: { id } });
      await saveBlob(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), `${a.code} ${a.name}.json`);
    } catch (e) {
      say(e);
    }
  };
  const flip = async () => {
    try {
      await (a.active ? off : on).run({ params: { id }, body: {} });
      reload();
      toast(a.active ? `${a.code} switched off` : `${a.code} in use`);
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {a.active ? pill(["ok", "Active"]) : pill(["neutral", "Off"])}
        <Pill dot={false}>{a.code}</Pill>
      </div>
      <KeyValue
        items={[
          ["Type", ASSESSMENT_TYPE[a.assessment_type]],
          ["Time", a.duration_minutes ? `${a.duration_minutes} minutes` : "Untimed"],
          ["Pass Mark", a.pass_score === null ? "–" : String(a.pass_score)],
          ["Marking", a.scoring_method === "auto" ? "Marked for you" : a.scoring_method === "manual" ? "Marked by hand" : "Partly by hand"],
          ["Sent", `${a.sent} candidates`],
          ["Average", a.average_score === null ? "–" : String(Math.round(a.average_score))],
        ]}
      />
      {a.instructions && (
        <Card className="mt-3" data-copy="content">
          <CardHeader title="Instructions" />
          <p className="text-sm whitespace-pre-line">{a.instructions}</p>
        </Card>
      )}
      <Card className="mt-3">
        <CardHeader title="Questions" />
        {a.questions.length ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm" data-copy="content">
            {a.questions.map((q) => (
              <li key={q.assessment_question_id}>
                <span>{q.prompt}</span>
                {q.options ? (
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {q.options.map((o) => (
                      <li key={o.id}>{`${o.text}, ${o.points} points`}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-subtle-foreground">{` · ${q.question_type === "file" ? "a file or a link" : "written"}, up to ${q.max_score} points`}</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-subtle-foreground">No questions yet</p>
        )}
        {a.questions.some((q) => q.options) && <p className="mt-2 text-xs"><HelpTerm help={POINTS_HELP}>Points</HelpTerm></p>}
      </Card>
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {mayEdit && <Button onClick={() => modal.open({ title: "Edit Assessment", body: () => <AssessmentForm assessment={a} close={back} onSaved={reload} /> })}>Edit</Button>}
        {mayEdit && !a.in_use && <Button onClick={() => modal.open({ title: "Questions", wide: true, body: () => <AssessmentQuestions assessment={a} close={back} onSaved={reload} /> })}>Questions</Button>}
        {mayExport && a.questions.length > 0 && <Button icon="download" onClick={exportIt}>Export</Button>}
        {mayEdit && <Button onClick={flip}>{a.active ? "Deactivate" : "Activate"}</Button>}
        {mayEdit && a.active && <Button variant="primary" onClick={() => modal.open({ title: "Send to Candidates", body: () => <BulkSendForm assessment={a} close={back} /> })}>Send to Candidates</Button>}
      </FormFooter>
    </>
  );
}

type AssessmentValues = { name: string; assessment_type: string; duration_minutes: string; instructions: string; pass_score: string };

function AssessmentForm({ assessment, close, onSaved }: { assessment?: AssessmentDetail; close: () => void; onSaved: (a: AssessmentDetail) => void }) {
  const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  const f = useContractForm<AssessmentValues>(
    {
      name: assessment?.name ?? "",
      assessment_type: assessment?.assessment_type ?? "practical",
      duration_minutes: text(assessment?.duration_minutes),
      instructions: assessment?.instructions ?? "",
      pass_score: text(assessment?.pass_score),
    },
    bodySchema<AssessmentValues>(assessment ? assessmentSchemas.AssessmentEdit : assessmentSchemas.AssessmentCreate, (v) => v),
  );
  const create = useMutation("POST /api/v1/recruitment/assessments");
  const patch = useMutation("PATCH /api/v1/recruitment/assessments/:id");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const saved = assessment ? await patch.run({ params: { id: assessment.assessment_definition_id }, body: f.values as never }) : await create.run({ body: f.values as never });
      invalidate("/api/v1/recruitment/assessments");
      close();
      toast(assessment ? "Assessment saved" : `${saved.code} made. Add its questions`);
      onSaved(saved);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Name" {...f.status("name")}>
        <TextField {...f.field("name")} placeholder="Sales Case Study" maxLength={120} />
      </Field>
      <Grid cols={3}>
        <Field label="Type" {...f.status("assessment_type")}>
          <SelectField options={TYPES} {...f.field("assessment_type")} />
        </Field>
        <Field label="Minutes" optional {...f.status("duration_minutes")}>
          <NumberField {...f.field("duration_minutes")} />
        </Field>
        <Field label="Pass Mark" optional {...f.status("pass_score")}>
          <NumberField {...f.field("pass_score")} />
        </Field>
      </Grid>
      <Field label="Instructions" {...f.status("instructions")}>
        <TextAreaField {...f.field("instructions")} rows={5} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{assessment ? "Save Assessment" : "Make Assessment"}</Button>
      </FormFooter>
    </>
  );
}

const BULK_STAGES: Array<[string, string]> = (["assessment", "screening", "application", "interview", "shortlist"] as const).map((s) => [s, STAGE_LABEL[s]]);

/** Send to Candidates: everyone in progress at one stage of one role; those who already have it are skipped. */
function BulkSendForm({ assessment, close }: { assessment: AssessmentDetail; close: () => void }) {
  const roles = useVacancyOptions("open");
  const f = useContractForm(
    { vacancy_id: "", assessment_definition_id: assessment.assessment_definition_id, stage: "assessment", start_within_days: "3", due_days: "" },
    assessmentSchemas.SittingSendBulk,
  );
  const send = useMutation("POST /api/v1/recruitment/assessments/sittings/bulk");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      const r = await send.run({ body: { ...f.values, start_within_days: Number(f.values.start_within_days), due_days: f.values.due_days ? Number(f.values.due_days) : undefined } as never });
      invalidate("/api/v1/recruitment/assessments");
      close();
      toast(r.sent ? `Sent to ${r.sent}${r.skipped ? `, ${r.skipped} had it` : ""}` : "Nobody new to send it to");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Vacancy" {...f.status("vacancy_id")}>
        <SelectField options={roles.options} placeholder="Pick a role" more={roles.more} onMore={roles.onMore} {...f.field("vacancy_id")} />
      </Field>
      <Grid cols={2}>
        <Field label="Stage" {...f.status("stage")}>
          <SelectField options={BULK_STAGES} {...f.field("stage")} />
        </Field>
        <Field label="Start Within Days" {...f.status("start_within_days")}>
          <NumberField {...f.field("start_within_days")} />
        </Field>
      </Grid>
      {assessment.duration_minutes === null && (
        <Field label="Days to Finish" optional {...f.status("due_days")}>
          <NumberField {...f.field("due_days")} />
        </Field>
      )}
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Assessment</Button>
      </FormFooter>
    </>
  );
}

/** A sitting: when it was sent and taken, each answer, and Mark Answers for what is marked by hand. */
function SittingSheet({ id, close }: { id: string; close: () => void }) {
  const mayEdit = useAuth().can("recruitment", "edit");
  const read = useApi("GET /api/v1/recruitment/assessments/sittings/:id", { params: { id } });
  const cancel = useMutation("POST /api/v1/recruitment/assessments/sittings/:id/cancel");
  const s = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!s) return <LoadingRows count={6} />;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/recruitment/assessments");
  };
  const stop = async () => {
    try {
      await cancel.run({ params: { id }, body: {} });
      reload();
      toast("Sitting cancelled");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {pill(SITTING_STATUS[s.status])}
        <span className="text-sm text-subtle-foreground">{`${s.assessment_name} · ${s.vacancy_title}`}</span>
      </div>
      <KeyValue
        items={[
          ["Start By", formatDate(s.start_by)],
          ["Started", s.started_at ? formatDateTime(s.started_at) : "Not yet"],
          ["Due", s.due_at ? formatDateTime(s.due_at) : "–"],
          ["Submitted", s.submitted_at ? formatDateTime(s.submitted_at) : "Not yet"],
          ["Score", s.score === null ? "–" : `${Math.round(s.score)} of 100`],
        ]}
      />
      {["submitted", "timed_out", "scored"].includes(s.status) ? (
        <Marking sitting={s} mayMark={mayEdit && s.can_mark} onSaved={reload} close={close} />
      ) : (
        <FormFooter>
          <Button onClick={close}>Close</Button>
          {mayEdit && s.can_cancel && <Button variant="danger" onClick={stop}>Cancel Sitting</Button>}
        </FormFooter>
      )}
    </>
  );
}

function Marking({ sitting, mayMark, onSaved, close }: { sitting: SittingDetail; mayMark: boolean; onSaved: () => void; close: () => void }) {
  const byHand = sitting.answers.filter((a) => a.question_type !== "choice");
  const [marks, setMarks] = useState<Record<string, { score: string; comment: string }>>(
    Object.fromEntries(byHand.map((a) => [a.assessment_question_id, { score: a.awarded_score === null ? "" : String(a.awarded_score), comment: a.reviewer_comment ?? "" }])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation("PUT /api/v1/recruitment/assessments/sittings/:id/marks");
  const submit = async () => {
    setProblem(null);
    setErrors({});
    const given = byHand.filter((a) => marks[a.assessment_question_id]?.score !== "");
    if (!given.length) return setProblem("Give a mark");
    const body = { marks: given.map((a) => ({ assessment_question_id: a.assessment_question_id, awarded_score: Number(marks[a.assessment_question_id]!.score), ...(marks[a.assessment_question_id]!.comment.trim() ? { reviewer_comment: marks[a.assessment_question_id]!.comment.trim() } : {}) })) };
    try {
      const after = await save.run({ params: { id: sitting.application_assessment_id }, body });
      onSaved();
      if (after.status === "scored") {
        close();
        toast(`Marked. Score ${Math.round(after.score ?? 0)}`);
      } else toast("Marks saved");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors(Object.fromEntries(Object.entries(e.fields).map(([k, m]) => [given[Number(k.split(".")[1])]?.assessment_question_id ?? k, m[0] ?? ""])));
        setProblem(e.status === 422 ? null : e.message);
      } else say(e);
    }
  };
  return (
    <>
      <ol className="mt-3 list-none space-y-3 p-0">
        {sitting.answers.map((a, i) => (
          <li key={a.assessment_question_id}>
            <Card>
              <CardHeader title={`Question ${i + 1}`} right={<span className="text-sm text-subtle-foreground">{`Up to ${a.max_score}`}</span>} />
              <p className="mb-2 text-sm" data-copy="content">{a.prompt}</p>
              {a.question_type === "choice" ? (
                <p className="text-sm">{a.options?.find((o) => o.id === a.response)?.text ?? "Not answered"} <b>{` · ${a.awarded_score ?? 0} points`}</b></p>
              ) : (
                <>
                  {a.document && <Button size="sm" icon="doc" onClick={() => saveFile(`/api/v1/documents/${a.document!.document_id}/content`, a.document!.file_name)}>{`Open ${a.document.file_name}`.slice(0, 40)}</Button>}
                  {a.response && (/^https:\/\//.test(a.response) ? (
                    <a className="wrap-any text-sm underline" href={a.response} target="_blank" rel="noopener noreferrer">{a.response}</a>
                  ) : (
                    <p className="text-sm whitespace-pre-line" data-copy="content">{a.response}</p>
                  ))}
                  {!a.document && !a.response && <p className="text-sm text-subtle-foreground">Not answered</p>}
                  <Grid cols={2} className="mt-2">
                    <Field label="Mark" {...(errors[a.assessment_question_id] ? { state: "bad" as const, message: errors[a.assessment_question_id] } : {})}>
                      <NumberField decimal value={marks[a.assessment_question_id]!.score} onChange={(v: string) => setMarks((m) => ({ ...m, [a.assessment_question_id]: { ...m[a.assessment_question_id]!, score: v } }))} disabled={!mayMark} />
                    </Field>
                    <Field label="Comment" optional>
                      <TextField value={marks[a.assessment_question_id]!.comment} onChange={(v) => setMarks((m) => ({ ...m, [a.assessment_question_id]: { ...m[a.assessment_question_id]!, comment: v } }))} maxLength={1000} disabled={!mayMark} />
                    </Field>
                  </Grid>
                </>
              )}
            </Card>
          </li>
        ))}
      </ol>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {mayMark && byHand.length > 0 && <Button variant="primary" onClick={submit}>Mark Answers</Button>}
      </FormFooter>
    </>
  );
}
