/**
 * Commitments on My Workspace · Tasks (docs/guides/performance.md §6.11, §6.18, §10;
 * docs/guides/workspace.md §10): a commitment's state, original date and recovery on the task
 * panel, with Rescope Commitment, a rescope's decision and Set Recovery; Send Commitments for a
 * month; and Counts Towards on the task form. The rules live in the API; these only ask it.
 */
import { useState, type ReactNode } from "react";
import targets from "@mycity/contract/schemas/targets.js";
import workflow from "@mycity/contract/schemas/workflow.js";
import type { Commitment, CountsTowardsOption, TaskDetail } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import type { PersonRef } from "@/api/types/common";
import { useMe } from "@/auth/AuthProvider";
import { TaskPeoplePicker } from "@/features/shared/pickers";
import {
  ActionGroup,
  Button,
  ChoiceField,
  DataView,
  DateField,
  Field,
  formatDate,
  formatMonth,
  FormFooter,
  HelpTerm,
  RecordPicker,
  StatusPill,
  TextAreaField,
  toast,
  todayIso,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { say, useSetsForOthers } from "./shared";

type Tone = "ok" | "warn" | "err" | "info" | "neutral";

export const COMMITMENT_HELP = "A priority for the month. Its date is fixed once approved.";
export const ORIGINAL_HELP = "The date agreed when the month was approved. It never moves.";
export const COUNTS_HELP = "The scorecard line or key result this work is for. Done tasks show as evidence.";

/** Reload everything a commitment shows on. */
export const refreshCommitments = () => {
  invalidate("/api/v1/tasks");
  invalidate("/api/v1/workspace");
  invalidate("/api/v1/performance/commitments");
};

/** A commitment's state as a pill: an unapproved one says whether its month was sent or came back. */
export function commitmentPill(state: string | null | undefined, setStatus: string | null | undefined): { tone: Tone; text: string } {
  if (state === "awaiting_approval") {
    if (setStatus === "submitted") return { tone: "warn", text: "Awaiting Approval" };
    if (setStatus === "returned") return { tone: "err", text: "Returned" };
    return { tone: "neutral", text: "Not Sent" };
  }
  const words: Record<string, [string, Tone]> = {
    due: ["Due", "info"],
    on_time: ["On Time", "ok"],
    late: ["Late", "warn"],
    missed: ["Missed", "err"],
    rescoped: ["Rescoped", "neutral"],
  };
  const [text, tone] = words[state ?? ""] ?? ["Commitment", "neutral"];
  return { tone, text };
}

/** This month and next, as a commitment's Month offers them. */
export function commitmentMonths(today = todayIso()): Array<[string, string]> {
  const first = `${today.slice(0, 7)}-01`;
  const [y, m] = first.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [first, next].map((v) => [v, formatMonth(v)] as [string, string]);
}

/** The panel's lines for a commitment: its criteria, state, original date and recovery. */
export function commitmentItems(t: TaskDetail): Array<[ReactNode, ReactNode]> {
  if (!t.is_commitment) return [];
  const items: Array<[ReactNode, ReactNode]> = [
    ["Acceptance Criteria", <span key="c" data-copy="content">{t.acceptance_criteria ?? ""}</span>],
    ["Month", t.commitment_month ? formatMonth(t.commitment_month) : ""],
    ["State", <StatusPill key="s" s={commitmentPill(t.commitment_state, t.set_status)} />],
  ];
  if (t.original_due_at) items.push([<HelpTerm key="o" help={ORIGINAL_HELP}>Original Date</HelpTerm>, formatDate(t.original_due_at)]);
  if (t.rescope_reason) items.push(["Rescope Reason", <span key="r" data-copy="content">{t.rescope_reason}</span>]);
  if (t.recovery) items.push(["Recovery", `${t.recovery.assignee?.display_name ?? ""}, ${t.recovery.due_at ? formatDate(t.recovery.due_at) : ""}`]);
  return items;
}

/** The panel's commitment actions: Rescope Commitment, a rescope's decision, Set Recovery. */
export function CommitmentActions({ t, onChanged }: { t: TaskDetail; onChanged: () => void }) {
  const modal = useModal();
  const approve = useMutation("POST /api/v1/workflow/instances/:id/approve");
  const done = () => {
    onChanged();
    refreshCommitments();
  };
  const decide = async () => {
    if (!t.rescope) return;
    try {
      await approve.run({ params: { id: t.rescope.workflow_instance_id }, body: {} });
      done();
      toast("Rescope approved");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      {t.can_rescope && (
        <Button onClick={() => modal.open({ title: "Rescope Commitment", body: (close) => <RescopeForm id={t.task_id} close={() => (close(), done())} /> })}>
          Rescope Commitment
        </Button>
      )}
      {t.rescope?.can_decide && (
        <ActionGroup>
          <Button onClick={() => modal.open({ title: "Request Changes", body: (close) => <ReasonForm instanceId={t.rescope!.workflow_instance_id} close={() => (close(), done())} /> })}>
            Request Changes
          </Button>
          <Button variant="primary" onClick={decide}>Approve Rescope</Button>
        </ActionGroup>
      )}
      {t.can_set_recovery && (
        <Button variant="primary" onClick={() => modal.open({ title: "Set Recovery", body: (close) => <RecoveryForm t={t} close={() => (close(), done())} /> })}>
          Set Recovery
        </Button>
      )}
    </>
  );
}

function RescopeForm({ id, close }: { id: string; close: () => void }) {
  const f = useContractForm({ reason: "" }, targets.CommitmentRescope);
  const save = useMutation("POST /api/v1/performance/commitments/:id/rescope");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: f.values });
      close();
      toast("Rescope sent for approval");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.field("reason")}><TextAreaField {...f.field("reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Rescope</Button>
      </FormFooter>
    </>
  );
}

/**
 * Request Changes on a waiting approval: a refusal with its reason (performance.md §6.11). `action`
 * names the button where the refusal reads otherwise (Refuse Change on a target change, §6.7).
 */
export function ReasonForm({ instanceId, close, done = "Sent back", action = "Request Changes" }: { instanceId: string; close: () => void; done?: string; action?: string }) {
  const f = useContractForm({ reason: "" }, workflow.ReasonBody);
  const reject = useMutation("POST /api/v1/workflow/instances/:id/reject");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await reject.run({ params: { id: instanceId }, body: f.values });
      close();
      toast(done);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.field("reason")}><TextAreaField {...f.field("reason")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{action}</Button>
      </FormFooter>
    </>
  );
}

function RecoveryForm({ t, close }: { t: TaskDetail; close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>(t.assignee ? [t.assignee] : []);
  const f = useContractForm({ primary_assignee_id: t.assignee?.employee_id ?? "", due_on: "" }, targets.CommitmentRecovery);
  const save = useMutation("POST /api/v1/performance/commitments/:id/recovery");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id: t.task_id }, body: f.values });
      close();
      toast("Recovery set");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      {/* The people the reader may set work for, as a task's Assign To: no People grant needed. */}
      <Field label="Owner" {...f.status("primary_assignee_id")}>
        <TaskPeoplePicker
          value={who}
          onChange={(v) => {
            setWho(v);
            f.field("primary_assignee_id").onChange(v[0]?.employee_id ?? "");
          }}
        />
      </Field>
      <Field label="Due" {...f.field("due_on")}><DateField {...f.field("due_on")} min={todayIso()} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Set Recovery</Button>
      </FormFooter>
    </>
  );
}

/**
 * Send Commitments: a person's month (the reader's own, or someone they may set work for),
 * listing its commitments not yet approved, as the server finds them, a page of 25 at a time.
 */
export function SendCommitmentsForm({ close }: { close: () => void }) {
  const me = useMe();
  const others = useSetsForOthers();
  const months = commitmentMonths();
  const [who, setWho] = useState<PersonRef[]>([]);
  const [month, setMonth] = useState(months[0][0]);
  const employeeId = who[0]?.employee_id ?? me.employee_id ?? "";
  const list = usePaged("GET /api/v1/performance/commitments", {
    filters: { month: month.slice(0, 7), employee_id: employeeId, state: "awaiting_approval" },
    sort: "due_at",
    enabled: Boolean(employeeId),
  });
  const send = useMutation("POST /api/v1/performance/commitments/sets/:employee_id/:month/submit");
  const submit = async () => {
    try {
      const set = await send.run({ params: { employee_id: employeeId, month: month.slice(0, 7) }, body: {} });
      refreshCommitments();
      close();
      toast(set.status === "approved" ? "Commitments approved" : "Commitments sent for approval");
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      {others && (
        <Field label="Person" optional>
          <TaskPeoplePicker value={who} onChange={setWho} />
        </Field>
      )}
      <Field label="Month">
        <ChoiceField value={month} onChange={setMonth} options={months} />
      </Field>
      <DataView<Commitment>
        bare
        caption="Commitments to Send"
        list={list}
        rowKey={(c) => c.task_id}
        noun="commitment"
        empty={{ title: "Nothing to Send" }}
        columns={[
          { key: "t", label: "Commitment", render: (c) => <span data-copy="content">{c.title}</span> },
          { key: "d", label: "Due", render: (c) => (c.due_at ? formatDate(c.due_at) : "") },
          { key: "s", label: "State", render: (c) => <StatusPill s={commitmentPill(c.state, c.set_status)} /> },
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {(list.page?.total ?? 0) > 0 && <Button variant="primary" onClick={submit}>Send Commitments</Button>}
      </FormFooter>
    </>
  );
}

/** A Counts Towards choice as the picker holds it. */
export type CountsChoice = Pick<CountsTowardsOption, "kind" | "employee_target_id" | "okr_key_result_id" | "title" | "sub">;

/**
 * Counts Towards on the task form: the assignee's own scorecard lines and key results for the
 * month, from the server, 25 at a time.
 */
export function CountsTowardsField({
  assigneeId,
  month,
  value,
  onChange,
}: {
  assigneeId: string | null;
  month: string;
  value: CountsChoice[];
  onChange: (v: CountsChoice[]) => void;
}) {
  const list = usePaged("GET /api/v1/tasks/counts-towards", { filters: { ...(assigneeId ? { assignee_id: assigneeId } : {}), month } });
  // Nothing of theirs to count towards (§11): said once, in place of an empty picker.
  if (list.page?.total === 0 && !list.q && !value.length) return <p className="text-2xs text-subtle-foreground">No lines or key results</p>;
  return (
    <RecordPicker
      list={list}
      value={value as CountsTowardsOption[]}
      onChange={(v) => onChange(v.slice(-1))}
      id={(o) => o.employee_target_id ?? o.okr_key_result_id ?? o.title}
      title={(o) => o.title}
      sub={(o) => o.sub ?? (o.kind === "line" ? "Scorecard Line" : "Key Result")}
    />
  );
}
