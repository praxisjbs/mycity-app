/**
 * Recruitment · Interviews (docs/guides/recruitment.md §6.6, §10): Upcoming and Recent (the interviews
 * still to end first, then those past) or My Panels, across the page; a row opens its interview in a
 * wide dialog on desktop, its cards side by side, and in a sheet on a phone (ListDetail `modal`, F31 as
 * amended 08/11/2026). The interview shows when and where, the Blind Panel (Submitted or
 * Waiting, a score only where the API gives one: Hidden until the round closes), the candidate's
 * Weighted Scorecard (for a reader whose scope holds the role), Candidate Details, once closed each
 * trait's ratings and average, the total, the report and its decision, and Round Activity. A panelist
 * opens My Card from it; a recruiter reschedules, cancels, closes the round and writes the report.
 */
import { useEffect, useRef, useState } from "react";
import interviewSchemas from "@mycity/contract/schemas/interviews.js";
import type { Interview, InterviewActivity, InterviewDetail } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { saveFile } from "@/api/download";
import { useAuth } from "@/auth/AuthProvider";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import { useNewLink, useScreenAction } from "@/shell/screen-action";
import {
  ActionGroup,
  Bars,
  Button,
  Card,
  CardHeader,
  ChoiceField,
  cn,
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
  ListDetail,
  LoadingRows,
  NumberField,
  PageHeader,
  Pill,
  RatingField,
  SegmentedControl,
  Stack,
  TextAreaField,
  TextField,
  Timeline,
  toast,
  Toolbar,
  useConfirm,
  useContractForm,
  useModal,
  useIsPhone,
  useUnsavedChanges,
} from "@mycity/ui";
import { MyCard } from "./MyCard";
import { ScheduleForm } from "./ScheduleInterview";
import { bodySchema, DECISION, DECISIONS, INTERVIEW_TYPE, pill, say, sayRefusal, ScoreText } from "./shared";

const HIDDEN_HELP = "Each score shows once the round closes. Private notes never show.";
const SCORECARD_HELP = "The candidate's score at each part, with the part's weight in the total.";
const VIEWS: Array<["all" | "mine", string]> = [
  ["all", "All Interviews"],
  ["mine", "My Panels"],
];
const ACADEMICS: Array<[string, string]> = [
  ["outstanding", "Outstanding"],
  ["very_good", "Very Good"],
  ["good", "Good"],
  ["average", "Average"],
  ["poor", "Poor"],
];

/** The round as one pill: cancelled, closed, still to start with no card in, or how many cards are in. */
const roundState = (x: Pick<Interview, "status" | "round_status" | "scheduled_start" | "submitted_count" | "panel_size">) =>
  x.status === "cancelled"
    ? pill(["neutral", "Cancelled"])
    : x.round_status === "closed"
      ? pill(["ok", "Closed"])
      : x.submitted_count === 0 && Date.parse(x.scheduled_start) > Date.now()
        ? pill(["info", "Scheduled"])
        : pill(["warn", `${x.submitted_count} of ${x.panel_size} Submitted`]);
const when = (x: Pick<Interview, "scheduled_start" | "scheduled_end">) => `${formatDateTime(x.scheduled_start)} to ${formatTime(x.scheduled_end)}`;
const months = (n: number | null) => (n === null ? "–" : n < 12 ? `${n} months` : `${Math.floor(n / 12)} years${n % 12 ? `, ${n % 12} months` : ""}`);
const panelists = (n: number) => `${n} ${n === 1 ? "panelist" : "panelists"}`;

/** One line of Round Activity, in words: who did what. Never a rating (the API sends none). */
function activityLine(a: InterviewActivity): string {
  const by = a.actor_name;
  switch (a.kind) {
    case "scheduled":
      return by ? `Scheduled by ${by}` : "Scheduled";
    case "rescheduled":
      return by ? `Changed by ${by}` : "Changed";
    case "cancelled":
      return by ? `Cancelled by ${by}` : "Cancelled";
    case "details_saved":
      return by ? `Candidate Details saved by ${by}` : "Candidate Details saved";
    case "feedback_submitted":
      return by ? `${by} submitted their card` : "A card was submitted";
    case "round_closed":
      return by ? `Round closed by ${by}` : "Round closed";
    case "reported":
      return by ? `Report written by ${by}` : "Report written";
    case "feedback_due":
      return a.panelist_name ? `${a.panelist_name} reminded` : "Panelist reminded";
  }
}

export function Interviews() {
  const modal = useModal();
  const mayEdit = useAuth().can("recruitment", "edit");
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"all" | "mine">(params.get("mine") === "true" ? "mine" : "all");
  // No sort: the API puts the interviews still to end first, soonest first, then those past, latest first.
  const list = usePaged("GET /api/v1/recruitment/interviews", { filters: view === "mine" ? { mine: "true" } : {} });
  const phone = useIsPhone();
  // Nothing opens unasked: a row opens its interview in the dialog, or the sheet on a phone (F31).
  const [picked, setPicked] = useState<string | null>(null);
  const shown = picked;
  const schedule = () => modal.open({ title: "Schedule Interview", wide: true, body: (close) => <ScheduleForm close={close} onSaved={(x) => setPicked(x.interview_id)} /> });
  useScreenAction(mayEdit ? { label: "Schedule Interview", onSelect: schedule } : null);
  useNewLink(mayEdit ? schedule : null);

  const linked = params.get("id");
  const mineLinked = params.get("mine");
  const opened = useRef<string | null>(null);
  // A link opens its interview whenever it arrives, also while already on the tab (a second notice for
  // the same interview the next day); `?mine=true` switches to My Panels whenever it arrives.
  useEffect(() => {
    if (mineLinked) {
      setView("mine");
      setParams({ mine: null }, { replace: true });
    }
    if (!linked) return void (opened.current = null);
    if (opened.current === linked) return;
    opened.current = linked;
    setParams({ id: null }, { replace: true });
    setPicked(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, mineLinked]);

  return (
    <>
      <PageHeader title="Interviews" actions={mayEdit ? <Button variant="primary" icon="plus" onClick={schedule}>Schedule Interview</Button> : undefined} />
      <Toolbar>
        <SegmentedControl
          label="Which Interviews"
          value={view}
          onChange={(v) => {
            setView(v);
            setPicked(null);
          }}
          options={VIEWS}
        />
      </Toolbar>
      <ListDetail
        layout="modal"
        size="xl"
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Interview"
        list={
          <PagedTable<Interview>
            title="Upcoming and Recent"
            list={list}
            search="Search candidates"
            rowKey={(x) => x.interview_id}
            noun="interview"
            onRowClick={(x) => setPicked(x.interview_id)}
            // Only interviews that exist are listed: a candidate at the Interview stage with none scheduled is not one.
            empty={list.q ? undefined : { title: view === "mine" ? "No Panels Yet" : "No Interviews Scheduled" }}
            columns={[
              { key: "who", label: "Candidate", render: (x) => <span className={cn(x.interview_id === shown ? "font-semibold" : "font-medium")}>{x.candidate_name}</span> },
              { key: "role", label: "Role", render: (x) => x.vacancy.title, desktop: true },
              { key: "when", label: "Date", render: (x) => formatDateTime(x.scheduled_start) },
              { key: "ends", label: "Ends", render: (x) => formatTime(x.scheduled_end), desktop: true },
              { key: "how", label: "How", render: (x) => INTERVIEW_TYPE[x.interview_type], desktop: true },
              {
                key: "panel",
                label: "Panel",
                render: (x) => (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {panelists(x.panel_size)}
                    {x.on_panel && !x.my_submitted && x.round_status === "open" && x.status !== "cancelled" && <Pill tone="warn">Your Card</Pill>}
                  </span>
                ),
              },
              { key: "round", label: "Round", render: roundState },
            ]}
          />
        }
        // The dialog lays the cards out side by side; a phone's sheet stacks them.
        detail={shown ? <InterviewRecord key={shown} id={shown} part={phone ? "all" : "wide"} /> : null}
      />
    </>
  );
}

/**
 * One interview. `wide` (the desktop dialog): the summary, the Blind Panel, the Weighted Scorecard and
 * Candidate Details two by two, then Round Activity across the dialog, then the round's traits and
 * result once closed. `all` (a phone's sheet): the same, one under another.
 */
export function InterviewRecord({ id, part = "all" }: { id: string; part?: "wide" | "all" }) {
  const modal = useModal();
  const confirm = useConfirm();
  const mayEdit = useAuth().can("recruitment", "edit");
  const read = useApi("GET /api/v1/recruitment/interviews/:id", { params: { id } });
  const shut = useMutation("POST /api/v1/recruitment/interviews/:id/close");
  const x = read.data;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!x) return <Card><LoadingRows count={8} /></Card>;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/recruitment/interviews");
  };
  const closed = x.round.status === "closed";
  const live = x.status !== "cancelled";
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
  const myCard = () => modal.open({ title: "My Card", wide: true, full: true, body: (close) => <MyCard interview={x} close={close} onChanged={reload} /> });
  const seats = x.panel;
  const parts = (x.scorecard ?? []).filter((p) => p.active);
  const blindPanel = (
    <DataView
      title="Blind Panel"
      right={roundState(x)}
      rows={seats}
      rowKey={(s) => s.interview_panelist_id}
      columns={[
        { key: "who", label: "Panelist", render: (s) => s.panelist.display_name },
        { key: "state", label: "Card", render: (s) => (s.submitted_at ? pill(["ok", "Submitted"]) : pill(["warn", "Waiting"])) },
        {
          key: "score",
          label: "Score",
          align: "n",
          // Only what the API sends: a score it hides arrives as null, and a submitted card shows Hidden.
          render: (s) => (s.score !== null ? s.score.toFixed(1) : s.submitted_at ? <HelpTerm help={HIDDEN_HELP}>Hidden</HelpTerm> : "–"),
        },
        { key: "decision", label: "Decision", render: (s) => (s.decision ? pill(DECISION[s.decision]) : "–"), desktop: true },
      ]}
    />
  );
  const summary = (
    <Card as="article">
      <CardHeader record title={x.candidate_name} right={<Pill dot={false}>{x.round.title}</Pill>} />
      <KeyValue
        items={[
          ["Role", x.vacancy.title],
          ["When", when(x)],
          ["How", INTERVIEW_TYPE[x.interview_type]],
          ...(x.worksite ? [["Where", [x.worksite.name, x.worksite.address].filter(Boolean).join(", ")] as [string, string]] : []),
          ...(x.meeting_url ? [["Link", <a key="l" className="wrap-any underline" href={x.meeting_url} target="_blank" rel="noopener noreferrer">{x.meeting_url}</a>] as [string, React.ReactNode]] : []),
        ]}
      />
      <ActionGroup>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {x.cv_document_id && <Button icon="doc" onClick={() => saveFile(`/api/v1/recruitment/interviews/${id}/cv`, `${x.candidate_name} CV.pdf`)}>View CV</Button>}
          {x.round.form_document_id && <Button icon="download" onClick={() => saveFile(`/api/v1/documents/${x.round.form_document_id}/content`, `Interview Assessment Form ${x.candidate_name}.pdf`)}>Download Form</Button>}
          {x.can_edit && <Button onClick={() => modal.open({ title: "Reschedule", wide: true, body: (close) => <ScheduleForm interview={x} close={close} onSaved={reload} /> })}>Reschedule</Button>}
          {x.can_edit && <Button variant="danger" onClick={() => modal.open({ title: "Cancel Interview", body: (close) => <CancelForm interview={x} close={close} onSaved={reload} /> })}>Cancel Interview</Button>}
          {x.can_close && <Button onClick={closeRound}>Close Round</Button>}
          {x.can_report && <Button onClick={() => modal.open({ title: "Write Report", body: (close) => <ReportForm interview={x} close={close} onSaved={reload} /> })}>{x.round.report ? "Edit Report" : "Write Report"}</Button>}
          {x.on_panel && live && <Button variant="primary" className="max-md:w-full" onClick={myCard}>My Card</Button>}
        </div>
      </ActionGroup>
    </Card>
  );
  const scorecard = x.scorecard ? (
    <Card>
      <CardHeader title="Weighted Scorecard" help={SCORECARD_HELP} right={x.weighted_total === null ? undefined : <b className="tabular-nums">{x.weighted_total.toFixed(1)}</b>} />
      <Bars rows={parts.map((p) => ({ label: `${p.name}, ${p.weight}%`, percent: p.score ?? 0, value: <ScoreText score={p.score} provisional={p.provisional} /> }))} />
    </Card>
  ) : null;
  const details = (
    <Card>
      <CardHeader
        title="Candidate Details"
        right={mayEdit && live ? <Button size="sm" icon="edit" onClick={() => modal.open({ title: "Candidate Details", body: (close) => <DetailsForm interview={x} close={close} onSaved={reload} /> })}>Edit</Button> : undefined}
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
  );
  const activity = (
    <>
      {x.activity.length > 0 && (
        <Card>
          <CardHeader title="Round Activity" />
          <Timeline
            label="Round Activity"
            items={x.activity.map((a) => ({
              title: activityLine(a),
              when: formatDateTime(a.occurred_at),
              tone: a.kind === "feedback_submitted" || a.kind === "round_closed" || a.kind === "reported" ? "done" : undefined,
            }))}
          />
        </Card>
      )}
    </>
  );
  const result = (
    <>
      {closed && x.trait_averages.length > 0 && (
        <DataView
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
      {closed && live && (
        <Card>
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
    </>
  );
  if (part === "wide")
    return (
      <Stack>
        {/* Two by two, each card at its own height: the dialog scrolls as one. */}
        <Grid cols={2} scroll={false} flush>
          {summary}
          {blindPanel}
          {scorecard}
          {details}
        </Grid>
        {activity}
        {result}
      </Stack>
    );
  return (
    <Stack>
      {summary}
      {blindPanel}
      {scorecard}
      {details}
      {result}
      {activity}
    </Stack>
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
  useUnsavedChanges(f.isDirty);
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
        <ChoiceField options={DECISIONS} {...f.field("decision")} />
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
        <ChoiceField options={ACADEMICS} {...f.field("academics")} />
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
