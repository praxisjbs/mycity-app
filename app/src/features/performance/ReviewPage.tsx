/**
 * Performance · Reviews · a review: the check-in beside the reviewer's scores, the dotted manager's
 * input, the month's tasks and attendance, corrective actions and the chain (docs/guides/
 * performance.md §3.3, §6.12, §6.15, §6.16, §10). What the reader may do comes from the review's
 * `can`; what they may not see arrives empty (A17). Opened from the Reviews tab and from links.
 */
import { useState } from "react";
import reviewsContract from "@mycity/contract/schemas/reviews.js";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { ReviewDetail, ReviewItem } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { saveFile } from "@/api/download";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { EmployeePicker } from "@/features/shared/pickers";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  Chain,
  DataView,
  DateField,
  Field,
  formatDate,
  FormFooter,
  HelpTerm,
  KeyValue,
  LoadingRows,
  ErrorState,
  NumberField,
  Quote,
  SelectField,
  StatusPill,
  Sub,
  TextAreaField,
  TextField,
  toast,
  todayIso,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { fieldMessage, rating, reviewStatus, score, SECTION_NAMES, targetOf } from "./shared";

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");
const STEP: Record<ReviewDetail["chain"][number]["key"], string> = { check_in: "Check-In", reviewer: "Reviewer", second_level: "Second Level", hr: "HR" };
const BUCKET: Record<string, string> = { done: "Done This Month", ongoing: "Ongoing", next_month: "Next Month" };
const OUTCOME: Record<string, string> = { confirm: "Confirm", extend: "Extend 3 Months", end: "End Employment" };

/** Where a line's figure came from, in a few words. */
function evidenceOf(i: ReviewItem) {
  if (!i.evidence_kind) return "–";
  if (i.evidence_kind === "note") return i.evidence_note ?? "Note";
  if (i.evidence_kind === "link") return i.evidence_url ?? "Link";
  if (i.evidence_kind === "document") return "File";
  return i.evidence_entity_type ? "Record" : "–";
}

const lineTitle = (i: ReviewItem) => i.line?.title ?? (i.criterion ? i.criterion[0].toUpperCase() + i.criterion.slice(1) : "Line");

/** One review, as the reader may see it, and what they may do to it now. */
export function ReviewSheet({ id, close }: { id: string; close: () => void }) {
  const modal = useModal();
  const read = useApi("GET /api/v1/performance/reviews/:id", { params: { id } });
  const askInput = useMutation("POST /api/v1/performance/reviews/:id/ask-input");
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const outcome = useMutation("POST /api/v1/performance/reviews/:id/probation-outcome");
  if (read.error?.code === "CHECK_IN_FIRST") return <Banner tone="info">Waiting for the check-in.</Banner>;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  const r = read.data;
  if (!r) return <LoadingRows count={6} />;
  const reload = () => {
    read.reload();
    invalidate("/api/v1/performance/reviews");
    invalidate("/api/v1/performance/rounds");
    invalidate("/api/v1/workflow");
  };
  const closed = r.status === "closed";
  const steps = r.chain.filter((s) => s.state !== "skipped").map((s) => ({ label: STEP[s.key], state: s.state === "done" ? ("done" as const) : s.state === "current" ? ("now" as const) : undefined }));

  const ask = async () => {
    try {
      await askInput.run({ params: { id }, body: {} });
      reload();
      toast("Input asked for");
    } catch (e) {
      say(e);
    }
  };
  const decide = async () => {
    if (!r.workflow_instance_id) return;
    try {
      await approve.run({ params: { id: r.workflow_instance_id }, body: {} });
      reload();
      toast(r.status === "with_hr" ? "Review closed" : "Review approved");
    } catch (e) {
      say(e);
    }
  };
  const choose = async (code: "confirm" | "extend" | "end") => {
    try {
      await outcome.run({ params: { id }, body: { probation_outcome: code } });
      reload();
      toast(`${OUTCOME[code]} chosen`);
    } catch (e) {
      say(e);
    }
  };
  const pdf = () => saveFile(`/api/v1/documents/${r.document_id}/content`, `Review ${r.employee.display_name} ${r.round_name ?? ""}.pdf`.replace(/\s+/g, " "));

  return (
    <>
      <KeyValue
        items={[
          ["Employee", r.employee.display_name],
          ["Month", r.round_name ?? (r.review_kind === "probation" ? "Probation" : "–")],
          ["Reviewer", r.reviewer.display_name],
          ["Stage", <StatusPill key="s" s={reviewStatus(r.status)} />],
          ["Due", r.due_on ? formatDate(r.due_on) : null],
          ...(r.probation_outcome ? ([["Outcome", OUTCOME[r.probation_outcome]]] as Array<[string, string]>) : []),
        ]}
      />
      <Chain className="mt-3" steps={steps} label="Review chain" />
      {r.returned_reason && r.status === "returned" && <Banner className="mt-3" tone="err">{r.returned_reason}</Banner>}
      <LinesTable r={r} />
      {(r.dotted_input || r.can.give_input) && (
        <Card className="mt-3">
          <CardHeader title="Input" />
          {r.dotted_input ? <Quote>{r.dotted_input}</Quote> : <InputForm id={id} onDone={reload} />}
          {r.dotted && <Sub>{r.dotted.display_name}</Sub>}
        </Card>
      )}
      <MonthCard r={r} />
      {(closed || r.score_month) && (
        <KeyValue
          className="mt-3"
          items={[
            ["Score This Month", score(r.score_month)],
            ["Score to Date", score(r.score_to_date)],
            ["Rating", rating(r.rating).text],
            ...(r.conduct_note ? ([["Conduct", r.conduct_note]] as Array<[string, string]>) : []),
          ]}
        />
      )}
      {r.actions.length > 0 && !r.can.score && (
        <DataView
          className="mt-3"
          title="Corrective Actions"
          rows={r.actions}
          rowKey={(a) => a.performance_review_item_id}
          columns={[
            { key: "title", label: "Action", render: (a) => a.title },
            { key: "owner", label: "Owner", render: (a) => a.owner.display_name },
            { key: "due", label: "Due", render: (a) => formatDate(a.due_on) },
            { key: "task", label: "Task", render: (a) => a.task_number ?? "–", desktop: true },
          ]}
        />
      )}
      {r.can.score ? (
        <ScoreForm r={r} close={close} reload={reload} ask={ask} />
      ) : (
        <FormFooter>
          <Button onClick={close}>Close</Button>
          {r.can.ask_input && <Button onClick={ask}>Ask For Input</Button>}
          {r.can.mark_conduct && <Button onClick={() => modal.open({ title: "Mark Conduct", body: (done) => <ConductForm id={id} close={() => (done(), reload())} /> })}>Mark Conduct</Button>}
          {r.can.start_pip && <Button onClick={() => modal.open({ title: "Start PIP", body: (done) => <PipForm r={r} close={() => (done(), reload())} /> })}>Start PIP</Button>}
          {r.can.decide_probation && (["confirm", "extend", "end"] as const).map((code) => <Button key={code} onClick={() => choose(code)}>{OUTCOME[code]}</Button>)}
          {r.can.decide && r.workflow_instance_id && (
            <Button onClick={() => modal.open({ title: "Request Changes", body: (done) => <ChangesForm instanceId={r.workflow_instance_id!} close={() => (done(), reload())} /> })}>Request Changes</Button>
          )}
          {r.can.decide && <Button variant="primary" onClick={decide}>{r.status === "with_hr" ? "Close Review" : "Approve"}</Button>}
          {closed && r.document_id && <Button variant="primary" icon="download" onClick={pdf}>Download PDF</Button>}
        </FormFooter>
      )}
    </>
  );
}

/** Each line: what was aimed for, what came in and its evidence, the employee's action, and each score. */
function LinesTable({ r }: { r: ReviewDetail }) {
  return (
    <DataView
      className="mt-3"
      title="Lines"
      rows={r.items}
      rowKey={(i) => i.performance_review_item_id}
      empty={{ title: "No Lines" }}
      columns={[
        {
          key: "line",
          label: "Line",
          render: (i) => (
            <span className="flex flex-wrap items-center gap-1.5">
              {lineTitle(i)}
              {i.auto && <StatusPill s={{ tone: "info", text: "Auto" }} />}
              {!i.assessable && <HelpTerm help="No evidence was given, so it does not count either way.">Not Assessable</HelpTerm>}
            </span>
          ),
        },
        { key: "section", label: "Section", render: (i) => (i.line ? SECTION_NAMES[i.line.section] : "Probation"), desktop: true },
        { key: "target", label: "Target", render: (i) => (i.line ? targetOf(i.line) : "–") },
        { key: "actual", label: "Actual", render: (i) => i.actual_value ?? i.actual_text ?? (i.achieved_on ? formatDate(i.achieved_on) : "–") },
        { key: "evidence", label: "Evidence", render: evidenceOf, desktop: true },
        { key: "action", label: "Action", render: (i) => i.action_text ?? "–", desktop: true },
        { key: "proposed", label: <HelpTerm help="Worked out from the actual against the target.">Proposed</HelpTerm>, align: "n", render: (i) => score(i.proposed_score) },
        {
          key: "self",
          label: <HelpTerm help="The employee's own score, with their reason.">Self</HelpTerm>,
          align: "n",
          render: (i) => (i.self_score === null ? "–" : i.self_reason ? <HelpTerm help={i.self_reason}>{score(i.self_score)}</HelpTerm> : score(i.self_score)),
        },
        { key: "final", label: "Final", align: "n", render: (i) => score(i.score) },
      ]}
    />
  );
}

/** The month around the review: its tasks from Workspace, attendance and recognitions. */
function MonthCard({ r }: { r: ReviewDetail }) {
  const ctx = r.context;
  return (
    <>
      <KeyValue
        className="mt-3"
        items={[
          ["Done This Month", String(r.task_counts.done)],
          ["Ongoing", String(r.task_counts.ongoing)],
          ["Next Month", String(r.task_counts.next_month)],
          ...(ctx
            ? ([
                ["This Month", `${ctx.on_time} on time · ${ctx.late} late · ${ctx.absent} absent`],
                ["Recognitions", String(ctx.recognitions)],
              ] as Array<[string, string]>)
            : []),
        ]}
      />
      {r.tasks.length > 0 && (
        <DataView
          className="mt-3"
          title="Tasks"
          rows={r.tasks}
          rowKey={(t) => t.task_id}
          columns={[
            { key: "task", label: "Task", render: (t) => `${t.number} · ${t.title}` },
            { key: "bucket", label: "When", render: (t) => BUCKET[t.bucket] },
            { key: "due", label: "Due", render: (t) => (t.due_at ? formatDate(t.due_at.slice(0, 10)) : "–"), desktop: true },
          ]}
        />
      )}
    </>
  );
}

/** A line's score as the reviewer edits it, and its corrective action. */
type ScoreRow = { score: string; override_reason: string; comment: string; action: string; owner: PersonRef[]; due_on: string };

/** A line is behind when the score given is under 1: it takes a corrective action (§6.16). */
const behind = (row: ScoreRow) => row.score !== "" && Number(row.score) < 1;

/** The reviewer's side: each line's final score, a reason where it differs, a comment and the actions. */
function ScoreForm({ r, close, reload, ask }: { r: ReviewDetail; close: () => void; reload: () => void; ask: () => Promise<void> }) {
  const modal = useModal();
  const [rows, setRows] = useState<Record<string, ScoreRow>>(() =>
    Object.fromEntries(
      r.items.map((i) => {
        const a = r.actions.find((x) => x.performance_review_item_id === i.performance_review_item_id);
        return [i.performance_review_item_id, { score: i.score ?? i.proposed_score ?? "", override_reason: i.override_reason ?? "", comment: i.comment ?? "", action: a?.title ?? "", owner: [a?.owner ?? r.employee], due_on: a?.due_on ?? "" }];
      }),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const saveScores = useMutation("PUT /api/v1/performance/reviews/:id/scores");
  const submitReview = useMutation("POST /api/v1/performance/reviews/:id/submit");
  const set = (id: string, patch: Partial<ScoreRow>) => setRows((x) => ({ ...x, [id]: { ...x[id], ...patch } }));
  const scored = r.items.filter((i) => i.assessable && !(i.auto && i.proposed_score === null));
  const bodyOf = () => {
    const withAction = r.items.filter((i) => rows[i.performance_review_item_id].action.trim());
    return {
      items: r.items.map((i) => {
        const x = rows[i.performance_review_item_id];
        return { performance_review_item_id: i.performance_review_item_id, score: x.score === "" ? null : x.score, override_reason: x.override_reason.trim() || undefined, comment: x.comment.trim() || undefined };
      }),
      actions: withAction.map((i) => {
        const x = rows[i.performance_review_item_id];
        return { performance_review_item_id: i.performance_review_item_id, title: x.action.trim(), owner_employee_id: x.owner[0]?.employee_id ?? r.employee.employee_id, due_on: x.due_on };
      }),
      withAction,
    };
  };
  /** The API's field errors, keyed by item: `items.n.*` by the item, `actions.k.*` by the action sent. */
  const keep = (e: unknown, sent: ReviewItem[]) => {
    if (!(e instanceof ApiError) || !Object.keys(e.fields).length) return say(e);
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(e.fields)) {
      const item = /^items\.(\d+)\.(\w+)$/.exec(k);
      const act = /^actions\.(\d+)(?:\.(\w+))?$/.exec(k);
      if (item) out[`${r.items[Number(item[1])]?.performance_review_item_id}.${item[2]}`] = v;
      else if (act && act[2]) out[`${sent[Number(act[1])]?.performance_review_item_id}.action_${act[2]}`] = v;
      else if (act) out[`${r.items[Number(act[1])]?.performance_review_item_id}.action_title`] = v;
    }
    setErrors(out);
    toast(e.message);
  };
  const save = async () => {
    const { withAction, ...body } = bodyOf();
    try {
      await saveScores.run({ params: { id: r.performance_review_id }, body });
      setErrors({});
      reload();
      toast("Scores saved");
      return true;
    } catch (e) {
      keep(e, withAction);
      return false;
    }
  };
  const submit = async () => {
    if (!(await save())) return;
    try {
      await submitReview.run({ params: { id: r.performance_review_id }, body: {} });
      reload();
      close();
      toast("Review submitted");
    } catch (e) {
      keep(e, []);
    }
  };
  const mark = (id: string, key: string, short: string) => {
    const message = fieldMessage(errors[`${id}.${key}`]?.[0], short);
    return message ? { state: "bad" as const, message } : {};
  };
  return (
    <>
      {scored.map((i) => {
        const id = i.performance_review_item_id;
        const x = rows[id];
        const differs = x.score !== "" && (i.proposed_score === null || Number(x.score) !== Number(i.proposed_score));
        return (
          <Card key={id} className="mt-3">
            <CardHeader title={lineTitle(i)} />
            <Field label="Final Score" {...mark(id, "score", "Give a score")}>
              <NumberField decimal value={x.score} onChange={(v) => set(id, { score: v })} />
            </Field>
            {differs && (
              <Field label="Reason" {...mark(id, "override_reason", "Give a reason")}>
                <TextField value={x.override_reason} onChange={(v) => set(id, { override_reason: v })} />
              </Field>
            )}
            <Field label="Comment" optional {...mark(id, "comment", "Shorten the comment")}>
              <TextAreaField value={x.comment} onChange={(v) => set(id, { comment: v })} rows={2} />
            </Field>
            {(behind(x) || x.action) && (
              <>
                <Field label="Corrective Action" {...mark(id, "action_title", "Add an action")}>
                  <TextField value={x.action} onChange={(v) => set(id, { action: v })} />
                </Field>
                <Field label="Owner" {...mark(id, "action_owner_employee_id", "Pick an owner")}>
                  <EmployeePicker value={x.owner} onChange={(v) => set(id, { owner: v.slice(0, 1) })} />
                </Field>
                <Field label="Due Date" {...mark(id, "action_due_on", "Pick a date")}>
                  <DateField value={x.due_on} onChange={(v) => set(id, { due_on: v })} />
                </Field>
              </>
            )}
          </Card>
        );
      })}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {r.can.return_check_in && <Button onClick={() => modal.open({ title: "Return Check-In", body: (done) => <ReturnForm id={r.performance_review_id} close={() => (done(), close())} /> })}>Return Check-In</Button>}
        {r.can.ask_input && <Button onClick={ask}>Ask For Input</Button>}
        <Button onClick={save}>Save Scores</Button>
        {r.can.submit && <Button variant="primary" onClick={submit}>Submit Review</Button>}
      </FormFooter>
    </>
  );
}

function ReturnForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ returned_reason: "" }, reviewsContract.ReturnCheckIn);
  const save = useMutation("POST /api/v1/performance/reviews/:id/return");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      invalidate("/api/v1/performance/reviews");
      close();
      toast("Check-in returned");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("returned_reason")}><TextAreaField {...f.field("returned_reason")} rows={3} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Return Check-In</Button>
      </FormFooter>
    </>
  );
}

function InputForm({ id, onDone }: { id: string; onDone: () => void }) {
  const f = useContractForm({ dotted_input: "" }, reviewsContract.ReviewInput);
  const save = useMutation("POST /api/v1/performance/reviews/:id/input");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      onDone();
      toast("Input given");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Your Input" {...f.status("dotted_input")}><TextAreaField {...f.field("dotted_input")} rows={3} /></Field>
      <FormFooter>
        <Button variant="primary" onClick={submit}>Give Input</Button>
      </FormFooter>
    </>
  );
}

/** Request Changes: the review goes back to its reviewer with the reason. */
function ChangesForm({ instanceId, close }: { instanceId: string; close: () => void }) {
  const f = useContractForm({ reason: "" }, workflow.ReasonBody);
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await reject.run({ params: { id: instanceId }, body: { reason: f.values.reason.trim() } });
      close();
      toast("Sent back to the reviewer");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}><TextAreaField {...f.field("reason")} rows={3} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Request Changes</Button>
      </FormFooter>
    </>
  );
}

/** Mark Conduct: a confirmed breach caps the rating at Partly Meets (§6.15). */
function ConductForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ breach: "true", conduct_note: "" }, {
    safeParse: (v: unknown) => {
      const x = v as { breach: string; conduct_note: string };
      return reviewsContract.ConductMark.safeParse({ conduct_breach: x.breach === "true", conduct_note: x.conduct_note });
    },
  });
  const save = useMutation("POST /api/v1/performance/reviews/:id/conduct");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: { conduct_breach: f.values.breach === "true", conduct_note: f.values.conduct_note } });
      close();
      toast("Conduct marked");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Conduct" {...f.status("breach")}>
        <SelectField options={[["true", "Breach Confirmed"], ["false", "No Breach"]]} {...f.field("breach")} />
      </Field>
      <Field label="Note" {...f.status("conduct_note")}><TextAreaField {...f.field("conduct_note")} rows={3} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Mark Conduct</Button>
      </FormFooter>
    </>
  );
}

/** Start PIP from a closed review rated Below: a line for each line scored under its target. */
function PipForm({ r, close }: { r: ReviewDetail; close: () => void }) {
  const under = r.items.filter((i) => i.line && i.score !== null && Number(i.score) < 1);
  const [lines, setLines] = useState(() => (under.length ? under : r.items.slice(0, 1)).map((i) => ({ employee_target_id: i.employee_target_id ?? "", text: lineTitle(i), target_text: i.line ? targetOf(i.line) : "" })));
  const f = useContractForm({ starts_on: todayIso(), summary: "" }, { starts_on: (v) => (v ? null : "Pick a date") });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const save = useMutation("POST /api/v1/performance/pips");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { performance_review_id: r.performance_review_id, starts_on: f.values.starts_on, summary: f.values.summary.trim() || undefined, lines } });
      close();
      toast("Improvement plan started");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors(e.fields);
        f.setServerErrors(e.fields);
      } else say(e);
    }
  };
  return (
    <>
      <Field label="Starts On" {...f.status("starts_on")}><DateField {...f.field("starts_on")} /></Field>
      {lines.map((l, n) => {
        const message = fieldMessage(errors[`lines.${n}.text`]?.[0], "Name the line");
        return (
          <Field key={n} label={`Line ${n + 1}`} {...(message ? { state: "bad" as const, message } : {})}>
            <TextField value={l.text} onChange={(v) => setLines(lines.map((x, j) => (j === n ? { ...x, text: v } : x)))} />
          </Field>
        );
      })}
      <Field label="Summary" optional {...f.status("summary")}><TextAreaField {...f.field("summary")} rows={3} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Start PIP</Button>
      </FormFooter>
    </>
  );
}
