/**
 * Recruitment · Interviews (docs/guides/recruitment.md §6.6, §10): Upcoming, Past and My Panels.
 * An interview's sheet shows when and where, Candidate Details, the panel with Submitted or Waiting,
 * and once the round is closed each trait's ratings and average, the total, the report and its
 * decision, and the filled Interview Assessment Form. A panelist opens My Card from it; a recruiter
 * reschedules, cancels, closes the round and writes the report.
 */
import { useEffect, useRef, useState } from "react";
import interviewSchemas from "@mycity/contract/schemas/interviews.js";
import type { Interview, InterviewDetail } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { saveFile } from "@/api/download";
import { useAuth } from "@/auth/AuthProvider";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import {
  Button,
  Card,
  CardHeader,
  DataView,
  ErrorState,
  Field,
  formatDateTime,
  formatTime,
  FormError,
  FormFooter,
  Grid,
  HelpTerm,
  KeyValue,
  LoadingRows,
  NumberField,
  PageHeader,
  Pill,
  RatingField,
  SegmentedControl,
  SelectField,
  TextAreaField,
  TextField,
  toast,
  Toolbar,
  useConfirm,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { MyCard } from "./MyCard";
import { ScheduleForm } from "./ScheduleInterview";
import { bodySchema, DECISION, DECISIONS, INTERVIEW_TYPE, pill, say, sayRefusal } from "./shared";

const WAITING_HELP = "Ratings show when every panelist has submitted or the round is closed.";
const VIEWS: Array<["upcoming" | "past" | "mine", string]> = [
  ["upcoming", "Upcoming"],
  ["past", "Past"],
  ["mine", "My Panels"],
];
const ACADEMICS: Array<[string, string]> = [
  ["outstanding", "Outstanding"],
  ["very_good", "Very Good"],
  ["good", "Good"],
  ["average", "Average"],
  ["poor", "Poor"],
];

const roundState = (x: Pick<Interview, "status" | "round_status">) =>
  x.status === "cancelled" ? pill(["neutral", "Cancelled"]) : x.round_status === "closed" ? pill(["ok", "Closed"]) : pill(["info", "Open"]);
const when = (x: Pick<Interview, "scheduled_start" | "scheduled_end">) => `${formatDateTime(x.scheduled_start)} to ${formatTime(x.scheduled_end)}`;
const months = (n: number | null) => (n === null ? "–" : n < 12 ? `${n} months` : `${Math.floor(n / 12)} years${n % 12 ? `, ${n % 12} months` : ""}`);

export function Interviews() {
  const modal = useModal();
  const mayEdit = useAuth().can("recruitment", "edit");
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"upcoming" | "past" | "mine">(params.get("mine") === "true" ? "mine" : "upcoming");
  const list = usePaged("GET /api/v1/recruitment/interviews", {
    filters: view === "mine" ? { mine: "true" } : { when: view },
    sort: view === "past" ? "-scheduled_start" : "scheduled_start",
  });
  const open = (id: string, title = "Interview") => modal.open({ title, wide: true, body: (close) => <InterviewSheet id={id} close={close} /> });
  const schedule = () => modal.open({ title: "Schedule Interview", wide: true, body: (close) => <ScheduleForm close={close} onSaved={(x) => open(x.interview_id, x.candidate_name)} /> });
  useScreenAction(mayEdit ? { label: "Schedule Interview", onSelect: schedule } : null);
  useNewLink(mayEdit ? schedule : null);

  const linked = params.get("id");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (params.get("mine")) setParams({ mine: null }, { replace: true });
    if (!linked || opened.current === linked) return;
    opened.current = linked;
    setParams({ id: null }, { replace: true });
    open(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  return (
    <>
      <PageHeader title="Interviews" actions={mayEdit ? <Button variant="primary" icon="plus" onClick={schedule}>Schedule Interview</Button> : undefined} />
      <Toolbar>
        <SegmentedControl label="Which Interviews" value={view} onChange={setView} options={VIEWS} />
      </Toolbar>
      <PagedTable<Interview>
        title="Interviews"
        list={list}
        search="Search candidates"
        rowKey={(x) => x.interview_id}
        noun="interview"
        onRowClick={(x) => open(x.interview_id, x.candidate_name)}
        empty={{ title: view === "upcoming" ? "Nothing Coming Up" : "No Interviews Here" }}
        columns={[
          { key: "who", label: "Candidate", render: (x) => <span className="font-semibold">{x.candidate_name}</span> },
          { key: "role", label: "Role", render: (x) => x.vacancy.title, desktop: true },
          { key: "when", label: "When", render: (x) => formatDateTime(x.scheduled_start) },
          {
            key: "panel",
            label: <HelpTerm help={WAITING_HELP}>Panel</HelpTerm>,
            render: (x) => (
              <span className="inline-flex items-center gap-1.5">
                {`${x.submitted_count} of ${x.panel_size}`}
                {x.on_panel && !x.my_submitted && x.round_status === "open" && x.status !== "cancelled" && <Pill tone="warn">Your Card</Pill>}
              </span>
            ),
          },
          { key: "round", label: "Round", render: roundState },
        ]}
      />
    </>
  );
}

export function InterviewSheet({ id, close }: { id: string; close: () => void }) {
  const modal = useModal();
  const confirm = useConfirm();
  const mayEdit = useAuth().can("recruitment", "edit");
  const read = useApi("GET /api/v1/recruitment/interviews/:id", { params: { id } });
  const shut = useMutation("POST /api/v1/recruitment/interviews/:id/close");
  const x = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!x) return <LoadingRows count={8} />;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/recruitment/interviews");
  };
  const closed = x.round.status === "closed";
  const closeRound = async () => {
    const waiting = x.panel_size - x.submitted_count;
    const yes = await confirm({
      title: "Close Round",
      body: waiting ? `${waiting} ${waiting === 1 ? "card is" : "cards are"} not in. They will not count.` : "Every card is in.",
      confirmLabel: "Close Round",
      destructive: waiting > 0,
    });
    if (!yes) return;
    try {
      await shut.run({ params: { id }, body: {} });
      reload();
      toast("Round closed");
    } catch (e) {
      say(e);
    }
  };
  const myCard = () => modal.open({ title: "My Card", wide: true, full: true, body: () => <MyCard interview={x} close={back} onChanged={() => invalidate("/api/v1/recruitment/interviews")} /> });
  const seats = x.panel;
  // A form opened from here goes back to the sheet when it closes (the app holds one dialog at a time).
  const back = () => modal.open({ title: x.candidate_name, wide: true, body: (done) => <InterviewSheet id={id} close={done} /> });
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {roundState(x)}
        <Pill dot={false}>{x.round.title}</Pill>
        <span className="text-sm text-subtle-foreground">{x.vacancy.title}</span>
      </div>
      <KeyValue
        items={[
          ["Candidate", x.candidate_name],
          ["When", when(x)],
          ["How", INTERVIEW_TYPE[x.interview_type]],
          ...(x.worksite ? [["Where", [x.worksite.name, x.worksite.address].filter(Boolean).join(", ")] as [string, string]] : []),
          ...(x.meeting_url ? [["Link", <a key="l" className="wrap-any underline" href={x.meeting_url} target="_blank" rel="noopener noreferrer">{x.meeting_url}</a>] as [string, React.ReactNode]] : []),
        ]}
      />
      <Grid cols={2} className="mt-3">
        <Card>
          <CardHeader
            title="Candidate Details"
            right={mayEdit && x.status !== "cancelled" ? <Button size="sm" icon="edit" onClick={() => modal.open({ title: "Candidate Details", body: () => <DetailsForm interview={x} close={back} onSaved={reload} /> })}>Edit</Button> : undefined}
          />
          <KeyValue
            items={[
              ["Current Employer", x.round.current_employer ?? "–"],
              ["Academics", ACADEMICS.find(([k]) => k === x.round.academics)?.[1] ?? "–"],
              ["Total Experience", months(x.round.total_experience_months)],
              ["Relevant Experience", months(x.round.relevant_experience_months)],
            ]}
          />
        </Card>
        <DataView
          title="Panel"
          rows={seats}
          rowKey={(s) => s.interview_panelist_id}
          columns={[
            { key: "who", label: "Panelist", render: (s) => s.panelist.display_name },
            { key: "state", label: "Card", render: (s) => (s.submitted_at ? pill(["ok", "Submitted"]) : <HelpTerm help={WAITING_HELP}>{pill(["warn", "Waiting"])}</HelpTerm>) },
            { key: "score", label: "Score", align: "n", render: (s) => (s.score === null ? "–" : s.score.toFixed(1)) },
            { key: "decision", label: "Decision", render: (s) => (s.decision ? pill(DECISION[s.decision]) : "–"), desktop: true },
          ]}
        />
      </Grid>
      {closed && x.trait_averages.length > 0 && (
        <DataView
          className="mt-3"
          title="Traits"
          rows={x.trait_averages}
          rowKey={(t) => t.vacancy_question_id}
          columns={[
            { key: "trait", label: "Trait", render: (t) => t.prompt },
            ...seats.map((s) => ({
              key: s.interview_panelist_id,
              label: s.panelist.display_name.split(" ")[0] ?? "",
              align: "n" as const,
              desktop: true,
              render: (t: (typeof x.trait_averages)[number]) => s.ratings?.find((r) => r.vacancy_question_id === t.vacancy_question_id)?.rating ?? "–",
            })),
            { key: "avg", label: "Average", render: (t) => (t.average === null ? "–" : <RatingField label={t.prompt} value={t.average} readOnly decimals={1} />) },
          ]}
        />
      )}
      {closed && (
        <Card className="mt-3">
          <CardHeader title="Round Result" right={x.round.decision ? pill(DECISION[x.round.decision]) : undefined} />
          <KeyValue
            items={[
              ["Interview Score", x.round.interview_score === null ? "–" : `${x.round.interview_score.toFixed(1)} of 100`],
              ["Report By", x.round.reported_by_name ? `${x.round.reported_by_name}, ${formatDateTime(x.round.reported_at!)}` : "Not written yet"],
            ]}
          />
          {x.round.report && <p className="mt-2 text-sm whitespace-pre-line" data-copy="content">{x.round.report}</p>}
        </Card>
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {x.round.form_document_id && <Button icon="download" onClick={() => saveFile(`/api/v1/documents/${x.round.form_document_id}/content`, `Interview Assessment Form ${x.candidate_name}.pdf`)}>Download Form</Button>}
        {x.can_edit && <Button onClick={() => modal.open({ title: "Reschedule", wide: true, body: () => <ScheduleForm interview={x} close={back} onSaved={reload} /> })}>Reschedule</Button>}
        {x.can_edit && <Button variant="danger" onClick={() => modal.open({ title: "Cancel Interview", body: () => <CancelForm interview={x} close={back} onSaved={reload} /> })}>Cancel Interview</Button>}
        {x.can_close && <Button onClick={closeRound}>Close Round</Button>}
        {x.can_report && <Button onClick={() => modal.open({ title: "Write Report", body: () => <ReportForm interview={x} close={back} onSaved={reload} /> })}>{x.round.report ? "Edit Report" : "Write Report"}</Button>}
        {x.on_panel && x.status !== "cancelled" && <Button variant="primary" onClick={myCard}>My Card</Button>}
      </FormFooter>
    </>
  );
}

function CancelForm({ interview, close, onSaved }: { interview: InterviewDetail; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ reason: "" }, interviewSchemas.InterviewCancel);
  const save = useMutation("POST /api/v1/recruitment/interviews/:id/cancel");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await save.run({ params: { id: interview.interview_id }, body: f.values });
      close();
      onSaved();
      toast("Interview cancelled. Everyone is told");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}>
        <TextAreaField {...f.field("reason")} rows={3} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Keep It</Button>
        <Button variant="danger" onClick={submit}>Cancel Interview</Button>
      </FormFooter>
    </>
  );
}

function ReportForm({ interview, close, onSaved }: { interview: InterviewDetail; close: () => void; onSaved: () => void }) {
  const f = useContractForm({ report: interview.round.report ?? "", decision: interview.round.decision ?? "" }, interviewSchemas.RoundReport);
  const save = useMutation("PUT /api/v1/recruitment/interviews/:id/report");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await save.run({ params: { id: interview.interview_id }, body: f.values as never });
      close();
      onSaved();
      toast("Report saved");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Report" {...f.status("report")}>
        <TextAreaField {...f.field("report")} rows={6} />
      </Field>
      <Field label="Decision" {...f.status("decision")}>
        <SelectField options={DECISIONS} placeholder="Pick a decision" {...f.field("decision")} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Report</Button>
      </FormFooter>
    </>
  );
}

type DetailValues = { current_employer: string; academics: string; total_experience_months: string; relevant_experience_months: string };

/** Candidate Details as the form's header asks them; empty clears one. */
function DetailsForm({ interview, close, onSaved }: { interview: InterviewDetail; close: () => void; onSaved: () => void }) {
  const r = interview.round;
  const text = (n: number | null) => (n === null ? "" : String(n));
  const bodyOf = (v: DetailValues) => ({ ...v, academics: v.academics || null });
  const f = useContractForm<DetailValues>(
    { current_employer: r.current_employer ?? "", academics: r.academics ?? "", total_experience_months: text(r.total_experience_months), relevant_experience_months: text(r.relevant_experience_months) },
    bodySchema<DetailValues>(interviewSchemas.RoundDetailsSave, bodyOf),
  );
  const save = useMutation("PUT /api/v1/recruitment/interviews/:id/details");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await save.run({ params: { id: interview.interview_id }, body: bodyOf(f.values) as never });
      close();
      onSaved();
      toast("Candidate Details saved");
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Current Employer" optional {...f.status("current_employer")}>
        <TextField {...f.field("current_employer")} maxLength={160} />
      </Field>
      <Field label="Academics" optional {...f.status("academics")}>
        <SelectField options={ACADEMICS} placeholder="Pick a grade" {...f.field("academics")} />
      </Field>
      <Grid cols={2}>
        <Field label="Total Months" optional {...f.status("total_experience_months")}>
          <NumberField {...f.field("total_experience_months")} />
        </Field>
        <Field label="Relevant Months" optional {...f.status("relevant_experience_months")}>
          <NumberField {...f.field("relevant_experience_months")} />
        </Field>
      </Grid>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Save Details</Button>
      </FormFooter>
    </>
  );
}
