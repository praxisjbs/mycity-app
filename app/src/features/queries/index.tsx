import queries from "@mycity/contract/schemas/queries.js";
import query_rules from "@mycity/contract/schemas/query_rules.js";
import sanctions from "@mycity/contract/schemas/sanctions.js";
import templates from "@mycity/contract/schemas/templates.js";
import type { ConsequenceStep, LetterTemplate, LetterTemplateDetail, PersonRef, Query, QueryDetail, QueryRule, QueryRuleFiring, QueryRuleSource, Sanction } from "@mycity/contract/contract.gen.ts";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import type { PersonRef as PickedPerson } from "@/api/types/common";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { Letter, LetterFile, PolicyCited } from "@/features/shared/Letter";
import { withSignature } from "@/features/shared/signature";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { EmployeePicker, PolicyPicker, type PolicyChoice } from "@/features/shared/pickers";
import { BarsCard, PagedTable } from "@/features/shared/sections";
import { useRouter } from "@/lib/router";
import { hasCapability } from "@/shell/access";
import { useScreenAction } from "@/shell/screen-action";
import type { ModuleScreenProps } from "@/shell/screens";
import { offToast, WriteWithAiButton, WriteWithAiStep } from "./WriteWithAi";
import {
  ActionGroup, Button, Card, CardHeader, ChoiceField, Chips, DateField, DetailPane, EmptyState, ErrorState, Field, formatDate, formatDateTime, formatWhen, FormFooter, Grid, HelpTerm,
  KeyValue, ListDetail, LoadingRows, Pager, RichText, RichTextField, Money, MoneyField, NumberField, PageHeader, SelectField, SignatureField, StatStrip, StatusPill, TextAreaField, TextField, toast, useContractForm, useIsPhone, useModal, useSideBySide, Who, type SignatureFieldHandle,
} from "@mycity/ui";

/**
 * Queries & Sanctions (docs/guides/queries.md §10): Queries, Rules, Sanctions and Letter
 * Templates, on the generated contract. Who sees what is the API's rule (§6.1); the
 * configure buttons follow `queries.configure`, and the API refuses what they would not.
 */
export default function Queries({ tab, id }: ModuleScreenProps) {
  if (tab === "rules") return <Rules />;
  if (tab === "sanctions") return <Sanctions />;
  if (tab === "letter-templates") return <Templates />;
  return <QueriesTab id={id} />;
}

type Tone = "ok" | "warn" | "err" | "info" | "neutral";
const pill = (tone: Tone, text: string) => ({ tone, text });
const person = (p: PersonRef) => <Who name={p.display_name} sub={p.department ?? undefined} />;
const useConfigure = () => {
  const { me } = useAuth();
  return !!me && hasCapability(me, "queries.configure");
};
/**
 * A save that failed: on its fields when the API named fields this form has, otherwise in a toast,
 * so a refusal about something the form does not show is never silent.
 */
const failed = (f: { values: object; setServerErrors: (x: Record<string, string[]>) => void }) => (e: unknown) => {
  const fields = e instanceof ApiError ? (e.fields ?? {}) : {};
  const known = Object.keys(fields).filter((k) => k in f.values);
  if (known.length) f.setServerErrors(fields);
  if (known.length < Object.keys(fields).length || !known.length) toast(e instanceof ApiError ? e.message : "Not saved");
};
/** May this reader raise a query: `queries` create, which the API asks for (guide §8). */
const useMayRaise = () => {
  const { me } = useAuth();
  return !!me?.grants.queries?.includes("create");
};

/* ───────────── Queries ───────────── */

const ESCALATED_HELP = "A sanction is waiting for approval.";

function queryStatus(q: Pick<Query, "status" | "outcome" | "escalated">) {
  if (q.status === "resolved") return q.outcome === "sanctioned" ? pill("neutral", "Sanctioned") : pill("ok", "Closed, No Action");
  if (q.escalated) return pill("err", "Escalated");
  return q.status === "under_review" ? pill("info", "Under Review") : pill("warn", "Awaiting Response");
}

function QueriesTab({ id }: { id: string | null }) {
  const modal = useModal();
  const phone = useIsPhone();
  const mayRaise = useMayRaise();
  const raise = () => modal.open({ title: "Raise a Query", body: (close) => <RaiseQuery close={close} /> });
  useScreenAction(mayRaise ? { label: "Raise a Query", onSelect: raise } : null);
  const [raised, setRaised] = useState<"all" | "mine">("all");
  const s = useApi("GET /api/v1/queries/summary");
  const list = usePaged("GET /api/v1/queries", { filters: raised === "mine" ? { raised: "mine" } : {}, sort: "-created_at" });
  // A query the address names opens at once; on desktop the newest shows unasked, on a phone nothing does (F31).
  const [sel, setSel] = useState<string | null>(id);
  useEffect(() => setSel(id), [id]);
  const focus = sel ?? (phone ? null : (list.rows[0]?.employee_query_id ?? null));
  const top = Math.max(1, ...(s.data?.by_reason ?? []).map((r) => r.count));
  return (
    <>
      <PageHeader
        title="Queries"
        sub="Every query and its outcome"
        actions={mayRaise ? <Button variant="primary" icon="plus" onClick={raise}>Raise a Query</Button> : undefined}
      />
      {s.data && (
        // A phone shows the two that ask for action (guide §10.2).
        <KpiTiles
          mobileCols={2}
          items={[
            { label: "Open", value: String(s.data.open), tone: s.data.open ? "warn" : "ok" },
            { label: "Awaiting Response", value: String(s.data.awaiting_response) },
            ...(phone
              ? []
              : [
                  { label: "Closed This Month", value: String(s.data.closed_this_month), tone: "ok" as const },
                  { label: "Escalated", value: String(s.data.escalated), tone: s.data.escalated ? ("err" as const) : undefined, help: ESCALATED_HELP },
                ]),
          ]}
        />
      )}
      <Chips value={raised} onChange={setRaised} options={[["all", "All Queries"], ["mine", "Raised by Me"]]} label="Raised By" />
      <PagedTable<Query>
        title={raised === "mine" ? "Queries I Raised" : "All Queries"}
        list={list}
        search="Search name, number or subject"
        rowKey={(q) => q.employee_query_id}
        noun="query"
        nounPlural="queries"
        onRowClick={(q) => setSel(q.employee_query_id)}
        wide
        empty={{ title: "No Queries", text: "Queries you raise appear here." }}
        columns={[
          { key: "e", label: "Employee", render: (q) => person(q.employee) },
          { key: "n", label: "Number", render: (q) => q.number, desktop: true },
          { key: "s", label: "Subject", render: (q) => q.subject },
          { key: "b", label: "Raised By", render: (q) => q.raised_by_name ?? q.rule_name ?? "Rule", desktop: true },
          { key: "d", label: "Raised", render: (q) => formatDate(q.created_at) },
          { key: "r", label: "Response", render: (q) => (q.responded_at ? formatDate(q.responded_at) : "Not yet"), desktop: true },
          { key: "st", label: "Status", render: (q) => <StatusPill s={queryStatus(q)} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <DetailPane open={sel !== null} onClose={() => setSel(null)} title="Query">
          {focus ? <QueryCard id={focus} /> : <Card><EmptyState bare icon="doc" title="No Query Open" text="Pick a query to see it here." /></Card>}
        </DetailPane>
        {phone ? null : s.data ? <BarsCard title="Queries by Reason" rows={s.data.by_reason.map((r) => ({ label: r.label, pct: Math.round((r.count / top) * 100), value: String(r.count) }))} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

/** The query's sanction as its card names it: a refused or withdrawn proposal says so. */
function sanctionLine(s: NonNullable<QueryDetail["sanction"]>) {
  if (s.status === "rejected") return `${s.step_name}, Not Approved`;
  if (s.status === "withdrawn") return `${s.step_name}, Withdrawn`;
  return `${s.step_name}${s.number ? `, ${s.number}` : ""}`;
}

function QueryCard({ id }: { id: string }) {
  const modal = useModal();
  const q = useApi("GET /api/v1/queries/:id", { params: { id } });
  const remind = useMutation("POST /api/v1/queries/:id/remind");
  if (q.error) return <Card><ErrorState error={q.error} onRetry={q.reload} /></Card>;
  if (!q.data) return <Card><LoadingRows /></Card>;
  const d = q.data;
  // A sanction settles after the approval commits (the worker issues it): read the card again then.
  const settled = () => {
    q.reload();
    for (const ms of [1500, 4000]) window.setTimeout(() => (invalidate("/api/v1/queries"), invalidate("/api/v1/sanctions"), q.reload()), ms);
  };
  const sendReminder = async () => {
    await remind.run({ params: { id: d.employee_query_id }, body: {} });
    q.reload();
    toast(`Reminder sent to ${d.employee.display_name}`);
  };
  return (
    <Card>
      <CardHeader record title={`${d.number} · ${d.employee.display_name}`} right={<StatusPill s={queryStatus(d)} />} />
      <KeyValue
        items={[
          ["Subject", d.subject],
          ["Raised By", d.raised_by_name ?? d.rule_name ?? "Rule"],
          ["Raised", formatDateTime(d.created_at)],
          ...(d.status === "awaiting_response" && d.response_due_at ? ([[<HelpTerm key="due" help="The employee has 24 hours to respond in writing.">Response Due</HelpTerm>, formatDateTime(d.response_due_at)]] as Array<[React.ReactNode, string]>) : []),
          ...(d.evidence.length ? ([["Counted", d.evidence.map((e) => (e.date ? `${formatDate(e.date)}, ${e.label}` : e.label)).join("; ")]] as Array<[string, string]>) : []),
          ...(d.policy ? ([["Policy", <PolicyCited key="p" policy={d.policy} clause={d.policy_clause} />]] as Array<[string, React.ReactNode]>) : []),
          ...(d.response ? ([["Response", <RichText key="r" blocks={d.response.blocks} top={4} />]] as Array<[string, React.ReactNode]>) : []),
          ...(d.sanction ? ([["Sanction", sanctionLine(d.sanction)]] as Array<[string, string]>) : []),
          ...(d.approval ? ([[<HelpTerm key="w" help={ESCALATED_HELP}>Waiting On</HelpTerm>, d.approval.stage_name]] as Array<[React.ReactNode, string]>) : []),
        ]}
      />
      <ActionGroup>
        <div className="mt-3.5 flex flex-wrap gap-2">
        <Button icon="doc" onClick={() => modal.open({ title: `${d.number} · Query Letter`, wide: true, body: <LetterFile documentId={d.letter_document_id} name={d.number} /> })}>View Letter</Button>
        {d.can_remind && <Button onClick={sendReminder}>Send Reminder</Button>}
        {d.can_decide && <Button variant="primary" onClick={() => modal.open({ title: `Decision on ${d.number}`, body: (close) => <Decide q={d} close={close} onDone={q.reload} /> })}>Record Decision</Button>}
        {d.approval?.can_decide && d.sanction && (
          <>
            <Button onClick={() => modal.open({ title: `Reject ${d.sanction!.step_name}`, body: (close) => <RejectSanction id={d.sanction!.sanction_id} close={close} onDone={settled} /> })}>Reject</Button>
            <Button variant="primary" onClick={() => modal.open({ title: `Approve ${d.sanction!.step_name}`, body: (close) => <ApproveSanction id={d.sanction!.sanction_id} signs={d.approval!.signs} close={close} onDone={settled} /> })}>Approve Sanction</Button>
          </>
        )}
        </div>
      </ActionGroup>
    </Card>
  );
}

type RaiseValues = { subject: string; details: string; policy_id: string; policy_clause: string; signature: string };

function RaiseQuery({ close }: { close: () => void }) {
  const [who, setWho] = useState<PickedPerson[]>([]);
  const [policy, setPolicy] = useState<PolicyChoice[]>([]);
  const [tried, setTried] = useState(false);
  // The policy cited and the clause quoted, only once a policy is picked (guide §6.2).
  const cited = (v: RaiseValues) => {
    const { policy_id: policyId, policy_clause: clause, ...rest } = v;
    return policyId ? { ...rest, policy_id: policyId, ...(clause.trim() && { policy_clause: clause.trim() }) } : rest;
  };
  const employee = who[0]?.employee_id ?? "";
  const pad = useRef<SignatureFieldHandle>(null);
  const f = useContractForm<RaiseValues>(
    { subject: "", details: "", policy_id: "", policy_clause: "", signature: "" },
    withSignature({ safeParse: (v: unknown) => queries.QueryCreate.safeParse({ employee_id: employee || undefined, ...cited(v as RaiseValues) }) }, pad),
  );
  const save = useMutation("POST /api/v1/queries");
  const ai = useApi("GET /api/v1/queries/assist");
  // Write With AI: mounted from its first opening, so Back keeps what was typed in it (mailbox §10).
  const [step, setStep] = useState<{ mounted: boolean; open: boolean }>({ mounted: false, open: false });
  const draft = async (instruction: string) => {
    if (!employee) {
      setTried(true);
      toast("Pick the employee first");
      return null;
    }
    const { policy_id: policyId, policy_clause: clause } = cited(f.values) as { policy_id?: string; policy_clause?: string };
    const r = await api.call("POST /api/v1/queries/assist", {
      body: { employee_id: employee, instruction, subject: f.values.subject.trim(), details: f.values.details.trim(), ...(policyId && { policy_id: policyId }), ...(clause && { policy_clause: clause }) },
    });
    if (!r.available) {
      offToast(r.reason);
      return null;
    }
    return { subject: r.subject ?? "", details: r.details ?? "" };
  };
  const submit = async () => {
    setTried(true);
    if (!f.check() || !employee) return;
    try {
      const q = await save.run({
        body: { employee_id: employee, ...cited(f.values), subject: f.values.subject.trim(), details: f.values.details.trim(), signature: pad.current?.toPng() ?? "" },
      });
      invalidate("/api/v1/queries");
      close();
      toast(`${q.number} raised, letter sent`);
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      {step.mounted && (
        <div className={step.open ? undefined : "hidden"}>
          <WriteWithAiStep
            ask={draft}
            show={(d) => (
              <>
                <p className="mb-1 text-xs font-semibold" data-copy="content">{d.subject}</p>
                <p className="text-sm" data-copy="content">{d.details}</p>
              </>
            )}
            use={(d) => (f.set("subject", d.subject), f.set("details", d.details), setStep({ mounted: true, open: false }))}
            back={() => setStep({ mounted: true, open: false })}
          />
        </div>
      )}
      <div className={step.open ? "hidden" : undefined}>
      <WriteWithAiButton status={ai.data} open={() => setStep({ mounted: true, open: true })} />
      <Field label="Employee" state={tried && !employee ? "bad" : undefined} message={tried && !employee ? "Pick the employee" : undefined}><EmployeePicker value={who} onChange={setWho} /></Field>
      <Field label="Subject" {...f.status("subject")}><TextField {...f.field("subject")} placeholder="Late weekly report" /></Field>
      <Field label="What Happened" {...f.status("details")}><TextAreaField {...f.field("details")} placeholder="Report due 14/10, sent 16/10" /></Field>
      <Field label="Policy" optional {...f.status("policy_id")}>
        <PolicyPicker value={policy} onChange={(p) => (setPolicy(p), f.set("policy_id", p[0]?.policy_id ?? ""))} />
      </Field>
      {policy.length > 0 && <Field label={<HelpTerm help="The line of the policy the letter quotes.">Clause</HelpTerm>} optional {...f.status("policy_clause")}><TextField {...f.field("policy_clause")} /></Field>}
      <Field label="Your Signature" {...f.status("signature")}>
        <SignatureField ref={pad} label="Your Signature" onChange={(ink) => f.set("signature", ink ? "drawn" : "")} />
      </Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" busy={save.pending} onClick={submit}>Raise Query</Button>
      </FormFooter>
      </div>
    </>
  );
}

type DecideValues = { outcome: string; consequence_step_id: string; reason: string; fine_amount: string; effective_on: string; ends_on: string; evidence: string };
/** The evidence typed, one item a line (a rung may require it, guide §6.4). */
const evidenceOf = (v: DecideValues) =>
  v.evidence
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label) => ({ label: label.slice(0, 200) }));
const decisionOf = (v: DecideValues) => ({
  outcome: v.outcome as "no_action" | "sanction",
  reason: v.reason,
  ...(v.outcome === "sanction" && {
    consequence_step_id: v.consequence_step_id || undefined,
    fine_amount: v.fine_amount.replace(/,/g, ""),
    effective_on: v.effective_on,
    ends_on: v.ends_on,
    ...(evidenceOf(v).length && { evidence: evidenceOf(v) }),
  }),
});
const money = (s: string) => (s && !s.includes(".") ? `${s}.00` : s && /\.\d$/.test(s) ? `${s}0` : s);

function Decide({ q, close, onDone }: { q: QueryDetail; close: () => void; onDone: () => void }) {
  const chain = useApi("GET /api/v1/sanctions/chain", { query: { active: "true" } });
  // Nobody signs a proposal: Operations & People sign when they approve it (guide §6.4).
  const f = useContractForm<DecideValues>(
    { outcome: "no_action", consequence_step_id: q.next_step?.consequence_step_id ?? "", reason: "", fine_amount: "", effective_on: "", ends_on: "", evidence: "" },
    {
      safeParse: (value: unknown) => {
        const v = value as DecideValues;
        return queries.QueryDecision.safeParse({ ...decisionOf(v), ...(v.outcome === "sanction" && { fine_amount: money(v.fine_amount.replace(/,/g, "")) }) });
      },
    },
  );
  const save = useMutation("POST /api/v1/queries/:id/decision");
  const steps = (chain.data?.data ?? []).filter((s) => s.letter_ready);
  const chosen = steps.find((s) => s.consequence_step_id === f.values.consequence_step_id);
  const needsEvidence = f.values.outcome === "sanction" && !!chosen?.evidence_required;
  const submit = async () => {
    if (!f.check()) return;
    if (needsEvidence && !evidenceOf(f.values).length) {
      f.setServerErrors({ evidence: ["Add the evidence"] });
      return;
    }
    try {
      const body = {
        ...decisionOf(f.values),
        ...(f.values.outcome === "sanction" && { fine_amount: money(f.values.fine_amount.replace(/,/g, "")) || undefined }),
      };
      const r = await save.run({ params: { id: q.employee_query_id }, body });
      invalidate("/api/v1/queries");
      onDone();
      close();
      toast(r.escalated ? "Sanction sent for approval" : `${r.number} closed`);
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Outcome" {...f.status("outcome")}>
        <ChoiceField {...f.field("outcome")} options={[["no_action", "Close, No Action"], ["sanction", "Sanction"]]} />
      </Field>
      {f.values.outcome === "sanction" && (
        <>
          <Field label={<HelpTerm help="The step after the highest one still in force for this person.">Sanction</HelpTerm>} {...f.status("consequence_step_id")}>
            <SelectField placeholder="Pick a step" options={steps.map((s) => [s.consequence_step_id, s.consequence_step_id === q.next_step?.consequence_step_id ? `${s.name} (Next)` : s.name])} {...f.field("consequence_step_id")} />
          </Field>
          {chosen?.financial_effect === "unpaid_days" && (
            <Grid cols={2}>
              <Field label="From" optional {...f.status("effective_on")}><DateField {...f.field("effective_on")} /></Field>
              <Field label="To" optional {...f.status("ends_on")}><DateField {...f.field("ends_on")} /></Field>
            </Grid>
          )}
          {needsEvidence && (
            <Field label={<HelpTerm help="This step needs the facts it rests on. One item a line.">Evidence</HelpTerm>} {...f.status("evidence")}>
              <TextAreaField {...f.field("evidence")} rows={3} placeholder="Site log, 14/10" />
            </Field>
          )}
          <Field label={<HelpTerm help="A fine reaches payroll as a pending deduction, accepted there, never automatic.">Fine</HelpTerm>} optional {...f.status("fine_amount")}>
            <MoneyField {...f.field("fine_amount")} />
          </Field>
        </>
      )}
      <Field label="Reason" {...f.status("reason")}><TextAreaField {...f.field("reason")} placeholder="Explanation accepted" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Record Decision</Button>
      </FormFooter>
    </>
  );
}

/**
 * Approve Sanction (guide §6.4): whoever the approval waits on lets it stand. At the Operations &
 * People stage they sign it, and their signature is printed on its letters.
 */
function ApproveSanction({ id, signs, close, onDone }: { id: string; signs: boolean; close: () => void; onDone: () => void }) {
  const pad = useRef<SignatureFieldHandle>(null);
  const f = useContractForm<{ signature: string }>(
    { signature: "" },
    withSignature(sanctions.SanctionApprove, pad, () => signs),
  );
  const save = useMutation("POST /api/v1/sanctions/:id/approve");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const r = await save.run({ params: { id }, body: signs ? { signature: pad.current?.toPng() ?? "" } : {} });
      invalidate("/api/v1/queries");
      invalidate("/api/v1/sanctions");
      onDone();
      close();
      // Approving the last stage issues it a moment later; a further stage names who is next.
      toast(r.status === "issued" ? `${r.number} issued, letter sent` : r.waiting_on ? `Sent on to the ${r.waiting_on}` : "Sanction approved, letter follows");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      {signs && (
        <Field label={<HelpTerm help="Your signature is printed on this sanction's letters.">Your Signature</HelpTerm>} {...f.status("signature")}>
          <SignatureField ref={pad} label="Your Signature" onChange={(ink) => f.set("signature", ink ? "drawn" : "")} />
        </Field>
      )}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="ok" busy={save.pending} onClick={submit}>Approve Sanction</Button>
      </FormFooter>
    </>
  );
}

/** Reject a proposed sanction with a reason: the query goes back under review (guide §6.4). */
function RejectSanction({ id, close, onDone }: { id: string; close: () => void; onDone: () => void }) {
  const f = useContractForm<{ reason: string }>({ reason: "" }, sanctions.SanctionReject);
  const save = useMutation("POST /api/v1/sanctions/:id/reject");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ params: { id }, body: { reason: f.values.reason.trim() } });
      invalidate("/api/v1/queries");
      invalidate("/api/v1/sanctions");
      onDone();
      close();
      toast("Sanction rejected");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Reason" {...f.status("reason")}><TextAreaField {...f.field("reason")} placeholder="Too heavy" /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="danger" busy={save.pending} onClick={submit}>Reject</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Rules ───────────── */

const TRIGGERS: Array<[QueryRuleSource, string]> = [
  ["lateness", "Late Arrival"],
  ["absence", "Absence"],
  ["missing_clock_out", "Missing Clock-Out"],
  ["unenrolled_device", "Unregistered Device"],
  ["overdue_task", "Overdue Task"],
  ["low_performance", "Low Monthly Score"],
  ["missed_target", "Missed Target"],
];
const TRIGGER_NAME = Object.fromEntries(TRIGGERS) as Record<QueryRuleSource, string>;
/** What a new or edited rule may count: late arrivals, absences and missing clock-outs are the Attendance policy's (guide §6.3). */
const OFFERED = new Set<QueryRuleSource>(["unenrolled_device", "overdue_task", "low_performance", "missed_target"]);
const OFFERED_TRIGGERS = TRIGGERS.filter(([key]) => OFFERED.has(key));
/** What something counts today, so a rule on it can be switched on: Missed Target waits for M2's KPIs. */
const COUNTED_NOW = new Set<QueryRuleSource>(["unenrolled_device", "overdue_task", "low_performance"]);
const ruleState = (r: QueryRule) => (r.state === "active" ? pill("ok", "Active") : r.state === "paused" ? pill("neutral", "Paused") : pill("warn", "Draft"));
const threshold = (r: QueryRule) => (r.measure === "minutes" ? `${r.threshold} min in ${r.window_days} days` : `${r.threshold} in ${r.window_days} days`);

function Rules() {
  const modal = useModal();
  const phone = useIsPhone();
  const configure = useConfigure();
  const s = useApi("GET /api/v1/query-rules/summary");
  const rules = usePaged("GET /api/v1/query-rules", { sort: "name" });
  const firings = usePaged("GET /api/v1/query-rules/firings", { sort: "created_at" });
  const activate = useMutation("POST /api/v1/query-rules/:id/activate");
  const pause = useMutation("POST /api/v1/query-rules/:id/pause");
  const flip = async (r: QueryRule) => {
    try {
      if (r.active) await pause.run({ params: { id: r.query_rule_id }, body: {} });
      else await activate.run({ params: { id: r.query_rule_id }, body: {} });
      invalidate("/api/v1/query-rules");
      toast(r.active ? `${r.name} paused` : `${r.name} is now active`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not saved");
    }
  };
  return (
    <>
      <PageHeader
        title="Rules"
        sub="Automatic queries, configured not coded"
        actions={configure && <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Rule", body: (close) => <RuleForm close={close} /> })}>New Rule</Button>}
      />
      {s.data && <KpiTiles items={[{ label: "Active Rules", value: String(s.data.active) }, { label: "Draft", value: String(s.data.draft) }, { label: "Fired This Month", value: String(s.data.fired_this_month) }, { label: "Queries Raised", value: String(s.data.queries_raised) }]} />}
      {rules.error ? <Card><ErrorState error={rules.error} onRetry={() => invalidate("/api/v1/query-rules")} /></Card> : rules.loading && !rules.rows.length ? <Card><LoadingRows /></Card> : !rules.rows.length ? (
        <Card><EmptyState bare icon="doc" title="No Rules Yet" text="A rule raises a query by itself." /></Card>
      ) : (
        <Grid cols={3}>
          {rules.rows.map((r: QueryRule) => (
            <Card key={r.query_rule_id}>
              <CardHeader record title={r.name} right={<StatusPill s={ruleState(r)} />} />
              <KeyValue items={[["Counts", TRIGGER_NAME[r.source_event]], ["Threshold", threshold(r)], ...(r.policy ? ([["Policy", r.policy.title]] as Array<[string, string]>) : [])]} />
              {configure && (
                <ActionGroup>
                  <div className="mt-2.5 flex justify-end gap-2">
                    {OFFERED.has(r.source_event) && <Button size="sm" icon="edit" onClick={() => modal.open({ title: "Edit Rule", body: (close) => <RuleForm rule={r} close={close} /> })}>Edit Rule</Button>}
                    {(r.active || COUNTED_NOW.has(r.source_event)) && <Button size="sm" onClick={() => flip(r)}>{r.active ? "Pause" : "Activate"}</Button>}
                  </div>
                </ActionGroup>
              )}
            </Card>
          ))}
        </Grid>
      )}
      {rules.rows.length > 0 && <Pager page={rules.page} onPage={rules.setPage} noun="rule" label="Rules" />}
      {/* Left off a phone (guide §10.2). */}
      {!phone && (
      <Grid cols={2} className="mt-3">
        <PagedTable<QueryRuleFiring>
          title="Recent Firings"
          list={firings}
          rowKey={(x) => x.employee_query_id}
          noun="firing"
          empty={{ title: "No Firings", text: "Nothing has reached a rule." }}
          columns={[
            { key: "r", label: "Rule", render: (x) => x.rule_name },
            { key: "f", label: "Fired", render: (x) => formatWhen(x.created_at) },
            { key: "e", label: "Employee", render: (x) => person(x.employee) },
            { key: "o", label: "Query", render: (x) => <StatusPill s={queryStatus({ status: x.status, outcome: null, escalated: false })} /> },
          ]}
        />
      </Grid>
      )}
    </>
  );
}

type RuleValues = { name: string; source_event: string; threshold: string; window_days: string; letter_template: string; policy_id: string; policy_clause: string };
const ruleOf = (v: RuleValues) => ({
  name: v.name,
  source_event: v.source_event as QueryRuleSource,
  threshold: v.threshold === "" ? undefined : Number(v.threshold),
  window_days: v.window_days === "" ? undefined : Number(v.window_days),
  ...(v.letter_template && { letter_template: v.letter_template }),
  ...(v.policy_id && { policy_id: v.policy_id }),
  ...(v.policy_id && v.policy_clause.trim() && { policy_clause: v.policy_clause.trim() }),
});
type OfferedSource = "unenrolled_device" | "overdue_task" | "low_performance" | "missed_target";

/**
 * New Rule, or Edit Rule on a rule's card (guide §6.3): saved as a draft when new; an edit applies
 * from the next event, and a rule that has fired keeps its trigger (the API refuses a change).
 */
function RuleForm({ rule, close }: { rule?: QueryRule; close: () => void }) {
  const editing = Boolean(rule);
  const f = useContractForm<RuleValues>(
    {
      name: rule?.name ?? "",
      source_event: rule?.source_event ?? "overdue_task",
      threshold: String(rule?.threshold ?? 3),
      window_days: String(rule?.window_days ?? 14),
      letter_template: rule?.letter_template ?? "",
      policy_id: rule?.policy?.policy_id ?? "",
      policy_clause: rule?.policy_clause ?? "",
    },
    { safeParse: (v: RuleValues) => (editing ? query_rules.QueryRuleUpdate : query_rules.QueryRuleCreate).safeParse(ruleOf(v)) },
  );
  const [policy, setPolicy] = useState<PolicyChoice[]>(rule?.policy ? [rule.policy] : []);
  const create = useMutation("POST /api/v1/query-rules");
  const update = useMutation("PATCH /api/v1/query-rules/:id");
  // The query letters a rule may send; none picked sends the Query Letter (guide §6.3).
  const letters = useApi("GET /api/v1/letter-templates", { query: { purpose: "query", status: "active" } });
  const submit = async () => {
    if (!f.check()) return;
    const body = ruleOf(f.values) as { name: string; source_event: OfferedSource; threshold: number; window_days: number; letter_template?: string; policy_id?: string; policy_clause?: string };
    try {
      if (rule) {
        const { source_event: sourceEvent, ...rest } = body;
        const r = await update.run({
          params: { id: rule.query_rule_id },
          body: { ...rest, ...(!rule.has_fired && { source_event: sourceEvent }), letter_template: body.letter_template ?? null, policy_id: body.policy_id ?? null, policy_clause: body.policy_clause ?? null },
        });
        invalidate("/api/v1/query-rules");
        close();
        toast(`${r.name} saved`);
        return;
      }
      const r = await create.run({ body });
      invalidate("/api/v1/query-rules");
      close();
      toast(`${r.name} saved as a draft`);
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Name" {...f.status("name")}><TextField {...f.field("name")} placeholder="Overdue Tasks" /></Field>
      {rule?.has_fired ? (
        // Its queries were counted this way: the trigger stays (guide §6.3).
        <KeyValue items={[[<HelpTerm key="t" help="Fixed once the rule has raised a query.">What Sets It Off</HelpTerm>, TRIGGER_NAME[rule.source_event]]]} />
      ) : (
        <Field label="What Sets It Off" {...f.status("source_event")}><SelectField options={OFFERED_TRIGGERS} {...f.field("source_event")} /></Field>
      )}
      <Grid cols={2}>
        <Field label="How Many Times" {...f.status("threshold")}><NumberField {...f.field("threshold")} /></Field>
        <Field label="Within, Days" {...f.status("window_days")}><NumberField {...f.field("window_days")} /></Field>
      </Grid>
      <Field label={<HelpTerm help="The letter this rule's queries send. None picked sends the Query Letter.">Letter</HelpTerm>} optional {...f.status("letter_template")}>
        <SelectField placeholder="Query Letter" options={(letters.data?.data ?? []).map((l) => [l.key, l.name])} {...f.field("letter_template")} />
      </Field>
      <Field label={<HelpTerm help="The policy this rule enforces. Its queries' letters quote it.">Policy</HelpTerm>} optional {...f.status("policy_id")}>
        <PolicyPicker value={policy} onChange={(p) => {
          setPolicy(p);
          f.set("policy_id", p[0]?.policy_id ?? "");
          if (!p.length) f.set("policy_clause", "");
        }} />
      </Field>
      {policy.length > 0 && <Field label={<HelpTerm help="The line of the policy this rule's letters quote.">Clause</HelpTerm>} optional {...f.status("policy_clause")}><TextField {...f.field("policy_clause")} /></Field>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={create.pending || update.pending} onClick={submit}>Save Rule</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Sanctions ───────────── */

const sanctionStatus = (s: Sanction) =>
  s.status === "issued" ? pill("neutral", "Issued") : s.status === "pending_approval" ? pill("warn", "Awaiting Approval") : s.status === "rejected" ? pill("err", "Not Approved") : pill("neutral", "Withdrawn");

function Sanctions() {
  const modal = useModal();
  const { navigate } = useRouter();
  const configure = useConfigure();
  const s = useApi("GET /api/v1/sanctions/summary");
  const list = usePaged("GET /api/v1/sanctions", { sort: "-created_at" });
  return (
    <>
      <PageHeader
        title="Sanctions"
        sub="The consequence chain · MyCity ladder"
        actions={
          <>
            <Button icon="cog" onClick={() => modal.open({ title: "Chain Settings", wide: true, body: <ChainSettings configure={configure} /> })}>Chain Settings</Button>
            <Button variant="primary" icon="plus" onClick={() => navigate("/queries?tab=queries")}>Issue Sanction</Button>
          </>
        }
      />
      {s.data && (
        <KpiTiles
          items={[
            { label: "Active Sanctions", value: String(s.data.active) },
            { label: "Awaiting Approval", value: String(s.data.pending_approval), tone: s.data.pending_approval ? "warn" : undefined },
            { label: "Fines, This Year", value: <Money value={s.data.fines_this_year} /> },
            { label: "Fines Recovered", value: <Money value={s.data.fines_recovered} />, tone: "ok" },
          ]}
        />
      )}
      <PagedTable<Sanction>
        title="Sanction History"
        list={list}
        search="Search people or reasons"
        rowKey={(x) => x.sanction_id}
        noun="sanction"
        wide
        empty={{ title: "No Sanctions", text: "Sanctions follow a query's decision." }}
        columns={[
          { key: "e", label: "Employee", render: (x) => person(x.employee) },
          { key: "k", label: "Sanction", render: (x) => x.step_name },
          { key: "q", label: "Query", render: (x) => x.query_number, desktop: true },
          { key: "r", label: "Reason", render: (x) => x.reason },
          { key: "b", label: "Decided By", render: (x) => x.decided_by_name ?? "", desktop: true },
          { key: "d", label: "Date", render: (x) => formatDate(x.effective_on) },
          { key: "m", label: "Fine", align: "n", render: (x) => (x.fine ? <Money value={x.fine.amount_ngn} /> : "None") },
          { key: "s", label: "Status", render: (x) => <StatusPill s={sanctionStatus(x)} /> },
        ]}
      />
    </>
  );
}

const EFFECT: Record<ConsequenceStep["financial_effect"], string> = { none: "None", unpaid_days: "Unpaid Days", ends_employment: "Ends Employment" };

function ChainSettings({ configure }: { configure: boolean }) {
  const modal = useModal();
  const chain = useApi("GET /api/v1/sanctions/chain", { query: {} });
  const move = useMutation("PATCH /api/v1/sanctions/chain/:id");
  const steps = chain.data?.data ?? [];
  const patch = async (step: ConsequenceStep, body: { position?: number; active?: boolean }) => {
    try {
      await move.run({ params: { id: step.consequence_step_id }, body });
      chain.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not saved");
    }
  };
  if (chain.error) return <ErrorState error={chain.error} onRetry={chain.reload} />;
  if (!chain.data) return <LoadingRows />;
  return (
    <>
      {!steps.length && <EmptyState bare icon="flag" title="No Steps Yet" text="Add MyCity's ladder, top to bottom." />}
      {steps.map((step) => (
        <Card key={step.consequence_step_id} className="mb-2">
          <CardHeader record title={`${step.position} · ${step.name}`} right={<StatusPill s={!step.active ? pill("neutral", "Retired") : step.letter_ready ? pill("ok", "Ready") : pill("warn", "Needs a Letter")} />} />
          <KeyValue items={[["Letter", step.letter_template ?? "None"], ["Financial Effect", EFFECT[step.financial_effect as ConsequenceStep["financial_effect"]]], [<HelpTerm key="v" help="How long this step counts for the next offence.">In Force For</HelpTerm>, step.valid_days ? `${step.valid_days} days` : "Always"]]} />
          {configure && (
            <ActionGroup>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
              {step.position > 1 && <Button size="sm" icon="up" onClick={() => patch(step, { position: step.position - 1 })}>Move Up</Button>}
              {step.position < steps.length && <Button size="sm" icon="down" onClick={() => patch(step, { position: step.position + 1 })}>Move Down</Button>}
              <Button size="sm" onClick={() => patch(step, { active: !step.active })}>{step.active ? "Retire" : "Restore"}</Button>
              </div>
            </ActionGroup>
          )}
        </Card>
      ))}
      {configure && (
        <FormFooter>
          <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Add Step", body: (close) => <StepForm count={steps.length} close={() => (close(), chain.reload())} /> })}>Add Step</Button>
        </FormFooter>
      )}
    </>
  );
}

type StepValues = { name: string; position: string; letter_template: string; financial_effect: string; default_days: string; valid_days: string };
const stepOf = (v: StepValues) => ({
  name: v.name,
  position: v.position === "" ? undefined : Number(v.position),
  letter_template: v.letter_template || null,
  financial_effect: v.financial_effect as ConsequenceStep["financial_effect"],
  default_days: v.default_days === "" ? null : Number(v.default_days),
  valid_days: v.valid_days === "" ? null : Number(v.valid_days),
});

function StepForm({ count, close }: { count: number; close: () => void }) {
  const letters = usePaged("GET /api/v1/letter-templates", { filters: { purpose: "sanction" }, sort: "name" });
  const f = useContractForm<StepValues>(
    { name: "", position: String(count + 1), letter_template: "", financial_effect: "none", default_days: "", valid_days: "365" },
    { safeParse: (v: StepValues) => sanctions.ConsequenceStepCreate.safeParse(stepOf(v)) },
  );
  const save = useMutation("POST /api/v1/sanctions/chain");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const s = await save.run({ body: stepOf(f.values) });
      close();
      toast(`${s.name} added at step ${s.position}`);
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <>
      <Field label="Name" {...f.status("name")}><TextField {...f.field("name")} placeholder="Final Warning" /></Field>
      <Grid cols={2}>
        <Field label="Position" {...f.status("position")}><NumberField {...f.field("position")} /></Field>
        <Field label="In Force, Days" optional {...f.status("valid_days")}><NumberField {...f.field("valid_days")} /></Field>
      </Grid>
      <Field label="Letter" optional {...f.status("letter_template")}>
        <SelectField placeholder="Pick a letter" options={letters.rows.map((t: LetterTemplate) => [t.key, t.name])} {...f.field("letter_template")} />
      </Field>
      <Field label="Financial Effect" {...f.status("financial_effect")}>
        <ChoiceField {...f.field("financial_effect")} options={[["none", "None"], ["unpaid_days", "Unpaid Days"], ["ends_employment", "Ends Employment"]]} />
      </Field>
      {f.values.financial_effect === "unpaid_days" && <Field label="Days" {...f.status("default_days")}><NumberField {...f.field("default_days")} /></Field>}
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending} onClick={submit}>Add Step</Button>
      </FormFooter>
    </>
  );
}

/* ───────────── Letter templates ───────────── */

const letterStatus = (t: LetterTemplate) =>
  t.status === "active" ? pill("ok", "Active") : t.status === "awaiting_sample" ? pill("warn", "Awaiting Sample") : t.status === "retired" ? pill("neutral", "Retired") : pill("info", "Draft");

function Templates() {
  const modal = useModal();
  const configure = useConfigure();
  const s = useApi("GET /api/v1/letter-templates/summary");
  const list = usePaged("GET /api/v1/letter-templates", { sort: "name" });
  const [sel, setSel] = useState<string | null>(null);
  const beside = useSideBySide();
  // Beside the list the first template shows unasked; elsewhere one opens when it is pressed (F31).
  const shown = list.rows.find((t) => t.letter_template_id === sel) ?? (beside ? (list.rows[0] ?? null) : null);
  const preview = useApi("GET /api/v1/letter-templates/:id/preview", { params: { id: shown?.letter_template_id ?? "" }, enabled: !!shown && shown.status !== "awaiting_sample" });
  const activate = useMutation("POST /api/v1/letter-templates/:id/activate");
  const deactivate = useMutation("POST /api/v1/letter-templates/:id/deactivate");
  // Activate a draft; Deactivate an active letter nothing sends (the refusal names what does).
  const flip = async () => {
    if (!shown) return;
    const on = shown.status !== "active";
    try {
      await (on ? activate : deactivate).run({ params: { id: shown.letter_template_id }, body: {} });
      invalidate("/api/v1/letter-templates");
      invalidate("/api/v1/sanctions/chain");
      toast(on ? `${shown.name} is active` : `${shown.name} is a draft`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Not saved");
    }
  };
  return (
    <>
      <PageHeader
        title="Letter Templates"
        sub="The system fills name, date and reason"
        actions={
          configure && (
            <>
              {shown && <Button icon="edit" onClick={() => modal.open({ title: shown.name, wide: true, body: (close) => <EditTemplate id={shown.letter_template_id} close={close} /> })}>Edit Template</Button>}
              {shown && (shown.status === "draft" || shown.status === "active") && <Button onClick={flip}>{shown.status === "active" ? "Deactivate" : "Activate"}</Button>}
              <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Template", body: (close) => <TemplateForm close={close} /> })}>New Template</Button>
            </>
          )
        }
      />
      {s.data && <StatStrip items={[{ label: "Templates", value: s.data.templates }, { label: "Active", value: s.data.active, tone: "ok" }, { label: "Awaiting Sample", value: s.data.awaiting_sample, tone: "warn" }, { label: "Letters Sent, 90d", value: s.data.sent_90d }]} />}
      <ListDetail
        cols="1/1.5"
        full
        open={sel !== null}
        onClose={() => setSel(null)}
        title="Letter Template"
        list={
          <PagedTable<LetterTemplate>
            title="Templates"
            list={list}
            rowKey={(t) => t.letter_template_id}
            noun="template"
            onRowClick={(t) => setSel(t.letter_template_id)}
            columns={[
              { key: "n", label: "Template", render: (t) => <span className={t.letter_template_id === shown?.letter_template_id ? "font-semibold" : undefined}>{t.name}</span> },
              { key: "u", label: "Used By", render: (t) => (t.used_by.length ? t.used_by.join(", ") : t.purpose === "query" ? "Queries" : t.purpose === "fine" ? "Fines" : "None"), desktop: true },
              { key: "s", label: "Status", render: (t) => <StatusPill s={letterStatus(t)} /> },
            ]}
          />
        }
        detail={
          !shown ? null : shown.status === "awaiting_sample" ? (
            <Card><EmptyState bare icon="doc" title="Awaiting Sample" text="Write the letter to preview it." /></Card>
          ) : preview.data ? (
            <Letter l={preview.data} />
          ) : preview.error ? (
            <Card><ErrorState error={preview.error} onRetry={preview.reload} /></Card>
          ) : (
            <Card><LoadingRows count={6} /></Card>
          )
        }
      />
    </>
  );
}

type TemplateValues = { name: string; purpose: string; body_html: string };

function TemplateForm({ close }: { close: () => void }) {
  const f = useContractForm<TemplateValues>({ name: "", purpose: "sanction", body_html: "" }, templates.LetterTemplateCreate);
  const save = useMutation("POST /api/v1/letter-templates");
  // Save Draft keeps it out of use; Save and Activate makes it ready to be chosen at once.
  const submit = (status: "draft" | "active") => async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { ...f.values, purpose: f.values.purpose as "query" | "sanction" | "fine", status } });
      invalidate("/api/v1/letter-templates");
      close();
      toast(status === "active" ? "Template saved and active" : "Template saved as a draft");
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <LetterAi
      letter={() => ({ name: f.values.name.trim() || "New Letter", purpose: f.values.purpose as LetterPurposeKey })}
      body={() => f.values.body_html}
      use={(html) => f.set("body_html", html)}
    >
      <Field label="Name" {...f.status("name")}><TextField {...f.field("name")} placeholder="Final Warning" /></Field>
      <Field label="Used For" {...f.status("purpose")}><ChoiceField {...f.field("purpose")} options={[["query", "Queries"], ["sanction", "Sanctions"]]} /></Field>
      <LetterBody f={f} />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button busy={save.pending} onClick={submit("draft")}>Save Draft</Button>
        <Button variant="primary" busy={save.pending} onClick={submit("active")}>Save and Activate</Button>
      </FormFooter>
    </LetterAi>
  );
}

type LetterPurposeKey = "query" | "sanction" | "fine";

/**
 * Write With AI on the letter editor (guide §9): the step in the form's own window, its draft shown
 * read-only, Use Draft putting it in the editor. Nothing is saved until the person saves the letter.
 */
function LetterAi({ letter, body, use, children }: { letter: () => { name: string; purpose: LetterPurposeKey }; body: () => string; use: (html: string) => void; children: React.ReactNode }) {
  const ai = useApi("GET /api/v1/letter-templates/assist");
  const [step, setStep] = useState<{ mounted: boolean; open: boolean }>({ mounted: false, open: false });
  const ask = async (instruction: string) => {
    const r = await api.call("POST /api/v1/letter-templates/assist", { body: { ...letter(), body_html: body(), instruction } });
    if (!r.available) {
      offToast(r.reason);
      return null;
    }
    return r.body_html ?? "";
  };
  return (
    <>
      {step.mounted && (
        <div className={step.open ? undefined : "hidden"}>
          <WriteWithAiStep
            ask={ask}
            show={(html) => <RichTextField label="Draft" value={html} onChange={() => undefined} readOnly />}
            use={(html) => (use(html), setStep({ mounted: true, open: false }))}
            back={() => setStep({ mounted: true, open: false })}
          />
        </div>
      )}
      <div className={step.open ? "hidden" : undefined}>
        <WriteWithAiButton status={ai.data} open={() => setStep({ mounted: true, open: true })} />
        {children}
      </div>
    </>
  );
}

function LetterBody({ f }: { f: { status: (k: "body_html") => object; field: (k: "body_html") => object } }) {
  return (
    <Field label={<HelpTerm help="Write {{ employee.first_name }}, {{ query_number }}, {{ reason }} or {{ step_name }} where the record fills in.">Letter</HelpTerm>} {...f.status("body_html")}>
      <RichTextField label="Letter" {...(f.field("body_html") as Omit<Parameters<typeof RichTextField>[0], "label">)} />
    </Field>
  );
}

function EditTemplate({ id, close }: { id: string; close: () => void }) {
  const t = useApi("GET /api/v1/letter-templates/:id", { params: { id } });
  if (t.error) return <ErrorState error={t.error} onRetry={t.reload} />;
  if (!t.data) return <LoadingRows count={6} />;
  return <EditTemplateForm t={t.data} close={close} />;
}

type EditValues = { name: string; purpose: string; body_html: string };

/**
 * Edit Template: the name, what it is used for (while nothing sends it), and the wording, which
 * opens as saved (a shipped letter's file, converted for the editor). Only what changed is sent:
 * the wording as its next version, the name and use through PATCH.
 */
function EditTemplateForm({ t, close }: { t: LetterTemplateDetail; close: () => void }) {
  const body = t.body_html ?? "";
  const f = useContractForm<EditValues>(
    { name: t.name, purpose: t.purpose, body_html: body },
    {
      safeParse: (value: unknown) => {
        const v = value as EditValues;
        const named = templates.LetterTemplateUpdate.safeParse({ name: v.name, ...(t.purpose !== "fine" && { purpose: v.purpose }) });
        if (!named.success) return named;
        return v.body_html === body ? named : templates.LetterTemplateBodySave.safeParse({ body_html: v.body_html });
      },
    },
  );
  const rename = useMutation("PATCH /api/v1/letter-templates/:id");
  const save = useMutation("PUT /api/v1/letter-templates/:id/body");
  const id = t.letter_template_id;
  const submit = async () => {
    if (!f.check()) return;
    const name = f.values.name.trim();
    const purpose = f.values.purpose as "query" | "sanction";
    try {
      if (name !== t.name || (t.purpose !== "fine" && purpose !== t.purpose))
        await rename.run({ params: { id }, body: { ...(name !== t.name && { name }), ...(t.purpose !== "fine" && purpose !== t.purpose && { purpose }) } });
      const r = f.values.body_html !== body ? await save.run({ params: { id }, body: { body_html: f.values.body_html } }) : null;
      invalidate("/api/v1/letter-templates");
      close();
      toast(r ? `Saved as version ${r.version}` : `${name} saved`);
    } catch (e) {
      failed(f)(e);
    }
  };
  return (
    <LetterAi letter={() => ({ name: f.values.name.trim() || t.name, purpose: t.purpose })} body={() => f.values.body_html} use={(html) => f.set("body_html", html)}>
      <Field label="Name" {...f.status("name")}><TextField {...f.field("name")} /></Field>
      {t.purpose === "fine" ? null : t.in_use ? (
        <KeyValue items={[[<HelpTerm key="u" help="A step or rule sends it, or every manual query does. Move them first.">Used For</HelpTerm>, t.purpose === "query" ? "Queries" : "Sanctions"]]} />
      ) : (
        <Field label="Used For" {...f.status("purpose")}><ChoiceField {...f.field("purpose")} options={[["query", "Queries"], ["sanction", "Sanctions"]]} /></Field>
      )}
      <LetterBody f={f} />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" busy={save.pending || rename.pending} onClick={submit}>Save Letter</Button>
      </FormFooter>
    </LetterAi>
  );
}
