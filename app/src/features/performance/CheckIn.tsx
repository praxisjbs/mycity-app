/**
 * The monthly check-in: each line's actual, evidence and action, the proposed and self scores,
 * Dictate and Tidy With AI, Save Draft and Submit Check-In (docs/guides/performance.md §3.3, §6.12,
 * §6.14, §6.17, §10). Opened from ESS · My Performance. Nothing here reaches the reviewer until it
 * is submitted (A17); automatic lines arrive filled and are not edited here.
 */
import { useState } from "react";
import type { Dictation, ReviewCheckIn, ReviewItem } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation } from "@/api/hooks";
import { upload } from "@/api/upload";
import {
  Banner,
  Button,
  Card,
  CardHeader,
  DataView,
  DateField,
  ErrorState,
  Field,
  formatDate,
  FormFooter,
  HelpTerm,
  KeyValue,
  LoadingRows,
  NumberField,
  SelectField,
  StatusPill,
  TextAreaField,
  TextField,
  toast,
  UploadField,
  VoiceField,
} from "@mycity/ui";
import { fieldMessage, reviewStatus, score, SECTION_NAMES, targetOf } from "./shared";

const say = (e: unknown) => toast(e instanceof ApiError ? e.message : "Could not save");
const BUCKET: Record<string, string> = { done: "Done This Month", ongoing: "Ongoing", next_month: "Next Month" };
const EVIDENCE: Array<[string, string]> = [["", "None Yet"], ["note", "Source"], ["record", "Task"], ["link", "Link"], ["document", "File"]];

/** A line as the employee fills it. */
type Row = {
  actual: string;
  achieved_on: string;
  evidence_kind: string;
  evidence_note: string;
  evidence_url: string;
  evidence_document_id: string;
  evidence_entity_id: string;
  action_text: string;
  action_transcript: string;
  action_document_id: string;
  action_ai_run_id: string;
  self_score: string;
  self_reason: string;
  changing: boolean;
  tidied: string | null;
};

const rowOf = (i: ReviewItem): Row => ({
  actual: i.actual_value ?? i.actual_text ?? "",
  achieved_on: i.achieved_on ?? "",
  evidence_kind: i.evidence_kind ?? "",
  evidence_note: i.evidence_note ?? "",
  evidence_url: i.evidence_url ?? "",
  evidence_document_id: i.evidence_document_id ?? "",
  evidence_entity_id: i.evidence_entity_type === "task" ? (i.evidence_entity_id ?? "") : "",
  action_text: i.action_text ?? "",
  action_transcript: i.action_transcript ?? "",
  action_document_id: i.action_document_id ?? "",
  action_ai_run_id: "",
  self_score: i.self_score ?? "",
  self_reason: i.self_reason ?? "",
  changing: i.self_score !== null,
  tidied: null,
});

const or = (v: string) => (v.trim() === "" ? null : v.trim());
const title = (i: ReviewItem) => i.line?.title ?? (i.criterion ? i.criterion[0].toUpperCase() + i.criterion.slice(1) : "Line");

/** The item as Save Draft sends it: only what the person fills, never an automatic line. */
function saveOf(i: ReviewItem, r: Row) {
  const measure = i.line?.measure;
  const kind = r.evidence_kind || null;
  return {
    performance_review_item_id: i.performance_review_item_id,
    ...(i.line
      ? measure === "milestone"
        ? { achieved_on: or(r.achieved_on), actual_text: or(r.actual) }
        : { actual_value: or(r.actual) }
      : {}),
    evidence_kind: kind as ReviewItem["evidence_kind"],
    evidence_note: kind === "note" ? or(r.evidence_note) : null,
    evidence_url: kind === "link" ? or(r.evidence_url) : null,
    evidence_document_id: kind === "document" ? or(r.evidence_document_id) : null,
    evidence_entity_type: kind === "record" ? "task" : null,
    evidence_entity_id: kind === "record" ? or(r.evidence_entity_id) : null,
    action_text: or(r.action_text),
    action_transcript: or(r.action_transcript),
    action_document_id: or(r.action_document_id),
    action_ai_run_id: or(r.action_ai_run_id),
    self_score: r.changing ? or(r.self_score) : null,
    self_reason: r.changing ? or(r.self_reason) : null,
  };
}

/** The caller's open check-in, or what became of it. */
export function CheckInSheet({ close }: { close: () => void }) {
  const read = useApi("GET /api/v1/ess/performance/check-in");
  if (read.error?.code === "NO_OPEN_CHECK_IN") return <Banner tone="info">No check-in is open.</Banner>;
  if (read.error) return <ErrorState error={read.error} onRetry={read.reload} />;
  if (!read.data) return <LoadingRows count={6} />;
  return <CheckInForm c={read.data} close={close} reload={read.reload} />;
}

function CheckInForm({ c, close, reload }: { c: ReviewCheckIn; close: () => void; reload: () => void }) {
  const open = c.status === "check_in";
  const own = c.items.filter((i) => !i.auto);
  const auto = c.items.filter((i) => i.auto);
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(c.items.map((i) => [i.performance_review_item_id, rowOf(i)])));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const saveDraft = useMutation("PUT /api/v1/ess/performance/check-in");
  const submitCheckIn = useMutation("POST /api/v1/ess/performance/check-in/submit");
  const tidy = useMutation("POST /api/v1/performance/tidy");
  const set = (id: string, patch: Partial<Row>) => setRows((x) => ({ ...x, [id]: { ...x[id], ...patch } }));
  const after = () => {
    reload();
    invalidate("/api/v1/ess/performance");
  };

  const save = async () => {
    const body = { items: own.map((i) => saveOf(i, rows[i.performance_review_item_id])) };
    try {
      const next = await saveDraft.run({ body });
      setErrors({});
      // The proposed scores are the server's: take them back without losing what is being typed.
      setRows((x) => Object.fromEntries(next.items.map((i) => [i.performance_review_item_id, { ...rowOf(i), tidied: x[i.performance_review_item_id]?.tidied ?? null, action_ai_run_id: x[i.performance_review_item_id]?.action_ai_run_id ?? "" }])));
      after();
      toast("Draft saved");
      return true;
    } catch (e) {
      if (!(e instanceof ApiError) || !Object.keys(e.fields).length) {
        say(e);
        return false;
      }
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(e.fields)) {
        const m = /^items\.(\d+)\.(\w+)$/.exec(k);
        if (m) out[`${own[Number(m[1])]?.performance_review_item_id}.${m[2]}`] = v;
      }
      setErrors(out);
      toast(e.message);
      return false;
    }
  };
  const submit = async () => {
    if (!(await save())) return;
    try {
      await submitCheckIn.run({ body: {} });
      after();
      close();
      toast("Check-in submitted");
    } catch (e) {
      say(e);
    }
  };
  const dictate = (id: string) => async (audio: Blob) => {
    const file = new File([audio], "dictation.webm", { type: audio.type || "audio/webm" });
    const d = (await upload({ endpoint: "/api/v1/ess/performance/check-in/dictation", file, fields: { purpose: "voice_note", performance_review_item_id: id, field: "action_text" } })) as unknown as Dictation;
    set(id, { action_transcript: d.transcript, action_document_id: d.document_id, tidied: null });
    return d.transcript;
  };
  const tidyText = async (id: string) => {
    const text = rows[id].action_text.trim();
    if (!text) return;
    try {
      const t = await tidy.run({ body: { kind: "check_in", performance_review_item_id: id, text } });
      if (!t.available || !t.tidied) return toast("Tidy is off");
      set(id, { tidied: t.tidied, action_ai_run_id: t.ai_run_id ?? "" });
    } catch (e) {
      say(e);
    }
  };
  const mark = (id: string, key: string, short: string) => {
    const message = fieldMessage(errors[`${id}.${key}`]?.[0], short);
    return message ? { state: "bad" as const, message } : {};
  };
  const taskOptions: Array<[string, string]> = c.tasks.map((t) => [t.task_id, `${t.number} · ${t.title}`]);

  return (
    <>
      <KeyValue
        items={[
          ["Month", c.round_name],
          ["Reviewer", c.reviewer.display_name],
          ["Due", c.due_on ? formatDate(c.due_on) : null],
          ["Stage", <StatusPill key="s" s={reviewStatus(c.status)} />],
        ]}
      />
      {c.returned_reason && <Banner className="mt-3" tone="err">{c.returned_reason}</Banner>}
      {!open && c.check_in_submitted_at && <Banner className="mt-3" tone="ok">{`Sent ${formatDate(c.check_in_submitted_at.slice(0, 10))}.`}</Banner>}
      {own.map((i) => {
        const id = i.performance_review_item_id;
        const r = rows[id];
        const measure = i.line?.measure;
        return (
          <Card key={id} className="mt-3">
            <CardHeader title={title(i)} />
            <KeyValue
              items={[
                ["Section", i.line ? SECTION_NAMES[i.line.section] : "Probation"],
                ["Target", i.line ? targetOf(i.line) : null],
                ["Proposed", score(i.proposed_score)],
              ]}
            />
            {i.line && measure === "milestone" && (
              <Field label="Delivered On" optional {...mark(id, "achieved_on", "Pick a date")}>
                <DateField value={r.achieved_on} onChange={(v) => set(id, { achieved_on: v })} />
              </Field>
            )}
            {i.line && measure === "binary" && (
              <Field label="Met" optional {...mark(id, "actual_value", "Pick one")}>
                <SelectField options={[["", "Not Yet"], ["1", "Yes"], ["0", "No"]]} value={r.actual} onChange={(v) => set(id, { actual: v })} disabled={!open} />
              </Field>
            )}
            {i.line && (measure === "numeric" || measure === "standard") && (
              <Field label="Actual" optional {...mark(id, "actual_value", "Enter a number")}>
                <NumberField decimal value={r.actual} onChange={(v) => set(id, { actual: v })} disabled={!open} />
              </Field>
            )}
            {i.line && (
              <Field label="Evidence" help="Link a task or record, attach a file, or name the source." optional>
                <SelectField options={EVIDENCE} value={r.evidence_kind} onChange={(v) => set(id, { evidence_kind: v })} disabled={!open} />
              </Field>
            )}
            {r.evidence_kind === "note" && (
              <Field label="Source" {...mark(id, "evidence_note", "Name the source")}>
                <TextField value={r.evidence_note} onChange={(v) => set(id, { evidence_note: v })} placeholder="October sales report" disabled={!open} />
              </Field>
            )}
            {r.evidence_kind === "link" && (
              <Field label="Link" {...mark(id, "evidence_url", "Add the link")}>
                <TextField type="url" value={r.evidence_url} onChange={(v) => set(id, { evidence_url: v })} placeholder="https://" disabled={!open} />
              </Field>
            )}
            {r.evidence_kind === "record" && (
              <Field label="Task" {...mark(id, "evidence_entity_id", "Pick a task")}>
                <SelectField options={taskOptions} value={r.evidence_entity_id} onChange={(v) => set(id, { evidence_entity_id: v })} disabled={!open} />
              </Field>
            )}
            {r.evidence_kind === "document" && open && (
              <Field label="File" {...mark(id, "evidence_document_id", "Add the file")}>
                <UploadField
                  endpoint="/api/v1/ess/performance/check-in/evidence"
                  purpose="performance_evidence"
                  fields={{ performance_review_item_id: id }}
                  upload={upload}
                  multiple={false}
                  compact
                  label="Add Evidence"
                  onUploaded={(docs) => set(id, { evidence_document_id: docs[0]?.document_id ?? "" })}
                />
              </Field>
            )}
            <Field label="Action" optional {...mark(id, "action_text", "Shorten the action")}>
              <TextAreaField value={r.action_text} onChange={(v) => set(id, { action_text: v, tidied: null })} rows={3} disabled={!open} />
            </Field>
            {open && (
              <div className="flex flex-wrap items-center gap-2">
                <VoiceField label="Dictate" transcribe={dictate(id)} onTranscript={(text) => set(id, { action_text: text })} />
                {r.action_text.trim() && !r.tidied && <Button size="sm" icon="spark" onClick={() => tidyText(id)}>Tidy With AI</Button>}
              </div>
            )}
            {r.tidied && (
              <Card className="mt-2">
                <KeyValue layout="stacked" items={[["As Spoken", r.action_text], ["Tidied", r.tidied]]} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => set(id, { action_text: r.tidied ?? r.action_text, tidied: null })}>Use Tidied</Button>
                  <Button size="sm" onClick={() => set(id, { tidied: null, action_ai_run_id: "" })}>Keep Original</Button>
                </div>
              </Card>
            )}
            {open && !r.changing && <Button size="sm" className="mt-2" onClick={() => set(id, { changing: true })}>Change Score</Button>}
            {r.changing && (
              <>
                <Field label="Your Score" help="Give a reason. Your reviewer sees both scores." {...mark(id, "self_score", "Give a score")}>
                  <NumberField decimal value={r.self_score} onChange={(v) => set(id, { self_score: v })} disabled={!open} />
                </Field>
                <Field label="Reason" {...mark(id, "self_reason", "Give a reason")}>
                  <TextField value={r.self_reason} onChange={(v) => set(id, { self_reason: v })} disabled={!open} />
                </Field>
              </>
            )}
          </Card>
        );
      })}
      {auto.length > 0 && (
        <DataView
          className="mt-3"
          title="Automatic Lines"
          rows={auto}
          rowKey={(i) => i.performance_review_item_id}
          columns={[
            { key: "line", label: "Line", render: (i) => <HelpTerm help="Worked out by the system. Your reviewer can change it with a reason.">{title(i)}</HelpTerm> },
            { key: "figure", label: "Figure", render: (i) => i.actual_text ?? i.actual_value ?? "No Cases" },
            { key: "proposed", label: "Proposed", align: "n", render: (i) => score(i.proposed_score) },
          ]}
        />
      )}
      <KeyValue
        className="mt-3"
        items={[
          ["Done This Month", String(c.task_counts.done)],
          ["Ongoing", String(c.task_counts.ongoing)],
          ["Next Month", String(c.task_counts.next_month)],
        ]}
      />
      {c.tasks.length > 0 && (
        <DataView
          className="mt-3"
          title="Tasks"
          rows={c.tasks}
          rowKey={(t) => t.task_id}
          columns={[
            { key: "task", label: "Task", render: (t) => `${t.number} · ${t.title}` },
            { key: "when", label: "When", render: (t) => BUCKET[t.bucket] },
          ]}
        />
      )}
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {open && <Button onClick={save}>Save Draft</Button>}
        {open && <Button variant="primary" onClick={submit}>Submit Check-In</Button>}
      </FormFooter>
    </>
  );
}
