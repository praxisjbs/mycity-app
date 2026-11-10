/**
 * A candidate's sheet (docs/guides/recruitment.md §6.3 to §6.5, §10): the application and its CV,
 * the answers, the screening read, the weighted scorecard, sittings, interviews and the stage
 * history, and what a recruiter does next: Score With AI, Send Assessment, Schedule Interview, Move
 * to a stage, Not Progressing, Reopen and Add to Pool. A score never moves anyone; a person does.
 */
import { useState } from "react";
import candidateSchemas from "@mycity/contract/schemas/candidates.js";
import assessmentSchemas from "@mycity/contract/schemas/assessments.js";
import poolSchemas from "@mycity/contract/schemas/talent_pool.js";
import type { ApplicationStage, CandidateDetail } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useInfinite, useMutation } from "@/api/hooks";
import { saveFile } from "@/api/download";
import { useAuth } from "@/auth/AuthProvider";
import { useScreenState } from "@/lib/plan";
import { useRouter } from "@/lib/router";
import { paging } from "@/features/shared/wire";
import {
  Button,
  Card,
  CardHeader,
  DataView,
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
  Pill,
  SelectField,
  TextAreaField,
  Timeline,
  toast,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { ScheduleForm } from "./ScheduleInterview";
import { ASSESSMENT_TYPE, pill, provisionalTerm, say, sayRefusal, SITTING_STATUS, STAGE_LABEL } from "./shared";

/** The pipeline's order, and the first stage ahead of where the candidate is: the footer's one filled button. */
const STAGE_ORDER = Object.keys(STAGE_LABEL);
const nextAhead = (c: Pick<CandidateDetail, "stage" | "next_stages">) => c.next_stages.find((s) => STAGE_ORDER.indexOf(s) > STAGE_ORDER.indexOf(c.stage));

const SOURCE: Record<string, string> = { careers: "Careers page", invited: "Invited", pool: "Talent Pool" };
const CV_STATE: Record<string, string> = { none: "None sent", checking: "Being checked", clean: "Ready", infected: "Failed the virus check" };
const WEIGHTED_HELP = "From the parts scored so far, with this role's weights.";
const words = (s: string) => STAGE_LABEL[s as ApplicationStage] ?? (s === "not_progressed" ? "Not Progressing" : s);

export function CandidateSheet({ id, close, inline = false }: { id: string; close: () => void; inline?: boolean }) {
  const modal = useModal();
  const { can } = useAuth();
  const mayEdit = can("recruitment", "edit");
  const mayAdd = can("recruitment", "create");
  const read = useApi("GET /api/v1/recruitment/candidates/:id", { params: { id } });
  // Reopen needs the role still open (the API refuses a closed one); the sheet's own record does not say.
  const role = useApi("GET /api/v1/recruitment/vacancies/:id", { params: { id: read.data?.vacancy.vacancy_id ?? "" }, enabled: Boolean(read.data && read.data.status === "not_progressed") });
  const ai = useApi("GET /api/v1/recruitment/vacancies/assist");
  const score = useMutation("POST /api/v1/recruitment/candidates/:id/score");
  const move = useMutation("POST /api/v1/recruitment/candidates/:id/move");
  const reopen = useMutation("POST /api/v1/recruitment/candidates/:id/reopen");
  // M5's Offers screen, once it opens in this build (F14): a shortlisted card makes an offer, one at Offer or after opens it.
  const offers = useScreenState("recruitment", "offers").open;
  const { navigate } = useRouter();
  const c = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!c) return <LoadingRows count={8} />;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/recruitment/candidates");
  };
  const act = (work: () => Promise<unknown>, said: string) => async () => {
    try {
      await work();
      reload();
      toast(said);
    } catch (e) {
      say(e);
    }
  };
  const live = c.status === "active";
  // A form opened from here goes back to the candidate when it closes: beside the board it is still
  // there; in the dialog it opens again (the app holds one dialog at a time).
  const back = () => (inline ? modal.close() : modal.open({ title: c.name, wide: true, body: (done) => <CandidateSheet id={id} close={done} /> }));
  const mayScore = c.can_edit && ai.data?.available && c.cv_state === "clean" && c.screening_score === null;
  return (
    <>
      {inline && <CardHeader title={c.name} />}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pill dot={false}>{c.number}</Pill>
        <Pill tone={live ? "info" : "neutral"}>{live ? STAGE_LABEL[c.stage] : words(c.status)}</Pill>
        <span className="text-sm text-subtle-foreground">{c.vacancy.title}</span>
      </div>
      <KeyValue
        items={[
          ["Email", c.email],
          ["Phone", c.phone ?? "–"],
          ["Applied", `${formatDate(c.applied_at)}, ${SOURCE[c.source] ?? c.source}`],
          ["Experience", c.years_experience === null ? "–" : `${c.years_experience} years`],
          [
            "CV",
            c.cv ? (
              <span key="cv" className="inline-flex flex-wrap items-center gap-2">
                {CV_STATE[c.cv_state]}
                {c.cv_state === "clean" && <Button size="sm" icon="download" onClick={() => saveFile(`/api/v1/recruitment/candidates/${c.application_id}/cv`, c.cv!.file_name)}>View CV</Button>}
              </span>
            ) : (
              CV_STATE.none
            ),
          ],
          ...(c.rejection_reason ? [["Reason", c.rejection_reason] as [string, string]] : []),
        ]}
      />
      {/* Beside the board the pane is too narrow for two cards in a row: they stack. */}
      <Grid cols={inline ? 1 : 2} className="mt-3">
        <Card>
          <CardHeader title="Screening" level={3} />
          <KeyValue
            items={[
              [
                "Score",
                c.score === null ? (
                  "Not scored"
                ) : (
                  <span key="s" className="inline-flex items-center gap-1.5">
                    <b>{Math.round(c.score)}</b>
                    {c.score_provisional && provisionalTerm}
                  </span>
                ),
              ],
              ["Read", c.screened_at ? formatDateTime(c.screened_at) : "Form only"],
            ]}
          />
          {c.screening_summary && <p className="mt-2 text-sm" data-copy="content">{c.screening_summary}</p>}
        </Card>
        <Card>
          <CardHeader level={3} title={<HelpTerm help={WEIGHTED_HELP}>Weighted Total</HelpTerm>} right={<span className="text-sm text-subtle-foreground">{`${c.parts_scored} of ${c.parts_active} parts`}</span>} />
          <p className="mb-2 text-2xl font-semibold tabular-nums">{c.weighted_total === null ? "–" : c.weighted_total.toFixed(1)}</p>
          <KeyValue
            items={c.scorecard
              .filter((p) => p.active)
              .map((p) => [`${p.name}, ${p.weight}%`, p.score === null ? "–" : `${Math.round(p.score)}${p.provisional ? ", provisional" : ""}`])}
          />
        </Card>
      </Grid>
      {(c.answers.length > 0 || c.cover_letter) && (
        <Card className="mt-3" data-copy="content">
          <CardHeader title="Application" level={3} />
          {c.cover_letter && <p className="mb-2 text-sm whitespace-pre-line">{c.cover_letter}</p>}
          <KeyValue items={c.answers.map((a) => [a.prompt, a.answer === "yes" ? "Yes" : a.answer === "no" ? "No" : (a.answer ?? "–")])} layout="stacked" />
        </Card>
      )}
      {c.assessments.length > 0 && (
        <DataView
          className="mt-3"
          title="Assessments"
          rows={c.assessments}
          rowKey={(s) => s.application_assessment_id}
          columns={[
            { key: "name", label: "Assessment", render: (s) => s.name },
            { key: "type", label: "Type", render: (s) => ASSESSMENT_TYPE[s.assessment_type], desktop: true },
            { key: "state", label: "State", render: (s) => pill(SITTING_STATUS[s.status]) },
            { key: "score", label: "Score", align: "n", render: (s) => (s.score === null ? "–" : Math.round(s.score)) },
          ]}
        />
      )}
      {c.interviews.length > 0 && (
        <DataView
          className="mt-3"
          title="Interviews"
          rows={c.interviews}
          rowKey={(x) => x.interview_id}
          columns={[
            { key: "when", label: "When", render: (x) => formatDateTime(x.scheduled_start) },
            { key: "state", label: "Round", render: (x) => (x.status === "cancelled" ? "Cancelled" : x.round_status === "closed" ? "Closed" : "Open") },
            { key: "score", label: "Score", align: "n", render: (x) => (x.interview_score === null ? "–" : x.interview_score.toFixed(1)) },
          ]}
        />
      )}
      <Card className="mt-3">
        <CardHeader title="Stage History" level={3} />
        <Timeline
          items={[...c.history].reverse().map((h, i) => ({
            title: words(h.to_state),
            when: formatDateTime(h.changed_at),
            text: [h.actor_name, h.reason, `${h.days} ${h.days === 1 ? "day" : "days"}`].filter(Boolean).join(" · "),
            tone: i === 0 ? ("now" as const) : ("done" as const),
          }))}
        />
      </Card>
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {offers && STAGE_ORDER.indexOf(c.stage) >= STAGE_ORDER.indexOf("offer") && (
          <Button onClick={() => (close(), navigate(`/recruitment?tab=offers&application=${c.application_id}`))}>Open Offer</Button>
        )}
        {offers && mayAdd && live && c.stage === "shortlist" && (
          <Button onClick={() => (close(), navigate(`/recruitment?tab=offers&new=1&application=${c.application_id}`))}>Make Offer</Button>
        )}
        {c.can_edit && live && (
          <>
            {mayScore && <Button icon="spark" onClick={act(() => score.run({ params: { id }, body: {} }), "CV read")}>Score With AI</Button>}
            <Button onClick={() => modal.open({ title: "Send Assessment", body: () => <SendForm candidate={c} close={back} onSent={reload} /> })}>Send Assessment</Button>
            <Button onClick={() => modal.open({ title: "Schedule Interview", wide: true, body: () => <ScheduleForm applicationId={c.application_id} close={back} onSaved={reload} /> })}>Schedule Interview</Button>
            {/* One filled button: the next stage ahead; the others (further on, or one back) stay outlined. */}
            {c.next_stages.map((s) => (
              <Button key={s} variant={s === nextAhead(c) ? "primary" : undefined} onClick={act(() => move.run({ params: { id }, body: { stage: s as "application" } }), `Moved to ${words(s)}`)}>{`Move to ${words(s)}`}</Button>
            ))}
          </>
        )}
        {/* Not Progressing on a closed role too, so the people left in it can be told. */}
        {c.can_not_progress && <Button variant="danger" onClick={() => modal.open({ title: "Not Progressing", body: () => <NotProgressingForm candidate={c} close={back} onSaved={reload} /> })}>Not Progressing</Button>}
        {mayAdd && <Button onClick={() => modal.open({ title: "Add to Pool", body: () => <PoolForm candidate={c} close={back} /> })}>Add to Pool</Button>}
        {mayEdit && c.status === "not_progressed" && role.data && role.data.status !== "closed" && <Button variant="primary" onClick={act(() => reopen.run({ params: { id }, body: {} }), `${c.name} reopened`)}>Reopen</Button>}
      </FormFooter>
    </>
  );
}

/** Send Assessment: one of the library's assessments in use, with the days to start (and for a take-home brief, to finish). */
function SendForm({ candidate, close, onSent }: { candidate: CandidateDetail; close: () => void; onSent: () => void }) {
  const library = useInfinite("GET /api/v1/recruitment/assessments", { filters: { active: "true" } });
  const f = useContractForm({ application_id: candidate.application_id, assessment_definition_id: "", start_within_days: "3", due_days: "" }, assessmentSchemas.SittingSend);
  const send = useMutation("POST /api/v1/recruitment/assessments/sittings");
  const [problem, setProblem] = useState<string | null>(null);
  const picked = library.rows.find((a) => a.assessment_definition_id === f.values.assessment_definition_id);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await send.run({ body: { ...f.values, start_within_days: Number(f.values.start_within_days), ...(f.values.due_days ? { due_days: Number(f.values.due_days) } : { due_days: undefined }) } });
      invalidate("/api/v1/recruitment/assessments");
      close();
      onSent();
      toast(`Sent to ${candidate.first_name}`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Assessment" {...f.status("assessment_definition_id")}>
        <SelectField options={library.rows.map((a) => [a.assessment_definition_id, `${a.name} · ${ASSESSMENT_TYPE[a.assessment_type as keyof typeof ASSESSMENT_TYPE]}`] as [string, string])} placeholder="Pick an assessment" {...paging(library)} {...f.field("assessment_definition_id")} />
      </Field>
      <Grid cols={2}>
        <Field label="Start Within Days" {...f.status("start_within_days")}>
          <NumberField {...f.field("start_within_days")} />
        </Field>
        {picked && picked.duration_minutes === null && (
          <Field label="Days to Finish" optional {...f.status("due_days")}>
            <NumberField {...f.field("due_days")} />
          </Field>
        )}
      </Grid>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Assessment</Button>
      </FormFooter>
    </>
  );
}

function NotProgressingForm({ candidate, close, onSaved }: { candidate: CandidateDetail; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ rejection_reason: "" }, candidateSchemas.CandidateNotProgressed);
  const save = useMutation("POST /api/v1/recruitment/candidates/:id/not-progressed");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await save.run({ params: { id: candidate.application_id }, body: f.values });
      close();
      onSaved();
      toast(`${candidate.name} is not progressing`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Reason" help="Kept on the record. The candidate's email does not show it." {...f.status("rejection_reason")}>
        <TextAreaField {...f.field("rejection_reason")} rows={3} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" onClick={submit}>Not Progressing</Button>
      </FormFooter>
    </>
  );
}

function PoolForm({ candidate, close }: { candidate: CandidateDetail; close: () => void }) {
  const f = useContractForm({ application_id: candidate.application_id, reason: "" }, poolSchemas.PoolAdd);
  const save = useMutation("POST /api/v1/recruitment/pool");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await save.run({ body: f.values });
      invalidate("/api/v1/recruitment/pool");
      close();
      toast(`${candidate.name} added to the pool`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Why Keep Them" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} />
      </Field>
      <FormError>{problem ?? (f.status("application_id").message || null)}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Add to Pool</Button>
      </FormFooter>
    </>
  );
}
