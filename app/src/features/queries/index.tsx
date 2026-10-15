import { useState } from "react";
import { ApiError } from "@/api/client";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import "@/api/types/queries";
import type { Firing, LetterTemplate, Outcome, QueryRow, Rule, RuleCreate, SanctionCreate, SanctionRow } from "@/api/types/queries";
import type { PersonRef } from "@/api/types/common";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Banner, Chain, KV, StatStrip, Who } from "@/components/ui/data";
import { Card, CardHeader, Grid, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { Money } from "@/components/ui/Money";
import { Letter } from "@/features/shared/Letter";
import { Chips, ErrorBlock, LoadingRows } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, formatWhen } from "@/lib/format";
import { useRouter } from "@/lib/router";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { BarsCard, KvCard, ModalFoot, PagedTable, StatusPill, TrailCard } from "@/features/shared/sections";
import type { ModuleScreenProps } from "@/shell/screens";
import { AmountInput, Field, FormRow, Input, PersonPicker, Select, Textarea, useForm } from "@/components/form";

export default function Queries({ tab, id }: ModuleScreenProps) {
  if (tab === "rules") return <Rules />;
  if (tab === "sanctions") return <Sanctions />;
  if (tab === "letter-templates") return <Templates />;
  return <QueriesTab id={id} />;
}

const person = (p: PersonRef) => <Who name={p.display_name} sub={p.department ?? undefined} />;

/* ───────────── Queries ───────────── */

function QueriesTab({ id }: { id: string | null }) {
  const modal = useModal();
  const { navigate } = useRouter();
  const { me } = useAuth();
  const full = !!(me?.grants.settings?.includes("view") || me?.is_ceo);
  const [scope, setScope] = useState<"all" | "mine">(full ? "all" : "mine");
  const s = useApi("GET /api/v1/queries/summary");
  const list = usePaged("GET /api/v1/queries", { filters: { scope } });
  const focus = id ?? s.data?.focus_id ?? null;
  return (
    <>
      <PageHead
        title="Queries"
        sub="Managers see the queries they raised. People and the CEO see all."
        actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Raise a Query", body: (close) => <RaiseQuery close={close} /> })}>Raise a Query</Button>}
      />
      {s.data && <KpiTiles items={[{ label: "Open", value: String(s.data.open), tone: s.data.open ? "warn" : "ok" }, { label: "Awaiting Response", value: String(s.data.awaiting_response) }, { label: "Closed This Month", value: String(s.data.closed_this_month), tone: "ok" }, { label: "Escalated", value: String(s.data.escalated), tone: s.data.escalated ? "err" : undefined }]} />}
      {full && <Chips value={scope} onChange={setScope} options={[["all", "All Queries"], ["mine", "Raised by Me"]]} />}
      <PagedTable<QueryRow>
        title={scope === "mine" ? "Queries I Raised" : "All Queries"}
        list={list}
        search="Search name, number or subject"
        rowKey={(q) => q.query_id}
        noun="query"
        nounPlural="queries"
        onRowClick={(q) => navigate(`/queries?tab=queries&id=${q.query_id}`)}
        wide
        empty={{ title: "No queries", text: "Queries you raise, and those rules raise on your team, appear here." }}
        columns={[
          { key: "e", label: "Employee", render: (q) => person(q.employee) },
          { key: "n", label: "Number", render: (q) => q.number, desktop: true },
          { key: "s", label: "Subject", render: (q) => q.subject },
          { key: "b", label: "Raised By", render: (q) => q.raised_by, desktop: true },
          { key: "d", label: "Raised", render: (q) => formatDate(q.raised_on) },
          { key: "r", label: "Response", render: (q) => q.response ?? "Not yet", desktop: true },
          { key: "st", label: "Status", render: (q) => <StatusPill s={q.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        {focus ? <QueryCard id={focus} /> : <Card><p className="text-[12.5px] text-subtle-foreground">Pick a query to see it here.</p></Card>}
        {s.data ? <BarsCard title="Queries by Reason, Last 90 Days" rows={s.data.by_reason} note={s.data.by_reason_note} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

function QueryCard({ id }: { id: string }) {
  const modal = useModal();
  const q = useApi("GET /api/v1/queries/:id", { params: { id } });
  const remind = useMutation("POST /api/v1/queries/:id/remind");
  if (q.error) return <Card><ErrorBlock error={q.error} onRetry={q.reload} /></Card>;
  if (!q.data) return <Card><LoadingRows /></Card>;
  const d = q.data;
  return (
    <Card>
      <CardHeader title={`${d.number} · ${d.employee.display_name}`} right={<StatusPill s={d.status} />} />
      <KV
        items={[
          ["Subject", d.subject],
          ["Raised by", d.raised_by === "System rule" ? "A system rule, not a manager" : d.raised_by],
          ["Raised", formatDateTime(d.raised_at)],
          ["Response due", d.respond_by ? formatDateTime(d.respond_by) : "Closed"],
          ...(d.instances.length ? ([["Instances", d.instances.join(", ")]] as Array<[string, string]>) : []),
          ["Letter", d.letter],
          ...(d.response_text ? ([["Response", d.response_text]] as Array<[string, string]>) : []),
        ]}
      />
      <div className="mt-3.5 flex flex-wrap gap-2">
        <Button icon="doc" onClick={() => modal.open({ title: `${d.number} · Query Letter`, wide: true, body: <LetterById id={d.query_id} /> })}>View Letter</Button>
        {d.can_remind && (
          <Button disabled={remind.pending} onClick={async () => { await remind.run({ params: { id: d.query_id }, body: {} }); toast(`Reminder sent to ${d.employee.display_name}`); }}>Send Reminder</Button>
        )}
        {d.can_decide && <Button variant="primary" onClick={() => modal.open({ title: `Decision on ${d.number}`, body: (close) => <Decide id={d.query_id} hasResponse={!!d.response_text} close={close} /> })}>Record a Decision</Button>}
      </div>
    </Card>
  );
}

function LetterById({ id }: { id: string }) {
  const l = useApi("GET /api/v1/queries/:id/letter", { params: { id } });
  return l.data ? <Letter l={l.data} note="Query letter as it is sent. Everything underlined came from the record, not from typing." /> : l.error ? <ErrorBlock error={l.error} /> : <LoadingRows count={6} />;
}

function RaiseQuery({ close }: { close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const f = useForm({ subject: "", details: "" }, { subject: (v) => (v.trim().length < 4 ? "Say what the query is about" : null), details: (v) => (v.trim().length < 20 ? "Give the facts: dates, times, what happened" : null) });
  const [tried, setTried] = useState(false);
  const save = useMutation("POST /api/v1/queries");
  const submit = async () => {
    setTried(true);
    if (!f.check() || !who.length) return;
    try {
      const q = await save.run({ body: { employee_id: who[0].employee_id, subject: f.values.subject.trim(), details: f.values.details.trim() } });
      invalidate("/api/v1/queries");
      close();
      toast(`${q.number} raised. The letter goes to ${q.employee.display_name} by email and in app`);
    } catch (e) {
      f.setServerErrors(save.fields);
      if (e instanceof ApiError && !e.fields) toast(e.message);
    }
  };
  return (
    <>
      <Banner tone="info" icon="info">The employee has 48 hours to respond in writing. Their response is read before any decision.</Banner>
      <Field label="Employee" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Pick the employee" : undefined}><PersonPicker value={who} onChange={setWho} /></Field>
      <Field label="Subject" {...f.field("subject")}><Input {...f.field("subject")} placeholder="Missing clock-out Thursday" /></Field>
      <Field label="What Happened" {...f.field("details")}><Textarea {...f.field("details")} placeholder="No clock-out 14/10" /></Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon="send" disabled={save.pending} onClick={submit}>Raise and Send Letter</Button>
      </ModalFoot>
    </>
  );
}

const OUTCOMES: Array<[Outcome, string]> = [["no_action", "Close, No Action"], ["caution", "Caution"], ["warning", "Warning"], ["suspension", "Suspension"], ["suspension_without_pay", "Suspension Without Pay"], ["dismissal", "Dismissal"]];

function Decide({ id, hasResponse, close }: { id: string; hasResponse: boolean; close: () => void }) {
  const f = useForm({ outcome: "no_action", note: "", fine: "" }, { note: (v) => (v.trim().length < 10 ? "Record the reason" : null) });
  const save = useMutation("POST /api/v1/queries/:id/decision");
  const submit = async () => {
    if (!f.check()) return;
    try {
      const q = await save.run({ params: { id }, body: { outcome: f.values.outcome as Outcome, note: f.values.note.trim(), ...(f.values.fine && { fine_amount: f.values.fine }) } });
      invalidate("/api/v1/queries");
      close();
      toast(`${q.number}: ${q.status.text}`);
    } catch (e) {
      f.setServerErrors(save.fields);
      if (e instanceof ApiError && !e.fields) toast(e.message);
    }
  };
  return (
    <>
      {!hasResponse && <Banner tone="warn">No response yet. A sanction waits until the employee has answered or the 48 hours have passed.</Banner>}
      <Field label="Outcome"><Select options={OUTCOMES} {...f.field("outcome")} /></Field>
      {f.values.outcome !== "no_action" && (
        <Field label="Fine (Optional)" info="A fine reaches payroll as a pending deduction. Finance or Operations accepts it; it is never automatic.">
          <AmountInput {...f.field("fine")} />
        </Field>
      )}
      <Field label="Reason" {...f.field("note")}><Textarea {...f.field("note")} placeholder="Explanation accepted" /></Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Record Decision</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Rules ───────────── */

function Rules() {
  const modal = useModal();
  const s = useApi("GET /api/v1/queries/rules/summary");
  const rules = usePaged("GET /api/v1/queries/rules");
  const firings = usePaged("GET /api/v1/queries/rules/firings");
  const activate = useMutation("POST /api/v1/queries/rules/:id/activate");
  return (
    <>
      <PageHead title="Rules" sub="Automatic queries, configured not coded" actions={<Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Rule", body: (close) => <RuleForm close={close} /> })}>New Rule</Button>} />
      {s.data && <KpiTiles items={[{ label: "Active Rules", value: String(s.data.active) }, { label: "Draft", value: String(s.data.draft) }, { label: "Fired This Month", value: String(s.data.fired_this_month) }, { label: "Queries Raised", value: String(s.data.queries_raised) }]} />}
      {rules.loading && !rules.rows.length ? <Card><LoadingRows /></Card> : (
        <Grid cols={3}>
          {rules.rows.map((r: Rule) => (
            <div key={r.rule_id} className="rounded-box border border-border bg-card p-[14px]">
              <h4 className="text-[13.5px] font-semibold">{r.name}</h4>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{r.description}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <StatusPill s={r.status} />
                {r.threshold && <StatusPill s={{ tone: "neutral", text: r.threshold }} />}
                {r.status.text === "Draft" && (
                  <Button size="sm" className="ml-auto" disabled={activate.pending} onClick={async () => { await activate.run({ params: { id: r.rule_id }, body: {} }); invalidate("/api/v1/queries/rules"); toast(`${r.name} is now active`); }}>Activate</Button>
                )}
              </div>
            </div>
          ))}
        </Grid>
      )}
      <Grid cols={2} className="mt-3">
        <PagedTable<Firing>
          title="Recent Firings"
          right={<span className="text-[11.5px] text-subtle-foreground">Last 7 days</span>}
          list={firings}
          rowKey={(x) => x.firing_id}
          noun="firing"
          columns={[
            { key: "r", label: "Rule", render: (x) => x.rule },
            { key: "f", label: "Fired", render: (x) => formatWhen(x.fired_at) },
            { key: "e", label: "Employee", render: (x) => person(x.employee) },
            { key: "o", label: "Outcome", render: (x) => <StatusPill s={x.outcome} /> },
          ]}
        />
        <KvCard
          title="What a Rule Is Made Of"
          items={[
            ["Trigger", "An event: a punch, a day ending, a task date passing"],
            ["Threshold", "A number and a window. “3 in 30 days”"],
            ["Who it notifies", "A role, not a person. The role can change"],
            ["Letter", "Which template to send, filled from the record"],
            ["Chain", "Which consequence step it opens, if any"],
            ["Changing it", "Editing a value. No deploy, no release"],
          ]}
        />
      </Grid>
      <p className="mt-3 text-[11.5px] text-subtle-foreground">The threshold on each rule is a setting. Changing “3 in 30 days” needs no deploy.</p>
    </>
  );
}

const TRIGGERS: Array<[RuleCreate["trigger"], string]> = [["lateness", "Late arrival"], ["missing_clock_out", "Missing clock-out"], ["unenrolled_device", "Punch from an unenrolled device"], ["absence", "Absence without notice"], ["overdue_task", "Overdue task"], ["missed_kpi", "KPI closed below 50%"]];

function RuleForm({ close }: { close: () => void }) {
  const tpl = usePaged("GET /api/v1/queries/templates");
  const f = useForm({ name: "", trigger: "lateness", count: "3", window_days: "30", template_id: "" }, {
    name: (v) => (v.trim().length < 3 ? "Name the rule" : null),
    count: (v) => (!(Number(v) >= 1) ? "At least 1" : null),
    window_days: (v) => (!(Number(v) >= 1) ? "At least 1 day" : null),
    template_id: (v) => (!v ? "Pick the letter it sends" : null),
  });
  const save = useMutation("POST /api/v1/queries/rules");
  const num = (k: "count" | "window_days") => ({ ...f.field(k), onChange: (v: string) => f.set(k, v.replace(/\D/g, "").slice(0, 3)), inputMode: "numeric" as const });
  const submit = async () => {
    if (!f.check()) return;
    try {
      const r = await save.run({ body: { name: f.values.name.trim(), trigger: f.values.trigger as RuleCreate["trigger"], count: Number(f.values.count), window_days: Number(f.values.window_days), template_id: f.values.template_id } });
      invalidate("/api/v1/queries/rules");
      close();
      toast(`${r.name} saved as a draft. Activate it when ready`);
    } catch (e) {
      f.setServerErrors(save.fields);
      if (e instanceof ApiError && !e.fields) toast(e.message);
    }
  };
  return (
    <>
      <Field label="Name" {...f.field("name")}><Input {...f.field("name")} placeholder="e.g. Repeated lateness" /></Field>
      <Field label="What Sets It Off"><Select options={TRIGGERS} {...f.field("trigger")} /></Field>
      <FormRow>
        <Field label="How Many Times" {...f.field("count")}><Input {...num("count")} /></Field>
        <Field label="Within (Days)" {...f.field("window_days")}><Input {...num("window_days")} /></Field>
      </FormRow>
      <Field label="Letter It Sends" {...f.field("template_id")}>
        <Select placeholder="Pick a template" options={tpl.rows.filter((t) => t.status.tone === "ok").map((t) => [t.template_id, t.name])} {...f.field("template_id")} />
      </Field>
      <p className="text-[11.5px] text-subtle-foreground">Saved as a draft. Nothing fires until it is activated.</p>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Save Rule</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Sanctions ───────────── */

function Sanctions() {
  const modal = useModal();
  const s = useApi("GET /api/v1/queries/sanctions/summary");
  const list = usePaged("GET /api/v1/queries/sanctions");
  return (
    <>
      <PageHead
        title="Sanctions"
        sub="The consequence chain · MyCity ladder"
        actions={
          <>
            <Button icon="cog" onClick={() => modal.open({ title: "Chain Settings", body: <ChainSettings /> })}>Chain Settings</Button>
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "Issue Sanction", body: (close) => <IssueSanction close={close} /> })}>Issue Sanction</Button>
          </>
        }
      />
      {s.data?.focus && (
        <Card className="mb-3">
          <CardHeader title={s.data.focus.title} right={<StatusPill s={s.data.focus.status} />} />
          <ChainSteps steps={s.data.focus.chain} />
          <p className="mt-[11px] text-[11.5px] text-subtle-foreground">Adding or removing a step is configuration. A fine attaches to any step and reaches payroll as a pending deduction, used for property damage.</p>
        </Card>
      )}
      {s.data && <KpiTiles items={[{ label: "Active Sanctions", value: String(s.data.active) }, { label: "Served", value: String(s.data.served) }, { label: "Financial, This Year", value: <Money value={s.data.financial_this_year} /> }, { label: "Recovered", value: <Money value={s.data.recovered} />, tone: "ok" }]} />}
      <PagedTable<SanctionRow>
        title="Sanction History"
        list={list}
        search="Search people or reasons"
        rowKey={(x) => x.sanction_id}
        noun="sanction"
        wide
        columns={[
          { key: "e", label: "Employee", render: (x) => person(x.employee) },
          { key: "k", label: "Sanction", render: (x) => x.kind },
          { key: "r", label: "Reason", render: (x) => x.reason },
          { key: "b", label: "Issued By", render: (x) => x.issued_by, desktop: true },
          { key: "d", label: "Date", render: (x) => formatDate(x.date) },
          { key: "m", label: "Financial", align: "n", render: (x) => (x.amount ? <Money value={x.amount} /> : "None") },
          { key: "s", label: "Status", render: (x) => <StatusPill s={x.status} /> },
        ]}
      />
      <Grid cols={2} className="mt-3">
        <KvCard
          title="How a Fine Reaches Payroll"
          items={[
            ["Issued", "On any step of the chain, with an amount and a reason"],
            ["Lands in", "Payroll, Deductions, as pending acceptance"],
            ["Who accepts", "Finance or Operations. Never automatic"],
            ["Spread", "Can be split across runs"],
            ["If the employee appeals", "The deduction holds until the appeal is decided"],
            ["On the payslip", "A single line: the reason, not the sanction wording"],
          ]}
        />
        {s.data ? <TrailCard title="Chain Activity" items={s.data.activity.map((x) => ({ ...x, when: formatDate(x.when) }))} /> : <Card><LoadingRows /></Card>}
      </Grid>
    </>
  );
}

const ChainSteps = ({ steps }: { steps: Array<{ label: string; state: "done" | "now" | null }> }) => <Chain steps={steps.map((s) => ({ label: s.label, state: s.state ?? undefined }))} />;

function ChainSettings() {
  return (
    <>
      <p className="mb-3 text-[12.5px] text-muted-foreground">The MyCity ladder, in order. Each step names the letter it sends; a step without an active letter cannot send one.</p>
      <KV items={[["1 · Caution", "Caution letter"], ["2 · Warning", "Warning letter"], ["3 · Suspension", "Suspension letter (awaiting sample)"], ["4 · Suspension without pay", "Awaiting sample"], ["5 · Dismissal", "Termination letter (awaiting sample)"], ["Fines", "Attach to any step"]]} />
      <p className="mt-3 text-[11.5px] text-subtle-foreground">Changing the ladder is a setting under Settings, Approvals. It needs no deploy.</p>
    </>
  );
}

function IssueSanction({ close }: { close: () => void }) {
  const [who, setWho] = useState<PersonRef[]>([]);
  const [tried, setTried] = useState(false);
  const f = useForm({ kind: "caution", reason: "", amount: "" }, { reason: (v) => (v.trim().length < 6 ? "Give the reason" : null), amount: (v, all) => (all.kind === "fine" && !(Number(v) > 0) ? "A fine needs an amount" : null) });
  const save = useMutation("POST /api/v1/queries/sanctions");
  const submit = async () => {
    setTried(true);
    if (!f.check() || !who.length) return;
    try {
      const x = await save.run({ body: { employee_id: who[0].employee_id, kind: f.values.kind as SanctionCreate["kind"], reason: f.values.reason.trim(), ...(f.values.amount && { amount: f.values.amount }) } });
      invalidate("/api/v1/queries/sanctions");
      close();
      toast(x.kind === "Fine" ? "Fine recorded. It waits in Payroll, Deductions for acceptance" : `${x.kind} issued to ${x.employee.display_name}`);
    } catch (e) {
      f.setServerErrors(save.fields);
      if (e instanceof ApiError && !e.fields) toast(e.message);
    }
  };
  return (
    <>
      <Field label="Employee" state={tried && !who.length ? "bad" : undefined} message={tried && !who.length ? "Pick the employee" : undefined}><PersonPicker value={who} onChange={setWho} /></Field>
      <Field label="Sanction"><Select options={[["caution", "Caution"], ["warning", "Warning"], ["suspension", "Suspension"], ["suspension_without_pay", "Suspension Without Pay"], ["dismissal", "Dismissal"], ["fine", "Fine"]]} {...f.field("kind")} /></Field>
      {f.values.kind === "fine" && <Field label="Amount" {...f.field("amount")}><AmountInput {...f.field("amount")} /></Field>}
      <Field label="Reason" {...f.field("reason")}><Textarea {...f.field("reason")} placeholder="Follows QRY-0042" /></Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Issue</Button>
      </ModalFoot>
    </>
  );
}

/* ───────────── Letter templates ───────────── */

function Templates() {
  const modal = useModal();
  const s = useApi("GET /api/v1/queries/templates/summary");
  const list = usePaged("GET /api/v1/queries/templates");
  const [sel, setSel] = useState<LetterTemplate | null>(null);
  const shown = sel ?? list.rows[0] ?? null;
  const preview = useApi("GET /api/v1/queries/templates/:id/preview", { params: { id: shown?.template_id ?? "" }, enabled: !!shown });
  return (
    <>
      <PageHead
        title="Letter Templates"
        sub="Seeded with MyCity wording. The system fills name, date and reason."
        actions={
          <>
            <Button icon="doc" disabled={!preview.data} onClick={() => preview.data && modal.open({ title: shown!.name, wide: true, body: <Letter l={preview.data} /> })}>Preview</Button>
            <Button variant="primary" icon="plus" onClick={() => modal.open({ title: "New Template", body: (close) => <TemplateForm close={close} /> })}>New Template</Button>
          </>
        }
      />
      {s.data && <StatStrip items={[{ label: "Templates", value: s.data.templates }, { label: "Active", value: s.data.active, tone: "ok" }, { label: "Awaiting Sample", value: s.data.awaiting, tone: "warn" }, { label: "Letters Sent, 90d", value: s.data.sent_90d }, { label: "Languages", value: s.data.languages, desktop: true }]} />}
      <Grid cols="1/1.5">
        <PagedTable<LetterTemplate>
          title="Templates"
          list={list}
          rowKey={(t) => t.template_id}
          noun="template"
          onRowClick={setSel}
          columns={[
            { key: "n", label: "Template", render: (t) => <span className={t.template_id === shown?.template_id ? "font-semibold" : undefined}>{t.name}</span> },
            { key: "u", label: "Used For", render: (t) => t.used_for },
            { key: "s", label: "Status", render: (t) => <StatusPill s={t.status} /> },
          ]}
        />
        <div>
          {preview.data ? <Letter l={preview.data} /> : preview.error ? <Card><Banner tone="warn">{preview.error.message}</Banner></Card> : <Card><LoadingRows count={6} /></Card>}
        </div>
      </Grid>
      <p className="mt-3 text-[11.5px] text-subtle-foreground">Three templates are waiting on sample letters from MyCity so the wording is theirs, not ours. Until a sample arrives, that step of the chain cannot send a letter.</p>
    </>
  );
}

function TemplateForm({ close }: { close: () => void }) {
  const f = useForm({ name: "", used_for: "", body: "" }, { name: (v) => (v.trim().length < 3 ? "Name the template" : null), used_for: (v) => (!v.trim() ? "Say when it is sent" : null), body: (v) => (v.trim().length < 40 ? "Write the letter" : null) });
  const save = useMutation("POST /api/v1/queries/templates");
  const submit = async () => {
    if (!f.check()) return;
    try {
      await save.run({ body: { name: f.values.name.trim(), used_for: f.values.used_for.trim(), body: f.values.body } });
      invalidate("/api/v1/queries/templates");
      close();
      toast("Template saved as a draft");
    } catch {
      f.setServerErrors(save.fields);
    }
  };
  return (
    <>
      <FormRow>
        <Field label="Name" {...f.field("name")}><Input {...f.field("name")} placeholder="Final warning letter" /></Field>
        <Field label="Used For" {...f.field("used_for")}><Input {...f.field("used_for")} placeholder="Step name" /></Field>
      </FormRow>
      <Field label="Letter" info="Use {name}, {date}, {reason} and {hours} where the record fills in. Everything else is sent as written." {...f.field("body")}>
        <Textarea {...f.field("body")} rows={8} placeholder="Dear {name}, ..." />
      </Field>
      <ModalFoot>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={save.pending} onClick={submit}>Save Template</Button>
      </ModalFoot>
    </>
  );
}
